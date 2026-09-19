// Colin: the GLB, his scale, which way he faces, and a three-clip gait.
//
// He is loaded from ../../models/colin_slim.glb -- the same file the map app in
// this repo uses, not a copy. Five megabytes has no business being in the repo
// twice.
//
// TWO TRAPS, both from Big Don, both costing orders of magnitude rather than
// inches, and both the reason this file does not just call Box3:
//
//  1. `Box3.setFromObject` LIES ABOUT SKINNED MESHES. It measures the geometry's
//     bind-pose box through the MESH NODE's matrixWorld -- but a skinned mesh's
//     vertices are placed by the BONES, and the node transform does not move
//     them. This file's armature carries an 0.01 exporter scale, so setFromObject
//     reports a character a hundredth of his real size, on his side.
//  2. `updateWorldMatrix` IS NOT `updateMatrixWorld`. Different methods.
//     SkinnedMesh overrides only the latter, and that override is what
//     recomputes bindMatrixInverse. Call the wrong one before measuring and
//     every skinned vertex goes through a stale inverse.
//
// So height comes from the GEOMETRY bounds, which GLTFLoader binds with the
// identity matrix and which are therefore already in metres.

import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { MOVE } from './tune.js';

const TARGET_H = 1.78;
const CLIPS = { idle: 'idle_neutral_00', walk: 'walk_fwd_normal',
                run: 'run_fwd', sprint: 'run_fwd_fast', jump: 'run_jump' };

export async function loadColin(onProgress) {
  const url = new URL('../../models/colin_slim.glb', import.meta.url).href;
  const gltf = await new Promise((res, rej) =>
    new GLTFLoader().load(url, res, (e) => onProgress && e.total && onProgress(e.loaded / e.total), rej));

  const model = gltf.scene;
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;       // a skinned mesh's bounds are the bind pose
    o.castShadow = false;
    const m = o.material;
    if (!m) return;
    // THE EXPORT SAYS `BLEND` + `doubleSided`, WHICH IS BLENDER'S DEFAULT for any
    // texture carrying an alpha channel and is wrong for a body. A transparent
    // double-sided skin sorts against itself: his far side draws over his near
    // side and he reads as a dark smear. A CUTOUT does the same job for hair and
    // eyelashes and writes depth like anything else. Rollergirl's export had the
    // identical fault and it is written up there too.
    if (m.transparent) { m.transparent = false; m.alphaTest = 0.5; m.depthWrite = true; }
    m.side = THREE.FrontSide;
    m.metalness = 0;
    m.roughness = 1;
    // KHR_materials_specular arrives at 2.0 on this file. That moving hotspot is
    // what makes a hand-painted texture look like wet plastic.
    if (m.specularIntensity !== undefined) m.specularIntensity = 0;
    if (m.specularColor) m.specularColor.setScalar(0);
    if (m.clearcoat !== undefined) m.clearcoat = 0;
    if (m.sheen !== undefined) m.sheen = 0;
    // The city is lit by a hemisphere and one sun and has no bounce, so a
    // character's shaded side goes to nothing. Feeding his own base map back as
    // a low emission is Shredworld's answer and it costs no light.
    if (m.map && !m.emissiveMap) {
      m.emissiveMap = m.map;
      m.emissive = new THREE.Color(0xffffff);
      m.emissiveIntensity = 0.26;
    }
    m.needsUpdate = true;
  });

  // Height off the geometry, never off the node box.
  let lo = Infinity, hi = -Infinity;
  model.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox();
    lo = Math.min(lo, o.geometry.boundingBox.min.y);
    hi = Math.max(hi, o.geometry.boundingBox.max.y);
  });
  const raw = hi - lo;
  const scale = raw > 0.01 ? TARGET_H / raw : 1;

  // `spin` cancels whichever way the ART faces, so root.rotation.y can stay
  // literally "his bearing" everywhere else. MEASURED, never assumed -- Colin's
  // rig faces +Z (south here), not the -Z a GLTF conventionally points, and
  // getting it wrong reads as inverted controls rather than as a backwards model.
  const holder = new THREE.Group();
  holder.scale.setScalar(scale);
  holder.position.y = -lo * scale;
  holder.add(model);
  const root = new THREE.Group();
  root.add(holder);
  root.updateMatrixWorld(true);
  const facing = measureFacing(model);
  holder.rotation.y = Math.atan2(facing.f[0], -facing.f[2]);

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const [k, name] of Object.entries(CLIPS)) {
    const clip = gltf.animations.find((a) => a.name === name);
    if (!clip) continue;
    const a = mixer.clipAction(clip);
    a.play(); a.setEffectiveWeight(0); a.enabled = true;
    actions[k] = a;
  }
  if (actions.idle) actions.idle.setEffectiveWeight(1);
  return { root, holder, model, mixer, actions, scale, facing, height: TARGET_H };
}

function worldPos(o) { return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); }
function flat(v) { v.y = 0; return v.lengthSq() > 1e-8 ? v.normalize() : null; }

/**
 * Which way the rig faces, in its own space.
 *
 * TOES ARE THE PRIMARY MEASUREMENT: a foot points forwards, which is a
 * geometric fact about a body, and averaging the two cancels the splay. The
 * shoulder span is the obvious alternative and is strictly weaker -- it needs
 * the rig's left/right naming to be honest AND `up x right` the right way
 * round, and Big Don shipped both backwards at once where they hid each other.
 * Both are taken, so a disagreement is a warning rather than a silent wrong
 * answer.
 */
export function measureFacing(root) {
  const bones = [];
  root.traverse((o) => { if (o.isBone) bones.push(o); });
  const find = (...res) => { for (const re of res) { const b = bones.find((x) => re.test(x.name)); if (b) return b; } return null; };
  const pair = (foot, toe) => {
    const f = find(...foot), t = find(...toe);
    return f && t ? flat(worldPos(t).sub(worldPos(f))) : null;
  };
  const L = pair([/left.*foot/i, /foot.*[_.]?l$/i], [/left.*toe/i, /toe.*[_.]?l$/i]);
  const R = pair([/right.*foot/i, /foot.*[_.]?r$/i], [/right.*toe/i, /toe.*[_.]?r$/i]);
  const toes = L && R ? flat(L.clone().add(R)) : (L || R);
  const ls = find(/left.*(shoulder|clavicle|arm)/i, /^l[_.]?(upper)?arm/i);
  const rs = find(/right.*(shoulder|clavicle|arm)/i, /^r[_.]?(upper)?arm/i);
  let sh = null;
  if (ls && rs) {
    // three's own basis: right +X, up +Y, looking down -Z. So up x right =
    // (0,1,0) x (1,0,0) = (0,0,-1), which is forward. `right x up` is the
    // classic way to get this exactly negated.
    const across = flat(worldPos(rs).sub(worldPos(ls)));
    if (across) sh = new THREE.Vector3(0, 1, 0).cross(across).normalize();
  }
  const disagree = toes && sh ? Math.acos(Math.max(-1, Math.min(1, toes.dot(sh)))) * 180 / Math.PI : null;
  if (disagree !== null && disagree > 45 && window.__crash)
    window.__crash(`rig facing: toes and shoulders disagree by ${disagree.toFixed(0)} deg`);
  const f = toes || sh || new THREE.Vector3(0, 0, -1);
  return { f: [f.x, f.y, f.z], from: toes ? 'toes' : sh ? 'shoulders' : 'default', disagree };
}

/**
 * The gait blends on MEASURED SPEED, never on stick deflection: the clip then
 * winds up with him for free, and a character who hits a wall stops moving his
 * legs. Weights always sum to one -- a table that dips below it bleeds the BIND
 * POSE in, which is a T-pose, and it looks like a bug in the model.
 */
export function animate(c, dt, speed, grounded) {
  if (!c) return;
  const A = c.actions;
  const w = { idle: 0, walk: 0, run: 0, sprint: 0, jump: 0 };
  if (!grounded && A.jump) {
    w.jump = 1;
  } else if (speed < 0.25) {
    w.idle = 1;
  } else if (speed < MOVE.walk) {
    const t = speed / MOVE.walk; w.idle = 1 - t; w.walk = t;
  } else if (speed < MOVE.run) {
    const t = (speed - MOVE.walk) / (MOVE.run - MOVE.walk); w.walk = 1 - t; w.run = t;
  } else {
    const t = Math.min(1, (speed - MOVE.run) / Math.max(0.1, MOVE.sprint - MOVE.run));
    w.run = 1 - t; w.sprint = t;
  }
  if (!A.sprint) { w.run += w.sprint; w.sprint = 0; }
  if (!A.jump) { w.idle += w.jump; w.jump = 0; }
  const k = 1 - Math.pow(2, -dt / 0.09);
  for (const key of Object.keys(w)) {
    const a = A[key]; if (!a) continue;
    a.setEffectiveWeight(a.getEffectiveWeight() + (w[key] - a.getEffectiveWeight()) * k);
  }
  // Feet meet the ground when the cycle rate matches the speed. `run_fwd` is
  // the reference; a clip played at a rate the body is not going is the slide
  // everybody blames on the animation.
  if (A.run) A.run.setEffectiveTimeScale(Math.max(0.55, Math.min(1.9, speed / 4.6)));
  if (A.walk) A.walk.setEffectiveTimeScale(Math.max(0.55, Math.min(1.8, speed / 1.5)));
  if (A.sprint) A.sprint.setEffectiveTimeScale(Math.max(0.7, Math.min(1.8, speed / 7.6)));
  c.mixer.update(dt);
}

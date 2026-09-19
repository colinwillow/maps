import * as THREE from 'three';
import { headingOf } from '../three/geo';

/**
 * Which way the model is actually facing — MEASURED, never assumed.
 *
 * This is split out of loadColin.ts for one reason: loadColin imports
 * GLTFLoader, which imports the bare specifier `three` and therefore cannot be
 * loaded into node. Keeping the orientation maths here lets it be tested
 * headlessly against a synthetic rig, which matters because the cost of
 * getting it wrong is the entire character running backwards.
 *
 * And it WAS wrong. Colin's rig faces +Z, which in this scene is SOUTH, while
 * the code assumed -Z (north) — the direction a GLTF's forward conventionally
 * points. So at every heading he ran exactly backwards, and since the camera
 * swings round behind him as he walks, what you saw was a man sprinting
 * straight at the camera. It reads as "the controls are inverted", which is
 * why the stick maths got blamed twice and measured correct both times.
 *
 * Big Don's rule, learned the same way: derive handedness, never guess it.
 */

/** Find the first bone whose name matches any of these, in order. */
function findBone(root: THREE.Object3D, ...patterns: RegExp[]): THREE.Object3D | null {
  const bones: THREE.Object3D[] = [];
  root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o); });
  for (const re of patterns) {
    const hit = bones.find((b) => re.test(b.name));
    if (hit) return hit;
  }
  return null;
}

const worldPos = (o: THREE.Object3D) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);

/** Flatten to the ground plane and normalise; null if it was too short to mean anything. */
function flatten(v: THREE.Vector3): THREE.Vector3 | null {
  v.y = 0;
  return v.lengthSq() > 1e-8 ? v.normalize() : null;
}

export type Facing = {
  /** Unit vector in the model's own space, on the ground plane. */
  forward: THREE.Vector3;
  /** Which measurement produced it. */
  from: 'toes' | 'shoulders' | 'default';
  /** Degrees the two measurements disagreed by, when both were available. */
  disagreementDeg: number | null;
};

/**
 * Measure the direction the model faces, in its own space.
 *
 * TOES ARE THE PRIMARY MEASUREMENT, and deliberately so: a foot points
 * forwards, which is a geometric fact about a body. The shoulder span is the
 * obvious alternative and it is strictly weaker — it depends on the rig's
 * left/right naming being honest AND on getting `up x right` the right way
 * round, and Big Don shipped both of those backwards at once, where they hid
 * each other. Averaging the two feet cancels the splay.
 *
 * Call it with world matrices already updated.
 */
export function measureFacing(root: THREE.Object3D): Facing {
  const pair = (foot: RegExp[], toe: RegExp[]) => {
    const f = findBone(root, ...foot);
    const t = findBone(root, ...toe);
    return f && t ? flatten(worldPos(t).sub(worldPos(f))) : null;
  };

  const left = pair([/left.*foot/i, /foot.*[_.]?l$/i], [/left.*toe/i, /toe.*[_.]?l$/i]);
  const right = pair([/right.*foot/i, /foot.*[_.]?r$/i], [/right.*toe/i, /toe.*[_.]?r$/i]);
  const fromToes = left && right ? flatten(left.clone().add(right)) : (left ?? right);

  const lSh = findBone(root, /left.*(shoulder|clavicle|arm)/i, /^l[_.]?(upper)?arm/i);
  const rSh = findBone(root, /right.*(shoulder|clavicle|arm)/i, /^r[_.]?(upper)?arm/i);
  let fromShoulders: THREE.Vector3 | null = null;
  if (lSh && rSh) {
    const across = flatten(worldPos(rSh).sub(worldPos(lSh)));
    // three's own basis: right is +X, up is +Y, and it looks down -Z. So
    // up x right = (0,1,0) x (1,0,0) = (0,0,-1), which is forward. The
    // negation, right x up, is the classic way to get this exactly backwards.
    if (across) fromShoulders = new THREE.Vector3(0, 1, 0).cross(across).normalize();
  }

  const disagreementDeg =
    fromToes && fromShoulders
      ? (Math.acos(THREE.MathUtils.clamp(fromToes.dot(fromShoulders), -1, 1)) * 180) / Math.PI
      : null;

  if (fromToes) return { forward: fromToes, from: 'toes', disagreementDeg };
  if (fromShoulders) return { forward: fromShoulders, from: 'shoulders', disagreementDeg };
  // Nothing measurable: assume the GLTF convention rather than inventing one.
  return { forward: new THREE.Vector3(0, 0, -1), from: 'default', disagreementDeg: null };
}

/**
 * The rotation about Y that turns a model facing `forward` to face NORTH,
 * which is what the rest of the code assumes when it applies a heading.
 *
 * Scene axes are X east, Y up, Z south, so north is -Z. A node rotated by yaw
 * psi faces compass bearing -psi in degrees (see bearingToYaw); the model's
 * art already faces bearing `headingOf(forward)`, so cancelling it is that
 * bearing expressed in radians.
 */
export function yawToFaceNorth(forward: THREE.Vector3): number {
  return (headingOf(forward.x, forward.z) * Math.PI) / 180;
}

// Hand-built landmarks, dropped over the generated city.
//
// THIS IS THE POINT OF THE WHOLE PROJECT, and it is worth saying plainly: a
// procedural Portland is not trying to be the final art. It is a SCAFFOLD --
// every street, every kerb and every roofline in the right place at the right
// height -- so that one thing at a time can be built properly by hand and
// dropped in, with the rest of the city already standing around it.
//
// An override is two halves and both are necessary:
//
//   a MODEL   -- a .glb placed at a world position, and
//   a CLEAR BOX -- a region the generator agrees to leave alone.
//
// Without the box, the hand-built Burnside Bridge renders inside the generated
// one. With it, the generated bridge, its buildings and its street furniture
// simply are not built there -- in the COLLIDER as well as in the picture,
// which is the half that is easy to forget and reads as walking into thin air.
//
// The bake writes a `clear` box for every named bridge already, so the smallest
// possible override is a model path and an id:
//
//   "overrides": { "Burnside Bridge": { "model": "models/burnside.glb" } }
//
// `keep` lets a layer survive inside the box -- `["road"]` for a model that is
// only the superstructure and still wants the generated deck to walk on.

import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

export class Overrides {
  constructor(data) {
    this.landmarks = (data && data.landmarks) || [];
    this.byId = new Map();
    this.byName = new Map();
    for (const L of this.landmarks) {
      this.byId.set(L.id, L);
      if (!this.byName.has(L.name)) this.byName.set(L.name, L);
    }
    this.list = [];
    for (const [key, o] of Object.entries((data && data.overrides) || {})) {
      const L = this.byId.get(key) || this.byName.get(key);
      if (!L && !(o.clear && o.model)) {
        if (window.__crash) window.__crash(`override "${key}": no such landmark`);
        continue;
      }
      const clear = o.clear || (L && L.clear) ||
        (L ? { x0: L.x - 30, z0: L.z - 30, x1: L.x + 30, z1: L.z + 30,
               y0: L.y - 8, y1: L.y + (L.height || 20) + 8 } : null);
      this.list.push({
        key, model: o.model,
        x: o.x !== undefined ? o.x : (L ? L.x : 0),
        y: o.y !== undefined ? o.y : (L ? L.y : 0),
        z: o.z !== undefined ? o.z : (L ? L.z : 0),
        yaw: o.yaw || 0, scale: o.scale || 1,
        clear, keep: new Set(o.keep || []),
      });
    }
    this.boxes = this.list.filter((o) => o.clear);
  }

  /** Does this chunk touch any clear box? Most do not, and then nothing happens. */
  touches(ox, oz, size) {
    if (!this.boxes.length) return false;
    return this.boxes.some((o) => o.clear.x0 <= ox + size && o.clear.x1 >= ox &&
                                  o.clear.z0 <= oz + size && o.clear.z1 >= oz);
  }

  hit(layer, x, z, y) {
    for (const o of this.boxes) {
      if (o.keep.has(layer)) continue;
      const c = o.clear;
      if (x < c.x0 || x > c.x1 || z < c.z0 || z > c.z1) continue;
      if (y !== undefined && c.y0 !== undefined && (y < c.y0 || y > c.y1)) continue;
      return true;
    }
    return false;
  }

  /**
   * A chunk with everything inside a clear box removed.
   *
   * The SAME filtered chunk feeds the renderer and the collider. Filtering only
   * the geometry leaves an invisible building standing in the middle of the
   * hand-built bridge, which is the worst kind of bug: nothing on screen
   * disagrees with anything, and the player simply cannot walk there.
   */
  filter(c, ox, oz, size) {
    if (!this.touches(ox, oz, size)) return c;
    const out = { terr: c.terr, area: c.area, bldg: [], road: [], prop: null };
    for (const b of c.bldg) {
      if (!this.hit('building', ox + b.ring[0], oz + b.ring[1], (b.base + b.top) / 2)) out.bldg.push(b);
    }
    for (const r of c.road) {
      const m = (r.np >> 1) * 3;
      if (!this.hit('road', ox + r.pts[m], oz + r.pts[m + 1], r.pts[m + 2])) out.road.push(r);
    }
    if (c.prop) {
      const keep = [];
      for (let i = 0; i < c.prop.n; i++) {
        if (!this.hit('prop', ox + c.prop.pos[i*3], oz + c.prop.pos[i*3+1], c.prop.pos[i*3+2]))
          keep.push(i);
      }
      const n = keep.length;
      const p = { n, kind: new Uint8Array(n), tint: new Uint8Array(n),
                  yaw: new Float32Array(n), scale: new Float32Array(n),
                  pos: new Float32Array(n * 3) };
      keep.forEach((src, d) => {
        p.kind[d] = c.prop.kind[src]; p.tint[d] = c.prop.tint[src];
        p.yaw[d] = c.prop.yaw[src]; p.scale[d] = c.prop.scale[src];
        p.pos[d*3] = c.prop.pos[src*3]; p.pos[d*3+1] = c.prop.pos[src*3+1];
        p.pos[d*3+2] = c.prop.pos[src*3+2];
      });
      out.prop = p;
    }
    return out;
  }

  /** Load and place every override model. Failures are reported, never fatal. */
  async load(scene, base) {
    const loader = new GLTFLoader();
    const group = new THREE.Group();
    scene.add(group);
    this.group = group;
    let ok = 0;
    for (const o of this.list) {
      if (!o.model) continue;
      try {
        const url = new URL(o.model, base).href;
        const gltf = await new Promise((res, rej) => loader.load(url, res, null, rej));
        const m = gltf.scene;
        m.position.set(o.x, o.y, o.z);
        m.rotation.y = o.yaw;
        m.scale.setScalar(o.scale);
        m.traverse((n) => { if (n.isMesh) n.frustumCulled = false; });
        group.add(m);
        o.object = m;
        ok++;
      } catch (e) {
        // A hand-built landmark that did not arrive must not take the city with
        // it -- and it must SAY so, because a cleared box with nothing in it is
        // a hole, and a hole is indistinguishable from a bug in the generator.
        if (window.__crash) window.__crash(`override "${o.key}" (${o.model}): ${e.message || e}`);
      }
    }
    return ok;
  }
}

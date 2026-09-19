// Shopfronts: an awning, a sign board, and -- for the ones close enough to
// read -- the REAL NAME of the business that is actually there.
//
// This is the single biggest thing between a block of boxes and a street. A
// corner with Powell's on it is a different corner from an identical corner
// with nothing on it, and the names are the one part no generator can invent.
// Overture's places theme has 16,900 of them over this city; 4,833 are snapped
// to the wall they occupy at bake time.
//
// THE TEXT IS A SHARED ATLAS AND NOT A TEXTURE PER SIGN. A canvas texture per
// business is 4,833 textures and a draw call each. One 1024-px canvas holds 48
// names at a size you can read from across the street, every visible sign is a
// quad into it, and the whole lot is ONE draw call. The set is rebuilt only
// when the nearest 48 actually change -- which, walking, is every second or so.

import * as THREE from 'three';
import { Soup } from './build.js';
import { SHOP, SHOP_DEFAULT, SIGN } from './tune.js';

const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mul = (c, k) => [Math.min(255, c[0]*k)|0, Math.min(255, c[1]*k)|0, Math.min(255, c[2]*k)|0];

/**
 * The fixed part: a board and an awning on every shopfront in the chunk.
 *
 * Merged into the chunk's own geometry, so a storefront costs no draw call of
 * its own and a street of forty of them costs none either.
 */
export function buildShops(list, classNames) {
  const s = new Soup(Math.max(64, list.length * 12));
  for (const sh of list) {
    const look = SHOP[classNames[sh.cat]] || SHOP_DEFAULT;
    const c = rgb(look.c);
    // The bake stores the facade's OUTWARD bearing; forward is (sin, -cos) of
    // it and the board runs along the wall, which is that turned a quarter.
    const fx = Math.sin(sh.yaw), fz = -Math.cos(sh.yaw);
    const rx = -fz, rz = fx;
    const hw = sh.w * 0.5, y = sh.y + sh.h;
    const P = (a, b, up) => [sh.x + rx*a + fx*b, y + up, sh.z + rz*a + fz*b];

    // The board. Proud of the wall by a few centimetres so it never z-fights
    // with the facade it is bolted to.
    const d = 0.07, bh = SIGN.boardH * 0.5;
    const A = P(-hw, 0, -bh), B = P(hw, 0, -bh), C = P(hw, 0, bh), D = P(-hw, 0, bh);
    const A2 = P(-hw, d, -bh), B2 = P(hw, d, -bh), C2 = P(hw, d, bh), D2 = P(-hw, d, bh);
    const face = mul(c, 1.0), edge = mul(c, 0.7);
    s.quad(A2, B2, C2, D2, face, face, face, face);      // the face, outward
    s.quad(A, A2, D2, D, edge, edge, edge, edge);
    s.quad(B, C, C2, B2, edge, edge, edge, edge);
    s.quad(D2, C2, C, D, edge, edge, edge, edge);
    s.quad(A, B, B2, A2, edge, edge, edge, edge);

    if (sh.flags & 1) {
      // An awning: out and DOWN from above the board. It is the thing that reads
      // as a shopfront from fifty metres, before any sign is legible.
      const out = SIGN.awning, top = sh.h + bh + 0.10, lip = top - SIGN.awningDrop;
      const t = (a, b, up) => [sh.x + rx*a + fx*b, sh.y + up, sh.z + rz*a + fz*b];
      const aw = hw + 0.15;
      const U0 = t(-aw, 0.02, top), U1 = t(aw, 0.02, top);
      const L0 = t(-aw, out, lip), L1 = t(aw, out, lip);
      const stripe = mul(c, 1.18), shade = mul(c, 0.62);
      s.quad(U0, U1, L1, L0, stripe, stripe, face, face);           // the canopy
      s.quad(L0, L1, t(aw, out, lip - SIGN.valance), t(-aw, out, lip - SIGN.valance),
             shade, shade, shade, shade);                            // the valance
      s.triC(U0[0], U0[1], U0[2], L0[0], L0[1], L0[2],
             t(-aw, 0.02, lip)[0], t(-aw, 0.02, lip)[1], t(-aw, 0.02, lip)[2],
             shade, shade, shade);
      s.triC(L1[0], L1[1], L1[2], U1[0], U1[1], U1[2],
             t(aw, 0.02, lip)[0], t(aw, 0.02, lip)[1], t(aw, 0.02, lip)[2],
             shade, shade, shade);
    }
  }
  return s.done();
}

/**
 * The readable part. One canvas, one material, one mesh, one draw call.
 */
export class SignText {
  constructor(scene) {
    const S = SIGN.atlas;
    this.cols = SIGN.cols;
    this.rows = SIGN.rows;
    this.slots = this.cols * this.rows;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = S;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.slots * 6 * 3);
    this.uv = new Float32Array(this.slots * 6 * 2);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, depthWrite: false, toneMapped: false,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this.key = '';
    this.t = 0;
  }

  /** Nearest `slots` shops within range, redrawn only when the SET changes. */
  update(dt, px, pz, live, classNames) {
    this.t += dt;
    if (this.t < SIGN.every) return;
    this.t = 0;
    const near = [];
    const r2 = SIGN.range * SIGN.range;
    for (const rec of live) {
      const { shops, ox, oz } = rec;
      if (!shops || !shops.length) continue;
      for (const sh of shops) {
        const x = ox + sh.x, z = oz + sh.z;
        const d = (x - px) ** 2 + (z - pz) ** 2;
        if (d < r2 && sh.name) near.push({ d, sh, x, z });
      }
    }
    near.sort((a, b) => a.d - b.d);
    near.length = Math.min(near.length, this.slots);
    const key = near.map((n) => n.sh.name).join('|');
    if (key === this.key) return;
    this.key = key;
    this.draw(near, classNames);
  }

  draw(near, classNames) {
    const S = SIGN.atlas, cw = S / this.cols, ch = S / this.rows;
    const g = this.ctx;
    g.clearRect(0, 0, S, S);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < near.length; i++) {
      const col = i % this.cols, row = (i / this.cols) | 0;
      const look = SHOP[classNames[near[i].sh.cat]] || SHOP_DEFAULT;
      // Ink chosen against the board it sits on, not a fixed white: a cream
      // awning with white lettering is a blank awning.
      g.fillStyle = look.ink;
      let size = Math.round(ch * 0.46);
      const name = near[i].sh.name;
      g.font = `700 ${size}px 'Barlow Condensed','Arial Narrow',system-ui,sans-serif`;
      while (g.measureText(name).width > cw * 0.92 && size > 10) {
        size -= 2;
        g.font = `700 ${size}px 'Barlow Condensed','Arial Narrow',system-ui,sans-serif`;
      }
      g.fillText(name, col * cw + cw / 2, row * ch + ch / 2);
    }
    this.tex.needsUpdate = true;

    let v = 0, u = 0;
    for (let i = 0; i < near.length; i++) {
      const { sh, x, z } = near[i];
      const fx = Math.sin(sh.yaw), fz = -Math.cos(sh.yaw);
      const rx = -fz, rz = fx;
      const hw = sh.w * 0.5 * 0.94, bh = SIGN.boardH * 0.5 * 0.82;
      const y = sh.y + sh.h, d = 0.10;
      const P = (a, up) => [x + rx*a + fx*d, y + up, z + rz*a + fz*d];
      const A = P(-hw, -bh), B = P(hw, -bh), C = P(hw, bh), D = P(-hw, bh);
      const col = i % this.cols, row = (i / this.cols) | 0;
      // U RUNS BACKWARDS ALONG THE BOARD, and that is not a typo.
      // `(rx, rz) = (-fz, fx)` is the board's own right-hand vector, but a
      // reader STANDS IN FRONT of the sign looking back along -f, and their
      // right is the other way: facing south with up +Y, right is west. Mapped
      // straight across, every shop name in Portland read backwards.
      const u1 = col / this.cols, u0 = (col + 1) / this.cols;
      const t0 = 1 - (row + 1) / this.rows, t1 = 1 - row / this.rows;
      const push = (p, uu, vv) => {
        this.pos[v++] = p[0]; this.pos[v++] = p[1]; this.pos[v++] = p[2];
        this.uv[u++] = uu; this.uv[u++] = vv;
      };
      push(A, u0, t0); push(B, u1, t0); push(C, u1, t1);
      push(A, u0, t0); push(C, u1, t1); push(D, u0, t1);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.geo.setDrawRange(0, near.length * 6);
  }
}

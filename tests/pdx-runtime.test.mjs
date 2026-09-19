// The runtime, driven headlessly against the real baked city.
//
// These are the checks that would pass on a city rendered INSIDE OUT, on a
// collider that pushes the wrong way, and on a bridge you fall through -- if
// they only counted triangles. Each one pins a direction or a consequence.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseChunk } from '../public/pdx/game/chunk.js';
import * as THREE from 'three';
import { buildTerrain, buildBuildings, buildRoads, buildAreas, Soup } from '../public/pdx/game/build.js';
import { Crowd, Pavements, figure } from '../public/pdx/game/crowd.js';
import { buildShops } from '../public/pdx/game/shops.js';
import { Ambient, car, boat, plane, heli, prism, closed } from '../public/pdx/game/ambient.js';
import { buildProps } from '../public/pdx/game/props.js';
import { Ground } from '../public/pdx/game/ground.js';
import { Overrides } from '../public/pdx/game/overrides.js';
import { Player } from '../public/pdx/game/player.js';
import { MOVE, AIR } from '../public/pdx/game/tune.js';

const DATA = path.resolve('public/pdx/data');
const M = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
const LM = JSON.parse(fs.readFileSync(path.join(DATA, 'landmarks.json'), 'utf8'));
const W = M.world;
const NAMES = M.classes;
const read = (i, j) => {
  const b = fs.readFileSync(path.join(DATA, `c${i}_${j}.bin`));
  return parseChunk(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const chunkOf = (x, z) => [Math.floor((x - W.west) / W.chunk), Math.floor((z - W.north) / W.chunk)];

/** Point in a building's footprint, in chunk-local metres. */
function inRing(b, x, z) {
  let inside = false;
  for (let i = 0, j = b.nv - 1; i < b.nv; j = i++) {
    const xi = b.ring[i*2], zi = b.ring[i*2+1], xj = b.ring[j*2], zj = b.ring[j*2+1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

describe('geometry faces the right way', () => {
  const c = read(4, 4);

  it('terrain normals point UP, every triangle', () => {
    const g = buildTerrain(c.terr, W.chunk);
    expect(g.tris).toBeGreaterThan(1000);
    for (let t = 0; t < g.tris; t++) {
      expect(g.normal[t * 9 + 1], 'a terrain triangle wound the other way').toBeGreaterThan(0.2);
    }
  });

  it('building WALLS face out of the building, not into it', () => {
    // The whole city renders as a hole if this is backwards, and nothing about
    // the file size, the triangle count or the footprint would change.
    //
    // Tested LOCALLY -- step off the face along its own normal and you must be
    // outside the footprint. The obvious version compares the normal with the
    // direction to the CENTROID, and that is wrong on any concave plan: the
    // inner face of an L-shaped block correctly points back toward its own
    // centroid, so 7% of downtown failed a check that was itself the bug.
    let walls = 0;
    for (const b of c.bldg) {
      const g = buildBuildings([b], NAMES.building, 'full');
      for (let t = 0; t < g.tris; t++) {
        const n = [g.normal[t*9], g.normal[t*9+1], g.normal[t*9+2]];
        if (Math.abs(n[1]) > 0.25) continue;               // a roof or a parapet top
        const mx = (g.position[t*9] + g.position[t*9+3] + g.position[t*9+6]) / 3;
        const mz = (g.position[t*9+2] + g.position[t*9+5] + g.position[t*9+8]) / 3;
        expect(inRing(b, mx + n[0] * 0.35, mz + n[2] * 0.35),
               'stepping out along a wall normal lands you inside the building')
          .toBe(false);
        walls++;
      }
    }
    expect(walls).toBeGreaterThan(200);
  });

  it('flat roofs cap UPWARD', () => {
    const flat = c.bldg.filter((b) => !b.roof);
    expect(flat.length).toBeGreaterThan(0);
    for (const b of flat) {
      const g = buildBuildings([b], NAMES.building, 'mid');   // mid = no parapet
      let up = 0;
      for (let t = 0; t < g.tris; t++) if (g.normal[t*9+1] > 0.9) up++;
      expect(up, 'a flat roof with no upward face').toBeGreaterThan(0);
    }
  });

  it('road ribbons are the width the data says, measured PER SEGMENT', () => {
    // Per segment, not end to end: a curved street's start-to-end direction is
    // not the direction of anything, and measuring across it reports a 9 m
    // street as 50 m wide -- which is what the first version of this check did,
    // and it was the check that was wrong.
    for (const r of c.road.slice(0, 60)) {
      if (r.np < 2) continue;
      const g = buildRoads([r], NAMES.road, 'full');
      if (!g.tris) continue;
      for (let k = 0; k < r.np - 1; k++) {
        const ax = r.pts[k*3], az = r.pts[k*3+1];
        const dx = r.pts[(k+1)*3] - ax, dz = r.pts[(k+1)*3+1] - az;
        const L = Math.hypot(dx, dz);
        if (L < 3) continue;
        // Only where the run is STRAIGHT. A mitre legitimately widens a bend,
        // so a bend can only ever produce a soft bound; on a straight the
        // ribbon must be the declared width and the check can be tight.
        const bend = (m) => {
          if (m < 1 || m > r.np - 2) return 0;
          const ax2 = r.pts[m*3] - r.pts[(m-1)*3], az2 = r.pts[m*3+1] - r.pts[(m-1)*3+1];
          const bx2 = r.pts[(m+1)*3] - r.pts[m*3], bz2 = r.pts[(m+1)*3+1] - r.pts[m*3+1];
          const la = Math.hypot(ax2, az2) || 1, lb = Math.hypot(bx2, bz2) || 1;
          return Math.acos(Math.max(-1, Math.min(1, (ax2*bx2 + az2*bz2) / (la*lb))));
        };
        if (bend(k) > 0.25 || bend(k + 1) > 0.25) continue;
        const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
        let lo = 1e9, hi = -1e9, seen = 0;
        for (let v = 0; v < g.tris * 3; v++) {
          const px = g.position[v*3] - ax, pz = g.position[v*3+2] - az;
          const along = px * ux + pz * uz;
          if (along < L * 0.3 || along > L * 0.7) continue;   // mid-segment only
          const across = px * nx + pz * nz;
          lo = Math.min(lo, across); hi = Math.max(hi, across); seen++;
        }
        if (seen < 4) continue;
        expect(hi - lo, `${NAMES.road[r.cls]} ribbon on a straight`).toBeGreaterThan(r.w * 0.95);
        expect(hi - lo, `${NAMES.road[r.cls]} ribbon on a straight`).toBeLessThan(r.w * 1.15 + 0.3);
      }
    }
  });

  // THE DIVERGENCE THEOREM IS THE ONLY CHECK THAT CATCHES AN INSIDE-OUT PROP.
  // A back-faced lamp post still renders -- the near side is culled and you see
  // its far side, which for a thin cylinder is the same silhouette -- so what it
  // costs is the LIGHTING, and nothing about the count, the bounds or the
  // picture says so. For a closed surface with outward normals the integral of
  // n . x over the surface is +3V; inside out it is -3V. Three of the four
  // primitives in props.js shipped backwards and this is what found them.
  it('every prop kind encloses a POSITIVE volume', () => {
    const one = (kind) => buildProps(
      { n: 1, kind: new Uint8Array([kind]), yaw: new Float32Array([0.4]),
        scale: new Float32Array([1]), tint: new Uint8Array([0]),
        pos: new Float32Array([0, 0, 0]) }, NAMES.prop, 'full');
    let tested = 0;
    for (let k = 0; k < NAMES.prop.length; k++) {
      const g = one(k);
      if (!g.tris) continue;
      let v = 0;
      for (let t = 0; t < g.tris; t++) {
        const i = t * 9, P = g.position;
        v += (P[i]   * (P[i+4]*P[i+8] - P[i+5]*P[i+7])
            + P[i+1] * (P[i+5]*P[i+6] - P[i+3]*P[i+8])
            + P[i+2] * (P[i+3]*P[i+7] - P[i+4]*P[i+6])) / 6;
      }
      expect(v, `${NAMES.prop[k]} is inside out`).toBeGreaterThan(0);
      tested++;
    }
    expect(tested).toBeGreaterThan(15);
  });

  it('props stand ON the ground, never under it', () => {
    const g = buildProps(c.prop, NAMES.prop, 'full');
    expect(g.tris).toBeGreaterThan(200);
    let lowest = 1e9;
    for (let v = 0; v < g.tris * 3; v++) lowest = Math.min(lowest, g.position[v*3+1]);
    let propFloor = 1e9;
    for (let i = 0; i < c.prop.n; i++) propFloor = Math.min(propFloor, c.prop.pos[i*3+2]);
    expect(lowest).toBeGreaterThan(propFloor - 0.2);
  });

  it('water is one flat surface at the declared level', () => {
    const [ci, cj] = chunkOf(0, 200);                 // mid-river below Burnside
    const w = read(ci, cj);
    const g = buildAreas(w.area, NAMES.area, true);
    if (!g.tris) return;
    for (let v = 0; v < g.tris * 3; v++)
      expect(Math.abs(g.position[v*3+1] - W.waterLevel)).toBeLessThan(0.11);
  });
});

describe('the ground knows about bridges', () => {
  // A heightmap has ONE answer per (x, z). The Willamette bridges need two --
  // the deck and the river under it -- and that is the whole reason groundAt
  // takes a hint.
  const burnside = LM.landmarks.find((l) => l.name === 'Burnside Bridge');
  const g = new Ground(M);
  for (let j = 0; j < W.n; j++) for (let i = 0; i < W.n; i++) g.addChunk(i, j, read(i, j), NAMES);

  it('reads the river bed under the bridge and the deck on top of it', () => {
    // Walk the span and find a point that has both.
    let found = null;
    for (let t = 0.2; t <= 0.8 && !found; t += 0.02) {
      const x = burnside.clear.x0 + (burnside.clear.x1 - burnside.clear.x0) * t;
      for (let u = 0.2; u <= 0.8; u += 0.02) {
        const z = burnside.clear.z0 + (burnside.clear.z1 - burnside.clear.z0) * u;
        const low = g.groundAt(x, z, 1.0);
        const high = g.groundAt(x, z, 14.0);
        if (g.terrainAt(x, z) < W.waterLevel && high > low + 5) { found = { x, z, low, high }; break; }
      }
    }
    expect(found, 'nowhere on the Burnside Bridge has a deck above water').toBeTruthy();
    expect(found.low).toBeLessThan(W.waterLevel + 0.5);
    expect(found.high).toBeGreaterThan(W.waterLevel + 4);
    // Standing under it, the ground is the river -- not the deck.
    expect(g.groundAt(found.x, found.z, 2.0)).toBe(found.low);
  });

  it('calls the middle of the Willamette water and the bank dry', () => {
    // The anchor is the WEST END of the Burnside Bridge, so x = 0 is the west
    // bank and not the river. Taking the middle of the bridge's own box is the
    // only way to name mid-stream without typing a coordinate.
    const mx = (burnside.clear.x0 + burnside.clear.x1) / 2;
    const mz = (burnside.clear.z0 + burnside.clear.z1) / 2;
    expect(g.inWater(mx, mz), 'mid-span is not over water').toBe(true);
    const wells = LM.landmarks.find((l) => l.name === 'Wells Fargo Center');
    expect(g.inWater(wells.x, wells.z)).toBe(false);
  });

  it('terrain agrees with the reference points it was baked from', () => {
    // Pioneer Courthouse Square sits about 50 ft up; the river is about 3 m.
    const [px] = [(-122.6790 - M.anchor.lon) * M.anchor.metresPerDegLon];
    const pz = -(45.5189 - M.anchor.lat) * M.anchor.metresPerDegLat;
    expect(g.terrainAt(px, pz)).toBeGreaterThan(8);
    expect(g.terrainAt(px, pz)).toBeLessThan(30);
  });
});

describe('the collider', () => {
  const g = new Ground(M);
  const [ci, cj] = chunkOf(-700, 450);                 // downtown blocks
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++)
    g.addChunk(ci + di, cj + dj, read(ci + di, cj + dj), NAMES);
  const c = read(ci, cj);
  const ox = W.west + ci * W.chunk, oz = W.north + cj * W.chunk;

  it('pushes a body OUT of a building, and out far enough to clear it', () => {
    const b = c.bldg.find((x) => x.nv >= 4 && x.top - x.base > 6);
    let cx = 0, cz = 0;
    for (let k = 0; k < b.nv; k++) { cx += b.ring[k*2] + ox; cz += b.ring[k*2+1] + oz; }
    cx /= b.nv; cz /= b.nv;
    const y = (b.base + b.top) / 2;
    const r = g.resolve(cx, cz, b.base + 1, MOVE.radius);
    expect(r[2], 'standing in the middle of a building is not a collision').toBe(true);
    expect(Math.hypot(r[0] - cx, r[1] - cz)).toBeGreaterThan(0.5);
    // And once pushed out, it stays out: a resolver that oscillates is worse
    // than one that does nothing.
    const again = g.resolve(r[0], r[1], b.base + 1, MOVE.radius);
    expect(Math.hypot(again[0] - r[0], again[1] - r[1])).toBeLessThan(0.05);
  });

  it('leaves a body ABOVE a building alone', () => {
    const b = c.bldg.find((x) => x.top - x.base > 6);
    const r = g.resolve(b.ring[0] + ox, b.ring[1] + oz, b.top + 20, MOVE.radius);
    expect(r[2]).toBe(false);
  });
});

describe('locomotion', () => {
  const g = new Ground(M);
  const [ci, cj] = chunkOf(M.spawn.x, M.spawn.z);
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++)
    g.addChunk(ci + di, cj + dj, read(ci + di, cj + dj), NAMES);

  const step = (p, move, camAz, n = 120, dt = 1 / 60) => {
    for (let k = 0; k < n; k++) p.step(dt, g, move, camAz, false);
  };

  it('walks AWAY from the camera when the thumb goes up', () => {
    // The check that every twin-stick in this account has got backwards at
    // least once. Camera-relative is the whole rule: "up" means away from the
    // lens, not north.
    for (const az of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const p = new Player(M.spawn);
      const x0 = p.x, z0 = p.z;
      step(p, { x: 0, y: -1, mag: 1, run: false }, az);
      const dx = p.x - x0, dz = p.z - z0;
      const fx = Math.sin(az), fz = -Math.cos(az);
      const along = dx * fx + dz * fz;
      expect(Math.hypot(dx, dz), `az ${az}: he did not move`).toBeGreaterThan(1);
      expect(along, `az ${az}: he walked toward the camera`).toBeGreaterThan(0.8 * Math.hypot(dx, dz));
    }
  });

  it('turns right when the thumb goes right', () => {
    const p = new Player(M.spawn);
    const x0 = p.x, z0 = p.z;
    step(p, { x: 1, y: 0, mag: 1, run: false }, 0);   // camera looking north
    // Camera bearing 0 looks north; its right is world +X (east).
    expect(p.x - x0).toBeGreaterThan(1);
    expect(Math.abs(p.z - z0)).toBeLessThan(Math.abs(p.x - x0));
  });

  it('stays on the ground it is standing on', () => {
    const p = new Player(M.spawn);
    step(p, { x: 0, y: 0, mag: 0, run: false }, 0, 240);
    expect(p.grounded).toBe(true);
    expect(Math.abs(p.y - g.groundAt(p.x, p.z, p.y + 1))).toBeLessThan(0.1);
  });

  it('cannot walk through a building', () => {
    // Aim him at the nearest tall footprint and hold the stick down for four
    // seconds. "He slowed down" is not the test; "he is not inside it" is.
    const [bi, bj] = chunkOf(M.spawn.x, M.spawn.z);
    const c = read(bi, bj);
    const ox = W.west + bi * W.chunk, oz = W.north + bj * W.chunk;
    const b = c.bldg.slice().sort((a, x) => (x.top - x.base) - (a.top - a.base))[0];
    let cx = 0, cz = 0;
    for (let k = 0; k < b.nv; k++) { cx += b.ring[k*2] + ox; cz += b.ring[k*2+1] + oz; }
    cx /= b.nv; cz /= b.nv;
    const p = new Player(M.spawn);
    const az = Math.atan2(cx - p.x, -(cz - p.z));
    step(p, { x: 0, y: -1, mag: 1, run: true }, az, 60 * 6);
    const r = g.resolve(p.x, p.z, p.y, MOVE.radius * 0.9);
    expect(r[2], 'he ended up inside a building').toBe(false);
  });
});

describe('landmark overrides', () => {
  const burnside = LM.landmarks.find((l) => l.name === 'Burnside Bridge');

  it('clear a region from BOTH the picture and the collider', () => {
    // Filtering only the geometry leaves an invisible building standing inside
    // the hand-built model, which is the worst kind of bug: nothing on screen
    // disagrees with anything and the player simply cannot walk there.
    const ov = new Overrides({
      landmarks: LM.landmarks,
      overrides: { 'Burnside Bridge': { model: 'models/nothing.glb' } },
    });
    const [ci, cj] = chunkOf(burnside.x, burnside.z);
    const raw = read(ci, cj);
    const ox = W.west + ci * W.chunk, oz = W.north + cj * W.chunk;
    const cut = ov.filter(raw, ox, oz, W.chunk);
    expect(cut).not.toBe(raw);
    const before = raw.road.filter((r) => r.flags & 1).length;
    const after = cut.road.filter((r) => r.flags & 1).length;
    expect(before).toBeGreaterThan(0);
    expect(after, 'the generated bridge survived its own override').toBeLessThan(before);

    const g = new Ground(M);
    g.addChunk(ci, cj, cut, NAMES);
    // Inside the box, the only ground left is the river.
    const mx = (burnside.clear.x0 + burnside.clear.x1) / 2;
    const mz = (burnside.clear.z0 + burnside.clear.z1) / 2;
    if (g.terrainAt(mx, mz) < W.waterLevel)
      expect(g.groundAt(mx, mz, 14)).toBeLessThan(W.waterLevel + 1);
  });

  it('are a no-op on a chunk they do not touch', () => {
    const ov = new Overrides({
      landmarks: LM.landmarks,
      overrides: { 'Burnside Bridge': { model: 'models/nothing.glb' } },
    });
    const raw = read(0, 0);
    expect(ov.filter(raw, W.west, W.north, W.chunk)).toBe(raw);
  });

  it('keep a layer when asked to', () => {
    const ov = new Overrides({
      landmarks: LM.landmarks,
      overrides: { 'Burnside Bridge': { model: 'x.glb', keep: ['road'] } },
    });
    const [ci, cj] = chunkOf(burnside.x, burnside.z);
    const raw = read(ci, cj);
    const cut = ov.filter(raw, W.west + ci * W.chunk, W.north + cj * W.chunk, W.chunk);
    expect(cut.road.length).toBe(raw.road.length);
    expect(cut.bldg.length).toBeLessThanOrEqual(raw.bldg.length);
  });
});

describe('the crowd', () => {
  // A crowd that walks through walls and down the middle of Burnside is worse
  // than no crowd, so these check WHERE they are, not that they exist.
  const g = new Ground(M);
  const live = [];
  const [ci, cj] = chunkOf(M.spawn.x, M.spawn.z);
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const i = ci + di, j = cj + dj;
    const raw = read(i, j);
    g.addChunk(i, j, raw, NAMES);
    live.push({ raw, ox: W.west + i * W.chunk, oz: W.north + j * W.chunk });
  }

  it('finds a pavement network in the real city', () => {
    const p = new Pavements();
    const n = p.rebuild(live, NAMES.road);
    expect(n, 'no pavement anywhere near the spawn').toBeGreaterThan(200);
    // Every segment must be walkable-length and have a real direction.
    for (const s of p.seg) {
      expect(s.L).toBeGreaterThan(1);
      expect(Number.isFinite(s.ay) && Number.isFinite(s.by)).toBe(true);
    }
  });

  it('walks people along it, and keeps them ON it', () => {
    const crowd = new Crowd({ add() {} }, THREE);
    const moved = new Map();
    for (let k = 0; k < 400; k++) {
      crowd.step(1 / 30, M.spawn.x, M.spawn.z, live, NAMES.road);
      for (const p of crowd.people) if (p.live) {
        const was = moved.get(p);
        if (was) moved.set(p, was + Math.hypot(p.x - was.x, p.z - was.z) || was);
        else moved.set(p, { x: p.x, z: p.z, d: 0 });
      }
    }
    const walking = crowd.people.filter((p) => p.live);
    expect(walking.length, 'nobody spawned').toBeGreaterThan(8);

    const pav = crowd.pav;
    let onPath = 0;
    for (const p of walking) {
      // Nearest point on any pavement segment. Anyone further off than half a
      // pavement plus a body is not on the pavement.
      let best = 1e9;
      for (const s of pav.seg) {
        const ex = s.bx - s.ax, ez = s.bz - s.az;
        const L2 = ex * ex + ez * ez || 1;
        let t = ((p.x - s.ax) * ex + (p.z - s.az) * ez) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        best = Math.min(best, Math.hypot(p.x - (s.ax + ex * t), p.z - (s.az + ez * t)));
      }
      if (best < 1.2) onPath++;
    }
    expect(onPath, `${walking.length - onPath} of ${walking.length} walked off the pavement`)
      .toBe(walking.length);
  });

  it('does not put anybody inside a building', () => {
    const crowd = new Crowd({ add() {} }, THREE);
    for (let k = 0; k < 300; k++) crowd.step(1 / 30, M.spawn.x, M.spawn.z, live, NAMES.road);
    let inside = 0;
    for (const p of crowd.people) {
      if (!p.live) continue;
      if (g.resolve(p.x, p.z, p.y + 0.9, 0.05)[2]) inside++;
    }
    // Not zero: OSM footways legitimately run through arcades and under
    // overhangs, and a building footprint is its outline at the ground. A
    // handful is the data; a quarter of the crowd would be the walker.
    expect(inside / Math.max(1, crowd.people.filter((p) => p.live).length))
      .toBeLessThan(0.15);
  });

  it('gives every walker a body that is the right way out and the right size', () => {
    const crowd = new Crowd({ add() {} }, THREE);
    for (let seed = 1; seed <= 40; seed++) {
      const p = crowd.spawn(seed, seed);
      p.live = true; p.x = 0; p.y = 0; p.z = 0; p.yaw = 0.3; p.phase = seed * 0.7;
      const s = new Soup(64);
      figure(s, p, 5);
      const gg = s.done();
      let v = 0, lo = 1e9, hi = -1e9, wlo = 1e9, whi = -1e9;
      for (let t = 0; t < gg.tris; t++) {
        const i = t * 9, P = gg.position;
        v += (P[i]   * (P[i+4]*P[i+8] - P[i+5]*P[i+7])
            + P[i+1] * (P[i+5]*P[i+6] - P[i+3]*P[i+8])
            + P[i+2] * (P[i+3]*P[i+7] - P[i+4]*P[i+6])) / 6;
        for (let k = 0; k < 9; k += 3) {
          lo = Math.min(lo, P[i+k+1]); hi = Math.max(hi, P[i+k+1]);
          wlo = Math.min(wlo, P[i+k]); whi = Math.max(whi, P[i+k]);
        }
      }
      expect(v, `walker ${seed} is inside out`).toBeGreaterThan(0);
      expect(lo, `walker ${seed} has a foot under the pavement`).toBeGreaterThan(-0.05);
      expect(hi, `walker ${seed} is ${hi.toFixed(2)} m tall`).toBeLessThan(2.4);
      expect(hi).toBeGreaterThan(1.4);
      // A person is about 0.5 m across, and an umbrella or a dog widens the
      // record rather than the body. Two metres means the proportions are gone.
      expect(whi - wlo, `walker ${seed} is ${(whi-wlo).toFixed(2)} m wide`).toBeLessThan(2.0);
    }
  });

  it('is deterministic: the same seat is the same person', () => {
    const a = new Crowd({ add() {} }, THREE);
    const b = new Crowd({ add() {} }, THREE);
    for (let i = 0; i < 12; i++) {
      const x = a.spawn(i, i + 1), y = b.spawn(i, i + 1);
      expect(x.height).toBe(y.height);
      expect(x.top).toEqual(y.top);
      expect(x.speed).toBe(y.speed);
    }
  });
});

describe('shopfronts', () => {
  it('sit on a wall, facing out of it', () => {
    // A sign whose outward normal points INTO the building is a sign on the
    // inside of the shop, and from the street it is simply not there.
    let checked = 0;
    const wrong = [];
    for (let j = 0; j < W.n; j += 2) for (let i = 0; i < W.n; i += 2) {
      const c = read(i, j);
      if (!c.shop.length) continue;
      for (const sh of c.shop) {
        const fx = Math.sin(sh.yaw), fz = -Math.cos(sh.yaw);
        // Step a metre and a half out along the facing; that must leave the
        // building, and stepping back in must enter one.
        const out = nearestBuilding(c, sh.x + fx * 1.4, sh.z + fz * 1.4);
        const inn = nearestBuilding(c, sh.x - fx * 0.9, sh.z - fz * 0.9);
        if (!inn) continue;
        checked++;
        if (out) wrong.push(sh.name);
      }
    }
    expect(checked, 'no shopfront could be tested against its wall').toBeGreaterThan(500);
    // Not zero, and stated rather than hidden: a hospital campus or a school
    // has courtyards with buildings on every side, and a chunk's footprint list
    // stops at the chunk edge, so a wall facing the next block over reads as
    // facing a building. A few per cent is the city; fourteen was taking the
    // NEAREST wall instead of the one that faces a road.
    expect(wrong.length / checked,
           `${wrong.length}/${checked} face into a building: ${wrong.slice(0, 4).join(', ')}`)
      .toBeLessThan(0.05);
  });

  it('carries real business names', () => {
    const names = new Set();
    for (let j = 0; j < W.n; j++) for (let i = 0; i < W.n; i++)
      for (const sh of read(i, j).shop) names.add(sh.name);
    expect(names.size).toBeGreaterThan(2000);
    for (const n of names) expect(n.length).toBeGreaterThan(0);
  });

  it('builds geometry that faces the street', () => {
    let boards = 0;
    for (let j = 0; j < W.n && boards < 200; j += 3) for (let i = 0; i < W.n; i += 3) {
      const c = read(i, j);
      if (!c.shop.length) continue;
      const gg = buildShops(c.shop.slice(0, 20), NAMES.shop);
      expect(gg.tris).toBeGreaterThan(0);
      boards += gg.tris;
    }
    expect(boards).toBeGreaterThan(100);
  });
});

function nearestBuilding(c, x, z) {
  for (const b of c.bldg) {
    let inside = false;
    for (let i = 0, j = b.nv - 1; i < b.nv; j = i++) {
      const xi = b.ring[i*2], zi = b.ring[i*2+1], xj = b.ring[j*2], zj = b.ring[j*2+1];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

describe('ambient life', () => {
  // A plane, boats and traffic are the cheapest thing in the game and the
  // easiest to get subtly wrong: a car on the wrong side of the road, a boat
  // on dry land, a hull lit from inside. None of those change a triangle
  // count, so every check here pins a POSITION or a DIRECTION.
  const live = [];
  const [ci, cj] = chunkOf(M.spawn.x, M.spawn.z);
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const i = ci + di, j = cj + dj;
    live.push({ raw: read(i, j), ox: W.west + i * W.chunk, oz: W.north + j * W.chunk });
  }
  const stubScene = { add() {} };

  it('the bake found a river, and it runs the length of the city', () => {
    const r = M.routes && M.routes.river;
    expect(r, 'no river route in the manifest -- boats have nowhere to be').toBeTruthy();
    expect(r.length).toBeGreaterThan(40);
    // NORTH TO SOUTH, which is the direction the Willamette runs here, and the
    // check that would fail if river_route() ever picked up the Columbia --
    // four times the area and entirely north of the play area. It did, once.
    expect(r[0][1]).toBeLessThan(W.north + 300);
    expect(r[r.length - 1][1]).toBeGreaterThan(W.south - 300);
    for (const p of r) {
      expect(p[0]).toBeGreaterThan(W.west);
      expect(p[0]).toBeLessThan(W.east);
      expect(p[2], 'a 60 m "river" is a slough').toBeGreaterThan(30);
    }
    // Downtown is WEST of the river and Ladd's Addition is EAST of it. The
    // route has to agree with that or it is not the Willamette.
    const mid = r[(r.length / 2) | 0];
    expect(Math.abs(mid[0]), 'the river should pass near the anchor').toBeLessThan(900);
  });

  it('boats float on the river, not on the land beside it', () => {
    const a = new Ambient(stubScene, THREE, M, { skyline: { x: 0, z: 0 } });
    expect(a.boats.length, 'no boats').toBeGreaterThan(2);
    const R = M.routes.river;
    for (let k = 0; k < 900; k++) a.step(1 / 20, M.spawn.x, 3, M.spawn.z, live, NAMES.road);
    for (const b of a.boats) {
      expect(b.y).toBeCloseTo(W.waterLevel, 3);
      // Nearest point on the centreline, which must be inside the half width
      // the bake measured for that stretch.
      let best = 1e9, hw = 0;
      for (let i = 0; i < R.length - 1; i++) {
        const ax = R[i][0], az = R[i][1], ex = R[i+1][0] - ax, ez = R[i+1][1] - az;
        const L2 = ex * ex + ez * ez || 1;
        let t = ((b.x - ax) * ex + (b.z - az) * ez) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(b.x - (ax + ex * t), b.z - (az + ez * t));
        if (d < best) { best = d; hw = R[i][2]; }
      }
      expect(best, 'a boat left the channel').toBeLessThan(hw);
    }
  });

  it('cars drive on the RIGHT, which is the whole feature', () => {
    // Offset to the wrong side is a head-on collision with every other car on
    // the street, and it reads instantly on a phone and not at all in a count.
    const a = new Ambient(stubScene, THREE, M, { skyline: { x: 0, z: 0 } });
    for (let k = 0; k < 200; k++) a.step(1 / 20, M.spawn.x, 3, M.spawn.z, live, NAMES.road);
    const driving = a.cars.filter((c) => c.live);
    expect(driving.length, 'no traffic anywhere near the spawn').toBeGreaterThan(4);
    const segs = a.lanes.seg;
    for (const c of driving) {
      const s = segs[c.si];
      const ux = (s.bx - s.ax) / s.L * c.dir, uz = (s.bz - s.az) / s.L * c.dir;
      // Which side of the centreline he is on, measured along his own RIGHT.
      // Right of a heading (ux, uz) is (-uz, ux) with +X east and +Z south.
      let t = ((c.x - s.ax) * (s.bx - s.ax) + (c.z - s.az) * (s.bz - s.az)) / (s.L * s.L);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = c.x - (s.ax + (s.bx - s.ax) * t), dz = c.z - (s.az + (s.bz - s.az) * t);
      expect(dx * -uz + dz * ux, 'a car on the wrong side of the road')
        .toBeGreaterThan(0.2);
      // And his yaw has to agree with where he is going, or he drives sideways.
      expect(Math.sin(c.yaw) * ux + -Math.cos(c.yaw) * uz).toBeGreaterThan(0.99);
    }
  });

  it('a car points its NOSE the way it is travelling', () => {
    // A box is symmetric, so nothing about the geometry says which end is
    // front -- except the headlamps, which are the one asymmetry in it. They
    // must be forward of the tail lamps along the direction of travel.
    const s = new Soup(256);
    const c = { x: 0, y: 0, z: 0, yaw: 0.9, len: 4.3, wide: 1.8, tall: 1.44,
                big: false, col: [200, 200, 200] };
    car(s, c);
    const g = s.done();
    const fx = Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    let head = -1e9, tail = 1e9;
    for (let v = 0; v < g.tris * 3; v++) {
      const i = v * 3, along = g.position[i] * fx + g.position[i+2] * fz;
      const r = g.color[i], gr = g.color[i+1], b = g.color[i+2];
      if (r > 240 && gr > 230 && b > 190) head = Math.max(head, along);   // headlamp
      if (r > 150 && r < 190 && gr < 60 && b < 60) tail = Math.min(tail, along);
    }
    expect(head, 'no headlamps on the car').toBeGreaterThan(0);
    expect(head, 'the car is driving backwards').toBeGreaterThan(tail);
  });

  it('every ambient body encloses a POSITIVE volume', () => {
    // The divergence theorem again, for the same reason it is on the props:
    // a hull wound inside out still renders, and what it costs is the
    // lighting. A boat is seen at four hundred metres and a plane from
    // directly underneath, so neither gets to skip a face either.
    const vol = (g) => {
      let v = 0;
      for (let t = 0; t < g.tris; t++) {
        const i = t * 9, P = g.position;
        v += (P[i]   * (P[i+4]*P[i+8] - P[i+5]*P[i+7])
            + P[i+1] * (P[i+5]*P[i+6] - P[i+3]*P[i+8])
            + P[i+2] * (P[i+3]*P[i+7] - P[i+4]*P[i+6])) / 6;
      }
      return v;
    };
    for (const yaw of [0, 0.7, 2.4, -1.9]) {
      let s = new Soup(64);
      prism(s, [3, 4, 5], 1, 2, 3, yaw, [120, 120, 120]);
      expect(vol(s.done()), `prism inside out at yaw ${yaw}`).toBeCloseTo(48, 3);

      // A ring listed CLOCKWISE from above must come out the same way up as
      // one listed anticlockwise -- that normalisation is the whole point of
      // `closed`, and without it half the fleet is lit from inside.
      for (const dir of [1, -1]) {
        s = new Soup(64);
        const ring = [[-1, -2], [1, -2], [1, 2], [-1, 2]];
        closed(s, (x, y, z) => [x, y, z], dir > 0 ? ring : ring.slice().reverse(),
               0, 3, [200,200,200], [150,150,150], [90,90,90]);
        expect(vol(s.done()), `closed() inside out, ring dir ${dir}`).toBeCloseTo(24, 3);
      }

      s = new Soup(256);
      plane(s, 10, 800, -30, yaw);
      expect(vol(s.done()), `the aircraft is inside out at yaw ${yaw}`).toBeGreaterThan(0);

      s = new Soup(256);
      heli(s, 10, 300, -30, yaw, 1.3);
      expect(vol(s.done()), `the helicopter is inside out at yaw ${yaw}`).toBeGreaterThan(0);
    }
  });

  it('the plane descends toward the real airport', () => {
    const a = new Ambient(stubScene, THREE, M, { skyline: { x: 0, z: 0 } });
    // PDX is north-EAST of the Burnside Bridge: +x and -z from the anchor.
    expect(a.airport.x, 'the airport is east of downtown').toBeGreaterThan(3000);
    expect(a.airport.z, 'the airport is north of downtown').toBeLessThan(-4000);

    for (let k = 0; k < 4000 && !a.plane; k++) a.step(1 / 20, 0, 3, 0, live, NAMES.road);
    expect(a.plane, 'no plane ever appeared').toBeTruthy();
    // It flies TOWARD the airport, and it comes DOWN on the way. An approach
    // that holds altitude is a plane going somewhere else, and reads as a
    // sticker pinned to the sky.
    const toward = (a.airport.x * a.plane.hx + a.airport.z * a.plane.hz) /
                   Math.hypot(a.airport.x, a.airport.z);
    expect(toward).toBeGreaterThan(0.5);
    const y0 = AIR.plane.y0, y1 = AIR.plane.y1;
    expect(y1).toBeLessThan(y0);
    expect(y1, 'an airliner at rooftop height over downtown').toBeGreaterThan(200);
  });

  it('the whole layer is ONE draw call and stays small', () => {
    const a = new Ambient(stubScene, THREE, M, { skyline: { x: 0, z: 0 } });
    for (let k = 0; k < 400; k++) a.step(1 / 20, M.spawn.x, 3, M.spawn.z, live, NAMES.road);
    expect(a.live, 'nothing drawn at all').toBeGreaterThan(50);
    // The brief was "I don't want to get super heavy". Thirty cars, five
    // boats, a plane and a helicopter live inside one geometry; if this ever
    // needs raising, the question to ask first is whether it should be a
    // second draw call instead.
    expect(a.live, 'the ambient layer has got heavy').toBeLessThan(6000);
    expect(a.mesh.geometry.attributes.position.array.length).toBeGreaterThanOrEqual(a.live * 9);
  });
});

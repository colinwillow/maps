// The runtime, driven headlessly against the real baked city.
//
// These are the checks that would pass on a city rendered INSIDE OUT, on a
// collider that pushes the wrong way, and on a bridge you fall through -- if
// they only counted triangles. Each one pins a direction or a consequence.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseChunk } from '../public/pdx/game/chunk.js';
import { buildTerrain, buildBuildings, buildRoads, buildAreas } from '../public/pdx/game/build.js';
import { buildProps } from '../public/pdx/game/props.js';
import { Ground } from '../public/pdx/game/ground.js';
import { Overrides } from '../public/pdx/game/overrides.js';
import { Player } from '../public/pdx/game/player.js';
import { MOVE } from '../public/pdx/game/tune.js';

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

import * as THREE from 'three';
import type { Vec2 } from './plan';
import { hash01 } from './plan';

/**
 * A LANGUAGE OF BUILDINGS, stacked out of sections.
 *
 * The shape of every building is real — OpenMapTiles carries the OSM footprint
 * and a `render_height`, so downtown Portland's towers are the towers that are
 * actually there. What is generated is everything that makes a box read as a
 * building: a ground floor that is different from the floors above it, a
 * repeating storey band that simply repeats more times as the building gets
 * taller, a cornice or parapet at the top, and roof clutter.
 *
 * So a building is a STACK:
 *
 *     cornice     h-c .. h      one band, family-specific
 *     body        g   .. h-c    the storey band, tiled once per storey
 *     ground      0   .. g      shopfront, lobby, garage door, porch
 *
 * and "taller" means more repeats of the middle, which is the whole trick.
 *
 * Five families, chosen from the footprint and height rather than at random,
 * so the city sorts itself out: a 60m block downtown becomes a tower, a 1400
 * square metre shed by the rail yard becomes a warehouse, and a 90 square
 * metre footprint at 6m becomes a house with a pitched roof.
 *
 * Three OWNS THE BUILDINGS while the character is walking, and MapLibre's
 * fill-extrusion layer is switched off for the duration. Drawing both means
 * two copies of every building fighting for the same pixels; one system at a
 * time is the only version of this that can look right.
 */

export type Family = 'house' | 'brick' | 'midrise' | 'tower' | 'warehouse';

export type Footprint = {
  id: number;
  /** Outer ring first, then any holes. Metres east/south, ring not closed. */
  rings: Vec2[][];
  /** Metres to the top. */
  height: number;
  /** Metres to the bottom — non-zero for a part sitting on something else. */
  minHeight: number;
};

export const BUILDINGS = {
  /** Metres of buildings around him. Beyond this the street is empty anyway. */
  radius: 330,
  /** Rebuild once he has walked this far from the last plan. */
  refreshStep: 90,
  /** Ceiling on buildings drawn. Portland downtown fits inside this. */
  maxBuildings: 900,
  /** Below this, a footprint is noise — a bin store, a gazebo, a tile sliver. */
  minArea: 12,
  family: {
    house:     { storey: 2.9, ground: 0,   cornice: 0,   bay: 3.2, ridge: 1.9 },
    brick:     { storey: 3.7, ground: 4.6, cornice: 0.9, bay: 4.0, ridge: 0 },
    midrise:   { storey: 3.4, ground: 5.0, cornice: 0.8, bay: 3.6, ridge: 0 },
    tower:     { storey: 3.9, ground: 6.5, cornice: 1.2, bay: 3.4, ridge: 0 },
    warehouse: { storey: 6.0, ground: 5.2, cornice: 0.6, bay: 6.0, ridge: 0 },
  } as Record<Family, { storey: number; ground: number; cornice: number; bay: number; ridge: number }>,
} as const;

/**
 * Twice the signed area of a ring, in the (east, south) plane.
 *
 * Sign is orientation, and orientation is what decides which way a wall's
 * normal points. Vector tiles do not promise a winding, so this gets measured
 * per ring rather than assumed — a ring wound the other way lights every wall
 * of that building from the inside, which reads as the building being a hole.
 */
export function ringArea2(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.east * q.south - q.east * p.south;
  }
  return a;
}

/** Which of the five this footprint is, from its own size and height. */
export function familyFor(fp: Footprint, area = footprintArea(fp)): Family {
  const h = fp.height;
  if (h >= 45) return 'tower';
  if (area >= 1100 && h < 16) return 'warehouse';
  if (h <= 7.5 && area <= 260) return 'house';
  if (h <= 17) return 'brick';
  return 'midrise';
}

export function footprintArea(fp: Footprint): number {
  return fp.rings.length ? Math.abs(ringArea2(fp.rings[0])) / 2 : 0;
}

export type Section = {
  kind: 'ground' | 'body' | 'cornice';
  from: number;
  to: number;
  /** How many times the storey band repeats over this section. */
  storeys: number;
};

/**
 * Cut a building of this height into its stack of sections.
 *
 * The ground floor and the cornice are FIXED heights, not fractions — a
 * shopfront is about four and a half metres whether the building above it is
 * three storeys or thirty, and scaling it with the total is what makes
 * procedural cities look like toys. They only shrink when the building is too
 * short to fit them, and a building shorter than a single storey is all
 * ground floor, which is what a bungalow is.
 */
export function sectionsFor(family: Family, height: number): Section[] {
  const f = BUILDINGS.family[family];
  const h = Math.max(2, height);
  const ground = Math.min(f.ground, h * 0.5);
  const cornice = Math.min(f.cornice, Math.max(0, h - ground) * 0.25);
  const bodyTop = h - cornice;

  const out: Section[] = [];
  if (ground > 0.05) out.push({ kind: 'ground', from: 0, to: ground, storeys: 1 });
  if (bodyTop - ground > 0.4) {
    out.push({
      kind: 'body',
      from: ground,
      to: bodyTop,
      storeys: Math.max(1, Math.round((bodyTop - ground) / f.storey)),
    });
  }
  if (cornice > 0.05) out.push({ kind: 'cornice', from: bodyTop, to: h, storeys: 1 });
  return out;
}

/**
 * The walls of one ring between two heights.
 *
 * UVs carry METRES, not a 0..1 span: u is distance along the facade divided by
 * the family's bay width and v is height divided by the storey height, with
 * the texture set to repeat. That is what makes one texture serve a three
 * storey building and a thirty storey one without the windows stretching.
 *
 * `outward` is +1 when the ring is wound so that walking it keeps the interior
 * on one side; it is derived from the signed area by the caller, because
 * getting it backwards turns every wall inside out.
 */
export function wallGeometry(
  ring: Vec2[],
  y0: number,
  y1: number,
  bay: number,
  vSpan: number,
  outward: 1 | -1,
): THREE.BufferGeometry {
  const n = ring.length;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  let run = 0;

  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const ex = b.east - a.east;
    const ez = b.south - a.south;
    const len = Math.hypot(ex, ez);
    if (len < 1e-6) continue;

    // Perpendicular to the edge, flipped by the ring's own orientation.
    const nx = (ez / len) * outward;
    const nz = (-ex / len) * outward;

    const u0 = run / bay;
    const u1 = (run + len) / bay;
    run += len;
    const v0 = 0;
    const v1 = (y1 - y0) / vSpan;

    // Two triangles, wound so that (v1-v0) x (v2-v0) lands on the normal
    // above. Get this backwards and the faces are culled away: the building
    // keeps exactly the walls it claims to have and draws none of them.
    const quad = outward > 0
      ? [[a, y0, u0, v0], [b, y1, u1, v1], [b, y0, u1, v0],
         [a, y0, u0, v0], [a, y1, u0, v1], [b, y1, u1, v1]]
      : [[a, y0, u0, v0], [b, y0, u1, v0], [b, y1, u1, v1],
         [a, y0, u0, v0], [b, y1, u1, v1], [a, y1, u0, v1]];

    for (const [p, y, u, v] of quad as [Vec2, number, number, number][]) {
      pos.push(p.east, y, p.south);
      nor.push(nx, 0, nz);
      uv.push(u, v);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** A flat roof over a footprint, holes included. */
export function roofGeometry(rings: Vec2[][], y: number): THREE.BufferGeometry | null {
  if (!rings.length || rings[0].length < 3) return null;
  const toPts = (r: Vec2[]) => r.map((p) => new THREE.Vector2(p.east, p.south));
  const shape = new THREE.Shape(toPts(rings[0]));
  for (const hole of rings.slice(1)) {
    if (hole.length >= 3) shape.holes.push(new THREE.Path(toPts(hole)));
  }
  const g = new THREE.ShapeGeometry(shape);
  // ShapeGeometry lies in XY; stand it on the ground plane, facing up.
  g.rotateX(Math.PI / 2);
  g.translate(0, y, 0);
  // rotateX(+90) sends +Z to -Y, so the winding now faces DOWN. Seen from a
  // street it would be an invisible roof, which looks like a missing roof.
  const idx = g.getIndex();
  if (idx) {
    const a = idx.array as unknown as number[];
    for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 2]; a[i + 2] = t; }
    idx.needsUpdate = true;
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A hipped roof: a fan from the outline up to an apex over the centroid.
 *
 * A real gable needs a ridge axis and the footprint to cooperate; a hip reads
 * correctly from any angle for a handful of triangles, and at the scale a
 * house occupies on this map that is the whole of the difference.
 */
export function hipRoofGeometry(ring: Vec2[], y: number, rise: number): THREE.BufferGeometry | null {
  if (ring.length < 3) return null;
  const cx = ring.reduce((s, p) => s + p.east, 0) / ring.length;
  const cz = ring.reduce((s, p) => s + p.south, 0) / ring.length;
  const pos: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    // A roof faces UP — that is the whole invariant, and it does not depend on
    // the ring's winding, so rather than deriving the winding and hoping, each
    // triangle is built and then flipped if it came out facing the ground.
    const ax = b.east - a.east, az = b.south - a.south;
    const bx = cx - a.east, by = rise, bz = cz - a.south;
    const ny = az * bx - ax * bz; // y of (b-a) x (apex-a)
    if (ny * by >= 0) {
      pos.push(a.east, y, a.south, b.east, y, b.south, cx, y + rise, cz);
    } else {
      pos.push(b.east, y, b.south, a.east, y, a.south, cx, y + rise, cz);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Rooftop clutter: plant housings, tanks, a mast. Deterministic per building. */
export function roofProps(fp: Footprint, family: Family): { east: number; south: number; w: number; d: number; h: number }[] {
  if (family === 'house') return [];
  const ring = fp.rings[0];
  if (!ring || ring.length < 3) return [];
  let minE = Infinity, maxE = -Infinity, minS = Infinity, maxS = -Infinity;
  for (const p of ring) {
    minE = Math.min(minE, p.east); maxE = Math.max(maxE, p.east);
    minS = Math.min(minS, p.south); maxS = Math.max(maxS, p.south);
  }
  const w = maxE - minE, d = maxS - minS;
  if (w < 6 || d < 6) return [];
  const count = family === 'warehouse' ? 1 : 2;
  const out = [];
  for (let i = 0; i < count; i++) {
    // Kept well inside the outline, since a box that overhangs the parapet
    // reads as a mistake rather than as plant.
    const fe = 0.3 + hash01(fp.id, 40 + i) * 0.4;
    const fs = 0.3 + hash01(fp.id, 60 + i) * 0.4;
    out.push({
      east: minE + w * fe,
      south: minS + d * fs,
      w: Math.min(w * 0.22, 4.5),
      d: Math.min(d * 0.22, 4.5),
      h: 1.2 + hash01(fp.id, 80 + i) * 1.6,
    });
  }
  return out;
}

/**
 * Which way a ring's wall normals should point.
 *
 * Measured against the ring's own centroid rather than assumed from a winding
 * order, because vector tiles do not promise one. An outer wall faces AWAY
 * from the middle of its ring; a courtyard wall faces INTO the courtyard, so
 * a hole is the same test with the answer inverted.
 */
export function outwardSign(ring: Vec2[], away = true): 1 | -1 {
  const n = ring.length;
  if (n < 3) return 1;
  let cx = 0, cz = 0;
  for (const p of ring) { cx += p.east; cz += p.south; }
  cx /= n; cz /= n;

  // The longest edge, so a near-degenerate one cannot decide it.
  let best = -1, bi = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const l = Math.hypot(b.east - a.east, b.south - a.south);
    if (l > best) { best = l; bi = i; }
  }
  const a = ring[bi], b = ring[(bi + 1) % n];
  const ex = b.east - a.east, ez = b.south - a.south;
  const len = Math.hypot(ex, ez) || 1;
  // Matches wallGeometry's normal for outward = +1.
  const nx = ez / len, nz = -ex / len;
  const dot = nx * ((a.east + b.east) / 2 - cx) + nz * ((a.south + b.south) / 2 - cz);
  return (dot > 0) === away ? 1 : -1;
}

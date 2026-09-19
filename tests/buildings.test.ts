import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  BUILDINGS, familyFor, footprintArea, hipRoofGeometry, outwardSign, roofGeometry,
  sectionsFor, wallGeometry, type Footprint,
} from '../src/layers/city/buildings';
import { buildBuildings } from '../src/layers/city/assemble';
import type { Vec2 } from '../src/layers/city/plan';

/**
 * The building kit.
 *
 * The trap here is the same one as the street furniture: a check that a
 * building "has walls" passes with every wall inside out, which looks like a
 * hole in the ground rather than like a sign error. So the normals are checked
 * against the footprint's own centroid, in both windings.
 *
 * The other thing worth pinning is the CLAIM the kit makes — that a taller
 * building is the same sections with the middle repeated more times, not the
 * same sections stretched. That is what a "ground floor" scaling to nine
 * metres on a tower would break, and it is invisible in a screenshot until you
 * stand next to one.
 */

const square = (size: number, cx = 0, cz = 0, ccw = false): Vec2[] => {
  const h = size / 2;
  const pts = [
    { east: cx - h, south: cz - h }, { east: cx + h, south: cz - h },
    { east: cx + h, south: cz + h }, { east: cx - h, south: cz + h },
  ];
  return ccw ? pts.reverse() : pts;
};

const fp = (id: number, size: number, height: number, extra: Partial<Footprint> = {}): Footprint => ({
  id, rings: [square(size)], height, minHeight: 0, ...extra,
});

const centroid = (ring: Vec2[]) => ({
  east: ring.reduce((s, p) => s + p.east, 0) / ring.length,
  south: ring.reduce((s, p) => s + p.south, 0) / ring.length,
});

describe('choosing a family from the building itself', () => {
  it('sorts the city out by size and height, not at random', () => {
    expect(familyFor(fp(1, 30, 62))).toBe('tower');        // downtown block
    expect(familyFor(fp(2, 40, 10))).toBe('warehouse');    // 1600 sqm shed
    expect(familyFor(fp(3, 10, 6))).toBe('house');         // 100 sqm at 6m
    expect(familyFor(fp(4, 20, 12))).toBe('brick');        // low-rise commercial
    expect(familyFor(fp(5, 25, 30))).toBe('midrise');
  });

  it('does not call a tall narrow thing a warehouse, or a big flat thing a tower', () => {
    expect(familyFor(fp(6, 40, 60))).toBe('tower');        // big AND tall
    expect(familyFor(fp(7, 8, 14))).toBe('brick');         // small but not a house
  });

  it('measures area off the ring in either winding', () => {
    expect(footprintArea(fp(8, 20, 5))).toBeCloseTo(400, 6);
    expect(footprintArea({ ...fp(9, 20, 5), rings: [square(20, 0, 0, true)] })).toBeCloseTo(400, 6);
  });
});

describe('cutting a building into sections', () => {
  const covers = (family: Parameters<typeof sectionsFor>[0], h: number) => {
    const s = sectionsFor(family, h);
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].from).toBeCloseTo(0, 6);
    expect(s[s.length - 1].to).toBeCloseTo(Math.max(2, h), 6);
    for (let i = 1; i < s.length; i++) expect(s[i].from).toBeCloseTo(s[i - 1].to, 6);
    return s;
  };

  it('covers the whole height with no gap and no overlap', () => {
    for (const f of ['house', 'brick', 'midrise', 'tower', 'warehouse'] as const) {
      for (const h of [3, 8, 17, 40, 120]) covers(f, h);
    }
  });

  it('makes a taller building by REPEATING the middle, not stretching it', () => {
    // The claim the whole kit rests on. A ground floor that grows with the
    // building is what makes procedural cities look like toys.
    const short = sectionsFor('brick', 14);
    const tall = sectionsFor('brick', 120);
    const ground = (s: typeof short) => s.find((x) => x.kind === 'ground')!;
    const body = (s: typeof short) => s.find((x) => x.kind === 'body')!;
    expect(ground(tall).to).toBeCloseTo(ground(short).to, 6);
    expect(body(tall).storeys).toBeGreaterThan(body(short).storeys * 5);
    // And the storeys really are one storey each.
    const h = BUILDINGS.family.brick.storey;
    expect((body(tall).to - body(tall).from) / body(tall).storeys).toBeCloseTo(h, 0);
  });

  it('gives a bungalow no middle rather than a negative one', () => {
    const s = sectionsFor('brick', 3);
    expect(s.every((x) => x.to > x.from)).toBe(true);
    expect(s.every((x) => x.storeys >= 1)).toBe(true);
  });

  it('gives a house no shopfront and no cornice', () => {
    expect(sectionsFor('house', 7).map((s) => s.kind)).toEqual(['body']);
  });
});

describe('walls', () => {
  const outwardness = (ring: Vec2[], g: THREE.BufferGeometry) => {
    const c = centroid(ring);
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    let worst = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - c.east;
      const dz = pos.getZ(i) - c.south;
      worst = Math.min(worst, nor.getX(i) * dx + nor.getZ(i) * dz);
    }
    return worst;
  };

  it('points its normals OUT, in either winding', () => {
    // A wall lit from the inside reads as a hole in the ground, not as a sign
    // error — and "the geometry has normals" passes happily either way.
    for (const ccw of [false, true]) {
      const ring = square(20, 0, 0, ccw);
      const g = wallGeometry(ring, 0, 10, 4, 3.5, outwardSign(ring));
      expect(outwardness(ring, g)).toBeGreaterThan(0.5);
    }
  });

  it('points a courtyard wall INTO the courtyard', () => {
    const hole = square(6);
    const g = wallGeometry(hole, 0, 10, 4, 3.5, outwardSign(hole, false));
    expect(outwardness(hole, g)).toBeLessThan(-0.5);
  });

  it('winds its triangles to match the normal it claims', () => {
    // Otherwise the face is backface-culled away and the building is missing
    // exactly the walls it says it has.
    for (const ccw of [false, true]) {
      const ring = square(20, 0, 0, ccw);
      const g = wallGeometry(ring, 0, 10, 4, 3.5, outwardSign(ring));
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      const v = (i: number) => new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
      for (let t = 0; t < p.count; t += 3) {
        const face = new THREE.Vector3().subVectors(v(t + 1), v(t))
          .cross(new THREE.Vector3().subVectors(v(t + 2), v(t))).normalize();
        expect(face.dot(new THREE.Vector3(n.getX(t), n.getY(t), n.getZ(t)))).toBeGreaterThan(0.9);
      }
    }
  });

  it('carries METRES in its UVs, so one texture serves any height', () => {
    const ring = square(20);              // 80m perimeter
    const g = wallGeometry(ring, 0, 10.5, 4, 3.5, 1);
    const uv = g.getAttribute('uv');
    let maxU = 0, maxV = 0;
    for (let i = 0; i < uv.count; i++) {
      maxU = Math.max(maxU, uv.getX(i));
      maxV = Math.max(maxV, uv.getY(i));
    }
    expect(maxU).toBeCloseTo(80 / 4, 6);   // 20 bays round the building
    expect(maxV).toBeCloseTo(3, 6);        // three storeys of 3.5m
  });

  it('repeats more storeys for a taller wall rather than stretching them', () => {
    const ring = square(20);
    const v = (h: number, storeys: number) => {
      const g = wallGeometry(ring, 0, h, 4, h / storeys, 1);
      const uv = g.getAttribute('uv');
      let m = 0;
      for (let i = 0; i < uv.count; i++) m = Math.max(m, uv.getY(i));
      return m;
    };
    expect(v(35, 10)).toBeCloseTo(10, 6);
    expect(v(70, 20)).toBeCloseTo(20, 6);
  });
});

describe('roofs', () => {
  it('faces UP, which an invisible roof does not', () => {
    // ShapeGeometry lies in XY and rotating it flat inverts the winding; miss
    // that and every roof in the city is only visible from underneath.
    const g = roofGeometry([square(20)], 12)!;
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBeGreaterThan(0.9);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeCloseTo(12, 6);
  });

  it('cuts courtyards out of the roof', () => {
    const solid = roofGeometry([square(20)], 10)!;
    const holed = roofGeometry([square(20), square(8)], 10)!;
    expect(holed.getAttribute('position').count).toBeGreaterThan(
      solid.getAttribute('position').count);
  });

  it('puts a hip roof apex above the house, facing up and out', () => {
    const g = hipRoofGeometry(square(10), 6, 2)!;
    const p = g.getAttribute('position');
    let maxY = -Infinity;
    for (let i = 0; i < p.count; i++) maxY = Math.max(maxY, p.getY(i));
    expect(maxY).toBeCloseTo(8, 6);
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBeGreaterThan(0);
  });
});

describe('assembling a neighbourhood', () => {
  const town = (n: number, spacing = 30) =>
    Array.from({ length: n }, (_, i) =>
      fp(i + 1, 18, 8 + (i % 7) * 9, {
        rings: [square(18, (i % 10) * spacing - 140, Math.floor(i / 10) * spacing - 140)],
      }));

  it('merges a whole neighbourhood into a handful of draw calls', () => {
    // One mesh per building would be hundreds. The point of sharing a material
    // per family is that this number does not grow with the city.
    const few = buildBuildings(town(12), { east: 0, south: 0 });
    const many = buildBuildings(town(90), { east: 0, south: 0 });
    expect(many.count).toBeGreaterThan(few.count);
    expect(many.group.children.length).toBeLessThanOrEqual(20);
    expect(many.group.children.length).toBeLessThanOrEqual(few.group.children.length + 6);
  });

  it('gives every merged mesh a colour attribute', () => {
    // The materials run with vertexColors on; a mesh without the attribute
    // renders black, which looks like a lighting bug.
    const built = buildBuildings(town(30), { east: 0, south: 0 });
    for (const m of built.group.children as THREE.Mesh[]) {
      expect(m.geometry.getAttribute('color')).toBeTruthy();
      expect(m.geometry.getAttribute('color').count)
        .toBe(m.geometry.getAttribute('position').count);
    }
  });

  it('keeps the nearest buildings when it runs out of budget', () => {
    const all = town(90);
    const capped = buildBuildings(all, { east: 0, south: 0 }, { ...BUILDINGS, maxBuildings: 10 });
    expect(capped.count).toBe(10);
    const full = buildBuildings(all, { east: 0, south: 0 });
    const far = (g: THREE.Group) => {
      let d = 0;
      for (const m of g.children as THREE.Mesh[]) {
        const p = m.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) d = Math.max(d, Math.hypot(p.getX(i), p.getZ(i)));
      }
      return d;
    };
    expect(far(capped.group)).toBeLessThan(far(full.group) * 0.6);
  });

  it('ignores slivers and anything beyond the radius', () => {
    const tiny = fp(1, 2, 5);                                   // 4 sqm
    const distant = fp(2, 20, 12, { rings: [square(20, 5000, 0)] });
    expect(buildBuildings([tiny, distant], { east: 0, south: 0 }).count).toBe(0);
  });

  it('starts a building PART where it actually starts', () => {
    // render_min_height exists so that something sitting on a podium does not
    // grow out of the ground. A part also gets no shopfront: it is the middle
    // of a building, not a building.
    const part = fp(1, 20, 40, { minHeight: 18 });
    const built = buildBuildings([part], { east: 0, south: 0 });
    let lowest = Infinity;
    for (const m of built.group.children as THREE.Mesh[]) {
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) lowest = Math.min(lowest, p.getY(i));
    }
    expect(lowest).toBeCloseTo(18, 6);
  });

  it('lets go of its geometry when replaced', () => {
    const built = buildBuildings(town(20), { east: 0, south: 0 });
    expect(built.group.children.length).toBeGreaterThan(0);
    built.dispose();
    expect(built.group.children.length).toBe(0);
  });
});

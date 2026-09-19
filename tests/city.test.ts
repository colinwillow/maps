import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  CITY, clipToRadius, controlsAt, findJunctions, hash01, headingOf,
  planCity, rightOf, sampleAlong,
  type Prop, type Road, type Vec2,
} from '../src/layers/city/plan';
import { buildProps } from '../src/layers/city/props';
import { CityProps } from '../src/layers/city';
import { makeGeoFrame } from '../src/layers/three/geo';

/**
 * The trap this suite is written against: almost every check you would write
 * about generated street furniture passes just as happily with the entire city
 * mirrored. "Trees appear on both sides" passes when the sides are swapped.
 * "Signs are near the junction" passes with every sign on the far corner
 * facing away from the driver who has to read it.
 *
 * So the direction checks below assert SIGNED positions on both axes and the
 * heading of each prop, on all four arms of a junction, rather than distances
 * and counts.
 */

const road = (id: number, kind: Road['kind'], pts: [number, number][]): Road => ({
  id, kind, points: pts.map(([east, south]) => ({ east, south })),
});

/** Distance from a point to a polyline, worked out independently of plan.ts. */
function distToLine(p: Vec2, pts: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.east - a.east, dy = b.south - a.south;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.east - a.east) * dx + (p.south - a.south) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.east - (a.east + t * dx), p.south - (a.south + t * dy)));
  }
  return best;
}

const norm = (deg: number) => ((deg % 360) + 360) % 360;

describe('the frame the city is laid out in', () => {
  it('right of east is south, right of north is east', () => {
    // Walking east, your right hand points south. Getting this backwards
    // mirrors every tree, lamp and sign in the city at once.
    expect(rightOf({ east: 1, south: 0 })).toEqual({ east: -0, south: 1 });
    expect(rightOf({ east: 0, south: -1 })).toEqual({ east: 1, south: 0 });
    expect(rightOf({ east: -1, south: 0 })).toEqual({ east: -0, south: -1 });
    expect(rightOf({ east: 0, south: 1 })).toEqual({ east: -1, south: 0 });
  });

  it('headings are compass bearings', () => {
    expect(headingOf(0, -1)).toBe(0);    // north
    expect(headingOf(1, 0)).toBe(90);    // east
    expect(headingOf(0, 1)).toBe(180);   // south
    expect(headingOf(-1, 0)).toBe(-90);  // west
  });
});

describe('walking a polyline', () => {
  const line = [{ east: 0, south: 0 }, { east: 100, south: 0 }];

  it('lands a sample every spacing metres, ends included', () => {
    const s = sampleAlong(line, 25);
    expect(s.map((x) => x.pos.east)).toEqual([0, 25, 50, 75, 100]);
    expect(s.every((x) => x.pos.south === 0)).toBe(true);
    expect(s[0].tan).toEqual({ east: 1, south: 0 });
  });

  it('phase shifts where the row starts', () => {
    expect(sampleAlong(line, 25, 10).map((x) => x.pos.east)).toEqual([10, 35, 60, 85]);
  });

  it('follows the tangent round a corner', () => {
    const bend = [{ east: 0, south: 0 }, { east: 50, south: 0 }, { east: 50, south: 50 }];
    const s = sampleAlong(bend, 25);
    expect(s[2].tan).toEqual({ east: 1, south: 0 });   // still heading east at 50m
    expect(s[3].tan).toEqual({ east: 0, south: 1 });   // heading south by 75m
  });

  it('gives nothing for a degenerate line', () => {
    expect(sampleAlong([{ east: 0, south: 0 }], 10)).toEqual([]);
  });
});

describe('clipping to the furnished radius', () => {
  const centre = { east: 0, south: 0 };

  it('keeps the stretch of a straight road that crosses the circle', () => {
    // Both endpoints are outside and no vertex is inside. Filtering by vertex
    // instead of clipping the segment drops this road entirely — and it is the
    // street running past you that this happens to.
    const runs = clipToRadius([{ east: -500, south: 0 }, { east: 500, south: 0 }], centre, 100);
    expect(runs.length).toBe(1);
    expect(runs[0].map((p) => Math.round(p.east))).toEqual([-100, 100]);
  });

  it('splits a road that leaves and comes back into two stretches', () => {
    // One run would draw a row of trees straight across the gap.
    const runs = clipToRadius([
      { east: -50, south: 0 }, { east: -50, south: -500 },
      { east: 50, south: -500 }, { east: 50, south: 0 },
    ], centre, 100);
    expect(runs.length).toBe(2);
    expect(runs[0][0].east).toBe(-50);
    expect(runs[1][runs[1].length - 1].east).toBe(50);
  });

  it('drops what is wholly outside, and never returns a point beyond the edge', () => {
    expect(clipToRadius([{ east: 300, south: 0 }, { east: 400, south: 0 }], centre, 100)).toEqual([]);
    const runs = clipToRadius([
      { east: 0, south: 0 }, { east: 60, south: 0 }, { east: 60, south: 300 },
    ], centre, 100);
    for (const run of runs) {
      for (const p of run) expect(Math.hypot(p.east, p.south)).toBeLessThanOrEqual(100 + 1e-9);
    }
  });
});

describe('street furniture', () => {
  const eastWest = road(1, 'minor', [[-120, 0], [120, 0]]);
  const props = planCity([eastWest], { east: 0, south: 0 });
  const off = CITY.halfWidth.minor + CITY.verge;

  it('furnishes both kerbs', () => {
    const trees = props.filter((p) => p.kind === 'tree');
    expect(trees.length).toBeGreaterThan(8);
    expect(trees.some((t) => t.south > 0)).toBe(true);
    expect(trees.some((t) => t.south < 0)).toBe(true);
  });

  it('never puts anything in the carriageway', () => {
    // The global invariant. A sign error in rightOf keeps this passing, which
    // is exactly why the heading checks below exist too.
    for (const p of props) {
      expect(distToLine(p, eastWest.points)).toBeGreaterThanOrEqual(CITY.halfWidth.minor);
    }
  });

  it('jitters ALONG the street and never across it', () => {
    // Jitter on the normal is the bug that walks trees into the road; this
    // pins the offset exactly while still proving the row is not a comb.
    const trees = props.filter((p) => p.kind === 'tree');
    for (const t of trees) expect(Math.abs(Math.abs(t.south) - off)).toBeLessThan(1e-9);
    const spacings = trees.filter((t) => t.south > 0).map((t) => t.east).sort((a, b) => a - b);
    const gaps = spacings.slice(1).map((v, i) => v - spacings[i]);
    expect(gaps.some((g) => Math.abs(g - CITY.treeSpacing) > 0.5)).toBe(true);
  });

  it('points every street lamp at the road it lights', () => {
    // A lamp on the south kerb must face NORTH. Negate the inward direction
    // and every lamp in the city reaches out over the buildings instead.
    const lamps = props.filter((p) => p.kind === 'lamp');
    expect(lamps.length).toBeGreaterThan(2);
    for (const l of lamps) {
      expect(norm(l.heading)).toBeCloseTo(l.south > 0 ? 0 : 180, 5);
    }
    expect(lamps.some((l) => l.south > 0)).toBe(true);
    expect(lamps.some((l) => l.south < 0)).toBe(true);
  });

  it('runs telephone poles down one side only, squarely across the street', () => {
    const poles = props.filter((p) => p.kind === 'pole');
    expect(poles.length).toBeGreaterThan(2);
    const sides = new Set(poles.map((p) => Math.sign(p.south)));
    expect(sides.size).toBe(1);
    // Facing along the street puts the crossarms across it.
    for (const p of poles) expect(norm(p.heading)).toBeCloseTo(90, 5);
  });

  it('leaves motorways and railways alone', () => {
    expect(planCity([road(2, 'motorway', [[-120, 0], [120, 0]])], { east: 0, south: 0 })
      .some((p) => p.kind === 'tree')).toBe(false);
    expect(planCity([road(3, 'rail', [[-120, 0], [120, 0]])], { east: 0, south: 0 })).toEqual([]);
  });

  it('works the same on a north-south street', () => {
    const northSouth = road(9, 'minor', [[0, -120], [0, 120]]);
    const p2 = planCity([northSouth], { east: 0, south: 0 });
    for (const t of p2.filter((p) => p.kind === 'tree')) {
      expect(Math.abs(Math.abs(t.east) - off)).toBeLessThan(1e-9);
    }
    for (const l of p2.filter((p) => p.kind === 'lamp')) {
      // East kerb faces west, west kerb faces east.
      expect(norm(l.heading)).toBeCloseTo(l.east > 0 ? 270 : 90, 5);
    }
  });
});

describe('junctions', () => {
  const plus = [
    road(1, 'minor', [[-100, 0], [0, 0], [100, 0]]),
    road(2, 'minor', [[0, -100], [0, 0], [0, 100]]),
  ];

  it('finds one crossroads with four arms, not four crossroads', () => {
    const j = findJunctions(plus);
    expect(j.length).toBe(1);
    expect(j[0].approaches.length).toBe(4);
    expect(j[0].pos.east).toBeCloseTo(0, 6);
    expect(j[0].pos.south).toBeCloseTo(0, 6);
  });

  it('finds a T as three arms', () => {
    expect(findJunctions([
      road(1, 'minor', [[-100, 0], [0, 0], [100, 0]]),
      road(2, 'minor', [[0, 0], [0, 100]]),
    ])[0].approaches.length).toBe(3);
  });

  it('does not invent junctions', () => {
    expect(findJunctions([
      road(1, 'minor', [[-100, 0], [0, 0], [100, 0]]),
      road(2, 'minor', [[-100, 50], [0, 50], [100, 50]]),
    ])).toEqual([]);
    // One road bending is not a junction with itself.
    expect(findJunctions([road(1, 'minor', [[-100, 0], [0, 0], [0, 100]])])).toEqual([]);
  });

  it('signals the big junctions and signs the small ones', () => {
    const signal = controlsAt(findJunctions([
      road(1, 'secondary', [[-100, 0], [0, 0], [100, 0]]),
      road(2, 'minor', [[0, -100], [0, 0], [0, 100]]),
    ]), CITY);
    expect(new Set(signal.map((p) => p.kind))).toEqual(new Set(['trafficLight']));
    expect(new Set(controlsAt(findJunctions(plus), CITY).map((p) => p.kind)))
      .toEqual(new Set(['stopSign']));
  });

  it('puts every sign on the driver’s near-right corner, facing them', () => {
    // The whole handedness of the city, in one check. Each arm gets its own
    // quadrant and its own facing; mirroring rightOf sends all four to the
    // opposite corner, and negating the facing turns all four away.
    const signs = controlsAt(findJunctions(plus), CITY);
    const off = CITY.halfWidth.minor + CITY.verge;
    const at = (e: number, s: number) =>
      signs.find((p) => Math.abs(p.east - e * off) < 1e-6 && Math.abs(p.south - s * off) < 1e-6);

    const ne = at(1, -1);   // for the westbound driver on the east arm
    const sw = at(-1, 1);   // eastbound, west arm
    const nw = at(-1, -1);  // southbound, north arm
    const se = at(1, 1);    // northbound, south arm
    expect([ne, sw, nw, se].every(Boolean)).toBe(true);
    expect(norm(ne!.heading)).toBeCloseTo(90, 5);   // faces east, at the driver
    expect(norm(sw!.heading)).toBeCloseTo(270, 5);
    expect(norm(nw!.heading)).toBeCloseTo(0, 5);
    expect(norm(se!.heading)).toBeCloseTo(180, 5);
  });
});

describe('the plan as a whole', () => {
  const ticks = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((n) => n * 40);
  // A real grid: every crossing is a shared vertex, the way vector tiles
  // actually split ways at junctions.
  const grid: Road[] = [
    ...ticks.map((s, i) => road(100 + i, 'minor', ticks.map((e) => [e, s] as [number, number]))),
    ...ticks.map((e, i) => road(200 + i, 'minor', ticks.map((s) => [e, s] as [number, number]))),
  ];
  // No crossings at all, so the budget test measures furniture and nothing else.
  const parallel: Road[] = ticks.map((s, i) =>
    road(300 + i, 'minor', [[-230, s], [230, s]]));

  it('is deterministic \u2014 the same street furnishes the same way twice', () => {
    // Math.random here would teleport every tree each time he crosses a block.
    expect(planCity(grid, { east: 0, south: 0 }))
      .toEqual(planCity(grid, { east: 0, south: 0 }));
    expect(hash01(7, 3)).toBe(hash01(7, 3));
    expect(hash01(7, 3)).not.toBe(hash01(7, 4));
  });

  it('keeps the NEAREST props when it runs out of budget', () => {
    const capped = planCity(parallel, { east: 0, south: 0 }, { ...CITY, maxProps: 120 });
    const full = planCity(parallel, { east: 0, south: 0 }, { ...CITY, maxProps: 100000 });
    expect(capped.length).toBe(120);
    expect(full.length).toBeGreaterThan(400);
    const far = (ps: Prop[]) => Math.max(...ps.map((p) => Math.hypot(p.east, p.south)));
    // A naive slice would keep whatever the first road produced, which reaches
    // the far edge of the radius.
    expect(far(capped)).toBeLessThan(far(full) * 0.6);
  });

  it('never drops a junction control to fit in more trees', () => {
    // A junction with no signal reads as a bug; a slightly thinner row of
    // trees never does. So controls are budgeted first.
    const all = planCity(grid, { east: 0, south: 0 }, { ...CITY, maxProps: 100000 });
    const controlsIn = (ps: Prop[]) =>
      ps.filter((p) => p.kind === 'trafficLight' || p.kind === 'stopSign').length;
    expect(controlsIn(all)).toBeGreaterThan(200);

    const tight = planCity(grid, { east: 0, south: 0 }, { ...CITY, maxProps: 40 });
    expect(controlsIn(tight)).toBe(40);
    expect(tight.some((p) => p.kind === 'tree')).toBe(false);

    const roomy = planCity(grid, { east: 0, south: 0 }, { ...CITY, maxProps: controlsIn(all) + 50 });
    expect(controlsIn(roomy)).toBe(controlsIn(all));
    expect(roomy.filter((p) => p.kind === 'tree').length).toBeGreaterThan(0);
  });

  it('stays inside the furnished radius', () => {
    const p = planCity(grid, { east: 0, south: 0 }, { ...CITY, maxProps: 100000 });
    const slack = CITY.halfWidth.motorway + CITY.verge + CITY.jitter;
    for (const q of p) {
      expect(Math.hypot(q.east, q.south)).toBeLessThanOrEqual(CITY.radius + slack);
    }
  });
});

describe('the props themselves', () => {
  const kinds: Prop['kind'][] = ['tree', 'pole', 'lamp', 'trafficLight', 'stopSign'];

  it('instances one mesh per part, with every prop in it', () => {
    const props: Prop[] = kinds.flatMap((kind, i) =>
      [0, 1, 2].map((n) => ({ kind, east: n * 10, south: i * 10, heading: 0, scale: 1 })));
    const { group, dispose } = buildProps(props);
    const meshes = group.children as THREE.InstancedMesh[];
    expect(meshes.length).toBeGreaterThanOrEqual(kinds.length);
    for (const m of meshes) expect(m.count).toBe(3);
    // Props are scattered over hundreds of metres from the batch origin, so
    // frustum culling on the base geometry would blink whole batches out.
    expect(meshes.every((m) => m.frustumCulled === false)).toBe(true);
    dispose();
    expect(group.children.length).toBe(0);
  });

  it('builds props facing NORTH, so a heading turns them the right way', () => {
    // Build a sign facing +Z instead and every one of them points away from
    // the driver it exists to be read by — invisible until you walk up to one.
    const headings = [0, 90, 180, 270];
    const { group } = buildProps(headings.map((heading, i) => ({
      kind: 'stopSign' as const, east: i * 10, south: 0, heading, scale: 1,
    })));
    const mesh = group.children[0] as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    // Scene axes are X east, Y up, Z SOUTH — so the facings, in order, are
    // -Z north, +X east, +Z south, -X west.
    const want = [
      new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0),
    ];
    headings.forEach((_, i) => {
      mesh.getMatrixAt(i, m);
      const facing = new THREE.Vector3(0, 0, -1).transformDirection(m);
      expect(facing.distanceTo(want[i])).toBeLessThan(1e-6);
    });
  });

  it('places each instance where the plan put it', () => {
    const { group } = buildProps([{ kind: 'tree', east: 12, south: -34, heading: 0, scale: 2 }]);
    const m = new THREE.Matrix4();
    (group.children[0] as THREE.InstancedMesh).getMatrixAt(0, m);
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    expect([pos.x, pos.y, pos.z]).toEqual([12, 0, -34]);
    expect(new THREE.Vector3().setFromMatrixScale(m).x).toBeCloseTo(2, 6);
  });
});

describe('reading the road network off the tiles', () => {
  const PORTLAND = { lng: -122.6784, lat: 45.5152 };

  const fakeLayer = () => ({
    frame: makeGeoFrame(PORTLAND),
    scene: new THREE.Scene(),
    redraws: 0,
    requestRedraw() { this.redraws++; },
  });

  const line = (lng: number, lat: number, n = 4) =>
    Array.from({ length: n }, (_, i) => [lng + i * 0.001, lat]);

  const feature = (id: number, cls: string, coords: number[][], extra: object = {}) => ({
    id, properties: { class: cls, ...extra },
    geometry: { type: 'LineString', coordinates: coords },
  });

  const mapWith = (feats: object[]) =>
    ({ querySourceFeatures: () => feats }) as never;

  it('turns OSM classes into the kinds the planner knows, and skips the rest', () => {
    const layer = fakeLayer();
    const city = new CityProps(layer as never);
    city.readRoads(mapWith([
      feature(1, 'motorway', line(-122.68, 45.515)),
      feature(2, 'trunk', line(-122.67, 45.515)),
      feature(3, 'minor', line(-122.66, 45.515)),
      feature(4, 'ferry', line(-122.65, 45.515)),       // not a road
      feature(5, 'aerialway', line(-122.64, 45.515)),   // not a road
      feature(6, 'minor', line(-122.63, 45.515), { brunnel: 'tunnel' }), // underground
    ]));
    city.refresh({ east: 0, south: 0 }, true);
    // Three usable roads got through; the ferry, the cable car and the tunnel
    // did not. A tunnel furnished with street trees is a memorable bug.
    expect(city.propCount).toBeGreaterThan(0);
    expect(layer.scene.children.length).toBe(1);
  });

  it('only reports a change when the network actually changed', () => {
    // Tiles settle several times a second while a block loads in. Re-planning
    // a couple of thousand props each time, for an identical answer, is
    // precisely what makes walking choppy.
    const city = new CityProps(fakeLayer() as never);
    const feats = [feature(1, 'minor', line(-122.68, 45.515))];
    expect(city.readRoads(mapWith(feats))).toBe(true);
    expect(city.readRoads(mapWith(feats))).toBe(false);
    expect(city.readRoads(mapWith([...feats, feature(2, 'minor', line(-122.67, 45.515))])))
      .toBe(true);
  });

  it('does not demolish the city when a query comes back empty', () => {
    // Tiles come and go as you move. Trusting an empty answer would strip
    // every tree off the street you are standing in and put them straight back.
    const layer = fakeLayer();
    const city = new CityProps(layer as never);
    city.readRoads(mapWith([feature(1, 'minor', line(-122.68, 45.515, 40))]));
    city.refresh({ east: 0, south: 0 }, true);
    const before = city.propCount;
    expect(before).toBeGreaterThan(0);
    expect(city.readRoads(mapWith([]))).toBe(false);
    city.refresh({ east: 0, south: 0 }, true);
    expect(city.propCount).toBe(before);
  });

  it('survives a style with no vector source at all', () => {
    const city = new CityProps(fakeLayer() as never);
    expect(city.readRoads({ querySourceFeatures() { throw new Error('no such source'); } } as never))
      .toBe(false);
  });

  it('keeps the scene to one group, and lets go of the old one', () => {
    const layer = fakeLayer();
    const city = new CityProps(layer as never);
    city.setRoads([{ id: 1, kind: 'minor', points: [{ east: -100, south: 0 }, { east: 100, south: 0 }] }]);
    city.refresh({ east: 0, south: 0 }, true);
    city.refresh({ east: 0, south: 0 }, true);
    expect(layer.scene.children.length).toBe(1);
    city.dispose();
    expect(layer.scene.children.length).toBe(0);
    expect(city.propCount).toBe(0);
  });
});

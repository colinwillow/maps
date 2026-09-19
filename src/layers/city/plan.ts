/**
 * Where the street furniture goes.
 *
 * This file is PURE: roads in metres go in, props in metres come out. No
 * three.js, no MapLibre, no DOM — which is the whole reason the placement
 * maths can be pinned down in unit tests rather than squinted at on a phone.
 *
 * The approach, and why it is this one rather than an authored city model:
 * the other games in this account (`city`, `robits`) place a hand-built
 * low-poly GLB, which is the right answer for one hand-made level and the
 * wrong answer for a planet. Here the road network is already on screen as
 * real OSM geometry, so the furniture is DERIVED from it — trees and poles at
 * intervals down the verge, signals and signs at the junctions. Walk to a
 * street that really exists and it is furnished; nothing has to be authored.
 *
 * Coordinates are metres east and south of the scene origin, matching
 * three/geo.ts. `heading` is a compass bearing in degrees — the direction the
 * prop FACES — because that is the thing tests need to assert and it converts
 * to a three yaw in one call (`bearingToYaw`).
 */

export type Vec2 = { east: number; south: number };

export type RoadClass =
  | 'motorway' | 'primary' | 'secondary' | 'tertiary'
  | 'minor' | 'service' | 'path' | 'rail';

export type Road = {
  id: number;
  kind: RoadClass;
  /** Centreline, metres east/south of the scene origin. */
  points: Vec2[];
};

export type PropKind = 'tree' | 'pole' | 'lamp' | 'trafficLight' | 'stopSign';

export type Prop = {
  kind: PropKind;
  east: number;
  south: number;
  /** Compass degrees the prop faces. */
  heading: number;
  scale: number;
};

/**
 * Every number the generated city has, in one place.
 *
 * `halfWidth` is kerb-to-centreline in metres and is the one set worth getting
 * right: everything else is positioned relative to it, so a road that is too
 * narrow here puts trees in the carriageway and one that is too wide puts them
 * inside the buildings.
 */
export const CITY = {
  /** Metres of furnished street around the camera target. */
  radius: 240,
  /** Rebuild once he has walked this far from where the last plan was made. */
  refreshStep: 70,
  halfWidth: {
    motorway: 12, primary: 9, secondary: 7.5, tertiary: 6,
    minor: 4.5, service: 3, path: 1.2, rail: 2.5,
  } as Record<RoadClass, number>,
  /** Kerb to the middle of the pavement. */
  verge: 2.6,
  treeSpacing: 24,
  lampSpacing: 38,
  poleSpacing: 52,
  /** Metres a prop may wander along the verge, so the rows are not a comb. */
  jitter: 3,
  /** Vertices this close, on two different roads, are one junction. */
  junctionTolerance: 11,
  /** Hard ceiling on drawn props. Instancing is cheap; it is not free. */
  maxProps: 1600,
} as const;

/** Road importance, for deciding what a junction gets. */
const RANK: Record<RoadClass, number> = {
  motorway: 5, primary: 4, secondary: 3, tertiary: 2,
  minor: 1, service: 0, path: -1, rail: -1,
};

/**
 * Deterministic pseudo-random in [0, 1).
 *
 * Deliberately NOT Math.random: the plan is rebuilt every time he walks 70
 * metres, and a random jitter would make every tree jump to a new spot on each
 * rebuild. Same road id, same tree, forever.
 */
export function hash01(a: number, b: number): number {
  let h = (a | 0) * 374761393 + (b | 0) * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const len = (v: Vec2) => Math.hypot(v.east, v.south);
const sub = (a: Vec2, b: Vec2): Vec2 => ({ east: a.east - b.east, south: a.south - b.south });
const dist = (a: Vec2, b: Vec2) => len(sub(a, b));

/**
 * The right-hand side of something travelling along `t`.
 *
 * Walking east, your right hand points south; walking north, it points east.
 * In (east, south) that is (-t.south, t.east) — and it is worth stating
 * because getting it backwards mirrors the entire city, which reads as
 * "the trees are in the road" rather than as a sign error.
 */
export function rightOf(t: Vec2): Vec2 {
  return { east: -t.south, south: t.east };
}

/** Compass bearing of a direction given in metres east/south. */
export function headingOf(east: number, south: number): number {
  return (Math.atan2(east, -south) * 180) / Math.PI;
}

/**
 * Keep only the parts of a polyline within `radius` of `centre`.
 *
 * Returns runs rather than one line: a road that leaves the circle and comes
 * back is two separate stretches of pavement, and joining them would draw a
 * row of trees straight across the gap.
 *
 * The segments are clipped against the circle rather than just filtered by
 * vertex. Vertex filtering looks equivalent and is not: a long straight street
 * whose two endpoints both sit outside the radius has no vertex inside it at
 * all, so it would drop out entirely — and a straight street through the
 * middle of the view is the one you are most likely to be standing on.
 */
export function clipToRadius(points: Vec2[], centre: Vec2, radius: number): Vec2[][] {
  const runs: Vec2[][] = [];
  let run: Vec2[] = [];
  const close = () => {
    if (run.length >= 2) runs.push(run);
    run = [];
  };

  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const d = sub(points[i + 1], a);
    const f = sub(a, centre);
    const A = d.east * d.east + d.south * d.south;
    if (A < 1e-12) continue;

    // |a + t*d - centre|^2 = radius^2, solved for the span of t inside.
    const B = f.east * d.east + f.south * d.south;
    const C = f.east * f.east + f.south * f.south - radius * radius;
    const disc = B * B - A * C;
    if (disc <= 0) { close(); continue; }

    const root = Math.sqrt(disc);
    const t0 = Math.max(0, (-B - root) / A);
    const t1 = Math.min(1, (-B + root) / A);
    if (t0 >= t1) { close(); continue; }

    const at = (t: number): Vec2 => ({ east: a.east + d.east * t, south: a.south + d.south * t });
    if (!run.length) run.push(at(t0));
    run.push(at(t1));
    if (t1 < 1 - 1e-9) close();
  }
  close();
  return runs;
}

export type Sample = { pos: Vec2; tan: Vec2; index: number };

/**
 * Points every `spacing` metres along a polyline, with the local direction.
 *
 * `phase` shifts where the first one lands so neighbouring streets do not all
 * start their tree rows at the corner.
 */
export function sampleAlong(points: Vec2[], spacing: number, phase = 0): Sample[] {
  const out: Sample[] = [];
  if (points.length < 2 || spacing <= 0) return out;

  let next = phase % spacing;
  let travelled = 0;
  let index = 0;

  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segLen = dist(a, b);
    if (segLen < 1e-6) continue;
    const tan = { east: (b.east - a.east) / segLen, south: (b.south - a.south) / segLen };

    while (next <= travelled + segLen) {
      const s = next - travelled;
      out.push({
        pos: { east: a.east + tan.east * s, south: a.south + tan.south * s },
        tan,
        index: index++,
      });
      next += spacing;
    }
    travelled += segLen;
  }
  return out;
}

/** Trees, lamps and telephone poles down one stretch of street. */
function furnitureAlong(road: Road, opts: typeof CITY): Prop[] {
  const props: Prop[] = [];
  const half = opts.halfWidth[road.kind] ?? 4.5;
  const off = half + opts.verge;
  const rank = RANK[road.kind];

  const place = (s: Sample, side: 1 | -1, kind: PropKind, seed: number): Prop => {
    const n = rightOf(s.tan);
    // Jitter runs ALONG the street, never across it: a tree that wanders
    // sideways ends up in the carriageway or inside a building.
    const j = (hash01(road.id, seed + s.index) - 0.5) * 2 * opts.jitter;
    const east = s.pos.east + n.east * off * side + s.tan.east * j;
    const south = s.pos.south + n.south * off * side + s.tan.south * j;
    const inward = headingOf(-n.east * side, -n.south * side);
    return {
      kind,
      east,
      south,
      // Lamps reach out over the road, so they face it. Poles line up with the
      // street so their crossarms sit square across it. A tree faces nowhere.
      heading:
        kind === 'lamp' ? inward
        : kind === 'pole' ? headingOf(s.tan.east, s.tan.south)
        : hash01(road.id, seed + s.index + 91) * 360,
      scale: kind === 'tree' ? 0.8 + hash01(road.id, seed + s.index + 7) * 0.55 : 1,
    };
  };

  // Motorways have no pavement and paths have no traffic, so neither gets the
  // full kit. Rail gets nothing at all.
  if (rank < 0 && road.kind === 'rail') return props;

  if (road.kind !== 'motorway') {
    const phase = hash01(road.id, 3) * opts.treeSpacing;
    for (const s of sampleAlong(road.points, opts.treeSpacing, phase)) {
      props.push(place(s, 1, 'tree', 100));
      props.push(place(s, -1, 'tree', 200));
    }
  }

  if (rank >= 0) {
    // Street lights alternate sides, which is how they are actually laid out —
    // lighting both kerbs of a minor road would double the count for nothing.
    const phase = hash01(road.id, 4) * opts.lampSpacing;
    for (const s of sampleAlong(road.points, opts.lampSpacing, phase)) {
      props.push(place(s, s.index % 2 === 0 ? 1 : -1, 'lamp', 300));
    }
    // Telephone poles run down ONE side of a street, chosen per street and
    // stuck to, because a line of poles that crosses the road is not a line.
    const side: 1 | -1 = hash01(road.id, 5) > 0.5 ? 1 : -1;
    const polePhase = hash01(road.id, 6) * opts.poleSpacing;
    for (const s of sampleAlong(road.points, opts.poleSpacing, polePhase)) {
      props.push(place(s, side, 'pole', 400));
    }
  }

  return props;
}

export type Junction = {
  pos: Vec2;
  /** One per road arm leaving the junction: the outward direction. */
  approaches: { out: Vec2; kind: RoadClass }[];
  rank: number;
};

/**
 * Where roads meet.
 *
 * Vector tiles split ways at junctions, so the crossing really is a shared
 * vertex rather than a line intersection to be solved for — which is why this
 * is a grid bucket over vertices and not a segment-intersection sweep. The 3x3
 * neighbourhood lookup is there because two vertices 10cm apart can still land
 * in different cells.
 */
export function findJunctions(roads: Road[], tolerance = CITY.junctionTolerance): Junction[] {
  type V = { road: Road; i: number; pos: Vec2 };
  const cells = new Map<string, V[]>();
  const key = (p: Vec2) => `${Math.floor(p.east / tolerance)}:${Math.floor(p.south / tolerance)}`;

  const all: V[] = [];
  for (const road of roads) {
    if (RANK[road.kind] < 0) continue;
    road.points.forEach((pos, i) => {
      const v = { road, i, pos };
      all.push(v);
      const k = key(pos);
      const list = cells.get(k);
      if (list) list.push(v); else cells.set(k, [v]);
    });
  }

  const used = new Set<V>();
  const out: Junction[] = [];

  for (const v of all) {
    if (used.has(v)) continue;
    const cx = Math.floor(v.pos.east / tolerance);
    const cy = Math.floor(v.pos.south / tolerance);
    const group: V[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const w of cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (!used.has(w) && dist(w.pos, v.pos) <= tolerance) group.push(w);
        }
      }
    }
    const roadIds = new Set(group.map((g) => g.road.id));
    if (roadIds.size < 2) continue;
    group.forEach((g) => used.add(g));

    const pos = {
      east: group.reduce((a, g) => a + g.pos.east, 0) / group.length,
      south: group.reduce((a, g) => a + g.pos.south, 0) / group.length,
    };

    const approaches: Junction['approaches'] = [];
    for (const g of group) {
      for (const j of [g.i - 1, g.i + 1]) {
        const nb = g.road.points[j];
        if (!nb) continue;
        const d = sub(nb, g.pos);
        const l = len(d);
        if (l < 1e-6) continue;
        approaches.push({ out: { east: d.east / l, south: d.south / l }, kind: g.road.kind });
      }
    }
    if (!approaches.length) continue;

    out.push({ pos, approaches, rank: Math.max(...group.map((g) => RANK[g.road.kind])) });
  }

  return out;
}

/**
 * Signals and signs on the approaches to a junction.
 *
 * Each one sits on the NEAR-RIGHT corner for the driver arriving down that arm
 * and FACES that driver, which is where every one of these is in the real
 * world and is the thing the tests pin. A driver on the arm travels toward the
 * junction — the opposite of the arm's outward direction — so their right hand
 * is `rightOf(-out)`, and the sign's face points back along `out`.
 */
export function controlsAt(junctions: Junction[], opts: typeof CITY): Prop[] {
  const props: Prop[] = [];
  for (const j of junctions) {
    // Anything secondary or better gets a mast-arm signal; the rest get a stop
    // sign. Nobody signals a junction of two service roads.
    const kind: PropKind = j.rank >= 3 ? 'trafficLight' : 'stopSign';
    for (const a of j.approaches) {
      const off = (opts.halfWidth[a.kind] ?? 4.5) + opts.verge;
      const drive = { east: -a.out.east, south: -a.out.south };
      const right = rightOf(drive);
      props.push({
        kind,
        east: j.pos.east + a.out.east * off + right.east * off,
        south: j.pos.south + a.out.south * off + right.south * off,
        heading: headingOf(a.out.east, a.out.south),
        scale: 1,
      });
    }
  }
  return props;
}

/**
 * The whole plan: roads in, props out.
 *
 * Junction controls are budgeted FIRST and furniture fills what is left. A
 * plain distance sort over everything would let a dense block of street trees
 * push the traffic lights out of frame, and a junction with no signal reads as
 * a bug in a way that a slightly thinner row of trees never does.
 */
export function planCity(roads: Road[], centre: Vec2, opts = CITY): Prop[] {
  const clipped: Road[] = [];
  for (const road of roads) {
    clipToRadius(road.points, centre, opts.radius).forEach((points, i) => {
      clipped.push({ id: road.id * 31 + i, kind: road.kind, points });
    });
  }

  const byDistance = (a: Prop, b: Prop) =>
    Math.hypot(a.east - centre.east, a.south - centre.south) -
    Math.hypot(b.east - centre.east, b.south - centre.south);

  const controls = controlsAt(findJunctions(clipped, opts.junctionTolerance), opts).sort(byDistance);
  const kept = controls.slice(0, opts.maxProps);

  const furniture: Prop[] = [];
  for (const road of clipped) furniture.push(...furnitureAlong(road, opts));
  furniture.sort(byDistance);

  return kept.concat(furniture.slice(0, Math.max(0, opts.maxProps - kept.length)));
}

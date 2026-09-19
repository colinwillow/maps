import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash01, type Vec2 } from './plan';
import {
  BUILDINGS, familyFor, footprintArea, hipRoofGeometry, outwardSign, roofGeometry,
  roofProps, sectionsFor, wallGeometry, type Family, type Footprint,
} from './buildings';
import { facadeMaterial, roofColour, roofMaterial } from './facades';

/**
 * Turn footprints into the scene.
 *
 * Every building of a family shares one material so that the whole city comes
 * down to roughly fifteen draw calls rather than one per building; the
 * per-building colour variation rides in a vertex colour attribute instead,
 * which is the only way to have both.
 */

/** Give a geometry a flat per-vertex colour, and make it mergeable. */
function tint(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const flat = g.getIndex() ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  const n = flat.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return flat;
}

/** A subtle per-building shift, so a street is not one flat colour. */
function buildingTint(id: number): THREE.Color {
  const l = 0.88 + hash01(id, 11) * 0.24;
  const warm = (hash01(id, 13) - 0.5) * 0.08;
  return new THREE.Color(l + warm, l, l - warm);
}

const centroidOf = (ring: Vec2[]) => ({
  east: ring.reduce((s, p) => s + p.east, 0) / ring.length,
  south: ring.reduce((s, p) => s + p.south, 0) / ring.length,
});

export function buildBuildings(
  footprints: Footprint[],
  centre: Vec2,
  opts = BUILDINGS,
): { group: THREE.Group; dispose(): void; count: number } {
  // Nearest first, so the cap drops the buildings you are least likely to be
  // looking at rather than whichever tile happened to arrive last.
  const near = footprints
    .filter((fp) => fp.rings.length && fp.rings[0].length >= 3 && footprintArea(fp) >= opts.minArea)
    .map((fp) => {
      const c = centroidOf(fp.rings[0]);
      return { fp, d: Math.hypot(c.east - centre.east, c.south - centre.south) };
    })
    .filter((x) => x.d <= opts.radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, opts.maxBuildings);

  const buckets = new Map<string, { material: THREE.Material; geoms: THREE.BufferGeometry[] }>();
  const put = (key: string, material: THREE.Material, g: THREE.BufferGeometry | null) => {
    if (!g) return;
    const b = buckets.get(key) ?? { material, geoms: [] };
    b.geoms.push(g);
    buckets.set(key, b);
  };

  for (const { fp } of near) {
    const area = footprintArea(fp);
    const family: Family = familyFor(fp, area);
    const f = opts.family[family];
    const colour = buildingTint(fp.id);
    const top = Math.max(fp.minHeight + 2, fp.height);

    // A building PART starting partway up gets no shopfront and no cornice —
    // it is the middle of something, not a building in its own right.
    const sections = fp.minHeight > 0.5
      ? [{ kind: 'body' as const, from: fp.minHeight, to: top,
           storeys: Math.max(1, Math.round((top - fp.minHeight) / f.storey)) }]
      : sectionsFor(family, top);

    for (const s of sections) {
      const vSpan = (s.to - s.from) / Math.max(1, s.storeys);
      fp.rings.forEach((ring, i) => {
        if (ring.length < 3) return;
        put(`w:${family}:${s.kind}`, facadeMaterial(family, s.kind),
          tint(wallGeometry(ring, s.from, s.to, f.bay, vSpan, outwardSign(ring, i === 0)), colour));
      });
    }

    const roofTint = roofColour(family).clone().multiplyScalar(0.92 + hash01(fp.id, 17) * 0.18);
    if (family === 'house' && f.ridge > 0) {
      put(`r:${family}`, roofMaterial(), tint(hipRoofGeometry(fp.rings[0], top, f.ridge)!, roofTint));
    } else {
      const roof = roofGeometry(fp.rings, top);
      if (roof) { roof.deleteAttribute('uv'); put(`r:${family}`, roofMaterial(), tint(roof, roofTint)); }
    }

    for (const p of roofProps(fp, family)) {
      const box = new THREE.BoxGeometry(p.w, p.h, p.d);
      box.translate(p.east, top + p.h / 2, p.south);
      box.deleteAttribute('uv');
      put(`r:${family}`, roofMaterial(), tint(box, roofTint.clone().multiplyScalar(0.88)));
    }
  }

  const group = new THREE.Group();
  group.name = 'city-buildings';
  const owned: THREE.BufferGeometry[] = [];
  for (const [, b] of buckets) {
    if (!b.geoms.length) continue;
    const merged = mergeGeometries(b.geoms, false);
    b.geoms.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, b.material);
    // The batch spans the whole neighbourhood; culling it as one object pops
    // the entire city out the moment its origin leaves the frustum.
    mesh.frustumCulled = false;
    group.add(mesh);
    owned.push(merged);
  }

  return {
    group,
    count: near.length,
    dispose() {
      owned.forEach((g) => g.dispose());
      group.clear();
    },
  };
}

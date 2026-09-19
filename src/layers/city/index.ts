import type maplibregl from 'maplibre-gl';
import type { ThreeLayer } from '../three/ThreeLayer';
import { buildProps } from './props';
import { buildBuildings } from './assemble';
import { BUILDINGS, type Footprint } from './buildings';
import { CITY, planCity, type Prop, type Road, type RoadClass, type Vec2 } from './plan';

/**
 * The generated city: street furniture derived from the roads that are already
 * on screen.
 *
 * It reads the SAME vector tiles the basemap draws, so nothing is authored and
 * nothing can drift out of step with the map — walk down a street that exists
 * in OSM and it has trees, lamps, poles and the right kind of junction
 * control. Buildings are deliberately not here: OpenMapTiles carries real
 * footprints and real heights, so the fill-extrusion layer in the basemap is
 * already drawing the true city, and re-extruding it in three would be a
 * second copy of the same boxes fighting the first for the same pixels.
 *
 * It lives in the character's Three scene rather than owning one, because the
 * brief's rule is one renderer and one scene for all 3D on the map.
 */

/** OpenMapTiles `class` values, narrowed to the kinds the planner knows. */
function roadClass(cls: unknown): RoadClass | null {
  switch (cls) {
    case 'motorway': return 'motorway';
    case 'trunk':
    case 'primary': return 'primary';
    case 'secondary': return 'secondary';
    case 'tertiary': return 'tertiary';
    case 'minor': return 'minor';
    case 'service': return 'service';
    case 'path':
    case 'track': return 'path';
    case 'rail':
    case 'transit': return 'rail';
    default: return null;
  }
}

function stableId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class CityProps {
  private built: { group: import('three').Group; dispose(): void } | null = null;
  private town: { group: import('three').Group; dispose(): void; count: number } | null = null;
  private lastCentre: Vec2 | null = null;
  private roads: Road[] = [];
  private footprints: Footprint[] = [];
  private signature = '';
  private buildingSignature = '';
  private count = 0;

  constructor(private three: ThreeLayer) {}

  /** Props currently in the scene — the test hook, and the HUD's count. */
  get propCount() {
    return this.count;
  }

  /** Buildings currently in the scene. */
  get buildingCount() {
    return this.town?.count ?? 0;
  }

  /**
   * Hand the generator its road network directly.
   *
   * This is the seam the browser test drives: real tiles need a network the
   * test environment does not have, so the test supplies synthetic streets and
   * everything downstream — planning, geometry, instancing, placement on
   * screen — is the code that actually ships.
   */
  setRoads(roads: Road[]) {
    this.roads = roads;
    this.signature = `set:${roads.length}`;
    this.lastCentre = null;
  }

  /** The same seam for buildings, for the same reason. */
  setFootprints(footprints: Footprint[]) {
    this.footprints = footprints;
    this.buildingSignature = `set:${footprints.length}`;
    this.lastCentre = null;
  }

  /**
   * Pull building footprints out of the loaded tiles.
   *
   * `render_height` and `render_min_height` are OpenMapTiles' own fields, so
   * the massing is the real massing — the generated part is everything that
   * makes a box read as a building. render_min_height matters: without it,
   * anything mapped as a part sitting on top of something else grows from the
   * ground and buildings sprout spikes.
   */
  readBuildings(map: maplibregl.Map): boolean {
    let feats: maplibregl.GeoJSONFeature[] = [];
    try {
      feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'building' });
    } catch {
      return false;
    }

    const frame = this.three.frame;
    const seen = new Set<string>();
    const out: Footprint[] = [];

    for (const f of feats) {
      const g = f.geometry;
      const polys: number[][][][] =
        g.type === 'Polygon' ? [g.coordinates as number[][][]]
        : g.type === 'MultiPolygon' ? (g.coordinates as number[][][][])
        : [];

      for (const poly of polys) {
        if (!poly.length || poly[0].length < 4) continue;
        const key = `${f.id ?? 'x'}:${poly[0][0][0].toFixed(6)},${poly[0][0][1].toFixed(6)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          id: stableId(key),
          // GeoJSON rings repeat their first point last; the wall builder
          // closes the ring itself, so a duplicate would add a zero-length
          // edge and, worse, a degenerate quad.
          rings: poly
            .map((ring) => ring.slice(0, -1).map(([lng, lat]) => frame.toMeters({ lng, lat })))
            .filter((ring) => ring.length >= 3),
          height: Number(f.properties?.render_height ?? 0) || 6,
          minHeight: Number(f.properties?.render_min_height ?? 0) || 0,
        });
      }
    }

    if (!out.length) return false;
    const signature = `${out.length}:${out.reduce((h, b) => (h ^ b.id) >>> 0, 0)}`;
    if (signature === this.buildingSignature) return false;
    this.buildingSignature = signature;
    this.footprints = out;
    this.lastCentre = null;
    return true;
  }

  /**
   * Pull the road network out of the vector tiles currently loaded.
   *
   * Features repeat: one way crosses several tiles and the cache can hold more
   * than one zoom of the same area. Keyed on id AND first coordinate, because
   * keying on id alone throws away every piece of a road but one, and keying
   * on neither plants four trees in the same hole.
   */
  readRoads(map: maplibregl.Map): boolean {
    let feats: maplibregl.GeoJSONFeature[] = [];
    try {
      feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation' });
    } catch {
      return false; // no vector source (offline fallback style) — nothing to furnish
    }

    const frame = this.three.frame;
    const seen = new Set<string>();
    const roads: Road[] = [];

    for (const f of feats) {
      const kind = roadClass(f.properties?.class);
      if (!kind) continue;
      if (f.properties?.brunnel === 'tunnel') continue;

      const g = f.geometry;
      const lines: number[][][] =
        g.type === 'LineString' ? [g.coordinates as number[][]]
        : g.type === 'MultiLineString' ? (g.coordinates as number[][][])
        : [];

      for (const line of lines) {
        if (line.length < 2) continue;
        const key = `${f.id ?? 'x'}:${line[0][0].toFixed(6)},${line[0][1].toFixed(6)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        roads.push({
          id: stableId(key),
          kind,
          points: line.map(([lng, lat]) => frame.toMeters({ lng, lat })),
        });
      }
    }

    // Nothing found does NOT mean "demolish the city". Tiles come and go as
    // you move, and a momentary empty query would otherwise strip every tree
    // off the street you are standing in and put them straight back.
    if (!roads.length) return false;

    // Only report a change when there actually is one. Tiles settle several
    // times a second while a block loads in, and rebuilding a couple of
    // thousand props each time — for an identical answer — is exactly the kind
    // of thing that makes walking choppy.
    const signature = `${roads.length}:${roads.reduce((h, r) => (h ^ r.id) >>> 0, 0)}`;
    if (signature === this.signature) return false;
    this.signature = signature;
    this.roads = roads;
    this.lastCentre = null;
    return true;
  }

  /**
   * Rebuild the furniture around a point, if he has walked far enough.
   *
   * Cheap to call every frame — it does nothing until he has covered
   * `refreshStep` metres, which is what keeps a walk from re-planning a couple
   * of thousand props sixty times a second.
   */
  refresh(centre: Vec2, force = false) {
    if (!force && this.lastCentre) {
      const moved = Math.hypot(centre.east - this.lastCentre.east, centre.south - this.lastCentre.south);
      if (moved < CITY.refreshStep) return;
    }
    this.lastCentre = { ...centre };
    this.apply(planCity(this.roads, centre));

    const town = buildBuildings(this.footprints, centre, BUILDINGS);
    this.three.scene.add(town.group);
    if (this.town) {
      this.three.scene.remove(this.town.group);
      this.town.dispose();
    }
    this.town = town;
  }

  private apply(props: Prop[]) {
    const next = buildProps(props);
    // Swap, THEN dispose. Disposing first leaves a frame with nothing drawn,
    // which reads as the city blinking every time he crosses a block.
    this.three.scene.add(next.group);
    if (this.built) {
      this.three.scene.remove(this.built.group);
      this.built.dispose();
    }
    this.built = next;
    this.count = props.length;
    this.three.requestRedraw();
  }

  dispose() {
    if (this.town) {
      this.three.scene.remove(this.town.group);
      this.town.dispose();
      this.town = null;
    }
    if (!this.built) return;
    this.three.scene.remove(this.built.group);
    this.built.dispose();
    this.built = null;
    this.count = 0;
  }
}

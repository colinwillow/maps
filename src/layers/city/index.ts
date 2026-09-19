import type maplibregl from 'maplibre-gl';
import type { ThreeLayer } from '../three/ThreeLayer';
import { buildProps } from './props';
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
  private lastCentre: Vec2 | null = null;
  private roads: Road[] = [];
  private signature = '';
  private count = 0;

  constructor(private three: ThreeLayer) {}

  /** Props currently in the scene — the test hook, and the HUD's count. */
  get propCount() {
    return this.count;
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
    if (!this.built) return;
    this.three.scene.remove(this.built.group);
    this.built.dispose();
    this.built = null;
    this.count = 0;
  }
}

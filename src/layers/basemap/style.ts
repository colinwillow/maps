import type { StyleSpecification, LayerSpecification } from 'maplibre-gl';
import { PALETTE as C, TYPE as T, PROJECTION } from './tokens';

/**
 * "Field guide Portland" — the project's own cartography, built over
 * MapTiler's OpenMapTiles vector schema.
 *
 * Every colour and font comes from tokens.ts; there are no literals here, and
 * tests/style.test.ts fails the build if one creeps in.
 *
 * Layer order is bottom-up, exactly as MapLibre draws it: ground, then green,
 * then water, then buildings, then roads, then bridges, then labels. Roads
 * cross water; bridges sit above both so a span reads as a span.
 */

const SRC = 'openmaptiles';

// OSM attribution is a licence requirement, not a courtesy — it rides on the
// source so it cannot be dropped by editing the map's controls.
const ATTRIBUTION =
  '<a href="https://www.maptiler.com/copyright/" target="_blank">&copy; MapTiler</a> ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>';

/** Zoom-interpolated line width: [z, w] pairs into a MapLibre interpolate. */
const widthRamp = (stops: [number, number][]) =>
  ['interpolate', ['linear'], ['zoom'], ...stops.flat()] as unknown as number;

const fillLayer = (
  id: string,
  sourceLayer: string,
  color: string,
  extra: Partial<LayerSpecification> = {},
): LayerSpecification =>
  ({
    id,
    type: 'fill',
    source: SRC,
    'source-layer': sourceLayer,
    paint: { 'fill-color': color, 'fill-antialias': true },
    ...extra,
  }) as LayerSpecification;

const roadLayer = (
  id: string,
  filter: unknown,
  color: string,
  stops: [number, number][],
  extra: Record<string, unknown> = {},
): LayerSpecification =>
  ({
    id,
    type: 'line',
    source: SRC,
    'source-layer': 'transportation',
    filter,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': widthRamp(stops) },
    ...extra,
  }) as LayerSpecification;

// Roads are matched by OpenMapTiles `class`. Bridges are pulled out of the
// normal road layers by brunnel so they can be drawn as their own stroke.
const notBridge = ['!=', ['get', 'brunnel'], 'bridge'];
const isBridge = ['==', ['get', 'brunnel'], 'bridge'];
const isClass = (...classes: string[]) => ['match', ['get', 'class'], classes, true, false];

const label = (
  id: string,
  sourceLayer: string,
  color: string,
  font: readonly string[],
  size: unknown,
  extra: Record<string, unknown> = {},
): LayerSpecification =>
  ({
    id,
    type: 'symbol',
    source: SRC,
    'source-layer': sourceLayer,
    layout: {
      'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
      'text-font': [...font],
      'text-size': size,
      ...((extra.layout as object) ?? {}),
    },
    paint: {
      'text-color': color,
      'text-halo-color': C.halo,
      'text-halo-width': T.haloWidth,
      'text-halo-blur': T.haloBlur,
      ...((extra.paint as object) ?? {}),
    },
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'layout' && k !== 'paint')),
  }) as LayerSpecification;

/**
 * Layers hidden when satellite imagery is switched on, so the photograph is
 * not buried under the illustrated ground it is meant to replace.
 */
export const LAND_FILL_LAYERS = [
  'landcover-wood',
  'landcover-grass',
  'landcover-ice',
  'landuse-urban',
  'park',
];

export function buildStyle(maptilerKey: string): StyleSpecification {
  const key = encodeURIComponent(maptilerKey);

  return {
    version: 8,
    name: 'Field Guide Portland',
    projection: { type: PROJECTION },
    glyphs: `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${key}`,
    sources: {
      [SRC]: {
        type: 'vector',
        url: `https://api.maptiler.com/tiles/v3/tiles.json?key=${key}`,
        attribution: ATTRIBUTION,
      },
      // Real aerial imagery, off by default. Google's photogrammetry is not
      // usable here — their terms require their own SDK and branding — but
      // MapTiler serves satellite raster on the same key the vector tiles use.
      satellite: {
        type: 'raster',
        url: `https://api.maptiler.com/tiles/satellite-v2/tiles.json?key=${key}`,
        tileSize: 512,
        attribution: ATTRIBUTION,
      },
    },
    layers: [
      // Land. Warmer and deeper at world zoom so continents read against the
      // ocean, easing to paper by the time you are over a city.
      {
        id: 'ground',
        type: 'background',
        paint: {
          'background-color': [
            'interpolate', ['linear'], ['zoom'], 0, C.landWorld, 4, C.landWorld, 7, C.paper,
          ],
        },
      },

      {
        // Hidden until asked for: 'none' means MapLibre never requests the
        // tiles, so leaving it in the style costs nothing until it is on.
        id: 'satellite',
        type: 'raster',
        source: 'satellite',
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 1 },
      } as LayerSpecification,

      // ── green and landuse: washes, barely there ────────────────────────
      fillLayer('landcover-wood', 'landcover', C.woodland, {
        filter: ['match', ['get', 'class'], ['wood', 'forest'], true, false],
        paint: { 'fill-color': C.woodland, 'fill-opacity': 0.7 },
      }),
      fillLayer('landcover-grass', 'landcover', C.grass, {
        filter: ['match', ['get', 'class'], ['grass', 'meadow', 'scrub'], true, false],
        paint: { 'fill-color': C.grass, 'fill-opacity': 0.6 },
      }),
      fillLayer('landuse-urban', 'landuse', C.paperShade, {
        filter: ['match', ['get', 'class'], ['residential', 'commercial', 'industrial'], true, false],
        paint: { 'fill-color': C.paperShade, 'fill-opacity': 0.55 },
      }),
      fillLayer('park', 'park', C.grass, {
        paint: { 'fill-color': C.grass, 'fill-opacity': 0.55 },
      }),

      // ── the Willamette: the only saturated colour on the map ───────────
      // Ice: Antarctica and Greenland. Two white caps are the single strongest
      // cue that a sphere is the Earth, and they cost one layer.
      fillLayer('landcover-ice', 'landcover', C.ice, {
        filter: ['match', ['get', 'class'], ['ice', 'glacier'], true, false],
        paint: { 'fill-color': C.ice, 'fill-opacity': 0.9 },
      }),

      fillLayer('water', 'water', C.water, {
        paint: {
          'fill-color': [
            'interpolate', ['linear'], ['zoom'],
            0, ['match', ['get', 'class'], 'ocean', C.oceanWorld, C.oceanWorld],
            4, ['match', ['get', 'class'], 'ocean', C.oceanWorld, C.water],
            7, ['match', ['get', 'class'], 'ocean', C.waterDeep, C.water],
          ],
        },
      }),
      {
        id: 'water-shoreline',
        type: 'line',
        source: SRC,
        'source-layer': 'water',
        paint: {
          'line-color': C.waterEdge,
          // Visible from world zoom: at 0.4px the coastline vanishes and the
          // continents lose their edges, which is most of what makes a globe
          // read as a planet rather than a blob.
          'line-width': widthRamp([[0, 0.8], [4, 1.1], [8, 0.6], [12, 0.9], [16, 1.6]]),
        },
      },
      {
        id: 'waterway',
        type: 'line',
        source: SRC,
        'source-layer': 'waterway',
        paint: { 'line-color': C.water, 'line-width': widthRamp([[9, 0.6], [14, 2], [18, 5]]) },
      },

      // ── buildings ───────────────────────────────────────────────────────
      // Flat footprints at mid zoom, real extrusions once you are close
      // enough for them to mean anything. The extrusions fade in as the
      // footprints fade out, so there is no zoom where the city pops.
      fillLayer('building', 'building', C.building, {
        minzoom: 13,
        maxzoom: 16,
        paint: {
          'fill-color': C.building,
          'fill-outline-color': C.buildingEdge,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, 0.9, 15.5, 0],
        },
      }),
      {
        // Phase 4: OSM footprints extruded with MapLibre's own layer type, no
        // Three.js. The OpenMapTiles schema carries render_height and
        // render_min_height on the building layer, which is the whole reason
        // this costs one layer rather than a data pipeline. render_min_height
        // matters: without it, anything mapped as a part sitting on top of
        // something else grows from the ground and buildings grow spikes.
        id: 'building-3d',
        type: 'fill-extrusion',
        source: SRC,
        'source-layer': 'building',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 0],
            0, C.buildingRoof,
            25, C.buildingRoof,
            80, C.buildingTall,
          ],
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 3],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          // Fades in over the same range the flat fill fades out.
          'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 0.92],
          // Shades the walls darker than the roof, which is what gives the
          // massing form without a light rig.
          'fill-extrusion-vertical-gradient': true,
        },
      } as LayerSpecification,

      // ── roads: warm ink lines, casings only where they earn their keep ──
      roadLayer('road-path', [
        'all', notBridge, isClass('path', 'track'),
      ], C.ink, [[14, 0.4], [18, 1.4]], {
        paint: { 'line-color': C.ink, 'line-width': widthRamp([[14, 0.4], [18, 1.4]]), 'line-dasharray': [2, 2] },
      }),
      roadLayer('road-minor', ['all', notBridge, isClass('minor', 'service')], C.ink,
        [[12, 0.4], [15, 1.4], [18, 6]]),
      roadLayer('road-tertiary', ['all', notBridge, isClass('tertiary')], C.inkMid,
        [[11, 0.6], [15, 2.2], [18, 8]]),
      roadLayer('road-secondary', ['all', notBridge, isClass('secondary')], C.inkMid,
        [[10, 0.8], [15, 3], [18, 11]]),
      roadLayer('road-primary', ['all', notBridge, isClass('primary', 'trunk')], C.inkStrong,
        [[9, 1], [15, 4], [18, 14]]),
      roadLayer('road-motorway', ['all', notBridge, isClass('motorway')], C.inkStrong,
        [[8, 1.2], [15, 5], [18, 18]]),
      {
        id: 'rail',
        type: 'line',
        source: SRC,
        'source-layer': 'transportation',
        filter: isClass('rail', 'transit') as never,
        paint: {
          'line-color': C.inkRail,
          'line-width': widthRamp([[12, 0.5], [18, 2.5]]),
          'line-dasharray': [3, 2],
        },
      },

      // ── bridges: the strongest strokes on the map ──────────────────────
      // Drawn above water and road so a span reads as crossing something.
      roadLayer('bridge-casing', isBridge, C.bridge,
        [[11, 2.4], [15, 7], [18, 22]], {
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': C.bridge, 'line-width': widthRamp([[11, 2.4], [15, 7], [18, 22]]), 'line-opacity': 0.55 },
      }),
      roadLayer('bridge', isBridge, C.paper,
        [[11, 1], [15, 3.4], [18, 12]], {
        paint: { 'line-color': C.paper, 'line-width': widthRamp([[11, 1], [15, 3.4], [18, 12]]) },
      }),

      {
        id: 'boundary',
        type: 'line',
        source: SRC,
        'source-layer': 'boundary',
        filter: ['<=', ['get', 'admin_level'], 6] as never,
        paint: {
          'line-color': C.boundary,
          'line-width': widthRamp([[0, 0.5], [3, 0.8], [6, 0.9], [10, 1.4]]),
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.75, 6, 0.55],
          'line-dasharray': [4, 3],
        },
      },

      // ── labels ─────────────────────────────────────────────────────────
      label('label-water', 'water_name', C.labelWater, T.italic,
        ['interpolate', ['linear'], ['zoom'], 10, 11, 16, 16], {
        layout: { 'symbol-placement': 'line', 'text-letter-spacing': 0.18, 'text-max-width': 8 },
      }),
      label('label-road', 'transportation_name', C.labelSoft, T.regular,
        ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 13], {
        minzoom: 13,
        layout: { 'symbol-placement': 'line', 'text-max-angle': 30, 'text-padding': 4 },
      }),
      label('label-neighbourhood', 'place', C.labelSoft, T.strong,
        ['interpolate', ['linear'], ['zoom'], 12, 10, 16, 14], {
        minzoom: 12,
        filter: ['match', ['get', 'class'], ['suburb', 'neighbourhood', 'quarter'], true, false],
        layout: { 'text-letter-spacing': 0.12, 'text-transform': 'uppercase', 'text-max-width': 8 },
      }),
      label('label-town', 'place', C.label, T.strong,
        ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 16], {
        filter: ['match', ['get', 'class'], ['town', 'village'], true, false],
      }),
      label('label-city', 'place', C.label, T.display,
        ['interpolate', ['linear'], ['zoom'], 5, 12, 12, 22], {
        filter: ['match', ['get', 'class'], ['city'], true, false],
        layout: { 'text-letter-spacing': 0.04, 'text-max-width': 9 },
      }),
    ],
  } as StyleSpecification;
}

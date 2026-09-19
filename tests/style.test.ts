import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createPropertyExpression, latest, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { buildStyle } from '../src/layers/basemap/style';
import { PALETTE, PROJECTION } from '../src/layers/basemap/tokens';
import { CITY } from '../src/layers/city/plan';

const style = buildStyle('TESTKEY123');
const ids = style.layers.map((l) => l.id);

describe('field guide Portland style', () => {
  // The load-bearing check: the real MapLibre style validator. This is what
  // stands in for "look at it", since this sandbox cannot fetch a vector tile.
  it('validates against the MapLibre style spec with zero errors', () => {
    const errors = validateStyleMin(style);
    expect(errors.map((e) => `${e.message}`)).toEqual([]);
  });

  it('declares the projection the token asks for', () => {
    expect(style.projection?.type).toBe(PROJECTION);
  });

  it('credits OpenStreetMap and MapTiler on the source', () => {
    const src = style.sources.openmaptiles as { attribution?: string };
    expect(src.attribution).toMatch(/OpenStreetMap/);
    expect(src.attribution).toMatch(/MapTiler/);
  });

  it('passes the key to both tiles and glyphs', () => {
    expect(JSON.stringify(style.sources)).toContain('TESTKEY123');
    expect(style.glyphs).toContain('TESTKEY123');
  });

  it('url-encodes the key rather than interpolating it raw', () => {
    expect(buildStyle('a b&c').glyphs).toContain('a%20b%26c');
  });

  it('has no duplicate layer ids', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every layer points at a source that exists', () => {
    for (const layer of style.layers) {
      if (layer.type === 'background') continue;
      expect(Object.keys(style.sources)).toContain((layer as { source: string }).source);
    }
  });

  // Cartographic ordering is the thing that would look wrong rather than throw.
  // Ask what each check would still pass with: "bridges exist" would pass with
  // bridges painted underneath the river, which is the actual failure mode.
  it('draws bridges above both water and roads', () => {
    const water = ids.indexOf('water');
    const road = ids.indexOf('road-motorway');
    const bridge = ids.indexOf('bridge');
    expect(water).toBeGreaterThanOrEqual(0);
    expect(bridge).toBeGreaterThan(water);
    expect(bridge).toBeGreaterThan(road);
  });

  it('draws its bridge deck above its own casing', () => {
    expect(ids.indexOf('bridge')).toBeGreaterThan(ids.indexOf('bridge-casing'));
  });

  it('draws every label above every non-label layer', () => {
    const labels = style.layers.filter((l) => l.type === 'symbol').map((l) => ids.indexOf(l.id));
    const others = style.layers.filter((l) => l.type !== 'symbol').map((l) => ids.indexOf(l.id));
    expect(Math.min(...labels)).toBeGreaterThan(Math.max(...others));
  });

  it('keeps roads off the water fill', () => {
    expect(ids.indexOf('road-motorway')).toBeGreaterThan(ids.indexOf('water'));
  });

  // The brief bans the two clichés. Saturation is spent on the river only, so
  // no road may be painted in a water colour and vice versa.
  it('spends its saturation on water, not on roads', () => {
    const waterish = [PALETTE.water, PALETTE.waterDeep, PALETTE.waterEdge] as string[];
    for (const layer of style.layers) {
      if (!layer.id.startsWith('road-') && layer.id !== 'rail') continue;
      const paint = JSON.stringify((layer as { paint?: unknown }).paint ?? {});
      for (const c of waterish) expect(paint).not.toContain(c);
    }
  });

  it('gives every label a halo, for daylight legibility', () => {
    for (const layer of style.layers) {
      if (layer.type !== 'symbol') continue;
      const paint = (layer as { paint?: Record<string, unknown> }).paint ?? {};
      expect(paint['text-halo-color']).toBeDefined();
      expect(paint['text-halo-width']).toBeGreaterThan(0);
    }
  });
});

describe('extruded buildings', () => {
  const layer = style.layers.find((l) => l.id === 'building-3d') as
    | (import('maplibre-gl').FillExtrusionLayerSpecification)
    | undefined;

  it('exists, and is a real extrusion rather than a flat fill', () => {
    expect(layer).toBeDefined();
    expect(layer!.type).toBe('fill-extrusion');
  });

  it('takes its height from the tile data, not a constant', () => {
    expect(JSON.stringify(layer!.paint!['fill-extrusion-height'])).toContain('render_height');
  });

  // Without render_min_height, anything mapped as a part sitting on top of
  // something else is extruded from the ground instead, and buildings grow
  // spikes. Pinning the base is the difference between a skyline and a bug.
  it('starts from render_min_height, so roof parts do not grow spikes', () => {
    expect(JSON.stringify(layer!.paint!['fill-extrusion-base'])).toContain('render_min_height');
  });

  it('never draws while the globe is still round', () => {
    // The 3D layers only make sense on the mercator plane; MapLibre has
    // finished blending out of globe well before this zoom.
    expect(layer!.minzoom).toBeGreaterThanOrEqual(12);
  });

  it('is drawn above the flat footprints and below every label', () => {
    const flat = ids.indexOf('building');
    const extruded = ids.indexOf('building-3d');
    const firstLabel = Math.min(
      ...style.layers.filter((l) => l.type === 'symbol').map((l) => ids.indexOf(l.id)),
    );
    expect(extruded).toBeGreaterThan(flat);
    expect(extruded).toBeLessThan(firstLabel);
  });

  it('hands over from the flat fill rather than doubling up on it', () => {
    const flat = style.layers.find((l) => l.id === 'building') as
      | import('maplibre-gl').FillLayerSpecification
      | undefined;
    // The footprints stop being drawn at the zoom the extrusions take over.
    expect(flat!.maxzoom).toBeDefined();
    expect(flat!.maxzoom!).toBeGreaterThan(layer!.minzoom!);
  });
});

describe('satellite ground', () => {
  const sat = style.layers.find((l) => l.id === 'satellite');

  it('is in the style but switched off', () => {
    expect(sat).toBeDefined();
    expect(sat!.type).toBe('raster');
    // 'none' means MapLibre never requests the imagery tiles, so shipping the
    // layer costs nothing until someone asks for it.
    expect((sat as { layout?: { visibility?: string } }).layout?.visibility).toBe('none');
  });

  it('sits under the roads and labels, so the cartography survives', () => {
    const satIdx = ids.indexOf('satellite');
    expect(satIdx).toBeGreaterThan(ids.indexOf('ground'));
    expect(satIdx).toBeLessThan(ids.indexOf('road-motorway'));
    const firstLabel = Math.min(
      ...style.layers.filter((l) => l.type === 'symbol').map((l) => ids.indexOf(l.id)),
    );
    expect(satIdx).toBeLessThan(firstLabel);
  });

  // The land fills would paint straight over the photograph they replace.
  it('names every land fill that has to come off with it', async () => {
    const { LAND_FILL_LAYERS } = await import('../src/layers/basemap/style');
    for (const id of LAND_FILL_LAYERS) expect(ids).toContain(id);
    const fills = style.layers
      .filter((l) => l.type === 'fill' && !l.id.startsWith('place') && l.id !== 'water' && l.id !== 'building')
      .map((l) => l.id);
    for (const id of fills) expect(LAND_FILL_LAYERS).toContain(id);
  });
});

describe('token discipline', () => {
  // A palette change must be one edit in tokens.ts, not forty across style.ts.
  const src = readFileSync(new URL('../src/layers/basemap/style.ts', import.meta.url), 'utf8');

  it('contains no raw hex colours', () => {
    expect(src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });

  it('contains no inline font names', () => {
    expect(src.match(/['"](?:Open Sans|Noto Sans|Roboto|Metropolis)[^'"]*['"]/g) ?? []).toEqual([]);
  });
});

/**
 * Street zoom is a different medium from map zoom, and the style has to work
 * at both. The camera in street view sits at zoom 22.4, where one pixel is a
 * centimetre — so a "6 pixel" road is six centimetres of ink and the ground
 * reads as blank paper. That is what these pin.
 */
describe('roads at street zoom', () => {
  const paintOf = (id: string, prop: string) =>
    (style.layers.find((l) => l.id === id) as unknown as { paint: Record<string, unknown> })
      .paint[prop];

  /** Evaluate a paint expression the way MapLibre itself would. */
  const evalAt = (id: string, prop: string, zoom: number, properties: object = {}) => {
    const compiled = createPropertyExpression(
      paintOf(id, prop) as never,
      (latest as never as Record<string, Record<string, unknown>>)[`paint_${
        (style.layers.find((l) => l.id === id) as { type: string }).type
      }`][prop] as never,
    );
    expect(compiled.result).toBe('success');
    return (compiled as { value: { evaluate(g: object, f?: object): unknown } })
      .value.evaluate({ zoom }, { properties });
  };

  // Independent of style.ts: the plain web-mercator ground resolution.
  const mPerPx = (z: number) =>
    (40075017 * Math.cos((45.5 * Math.PI) / 180)) / (512 * 2 ** z);

  it('is a surface you can stand on, not a hairline', () => {
    // The regression this exists for: every ramp used to stop at zoom 18, and
    // MapLibre clamps an interpolate to its last stop, so a minor street was
    // six pixels wide at the street camera's zoom 22.4. It is ~900 now.
    expect(evalAt('road-minor', 'line-width', 22.4) as number).toBeGreaterThan(300);
    expect(evalAt('road-primary', 'line-width', 22.4) as number).toBeGreaterThan(600);
  });

  it('holds a constant width in METRES once it is a surface', () => {
    // Linear interpolation between the same two stops would make this street
    // 130m wide halfway up, which is the reason the ramp is exponential.
    const metres = [16, 17.5, 19, 22].map(
      (z) => (evalAt('road-minor', 'line-width', z) as number) * mPerPx(z),
    );
    for (const m of metres) expect(m).toBeCloseTo(metres[0], 4);
    expect(metres[0]).toBeGreaterThan(6);
    expect(metres[0]).toBeLessThan(14);
  });

  it('agrees with the city generator about where the kerb is', () => {
    // The cross-file invariant. If the style draws a road wider than the
    // generator thinks it is, the trees stand in the carriageway — and it
    // would look like a placement bug rather than a width one.
    const pairs: [string, keyof typeof CITY.halfWidth][] = [
      ['road-motorway', 'motorway'],
      ['road-primary', 'primary'],
      ['road-secondary', 'secondary'],
      ['road-tertiary', 'tertiary'],
      ['road-minor', 'minor'],
      ['road-service', 'service'],
      ['road-path', 'path'],
    ];
    for (const [id, kind] of pairs) {
      const metres = (evalAt(id, 'line-width', 20) as number) * mPerPx(20);
      expect(metres).toBeCloseTo(CITY.halfWidth[kind] * 2, 3);
    }
  });

  it('lays a pavement under the road, wider than the road', () => {
    const road = (evalAt('road-minor', 'line-width', 20) as number);
    const pave = (evalAt('pavement', 'line-width', 20, { class: 'minor' }) as number);
    expect(pave).toBeGreaterThan(road);
    // Wide enough to walk on: at least a metre and a half either side.
    expect((pave - road) * mPerPx(20) / 2).toBeGreaterThan(1.5);
    expect(ids.indexOf('pavement')).toBeLessThan(ids.indexOf('road-minor'));
    expect(ids.indexOf('pavement')).toBeGreaterThan(ids.indexOf('building-3d'));
  });

  it('turns from ink into asphalt as you come down to it', () => {
    // Ink is right for a line on a map and wrong for a surface underfoot.
    expect(evalAt('road-minor', 'line-color', 14)).not
      .toEqual(evalAt('road-minor', 'line-color', 19));
    // Evaluated colours come back as rgba, so compare on channels.
    const rgb = (hex: string) =>
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
    expect(String(evalAt('road-minor', 'line-color', 14))).toContain(rgb(PALETTE.ink));
    expect(String(evalAt('road-minor', 'line-color', 19))).toContain(rgb(PALETTE.asphalt));
  });
});

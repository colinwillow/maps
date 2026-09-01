import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { buildStyle } from '../src/layers/basemap/style';
import { PALETTE, PROJECTION } from '../src/layers/basemap/tokens';

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

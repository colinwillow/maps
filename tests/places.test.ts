import { describe, it, expect } from 'vitest';
import { WORLD, findPlace, pathTo, bboxPolygon } from '../src/layers/places/places';
import { childrenOf, zoomForBounds } from '../src/layers/places/index';

const everyPlace = (list = WORLD): ReturnType<typeof findPlace>[] =>
  list.flatMap((p) => [p, ...(p.children ? everyPlace(p.children) : [])]);

describe('the world tree', () => {
  it('has the seven continents at the top', () => {
    expect(WORLD).toHaveLength(7);
    expect(WORLD.every((c) => c.level === 'continent')).toBe(true);
  });

  it('descends continent, country, region, city without skipping a rung', () => {
    const order = ['continent', 'country', 'region', 'city'];
    const walk = (place: NonNullable<ReturnType<typeof findPlace>>) => {
      for (const child of place.children ?? []) {
        expect(order.indexOf(child.level)).toBe(order.indexOf(place.level) + 1);
        walk(child);
      }
    };
    WORLD.forEach(walk);
  });

  it('has one path populated the whole way down to Portland', () => {
    const trail = pathTo('portland');
    expect(trail?.map((p) => p.id)).toEqual(['north-america', 'usa', 'oregon', 'portland']);
  });

  it('gives every place a unique id', () => {
    const ids = everyPlace().map((p) => p!.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // A transposed or mis-signed bbox draws a highlight somewhere absurd and is
  // invisible in the data, so check the geometry rather than trusting typing.
  it('has a well-formed bbox for every place', () => {
    for (const place of everyPlace()) {
      const [w, s, e, n] = place!.bbox;
      expect(e).toBeGreaterThan(w);
      expect(n).toBeGreaterThan(s);
      expect(Math.abs(w)).toBeLessThanOrEqual(180);
      expect(Math.abs(e)).toBeLessThanOrEqual(180);
      expect(Math.abs(s)).toBeLessThanOrEqual(90);
      expect(Math.abs(n)).toBeLessThanOrEqual(90);
    }
  });

  it('puts every centre inside its own bbox', () => {
    for (const place of everyPlace()) {
      const [w, s, e, n] = place!.bbox;
      const [lng, lat] = place!.center;
      expect(lng).toBeGreaterThanOrEqual(w);
      expect(lng).toBeLessThanOrEqual(e);
      expect(lat).toBeGreaterThanOrEqual(s);
      expect(lat).toBeLessThanOrEqual(n);
    }
  });

  it('nests every child inside its parent, roughly', () => {
    const walk = (place: NonNullable<ReturnType<typeof findPlace>>) => {
      const [pw, ps, pe, pn] = place.bbox;
      for (const child of place.children ?? []) {
        const [lng, lat] = child.center;
        expect(lng).toBeGreaterThanOrEqual(pw - 1);
        expect(lng).toBeLessThanOrEqual(pe + 1);
        expect(lat).toBeGreaterThanOrEqual(ps - 1);
        expect(lat).toBeLessThanOrEqual(pn + 1);
        walk(child);
      }
    };
    WORLD.forEach(walk);
  });
});

describe('navigation', () => {
  it('shows the continents at the world level', () => {
    expect(childrenOf(null)).toHaveLength(7);
  });

  it('shows a place\'s own children once entered', () => {
    expect(childrenOf('oregon').map((p) => p.id)).toContain('portland');
  });

  it('returns nothing for a leaf, so a city has nothing to descend into', () => {
    expect(childrenOf('portland')).toEqual([]);
  });

  it('finds nothing for an unknown id rather than throwing', () => {
    expect(findPlace('atlantis')).toBeNull();
    expect(pathTo('atlantis')).toBeNull();
  });
});

describe('fitting a bbox', () => {
  it('zooms in further for a smaller place', () => {
    const world = zoomForBounds([-180, -85, 180, 85], 900, 600);
    const country = zoomForBounds(findPlace('usa')!.bbox, 900, 600);
    const city = zoomForBounds(findPlace('portland')!.bbox, 900, 600);
    expect(country).toBeGreaterThan(world);
    expect(city).toBeGreaterThan(country);
  });

  it('fits a narrow viewport more loosely than a wide one', () => {
    const wide = zoomForBounds(findPlace('oregon')!.bbox, 1400, 900);
    const narrow = zoomForBounds(findPlace('oregon')!.bbox, 390, 700);
    expect(wide).toBeGreaterThan(narrow);
  });

  it('stays inside sane bounds even for degenerate input', () => {
    const z = zoomForBounds([0, 0, 0, 0], 900, 600);
    expect(z).toBeGreaterThanOrEqual(0);
    expect(z).toBeLessThanOrEqual(18);
  });
});

describe('highlight geometry', () => {
  it('turns a bbox into a closed ring', () => {
    const poly = bboxPolygon([-10, -5, 10, 5]);
    const ring = poly.geometry.coordinates[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
  });
});

describe('handing over to the character', () => {
  it('stops before street zoom, so it cannot steal walk-here taps', async () => {
    const { PLACE_MAXZOOM } = await import('../src/layers/places/index');
    const { CAMERA } = await import('../src/layers/character/index');
    expect(PLACE_MAXZOOM).toBeLessThan(CAMERA.overheadZoom);
    expect(PLACE_MAXZOOM).toBeLessThan(CAMERA.streetZoom);
  });
});

describe('tap targets', () => {
  it('is forgiving enough for a thumb', async () => {
    const { TAP_TOLERANCE_PX } = await import('../src/layers/places/index');
    // A fingertip covers roughly 8-10 CSS px of slop on a phone; anything
    // under that and a 6px dot is unhittable, which reads as "clicking does
    // nothing" rather than "you missed".
    expect(TAP_TOLERANCE_PX).toBeGreaterThanOrEqual(10);
  });
});

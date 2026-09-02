import { describe, it, expect } from 'vitest';
import { placeOrbiter, inDrawOrder, sceneOpacity } from '../src/launch/orbits';
import { globeScreenRadius, destination } from '../src/launch/globeMetrics';
import { LAUNCH, ORBITERS } from '../src/launch/config';
import type { Orbiter } from '../src/launch/config';

const R = 100;
const CX = 500;
const CY = 400;
// tilt PI/2 is face-on, so the orbit is a circle on screen and depth is 0.
// tilt 0 is edge-on: the whole orbit collapses onto the horizontal, which is
// where things pass in front of and behind the planet.
const edgeOn = (over: Partial<Orbiter> = {}): Orbiter => ({
  kind: 'satellite', radius: 1.5, period: 20, phase: 0, tilt: 0, size: 20, ...over,
});

describe('orbit placement', () => {
  it('puts an orbiter on its orbit radius', () => {
    const p = placeOrbiter(edgeOn(), 0, R, CX, CY);
    expect(Math.hypot(p.x - CX, p.y - CY)).toBeCloseTo(150, 6);
  });

  it('carries it all the way round in one period', () => {
    const o = edgeOn({ period: 20 });
    const a = placeOrbiter(o, 0, R, CX, CY);
    const b = placeOrbiter(o, 20, R, CX, CY);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
  });

  it('runs the other way for a negative period', () => {
    const fwd = placeOrbiter(edgeOn({ period: 20, tilt: 1 }), 1, R, CX, CY);
    const rev = placeOrbiter(edgeOn({ period: -20, tilt: 1 }), 1, R, CX, CY);
    expect(rev.y - CY).toBeCloseTo(-(fwd.y - CY), 6);
  });

  it('draws nearer objects bigger than far ones', () => {
    const o = edgeOn({ period: 20 });
    const near = placeOrbiter(o, 5, R, CX, CY); // quarter turn: toward viewer
    const far = placeOrbiter(o, 15, R, CX, CY); // three-quarter: away
    expect(near.depth).toBeGreaterThan(0);
    expect(far.depth).toBeLessThan(0);
    expect(near.scale).toBeGreaterThan(far.scale);
  });

  // The rule this exists to protect: hiding on depth alone blinks objects out
  // while they are still well clear of the planet, beside it on screen.
  it('hides an orbiter only when the globe is actually in front of it', () => {
    const behindAndBehindTheDisc = placeOrbiter(
      edgeOn({ radius: 0.5, period: 20 }), 15, R, CX, CY); // inside silhouette, far side
    expect(behindAndBehindTheDisc.depth).toBeLessThan(0);
    expect(behindAndBehindTheDisc.occluded).toBe(true);

    // Must be a TILTED orbit to test the other half. Edge-on, the far-side
    // point sits directly behind the globe's centre on screen whatever the
    // orbit radius, so hiding it is right; only a tilt lifts it clear.
    const behindButBesideThePlanet = placeOrbiter(
      edgeOn({ radius: 2, period: 20, tilt: 1.2 }), 15, R, CX, CY);
    expect(behindButBesideThePlanet.depth).toBeLessThan(0);
    expect(Math.hypot(behindButBesideThePlanet.x - CX, behindButBesideThePlanet.y - CY))
      .toBeGreaterThan(R);
    expect(behindButBesideThePlanet.occluded).toBe(false);
  });

  it('never hides anything on the near side', () => {
    for (let t = 0; t < 20; t += 0.25) {
      const p = placeOrbiter(edgeOn({ radius: 0.4, period: 20 }), t, R, CX, CY);
      if (p.depth > 0) expect(p.occluded).toBe(false);
    }
  });

  it('ships no orbiter that would clip through the globe, clouds aside', () => {
    for (const o of ORBITERS) {
      if (o.kind === 'cloud') continue;
      expect(o.radius).toBeGreaterThan(1);
    }
  });

  it('sorts far side first so near objects paint over them', () => {
    const places = [{ depth: 0.5 }, { depth: -0.9 }, { depth: 0.1 }] as never;
    expect(inDrawOrder(places)).toEqual([1, 2, 0]);
  });
});

describe('scene fade', () => {
  it('is fully on at the launch view and fully gone over the city', () => {
    expect(sceneOpacity(LAUNCH.zoom, LAUNCH.fadeFrom, LAUNCH.fadeTo)).toBe(1);
    expect(sceneOpacity(LAUNCH.cityZoom, LAUNCH.fadeFrom, LAUNCH.fadeTo)).toBe(0);
  });

  it('falls monotonically across the range and never leaves 0..1', () => {
    let prev = 1;
    for (let z = 0; z <= 14; z += 0.25) {
      const a = sceneOpacity(z, LAUNCH.fadeFrom, LAUNCH.fadeTo);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      expect(a).toBeLessThanOrEqual(prev + 1e-9);
      prev = a;
    }
  });

  it('starts fading before the spin stops, so nothing pops', () => {
    expect(LAUNCH.fadeFrom).toBeLessThan(LAUNCH.spinMaxZoom);
  });
});

describe('globe metrics', () => {
  it('walks a real great circle, not a meridian', () => {
    // 90 degrees north-east of the equator/prime-meridian corner is on the equator.
    const d = destination({ lng: 0, lat: 0 }, 90, 90);
    expect(d.lat).toBeCloseTo(0, 6);
    expect(d.lng).toBeCloseTo(90, 6);
  });

  it('wraps longitude into -180..180', () => {
    const d = destination({ lng: 170, lat: 0 }, 90, 30);
    expect(d.lng).toBeGreaterThanOrEqual(-180);
    expect(d.lng).toBeLessThanOrEqual(180);
  });

  // The bug this pins: measuring by marching north to lat 90. From Portland
  // that is only 45 degrees of arc, which stops short of the tangent point and
  // reports a globe roughly half its real size.
  it('measures the same radius from the equator and from Portland', () => {
    // A stub globe: orthographic-ish projection of a unit sphere at 200px.
    const stub = (centre: { lng: number; lat: number }) => ({
      getCenter: () => centre,
      project: ({ lng, lat }: { lng: number; lat: number }) => {
        const toXYZ = (a: number, b: number) => {
          const p = b * (Math.PI / 180), l = a * (Math.PI / 180);
          return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
        };
        const c = toXYZ(centre.lng, centre.lat);
        const v = toXYZ(lng, lat);
        // east and north basis at the centre
        const east = [-c[1], c[0], 0];
        const eLen = Math.hypot(east[0], east[1]) || 1;
        const e = east.map((n) => n / eLen);
        const n = [
          c[1] * e[2] - c[2] * e[1],
          c[2] * e[0] - c[0] * e[2],
          c[0] * e[1] - c[1] * e[0],
        ];
        return {
          x: 200 * (v[0] * e[0] + v[1] * e[1] + v[2] * e[2]),
          y: 200 * (v[0] * n[0] + v[1] * n[1] + v[2] * n[2]),
        };
      },
    });
    const atEquator = globeScreenRadius(stub({ lng: 0, lat: 0 }));
    const atPortland = globeScreenRadius(stub({ lng: -122.6784, lat: 45.5152 }));
    expect(atEquator).toBeCloseTo(200, 0);
    expect(atPortland).toBeCloseTo(atEquator, 0);
  });
});

describe('fitting the globe to the viewport', () => {
  // A stub whose on-screen radius is exactly 100 * 2^zoom, which is the
  // relationship fitGlobeZoom assumes when it steps by log2.
  const stubMap = (startZoom: number) => {
    let zoom = startZoom;
    return {
      getZoom: () => zoom,
      setZoom: (z: number) => { zoom = z; },
      getCenter: () => ({ lng: 0, lat: 0 }),
      project: ({ lat }: { lng: number; lat: number }) => ({
        x: 0,
        y: Math.sin((lat * Math.PI) / 180) * 100 * Math.pow(2, zoom),
      }),
    };
  };

  it('converges on the requested radius from below and above', async () => {
    const { fitGlobeZoom, globeScreenRadius } = await import('../src/launch/globeMetrics');
    for (const start of [0.2, 1, 3.5]) {
      const m = stubMap(start);
      fitGlobeZoom(m, 250);
      expect(globeScreenRadius(m)).toBeCloseTo(250, 0);
    }
  });

  it('never leaves the zoom bounds', async () => {
    const { fitGlobeZoom } = await import('../src/launch/globeMetrics');
    const tiny = stubMap(1);
    fitGlobeZoom(tiny, 1e-6); // an impossible ask
    expect(tiny.getZoom()).toBeGreaterThanOrEqual(0.2);
    const huge = stubMap(1);
    fitGlobeZoom(huge, 1e9);
    expect(huge.getZoom()).toBeLessThanOrEqual(4);
  });

  it('is width-led on a tall phone and height-led on a wide screen', async () => {
    const { targetGlobeRadius } = await import('../src/launch/globeMetrics');
    expect(targetGlobeRadius(390, 844)).toBeCloseTo(390 * 0.46, 6); // phone
    expect(targetGlobeRadius(1400, 700)).toBeCloseTo(700 * 0.36, 6); // desktop
  });
});

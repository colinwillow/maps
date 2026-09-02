import { describe, it, expect } from 'vitest';
import { angularDistance, makeClouds, placeCloud } from '../src/launch/clouds';
import { CLOUDS } from '../src/launch/config';

describe('great-circle angle', () => {
  it('is zero for the same point and 180 for the antipode', () => {
    expect(angularDistance({ lng: 10, lat: 20 }, { lng: 10, lat: 20 })).toBeCloseTo(0, 6);
    expect(angularDistance({ lng: 0, lat: 0 }, { lng: 180, lat: 0 })).toBeCloseTo(180, 4);
  });

  it('is 90 a quarter of the way round', () => {
    expect(angularDistance({ lng: 0, lat: 0 }, { lng: 90, lat: 0 })).toBeCloseTo(90, 4);
    expect(angularDistance({ lng: 0, lat: 0 }, { lng: 0, lat: 90 })).toBeCloseTo(90, 4);
  });

  it('does not care which way round you ask', () => {
    const a = { lng: -122, lat: 45 };
    const b = { lng: 139, lat: 35 };
    expect(angularDistance(a, b)).toBeCloseTo(angularDistance(b, a), 9);
  });

  // Longitude convergence: a degree of longitude is much shorter near a pole.
  it('shrinks a degree of longitude toward the poles', () => {
    const atEquator = angularDistance({ lng: 0, lat: 0 }, { lng: 1, lat: 0 });
    const atSixty = angularDistance({ lng: 0, lat: 60 }, { lng: 1, lat: 60 });
    expect(atSixty).toBeLessThan(atEquator);
    expect(atSixty).toBeCloseTo(atEquator * Math.cos((60 * Math.PI) / 180), 3);
  });
});

describe('the cloud deck', () => {
  it('is deterministic, so the sky does not reshuffle every frame', () => {
    expect(makeClouds(12)).toEqual(makeClouds(12));
  });

  it('stays on the planet', () => {
    for (const c of makeClouds(CLOUDS.count)) {
      expect(Math.abs(c.lng)).toBeLessThanOrEqual(180);
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
      expect(c.puffs.length).toBeGreaterThan(2);
      expect(c.size).toBeGreaterThan(0);
    }
  });
});

describe('which clouds are on the visible face', () => {
  it('shows what is in front and hides what is round the back', () => {
    expect(placeCloud(0).visible).toBe(true);
    expect(placeCloud(120).visible).toBe(false);
    expect(placeCloud(179).visible).toBe(false);
  });

  // A hard cut at the limb reads as clouds blinking out along a circle, which
  // is far more obvious than the foreshortening the fade stands in for.
  it('fades out toward the limb rather than cutting off', () => {
    const near = placeCloud(10);
    // Inside the limb, which sits well short of 90 on purpose — see clouds.ts.
    const edge = placeCloud(70);
    expect(near.visible && edge.visible).toBe(true);
    if (near.visible && edge.visible) {
      expect(near.alpha).toBeCloseTo(1, 6);
      expect(edge.alpha).toBeGreaterThan(0);
      expect(edge.alpha).toBeLessThan(0.6);
      // And foreshortens: a cloud near the edge is squashed, not full size.
      expect(edge.scale).toBeLessThan(near.scale);
    }
  });

  it('never goes negative or inverts near the limb', () => {
    for (let a = 0; a < 90; a += 0.5) {
      const p = placeCloud(a);
      if (!p.visible) continue;
      expect(p.alpha).toBeGreaterThanOrEqual(0);
      expect(p.alpha).toBeLessThanOrEqual(1);
      expect(p.scale).toBeGreaterThan(0);
    }
  });
});

describe('cloud distribution', () => {
  // Uniform-in-latitude looks fine in a list and wrong on a globe: it packs
  // clouds near the equator BY AREA, and from a mid-latitude camera that
  // whole band sits along the bottom rim with a bare pole above it.
  it('spreads clouds evenly over the sphere, not evenly over latitude', () => {
    const clouds = makeClouds(4000, 7);
    // Equal-area sampling puts half of them outside +/-30 degrees, since
    // sin(30) = 0.5 splits the sphere's area in half.
    const nearEquator = clouds.filter((c) => Math.abs(c.lat) < 30).length;
    expect(nearEquator / clouds.length).toBeGreaterThan(0.4);
    expect(nearEquator / clouds.length).toBeLessThan(0.6);
  });

  it('covers both hemispheres about equally', () => {
    const clouds = makeClouds(4000, 7);
    const north = clouds.filter((c) => c.lat > 0).length / clouds.length;
    expect(north).toBeGreaterThan(0.45);
    expect(north).toBeLessThan(0.55);
  });
});

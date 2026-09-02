export type Cloud = {
  lng: number;
  lat: number;
  /** Size as a fraction of the globe's screen radius. */
  size: number;
  /** Puff offsets, in units of the cloud's own size. */
  puffs: { dx: number; dy: number; r: number }[];
  /** Small per-cloud drift so the deck is not rigid. */
  drift: number;
};

const RAD = Math.PI / 180;

/**
 * Great-circle angle between two lng/lat points, in degrees.
 *
 * This is what decides whether a cloud is on the near side of the planet:
 * under 90 degrees from the camera's centre is the visible hemisphere.
 */
export function angularDistance(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) / RAD;
}

/**
 * A deterministic cloud deck.
 *
 * Clouds are placed in LNG/LAT, not on screen, which is the whole point: they
 * are then projected like anything else, so they turn with the planet instead
 * of sliding across it, and a cloud near the limb foreshortens on its own.
 *
 * Latitude is sampled EQUAL-AREA, as asin(uniform(-1,1)), not uniformly in
 * degrees. Uniform latitude concentrates clouds near the equator by area, and
 * since the camera usually sits at a mid northern latitude that whole band
 * lands low on the disc — the deck comes out bunched along the bottom edge
 * with a bare north pole. Equal-area spreads them evenly over the sphere, so
 * every view gets its fair share.
 */
export function makeClouds(count: number, seed = 991): Cloud[] {
  let s = seed >>> 0;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

  return Array.from({ length: count }, () => {
    // Clamped short of the poles, where the projection crowds everything.
    const lat = Math.max(-80, Math.min(80, (Math.asin(2 * rand() - 1) * 180) / Math.PI));
    return {
      lng: rand() * 360 - 180,
      lat,
      size: 0.07 + rand() * 0.1,
      drift: 0.6 + rand() * 0.8,
      puffs: Array.from({ length: 3 + Math.floor(rand() * 3) }, () => ({
        dx: (rand() - 0.5) * 1.7,
        dy: (rand() - 0.5) * 0.7,
        r: 0.35 + rand() * 0.4,
      })),
    };
  });
}

export type CloudPlacement = { visible: false } | { visible: true; alpha: number; scale: number };

/**
 * Whether a cloud is on the visible face, and how solid it should be.
 *
 * Fades out approaching the limb rather than vanishing at exactly 90 degrees:
 * clouds popping out of existence along a hard circle is far more obvious than
 * the foreshortening it is standing in for.
 *
 * The limb is deliberately well short of 90. Foreshortening crowds everything
 * near the edge into a dense white rim — real to the geometry, but it reads as
 * a smear round the planet rather than weather, so the deck is thinned out
 * long before it gets there.
 */
export function placeCloud(angle: number, limb = 76, fadeFrom = 44): CloudPlacement {
  if (angle >= limb) return { visible: false };
  const t = angle <= fadeFrom ? 0 : (angle - fadeFrom) / (limb - fadeFrom);
  return {
    visible: true,
    alpha: 1 - t,
    // Foreshortening near the edge of a sphere.
    scale: Math.max(0.25, Math.cos(angle * RAD) * 0.55 + 0.45),
  };
}

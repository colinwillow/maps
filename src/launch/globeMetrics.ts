/** The minimum of MapLibre's surface this needs — keeps it testable with a stub. */
export type ProjectableMap = {
  getCenter(): { lng: number; lat: number };
  project(lngLat: { lng: number; lat: number }): { x: number; y: number };
};

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Point at great-circle distance `distDeg` from `from`, along `bearingDeg`. */
export function destination(
  from: { lng: number; lat: number },
  bearingDeg: number,
  distDeg: number,
): { lng: number; lat: number } {
  const lat1 = from.lat * RAD;
  const lon1 = from.lng * RAD;
  const brg = bearingDeg * RAD;
  const d = distDeg * RAD;

  const sinLat2 = Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lng: ((lon2 * DEG + 540) % 360) - 180, lat: lat2 * DEG };
}

/**
 * The globe's on-screen radius in CSS pixels.
 *
 * There is no public API for this, and the obvious formula (worldSize / 2PI)
 * is wrong by a growing margin — MapLibre draws the globe under a perspective
 * camera, so what you see is the sphere's SILHOUETTE, which is smaller than
 * its true radius and depends on viewport height as well as zoom. Measured
 * against rendered pixels, that formula was 32% out by zoom 2.
 *
 * So measure it: walk out from the centre along great circles and take the
 * furthest point that still projects — that tangent point IS the silhouette.
 * Checked against pixel-scraped renders at z0.5-z2, it agrees within a pixel.
 *
 * It must be a GREAT-CIRCLE walk, not a march up the meridian to lat 90: from
 * Portland at 45N the pole is only 45 degrees away, which stops well short of
 * the tangent and reports a globe about half its real size. Several bearings
 * are sampled because near a pole a single one runs out of room.
 */
export function globeScreenRadius(map: ProjectableMap): number {
  const centreLngLat = map.getCenter();
  const centre = map.project(centreLngLat);
  let max = 0;
  for (const bearing of [0, 90, 180, 270]) {
    for (let dist = 30; dist <= 90; dist += 1) {
      const p = map.project(destination(centreLngLat, bearing, dist));
      const d = Math.hypot(p.x - centre.x, p.y - centre.y);
      if (Number.isFinite(d)) max = Math.max(max, d);
    }
  }
  return max;
}

export type ZoomableMap = ProjectableMap & {
  getZoom(): number;
  setZoom(z: number): void;
};

/**
 * Choose a zoom that makes the globe a given size on screen.
 *
 * Needed because the silhouette depends on the VIEWPORT as well as the zoom:
 * one fixed launch zoom gives a tidy globe on a laptop and a globe that bleeds
 * off both edges of a tall phone. Solving it per device is the only way to get
 * a composition that holds.
 *
 * Radius grows roughly as 2^zoom, so stepping by log2(target/actual) converges
 * in a couple of passes; it is under-damped rather than exact because the true
 * exponent is nearer 0.84, hence iterating instead of solving once.
 */
export function fitGlobeZoom(
  map: ZoomableMap,
  targetRadiusPx: number,
  { min = 0.2, max = 4, passes = 6 } = {},
): number {
  for (let i = 0; i < passes; i++) {
    const r = globeScreenRadius(map);
    if (!r || !Number.isFinite(r)) break;
    const err = Math.log2(targetRadiusPx / r);
    if (Math.abs(err) < 0.01) break;
    map.setZoom(Math.max(min, Math.min(max, map.getZoom() + err)));
  }
  return map.getZoom();
}

/**
 * How big the globe should be for a given viewport. Width-led on a phone so it
 * does not touch the edges, height-led on a wide screen so the title still has
 * somewhere to live.
 */
export const targetGlobeRadius = (w: number, h: number) => Math.min(w * 0.46, h * 0.36);

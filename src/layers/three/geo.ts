import { MercatorCoordinate } from 'maplibre-gl';

export type LngLat = { lng: number; lat: number };

/**
 * A local metric frame for the 3D scene.
 *
 * Mercator coordinates are 0..1 across the whole planet, so a person-sized
 * object lives in the eighth decimal place — miserable to reason about and bad
 * for float precision. So the Three scene works in METRES relative to a fixed
 * origin, and this converts between the two.
 *
 * Axes, which follow from the model matrix in ThreeLayer:
 *   three  X = east,  Y = up,  Z = SOUTH.
 * So three's -Z is north, which is what a GLTF model's default forward faces.
 *
 * The metres-per-mercator-unit scale is latitude dependent and taken once at
 * the origin. Over a city that is a fraction of a percent; it would matter if
 * this frame were ever stretched across a continent.
 */
export function makeGeoFrame(origin: LngLat) {
  const o = MercatorCoordinate.fromLngLat(origin, 0);
  const scale = o.meterInMercatorCoordinateUnits();

  return {
    origin: o,
    scale,

    /** Metres east and south of the origin. */
    toMeters(ll: LngLat): { east: number; south: number } {
      const m = MercatorCoordinate.fromLngLat(ll, 0);
      return { east: (m.x - o.x) / scale, south: (m.y - o.y) / scale };
    },

    /** Back to lng/lat, so the map camera can follow something in the scene. */
    toLngLat(east: number, south: number): LngLat {
      const m = new MercatorCoordinate(o.x + east * scale, o.y + south * scale, 0);
      const ll = m.toLngLat();
      return { lng: ll.lng, lat: ll.lat };
    },
  };
}

export type GeoFrame = ReturnType<typeof makeGeoFrame>;

/**
 * Compass bearing (degrees clockwise from north) to a yaw about three's Y axis.
 *
 * North is -Z and east is +X, so bearing 0 must leave a model facing -Z and
 * bearing 90 must turn it to face +X. Rotating about +Y by -bearing does that:
 * a Y rotation takes -Z toward +X as the angle goes negative.
 */
export const bearingToYaw = (bearingDeg: number) => -bearingDeg * (Math.PI / 180);

/** Bearing of a movement vector given in metres east/south. */
export function headingOf(east: number, south: number): number {
  const north = -south;
  return (Math.atan2(east, north) * 180) / Math.PI;
}

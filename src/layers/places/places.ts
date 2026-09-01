/**
 * The world, as a tree you can click your way down.
 *
 * world -> continent -> country -> region -> city
 *
 * WHY THIS IS HAND-WRITTEN DATA. Highlighting a real continent or country
 * outline needs polygons, and OpenMapTiles ships administrative BOUNDARIES as
 * lines, not fills — there is nothing in the basemap to fill in. The usual
 * source is Natural Earth, which is a real dependency to add and vendor.
 * Rather than block on that, each place carries a bounding box: the highlight
 * is that box, the camera flies to it, and the shape of the feature is settled.
 * Swapping the box for a real polygon later changes this file and nothing else.
 *
 * So this is a SEED, not an atlas. One path is populated all the way down
 * (North America -> United States -> Oregon -> Portland); the rest stops at
 * country level. Adding more is data entry, not code.
 *
 * bbox is [west, south, east, north].
 */

export type PlaceLevel = 'continent' | 'country' | 'region' | 'city';

export type Place = {
  id: string;
  name: string;
  level: PlaceLevel;
  /** Label anchor and where the camera lands. */
  center: [number, number];
  bbox: [number, number, number, number];
  children?: Place[];
};

const p = (
  id: string,
  name: string,
  level: PlaceLevel,
  center: [number, number],
  bbox: [number, number, number, number],
  children?: Place[],
): Place => ({ id, name, level, center, bbox, children });

const portland = p('portland', 'Portland', 'city', [-122.6784, 45.5152],
  [-122.84, 45.43, -122.47, 45.65]);

const oregon = p('oregon', 'Oregon', 'region', [-120.5, 44.0], [-124.6, 41.9, -116.4, 46.3], [
  portland,
  p('eugene', 'Eugene', 'city', [-123.0868, 44.0521], [-123.22, 43.98, -122.95, 44.14]),
  p('bend', 'Bend', 'city', [-121.3153, 44.0582], [-121.42, 43.99, -121.23, 44.13]),
  p('astoria', 'Astoria', 'city', [-123.834, 46.1879], [-123.9, 46.14, -123.75, 46.23]),
]);

const unitedStates = p('usa', 'United States', 'country', [-98.0, 39.5],
  [-125.0, 24.5, -66.9, 49.4], [
    oregon,
    p('washington', 'Washington', 'region', [-120.5, 47.4], [-124.8, 45.5, -116.9, 49.0]),
    p('california', 'California', 'region', [-119.4, 37.2], [-124.4, 32.5, -114.1, 42.0]),
    p('new-york-state', 'New York', 'region', [-75.5, 43.0], [-79.8, 40.5, -71.8, 45.0]),
    p('texas', 'Texas', 'region', [-99.9, 31.5], [-106.6, 25.8, -93.5, 36.5]),
    p('colorado', 'Colorado', 'region', [-105.5, 39.0], [-109.1, 37.0, -102.0, 41.0]),
  ]);

const northAmerica = p('north-america', 'North America', 'continent', [-100.0, 45.0],
  [-168.0, 7.0, -52.0, 72.0], [
    unitedStates,
    p('canada', 'Canada', 'country', [-106.0, 56.0], [-141.0, 41.7, -52.6, 70.0]),
    p('mexico', 'Mexico', 'country', [-102.0, 23.6], [-118.4, 14.5, -86.7, 32.7]),
    p('cuba', 'Cuba', 'country', [-79.0, 21.5], [-85.0, 19.8, -74.1, 23.3]),
    p('guatemala', 'Guatemala', 'country', [-90.2, 15.7], [-92.3, 13.7, -88.2, 17.8]),
  ]);

const southAmerica = p('south-america', 'South America', 'continent', [-60.0, -15.0],
  [-82.0, -56.0, -34.0, 13.0], [
    p('brazil', 'Brazil', 'country', [-51.9, -14.2], [-74.0, -33.8, -34.8, 5.3]),
    p('argentina', 'Argentina', 'country', [-63.6, -38.4], [-73.6, -55.1, -53.6, -21.8]),
    p('peru', 'Peru', 'country', [-75.0, -9.2], [-81.4, -18.4, -68.7, -0.0]),
    p('chile', 'Chile', 'country', [-71.5, -35.7], [-75.6, -55.9, -66.4, -17.5]),
    p('colombia', 'Colombia', 'country', [-74.3, 4.6], [-79.0, -4.2, -66.9, 12.5]),
  ]);

const europe = p('europe', 'Europe', 'continent', [15.0, 52.0], [-25.0, 34.0, 45.0, 71.0], [
  p('united-kingdom', 'United Kingdom', 'country', [-2.5, 54.0], [-8.6, 49.9, 1.8, 58.7]),
  p('france', 'France', 'country', [2.2, 46.6], [-5.1, 41.3, 9.6, 51.1]),
  p('spain', 'Spain', 'country', [-3.7, 40.2], [-9.3, 36.0, 3.3, 43.8]),
  p('germany', 'Germany', 'country', [10.4, 51.2], [5.9, 47.3, 15.0, 55.1]),
  p('italy', 'Italy', 'country', [12.6, 42.5], [6.6, 36.6, 18.5, 47.1]),
  p('norway', 'Norway', 'country', [8.5, 61.0], [4.6, 57.9, 31.1, 71.2]),
]);

const africa = p('africa', 'Africa', 'continent', [20.0, 2.0], [-18.0, -35.0, 52.0, 37.0], [
  p('egypt', 'Egypt', 'country', [30.8, 26.8], [24.7, 22.0, 36.9, 31.7]),
  p('nigeria', 'Nigeria', 'country', [8.7, 9.1], [2.7, 4.3, 14.7, 13.9]),
  p('kenya', 'Kenya', 'country', [37.9, 0.0], [33.9, -4.7, 41.9, 5.5]),
  p('south-africa', 'South Africa', 'country', [24.7, -28.9], [16.3, -34.8, 32.9, -22.1]),
  p('morocco', 'Morocco', 'country', [-7.1, 31.8], [-13.2, 27.7, -1.0, 35.9]),
]);

const asia = p('asia', 'Asia', 'continent', [95.0, 35.0], [26.0, -10.0, 150.0, 72.0], [
  p('japan', 'Japan', 'country', [138.3, 36.2], [129.4, 31.0, 145.8, 45.5]),
  p('china', 'China', 'country', [104.2, 35.9], [73.5, 18.2, 134.8, 53.6]),
  p('india', 'India', 'country', [78.9, 20.6], [68.2, 6.8, 97.4, 35.5]),
  p('thailand', 'Thailand', 'country', [100.99, 15.9], [97.3, 5.6, 105.6, 20.5]),
  p('turkey', 'Turkiye', 'country', [35.2, 39.0], [26.0, 35.8, 44.8, 42.1]),
]);

const oceania = p('oceania', 'Oceania', 'continent', [140.0, -25.0],
  [110.0, -48.0, 180.0, 0.0], [
    p('australia', 'Australia', 'country', [133.8, -25.3], [113.3, -43.6, 153.6, -10.7]),
    p('new-zealand', 'New Zealand', 'country', [174.0, -41.0], [166.5, -47.3, 178.6, -34.4]),
    p('fiji', 'Fiji', 'country', [178.0, -17.7], [176.9, -19.2, 180.0, -16.1]),
  ]);

const antarctica = p('antarctica', 'Antarctica', 'continent', [0.0, -82.0],
  [-180.0, -90.0, 180.0, -60.0]);

export const WORLD: Place[] = [
  northAmerica, southAmerica, europe, africa, asia, oceania, antarctica,
];

/** Depth-first search for a place by id. */
export function findPlace(id: string, within: Place[] = WORLD): Place | null {
  for (const place of within) {
    if (place.id === id) return place;
    const hit = place.children ? findPlace(id, place.children) : null;
    if (hit) return hit;
  }
  return null;
}

/** The chain from the world down to `id`, for the breadcrumb. */
export function pathTo(id: string, within: Place[] = WORLD, trail: Place[] = []): Place[] | null {
  for (const place of within) {
    const here = [...trail, place];
    if (place.id === id) return here;
    const deeper = place.children ? pathTo(id, place.children, here) : null;
    if (deeper) return deeper;
  }
  return null;
}

/** A bbox as a GeoJSON ring, for drawing the highlight. */
export function bboxPolygon(bbox: [number, number, number, number]) {
  const [w, s, e, n] = bbox;
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'Polygon' as const,
      coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
    },
  };
}

/**
 * The launch scene — what you see when the page opens.
 *
 * A slowly turning globe in space, with a few stylised objects in orbit and a
 * title. It is deliberately exaggerated and hand-drawn-looking: the basemap is
 * recessive on purpose, so the front door is where this project gets to be fun.
 *
 * Everything tunable lives here, same rule as the style tokens.
 *
 * WHY CANVAS AND NOT THREE.JS: these are cartoon objects, not models. Flat
 * vector shapes with a depth-scale read as a storybook illustration, cost
 * nothing on a phone, and need no asset pipeline. Three.js is still reserved
 * for Phase 5's real hero buildings inside the map's own GL context; putting a
 * second WebGL renderer on the launch screen would fight it for GL state.
 */

export const LAUNCH = {
  /** Opening view. Portland faces the camera; the spin carries it away slowly. */
  zoom: 1.35,
  /** Where "Explore Portland" flies to. */
  cityZoom: 12,

  /** Degrees of longitude per second. A full turn takes about three minutes. */
  spinDegPerSec: 2.0,
  /** Above this zoom the scene is gone and the spin never runs. */
  spinMaxZoom: 4,

  /** Scene fades out across this zoom range as you dive toward the city. */
  fadeFrom: 2.6,
  fadeTo: 4.6,
} as const;

export const SCENE = {
  // Deep, slightly warm night — a cold blue would fight the paper basemap.
  spaceTop: '#131A2C',
  spaceBottom: '#080B14',
  glow: '#2E4668', // atmosphere halo hugging the globe

  star: '#F6F2E9',
  starDim: '#B9C4D8',

  // Two distant planets, muted so they never compete with the globe.
  planetA: '#C98F7A', // dusty rose
  planetB: '#D8C089', // pale gold
  planetRing: '#E6D6AE',

  craft: '#F6F2E9',
  craftInk: '#2A3346',
  craftAccent: '#7FB2C4',
  craftWarm: '#E8A87C',
  cloud: '#FDFBF6',

  title: '#F6F2E9',
  titleSoft: '#9FB0C9',
} as const;

/**
 * The wordmark on the launch screen.
 *
 * It sits over the whole planet, so it cannot be the name of one city — the
 * globe is the world and the title has to say so. Still a placeholder: the
 * project has no name. Others tried: ATLAS, TERRA, EVERYWHERE, BLUE MARBLE.
 * Change it here.
 */
export const TITLE = {
  text: 'OVERWORLD',
  subtitle: 'an open map of everywhere',
  cta: 'Jump to Portland',
} as const;

export type OrbiterKind = 'satellite' | 'ufo' | 'plane' | 'cloud';

export type Orbiter = {
  kind: OrbiterKind;
  /** Orbit radius as a multiple of the globe's on-screen radius. */
  radius: number;
  /** Seconds per revolution. Negative runs the other way round. */
  period: number;
  /** 0..1 starting offset, so they do not all line up. */
  phase: number;
  /** Orbit plane tilt in radians. 0 is edge-on, PI/2 is face-on. */
  tilt: number;
  /** Drawn size in px at mid-depth. */
  size: number;
};

/**
 * Orbit radii sit outside 1.0 so nothing clips the globe's edge, except the
 * clouds, which hug it deliberately.
 */
export const ORBITERS: Orbiter[] = [
  { kind: 'satellite', radius: 1.28, period: 26, phase: 0.0, tilt: 0.32, size: 26 },
  { kind: 'ufo', radius: 1.52, period: -34, phase: 0.35, tilt: 0.62, size: 30 },
  { kind: 'plane', radius: 1.12, period: 19, phase: 0.6, tilt: 0.16, size: 22 },
  { kind: 'plane', radius: 1.38, period: -23, phase: 0.15, tilt: 0.78, size: 18 },
  { kind: 'satellite', radius: 1.68, period: 41, phase: 0.8, tilt: 0.22, size: 20 },
  { kind: 'cloud', radius: 1.04, period: 55, phase: 0.25, tilt: 0.42, size: 34 },
  { kind: 'cloud', radius: 1.05, period: -63, phase: 0.7, tilt: 0.2, size: 27 },
];

export const STARS = {
  count: 160,
  minSize: 0.6,
  maxSize: 1.9,
  twinkleSec: 4.2,
} as const;

/**
 * Style tokens — "field guide Portland".
 *
 * The whole palette and type scale live here so a look change is one edit,
 * not forty. style.ts may not contain a raw colour or font name; a test
 * enforces that.
 *
 * The brief: the basemap is the stage, not the show. Cartoony 3D objects and
 * artist studios land on top of it later and have to pop, so this stays warm,
 * legible and slightly recessive. Deliberately NOT the two clichés — no
 * night-mode road contrast in day mode, and no desaturated grey with a single
 * accent colour.
 *
 * Portland's signature is the river, its bridges and the grid, so the
 * Willamette gets the only saturated colour on the map and the bridges are
 * drawn as deliberate ink strokes rather than just more road.
 */

export const PALETTE = {
  // Ground: warm paper, like a field guide plate rather than a screen UI.
  paper: '#F1ECE1',
  paperShade: '#E9E2D3', // landuse washes, one step down from paper
  paperEdge: '#DED5C2',

  // Green space: sage, not the saturated park-green every map ships.
  woodland: '#CBD6BC',
  grass: '#D6DEC6',

  // At world zoom the map has to read as EARTH, which is a different problem
  // from reading as a city. Land the colour of paper against a muted teal sea
  // is a pale glowing ball from orbit; from space the eye wants deep ocean,
  // warm land and white poles. These are the low-zoom ends of the ramps in
  // style.ts, which cross-fade into the city palette by about zoom 6.
  oceanWorld: '#3E6C82',
  landWorld: '#DCCFB2',
  ice: '#F4F2EC',

  // The river is the hero and the only place saturation is spent.
  water: '#6FA1AF',
  waterDeep: '#5C8D9B',
  waterEdge: '#4A7683', // shoreline casing — what gives the river an edge

  // Roads are warm ink lines, never yellow or orange fills.
  ink: '#8A7F70', // minor roads
  inkMid: '#6E6355', // secondary / tertiary
  inkStrong: '#544A3D', // primary / trunk / motorway
  inkRail: '#A2988A',

  // Bridges: the strongest ink on the map. Portland has twelve of them and
  // they are the thing that makes the city legible from above.
  bridge: '#3F372C',

  building: '#E3DACA',
  buildingEdge: '#D3C8B3',
  /**
   * Extruded buildings. Roof lighter than wall so the massing reads without a
   * shadow pass; taller blocks shift very slightly cooler, which separates
   * downtown towers from low-rise without colouring them in.
   */
  buildingRoof: '#EAE1D0',
  buildingWall: '#D6CBB6',
  buildingTall: '#CFC7B8',

  boundary: '#B6A992',

  label: '#3B3428',
  labelSoft: '#6B6153',
  labelWater: '#3C6A76',
  halo: '#F6F2E9', // paper, one step lighter — halos carry legibility in sun
} as const;

/**
 * Label typography. Halo settings matter more than you would expect: this map
 * has to be readable on a phone, in a car, in daylight, so every label carries
 * a wide paper halo rather than relying on contrast alone.
 *
 * NOTE: these font stacks are resolved by MapTiler's glyph server. The first
 * entry is the intended face and the second is a guaranteed fallback. If
 * labels ever fail to render at all, suspect the first entry and drop to the
 * fallback — that is the one-line fix, right here.
 */
export const TYPE = {
  display: ['Open Sans Bold', 'Noto Sans Bold'],
  strong: ['Open Sans Semibold', 'Noto Sans Bold'],
  regular: ['Open Sans Regular', 'Noto Sans Regular'],
  italic: ['Open Sans Italic', 'Noto Sans Italic'],
  haloWidth: 1.6,
  haloBlur: 0.4,
} as const;

/**
 * Projection. The original brief pinned mercator because globe complicates
 * the matrix maths for the Phase 5 Three.js custom layer. MapLibre blends
 * globe back to mercator as you zoom in, so street level is flat either way
 * and the globe only shows at world zoom.
 *
 * Flip this one word to go back to a flat map.
 */
export const PROJECTION: 'globe' | 'mercator' = 'globe';

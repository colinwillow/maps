// Every number and every colour in the game, in one object per system.
//
// The bake writes CLASS INDICES and the manifest writes the class NAMES at those
// indices; this file maps names to a look. That seam is the point: retuning the
// palette must never mean re-baking a city, and a class the bake learns tomorrow
// falls back to a default here instead of crashing.
//
// Portland is a grey-green city -- basalt, moss, fir, painted clapboard, brick.
// The palette is built from that rather than from the usual video-game city of
// concrete and glass, because what makes a place recognisable at a distance is
// its COLOUR long before it is its geometry.

export const SKY = {
  top:      0x9dc4e8,
  horizon:  0xd9dfd4,
  sun:      0xfff0d6,
  sunDir:   [0.42, 0.72, 0.55],     // normalised in main.js; afternoon, over the hills
  // Fog is the horizon, not a filter. At 220..1500 downtown read as white
  // ghosts from the far bank -- a kilometre is nothing in a river city, and the
  // whole point of the skyline is that you can see it. It starts past the
  // streamed chunks now and ends past the skyline boxes.
  fogNear:  420,
  fogFar:   3200,
  fogColor: 0xbfd0d8,
  ambientSky:    0xa8c8e4,          // hemisphere light: cool from above,
  ambientGround: 0xa08e70,          // warm bounce from below. This pair is the
  ambientI: 1.22,                   // whole stylised shadow/light split, for free.
  sunI: 1.15,
  // ACES, at an exposure under one. Without tone mapping every lit surface in a
  // city of pale walls clips to flat white and the palette may as well not
  // exist -- the first build shipped that and read as grey cardboard. The sum
  // of the two light intensities is deliberately near 1.7 rather than over 2:
  // Lambert has no ceiling of its own and the tone curve should be shaping a
  // picture, not rescuing one.
  exposure: 1.06,
};

export const CAM = {
  dist: 7.2, minDist: 2.6, maxDist: 16,
  height: 2.5,          // metres above his feet that the lens looks at
  pitch: 0.24,          // radians below horizontal, the default shot
  pitchHi: 0.62,        // the EYE key's second shot, for looking at the skyline
  orbitRate: 2.5,       // radians per second at full right-stick deflection
  followHL: 0.22,       // half-life of the boom easing in behind him
  lookHL: 0.10,
  probe: 0.6,           // metres per step when the boom is looking for a wall
  fov: 62,
};

export const MOVE = {
  walk: 1.9, run: 6.4, sprint: 9.2,
  accel: 26, decel: 30, turnAccel: 60,
  faceHL: 0.09,          // how fast his body comes round to the thumb
  g: 22,
  jump: 6.4,
  airControl: 0.35,
  radius: 0.42,          // his collision cylinder
  eye: 1.72,
  step: 0.45,            // anything this high is walked onto, not collided with
  coyote: 0.12,
};

// Buildings. `wall` and `roof`, plus a `vary` that hue-jitters per building so a
// street of identical class is not a street of identical colour -- Portland's
// residential stock is painted, and the variety IS the look.
const B = (wall, roof, vary = 0.05) => ({ wall, roof, vary });
export const BUILDING = {
  house:        B(0xd8cfbc, 0x8a7a68, 0.13),
  detached:     B(0xd2c8b4, 0x877867, 0.14),
  garage:       B(0xada396, 0x847b72, 0.08),
  outbuilding:  B(0xa89e90, 0x817a74, 0.08),
  apartments:   B(0xc0a893, 0x7b7268, 0.09),
  residential:  B(0xc8bca8, 0x807668, 0.10),
  commercial:   B(0xcfc6b4, 0x777066, 0.06),
  retail:       B(0xd3c2ab, 0x7a7263, 0.07),
  office:       B(0x9fb0bb, 0x757f88, 0.05),
  industrial:   B(0xa8aaa4, 0x878a8a, 0.05),
  warehouse:    B(0xb0aea2, 0x8a8a82, 0.05),
  civic:        B(0xdad3c2, 0x847d70, 0.04),
  education:    B(0xd5c7ae, 0x967460, 0.05),
  religious:    B(0xdcd4c3, 0x977c66, 0.05),
  medical:      B(0xd9d6cc, 0x7f8688, 0.04),
  hotel:        B(0xc4b6a2, 0x787066, 0.05),
  parking:      B(0xa9a69e, 0xa3a099, 0.03),
  transit:      B(0xb6b3a9, 0x7d7a73, 0.04),
  tower:        B(0x93a6b4, 0x6f7981, 0.04),
  other:        B(0xc6bdac, 0x847d71, 0.07),
};
export const BUILDING_DEFAULT = BUILDING.other;

// A building is darker at its feet. Real ambient occlusion on a city this size
// is not affordable and is not the point: one vertical gradient baked into the
// vertex colours grounds every box for nothing, and reads from a hundred metres.
// Measured on screen rather than guessed: at 0.42 over six metres, a dark-walled
// tower spends its first two storeys at 58% of its own colour, which after the
// tone curve is near black -- and a downtown street of them reads as a canyon of
// soot. A quarter, over three metres, still grounds a box and leaves the palette
// alone above head height.
export const WALL_AO = { depth: 0.26, over: 3.6 };

export const ROAD = {
  motorway:     { c: 0x585754, over: 0.06 },
  trunk:        { c: 0x5b5a56, over: 0.06 },
  primary:      { c: 0x5e5c58, over: 0.05 },
  secondary:    { c: 0x605e59, over: 0.05 },
  tertiary:     { c: 0x63615c, over: 0.05 },
  residential:  { c: 0x6a675f, over: 0.04 },
  unclassified: { c: 0x6c6961, over: 0.04 },
  living_street:{ c: 0x6f6c63, over: 0.04 },
  service:      { c: 0x6f6c64, over: 0.03 },
  driveway:     { c: 0x77736a, over: 0.03 },
  parking_aisle:{ c: 0x73706a, over: 0.03 },
  alley:        { c: 0x6d6a63, over: 0.03 },
  pedestrian:   { c: 0x9d9384, over: 0.05 },
  footway:      { c: 0x9c9384, over: 0.06 },
  sidewalk:     { c: 0xa69c8c, over: 0.07 },
  crosswalk:    { c: 0xcdc7bb, over: 0.09 },
  steps:        { c: 0x8e8578, over: 0.09 },
  path:         { c: 0x968a76, over: 0.05 },
  cycleway:     { c: 0x7c7466, over: 0.06 },
  track:        { c: 0x8b8171, over: 0.04 },
  rail:         { c: 0x4e4a46, over: 0.05 },
  unknown:      { c: 0x6d6a62, over: 0.04 },
};
export const ROAD_DEFAULT = ROAD.unknown;
// A kerb is what makes a street a street rather than a stripe of grey. Carriageways
// get one; pavements, paths and rails do not.
export const KERB = { h: 0.13, w: 0.30, c: 0xb3aa9a,
  on: new Set(['motorway','trunk','primary','secondary','tertiary','residential',
               'unclassified','living_street','service','alley','parking_aisle']) };

export const AREA = {
  water:        { c: 0x3f6c7d, y: 0.00 },
  river:        { c: 0x3a6575, y: 0.00 },
  pond:         { c: 0x44758a, y: 0.00 },
  park:         { c: 0x5f8a36, y: 0.02 },
  grass:        { c: 0x6b9640, y: 0.02 },
  forest:       { c: 0x3a5f2c, y: 0.02 },
  scrub:        { c: 0x6d7a42, y: 0.02 },
  garden:       { c: 0x679439, y: 0.02 },
  pitch:        { c: 0x548a38, y: 0.03 },
  playground:   { c: 0xb08c63, y: 0.03 },
  sand:         { c: 0xd2c49b, y: 0.02 },
  plaza:        { c: 0xb3a994, y: 0.04 },
  parking:      { c: 0x87837b, y: 0.03 },
  school:       { c: 0xb2a289, y: 0.02 },
  religious:    { c: 0xa9a08c, y: 0.02 },
  cemetery:     { c: 0x6c8447, y: 0.02 },
  brownfield:   { c: 0x968a72, y: 0.02 },
  construction: { c: 0xa8977a, y: 0.02 },
  residential_lu:{ c: 0x9f9a86, y: 0.01 },
  retail_lu:    { c: 0xa1957f, y: 0.01 },
  commercial_lu:{ c: 0x9d9686, y: 0.01 },
  industrial_lu:{ c: 0x91908a, y: 0.01 },
  wetland:      { c: 0x54794a, y: 0.02 },
  railway:      { c: 0x7c766c, y: 0.02 },
  track:        { c: 0x8f8365, y: 0.02 },
};
export const AREA_DEFAULT = { c: 0x94906f, y: 0.02 };

// LAND USE IS NOT GROUND COVER, and drawing it as though it were is what made
// downtown one flat pale plain. `commercial`, `retail`, `residential` and
// `industrial` are ADMINISTRATIVE polygons: they cover a whole city block,
// roads and pavements and all, so painting them puts a single wash under
// everything and the terrain, the parks and the asphalt all stop reading. They
// stay in the BAKE -- they are real data and the map draws them -- and the game
// simply does not paint them. Delete a name from this set to get it back.
export const HIDE_AREA = new Set([
  'residential_lu', 'retail_lu', 'commercial_lu', 'industrial_lu',
  'brownfield', 'construction', 'railway',
]);

// Parked cars. Portland's own fleet, near enough: a lot of white, silver and
// grey, some dark blue and red, the occasional Subaru green.
export const CAR_COLORS = [
  0xd9dade, 0xb6bbc0, 0x8c9299, 0x54585e, 0x2d3138, 0x7d1f22, 0x1f3a5c,
  0x33503d, 0xb8a06a, 0x9d9fa4, 0xe4e2dc, 0x3c4c5e,
];

// The ground under everything. Terrain takes its colour from STEEPNESS, not from
// height: a flat bench and the bluff above it are the same soil, and shading by
// altitude paints a contour map onto a city.
// THE DEFAULT GROUND IS NOT GRASS. Outside the parks, the ground between
// buildings in a city is yards, gravel, back lanes and dirt -- painting it
// lawn-green makes every block look like a golf course, and painting it
// concrete makes the parks stop reading. A muted khaki sits between the two and
// lets the park and grass polygons carry the actual green.
export const TERRAIN = {
  flat: 0x84904f, steep: 0x736648, rock: 0x635d53,
  steepAt: 0.30, rockAt: 0.62,
};

export const WATER = { c: 0x3a6575, opacity: 0.88, shimmer: 0.04 };

export const PROP = {
  tree:          { h: 9.0,  c: 0x4e7a3c, trunk: 0x5c4936, kind: 'broadleaf' },
  tree_conifer:  { h: 19.0, c: 0x2f5438, trunk: 0x53412f, kind: 'conifer' },
  street_lamp:   { h: 7.2,  c: 0x4a4e52, kind: 'lamp' },
  traffic_signal:{ h: 4.6,  c: 0x3d4247, kind: 'signal' },
  stop_sign:     { h: 2.6,  c: 0xb03a30, kind: 'sign' },
  bench:         { h: 0.85, c: 0x7a5d3f, kind: 'bench' },
  hydrant:       { h: 0.82, c: 0xc0592f, kind: 'post' },
  bin:           { h: 1.0,  c: 0x4d5a4a, kind: 'box' },
  bollard:       { h: 0.95, c: 0x5b5f63, kind: 'post' },
  bus_stop:      { h: 2.9,  c: 0x47525c, kind: 'sign' },
  post_box:      { h: 1.3,  c: 0x3f5a72, kind: 'box' },
  drinking_fountain:{ h: 1.1, c: 0x4a5f52, kind: 'post' },
  power_pole:    { h: 10.5, c: 0x6a5741, kind: 'pole' },
  artwork:       { h: 3.2,  c: 0x8d7a5c, kind: 'box' },
  bike_rack:     { h: 0.9,  c: 0x6d7378, kind: 'rack' },
  planter:       { h: 0.8,  c: 0x7d7361, kind: 'box' },
  billboard:     { h: 6.0,  c: 0x9a9184, kind: 'sign' },
  parking_meter: { h: 1.25, c: 0x5c6166, kind: 'post' },
  newspaper_box: { h: 1.15, c: 0x566a74, kind: 'box' },
  picnic_table:  { h: 0.78, c: 0x81644a, kind: 'bench' },
  flagpole:      { h: 9.0,  c: 0xa6a29a, kind: 'pole' },
  fountain:      { h: 1.4,  c: 0x7e8a86, kind: 'box' },
  car:           { h: 1.48, c: 0xb6bbc0, kind: 'car' },
};
export const PROP_DEFAULT = { h: 1.2, c: 0x8a8578, kind: 'box' };
// Tree crowns pick one of these, indexed by the bake's `tint` byte, so one row of
// street trees is a row of trees rather than a row of one tree.
export const LEAF_TINTS = [0x5c8a40, 0x6e9b45, 0x47733a, 0x7fa64e,
                           0x53803e, 0x86a552];

// How far the world is live. `full` chunks carry everything; `mid` drops props and
// pavement detail; past `mid` the skyline boxes in far.bin carry the horizon.
// How far the world is live. These are the frame budget: at 500 m a chunk,
// `keep` 1900 kept SIXTY-THREE chunks alive and drew 640k triangles for a view
// that fog closes at 1.3 km. The horizon is far.bin's job, and it is one draw
// call.
export const STREAM = {
  full: 480, mid: 1050, keep: 1250,
  perFrame: 1,          // chunks built per frame, so a hitch is never two chunks long
  fetchAhead: 6,
};

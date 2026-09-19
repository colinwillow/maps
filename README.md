# maps

A self-owned, open-data map platform. The navigation app is the proving
exercise; the product is a base layer that unrelated things (stylized nav, AR
buildings, artist directory, community pins) can be built on as plugins.

**Status: Phase 0 — shell.** MapLibre GL renders a basemap centered on
Portland with pan/zoom/tilt/rotate, mercator pinned, OSM attribution visible.
Next: Phase 1, custom cartography.

## Run it

```sh
npm install
cp .env.example .env      # add a MapTiler key from maptiler.com (free tier)
npm run dev
```

Without a key the app still boots, on a tiny offline fallback style (a
hand-sketched Willamette and its bridges) and says so on screen. That fallback
exists so dev and tests never depend on the network — it is not cartography.

## Test before you push

```sh
npm test          # unit tests + headless-browser smoke test
npm run build     # typecheck + production build
```

- `tests/registry.test.ts` — the layer registry contract: ordering, debounce,
  minZoom gating, teardown.
- `tests/style.test.ts` — runs the real MapLibre style-spec validator over the
  built style, plus the cartographic invariants that would *look* wrong rather
  than throw: bridges above water and road, labels above everything, no road
  painted in a water colour, every label carrying a halo. This stands in for
  "look at it" — see the caveat below.
- `tests/smoke.mjs` — boots the real app in headless Chromium against the
  offline fallback, fails on any console error, and checks *direction*, not
  just movement: drag left must pan east, drag down must pan north, wheel up
  must zoom in. A suite that only measures "it moved" passes while panning
  runs backwards.

The smoke test needs a Chromium binary; it defaults to `/opt/pw-browsers/chromium`
and honors `CHROME=/path/to/chrome`. It also loads the real style into a real
MapLibre to prove the library accepts it, globe included.

**What the tests cannot do:** no CI environment here can fetch a vector tile,
so nothing above proves the map *looks* right — only that it is a valid style
that MapLibre builds. Colour, type scale and label density have to be judged on
a phone. Two things to check first when looking: labels rendering at all (if
none appear, the font stack in `TYPE` is the suspect — the first entry is the
intended face and the second a safe fallback), and road weight at z12-15.

## The style: "field guide Portland"

`src/layers/basemap/` — `tokens.ts` holds the entire palette, type scale and
projection; `style.ts` assembles the MapLibre style from them and contains no
colour or font literal of its own (a test fails the build if one appears). A
palette change is one edit.

At world zoom the map has to read as EARTH, which is a different problem from
reading as a city: paper-coloured land against a muted sea is a pale glowing
ball from orbit. So the palette RAMPS by zoom — deep ocean, warmer land, a
coastline heavy enough to see from space, country borders, and polar ice, all
easing into the city palette by about zoom 6. Two white caps are the single
strongest cue that a sphere is the Earth and they cost one layer.

The idea: the basemap is the stage, not the show, because cartoony 3D models
and artist studios land on top of it later and have to pop. So it is warm
paper, sage green-space washes, and warm ink road lines — deliberately not the
two clichés the brief calls out (night-mode road contrast in day mode, and
desaturated grey with one accent colour). There are no yellow or orange road
fills anywhere.

Buildings are extruded with MapLibre's own `fill-extrusion` layer and no
Three.js, which is Phase 4 and costs a single layer: the OpenMapTiles schema
already carries `render_height` and `render_min_height` on the building layer.
The base matters as much as the height — extrude everything from the ground and
anything mapped as a roof part grows a spike. Flat footprints fade out as the
extrusions fade in, so there is no zoom where the city pops.

Saturation is spent in exactly one place: the Willamette. The river gets the
only strong colour and a darker shoreline casing, and the bridges are pulled
out of the road layers by `brunnel` and drawn as the heaviest ink on the map,
above both water and road, so a span reads as a span. Portland's signature is
the river, the bridges and the grid, and that is what should make this read as
*this city* rather than *a city*.

### Projection

`PROJECTION` in `tokens.ts`. Currently `'globe'`. The original brief pinned
mercator because globe complicates the matrix maths for the Phase 5 Three.js
custom layer; MapLibre blends globe back to mercator as you zoom in, so street
level is flat either way and the globe only shows at world zoom. Flip that one
word to go back.

## The launch scene

`src/launch/`. The page opens on the globe in space — slow eastward spin, a few
stylised things in orbit, two distant planets, a title and a way into the city.
`config.ts` holds every colour, speed, orbit and the wordmark.

It is NOT a `MapFeatureLayer`. Layers own MapLibre sources and geolocated data;
this owns none — it is chrome drawn over and under the map, so making it a
layer would have meant a layer that adds no source, which muddies the contract
the whole platform leans on.

Three things it is worth knowing before changing it:

- **It only works because the globe leaves the canvas transparent.** Under
  globe projection MapLibre paints the sphere and nothing else, so a backdrop
  placed *behind* the map shows through as space. Stacking is backdrop → map →
  orbit canvas → UI.
- **The globe's size is measured, not calculated.** See `globeMetrics.ts`; the
  obvious formula is wrong because the sphere is drawn under a perspective
  camera. The launch zoom is then *fitted* per device, because the silhouette
  depends on viewport height as well as zoom — one fixed zoom gives a tidy
  globe on a laptop and one bleeding off both edges of a phone.
- **Occlusion is faked, and the rule is fussier than it looks.** There is no
  depth buffer, so an orbiter is hidden when it is on the far side AND inside
  the globe's silhouette. Hiding on far-side alone blinks things out while they
  are still clearly beside the planet.
- **Going behind is a CLIP, not a skip.** Far-side craft are drawn with the
  canvas clipped to everything outside the globe, so they slide behind the limb
  edge-first. Skipping the draw instead — what this did at first — makes them
  vanish whole the instant their centre crosses the silhouette, which is the
  one moment the illusion of going around has to hold. Measured across a full
  orbit, the visible fraction now changes by at most 2% per frame.

Cloud cover is drawn in the same canvas but placed in LNG/LAT rather than on
screen, so the deck is projected like anything else and turns WITH the planet
instead of sliding across it. Latitudes are sampled equal-area
(`asin(uniform(-1,1))`); uniform-in-degrees packs clouds near the equator by
area, and from a mid-latitude camera that whole band lands along the bottom rim
with a bare pole above it. The limb is set well short of 90 degrees on purpose:
foreshortening crowds clouds into a dense white ring at the true edge, which
reads as a smear rather than weather.

Objects are flat vector shapes on a 2D canvas rather than models. They read at
20px on a phone, cost nothing, and need no asset pipeline; Three.js stays
reserved for Phase 5's hero buildings inside the map's own GL context, where a
second WebGL renderer would fight it for state.

## Walking around: Three.js inside MapLibre

`src/layers/three/` (the integration) and `src/layers/character/` (Colin).
Press **Walk around**. **Left thumb walks, right thumb looks** — twin-stick,
the way the other games in this account work. Tap-to-walk is deliberately gone:
sending him to a pin is a MAP interaction, and keeping both made every tap on
the map ambiguous.

The model is `colin_slim.glb`, copied from the `glorp` repo into `public/models/`
— 36 clips, of which this uses `idle_neutral_00`, `walk_fwd_normal` and
`run_fwd`. It is loaded ONLY when the button is pressed: 5MB has no business
downloading for someone who wants to look at a map.

### What was measured, because the docs and the folklore both mislead

`tests/three.mjs` checks the integration against RENDERED PIXELS — a cube of
known size on a known corner, found in the framebuffer and compared with what
MapLibre itself says. A test that re-derived the same matrix maths would agree
with itself and prove nothing.

- **Use `defaultProjectionData.mainMatrix`, with normalised 0..1 mercator.**
  `modelViewProjectionMatrix` is also correct but wants mercator scaled by
  `worldSize` (512 * 2^zoom); feed it 0..1 and you miss by ten million. The
  Mapbox-era snippets that pass `matrix` correspond to `mainMatrix`.
- **Skip rendering while the globe is round.** `projectionTransition` is 0 once
  MapLibre has blended to mercator and 1 at world view. These matrices only
  describe the mercator plane: measured hundreds of pixels off at z10, exact
  from z14 in.
- **Metres per pixel is `40075017*cos(lat)/(512*2^zoom)`.** The constant
  everyone quotes, 156543.034, is for 256px tiles; MapLibre uses 512px ones, so
  it reports everything at twice its real size and made a correct renderer look
  2x wrong.
- **Camera zoom is chosen by how big HE is.** At z17.5 a 1.8m person is nine
  pixels tall — geometrically right and useless. Street view sits at z21.5.
- **One follower owns the whole camera.** A per-frame `jumpTo` silently cancels
  an in-flight `easeTo`, so mode changes set targets rather than animating; that
  bug stopped street view from ever tilting.

The two GLB traps from Big Don apply here too and are why `loadColin.ts` looks
the way it does: `Box3.setFromObject` lies about skinned meshes, and
`updateWorldMatrix` is not `updateMatrixWorld`. The height check in
`tests/three.mjs` catches both — they fail by orders of magnitude, not inches.

### Ground texture

There is a **Satellite** button in the character HUD. It swaps the illustrated
ground for MapTiler's aerial imagery on the same key the vector tiles use,
keeping roads, buildings and labels on top — the hybrid, not a plain photo.
The land fills have to be hidden with it or they paint over the photograph.

Google's photogrammetry, the thing that makes nuclearsimulation.com look the
way it does, is not available here: their terms require their own SDK and
branding. That is a licensing wall, not a technical one.

## The generated city

`src/layers/city/`. Trees, street lamps, telephone poles, traffic signals and
stop signs, all derived from the road network that is already on screen.

**Why generated rather than authored.** The other games in this account place a
hand-built low-poly GLB. That is the right answer for one hand-made level and
the wrong answer for a planet — you cannot author Portland, let alone
everywhere else. So the furniture comes out of the OSM road geometry the
basemap is already drawing: `plan.ts` turns roads in metres into props in
metres, and walking to a street that really exists finds it furnished.

Buildings are next door in `buildings.ts` and `assemble.ts` — see below.

`plan.ts` is pure — roads in, props out, no three and no MapLibre — which is
what lets the placement be pinned down in unit tests rather than squinted at on
a phone. That matters more than usual here, because almost every check you
would write about street furniture passes just as happily with the entire city
MIRRORED: "trees appear on both sides" passes with the sides swapped, "signs
are near the junction" passes with every sign on the far corner facing away
from the driver who has to read it. So the checks assert signed positions on
both axes and the facing of each prop, on all four arms of a crossroads.

Things worth knowing:

* **Junctions are shared vertices, not line intersections.** Vector tiles split
  ways where they meet, so this is a grid bucket over vertices rather than a
  segment sweep.
* **Jitter runs along the street, never across it.** Across, and the trees walk
  into the carriageway.
* **The plan is deterministic** (`hash01`, seeded on the road id). With
  `Math.random` every tree would teleport each time he crosses a block, since
  the plan is rebuilt every 70 metres.
* **Junction controls are budgeted before furniture.** A junction with no
  signal reads as a bug; a slightly thinner row of trees never does.
* **Clipping is against the circle, not the vertices.** A long straight street
  with both endpoints outside the radius has no vertex inside it at all — and
  that is the street you are most likely standing on.
* **An empty tile query does not demolish the city.** Tiles come and go as you
  move.

### A language of buildings

`buildings.ts`, `facades.ts`, `assemble.ts`. The SHAPE of every building is
real: OpenMapTiles carries the OSM footprint and a `render_height`, so
downtown's towers are the towers that are actually there. What is generated is
everything that makes a box read as a building.

A building is a STACK of sections:

```
cornice   h-c .. h     one band
body      g   .. h-c   the storey band, tiled once per storey
ground    0   .. g     shopfront, lobby, garage door
```

and "taller" means **more repeats of the middle**, not a taller middle. The
ground floor and the cornice are fixed heights, not fractions — a shopfront is
about four and a half metres whether there are three storeys above it or
thirty, and scaling it with the total is what makes procedural cities look like
toys. A test pins that a 14m and a 120m building have the *same* ground floor.

Five families, chosen from the footprint and the height rather than at random,
so the city sorts itself out: 45m+ is a tower, 1100 square metres under 16m is
a warehouse, 260 square metres under 7.5m is a house with a hipped roof, and
the rest is brick low-rise or concrete mid-rise.

The windows are **texture, not geometry** — a window is four triangles and a
block is a few thousand windows. The UVs carry METRES (u is distance along the
facade over the family's bay width, v is height over the storey height), so one
128x192 tile serves a three storey building and a thirty storey one without
stretching. Per-building colour variation cannot come from the material,
because every building of a family shares one so they can merge into a single
draw call; it rides in a vertex colour attribute instead. Ninety buildings come
out as about fourteen meshes.

**Three owns the buildings while the character is walking**, and MapLibre's
`building-3d` is switched off for the duration and restored on the way out.
Drawing both means two copies of every building fighting for the same pixels,
and a style layer has no idea how far away anything is, so there is no way to
hide the extrusion for only the near ones.

Two winding bugs the tests caught before any of it was ever looked at, both of
which draw a building that is entirely inside out:

* the wall quads were wound against the normal they declared, so every face
  would have been culled away — the building keeps exactly the walls it says it
  has and draws none of them;
* `ShapeGeometry` lies in XY, and rotating it flat inverts the winding, so
  every roof faced downwards and was only visible from underneath.

### The roads had to become surfaces first

Street level looked like blank paper, and the reason was cartographic rather
than 3D: every road width ramp stopped at zoom 18, and MapLibre clamps an
interpolate to its last stop. At the street camera's zoom 22.4, where a pixel
is a centimetre, a "6 pixel" minor road was six centimetres of ink. Roads now
carry a real width in METRES from zoom 16 up, interpolated with
`['exponential', 2]` so that constant width holds all the way — linear
interpolation between the same two stops makes a 9m street 130m wide halfway.
They also fade from ink to asphalt and pick up a pavement casing on the way
down, because a warm ink stroke is right for a line on a map and wrong for a
surface you are standing on.

The style's carriageway widths and the generator's kerb line are the same
numbers, and a test asserts they agree. If they ever drift, the trees stand in
the road — and it would look like a placement bug rather than a width one.

### Still to do

Colin walks on a flat plane at sea level: there is no collision, no ground
height, and nothing stops him strolling across the Willamette — or through a
building, a tree or a lamp post.

The thumb sticks rest at an anchor, dim, and move to meet the thumb. They used
to draw nothing at all until touched, which meant the controls were invisible —
there was no way to tell they existed, never mind where. `tests/smoke.mjs`
checks they are on screen and under a thumb before anything is pressed.

### The frame budget

The brief asks for an FPS counter from Phase 4 on, and there is one at the
bottom of the screen in character mode. It reads `idle` when nothing is moving,
and that is correct rather than broken.

**Standing still costs zero map repaints.** It did not used to: the follower
called `map.jumpTo` every frame, and jumpTo schedules a repaint even when every
value is identical — so the render triggered the follower, the follower
triggered the next render, and the whole pitched city repainted forever while
the character stood still. At 78 degrees MapLibre draws all the way to the
horizon, so that was the most expensive thing in the app, running for nothing.
Measured: 32 renders per 1.5s standing still before, 0 after.

The other half of that is just as easy to break, and did break first time:
once the loop parks itself, something has to WAKE it when a thumb moves. Move
input goes through `layer.setMove` rather than being poked onto the character,
precisely so it can. Setting `character.input` directly left the input sitting
there with no frame to act on it and he never moved at all. `tests/smoke.mjs`
pins all three states — idle, walking, and quiet again afterwards.

The launch scene's draw loop also parks itself once faded out, rather than
clearing a full-screen canvas at device pixel ratio for something nobody can
see.

### Handedness: he was facing backwards, and it looked like inverted controls

Colin's rig faces **+Z**, which in this scene is SOUTH, while the code assumed
-Z (north) — the direction a GLTF's forward conventionally points. So at every
heading he ran exactly backwards, and because the camera swings round behind
him as he walks, what you actually saw was a man sprinting straight at the
camera. It reads as "the controls are inverted", which is why the stick maths
got blamed twice and measured correct both times.

The fix is Big Don's rule: **derive handedness, never guess it.**
`src/layers/character/rig.ts` measures which way the rig faces at load and
rotates a node between `root` and the model to cancel it, so
`root.rotation.y = bearingToYaw(heading)` stays literally true.

The primary measurement is the **toes**: a foot points forwards, which is a
geometric fact about a body, and averaging the two cancels the splay. The
shoulder span is the obvious alternative and is strictly weaker — it needs the
rig's left/right naming to be honest AND `up x right` the right way round, and
Big Don shipped both backwards at once where they hid each other. Both are
measured; they cross-check, and a disagreement over 45 degrees warns.

`rig.ts` is split out of `loadColin.ts` purely so this can be tested headlessly
against a synthetic skeleton — `loadColin` imports `GLTFLoader`, which imports
the bare specifier `three` and will not resolve in node. `tests/three.mjs` then
asks the same question of the real GLB at five headings; without the
correction it reports 176 degrees off.

### Input

Stick input is CAMERA-RELATIVE (`input.ts`), which is the one thing to keep in
mind if you touch it. Mapping the stick straight to compass directions is the
obvious thing and it is wrong: in street view the camera swings round behind
the character, so "push up" walked him north whichever way he faced — sideways
at best, backwards when he faced south. Up must mean away from the camera. Buildings
(Phase 4/5) come before that matters.

## Clicking your way down the world

`src/layers/places/`. World, then continent, country, region, city. The first
tap SELECTS — the area lights up, the camera does not move — and a second tap
on the same place ENTERS it. One tap that both highlights and flies gives you
no chance to look before you leap.

`places.ts` is hand-written data, and deliberately so: highlighting a continent
needs POLYGONS, and OpenMapTiles ships administrative boundaries as lines, so
there is nothing in the basemap to fill. The usual source is Natural Earth,
which is a real dependency to vendor. Instead each place carries a bounding
box, the highlight is that box, and the shape of the feature is settled;
swapping boxes for real polygons later touches that one file.

It is a SEED, not an atlas. One path goes all the way down — North America,
United States, Oregon, Portland — and everything else stops at country level.
Filling it in is data entry, not code.

The layers stop at `PLACE_MAXZOOM` (12), below where the character walks, so
their dots cannot steal the taps that mean "walk over there".

### Two MapLibre traps this cost

- **`setStyle` destroys every source and layer you added**, and calling it
  while a style is still loading makes MapLibre rebuild from scratch, which
  also throws away anything added in the gap. So place layers re-attach on
  every `styledata`, and `attach()` is idempotent.
- **`isStyleLoaded()` returns false even when the map is loaded and drawing.**
  Guarding the attach on it meant the layers were never added at all, silently.
  Don't gate on it; attach, and retry on the next `styledata` if it throws.

## Architecture: the layer seam

Everything this platform will grow — basemap, buildings, routes, every pin
type — is the same shape: geolocated entities that render on the map and open
some detail UI. Each one is a module exporting a `MapFeatureLayer`
(`src/layers/types.ts`), owned by the `LayerRegistry` (`src/layers/registry.ts`).

Rules, enforced by convention now and by review forever:

- **A layer never reaches outside itself.** No layer imports another layer.
- **Viewport-scoped fetching, always** — the registry hands each layer
  `(bounds, zoom)` on debounced moveend; no layer installs its own move
  listener or loads a full dataset.
- **Style config lives in data, not code.**

The basemap is itself a layer module (`src/layers/basemap/`): it owns the map
style, pins the mercator projection (globe complicates the Phase 5 custom-layer
matrix math for no benefit), and is the only place that changes when the
Phase 1 custom style replaces the stock MapTiler one.

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every
push to `main`. Two one-time repo settings:

1. Settings → Pages → Source: **GitHub Actions**
2. Settings → Secrets and variables → Actions → new repository secret
   `MAPTILER_KEY` with the MapTiler key (it's baked into the client bundle at
   build time — a MapTiler key is a publishable client key; restrict it by
   domain in the MapTiler dashboard).

## Attribution

OSM attribution is a license requirement, not a courtesy. The attribution
control is always on and non-compact; the MapTiler style carries
`© MapTiler © OpenStreetMap contributors`, and even the offline fallback
credits OSM. Don't remove it.

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
Press **Walk around**; tap the map to send him somewhere, or use the thumb
stick. **Street view** tilts to 78 degrees and swings the camera in behind him.

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

### Still to do

Colin walks on a flat plane at sea level: there is no collision, no ground
height, and nothing stops him strolling across the Willamette. Buildings
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

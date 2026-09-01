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

The idea: the basemap is the stage, not the show, because cartoony 3D models
and artist studios land on top of it later and have to pop. So it is warm
paper, sage green-space washes, and warm ink road lines — deliberately not the
two clichés the brief calls out (night-mode road contrast in day mode, and
desaturated grey with one accent colour). There are no yellow or orange road
fills anywhere.

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

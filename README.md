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
- `tests/smoke.mjs` — boots the real app in headless Chromium against the
  offline fallback, fails on any console error, and checks *direction*, not
  just movement: drag left must pan east, drag down must pan north, wheel up
  must zoom in. A suite that only measures "it moved" passes while panning
  runs backwards.

The smoke test needs a Chromium binary; it defaults to `/opt/pw-browsers/chromium`
and honors `CHROME=/path/to/chrome`.

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

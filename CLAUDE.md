# Working in this repo

There are TWO things here and they share nothing but a domain.

* **`src/`** — the map platform. MapLibre, React, TypeScript, a Vite build.
  A basemap, a launch globe, place navigation, and a Three.js character layer
  that walks on the map. Read the README for it.
* **`public/pdx/`** — **Portland**: a walkable, procedurally built city from
  open map data. Native ES modules, vendored three, **no build step**, the same
  shape as the games in this account. Vite copies `public/` verbatim, so it
  deploys at `/pdx/` and the bundler never touches it.
  **`tools/pdx/`** bakes its data. `tools/pdx/README.md` is the pipeline.

**Do not make `public/pdx/` depend on `src/`, or the reverse.** The whole point
of it being a separate app is that the map's MapLibre context and the game's
WebGL context never have to share state — that fight is what the map's own
character layer already has to manage, and the city does not need it.

## Anything meant for testing has to reach a phone

Pages serves `main` from `.github/workflows/deploy.yml`. A change sitting on a
branch cannot be played, and a twin-stick city is only really testable with two
thumbs on glass. Branch as much as you like while working; **end on `main`**.

Before pushing:

```sh
npm test          # vitest (incl. the pdx suites) + the browser smoke tests
npx vite build    # proves public/pdx/ is in dist/
```

## The bar for done, for `pdx/`

It runs on a phone, in any orientation, with two thumbs. WASD and the arrow keys
exist so it is debuggable on a laptop and that is all they are for.

## What the city actually is

**A SCAFFOLD, NOT THE FINAL ART.** Every street, kerb, roofline, bridge deck and
hillside is in the right place at the right height, which is the expensive part
and the part nobody wants to author. The point is to pick ONE thing — the
Burnside Bridge — build it properly by hand, and drop it in with the rest of the
city already standing around it.

That is `public/pdx/data/landmarks.json`:

```json
"overrides": {
  "Burnside Bridge": { "model": "models/burnside.glb", "keep": ["road"] }
}
```

An override is two halves and both are necessary: a **model**, and a **clear
box** the generator agrees to leave alone. The bake already writes a clear box
for all 73 named bridges and 351 named buildings, so the minimum is a model path
and a name. `keep` lets a layer survive inside the box — `["road"]` for a model
that is only the superstructure and still wants a generated deck to walk on.

**The clear box filters the COLLIDER as well as the picture, from the same
filtered chunk.** Filtering only the geometry leaves an invisible building
standing inside the hand-built bridge, which is the worst kind of bug: nothing
on screen disagrees with anything and the player simply cannot walk there.

`pdx.here()` in the console prints an override entry for wherever you are
standing, and `pdx.near()` lists the nearest named landmarks. Authoring a clear
box by typing coordinates is how you get one that is nearly right, and nearly
right here is a building left inside your model.

## Handedness: derive it, never guess it

**+X is EAST. +Y is UP. +Z is SOUTH. North is −Z.** That is the right-handed
basis three.js uses with Y up (east × up = south). A compass bearing `b` becomes
the heading vector `(sin b, −cos b)` and a yaw of `−b` about +Y.

**Rings are anticlockwise SEEN FROM ABOVE**, which is a positive signed area in
(x, −z) and therefore *clockwise* in the raw (x, z) numbers. `Soup.tri` derives
every normal from the winding so there is exactly one thing to get right.

It has been got wrong three times here, and each time it LOOKED FINE:

* **The whole terrain mesh was back-facing for the first day.** Back faces are
  culled, so it was simply invisible — and the roads and land cover are drawn on
  top of it, so they carried the picture. The tell, missed at the time, was that
  changing `TERRAIN`'s colours changed nothing on screen.
* **`box()`, `cylinder()` and `blob()` were all inside out**, so every lamp post,
  tree trunk, bin and parked car in Portland was lit from within. A back-faced
  post still renders: the near side is culled and you see the far side, which
  for a thin cylinder is the same silhouette. What it costs is the lighting.
* Colin's rig faces **+Z**, not the −Z a glTF conventionally points, so he ran
  exactly backwards at every heading. `measureFacing` in `character.js` measures
  it off the TOES — a foot points forwards, which is a geometric fact about a
  body — and cross-checks against the shoulder span.

**The test that catches an inside-out mesh is the divergence theorem**: for a
closed surface with outward normals, the integral of n·x is +3V, and inside out
it is −3V. `tests/pdx-runtime.test.mjs` runs it over every prop kind. No count,
bounding box or screenshot finds this.

## Ask what a check would still pass with

A city baked MIRRORED satisfies every count, every byte length and every
bounding box you can write about it. So the checks that matter pin a DIRECTION
or a real-world fact:

* downtown is west of the river and Ladd's Addition is east of it;
* Wells Fargo Center is 167 m and is the tallest thing in the city;
* pushing "up" on the left thumb walks him AWAY FROM THE CAMERA at every
  camera bearing — not north, which is the version that works until you turn;
* a road deck over the Willamette clears the water by more than 3 m;
* stepping off a wall along its own normal lands you OUTSIDE the building.

That last one replaced a check that compared the normal with the direction to
the footprint's centroid, which is wrong on any concave plan — the inner face of
an L-shaped block correctly points back at its own centroid. 7% of downtown
failed a check that was itself the bug.

**Tilikum Crossing is not in the list of bridges with drivable decks**, and that
is the data being right: it carries light rail, buses, bikes and people and no
private cars. It failed that check first time and the check was wrong.

## Landmines in the runtime

* **Vertex colours are sRGB and three assumes they are LINEAR.** Every palette
  value in `tune.js` is a hex an eye picked. three converts `material.color` for
  you and does not convert a vertex colour, because a vertex colour is normally
  computed data already in working space. Fed sRGB bytes as linear, every
  mid-tone lands a stop and a half too light and the saturation goes with it —
  which is what "the whole city is grey" looked like, through three palette
  rewrites that could never have fixed it. `world.js` does `pow(vColor, 2.2)`
  in the vertex shader.
* **Tone mapping is `NeutralToneMapping`, not ACES.** ACES is the default reach
  and it is a FILM curve: it desaturates as it rolls off, so a hand-picked
  palette quietly stops existing. Measured on one frame, a sage ground came back
  neutral grey. `NoToneMapping` is the third option and it is worse — every lit
  pale wall clips to flat white.
* **Window bands are a shader, not geometry**, keyed on a one-byte per-vertex
  tag. As geometry a 40 m tower is twelve bands on every wall; as a fragment it
  is a `fract` of world height. It **fades out with distance**, and that is not
  a saving: a 3.3 m band under a metre of screen space aliases into moire, and
  moire on every building in a skyline is worse than no bands at all.
* **`groundAt` takes a HINT and that argument is the point.** A heightmap has
  one answer per (x, z); the Willamette bridges need two — the deck and the
  river forty feet under it. The hint is roughly where the body already is, and
  the answer is the highest surface at or a step above it.
* **Build ONE chunk per frame** (`STREAM.perFrame`). A 500 m square of Portland
  is 15–30 ms of array work; nine at once — which is what crossing a diagonal
  asks for — is a freeze. Spread, it disappears into the frame it always cost.
* **The builders are pure**: numbers in, typed arrays out, no three and no
  scene. That is the seam that lets the whole thing move into a Worker later
  without a rewrite, and it is why `tests/pdx-runtime.test.mjs` can drive them
  in node against the real baked city.
* **There is no stick watchdog and there must not be.** A pointer that is not
  moving generates no events, so "no events" and "no thumb" are the same
  observation — a test that cannot tell its two answers apart is not a test, and
  its false positive (dropping a hold someone is in the middle of) is worse than
  the bug. The four real ways a `pointerup` goes missing on a phone are all
  closed in `input.js`.
* **A phone has no console, so an exception is a blank screen.** The crash trap
  is the first thing in `<head>`, before the import map and before the module,
  registered with CAPTURE so a subresource that 404s is caught too.

## Still to do

* **No traffic.** The cars are parked. Moving traffic wants the road graph as a
  graph, which `connectors` already gives for free.
* **No interiors, no doors.** Buildings are closed shells.
* **The hand-built landmark slot is empty.** Nothing is overridden yet; the
  machinery, the clear boxes and the tests are there waiting for the first GLB.
* **No LOD on props past `STREAM.mid`** — they are simply dropped. A billboard
  impostor for distant trees is the obvious next thing.
* **The play area is 5 km square.** `city.py` moves it or grows it; the fetch
  and the bbox index are cached, so a bigger bake costs only its own row groups.
* **Colin has no idle variety, no jump animation blend-out, and no shadow.**
  There are no shadow maps at all — a projected shadow over a city this size is
  the most expensive thing that could be in here, and the vertical gradient
  baked into every wall (`WALL_AO`) is what grounds things instead.

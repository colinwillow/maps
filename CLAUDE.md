# Working in this repo

The map platform. MapLibre, React, TypeScript, a Vite build: a basemap, a
launch globe, place navigation, and a Three.js character layer that walks on
the map. The README has the detail.

## The walkable Portland is NOT here any more

It lived in `public/pdx/` and it is now its own repo:
**[colinwillow/portland](https://github.com/colinwillow/portland)**, served at
`colinwillow.github.io/portland`.

It was never really part of this project — it shares nothing with it but a
domain, and that was the point: the map's MapLibre context and the game's WebGL
context never have to share state, which is the fight this app's own character
layer already has to manage. What it DID share was a build it has no use for.
It has no build step, so riding inside `public/` put it behind a `dist/` that
the served copy and the repo copy could disagree about, at a `/maps/pdx/` URL
nobody would guess.

**Do not bring it back.** The only thing here that knows it exists is the link
in `index.html`, and that is absolute because it is a different origin now.

## Anything meant for testing has to reach a phone

Pages serves `main` from `.github/workflows/deploy.yml`. Branch as much as you
like while working; **end on `main`**.

```sh
npm test          # vitest + the browser smoke tests + the three checks
npx vite build    # and it has to build
```

`vite.config.ts` uses `base: './'`, so the build works at a domain root and
under a project-site subpath (`colinwillow.github.io/maps/`) alike.

## Handedness: derive it, never guess it

**MapLibre's bearing is the compass direction at the top of the screen.** That
was measured rather than assumed — at bearing 90, a point due east projects
straight up — and it is what the camera-relative stick conversion depends on.

**Colin's rig faces +Z, not the −Z a glTF conventionally points.** In this
scene +Z is SOUTH, so he ran exactly backwards at every heading; and because
the camera swings round behind him as he walks, what that looks like is a man
sprinting straight at the camera. It reads as inverted controls, which is why
the stick maths got blamed twice and measured correct both times.

`src/layers/character/rig.ts` measures which way the rig faces at load and
cancels it, so `root.rotation.y = bearingToYaw(heading)` stays literally true
rather than true-plus-an-offset. **The toes are the primary measurement** — a
foot points forwards, which is a geometric fact about a body, and averaging the
pair cancels the splay. The shoulder span is the obvious alternative and is
strictly weaker: it needs the rig's left/right naming to be honest AND
`up × right` the right way round, and Big Don shipped both backwards at once,
where they hid each other. Both are measured and they cross-check.

It is split out of `loadColin.ts` because that file imports `GLTFLoader`, which
imports the bare specifier `three` and will not resolve in node — so the
orientation maths can be tested headlessly against a synthetic skeleton.

## Ask what a check would still pass with

A suite that only measures distance passes happily while movement runs
backwards, which is exactly what happened above. The checks that earn their
keep pin a DIRECTION or a real-world fact.

## Landmines

* **THE OVERLAY CANVAS HAS TO BE CLEARED EVERY FRAME.** The launch scene
  cleared only on the way out, when the scene parked — so every frame painted
  on top of every frame before it: stars smeared into a wash, the cloud deck
  piled up on itself, and a passing craft left a train of a hundred overlapping
  copies. It surfaced as a test that failed one run in three and was written
  off as flaky; it was reading accumulated paint the whole time. A check now
  clears the canvas, counts one frame's coloured pixels, and requires the count
  two seconds later to be within 12% — 0.5% growth with the fix, 30% without.
* **THREE OWNS THE BUILDINGS while the character is walking**, and MapLibre's
  fill-extrusion is switched off for the duration and restored on the way out.
  Drawing both means two copies of every building fighting for the same pixels,
  and a style layer has no idea how far away anything is, so there is no way to
  hide the extrusion for only the near ones.
* **`ShapeGeometry` lies in XY, and rotating it flat inverts the winding**, so
  every roof faced downwards and was visible only from underneath.
* **Windows are texture, not geometry.** A window is four triangles and a block
  is a few thousand windows. The UVs carry METRES — distance along the facade
  over the bay width, height over the storey height — so one tile serves a
  three-storey building and a thirty-storey one with no stretching.
* **Per-building colour cannot come from the material**, because every building
  of a family shares one so they can merge into a single draw call. It rides in
  a vertex colour attribute instead.
* **An unset `VITE_MAPTILER_KEY` builds fine** — the app falls back to the
  offline style and says so on screen, rather than rendering blank tiles.

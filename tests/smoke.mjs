// Render smoke test: boot the real app in a real browser against the offline
// fallback style (deliberately keyless, so this never depends on the network),
// fail on any console error, and check the things that only break once a GL
// context is involved.
//
// Where it checks movement it checks DIRECTION, not just that numbers changed —
// a suite that only measures "it moved" passes happily while panning runs
// backwards, or while the globe spins the wrong way.
//
// Order matters here. The launch-scene checks run FIRST, at the boot view,
// because the spin deliberately dies on the first user input and the drag
// checks below are user input. The fallback style only draws around Portland,
// so those checks happen after the camera has flown down to the city.

import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium';
const PORT = 8123;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

const server = await createServer({
  root: new URL('..', import.meta.url).pathname,
  server: { port: PORT, strictPort: true },
  // The test is the keyless path on purpose; a key in a local .env would
  // silently turn this into a network test.
  define: { 'import.meta.env.VITE_MAPTILER_KEY': '""' },
});
await server.listen();

// Kill the whole run rather than hang a CI/agent session forever.
const watchdog = setTimeout(() => {
  console.error('FAIL smoke test watchdog: did not finish within 150s');
  process.exit(1);
}, 150000);

const browser = await chromium.launch({
  executablePath: CHROME,
  // --no-sandbox: this runs as root in containers, where the sandbox can't
  // start and the launch hangs rather than failing.
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__mapReady === true, { timeout: 30000 });
  // Not the 'idle' event: under swiftshader the map never goes idle, so that
  // hangs forever. And not queryRenderedFeatures either — at the launch view
  // the offline sketch is far too small to have drawn anything yet.
  await page.waitForFunction(() => window.__map.loaded(), { timeout: 30000 });

  const boot = await page.evaluate(async () => {
    const { LAUNCH } = await import('/src/launch/config.ts');
    const map = window.__map;
    const c = map.getCenter();
    const canvas = map.getCanvas();
    return {
      lng: c.lng, lat: c.lat, zoom: map.getZoom(),
      w: canvas.width, h: canvas.height,
      launchZoom: LAUNCH.zoom, cityZoom: LAUNCH.cityZoom,
    };
  });

  // Longitude has already drifted by the time this samples, because the spin
  // starts on the first frame — that is the feature, not a fault. So pin what
  // the spin must NOT do (touch latitude) and require the drift to be small
  // and EASTWARD, which still fails if it boots over the wrong city or spins
  // the wrong way.
  const lngDrift = boot.lng - -122.6784;
  check('boots looking at Portland',
    Math.abs(boot.lat - 45.5152) < 1e-6 && lngDrift >= 0 && lngDrift < 30,
    `${boot.lng.toFixed(4)}, ${boot.lat.toFixed(4)} (drift ${lngDrift.toFixed(2)}deg east)`);
  check('boots on the globe, not over the city', boot.zoom < 4, `zoom=${boot.zoom.toFixed(2)}`);

  // The launch zoom is FITTED to the viewport, not a fixed number: the globe's
  // silhouette depends on viewport height as well as zoom, so one constant
  // gives a tidy globe on a laptop and one bleeding off a tall phone. Assert
  // the composition instead of the zoom value.
  const fit = await page.evaluate(async () => {
    const { globeScreenRadius, targetGlobeRadius } = await import('/src/launch/globeMetrics.ts');
    const c = window.__map.getCanvas();
    return {
      radius: globeScreenRadius(window.__map),
      target: targetGlobeRadius(c.clientWidth, c.clientHeight),
      w: c.clientWidth, h: c.clientHeight,
    };
  });
  check('globe is fitted to the viewport', Math.abs(fit.radius - fit.target) / fit.target < 0.08,
    `r=${fit.radius.toFixed(0)} target=${fit.target.toFixed(0)} in ${fit.w}x${fit.h}`);
  check('globe does not bleed off the screen', fit.radius * 2 < Math.min(fit.w, fit.h) * 0.95,
    `d=${(fit.radius * 2).toFixed(0)} vs ${Math.min(fit.w, fit.h)}`);
  check('GL canvas has size', boot.w > 0 && boot.h > 0, `${boot.w}x${boot.h}`);
  check('attribution credits OpenStreetMap',
    (await page.locator('.maplibregl-ctrl-attrib').textContent()).includes('OpenStreetMap'));

  // ── the launch scene, at the boot view ────────────────────────────────────
  check('space backdrop is present', await page.locator('.space-backdrop').count() === 1);
  check('orbit canvas is present', await page.locator('.orbit-canvas').count() === 1);
  check('title and call to action are shown', await page.locator('.launch-cta').isVisible());

  // The scene sits ON TOP of the map, so it must not swallow taps meant for
  // the globe underneath.
  check('scene does not block input to the map',
    await page.evaluate(() =>
      getComputedStyle(document.querySelector('.orbit-canvas')).pointerEvents) === 'none');

  // The orbit canvas must be sized to real device pixels, or it draws blurry
  // or, worse, at 0x0 and nothing appears at all.
  const canvasSize = await page.evaluate(() => {
    const c = document.querySelector('.orbit-canvas');
    return { w: c.width, h: c.height, cw: c.clientWidth };
  });
  check('orbit canvas is sized, not 0x0', canvasSize.w > 0 && canvasSize.h > 0,
    `${canvasSize.w}x${canvasSize.h}`);

  // Nothing from the backdrop may be painted across the planet's face. Read
  // the overlay canvas around a ring well inside the globe: it must be almost
  // entirely transparent there. A starfield drawn over the planet is the bug
  // this pins, and it is invisible to every other check here.
  const overPlanet = await page.evaluate(async () => {
    const { globeScreenRadius } = await import('/src/launch/globeMetrics.ts');
    // Clouds and passing craft are DELIBERATELY drawn over the planet, so
    // switch them off for this sample; the point of the check is that none of
    // the BACKDROP — stars, distant planets — reaches the globe's face.
    window.__backdropOnly = true;
    // The scene's draw loop PARKS itself when nothing is changing, so flipping
    // a flag does not repaint on its own — without this wake the sample reads
    // the last frame drawn, clouds and all, and fails intermittently.
    window.dispatchEvent(new Event('overworld:scenewake'));
    await new Promise((r) => setTimeout(r, 250));
    const cv = document.querySelector('.orbit-canvas');
    const ctx = cv.getContext('2d');
    const dpr = cv.width / cv.clientWidth;
    const c = window.__map.project(window.__map.getCenter());
    const r = globeScreenRadius(window.__map) * 0.55;
    let opaque = 0, total = 0;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const x = Math.round((c.x + Math.cos(a) * r) * dpr);
      const y = Math.round((c.y + Math.sin(a) * r) * dpr);
      if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) continue;
      total++;
      if (ctx.getImageData(x, y, 1, 1).data[3] > 8) opaque++;
    }
    window.__backdropOnly = false;
    return { opaque, total };
  });
  // THE SCENE MUST CLEAR ITSELF between frames. It did not: the canvas only
  // cleared on the way out, when the scene parked, so every frame painted on
  // top of every frame before it. Stars smeared into a wash, the cloud deck
  // piled up on itself, and a passing craft left a train of a hundred
  // overlapping copies behind it. Painted area growing over time is the
  // signature, and nothing else here would have caught it.
  const accumulation = await page.evaluate(async () => {
    const cv = document.querySelector('.orbit-canvas');
    const ctx = cv.getContext('2d');
    // Count only COLOURED pixels. Stars and clouds are white and the sky is
    // grey, so the only saturated things on this canvas are the two distant
    // planets, which never move, and the orbiting craft, which do. That makes
    // this number flat when the canvas clears and a rising trail when it does
    // not — where total painted area barely moves either way, because one
    // frame already covers a third of the canvas.
    const count = () => {
      const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 40) continue;
        const max = Math.max(data[i], data[i + 1], data[i + 2]);
        const min = Math.min(data[i], data[i + 1], data[i + 2]);
        if (max - min > 40) n++;
      }
      return n;
    };
    // Wipe it, let exactly one frame land, and count that. A scene that
    // clears itself paints the same amount two seconds later; one that does
    // not keeps adding to it. Measuring without wiping first misses this,
    // because a canvas that has been accumulating for ten seconds is already
    // saturated and barely grows.
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    ctx.clearRect(0, 0, cv.width, cv.height);
    await frame();
    const a = count();
    await new Promise((r) => setTimeout(r, 2500));
    return { a, b: count() };
  });
  check('the launch scene clears itself between frames',
    accumulation.b < accumulation.a * 1.12 && accumulation.a > 300,
    `${accumulation.a} coloured pixels -> ${accumulation.b}`);

  check('backdrop (stars, planets) is not painted over the globe',
    overPlanet.total > 24 && overPlanet.opaque <= 3,
    `${overPlanet.opaque}/${overPlanet.total} samples painted`);

  // The globe must actually be turning, and EASTWARD — "did it change" would
  // pass with the spin running backwards.
  const spinA = await page.evaluate(() => window.__map.getCenter().lng);
  await page.waitForTimeout(1200);
  const spinB = await page.evaluate(() => window.__map.getCenter().lng);
  check('globe spins, and eastward', spinB > spinA + 0.5, `${spinA.toFixed(3)} -> ${spinB.toFixed(3)}`);

  // First real input ends it for good — a globe sliding out from under your
  // thumb is the reason that rule exists.
  await page.mouse.move(450, 300);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(150);
  const stopA = await page.evaluate(() => window.__map.getCenter().lng);
  await page.waitForTimeout(900);
  const stopB = await page.evaluate(() => window.__map.getCenter().lng);
  check('spin stops once the user touches the map', Math.abs(stopB - stopA) < 1e-6,
    `${stopA.toFixed(4)} -> ${stopB.toFixed(4)}`);

  // ── fly down to the city ──────────────────────────────────────────────────
  await page.evaluate(async () => {
    const { LAUNCH } = await import('/src/launch/config.ts');
    window.__map.jumpTo({ center: [-122.6784, 45.5152], zoom: LAUNCH.cityZoom, pitch: 0, bearing: 0 });
  });
  await page.waitForFunction(
    () => window.__map.loaded() && window.__map.queryRenderedFeatures().length > 0,
    { timeout: 30000 });

  // The launch scene fades out over a CSS transition, so wait for it to LAND
  // rather than sampling mid-fade — reading 0.17 there says nothing about
  // whether it ever reaches zero.
  await page.waitForFunction(
    () => +getComputedStyle(document.querySelector('.space-backdrop')).opacity === 0,
    { timeout: 5000 });

  const city = await page.evaluate(() => ({
    layersDrawn: [...new Set(window.__map.queryRenderedFeatures().map((f) => f.layer.id))].sort(),
    backdrop: +getComputedStyle(document.querySelector('.space-backdrop')).opacity,
    ui: +getComputedStyle(document.querySelector('.launch-ui')).opacity,
  }));
  check('fallback style actually rendered the river and bridges',
    city.layersDrawn.includes('river') && city.layersDrawn.includes('bridges'),
    city.layersDrawn.join(','));
  check('launch scene is gone once you are over the city',
    city.backdrop === 0 && city.ui === 0, `backdrop=${city.backdrop} ui=${city.ui}`);
  check('fallback notice is shown when keyless',
    await page.locator('.fallback-notice').isVisible());

  // ── pan by real mouse drag, and in the right DIRECTION ────────────────────
  // Dragging the pointer left carries the map content left, so ground to the
  // east comes into view: center longitude must INCREASE. Dragging down brings
  // the north into view: latitude must increase.
  const before = await page.evaluate(() => { const c = window.__map.getCenter(); return { lng: c.lng, lat: c.lat }; });
  await page.mouse.move(450, 300);
  await page.mouse.down();
  await page.mouse.move(250, 380, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => { const c = window.__map.getCenter(); return { lng: c.lng, lat: c.lat }; });
  check('drag left pans view east (lng increases)', after.lng > before.lng + 1e-4,
    `${before.lng.toFixed(4)} -> ${after.lng.toFixed(4)}`);
  check('drag down pans view north (lat increases)', after.lat > before.lat + 1e-4,
    `${before.lat.toFixed(4)} -> ${after.lat.toFixed(4)}`);

  // ── wheel zoom, signed ────────────────────────────────────────────────────
  const z0 = await page.evaluate(() => window.__map.getZoom());
  await page.mouse.move(450, 300);
  await page.mouse.wheel(0, -400);
  // Wait for the zoom to LAND rather than guessing how long MapLibre's wheel
  // easing takes. A fixed sleep here reads the pre-zoom value now and then,
  // which fails a check about direction for a reason that has nothing to do
  // with direction.
  await page.waitForFunction(
    (z) => window.__map.getZoom() > z + 0.05, z0, { timeout: 4000 },
  ).catch(() => {});
  const z1 = await page.evaluate(() => window.__map.getZoom());
  check('wheel up zooms in', z1 > z0 + 0.05, `${z0.toFixed(2)} -> ${z1.toFixed(2)}`);

  // ── tilt and rotate take, and the projection stays pinned ─────────────────
  // The projection is a TOKEN, not a constant of this test: the brief pinned
  // mercator and it is now globe. Assert the live map agrees with the token
  // rather than hard-coding either — this still fails if the style.load
  // pinning in basemap/index.ts stops working, which is the bug worth catching.
  const view = await page.evaluate(async () => {
    const { PROJECTION } = await import('/src/layers/basemap/tokens.ts');
    const map = window.__map;
    map.jumpTo({ pitch: 55, bearing: 30 });
    return {
      pitch: map.getPitch(), bearing: map.getBearing(),
      projection: map.getProjection()?.type, expected: PROJECTION,
    };
  });
  check('pitch applies', Math.abs(view.pitch - 55) < 1e-6, `pitch=${view.pitch}`);
  check('rotate applies', Math.abs(view.bearing - 30) < 1e-6, `bearing=${view.bearing}`);
  check('projection matches the token', view.projection === view.expected,
    `live=${view.projection} token=${view.expected}`);

  await page.waitForTimeout(300);
  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  // ── the frame budget while walking ────────────────────────────────────────
  // Standing still must cost NOTHING. The follower used to call jumpTo every
  // frame, and jumpTo schedules a repaint even when every value is identical,
  // so the whole pitched city repainted forever while the character stood
  // still. The other half of that fix is just as easy to break: once the loop
  // parks itself, something has to WAKE it when a thumb moves, or the input
  // sits there and he never moves at all.
  const budget = await page.evaluate(async () => {
    const map = window.__map;
    const count = (ms) => new Promise((res) => {
      let n = 0;
      const tick = () => n++;
      map.on('render', tick);
      setTimeout(() => { map.off('render', tick); res(n); }, ms);
    });
    // This dev style has no building-3d layer to hide, so the handover would
    // pass vacuously. Stand one in, so the check is about the character layer
    // finding it and switching it off rather than about it being absent.
    if (!map.getLayer('building-3d')) {
      map.addLayer({ id: 'building-3d', type: 'background',
        paint: { 'background-color': '#000000', 'background-opacity': 0 } });
    }

    const enter = document.querySelector('.char-enter');
    if (!enter) return { skipped: true };
    enter.click();
    await new Promise((r) => setTimeout(r, 12000));
    if (document.querySelector('.char-loading')) return { skipped: true };

    const streetBtn = [...document.querySelectorAll('.char-btn')]
      .find((b) => b.textContent.trim() === 'Street view');
    streetBtn?.click();
    await new Promise((r) => setTimeout(r, 5000));

    // Furnish the streets around him before measuring anything, so the frame
    // budget is measured with a real city in the scene rather than an empty
    // one. No tiles are reachable here, so the roads are synthetic — the
    // planning, geometry and instancing below them are the shipping code.
    const ticks = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((n) => n * 40);
    const grid = [
      ...ticks.map((south, i) => ({ id: 100 + i, kind: 'minor',
        points: ticks.map((east) => ({ east, south })) })),
      ...ticks.map((east, i) => ({ id: 200 + i, kind: 'minor',
        points: ticks.map((south) => ({ east, south })) })),
    ];
    const props = window.__charRoads?.(grid) ?? 0;
    // A block of buildings, through the same seam, for the same reason.
    const sq = (size, cx, cz) => {
      const h = size / 2;
      return [{ east: cx - h, south: cz - h }, { east: cx + h, south: cz - h },
              { east: cx + h, south: cz + h }, { east: cx - h, south: cz + h }];
    };
    const block = [];
    for (let i = 0; i < 24; i++) {
      block.push({ id: 500 + i, minHeight: 0, height: 7 + (i % 6) * 11,
        rings: [sq(16, (i % 6) * 40 - 100, Math.floor(i / 6) * 40 - 60)] });
    }
    const buildings = window.__charBuildings?.(block) ?? 0;
    // MapLibre's own extrusion must be OFF while three owns the buildings, or
    // every building is drawn twice, fighting for the same pixels.
    const extrusionVisible = map.getLayer('building-3d')
      ? map.getLayoutProperty('building-3d', 'visibility') !== 'none'
      : null;
    // Long enough for the street-view camera to finish damping into place with
    // the city in the scene, since an unsettled camera legitimately renders.
    await new Promise((r) => setTimeout(r, 4000));

    const idle = await count(1200);
    // The tile reader runs on every 'idle'. It must not strip the furniture
    // off the streets just because this style has no vector source to read.
    const propsAfterIdle = window.__charRoads?.() ?? 0;
    // Drive him straight from the layer's own input path.
    const before = map.getCenter();
    window.__charMove?.(0, -1);
    const walking = await count(1200);
    window.__charMove?.(0, 0);
    const after = map.getCenter();
    // Wait for quiet rather than assuming how long the camera takes to damp
    // into place. The assertion is still "it reaches zero and stays there" —
    // this only stops it depending on a stopwatch.
    let settled = -1;
    for (let i = 0; i < 6 && settled !== 0; i++) settled = await count(1200);
    // The controls have to be VISIBLE without being touched first. They were
    // not: the knob sat at opacity 0 until a thumb landed and there was no
    // base at all, so there was no way to tell the sticks existed, let alone
    // where. Measured BEFORE Exit, or there are no sticks left to measure.
    const vw = window.innerWidth, vh = window.innerHeight;
    const sticks = [...document.querySelectorAll('.stick-base')].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        opacity: +getComputedStyle(el).opacity,
        w: Math.round(r.width),
        onScreen: r.left >= 0 && r.top >= 0 && r.right <= vw + 1 && r.bottom <= vh + 1,
        low: r.top > vh * 0.6,
        leftHalf: r.left + r.width / 2 < vw / 2,
      };
    });

    // ...and the extrusion must come BACK when he leaves, or the map is left
    // with no buildings at all for everyone who never pressed Walk around.
    const exit = [...document.querySelectorAll('.char-btn')]
      .find((b) => b.textContent.trim() === 'Exit');
    exit?.click();
    await new Promise((r) => setTimeout(r, 500));
    const extrusionRestored = map.getLayer('building-3d')
      ? map.getLayoutProperty('building-3d', 'visibility') !== 'none'
      : null;

    return {
      idle, walking, settled, props, propsAfterIdle, buildings, sticks,
      extrusionVisible, extrusionRestored,
      moved: Math.hypot(after.lng - before.lng, after.lat - before.lat),
    };
  });

  if (budget.skipped) {
    check('character frame budget', false, 'character did not start');
  } else {
    check('the character layer furnishes the streets around him',
      budget.props > 200, `${budget.props} props`);
    check('the character layer builds the buildings around him',
      budget.buildings > 12, `${budget.buildings} buildings`);
    check('MapLibre stops drawing its own extrusions while three owns them',
      budget.extrusionVisible === false, `visible=${budget.extrusionVisible}`);
    check('and draws them again once he leaves',
      budget.extrusionRestored === true, `visible=${budget.extrusionRestored}`);
    check('both thumb sticks are drawn before anything is touched',
      budget.sticks.length === 2 && budget.sticks.every((s) => s.opacity > 0.3 && s.w > 60),
      JSON.stringify(budget.sticks.map((s) => `${s.w}px @${s.opacity}`)));
    check('they sit under the thumbs, one each side, fully on screen',
      budget.sticks.length === 2 && budget.sticks.every((s) => s.onScreen && s.low) &&
      budget.sticks.filter((s) => s.leftHalf).length === 1,
      JSON.stringify(budget.sticks.map((s) => ({ low: s.low, on: s.onScreen, left: s.leftHalf }))));
    check('the furniture survives the map going idle',
      budget.propsAfterIdle === budget.props, `${budget.propsAfterIdle} of ${budget.props} left`);
    // Measured with the generated city in the scene: a thousand instanced
    // props must not put the perpetual repaint back.
    check('standing still costs no map repaints', budget.idle === 0, `${budget.idle} renders`);
    check('walking renders, and moves him', budget.walking > 5 && budget.moved > 1e-6,
      `${budget.walking} renders, moved ${budget.moved.toExponential(1)} deg`);
    check('it goes quiet again once he stops', budget.settled === 0, `${budget.settled} renders`);
  }

  // ── the real cartography, loaded into a real MapLibre ─────────────────────
  // The static style-spec validator runs in tests/style.test.ts. This is the
  // other half: MapLibre itself must accept the style and build its layers.
  // Tiles and glyphs cannot be fetched here (no network), so only the style
  // document is under test — errors past this point are expected fetch
  // failures and are no longer counted.
  const styleCheck = await page.evaluate(async () => {
    const { buildStyle } = await import('/src/layers/basemap/style.ts');
    const map = window.__map;
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve({ timedOut: true }), 20000);
      map.once('style.load', () => {
        clearTimeout(t);
        const layers = map.getStyle().layers;
        resolve({
          layers: layers.length,
          projection: map.getProjection()?.type,
          bridgeAboveWater:
            layers.findIndex((l) => l.id === 'bridge') > layers.findIndex((l) => l.id === 'water'),
          named: map.getStyle().name,
          extrusions: layers.filter((l) => l.type === 'fill-extrusion').length,
        });
      });
      map.setStyle(buildStyle('SMOKEKEY'));
    });
  });
  check('MapLibre accepts the custom style', !styleCheck.timedOut && styleCheck.layers > 15,
    `${styleCheck.layers} layers, name=${styleCheck.named}`);
  check('custom style renders on the globe', styleCheck.projection === 'globe',
    String(styleCheck.projection));
  check('bridges still sit above water once MapLibre has built the style',
    styleCheck.bridgeAboveWater === true);
  check('MapLibre builds the extruded buildings', styleCheck.extrusions === 1,
    `${styleCheck.extrusions} fill-extrusion layers`);
} finally {
  await browser.close();
  await server.close();
}

clearTimeout(watchdog);
console.log(failures === 0 ? '\nsmoke: all checks passed' : `\nsmoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

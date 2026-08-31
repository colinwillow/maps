// Render smoke test: boot the real app in a real browser against the offline
// fallback style (deliberately keyless, so this never depends on the network),
// fail on any console error, and check the things that only break once a GL
// context is involved. Where it checks movement it checks DIRECTION, not just
// that numbers changed — a suite that only measures "it moved" passes happily
// while panning runs backwards.

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
  console.error('FAIL smoke test watchdog: did not finish within 120s');
  process.exit(1);
}, 120000);

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

  // Wait for a full render, then ask the map what it actually drew. (Not the
  // 'idle' event: under swiftshader the map never goes idle, so that hangs.)
  await page.waitForFunction(
    () => window.__map.loaded() && window.__map.queryRenderedFeatures().length > 0,
    { timeout: 30000 },
  );

  const boot = await page.evaluate(() => {
    const map = window.__map;
    const c = map.getCenter();
    const canvas = map.getCanvas();
    const drawn = map.queryRenderedFeatures();
    return {
      lng: c.lng, lat: c.lat, zoom: map.getZoom(),
      w: canvas.width, h: canvas.height,
      renderedFeatures: drawn.length,
      layersDrawn: [...new Set(drawn.map((f) => f.layer.id))].sort(),
    };
  });

  check('boots centered on Portland',
    Math.abs(boot.lng - -122.6784) < 1e-6 && Math.abs(boot.lat - 45.5152) < 1e-6,
    `${boot.lng.toFixed(4)}, ${boot.lat.toFixed(4)}`);
  check('initial zoom is 12', boot.zoom === 12, `zoom=${boot.zoom}`);
  check('GL canvas has size', boot.w > 0 && boot.h > 0, `${boot.w}x${boot.h}`);
  check('fallback style actually rendered the river and bridges',
    boot.layersDrawn.includes('river') && boot.layersDrawn.includes('bridges'),
    boot.layersDrawn.join(','));
  check('fallback notice is shown when keyless',
    await page.locator('.fallback-notice').isVisible());
  check('attribution credits OpenStreetMap',
    (await page.locator('.maplibregl-ctrl-attrib').textContent()).includes('OpenStreetMap'));

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
  await page.waitForTimeout(500);
  const z1 = await page.evaluate(() => window.__map.getZoom());
  check('wheel up zooms in', z1 > z0 + 0.05, `${z0.toFixed(2)} -> ${z1.toFixed(2)}`);

  // ── tilt and rotate take, and mercator stays pinned ───────────────────────
  const view = await page.evaluate(() => {
    const map = window.__map;
    map.jumpTo({ pitch: 55, bearing: 30 });
    return {
      pitch: map.getPitch(),
      bearing: map.getBearing(),
      projection: map.getProjection()?.type,
    };
  });
  check('pitch applies', Math.abs(view.pitch - 55) < 1e-6, `pitch=${view.pitch}`);
  check('rotate applies', Math.abs(view.bearing - 30) < 1e-6, `bearing=${view.bearing}`);
  check('projection is pinned to mercator', view.projection === 'mercator', String(view.projection));

  await page.waitForTimeout(300);
  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await server.close();
}

clearTimeout(watchdog);
console.log(failures === 0 ? '\nsmoke: all checks passed' : `\nsmoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

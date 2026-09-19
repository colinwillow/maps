// Verifies the Three.js-inside-MapLibre integration against RENDERED PIXELS.
//
// This is the riskiest part of the project, so it is checked the only way that
// actually proves anything: put a cube of known size on a known street corner,
// render it, find it in the framebuffer, and compare where it landed and how
// big it is against what MapLibre itself says those numbers should be.
//
// It would be easy to write a test that re-derives my own matrix maths and
// agrees with itself. Reading pixels is what makes it independent.

import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium';
const PORT = 8140;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

const server = await createServer({
  root: new URL('..', import.meta.url).pathname,
  server: { port: PORT, strictPort: true },
  define: { 'import.meta.env.VITE_MAPTILER_KEY': '""' },
});
await server.listen();

const watchdog = setTimeout(() => {
  console.error('FAIL three test watchdog: did not finish within 150s');
  process.exit(1);
}, 150000);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // Vite may re-optimize deps on the first load and reload the page out from
  // under us mid-evaluate. Load once to trigger it, settle, then reload.
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__map != null, { timeout: 30000 });

  const result = await page.evaluate(async ({ zooms }) => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { ThreeLayer } = await import('/src/layers/three/ThreeLayer.ts');
    const MapCls = window.__map.constructor;

    const ORIGIN = { lng: -122.6784, lat: 45.5152 };
    const CUBE_M = 20;          // 20 metres on a side
    // Keep it near the centre so it is never clipped by the canvas edge at
    // high zoom, which would drag the measured centroid inward.
    const OFFSET_EAST = 20;
    const OFFSET_SOUTH = 15;

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:600px;z-index:-1;';
    document.body.appendChild(host);

    const map = new MapCls({
      container: host, center: ORIGIN, zoom: 17, pitch: 0, bearing: 0,
      attributionControl: false,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      style: { version: 8, sources: {}, layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#ffffff' } }] },
    });
    await new Promise((r) => map.once('load', r));

    const layer = new ThreeLayer(ORIGIN, 'verify');

    // Scale and position are measured against a FLAT ground plane, not a cube.
    // Seen from above a cube is inflated by perspective — its top face is 20m
    // nearer the camera — so measuring one conflates horizontal scale with
    // camera height. A plane lying on the ground is exactly its own size.
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(CUBE_M, CUBE_M),
      new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide }),
    );
    pad.rotation.x = -Math.PI / 2;   // lay it flat
    pad.position.set(OFFSET_EAST, 0.05, OFFSET_SOUTH);
    layer.scene.add(pad);

    // A separate cube, off to one side, purely for the tilt check.
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(CUBE_M, CUBE_M, CUBE_M),
      new THREE.MeshBasicMaterial({ color: 0x00ff00 }),
    );
    cube.position.set(OFFSET_EAST, CUBE_M / 2, OFFSET_SOUTH);
    cube.visible = false;
    layer.scene.add(cube);
    map.addLayer(layer.asCustomLayer());

    const cubeLngLat = layer.frame.toLngLat(OFFSET_EAST, OFFSET_SOUTH);

    const readRedCentroid = () => {
      const src = map.getCanvas();
      const cv = document.createElement('canvas');
      cv.width = src.width; cv.height = src.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(src, 0, 0);
      const { data } = ctx.getImageData(0, 0, src.width, src.height);
      let sx = 0, sy = 0, n = 0, minX = 1e9, maxX = -1e9;
      for (let y = 0; y < src.height; y++) {
        for (let x = 0; x < src.width; x++) {
          const i = (y * src.width + x) * 4;
          if (data[i] > 180 && data[i + 1] < 90 && data[i + 2] < 90) {
            sx += x; sy += y; n++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
        }
      }
      const dpr = src.width / map.getCanvas().clientWidth;
      return n === 0 ? null
        : { x: sx / n / dpr, y: sy / n / dpr, pixels: n, widthCss: (maxX - minX + 1) / dpr };
    };

    const out = [];
    for (const zoom of zooms) {
      map.jumpTo({ center: ORIGIN, zoom, pitch: 0, bearing: 0 });
      map.triggerRepaint();
      await new Promise((r) => setTimeout(r, 700));
      const seen = readRedCentroid();
      const expected = map.project(cubeLngLat);
      // Metres per pixel. Derive it from MapLibre's OWN world size rather than
      // the folklore constant: 156543.034 is metres/pixel for 256px tiles, and
      // MapLibre uses 512px tiles (worldSize = 512 * 2^zoom, confirmed against
      // the live transform), so that constant reports everything twice its
      // real size. Getting this wrong made a correct renderer look 2x off.
      const worldSize = 512 * Math.pow(2, zoom);
      const mpp = (40075016.686 * Math.cos(ORIGIN.lat * Math.PI / 180)) / worldSize;
      out.push({
        zoom, seen,
        expected: { x: expected.x, y: expected.y },
        expectedWidthPx: CUBE_M / mpp,
        projection: map.getProjection()?.type,
      });
    }

    // Does it survive a tilt? Only checks that it stays on screen and roughly
    // above the ground point, since perspective moves the centroid up.
    pad.visible = false;
    cube.visible = true;
    cube.material.color.set(0xff0000);
    map.jumpTo({ center: ORIGIN, zoom: 17, pitch: 80, bearing: 0 });
    map.triggerRepaint();
    await new Promise((r) => setTimeout(r, 700));
    const tilted = readRedCentroid();
    const tiltedGround = map.project(cubeLngLat);

    map.remove();
    return { out, tilted, tiltedGround: { x: tiltedGround.x, y: tiltedGround.y } };
  }, { zooms: [15, 17, 18] });

  for (const r of result.out) {
    const label = `z${r.zoom}`;
    if (!r.seen) { check(`${label}: cube is drawn`, false, 'no red pixels found'); continue; }
    const dx = r.seen.x - r.expected.x;
    const dy = r.seen.y - r.expected.y;
    const dist = Math.hypot(dx, dy);
    // Top-down, the centroid of a ground-sitting cube projects onto its own
    // ground position, so this is a direct test of the whole matrix chain.
    check(`${label}: ground pad lands where MapLibre projects that lng/lat`, dist < 6,
      `off by ${dist.toFixed(1)}px (seen ${r.seen.x.toFixed(0)},${r.seen.y.toFixed(0)} vs ${r.expected.x.toFixed(0)},${r.expected.y.toFixed(0)})`);
    // And is the right SIZE — a cube at the right spot but half scale would
    // pass every position check.
    const sizeErr = Math.abs(r.seen.widthCss - r.expectedWidthPx) / r.expectedWidthPx;
    check(`${label}: ground pad is 20m wide on screen`, sizeErr < 0.1,
      `drew ${r.seen.widthCss.toFixed(1)}px, expected ${r.expectedWidthPx.toFixed(1)}px`);
  }

  check('cube survives an 80 degree tilt', result.tilted != null && result.tilted.pixels > 50,
    result.tilted ? `${result.tilted.pixels} px` : 'not drawn');
  if (result.tilted) {
    // Tilted, a 20m-tall cube's centroid must sit ABOVE its ground point on
    // screen. If it were below, the up axis is inverted — the exact bug that
    // makes a building look like a hole.
    check('tilted cube stands up, not down', result.tilted.y < result.tiltedGround.y,
      `cube y=${result.tilted.y.toFixed(0)} ground y=${result.tiltedGround.y.toFixed(0)}`);
  }

  // ── the character ─────────────────────────────────────────────────────────
  const colin = await page.evaluate(async () => {
    const { loadColin, skinnedBounds } = await import('/src/layers/character/loadColin.ts');
    const m = await loadColin('/models/colin_slim.glb', 1.8);
    const box = skinnedBounds(m.root);
    let textured = 0, selfLit = 0, shiny = 0, materials = 0;
    m.root.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      for (const mat of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!mat) continue;
        materials++;
        if (mat.map) textured++;
        if (mat.emissiveMap && mat.emissiveIntensity > 0.1) selfLit++;
        if ((mat.metalness ?? 0) > 0.01 || (mat.roughness ?? 1) < 0.9) shiny++;
      }
    });
    return {
      height: +(box.max.y - box.min.y).toFixed(3),
      feetY: +box.min.y.toFixed(3),
      clips: m.clips.size,
      hasWalk: m.clips.has('walk_fwd_normal'),
      hasRun: m.clips.has('run_fwd'),
      hasIdle: m.clips.has('idle_neutral_00'),
      materials, textured, selfLit, shiny,
    };
  });

  // Height is the check that catches the two GLB traps at once: measuring a
  // skinned mesh through Box3.setFromObject, or through a stale bind inverse,
  // both give wildly wrong numbers rather than a near-miss.
  check('Colin is 1.8m tall', Math.abs(colin.height - 1.8) < 0.02, `${colin.height}m`);
  check('his feet are on the ground', Math.abs(colin.feetY) < 0.02, `y=${colin.feetY}`);
  check('the locomotion clips he needs are present',
    colin.hasWalk && colin.hasRun && colin.hasIdle, `${colin.clips} clips`);
  // The look, checked on the MATERIAL rather than by eye: lit by his own paint,
  // and nothing shiny, or a moving specular turns painted texture to plastic.
  check('he is lit by his own texture', colin.selfLit === colin.textured && colin.textured > 0,
    `${colin.selfLit}/${colin.textured} self-lit`);
  check('nothing on him is shiny', colin.shiny === 0, `${colin.shiny} shiny materials`);

  // ── the generated city ────────────────────────────────────────────────────
  // The planner's maths is pinned in tests/city.test.ts; what this adds is the
  // part unit tests cannot reach — that the props come out of the real
  // pipeline (plan, geometry, instancing, MapLibre's own matrix) and land on
  // the pavement rather than in the road, measured in rendered pixels.
  const city = await page.evaluate(async () => {
    const { ThreeLayer } = await import('/src/layers/three/ThreeLayer.ts');
    const { CityProps } = await import('/src/layers/city/index.ts');
    const { planCity, CITY } = await import('/src/layers/city/plan.ts');

    const ORIGIN = { lng: -122.6784, lat: 45.5152 };
    const ZOOM = 19;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:600px;z-index:-1;';
    document.body.appendChild(host);

    const map = new (window.__map.constructor)({
      container: host, center: ORIGIN, zoom: ZOOM, pitch: 0, bearing: 0,
      attributionControl: false,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      style: { version: 8, sources: {}, layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#ffffff' } }] },
    });
    await new Promise((r) => map.once('load', r));

    const layer = new ThreeLayer(ORIGIN, 'city-verify');
    map.addLayer(layer.asCustomLayer());
    const city = new CityProps(layer);

    // One street running due east straight through the middle of the view.
    const roads = [{ id: 7, kind: 'minor', points: [
      { east: -150, south: 0 }, { east: 150, south: 0 }] }];
    city.setRoads(roads);
    city.refresh({ east: 0, south: 0 }, true);
    map.triggerRepaint();
    await new Promise((r) => setTimeout(r, 900));

    const src = map.getCanvas();
    const cv = document.createElement('canvas');
    cv.width = src.width; cv.height = src.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(src, 0, 0);
    const { data } = ctx.getImageData(0, 0, src.width, src.height);
    const dpr = src.width / src.clientWidth;
    const midY = src.height / 2;

    let north = 0, south = 0, inRoad = 0, total = 0;
    // Foliage is the only green thing on a white background.
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 4;
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (!(g > r + 12 && g > b + 12)) continue;
        total++;
        const dy = (y - midY) / dpr;
        if (dy < 0) north++; else south++;
        // The carriageway, in CSS pixels, from MapLibre's own world size.
        const mpp = (40075016.686 * Math.cos(ORIGIN.lat * Math.PI / 180)) / (512 * 2 ** ZOOM);
        if (Math.abs(dy) < (CITY.halfWidth.minor / mpp) * 0.75) inRoad++;
      }
    }

    const planned = planCity(roads, { east: 0, south: 0 });
    const meshes = layer.scene.children.filter((o) => o.type === 'Group')
      .flatMap((g) => g.children);
    const out = {
      total, north, south, inRoad,
      propCount: city.propCount,
      planned: planned.length,
      instanced: meshes.length,
      kinds: [...new Set(planned.map((p) => p.kind))].sort(),
      // Nothing may be drawn while the globe is still a sphere.
      visible: layer.visibleNow,
    };
    map.remove();
    host.remove();
    return out;
  });

  check('the generated city reaches the screen', city.total > 400, `${city.total} foliage pixels`);
  check('trees line BOTH kerbs', city.north > 100 && city.south > 100,
    `${city.north} north / ${city.south} south`);
  // The check that would pass with the whole city mirrored is the one above;
  // this is the one that would not. A sign error in the side normal, or jitter
  // applied across the street instead of along it, plants trees in the road.
  check('nothing is standing in the road', city.inRoad === 0, `${city.inRoad} pixels in the carriageway`);
  check('every planned prop is instanced into the scene',
    city.propCount === city.planned && city.planned > 20 && city.instanced > 0,
    `${city.propCount}/${city.planned} props in ${city.instanced} instanced meshes`);
  check('a plain street gets trees, lamps and poles',
    ['lamp', 'pole', 'tree'].every((k) => city.kinds.includes(k)), city.kinds.join(','));

  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await server.close();
}

clearTimeout(watchdog);
console.log(failures === 0 ? '\nthree: all checks passed' : `\nthree: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

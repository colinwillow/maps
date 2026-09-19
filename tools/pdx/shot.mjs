// Look at it. Boots the real page in a real Chromium against a real static
// server, drives it, and writes PNGs.
//
// WebGL headless runs on SwiftShader -- software rasterisation -- so the frame
// rate this reports means NOTHING about a phone. What it does prove is that the
// module evaluates, the chunks parse, the geometry builds, the winding is not
// inside out and the camera is pointing at the city. Every one of those is
// invisible to a syntax check and every one of them is a blank screen.
//
//   node tools/pdx/shot.mjs [--at lat,lon] [--az deg] [--pitch r] [--out p.png]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = path.resolve('public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.bin': 'application/octet-stream', '.png': 'image/png', '.glb': 'model/gltf-binary',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };

const args = Object.fromEntries(process.argv.slice(2).join(' ')
  .split('--').filter(Boolean).map((s) => { const [k, ...v] = s.trim().split(' '); return [k, v.join(' ')]; }));

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  let f = p;
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage({
  viewport: { width: +(args.w || 1280), height: +(args.h || 800) },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

const t0 = Date.now();
await page.goto(`http://127.0.0.1:${port}/pdx/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#startB.on', { timeout: 240000 });
console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await page.click('#startB');
await page.waitForFunction(() => window.pdx && window.pdx.player, null, { timeout: 60000 });

if (args.at) {
  const [lat, lon] = args.at.split(',').map(Number);
  await page.evaluate(([la, lo]) => window.pdx.to(la, lo), [lat, lon]);
}
if (args.az !== undefined) await page.evaluate((a) => { window.pdx.camera.az = +a; }, args.az);
if (args.pitch !== undefined) await page.evaluate((p) => { window.pdx.camera.pitch = +p; window.pdx.camera.high = false; }, args.pitch);
if (args.dist !== undefined) await page.evaluate((d) => { window.pdx.camera.have = +d; }, args.dist);
if (args.up !== undefined) await page.evaluate((y) => window.pdx.ghost(true, +y), args.up);

// Let it stream: the frame budget builds one chunk per frame on purpose, so an
// immediate screenshot is a picture of the loader rather than of the city.
const settle = +(args.settle || 14);
for (let i = 0; i < settle; i++) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => window.pdx.world.stats());
  if (i % 4 === 3) console.log(`  ${i + 1}s  chunks ${s.live} fetching ${s.fetching} tris ${s.tris}`);
}
const info = await page.evaluate(() => ({
  ...window.pdx.world.stats(),
  x: Math.round(window.pdx.player.x), z: Math.round(window.pdx.player.z),
  y: +window.pdx.player.y.toFixed(1),
  ground: +window.pdx.ground.terrainAt(window.pdx.player.x, window.pdx.player.z).toFixed(1),
  rig: window.pdx.player && document.getElementById('chip').textContent,
  where: document.getElementById('where').textContent,
  calls: window.pdx.renderer.info.render.calls,
  triangles: window.pdx.renderer.info.render.triangles,
}));
console.log('state:', JSON.stringify(info));
const out = args.out || '/tmp/pdx-shot.png';
await page.screenshot({ path: out });
console.log('wrote', out);
if (errors.length) { console.log('CONSOLE ERRORS:'); errors.slice(0, 10).forEach((e) => console.log('  ' + e)); }
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);

import { useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { LAUNCH, SCENE, STARS, ORBITERS, TITLE, CLOUDS } from './config';
import { makeClouds, angularDistance, placeCloud } from './clouds';
import { placeOrbiter, inDrawOrder, sceneOpacity } from './orbits';
import { globeScreenRadius, fitGlobeZoom, targetGlobeRadius } from './globeMetrics';
import { drawOrbiter, drawPlanet, drawAtmosphere, FACES_TRAVEL } from './sprites';

/**
 * The launch screen: space behind the globe, things in orbit around it, a
 * title, and a way in to the city.
 *
 * It sits in front of the map canvas but ignores pointer events, so the globe
 * underneath still drags and zooms normally. The backdrop is a separate
 * element BEHIND the map — MapLibre leaves everything outside the globe
 * transparent under globe projection, which is what makes this work at all.
 */

type Star = { x: number; y: number; r: number; phase: number; dim: boolean };

function makeStars(w: number, h: number): Star[] {
  // Deterministic placement so the sky does not reshuffle on every re-render.
  let seed = 20260901;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  return Array.from({ length: STARS.count }, () => ({
    x: rand() * w,
    y: rand() * h,
    r: STARS.minSize + rand() * (STARS.maxSize - STARS.minSize),
    phase: rand(),
    dim: rand() > 0.6,
  }));
}

export function LaunchScene({ map }: { map: maplibregl.Map | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [opacity, setOpacity] = useState(1);
  const opacityRef = useRef(1);

  // Track zoom so the whole scene fades out as the camera dives to the city.
  useEffect(() => {
    if (!map) return;
    const update = () => {
      const next = sceneOpacity(map.getZoom(), LAUNCH.fadeFrom, LAUNCH.fadeTo);
      opacityRef.current = next;
      setOpacity(next);
    };
    update();
    map.on('move', update);
    map.on('zoom', update);
    return () => {
      map.off('move', update);
      map.off('zoom', update);
    };
  }, [map]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const clouds = makeClouds(CLOUDS.count);
    let stars: Star[] = [];
    let w = 0;
    let h = 0;
    let raf = 0;
    const started = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = makeStars(w, h);
    };
    resize();

    // The globe's radius only changes when the camera does, so measure it on
    // movement rather than every frame — it costs ~250 projections.
    const fit = () => {
      // Only while still on the launch view — refitting after the user has
      // dived toward the city would yank the camera back out.
      if (map.getZoom() > LAUNCH.spinMaxZoom) return;
      fitGlobeZoom(map, targetGlobeRadius(canvas.clientWidth, canvas.clientHeight));
    };
    fit();

    let radius = globeScreenRadius(map);
    const remeasure = () => {
      radius = globeScreenRadius(map);
    };
    const onResize = () => {
      resize();
      fit();
      remeasure();
    };
    window.addEventListener('resize', onResize);
    map.on('move', remeasure);
    map.on('resize', remeasure);

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const alpha = opacityRef.current;
      ctx.clearRect(0, 0, w, h);
      if (alpha <= 0.001) return;

      const t = (performance.now() - started) / 1000;
      const centre = map.project(map.getCenter());
      const cx = centre.x;
      const cy = centre.y;

      ctx.save();
      ctx.globalAlpha = alpha;

      // Everything in this block is BEHIND the planet, but the canvas is in
      // front of it, so punch a hole where the globe is. Without this the
      // starfield twinkles across the face of the planet, which instantly
      // reads as a bug. The reversed arc is what makes the hole: same path,
      // opposite winding.
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.arc(cx, cy, radius, 0, Math.PI * 2, true);
      ctx.clip();

      // Stars twinkle by breathing their alpha, not their size — resizing a
      // 1px dot just makes it flicker.
      for (const s of stars) {
        const tw = 0.55 + 0.45 * Math.sin((t / STARS.twinkleSec + s.phase) * Math.PI * 2);
        ctx.globalAlpha = alpha * (s.dim ? 0.45 : 0.9) * tw;
        ctx.fillStyle = s.dim ? SCENE.starDim : SCENE.star;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = alpha;
      drawPlanet(ctx, w * 0.16, h * 0.2, Math.max(16, radius * 0.16), SCENE.planetA, false);
      drawPlanet(ctx, w * 0.86, h * 0.78, Math.max(11, radius * 0.11), SCENE.planetB, true);
      ctx.restore(); // end the hole — the glow and the orbiters may cross it

      // ── cloud cover, ON the planet ────────────────────────────────────
      // __noClouds is a test hook. Clouds are the one thing allowed to paint
      // over the globe, which would otherwise mask the check that nothing
      // ELSE does — the starfield bleeding across the planet is a real bug
      // that check exists to catch.
      if (!window.__noClouds) {
      // Clipped to the disc, and each cloud is projected from its own
      // lng/lat, so the deck turns with the globe instead of sliding over it.
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.995, 0, Math.PI * 2);
      ctx.clip();
      const viewCentre = map.getCenter();
      for (const cloud of clouds) {
        const lng = cloud.lng + t * CLOUDS.driftDegPerSec * cloud.drift;
        const at = { lng: ((lng + 540) % 360) - 180, lat: cloud.lat };
        const placed = placeCloud(angularDistance(viewCentre, at));
        if (!placed.visible) continue;
        const p = map.project(at);
        if (!Number.isFinite(p.x) || Math.hypot(p.x - cx, p.y - cy) > radius) continue;
        const size = cloud.size * radius * placed.scale;
        const base = alpha * CLOUDS.opacity * placed.alpha;
        for (const [i, puff] of cloud.puffs.entries()) {
          // Each puff breathes on its own slow cycle, so the deck keeps
          // forming and dissolving instead of sitting there as fixed blobs.
          const breathe = 1 + 0.18 * Math.sin(t * CLOUDS.churn * cloud.drift + i * 1.9);
          const r = puff.r * size * breathe;
          const px = p.x + puff.dx * size;
          const py = p.y + puff.dy * size;
          // A soft radial falloff rather than a hard disc: flat circles read
          // as painted dots, and it is the fuzzy edge that reads as vapour.
          const g = ctx.createRadialGradient(px, py, r * 0.15, px, py, r);
          g.addColorStop(0, `rgba(255,255,255,${base})`);
          g.addColorStop(0.55, `rgba(255,255,255,${base * 0.72})`);
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = g;
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      }
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = alpha;
      drawAtmosphere(ctx, cx, cy, radius, SCENE.glow);
      ctx.globalAlpha = alpha;

      const places = ORBITERS.map((o) => placeOrbiter(o, t, radius, cx, cy));
      for (const i of inDrawOrder(places)) {
        const p = places[i];
        if (p.occluded) continue;
        const o = ORBITERS[i];
        ctx.save();
        ctx.translate(p.x, p.y);
        if (FACES_TRAVEL[o.kind]) ctx.rotate(p.heading);
        ctx.scale(p.scale, p.scale);
        ctx.globalAlpha = alpha * (p.depth < 0 ? 0.82 : 1);
        drawOrbiter(ctx, o.kind, o.size);
        ctx.restore();
      }
      ctx.restore();
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      map.off('move', remeasure);
      map.off('resize', remeasure);
    };
  }, [map]);

  const flyToCity = () => {
    if (!map) return;
    map.flyTo({ center: map.getCenter(), zoom: LAUNCH.cityZoom, duration: 3200, essential: true });
  };

  return (
    <>
      <div className="space-backdrop" aria-hidden style={{ opacity }} />
      <canvas ref={canvasRef} className="orbit-canvas" aria-hidden />
      {/* The container spans a band across the bottom of the screen, so it
          must NOT take pointer events — it was swallowing taps meant for
          places sitting in the lower half of the globe. Only the button
          below opts back in. */}
      <div className="launch-ui" style={{ opacity }}>
        <h1 className="launch-title">{TITLE.text}</h1>
        <p className="launch-sub">{TITLE.subtitle}</p>
        <button
          className="launch-cta"
          style={{ pointerEvents: opacity < 0.3 ? 'none' : 'auto' }}
          onClick={flyToCity}
        >
          {TITLE.cta}
        </button>
      </div>
    </>
  );
}

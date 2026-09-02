import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import { LAUNCH } from './config';

/**
 * The slow idle rotation on the launch screen.
 *
 * Three rules, all of which exist because the alternative is annoying:
 * - it stops for good the first time the user touches the map, because a globe
 *   that keeps sliding out from under your thumb is infuriating;
 * - it never runs once you are zoomed past the launch view, where it would be
 *   a map scrolling itself out from under you;
 * - it advances by ELAPSED TIME, not per frame, so it turns at the same speed
 *   on a 120Hz phone and a stuttering laptop.
 */
export function useGlobeSpin(map: maplibregl.Map | null) {
  useEffect(() => {
    if (!map) return;

    let stopped = false;
    let raf = 0;
    let last = performance.now();

    const stop = () => {
      stopped = true;
    };
    // Anything that takes you off the globe view ends the spin for good:
    // selecting a place, or stepping into the character. Without this the
    // ground keeps sliding underfoot and the character looks like he is
    // walking on a treadmill.
    window.addEventListener('overworld:stopspin', stop);
    // Any real input ends it. 'movestart' alone would catch our own flyTo too.
    const events = ['mousedown', 'touchstart', 'wheel', 'keydown'] as const;
    const canvas = map.getCanvasContainer();
    for (const e of events) canvas.addEventListener(e, stop, { passive: true });

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.1); // clamp: a backgrounded tab
      last = now;                                    // must not jump the globe
      if (stopped || map.getZoom() > LAUNCH.spinMaxZoom) return;
      const c = map.getCenter();
      map.setCenter([c.lng + LAUNCH.spinDegPerSec * dt, c.lat]);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      for (const e of events) canvas.removeEventListener(e, stop);
      window.removeEventListener('overworld:stopspin', stop);
    };
  }, [map]);
}

import type { Orbiter } from './config';

export type Placement = {
  x: number;
  y: number;
  /** Draw scale from depth — nearer objects are bigger. */
  scale: number;
  /** Heading of travel in screen space, for the things that point where they go. */
  heading: number;
  /** True when the globe is in front of this object and it should not be drawn. */
  occluded: boolean;
  /** -1 (far side) .. 1 (near side). Used only for draw order. */
  depth: number;
};

/**
 * Where an orbiter is at time t.
 *
 * The orbit is a circle in its own plane, tilted about the screen's x-axis.
 * `tilt` 0 is edge-on (a flat line across the globe) and PI/2 is face-on (a
 * ring you see as a circle), so a mix of tilts reads as objects genuinely
 * going around rather than sliding on glass.
 */
export function placeOrbiter(
  o: Orbiter,
  tSec: number,
  globeRadius: number,
  cx: number,
  cy: number,
): Placement {
  const r = o.radius * globeRadius;
  const a = (tSec / o.period + o.phase) * Math.PI * 2;

  const inPlaneX = Math.cos(a) * r;
  const inPlaneY = Math.sin(a) * r;

  const x = cx + inPlaneX;
  const y = cy + inPlaneY * Math.sin(o.tilt);
  const z = inPlaneY * Math.cos(o.tilt); // + is toward the viewer

  const depth = r === 0 ? 0 : z / r;

  // Occlusion without a depth buffer: an object is hidden only when it is on
  // the far side AND inside the globe's silhouette. Testing depth alone would
  // blink things out while they are still clearly beside the planet, which is
  // the obvious-in-hindsight bug this rule exists to avoid.
  const withinDisc = Math.hypot(x - cx, y - cy) < globeRadius;
  const occluded = z < 0 && withinDisc;

  // Heading from the derivative of the path, so a plane points where it flies.
  const dx = -Math.sin(a);
  const dy = Math.cos(a) * Math.sin(o.tilt);
  const heading = Math.atan2(dy, dx * Math.sign(o.period));

  return { x, y, scale: 0.72 + 0.36 * (depth + 1) / 2, heading, occluded, depth };
}

/** Painter's algorithm: far side first, so near objects overlap far ones. */
export function inDrawOrder(placements: Placement[]): number[] {
  return placements
    .map((p, i) => [p.depth, i] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([, i]) => i);
}

/**
 * Scene opacity across the zoom range: full at the launch view, gone by the
 * time you are over the city. Clamped, so it never goes negative or above 1.
 */
export function sceneOpacity(zoom: number, fadeFrom: number, fadeTo: number): number {
  if (zoom <= fadeFrom) return 1;
  if (zoom >= fadeTo) return 0;
  return 1 - (zoom - fadeFrom) / (fadeTo - fadeFrom);
}

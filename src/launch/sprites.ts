import { SCENE } from './config';
import type { OrbiterKind } from './config';

type Ctx = CanvasRenderingContext2D;

/**
 * The orbiting things, drawn as flat vector shapes rather than models.
 *
 * Each draws centred on the origin at roughly `s` pixels across; the caller
 * has already translated, rotated and scaled. Chunky outlines and few details
 * are the point — these read at 20px on a phone, where a detailed model turns
 * to mush.
 */

/** Hex token -> rgba string, so gradients can fade a palette colour to nothing. */
export function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * The atmosphere: a RING hugging the limb, never a disc.
 *
 * A radial gradient fills everything inside its inner radius with the first
 * stop, so starting one at 0.96R painted translucent blue over the entire
 * planet and turned the warm paper basemap grey. Start at 0 instead and hold
 * the colour transparent until just inside the edge.
 */
export function drawAtmosphere(ctx: Ctx, cx: number, cy: number, radius: number, color: string) {
  const outer = radius * 1.3;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer);
  const edge = radius / outer;
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(Math.max(0, edge - 0.03), rgba(color, 0));
  g.addColorStop(edge, rgba(color, 0.34));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.fill();
}

const outline = (ctx: Ctx, w: number) => {
  ctx.strokeStyle = SCENE.craftInk;
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
};

function satellite(ctx: Ctx, s: number) {
  const body = s * 0.36;
  const panel = s * 0.36;
  const gap = s * 0.06;
  outline(ctx, s * 0.07);
  // spar first, so the panels sit on top of it
  ctx.beginPath();
  ctx.moveTo(-body / 2 - gap - panel, 0);
  ctx.lineTo(body / 2 + gap + panel, 0);
  ctx.stroke();
  // solar wings, butted up against the body
  ctx.fillStyle = SCENE.craftAccent;
  for (const dir of [-1, 1]) {
    const near = dir * (body / 2 + gap);
    ctx.beginPath();
    ctx.rect(Math.min(near, near + dir * panel), -s * 0.17, panel, s * 0.34);
    ctx.fill();
    ctx.stroke();
  }
  // body
  ctx.fillStyle = SCENE.craft;
  ctx.beginPath();
  ctx.rect(-body / 2, -body / 2, body, body);
  ctx.fill();
  ctx.stroke();
  // dish
  ctx.fillStyle = SCENE.craftWarm;
  ctx.beginPath();
  ctx.arc(0, -body * 0.72, s * 0.11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function ufo(ctx: Ctx, s: number) {
  outline(ctx, s * 0.07);
  // dome
  ctx.fillStyle = SCENE.craftAccent;
  ctx.beginPath();
  ctx.arc(0, -s * 0.06, s * 0.22, Math.PI, 0);
  ctx.fill();
  ctx.stroke();
  // saucer
  ctx.fillStyle = SCENE.craft;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.5, s * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // lights
  ctx.fillStyle = SCENE.craftWarm;
  for (const dx of [-0.3, 0, 0.3]) {
    ctx.beginPath();
    ctx.arc(dx * s, s * 0.045, s * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
}

function plane(ctx: Ctx, s: number) {
  outline(ctx, s * 0.08);
  ctx.fillStyle = SCENE.craft;
  // fuselage, nose toward +x so heading rotation points it correctly
  ctx.beginPath();
  ctx.moveTo(s * 0.5, 0);
  ctx.lineTo(-s * 0.3, s * 0.11);
  ctx.lineTo(-s * 0.42, 0);
  ctx.lineTo(-s * 0.3, -s * 0.11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // wings
  ctx.fillStyle = SCENE.craftAccent;
  ctx.beginPath();
  ctx.moveTo(s * 0.08, 0);
  ctx.lineTo(-s * 0.16, s * 0.4);
  ctx.lineTo(-s * 0.24, s * 0.38);
  ctx.lineTo(-s * 0.06, 0);
  ctx.lineTo(-s * 0.24, -s * 0.38);
  ctx.lineTo(-s * 0.16, -s * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function cloud(ctx: Ctx, s: number) {
  ctx.fillStyle = SCENE.cloud;
  ctx.globalAlpha *= 0.85;
  for (const [dx, dy, r] of [
    [-0.26, 0.04, 0.2],
    [0, -0.04, 0.28],
    [0.26, 0.05, 0.19],
    [0.08, 0.1, 0.2],
  ] as const) {
    ctx.beginPath();
    ctx.arc(dx * s, dy * s, r * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

const DRAW: Record<OrbiterKind, (ctx: Ctx, s: number) => void> = {
  satellite,
  ufo,
  plane,
  cloud,
};

/** Only the things with a nose need turning to face their travel direction. */
export const FACES_TRAVEL: Record<OrbiterKind, boolean> = {
  satellite: false,
  ufo: false,
  plane: true,
  cloud: false,
};

export function drawOrbiter(ctx: Ctx, kind: OrbiterKind, size: number) {
  DRAW[kind](ctx, size);
}

/** A distant planet: flat disc, soft terminator, optional ring. */
export function drawPlanet(
  ctx: Ctx,
  x: number,
  y: number,
  r: number,
  color: string,
  ring: boolean,
) {
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // A sliver of shadow so it reads as a sphere, not a dot. Clipped to the
  // planet, or the ellipse spills out past the limb and it looks like a bite.
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = SCENE.spaceBottom;
  ctx.beginPath();
  ctx.ellipse(x + r * 0.42, y, r * 0.62, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (ring) {
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = SCENE.planetRing;
    ctx.lineWidth = Math.max(1.5, r * 0.1);
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.7, r * 0.42, -0.42, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

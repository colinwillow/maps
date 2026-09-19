import * as THREE from 'three';
import type { Family } from './buildings';

/**
 * The facades, drawn once into a canvas and then tiled by the metre.
 *
 * Why textures rather than geometry: a window is four triangles and a city
 * block is a few thousand windows. The UVs in buildings.ts carry metres, so
 * one 128x192 tile is one bay by one storey and a thirty storey tower is the
 * same texture repeated thirty times up — which is exactly the "stack another
 * section on top" the buildings are cut into, done on the GPU for free.
 *
 * Per-building colour variation does NOT come from here. All buildings of a
 * family share one material so they can merge into a single draw call, and the
 * tint rides in a vertex colour attribute instead.
 *
 * Without a DOM (the unit tests) this degrades to a plain coloured material
 * rather than throwing, so the geometry can still be tested headlessly.
 */

export type SectionKind = 'ground' | 'body' | 'cornice';

const PAINT: Record<Family, { wall: string; trim: string; glass: string; dark: string; roof: string }> = {
  house:     { wall: '#E6DCCB', trim: '#FBF7EF', glass: '#4C6270', dark: '#CBBFA9', roof: '#7A6553' },
  brick:     { wall: '#B0735C', trim: '#E8DFCF', glass: '#3C5361', dark: '#8F5B48', roof: '#6E6155' },
  midrise:   { wall: '#CCC4B4', trim: '#EFE8D9', glass: '#53707E', dark: '#AFA695', roof: '#8C857A' },
  tower:     { wall: '#8DA6B3', trim: '#C8D6DC', glass: '#6C92A5', dark: '#6E8794', roof: '#7C8A91' },
  warehouse: { wall: '#C0BAAD', trim: '#E3DCCC', glass: '#68797F', dark: '#A39C8E', roof: '#8E887C' },
};

function canvas(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const ctx = el.getContext('2d');
  if (!ctx) return null;
  draw(ctx);
  const tex = new THREE.CanvasTexture(el);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A window with a sill and a lintel, which is most of what reads as a window. */
function punchedWindow(
  c: CanvasRenderingContext2D, p: (typeof PAINT)[Family],
  x: number, y: number, w: number, h: number, panes = 2,
) {
  c.fillStyle = p.glass;
  c.fillRect(x, y, w, h);
  // A lighter top-left is the whole of "there is glass here" at this size.
  const g = c.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0.34)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.06)');
  g.addColorStop(1, 'rgba(0,0,0,0.12)');
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  c.strokeStyle = p.trim;
  c.lineWidth = 3;
  c.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  c.lineWidth = 2;
  c.beginPath();
  for (let i = 1; i < panes; i++) {
    const px = x + (w * i) / panes;
    c.moveTo(px, y); c.lineTo(px, y + h);
  }
  c.stroke();
  c.fillStyle = p.dark;
  c.fillRect(x - 3, y + h, w + 6, 4); // sill
}

function drawBody(c: CanvasRenderingContext2D, family: Family, w: number, h: number) {
  const p = PAINT[family];
  c.fillStyle = p.wall;
  c.fillRect(0, 0, w, h);

  if (family === 'brick') {
    // Courses. Brick is the one family where the WALL carries the texture.
    c.fillStyle = p.dark;
    for (let y = 0; y < h; y += 8) {
      c.globalAlpha = 0.35;
      c.fillRect(0, y, w, 1);
      c.globalAlpha = 0.18;
      for (let x = (y / 8) % 2 ? 0 : 11; x < w; x += 22) c.fillRect(x, y, 1, 8);
    }
    c.globalAlpha = 1;
    punchedWindow(c, p, w * 0.22, h * 0.18, w * 0.56, h * 0.6, 2);
  } else if (family === 'house') {
    c.strokeStyle = 'rgba(0,0,0,0.08)';
    c.lineWidth = 1;
    for (let y = 6; y < h; y += 9) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    punchedWindow(c, p, w * 0.26, h * 0.2, w * 0.48, h * 0.5, 2);
  } else if (family === 'tower') {
    // A curtain wall is a spandrel band and a glass band, not punched holes.
    c.fillStyle = p.glass;
    c.fillRect(0, h * 0.12, w, h * 0.62);
    const g = c.createLinearGradient(0, h * 0.12, w, h * 0.74);
    g.addColorStop(0, 'rgba(255,255,255,0.4)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0.16)');
    c.fillStyle = g;
    c.fillRect(0, h * 0.12, w, h * 0.62);
    c.fillStyle = p.trim;
    for (let x = 0; x < w; x += w / 3) c.fillRect(x, 0, 3, h);   // mullions
    c.fillRect(0, h * 0.74, w, 4);                                // spandrel edge
  } else if (family === 'warehouse') {
    c.fillStyle = p.dark;
    for (let x = 0; x < w; x += 16) { c.globalAlpha = 0.22; c.fillRect(x, 0, 2, h); }
    c.globalAlpha = 1;
    punchedWindow(c, p, w * 0.1, h * 0.12, w * 0.8, h * 0.26, 4); // high strip light
  } else {
    punchedWindow(c, p, w * 0.16, h * 0.16, w * 0.68, h * 0.58, 3);
  }
}

function drawGround(c: CanvasRenderingContext2D, family: Family, w: number, h: number) {
  const p = PAINT[family];
  c.fillStyle = p.wall;
  c.fillRect(0, 0, w, h);

  if (family === 'warehouse') {
    c.fillStyle = p.dark;                       // roller door
    c.fillRect(w * 0.12, h * 0.22, w * 0.76, h * 0.78);
    c.strokeStyle = 'rgba(0,0,0,0.18)';
    c.lineWidth = 2;
    for (let y = h * 0.28; y < h; y += 10) { c.beginPath(); c.moveTo(w * 0.12, y); c.lineTo(w * 0.88, y); c.stroke(); }
    return;
  }
  // Fascia, then glass down to a bulkhead — the anatomy of a shopfront, and
  // the thing that makes a street read as a street rather than as storage.
  c.fillStyle = p.dark;
  c.fillRect(0, 0, w, h * 0.16);
  c.fillStyle = p.glass;
  c.fillRect(w * 0.06, h * 0.2, w * 0.88, h * 0.64);
  const g = c.createLinearGradient(0, h * 0.2, w, h * 0.84);
  g.addColorStop(0, 'rgba(255,255,255,0.42)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(0,0,0,0.2)');
  c.fillStyle = g;
  c.fillRect(w * 0.06, h * 0.2, w * 0.88, h * 0.64);
  c.fillStyle = p.trim;
  c.fillRect(w * 0.46, h * 0.2, 5, h * 0.64);
  c.fillStyle = p.dark;
  c.fillRect(0, h * 0.84, w, h * 0.16); // bulkhead
}

function drawCornice(c: CanvasRenderingContext2D, family: Family, w: number, h: number) {
  const p = PAINT[family];
  c.fillStyle = p.dark;
  c.fillRect(0, 0, w, h);
  c.fillStyle = p.trim;
  c.fillRect(0, h * 0.12, w, h * 0.3);
  c.fillStyle = 'rgba(0,0,0,0.22)';
  c.fillRect(0, h * 0.62, w, h * 0.38);
}

const cache = new Map<string, THREE.MeshStandardMaterial>();

/**
 * The material for one family and one section, shared by every building of
 * that family so they can all merge into one draw call. The per-building tint
 * comes from vertex colours, which is why `vertexColors` is on.
 */
export function facadeMaterial(family: Family, kind: SectionKind): THREE.MeshStandardMaterial {
  const key = `${family}:${kind}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const w = 128;
  const h = kind === 'cornice' ? 48 : kind === 'ground' ? 160 : 192;
  const tex = canvas(w, h, (c) => {
    if (kind === 'ground') drawGround(c, family, w, h);
    else if (kind === 'cornice') drawCornice(c, family, w, h);
    else drawBody(c, family, w, h);
  });

  // Spread the map only when there IS one: three warns on an explicit
  // undefined, and without a DOM (the unit tests) there is no canvas to draw.
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    ...(tex ? { map: tex } : {}),
    vertexColors: true,
    // The house rule, from Robits by way of Big Don: nothing is shiny. A
    // moving specular hotspot turns painted texture into wet plastic.
    roughness: 1,
    metalness: 0,
  });
  cache.set(key, mat);
  return mat;
}

let roofMat: THREE.MeshStandardMaterial | null = null;
export function roofMaterial(): THREE.MeshStandardMaterial {
  roofMat ??= new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0,
  });
  return roofMat;
}

/** The base colour a family's roofs and plant are tinted toward. */
export function roofColour(family: Family): THREE.Color {
  return new THREE.Color(PAINT[family].roof);
}

/** Drop every cached texture and material. */
export function disposeFacades() {
  for (const m of cache.values()) { m.map?.dispose(); m.dispose(); }
  cache.clear();
  roofMat?.dispose();
  roofMat = null;
}

import type maplibregl from 'maplibre-gl';
import type { MapFeatureLayer } from '../types';
import { ThreeLayer } from '../three/ThreeLayer';
import { loadColin } from './loadColin';
import { Character } from './Character';
import type { LngLat } from '../three/geo';

export const CAMERA = {
  /** Overhead: looking down, character centred. */
  overheadPitch: 0,
  /**
   * Zooms are set by how big HE is, not by how much map fits. At z17.5 a 1.8m
   * person is nine pixels tall — geometrically right and useless to play with.
   * Metres per pixel is 40075017*cos(lat)/(512*2^zoom), so z19 puts him near
   * 17px overhead and z21.5 near 100px in street view, which is the size a
   * third-person character needs to read as one.
   */
  overheadZoom: 19.5,
  /**
   * Street: near-horizontal, behind his shoulder. MapLibre's default ceiling
   * is 60 and it accepts up to 180, warning that past 60 is experimental.
   * 78 reads as standing on the pavement without the horizon breaking up.
   */
  streetPitch: 78,
  /**
   * Close enough to read as a third-person game rather than a map with a
   * person on it. Metres per pixel is 40075017*cos(lat)/(512*2^zoom), so at
   * z22.4 a 1.8m character stands about 160px tall — roughly a fifth of a
   * phone screen, which is where third-person cameras usually sit.
   */
  streetZoom: 22.4,
  /** Seconds for the camera to catch up. Follows, never snaps. */
  followTau: 0.25,
  /** How fast the camera drifts back behind him when the right thumb is idle. */
  swingDegPerSec: 90,
  /** Right stick: degrees of yaw per second at full deflection. */
  lookYawDegPerSec: 105,
  /** Right stick: degrees of pitch per second at full deflection. */
  lookPitchDegPerSec: 70,
  minPitch: 20,
  maxPitch: 82,
  /** Seconds of no right-thumb input before the camera starts drifting back. */
  autoSwingAfter: 1.6,
} as const;

export type CharacterMode = 'overhead' | 'street';

/**
 * Colin on the map: a Three scene, a walk controller, and a camera that
 * follows him.
 *
 * This IS a MapFeatureLayer — unlike the launch scene, it owns a real MapLibre
 * layer (the custom 3D layer), so it belongs to the registry like any other.
 */
export function characterLayer(origin: LngLat, modelUrl: string) {
  const three = new ThreeLayer(origin, 'character-3d');

  let character: Character | null = null;
  let map: maplibregl.Map | null = null;
  let mode: CharacterMode = 'overhead';
  let following = true;

  /** Right thumb: -1..1 each. x yaws the camera, y pitches it. */
  const look = { x: 0, y: 0 };
  let lastLookAt = 0;

  // Rolling frame times, so the HUD can show what the phone is actually doing.
  const frameTimes: number[] = [];

  // Tap-to-walk is deliberately gone. Sending him to a pin and watching him
  // walk there is a MAP interaction; this is a game, and the sticks are the
  // controls. Keeping both meant every tap on the map was ambiguous.

  const layer: MapFeatureLayer & {
    getCharacter(): Character | null;
    setMode(m: CharacterMode): void;
    getMode(): CharacterMode;
    setFollowing(f: boolean): void;
    setMove(east: number, south: number): void;
    setLook(x: number, y: number): void;
    getFps(): number;
    ready: Promise<void>;
  } = {
    id: 'character',
    minZoom: 14,
    ready: Promise.resolve(),

    attach(m: maplibregl.Map) {
      map = m;
      // Past 60 degrees is experimental per MapLibre's own docs, so raise the
      // ceiling deliberately here rather than everywhere.
      m.setMaxPitch(85);
      m.addLayer(three.asCustomLayer());

      three.setFrameCallback((dt) => {
        if (!character) return;
        if (dt > 0) {
          frameTimes.push(dt);
          if (frameTimes.length > 45) frameTimes.shift();
        }
        character.update(dt);
        const autoSwing = performance.now() - lastLookAt > CAMERA.autoSwingAfter * 1000;
        if (following && map) {
          followCharacter(map, character, three.frame, mode, dt, look, autoSwing);
        }
        // Ask for another frame ONLY while something is changing. Every frame
        // repaints the whole pitched city — at 78 degrees MapLibre draws all
        // the way to the horizon — so idling at 60fps burns a phone battery
        // and buys nothing. Standing still now costs zero frames.
        const wantZoom = mode === 'street' ? CAMERA.streetZoom : CAMERA.overheadZoom;
        const settling =
          Math.abs(map!.getPitch() - targetPitch(mode, look)) > 0.2 ||
          Math.abs(map!.getZoom() - wantZoom) > 0.01;
        const busy =
          character.speed > 0.01 ||
          Math.hypot(look.x, look.y) > 0.02 ||
          settling;
        if (busy) three.requestRedraw();
      });

      layer.ready = loadColin(modelUrl)
        .then((model) => {
          character = new Character(model);
          three.scene.add(model.root);
          three.requestRedraw();
        })
        .catch((err) => {
          console.error('character failed to load:', err);
        });
    },

    detach(m: maplibregl.Map) {
      if (m.getLayer(three.id)) m.removeLayer(three.id);
      map = null;
    },

    getCharacter: () => character,

    /**
     * Left-thumb movement, already in world metres per the camera.
     *
     * This goes THROUGH the layer rather than being poked onto the character
     * directly, because the render loop parks itself when nothing is moving —
     * so something has to wake it. Setting `character.input` from outside left
     * the input sitting there with no frame ever running to act on it, and the
     * character simply never moved.
     */
    setMove(east: number, south: number) {
      if (!character) return;
      character.input = { east, south };
      three.requestRedraw();
    },

    /** Right-thumb camera input, -1..1 each. */
    setLook(x: number, y: number) {
      look.x = x;
      look.y = y;
      if (Math.hypot(x, y) > 0.02) lastLookAt = performance.now();
      // Wake on release too, or the camera never settles back.
      three.requestRedraw();
    },
    /** Rendered frames per second, or 0 when idle (which costs nothing). */
    getFps() {
      if (!frameTimes.length) return 0;
      const mean = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      return mean > 0 ? Math.round(1 / mean) : 0;
    },
    getMode: () => mode,
    setMode(next: CharacterMode) {
      // Just change the target. The follower below drives pitch and zoom every
      // frame, so kicking off an easeTo here would be immediately overwritten
      // by the next frame's jumpTo — which is exactly what stopped street view
      // from ever tilting.
      mode = next;
    },
    setFollowing(f: boolean) {
      following = f;
    },
  };

  return layer;
}

/**
 * Where the camera wants to be pitched, given the mode and the right thumb.
 * Pulling the stick down tips toward the horizon and up looks down on him,
 * which is the way every third-person camera works.
 */
export function targetPitch(mode: CharacterMode, look: { y: number }): number {
  const base = mode === 'street' ? CAMERA.streetPitch : CAMERA.overheadPitch;
  const range = mode === 'street' ? CAMERA.maxPitch - CAMERA.minPitch : 55;
  const wanted = base - look.y * range * 0.5;
  return Math.max(CAMERA.minPitch * (mode === 'street' ? 1 : 0), Math.min(CAMERA.maxPitch, wanted));
}

/**
 * Keep the camera on him.
 *
 * The follower owns the ENTIRE camera — centre, bearing, pitch and zoom — and
 * damps each toward its target. It cannot share the camera with an easeTo: a
 * per-frame jumpTo silently cancels an in-flight animation, so mode changes set
 * targets here rather than animating separately.
 *
 * The RIGHT THUMB owns the bearing while it is held. The camera only drifts
 * back behind him once the thumb has been off for a moment — a camera that
 * fights you back to centre while you are still looking is the single most
 * annoying thing a third-person camera can do.
 */
function followCharacter(
  map: maplibregl.Map,
  character: Character,
  frame: { toLngLat(east: number, south: number): LngLat },
  mode: CharacterMode,
  dt: number,
  look: { x: number; y: number },
  autoSwing: boolean,
) {
  const target = frame.toLngLat(character.east, character.south);
  const c = map.getCenter();
  const k = 1 - Math.exp(-dt / CAMERA.followTau);

  const lng = c.lng + (target.lng - c.lng) * k;
  const lat = c.lat + (target.lat - c.lat) * k;

  const wantZoom = mode === 'street' ? CAMERA.streetZoom : CAMERA.overheadZoom;
  const wantPitch = targetPitch(mode, look);
  const pitch = map.getPitch() + (wantPitch - map.getPitch()) * k;
  const zoom = map.getZoom() + (wantZoom - map.getZoom()) * k;

  let bearing = map.getBearing();
  if (Math.abs(look.x) > 0.02) {
    bearing += look.x * CAMERA.lookYawDegPerSec * dt;
  } else if (mode === 'street' && autoSwing) {
    // Drift round behind him at a finite rate rather than pinning the camera
    // to his heading, which turns every step into a lurch.
    const delta = ((((character.heading - bearing) % 360) + 540) % 360) - 180;
    bearing += Math.min(Math.abs(delta), CAMERA.swingDegPerSec * dt) * Math.sign(delta);
  }

  // Only actually move the camera when it would CHANGE. jumpTo fires its move
  // events and schedules a repaint even when every value is identical, so
  // calling it unconditionally each frame is a perpetual motion machine: the
  // render triggers the follower, the follower triggers the next render, and
  // the whole pitched city repaints forever while the character stands still.
  // Measured: 32 renders per 1.5s standing still before this, 0 after.
  const c0 = map.getCenter();
  const moved =
    Math.abs(lng - c0.lng) > 1e-8 ||
    Math.abs(lat - c0.lat) > 1e-8 ||
    Math.abs(bearing - map.getBearing()) > 0.01 ||
    Math.abs(pitch - map.getPitch()) > 0.01 ||
    Math.abs(zoom - map.getZoom()) > 1e-4;
  if (!moved) return;

  map.jumpTo({ center: [lng, lat], bearing, pitch, zoom });
}

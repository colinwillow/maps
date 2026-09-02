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
  /** In street mode the camera swings behind him at this rate, deg/sec. */
  swingDegPerSec: 90,
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

  const onMapClick = (e: maplibregl.MapMouseEvent) => {
    if (!character) return;
    const { east, south } = three.frame.toMeters(e.lngLat);
    character.waypoint = { east, south };
    three.requestRedraw();
  };

  const layer: MapFeatureLayer & {
    getCharacter(): Character | null;
    setMode(m: CharacterMode): void;
    getMode(): CharacterMode;
    setFollowing(f: boolean): void;
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
      m.on('click', onMapClick);

      three.setFrameCallback((dt) => {
        if (!character) return;
        character.update(dt);
        if (following && map) followCharacter(map, character, three.frame, mode, dt);
        // Keep frames coming while he moves OR while the camera is still
        // easing toward the mode's pitch/zoom, or a mode switch stalls part
        // way through with nothing to drive the next frame.
        const settling =
          Math.abs(map!.getPitch() - (mode === 'street' ? CAMERA.streetPitch : CAMERA.overheadPitch)) > 0.2 ||
          Math.abs(map!.getZoom() - (mode === 'street' ? CAMERA.streetZoom : CAMERA.overheadZoom)) > 0.01;
        if (character.speed > 0.01 || character.waypoint || settling) three.requestRedraw();
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
      m.off('click', onMapClick);
      if (m.getLayer(three.id)) m.removeLayer(three.id);
      map = null;
    },

    getCharacter: () => character,
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
 * Keep the camera on him.
 *
 * The follower owns the ENTIRE camera — centre, bearing, pitch and zoom — and
 * damps each toward the current mode's target. It cannot share the camera with
 * an easeTo: a per-frame jumpTo silently cancels an in-flight animation, so
 * mode changes set targets here rather than animating separately.
 *
 * Everything is damped, never snapped: a fast turn should not whip the view.
 */
function followCharacter(
  map: maplibregl.Map,
  character: Character,
  frame: { toLngLat(east: number, south: number): LngLat },
  mode: CharacterMode,
  dt: number,
) {
  const target = frame.toLngLat(character.east, character.south);
  const c = map.getCenter();
  const k = 1 - Math.exp(-dt / CAMERA.followTau);

  const lng = c.lng + (target.lng - c.lng) * k;
  const lat = c.lat + (target.lat - c.lat) * k;

  const wantPitch = mode === 'street' ? CAMERA.streetPitch : CAMERA.overheadPitch;
  const wantZoom = mode === 'street' ? CAMERA.streetZoom : CAMERA.overheadZoom;
  const pitch = map.getPitch() + (wantPitch - map.getPitch()) * k;
  const zoom = map.getZoom() + (wantZoom - map.getZoom()) * k;

  let bearing = map.getBearing();
  if (mode === 'street') {
    // Swing round behind him at a finite rate rather than pinning the camera
    // to his heading, which turns every step into a lurch.
    const delta = ((((character.heading - bearing) % 360) + 540) % 360) - 180;
    bearing += Math.min(Math.abs(delta), CAMERA.swingDegPerSec * dt) * Math.sign(delta);
  }

  map.jumpTo({ center: [lng, lat], bearing, pitch, zoom });
}

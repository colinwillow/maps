import * as THREE from 'three';
import type maplibregl from 'maplibre-gl';
import type { CustomLayerInterface } from 'maplibre-gl';
import { makeGeoFrame, type GeoFrame, type LngLat } from './geo';

/**
 * ONE renderer, ONE scene, for all 3D content on the map.
 *
 * MapLibre custom layers hand you the map's own GL context and a matrix each
 * frame. Rather than let Three drive a camera, we overwrite the camera's
 * projection matrix with MapLibre's, so the two are locked together by
 * construction and nothing can drift.
 *
 * Two rules that are not optional:
 * - `renderer.resetState()` every frame. MapLibre and Three both mutate GL
 *   state and Three assumes it owns it; without this you get missing draws and
 *   corrupted state that looks like a shader bug.
 * - `autoClear = false`, or Three wipes the map out from under itself.
 *
 * Anything added to `scene` is positioned in METRES relative to `frame`
 * (X east, Y up, Z south) — see geo.ts for why not mercator units.
 */
export class ThreeLayer {
  readonly id: string;
  readonly scene = new THREE.Scene();
  readonly frame: GeoFrame;
  readonly camera = new THREE.Camera();

  /** False while the globe is spherical and 3D content is therefore hidden. */
  visibleNow = false;

  private renderer: THREE.WebGLRenderer | null = null;
  private map: maplibregl.Map | null = null;
  private onFrame: ((dtSec: number) => void) | null = null;
  private lastFrameMs = 0;

  constructor(origin: LngLat, id = 'three-scene') {
    this.id = id;
    this.frame = makeGeoFrame(origin);

    // Light rig lives with the scene, not the content, so every model added
    // later is lit the same way.
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(60, 120, -40);
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0xf3ecdd, 0x6d6152, 2.0));
  }

  /** Called once per rendered frame with the elapsed time, for animation. */
  setFrameCallback(fn: (dtSec: number) => void) {
    this.onFrame = fn;
  }

  /** Ask MapLibre to draw again — needed while anything is animating. */
  requestRedraw() {
    this.map?.triggerRepaint();
  }

  asCustomLayer(): CustomLayerInterface {
    return {
      id: this.id,
      type: 'custom',
      renderingMode: '3d',

      onAdd: (map, gl) => {
        this.map = map;
        this.renderer = new THREE.WebGLRenderer({
          canvas: map.getCanvas(),
          context: gl,
          antialias: true,
        });
        this.renderer.autoClear = false;
        // The GLB arrives with sRGB textures; without this the character comes
        // out washed out against the paper basemap.
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      },

      onRemove: () => {
        this.renderer?.dispose();
        this.renderer = null;
        this.map = null;
      },

      render: (_gl, args) => {
        const renderer = this.renderer;
        if (!renderer) return;

        // Skip while the planet is actually a sphere. Under globe projection
        // MapLibre blends to mercator as you zoom in; `projectionTransition`
        // is 0 once that is complete and 1 out at world view. The matrices
        // below only describe the mercator plane, so drawing during the
        // globe half of that blend puts the model somewhere arbitrary —
        // measured hundreds of pixels off at z10, exact from z14 in.
        if (args.defaultProjectionData.projectionTransition > 0.01) {
          this.visibleNow = false;
          return;
        }
        this.visibleNow = true;

        const now = performance.now();
        const dt = this.lastFrameMs ? Math.min((now - this.lastFrameMs) / 1000, 0.1) : 0;
        this.lastFrameMs = now;
        this.onFrame?.(dt);

        const { origin, scale } = this.frame;

        // Three is Y-up; mercator is X east, Y SOUTH, Z up. Rotating +90 about
        // X sends three's (x, y, z) to (x, -z, y), and the negative Y scale
        // then flips the handedness so three's Z comes out as mercator south.
        const model = new THREE.Matrix4()
          .makeTranslation(origin.x, origin.y, origin.z)
          .scale(new THREE.Vector3(scale, -scale, scale))
          .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));

        // `defaultProjectionData.mainMatrix` takes NORMALISED mercator (0..1),
        // which is what the model matrix above produces and what keeps that
        // matrix independent of zoom. Do NOT use `modelViewProjectionMatrix`
        // here: it is also correct, but only for mercator scaled by worldSize
        // (512 * 2^zoom), so feeding it 0..1 coordinates misses by a factor of
        // ten million. Both were checked against rendered pixels; the old
        // Mapbox-era snippets that pass `matrix` correspond to this one.
        this.camera.projectionMatrix = new THREE.Matrix4()
          .fromArray(args.defaultProjectionData.mainMatrix as unknown as number[])
          .multiply(model);

        renderer.resetState();
        renderer.render(this.scene, this.camera);
      },
    };
  }
}

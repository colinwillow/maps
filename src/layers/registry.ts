import type maplibregl from 'maplibre-gl';
import type { MapFeatureLayer } from './types';

const FETCH_DEBOUNCE_MS = 250;

/**
 * Owns the set of MapFeatureLayers and their lifecycle against one map.
 *
 * Ordering is registration order: layers registered later attach later, so
 * their MapLibre layers render on top. Register the quiet stuff first.
 *
 * The registry is also the only thing that watches map movement: it debounces
 * moveend and dispatches viewport-scoped `fetch(bounds, zoom)` to each active
 * layer, so no layer ever installs its own move listener for data loading.
 */
export class LayerRegistry {
  private layers: MapFeatureLayer[] = [];
  private map: maplibregl.Map | null = null;
  private fetchTimer: ReturnType<typeof setTimeout> | null = null;
  private onMoveEnd = () => this.scheduleFetch();

  register(layer: MapFeatureLayer): void {
    if (this.layers.some((l) => l.id === layer.id)) {
      throw new Error(`layer '${layer.id}' is already registered`);
    }
    this.layers.push(layer);
    if (this.map) {
      layer.attach(this.map);
      this.dispatchFetch([layer]);
    }
  }

  /** Registered layers, in render order (bottom first). */
  getActive(): readonly MapFeatureLayer[] {
    return this.layers;
  }

  /** Attach all layers to the map and start viewport-driven fetching. */
  bind(map: maplibregl.Map): void {
    if (this.map) throw new Error('registry is already bound to a map');
    this.map = map;
    for (const layer of this.layers) layer.attach(map);
    map.on('moveend', this.onMoveEnd);
    this.dispatchFetch(this.layers);
  }

  /** Detach everything. Safe to call with the map already gone (page teardown). */
  unbind(): void {
    if (!this.map) return;
    if (this.fetchTimer !== null) clearTimeout(this.fetchTimer);
    this.fetchTimer = null;
    this.map.off('moveend', this.onMoveEnd);
    for (const layer of [...this.layers].reverse()) layer.detach(this.map);
    this.map = null;
  }

  private scheduleFetch(): void {
    if (this.fetchTimer !== null) clearTimeout(this.fetchTimer);
    this.fetchTimer = setTimeout(() => {
      this.fetchTimer = null;
      this.dispatchFetch(this.layers);
    }, FETCH_DEBOUNCE_MS);
  }

  private dispatchFetch(layers: readonly MapFeatureLayer[]): void {
    const map = this.map;
    if (!map) return;
    const bounds = map.getBounds();
    const zoom = map.getZoom();
    for (const layer of layers) {
      if (!layer.fetch) continue;
      if (layer.minZoom !== undefined && zoom < layer.minZoom) continue;
      layer.fetch(bounds, zoom).catch((err) => {
        console.error(`layer '${layer.id}' fetch failed:`, err);
      });
    }
  }
}

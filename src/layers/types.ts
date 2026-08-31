import type maplibregl from 'maplibre-gl';
import type { LngLatBounds, MapGeoJSONFeature } from 'maplibre-gl';

/**
 * The extension seam. Every feature of this platform — basemap, buildings,
 * routes, and eventually every pin type — is a module exporting one of these.
 *
 * Rules that keep future branches cheap:
 * - A layer never reaches outside itself. No layer imports another layer;
 *   coordination goes through the registry or a shared store.
 * - Viewport-scoped fetching, always. `fetch` receives the current bounds and
 *   zoom; never load a full dataset, even a twelve-row one.
 * - Style config lives in data, not code: a pin's color/icon/model comes from
 *   its type record, not a switch statement in the layer.
 */
export interface MapFeatureLayer {
  id: string;

  /** Create the MapLibre sources/layers this module owns. */
  attach(map: maplibregl.Map): void;

  /** Remove everything attach() created. */
  detach(map: maplibregl.Map): void;

  /**
   * Fetch data for the current viewport. The registry calls this on moveend,
   * debounced, and once on bind. Not called while the zoom is below minZoom.
   */
  fetch?(bounds: LngLatBounds, zoom: number): Promise<void>;

  /** What happens when a feature this layer owns is clicked. */
  onSelect?(feature: MapGeoJSONFeature): void;

  /** Below this zoom the layer is dormant: no fetches are dispatched. */
  minZoom?: number;
}

import type maplibregl from 'maplibre-gl';
import type { MapFeatureLayer } from '../types';
import { FALLBACK_STYLE } from './fallbackStyle';
import { buildStyle } from './style';
import { PROJECTION } from './tokens';

/**
 * The basemap module owns the map style — the one MapLibre concept that is not
 * an added layer but the document everything else attaches on top of.
 *
 * With a MapTiler key it serves our own cartography (style.ts, "field guide
 * Portland"). Without one it falls back to a tiny offline sketch so dev and
 * tests never depend on the network.
 */
export function basemapLayer(maptilerKey: string | undefined): MapFeatureLayer {
  // Projection is a style property, so re-assert it each time a style finishes
  // loading rather than once at construction.
  const pinProjection = (e: { target: maplibregl.Map }) =>
    e.target.setProjection({ type: PROJECTION });

  return {
    id: 'basemap',
    attach(map: maplibregl.Map) {
      map.on('style.load', pinProjection);
      map.setStyle(maptilerKey ? buildStyle(maptilerKey) : FALLBACK_STYLE);
    },
    detach(map: maplibregl.Map) {
      // The style itself is the map's document; just stop watching it.
      map.off('style.load', pinProjection);
    },
  };
}

export const usingFallbackStyle = (maptilerKey: string | undefined) => !maptilerKey;

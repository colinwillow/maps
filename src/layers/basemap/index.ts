import type maplibregl from 'maplibre-gl';
import type { MapFeatureLayer } from '../types';
import { FALLBACK_STYLE } from './fallbackStyle';

/**
 * The basemap module owns the map style — the one MapLibre concept that isn't
 * an added layer but the document everything else attaches on top of.
 *
 * Phase 0 points at a stock MapTiler style; Phase 1 replaces that URL with our
 * own style JSON and nothing outside this module changes.
 */

const maptilerStyleUrl = (key: string) =>
  `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(key)}`;

export function basemapLayer(maptilerKey: string | undefined): MapFeatureLayer {
  // Mercator, pinned: globe projection complicates the custom-layer matrix
  // math later (Phase 5) and buys this project nothing. Projection is a style
  // property, so re-pin it each time a style finishes loading, over whatever
  // the style says.
  const pinMercator = (e: { target: maplibregl.Map }) =>
    e.target.setProjection({ type: 'mercator' });

  return {
    id: 'basemap',
    attach(map: maplibregl.Map) {
      map.on('style.load', pinMercator);
      map.setStyle(maptilerKey ? maptilerStyleUrl(maptilerKey) : FALLBACK_STYLE);
    },
    detach(map: maplibregl.Map) {
      // The style itself is the map's document; just stop watching it.
      map.off('style.load', pinMercator);
    },
  };
}

export const usingFallbackStyle = (maptilerKey: string | undefined) => !maptilerKey;

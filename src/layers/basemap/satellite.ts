import type maplibregl from 'maplibre-gl';
import { LAND_FILL_LAYERS } from './style';

/**
 * Switch the illustrated ground for real aerial imagery.
 *
 * The roads, buildings and labels stay on top, which is the useful hybrid:
 * you get photographic ground texture without losing the cartography that
 * makes the map legible.
 *
 * The land fills have to come off when imagery goes on, or they simply paint
 * over the photograph they are standing in for.
 */
export function setSatellite(map: maplibregl.Map, on: boolean) {
  if (!map.getLayer('satellite')) return false;
  map.setLayoutProperty('satellite', 'visibility', on ? 'visible' : 'none');
  for (const id of LAND_FILL_LAYERS) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, 'visibility', on ? 'none' : 'visible');
    }
  }
  return true;
}

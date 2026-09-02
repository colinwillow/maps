import type maplibregl from 'maplibre-gl';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import type { MapFeatureLayer } from '../types';
import { WORLD, findPlace, pathTo, bboxPolygon, type Place } from './places';

/**
 * Click your way down: continent, country, region, city.
 *
 * The interaction is deliberately two-stage, as asked for. First tap SELECTS —
 * the area lights up and the name comes forward, without moving the camera.
 * Second tap on the same place ENTERS it: fly to its bounds and reveal its
 * children. A single tap that both highlights and flies gives you no chance to
 * look before you leap, and no way to point at something without committing.
 */

export const PLACE_STYLE = {
  dot: '#F6F2E9',
  dotEdge: '#2A3346',
  dotSelected: '#E8A87C',
  fill: '#E8A87C',
  fillOpacity: 0.16,
  line: '#E8A87C',
  label: '#F6F2E9',
  labelHalo: '#131A2C',
} as const;

/**
 * Place navigation is a world-scale interaction, so it stops at city zoom.
 * Otherwise its dots keep claiming taps that are meant for the character's
 * walk-here waypoint, and clutter the street view besides.
 */
export const PLACE_MAXZOOM = 12;

/** Half-width of the tap target around a place dot, in screen pixels. */
export const TAP_TOLERANCE_PX = 14;

const SRC = 'places';
const HILITE = 'place-highlight';

export type PlacesState = {
  /** Whose children are on screen. null = the whole world. */
  parentId: string | null;
  /** Highlighted but not yet entered. */
  selectedId: string | null;
};

export function childrenOf(parentId: string | null): Place[] {
  if (!parentId) return WORLD;
  return findPlace(parentId)?.children ?? [];
}

/** Zoom that fits a bbox in a viewport, the same maths MapLibre's fitBounds uses. */
export function zoomForBounds(
  bbox: [number, number, number, number],
  width: number,
  height: number,
  padding = 60,
): number {
  const [w, s, e, n] = bbox;
  const latRad = (deg: number) => (deg * Math.PI) / 180;
  const mercY = (lat: number) =>
    Math.log(Math.tan(Math.PI / 4 + latRad(Math.max(-85, Math.min(85, lat))) / 2)) / (2 * Math.PI) + 0.5;

  const xFrac = Math.abs(e - w) / 360;
  const yFrac = Math.abs(mercY(n) - mercY(s));
  if (xFrac <= 0 || yFrac <= 0) return 10;

  const usableW = Math.max(1, width - padding * 2);
  const usableH = Math.max(1, height - padding * 2);
  // MapLibre's world is 512px at zoom 0.
  const zx = Math.log2(usableW / (512 * xFrac));
  const zy = Math.log2(usableH / (512 * yFrac));
  return Math.max(0, Math.min(18, Math.min(zx, zy)));
}

export function placesLayer(opts: {
  onChange?: (state: PlacesState & { path: Place[] }) => void;
}) {
  let map: maplibregl.Map | null = null;
  const state: PlacesState = { parentId: null, selectedId: null };

  const emit = () => {
    const path = state.parentId ? (pathTo(state.parentId) ?? []) : [];
    opts.onChange?.({ ...state, path });
  };

  const pointsFor = (parentId: string | null) => ({
    type: 'FeatureCollection' as const,
    features: childrenOf(parentId).map((place) => ({
      type: 'Feature' as const,
      id: place.id,
      properties: { id: place.id, name: place.name, level: place.level },
      geometry: { type: 'Point' as const, coordinates: place.center },
    })),
  });

  const refresh = () => {
    if (!map) return;
    (map.getSource(SRC) as maplibregl.GeoJSONSource | undefined)?.setData(pointsFor(state.parentId));
    const selected = state.selectedId ? findPlace(state.selectedId) : null;
    if (map.getLayer('place-dot')) {
      map.setPaintProperty(
        'place-dot',
        'circle-color',
        state.selectedId
          ? ['case', ['==', ['get', 'id'], state.selectedId], PLACE_STYLE.dotSelected, PLACE_STYLE.dot]
          : PLACE_STYLE.dot,
      );
      map.setPaintProperty(
        'place-dot',
        'circle-radius',
        state.selectedId
          ? ['case', ['==', ['get', 'id'], state.selectedId], 9, 6]
          : ['interpolate', ['linear'], ['zoom'], 0, 5, 6, 7],
      );
    }
    (map.getSource(HILITE) as maplibregl.GeoJSONSource | undefined)?.setData(
      selected
        ? { type: 'FeatureCollection', features: [bboxPolygon(selected.bbox)] }
        : { type: 'FeatureCollection', features: [] },
    );
    emit();
  };

  /** Fly into a place: its bounds fill the view, and its children appear. */
  const enter = (place: Place) => {
    if (!map) return;
    const canvas = map.getCanvas();
    const zoom = zoomForBounds(place.bbox, canvas.clientWidth, canvas.clientHeight);
    state.parentId = place.children?.length ? place.id : state.parentId;
    state.selectedId = null;
    map.flyTo({ center: place.center, zoom, duration: 2200, essential: true });
    refresh();
  };

  const onClick = (e: maplibregl.MapMouseEvent) => {
    if (!map) return;
    // A thumb is not a pixel. Query a box around the tap rather than the
    // exact point, or a 6px dot is essentially unhittable on a phone.
    const t = TAP_TOLERANCE_PX;
    const box: [[number, number], [number, number]] = [
      [e.point.x - t, e.point.y - t],
      [e.point.x + t, e.point.y + t],
    ];
    const hits = map.queryRenderedFeatures(box, { layers: ['place-dot', 'place-label'] });
    if (!hits.length) return;
    layer.onSelect?.(hits[0]);
  };

  const layer: MapFeatureLayer & {
    up(): void;
    reset(): void;
    getState(): PlacesState;
  } = {
    id: 'places',

    /**
     * Safe to call again after every style change, and it has to be: setStyle
     * replaces the whole document, so everything added here is destroyed when
     * the basemap swaps its style. Attaching once left the map with no place
     * layers at all and clicks that silently hit nothing.
     */
    attach(m: maplibregl.Map) {
      map = m;
      if (!m.getSource(SRC)) {
        m.addSource(SRC, { type: 'geojson', data: pointsFor(state.parentId) });
      }
      if (!m.getSource(HILITE)) {
        m.addSource(HILITE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      }
      // Re-registering would stack duplicate handlers on every style load.
      m.off('click', onClick);

      if (!m.getLayer('place-highlight-fill')) m.addLayer({
        id: 'place-highlight-fill',
        maxzoom: PLACE_MAXZOOM,
        type: 'fill',
        source: HILITE,
        paint: { 'fill-color': PLACE_STYLE.fill, 'fill-opacity': PLACE_STYLE.fillOpacity },
      });
      if (!m.getLayer('place-highlight-line')) m.addLayer({
        id: 'place-highlight-line',
        maxzoom: PLACE_MAXZOOM,
        type: 'line',
        source: HILITE,
        paint: { 'line-color': PLACE_STYLE.line, 'line-width': 1.6, 'line-opacity': 0.85 },
      });
      if (!m.getLayer('place-dot')) m.addLayer({
        id: 'place-dot',
        maxzoom: PLACE_MAXZOOM,
        type: 'circle',
        source: SRC,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 5, 6, 7],
          // Recoloured in refresh() when the selection changes; a static
          // expression cannot see state that lives outside the style.
          'circle-color': PLACE_STYLE.dot,
          'circle-stroke-color': PLACE_STYLE.dotEdge,
          'circle-stroke-width': 1.5,
        },
      });
      if (!m.getLayer('place-label')) m.addLayer({
        id: 'place-label',
        maxzoom: PLACE_MAXZOOM,
        type: 'symbol',
        source: SRC,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Bold', 'Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 0, 12, 6, 15],
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': PLACE_STYLE.label,
          'text-halo-color': PLACE_STYLE.labelHalo,
          'text-halo-width': 1.4,
        },
      });

      m.on('click', onClick);
      refresh();
    },

    detach(m: maplibregl.Map) {
      m.off('click', onClick);
      for (const id of ['place-label', 'place-dot', 'place-highlight-line', 'place-highlight-fill']) {
        if (m.getLayer(id)) m.removeLayer(id);
      }
      for (const id of [SRC, HILITE]) if (m.getSource(id)) m.removeSource(id);
      map = null;
    },

    /** First tap highlights, second tap on the same place goes in. */
    onSelect(feature: MapGeoJSONFeature) {
      const id = feature.properties?.id as string | undefined;
      if (!id) return;
      const place = findPlace(id);
      if (!place) return;
      if (state.selectedId === id) enter(place);
      else {
        state.selectedId = id;
        refresh();
      }
    },

    /** Back up one level. */
    up() {
      if (!state.parentId) return;
      const trail = pathTo(state.parentId) ?? [];
      const parent = trail.length >= 2 ? trail[trail.length - 2] : null;
      state.parentId = parent ? parent.id : null;
      state.selectedId = null;
      if (map) {
        const canvas = map.getCanvas();
        if (parent) {
          map.flyTo({
            center: parent.center,
            zoom: zoomForBounds(parent.bbox, canvas.clientWidth, canvas.clientHeight),
            duration: 1800,
          });
        } else {
          map.flyTo({ center: [0, 20], zoom: 1.3, duration: 2000 });
        }
      }
      refresh();
    },

    reset() {
      state.parentId = null;
      state.selectedId = null;
      refresh();
    },

    getState: () => ({ ...state }),
  };

  return layer;
}

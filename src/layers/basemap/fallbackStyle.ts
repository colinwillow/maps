import type { StyleSpecification } from 'maplibre-gl';

/**
 * Offline dev/test style: a hand-sketched Willamette and a few bridges so
 * pan/zoom is visible without any tile server. This is what boots when
 * VITE_MAPTILER_KEY is missing (and what the smoke test runs against, so the
 * test never depends on the network). It is not cartography — Phase 1 is.
 *
 * Coordinates are eyeballed, not surveyed; they only need to read as
 * "the river through downtown Portland".
 */

const river = {
  type: 'Feature' as const,
  properties: {},
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [-122.6695, 45.468],
        [-122.6655, 45.478],
        [-122.665, 45.489],
        [-122.6665, 45.5],
        [-122.669, 45.508],
        [-122.6715, 45.515],
        [-122.6735, 45.5225],
        [-122.6745, 45.5285],
        [-122.6725, 45.5365],
        [-122.667, 45.5445],
        [-122.66, 45.551],
        [-122.65, 45.5575],
        [-122.6535, 45.5615],
        [-122.665, 45.5555],
        [-122.6725, 45.549],
        [-122.6785, 45.541],
        [-122.6805, 45.5325],
        [-122.6795, 45.5245],
        [-122.6765, 45.5165],
        [-122.6735, 45.5085],
        [-122.671, 45.4985],
        [-122.6695, 45.488],
        [-122.6705, 45.4775],
        [-122.674, 45.4685],
        [-122.6695, 45.468],
      ],
    ],
  },
};

const bridgeAt = (lat: number) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: {
    type: 'LineString' as const,
    coordinates: [
      [-122.6835, lat],
      [-122.6595, lat],
    ],
  },
});

// Roughly: Marquam, Hawthorne, Morrison, Burnside, Steel, Broadway, Fremont.
const bridges = [45.5055, 45.5135, 45.5175, 45.523, 45.5285, 45.5345, 45.538].map(bridgeAt);

export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  name: 'offline-fallback',
  sources: {
    sketch: {
      type: 'geojson',
      attribution: '© OpenStreetMap contributors',
      data: { type: 'FeatureCollection', features: [river, ...bridges] },
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#e8e4da' } },
    {
      id: 'river',
      type: 'fill',
      source: 'sketch',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#9fc4cf' },
    },
    {
      id: 'bridges',
      type: 'line',
      source: 'sketch',
      filter: ['==', ['geometry-type'], 'LineString'],
      paint: { 'line-color': '#6b6156', 'line-width': 2 },
    },
  ],
};

import { useState, useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import { MapView } from './map/MapView';
import { usingFallbackStyle } from './layers/basemap';
import { LaunchScene } from './launch/LaunchScene';

const MAPTILER_KEY: string | undefined =
  import.meta.env.VITE_MAPTILER_KEY || undefined;

export function App() {
  // The scene draws over the map, so it lives outside MapView and picks the
  // instance up once it exists.
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      if (window.__map) {
        setMap(window.__map);
        clearInterval(t);
      }
    }, 50);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="app">
      <MapView />
      <LaunchScene map={map} />
      {usingFallbackStyle(MAPTILER_KEY) && (
        <div className="fallback-notice">
          No VITE_MAPTILER_KEY set — running on the offline fallback style.
          Copy .env.example to .env and add a key from maptiler.com.
        </div>
      )}
    </div>
  );
}

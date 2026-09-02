import { useEffect, useRef, useState, type ReactNode } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapContext } from './MapContext';
import { LayerRegistry } from '../layers/registry';
import { basemapLayer } from '../layers/basemap';
import { useGlobeSpin } from '../launch/useGlobeSpin';
import { LAUNCH } from '../launch/config';

export const PORTLAND = { lng: -122.6784, lat: 45.5152 };

const MAPTILER_KEY: string | undefined =
  import.meta.env.VITE_MAPTILER_KEY || undefined;

declare global {
  interface Window {
    /** Test hook: the live map, for the headless smoke test. */
    __map?: maplibregl.Map;
    __mapReady?: boolean;
    /** Test hook: suppress the cloud deck so the globe's face is bare. */
    __noClouds?: boolean;
  }
}

export function MapView({ children }: { children?: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      center: PORTLAND,
      // Opens on the globe, not on the city: the launch scene is the front
      // door. LaunchScene's "Explore Portland" flies down to LAUNCH.cityZoom.
      zoom: LAUNCH.zoom,
      attributionControl: { compact: false },
      // Past MapLibre's default 22 so the third-person camera can get close
      // enough for the character to have presence. Vector tiles overzoom
      // cleanly — the geometry stays sharp, it is only the data that runs out.
      maxZoom: 24,
      // No style here — the basemap layer module owns it.
      style: { version: 8, sources: {}, layers: [] },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));

    const registry = new LayerRegistry();
    registry.register(basemapLayer(MAPTILER_KEY));
    registry.bind(map);

    map.on('load', () => {
      window.__mapReady = true;
    });
    window.__map = map;
    setMap(map);

    return () => {
      window.__map = undefined;
      window.__mapReady = false;
      setMap(null);
      registry.unbind();
      map.remove();
    };
  }, []);

  useGlobeSpin(map);

  return (
    <div ref={containerRef} className="map-container">
      <MapContext.Provider value={map}>{children}</MapContext.Provider>
    </div>
  );
}

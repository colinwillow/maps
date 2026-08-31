import { MapView } from './map/MapView';
import { usingFallbackStyle } from './layers/basemap';

const MAPTILER_KEY: string | undefined =
  import.meta.env.VITE_MAPTILER_KEY || undefined;

export function App() {
  return (
    <div className="app">
      <MapView />
      <div className="badge">maps</div>
      {usingFallbackStyle(MAPTILER_KEY) && (
        <div className="fallback-notice">
          No VITE_MAPTILER_KEY set — running on the offline fallback style.
          Copy .env.example to .env and add a key from maptiler.com.
        </div>
      )}
    </div>
  );
}

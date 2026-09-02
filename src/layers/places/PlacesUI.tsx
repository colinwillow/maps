import { useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { placesLayer } from './index';
import { stopGlobeSpin } from '../../launch/config';
import type { Place } from './places';

/**
 * The breadcrumb and the way back out.
 *
 * The trail is the only thing on screen that says where you are once you have
 * clicked past the world view, so it stays put rather than fading with the
 * launch scene.
 */
export function PlacesUI({ map }: { map: maplibregl.Map | null }) {
  const [path, setPath] = useState<Place[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const layerRef = useRef<ReturnType<typeof placesLayer> | null>(null);

  useEffect(() => {
    if (!map) return;
    const layer = placesLayer({
      onChange: (s) => {
        setPath(s.path);
        setSelected(s.selectedId);
        // Picking somewhere means you are looking at it, not watching it turn.
        if (s.selectedId || s.parentId) stopGlobeSpin();
      },
    });
    layerRef.current = layer;
    // Re-attach whenever the style settles, not just on 'style.load'.
    // setStyle destroys every source and layer, and when it is called while a
    // previous style is still loading MapLibre rebuilds from scratch — which
    // also throws away anything added in the gap. 'styledata' fires after each
    // of those settles; attach() is idempotent, so re-running it is free and
    // is the only thing that reliably survives a rebuild.
    // Do NOT gate this on isStyleLoaded(): it reports false even after the map
    // has finished loading and is drawing happily, so guarding on it meant the
    // place layers were never added at all. attach() is idempotent and safe to
    // call mid-load; if the style is momentarily unusable it throws, and the
    // next 'styledata' retries.
    const attach = () => {
      try {
        layer.attach(map);
      } catch {
        /* style is mid-rebuild; the next styledata will re-run this */
      }
    };
    map.on('styledata', attach);
    attach();
    return () => {
      map.off('styledata', attach);
      layer.detach(map);
      layerRef.current = null;
    };
  }, [map]);

  if (!path.length && !selected) {
    return <p className="places-hint">Tap a place to look, tap again to go there</p>;
  }

  return (
    <div className="places-bar">
      <button className="places-back" onClick={() => layerRef.current?.up()}>
        ←
      </button>
      <span className="places-trail">
        <button className="places-crumb" onClick={() => layerRef.current?.reset()}>
          World
        </button>
        {path.map((place) => (
          <span key={place.id}>
            <span className="places-sep">›</span>
            <span className="places-crumb current">{place.name}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

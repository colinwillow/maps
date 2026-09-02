import { useCallback, useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { characterLayer, type CharacterMode } from './index';
import { Stick } from './Stick';
import { PORTLAND } from '../../map/MapView';
import { stopGlobeSpin } from '../../launch/config';

const MODEL_URL = `${import.meta.env.BASE_URL}models/colin_slim.glb`;

/**
 * Turns the character on, and gives him controls.
 *
 * He is deliberately opt-in: a 5MB model has no business downloading for
 * someone who just wants to look at a map, so nothing loads until the button
 * is pressed.
 */
export function CharacterUI({ map }: { map: maplibregl.Map | null }) {
  const [on, setOn] = useState(false);
  const [mode, setMode] = useState<CharacterMode>('overhead');
  const [loading, setLoading] = useState(false);
  const layerRef = useRef<ReturnType<typeof characterLayer> | null>(null);

  useEffect(() => {
    if (!map || !on) return;
    stopGlobeSpin();
    const layer = characterLayer(PORTLAND, MODEL_URL);
    layerRef.current = layer;
    setLoading(true);
    layer.attach(map);
    layer.ready.then(() => {
      setLoading(false);
      layer.setMode('overhead');
    });
    return () => {
      layer.detach(map);
      layerRef.current = null;
    };
  }, [map, on]);

  const drive = useCallback((east: number, south: number) => {
    const c = layerRef.current?.getCharacter();
    if (c) c.input = { east, south };
  }, []);

  const toggleMode = () => {
    const next: CharacterMode = mode === 'overhead' ? 'street' : 'overhead';
    setMode(next);
    layerRef.current?.setMode(next);
  };

  if (!on) {
    return (
      <button className="char-enter" onClick={() => setOn(true)}>
        Walk around
      </button>
    );
  }

  return (
    <>
      <div className="char-hud">
        <button className="char-btn" onClick={toggleMode}>
          {mode === 'overhead' ? 'Street view' : 'Overhead'}
        </button>
        <button className="char-btn" onClick={() => setOn(false)}>
          Exit
        </button>
        {loading && <span className="char-loading">loading Colin…</span>}
      </div>
      <p className="char-hint">Tap the map to send him there, or use the stick</p>
      <Stick onChange={drive} />
    </>
  );
}

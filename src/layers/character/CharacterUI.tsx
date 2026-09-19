import { useCallback, useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { characterLayer, type CharacterMode } from './index';
import { Stick } from './Stick';
import { stickToWorld } from './input';
import { setSatellite } from '../basemap/satellite';
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
  const [satellite, setSat] = useState(false);
  const [fps, setFps] = useState(0);
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
      // Test hook: drive him without synthesising touches, so the smoke test
      // can measure the frame budget rather than the input layer.
      window.__charMove = (east: number, south: number) => layer.setMove(east, south);
      window.__charRoads = (roads) => {
        if (roads) layer.setRoads(roads as Parameters<typeof layer.setRoads>[0]);
        return layer.getPropCount();
      };
    });
    return () => {
      window.__charMove = undefined;
      window.__charRoads = undefined;
      layer.detach(map);
      layerRef.current = null;
    };
  }, [map, on]);

  // The stick reports SCREEN offsets; the world direction depends on where
  // the camera is looking, or "up" means north instead of "away from me".
  const drive = useCallback(
    (dx: number, dy: number) => {
      const v = stickToWorld(dx, dy, map?.getBearing() ?? 0);
      layerRef.current?.setMove(v.east, v.south);
    },
    [map],
  );

  // Right thumb looks. Raw screen offsets — the camera owns what they mean.
  const lookAround = useCallback((dx: number, dy: number) => {
    layerRef.current?.setLook(dx, dy);
  }, []);

  // A frame counter, which the brief asks for from Phase 4 on. It reads 0 when
  // nothing is moving, and that is correct rather than broken: the map only
  // repaints while something changes, so standing still costs no frames at all.
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setFps(layerRef.current?.getFps() ?? 0), 400);
    return () => clearInterval(t);
  }, [on]);

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
        <button
          className="char-btn"
          onClick={() => {
            if (!map) return;
            const next = !satellite;
            if (setSatellite(map, next)) setSat(next);
          }}
        >
          {satellite ? 'Illustrated' : 'Satellite'}
        </button>
        <button className="char-btn" onClick={toggleMode}>
          {mode === 'overhead' ? 'Street view' : 'Overhead'}
        </button>
        <button className="char-btn" onClick={() => setOn(false)}>
          Exit
        </button>
        {loading && <span className="char-loading">loading Colin…</span>}
      </div>
      <p className="char-hint">Left thumb walks · right thumb looks</p>
      <span className="char-fps">{fps > 0 ? `${fps} fps` : 'idle'}</span>
      <Stick onChange={drive} side="left" />
      <Stick onChange={lookAround} side="right" />
    </>
  );
}

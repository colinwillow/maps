import { createContext, useContext } from 'react';
import type maplibregl from 'maplibre-gl';

export const MapContext = createContext<maplibregl.Map | null>(null);

/** The live map instance, or null until MapView has created it. */
export const useMap = () => useContext(MapContext);

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type maplibregl from 'maplibre-gl';
import { LayerRegistry } from '../src/layers/registry';
import type { MapFeatureLayer } from '../src/layers/types';

// A fake map: just the surface the registry touches. Bounds/zoom are plain
// values — the registry passes them through without interpreting them.
function fakeMap(zoom = 12) {
  const handlers = new Map<string, Set<() => void>>();
  return {
    zoom,
    bounds: { fake: true },
    on(ev: string, fn: () => void) {
      if (!handlers.has(ev)) handlers.set(ev, new Set());
      handlers.get(ev)!.add(fn);
    },
    off(ev: string, fn: () => void) {
      handlers.get(ev)?.delete(fn);
    },
    emit(ev: string) {
      for (const fn of handlers.get(ev) ?? []) fn();
    },
    listenerCount(ev: string) {
      return handlers.get(ev)?.size ?? 0;
    },
    getBounds() {
      return this.bounds;
    },
    getZoom() {
      return this.zoom;
    },
  };
}
const asMap = (m: ReturnType<typeof fakeMap>) => m as unknown as maplibregl.Map;

function stubLayer(id: string, extra: Partial<MapFeatureLayer> = {}) {
  return {
    id,
    attach: vi.fn(),
    detach: vi.fn(),
    ...extra,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('LayerRegistry', () => {
  it('rejects duplicate ids', () => {
    const r = new LayerRegistry();
    r.register(stubLayer('a'));
    expect(() => r.register(stubLayer('a'))).toThrow(/already registered/);
  });

  it('attaches in registration order on bind, detaches in reverse on unbind', () => {
    const r = new LayerRegistry();
    const order: string[] = [];
    const a = stubLayer('a', { attach: vi.fn(() => order.push('attach a')), detach: vi.fn(() => order.push('detach a')) });
    const b = stubLayer('b', { attach: vi.fn(() => order.push('attach b')), detach: vi.fn(() => order.push('detach b')) });
    r.register(a);
    r.register(b);
    const m = fakeMap();
    r.bind(asMap(m));
    r.unbind();
    expect(order).toEqual(['attach a', 'attach b', 'detach b', 'detach a']);
    expect(m.listenerCount('moveend')).toBe(0);
  });

  it('attaches and fetches immediately when registered after bind', () => {
    const r = new LayerRegistry();
    r.bind(asMap(fakeMap()));
    const fetch = vi.fn().mockResolvedValue(undefined);
    const late = stubLayer('late', { fetch });
    r.register(late);
    expect(late.attach).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fetches once on bind with current bounds and zoom', () => {
    const r = new LayerRegistry();
    const fetch = vi.fn().mockResolvedValue(undefined);
    r.register(stubLayer('a', { fetch }));
    const m = fakeMap(13);
    r.bind(asMap(m));
    expect(fetch).toHaveBeenCalledWith(m.bounds, 13);
  });

  it('debounces a burst of moveend into one fetch', () => {
    const r = new LayerRegistry();
    const fetch = vi.fn().mockResolvedValue(undefined);
    r.register(stubLayer('a', { fetch }));
    const m = fakeMap();
    r.bind(asMap(m));
    fetch.mockClear();
    m.emit('moveend');
    m.emit('moveend');
    m.emit('moveend');
    expect(fetch).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not fetch below minZoom, does at or above it', () => {
    const r = new LayerRegistry();
    const fetch = vi.fn().mockResolvedValue(undefined);
    r.register(stubLayer('a', { fetch, minZoom: 14 }));
    const m = fakeMap(12);
    r.bind(asMap(m));
    expect(fetch).not.toHaveBeenCalled();
    m.zoom = 14;
    m.emit('moveend');
    vi.runAllTimers();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a pending debounced fetch dies with unbind', () => {
    const r = new LayerRegistry();
    const fetch = vi.fn().mockResolvedValue(undefined);
    r.register(stubLayer('a', { fetch }));
    const m = fakeMap();
    r.bind(asMap(m));
    fetch.mockClear();
    m.emit('moveend');
    r.unbind();
    vi.runAllTimers();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('one layer failing to fetch does not starve the others', async () => {
    const r = new LayerRegistry();
    const bad = vi.fn().mockRejectedValue(new Error('boom'));
    const good = vi.fn().mockResolvedValue(undefined);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    r.register(stubLayer('bad', { fetch: bad }));
    r.register(stubLayer('good', { fetch: good }));
    r.bind(asMap(fakeMap()));
    expect(good).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('binding twice is an error; unbind before bind is a no-op', () => {
    const r = new LayerRegistry();
    r.unbind();
    r.bind(asMap(fakeMap()));
    expect(() => r.bind(asMap(fakeMap()))).toThrow(/already bound/);
  });
});

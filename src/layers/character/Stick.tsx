import { useEffect, useRef } from 'react';

/**
 * A floating-origin thumb stick, the idea ported from Peggy/Robits.
 *
 * The stick RE-CENTRES wherever the thumb lands rather than living at a fixed
 * spot — you never look at your thumbs on a phone. But it still has to be
 * VISIBLE when nobody is touching it: the first version drew nothing at all
 * until a thumb arrived, which meant the controls were invisible and there was
 * no way to know they existed, let alone where. So it rests at an anchor, dim,
 * and moves to meet the thumb.
 *
 * Everything else in those files (flick detection, rebound latches) is for a
 * combat game and is deliberately not here.
 */
export function Stick({
  onChange,
  side = 'left',
}: {
  onChange: (east: number, south: number) => void;
  side?: 'left' | 'right';
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const state = useRef({ id: -1, ox: 0, oy: 0 });

  useEffect(() => {
    const pad = padRef.current;
    const base = baseRef.current;
    const knob = knobRef.current;
    if (!pad || !base || !knob) return;
    const RADIUS = 52;

    /** Where the stick sits when nobody is holding it: under a resting thumb. */
    const anchor = () => {
      const r = pad.getBoundingClientRect();
      return { x: side === 'left' ? 84 : r.width - 84, y: r.height - 84 };
    };

    const place = (x: number, y: number) => {
      base.style.left = `${x}px`;
      base.style.top = `${y}px`;
      knob.style.left = `${x}px`;
      knob.style.top = `${y}px`;
    };

    const rest = () => {
      const a = anchor();
      place(a.x, a.y);
      pad.classList.remove('held');
      knob.style.transform = 'translate(-50%, -50%)';
    };
    rest();
    const onResize = () => { if (state.current.id === -1) rest(); };
    window.addEventListener('resize', onResize);

    const down = (e: PointerEvent) => {
      if (state.current.id !== -1) return;
      state.current = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      pad.setPointerCapture(e.pointerId);
      const r = pad.getBoundingClientRect();
      place(e.clientX - r.left, e.clientY - r.top);
      pad.classList.add('held');
      knob.style.transform = 'translate(-50%, -50%)';
    };

    const move = (e: PointerEvent) => {
      if (e.pointerId !== state.current.id) return;
      let dx = e.clientX - state.current.ox;
      let dy = e.clientY - state.current.oy;
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) {
        dx = (dx / len) * RADIUS;
        dy = (dy / len) * RADIUS;
      }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      // Raw SCREEN offsets. Turning them into a world direction needs the map
      // bearing, which the stick has no business knowing — see stickToWorld.
      onChange(dx / RADIUS, dy / RADIUS);
    };

    const up = (e: PointerEvent) => {
      if (e.pointerId !== state.current.id) return;
      state.current.id = -1;
      rest();
      onChange(0, 0);
    };

    pad.addEventListener('pointerdown', down);
    pad.addEventListener('pointermove', move);
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('resize', onResize);
      pad.removeEventListener('pointerdown', down);
      pad.removeEventListener('pointermove', move);
      pad.removeEventListener('pointerup', up);
      pad.removeEventListener('pointercancel', up);
    };
  }, [onChange, side]);

  return (
    <div ref={padRef} className={`stick-pad stick-${side}`}>
      <div ref={baseRef} className="stick-base" />
      <div ref={knobRef} className="stick-knob" />
    </div>
  );
}

import { useEffect, useRef } from 'react';

/**
 * A floating-origin thumb stick, the idea ported from Peggy/Robits.
 *
 * The stick centres wherever the thumb lands rather than living at a fixed
 * spot on screen — you never look at your thumbs on a phone. Everything else
 * about those files (flick detection, rebound latches) is for a combat game
 * and is deliberately not here.
 */
export function Stick({
  onChange,
  side = 'left',
}: {
  onChange: (east: number, south: number) => void;
  side?: 'left' | 'right';
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const state = useRef({ id: -1, ox: 0, oy: 0 });

  useEffect(() => {
    const pad = padRef.current;
    const knob = knobRef.current;
    if (!pad || !knob) return;
    const RADIUS = 52;

    const show = (x: number, y: number) => {
      knob.style.opacity = '1';
      knob.style.left = `${x}px`;
      knob.style.top = `${y}px`;
    };

    const down = (e: PointerEvent) => {
      if (state.current.id !== -1) return;
      state.current = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      pad.setPointerCapture(e.pointerId);
      const r = pad.getBoundingClientRect();
      show(e.clientX - r.left, e.clientY - r.top);
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
      // Screen down is south, screen right is east.
      onChange(dx / RADIUS, dy / RADIUS);
    };

    const up = (e: PointerEvent) => {
      if (e.pointerId !== state.current.id) return;
      state.current.id = -1;
      knob.style.opacity = '0';
      knob.style.transform = 'translate(-50%, -50%)';
      onChange(0, 0);
    };

    pad.addEventListener('pointerdown', down);
    pad.addEventListener('pointermove', move);
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    return () => {
      pad.removeEventListener('pointerdown', down);
      pad.removeEventListener('pointermove', move);
      pad.removeEventListener('pointerup', up);
      pad.removeEventListener('pointercancel', up);
    };
  }, [onChange]);

  return (
    <div ref={padRef} className={`stick-pad stick-${side}`}>
      <div ref={knobRef} className="stick-knob" />
    </div>
  );
}

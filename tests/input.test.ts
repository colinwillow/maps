import { describe, it, expect } from 'vitest';
import { stickToWorld } from '../src/layers/character/input';

// `+ 0` normalises negative zero: cos(90deg) is 6.1e-17, which rounds to -0
// and compares unequal to 0 under toEqual even though the direction is right.
const dir = (v: { east: number; south: number }) => ({
  east: +v.east.toFixed(6) + 0,
  south: +v.south.toFixed(6) + 0,
});

describe('stick input is relative to the camera', () => {
  // Facing north, the stick behaves like a compass and always did.
  it('pushes north when the camera faces north', () => {
    expect(dir(stickToWorld(0, -1, 0))).toEqual({ east: 0, south: -1 });
    expect(dir(stickToWorld(1, 0, 0))).toEqual({ east: 1, south: 0 });
    expect(dir(stickToWorld(0, 1, 0))).toEqual({ east: 0, south: 1 });
  });

  // The bug: with the camera swung round, "up" still walked him north, which
  // is sideways or fully backwards depending on which way he faces. Up must
  // mean AWAY FROM THE CAMERA at every bearing.
  it('pushes away from the camera whichever way it faces', () => {
    expect(dir(stickToWorld(0, -1, 90))).toEqual({ east: 1, south: 0 });   // east
    expect(dir(stickToWorld(0, -1, 180))).toEqual({ east: 0, south: 1 });  // south
    expect(dir(stickToWorld(0, -1, 270))).toEqual({ east: -1, south: 0 }); // west
  });

  it('pushes toward the camera on a downward push, at every bearing', () => {
    for (const bearing of [0, 45, 90, 180, 270, 315]) {
      const up = stickToWorld(0, -1, bearing);
      const down = stickToWorld(0, 1, bearing);
      expect(down.east).toBeCloseTo(-up.east, 6);
      expect(down.south).toBeCloseTo(-up.south, 6);
    }
  });

  it('puts right on the screen to the camera\'s right', () => {
    // Camera facing east: screen-right is south.
    expect(dir(stickToWorld(1, 0, 90))).toEqual({ east: 0, south: 1 });
  });

  it('keeps the magnitude, so a half push still walks rather than runs', () => {
    const half = stickToWorld(0, -0.4, 137);
    expect(Math.hypot(half.east, half.south)).toBeCloseTo(0.4, 6);
  });

  it('clamps an over-range push to one', () => {
    const over = stickToWorld(3, -4, 0);
    expect(Math.hypot(over.east, over.south)).toBeCloseTo(1, 6);
  });

  it('is dead at centre', () => {
    expect(dir(stickToWorld(0, 0, 45))).toEqual({ east: 0, south: 0 });
  });
});

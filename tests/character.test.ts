import { describe, it, expect } from 'vitest';
import { Character, WALK, angleDelta, damp } from '../src/layers/character/Character';
import { headingOf, bearingToYaw } from '../src/layers/three/geo';

// A stub model: the controller only needs a root transform and a mixer.
const stubModel = () => {
  const root = { position: { set() {} }, rotation: { y: 0 } };
  return {
    root: root as never,
    mixer: { update() {}, clipAction: () => ({
      reset: () => ({ setEffectiveWeight: () => ({ play() {} }) }),
      crossFadeTo() {},
    }) } as never,
    clips: new Map(),
    height: 1.8,
  };
};

const step = (c: Character, seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) c.update(dt);
};

describe('heading maths', () => {
  // Direction, not just magnitude. Every one of these would still pass if
  // headingOf returned its own negation, so they pin the actual compass.
  it('maps movement vectors to compass bearings', () => {
    expect(headingOf(0, -1)).toBeCloseTo(0, 6);    // north
    expect(headingOf(1, 0)).toBeCloseTo(90, 6);    // east
    expect(headingOf(0, 1)).toBeCloseTo(180, 6);   // south
    expect(headingOf(-1, 0)).toBeCloseTo(-90, 6);  // west
  });

  it('turns a bearing into a yaw that sends -Z north and +X east', () => {
    expect(bearingToYaw(0)).toBeCloseTo(0, 6);
    expect(bearingToYaw(90)).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('takes the short way round', () => {
    expect(angleDelta(350, 10)).toBeCloseTo(20, 6);
    expect(angleDelta(10, 350)).toBeCloseTo(-20, 6);
    expect(angleDelta(0, 180)).toBeCloseTo(-180, 6);
  });

  it('damps toward the target at a frame-rate independent rate', () => {
    // Same elapsed time in one big step or many small ones lands in the
    // same place; a per-frame lerp factor would not.
    const coarse = damp(0, 10, 0.2, 0.5);
    let fine = 0;
    for (let i = 0; i < 50; i++) fine = damp(fine, 10, 0.2, 0.01);
    expect(fine).toBeCloseTo(coarse, 3);
  });
});

describe('walking to a waypoint', () => {
  it('arrives, and stops', () => {
    const c = new Character(stubModel());
    c.waypoint = { east: 10, south: 0 };
    step(c, 12);
    expect(Math.hypot(c.east - 10, c.south)).toBeLessThan(WALK.arriveRadius);
    expect(c.waypoint).toBeNull();
    step(c, 2);
    expect(c.speed).toBeLessThan(0.05);
  });

  // Would pass with movement running backwards if it only measured distance.
  it('walks toward the waypoint, not away from it', () => {
    const c = new Character(stubModel());
    c.waypoint = { east: 20, south: 0 };
    step(c, 1);
    expect(c.east).toBeGreaterThan(0.2);
    const north = new Character(stubModel());
    north.waypoint = { east: 0, south: -20 };
    step(north, 1);
    expect(north.south).toBeLessThan(-0.2);
  });

  it('faces the way it is going', () => {
    const c = new Character(stubModel());
    c.waypoint = { east: 30, south: 0 };
    step(c, 2);
    expect(Math.abs(angleDelta(c.heading, 90))).toBeLessThan(8); // east
  });

  it('never exceeds its run speed', () => {
    const c = new Character(stubModel());
    c.waypoint = { east: 400, south: 400 };
    let max = 0;
    for (let i = 0; i < 2000; i++) { c.update(1 / 60); max = Math.max(max, c.speed); }
    expect(max).toBeLessThanOrEqual(WALK.runSpeed + 1e-6);
  });
});

describe('direct stick input', () => {
  it('cancels a waypoint rather than fighting it', () => {
    const c = new Character(stubModel());
    c.waypoint = { east: 50, south: 0 };
    step(c, 0.5);
    c.input = { east: 0, south: -1 };
    c.update(1 / 60);
    expect(c.waypoint).toBeNull();
  });

  it('walks on a small push and runs on a full one', () => {
    const walk = new Character(stubModel());
    walk.input = { east: 0.4, south: 0 };
    step(walk, 3);
    const run = new Character(stubModel());
    run.input = { east: 1, south: 0 };
    step(run, 3);
    expect(run.speed).toBeGreaterThan(walk.speed * 1.5);
    expect(walk.clipFor(walk.speed)).toBe('walk_fwd_normal');
    expect(run.clipFor(run.speed)).toBe('run_fwd');
  });

  it('stands idle with no input', () => {
    const c = new Character(stubModel());
    step(c, 1);
    expect(c.clipFor(c.speed)).toBe('idle_neutral_00');
  });

  it('releasing the stick brings him to a stop', () => {
    const c = new Character(stubModel());
    c.input = { east: 1, south: 0 };
    step(c, 2);
    expect(c.speed).toBeGreaterThan(1);
    c.input = { east: 0, south: 0 };
    step(c, 2);
    expect(c.speed).toBeLessThan(0.05);
  });
});

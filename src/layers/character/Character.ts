import * as THREE from 'three';
import { headingOf, bearingToYaw } from '../three/geo';
import type { LoadedCharacter } from './loadColin';

/** Metres and seconds throughout, same convention as the sibling game repos. */
export const WALK = {
  walkSpeed: 1.5,
  runSpeed: 4.6,
  /** Above this input magnitude he runs rather than walks. */
  runThreshold: 0.65,
  /** How fast speed catches up to the target, seconds to close ~63% of the gap. */
  accelTau: 0.16,
  /** Degrees per second he can turn. Below this he pivots rather than slides. */
  turnDegPerSec: 520,
  /** Waypoint counts as reached inside this radius, in metres. */
  arriveRadius: 0.8,
  /** Cross-fade between locomotion clips. */
  blendSec: 0.22,
} as const;

const CLIPS = {
  idle: 'idle_neutral_00',
  walk: 'walk_fwd_normal',
  run: 'run_fwd',
} as const;

/** Shortest signed angle from a to b, in degrees. */
export function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/**
 * Frame-rate independent smoothing. Never a constant per-frame lerp factor —
 * that ties the feel of the movement to the frame rate.
 */
export function damp(current: number, target: number, tau: number, dt: number): number {
  return target + (current - target) * Math.exp(-dt / Math.max(tau, 1e-4));
}

export type Waypoint = { east: number; south: number } | null;

/**
 * Colin on the map. Position is in METRES east/south of the scene origin;
 * heading is a compass bearing so it drops straight into the map camera.
 */
export class Character {
  east = 0;
  south = 0;
  heading = 0; // compass degrees
  speed = 0;

  waypoint: Waypoint = null;
  /** Direct input, -1..1 each, east/south. Overrides the waypoint while held. */
  input = { east: 0, south: 0 };

  private current: THREE.AnimationAction | null = null;
  private currentName = '';

  constructor(private readonly model: LoadedCharacter) {}

  get root() {
    return this.model.root;
  }

  /** Drop him somewhere, facing a bearing, with no residual motion. */
  placeAt(east: number, south: number, heading = this.heading) {
    this.east = east;
    this.south = south;
    this.heading = heading;
    this.speed = 0;
    this.waypoint = null;
  }

  update(dt: number) {
    if (dt <= 0) return;

    // Direct input wins over a waypoint, so grabbing the stick cancels a walk
    // rather than fighting it.
    let wantEast = this.input.east;
    let wantSouth = this.input.south;
    let magnitude = Math.hypot(wantEast, wantSouth);

    if (magnitude > 0.02) {
      this.waypoint = null;
    } else if (this.waypoint) {
      const dEast = this.waypoint.east - this.east;
      const dSouth = this.waypoint.south - this.south;
      const dist = Math.hypot(dEast, dSouth);
      if (dist <= WALK.arriveRadius) {
        this.waypoint = null;
        magnitude = 0;
      } else {
        // Ease down on the approach so he does not stop dead on the pin.
        magnitude = Math.min(1, dist / 3);
        wantEast = dEast / dist;
        wantSouth = dSouth / dist;
      }
    } else {
      magnitude = 0;
    }

    const targetSpeed =
      magnitude < 0.02 ? 0 : magnitude > WALK.runThreshold ? WALK.runSpeed : WALK.walkSpeed * Math.max(magnitude, 0.35);
    this.speed = damp(this.speed, targetSpeed, WALK.accelTau, dt);

    if (magnitude > 0.02) {
      // Turn toward travel at a finite rate, so he pivots instead of snapping.
      const want = headingOf(wantEast, wantSouth);
      const delta = angleDelta(this.heading, want);
      const step = Math.min(Math.abs(delta), WALK.turnDegPerSec * dt) * Math.sign(delta);
      this.heading += step;
    }

    if (this.speed > 0.01) {
      const rad = (this.heading * Math.PI) / 180;
      this.east += Math.sin(rad) * this.speed * dt;
      this.south += -Math.cos(rad) * this.speed * dt;
    }

    this.root.position.set(this.east, 0, this.south);
    this.root.rotation.y = bearingToYaw(this.heading);

    this.playFor(this.speed);
    this.model.mixer.update(dt);
  }

  /** Which locomotion clip the current speed calls for. */
  clipFor(speed: number): string {
    if (speed < 0.15) return CLIPS.idle;
    if (speed < (WALK.walkSpeed + WALK.runSpeed) / 2) return CLIPS.walk;
    return CLIPS.run;
  }

  private playFor(speed: number) {
    const name = this.clipFor(speed);
    if (name === this.currentName) return;
    const clip = this.model.clips.get(name);
    if (!clip) return;
    const next = this.model.mixer.clipAction(clip);
    next.reset().setEffectiveWeight(1).play();
    if (this.current) this.current.crossFadeTo(next, WALK.blendSec, false);
    this.current = next;
    this.currentName = name;
  }
}

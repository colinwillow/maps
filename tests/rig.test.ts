import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { measureFacing, yawToFaceNorth } from '../src/layers/character/rig';

/**
 * Handedness, tested against a SYNTHETIC rig.
 *
 * The real GLB cannot be loaded here — GLTFLoader imports the bare specifier
 * `three` and will not resolve in node — which is exactly why the orientation
 * maths lives in rig.ts on its own.
 *
 * What these are written against: a check at one heading passes with any sign
 * error in it, and a check that only asserts "he ends up facing a cardinal
 * direction" passes while facing the wrong one. So every case asserts the
 * measured vector AND that the correction lands him on north specifically, at
 * four cardinals plus an off-axis angle.
 */

const NORTH = new THREE.Vector3(0, 0, -1);

/** Compass bearing to a ground vector in scene axes (x east, z south). */
function dir(deg: number) {
  const r = (deg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(r), 0, -Math.cos(r));
}

/** Right hand of someone facing `f`: facing north, your right is east (+X). */
function rightOf(f: THREE.Vector3) {
  return new THREE.Vector3(-f.z, 0, f.x);
}

type Parts = { toes?: boolean; shoulders?: boolean; mirrorShoulders?: boolean; splayDeg?: number };

function makeRig(facingDeg: number, parts: Parts = {}) {
  const { toes = true, shoulders = true, mirrorShoulders = false, splayDeg = 0 } = parts;
  const f = dir(facingDeg);
  const right = rightOf(f);
  const root = new THREE.Group();

  const bone = (name: string, at: THREE.Vector3) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.copy(at);
    root.add(b);
    return b;
  };

  if (toes) {
    for (const [sideName, sign] of [['Left', -1], ['Right', 1]] as const) {
      // Feet splay outward, which is what averaging the pair is there to cancel.
      const splay = dir(facingDeg + sign * splayDeg);
      const ankle = right.clone().multiplyScalar(sign * 0.1);
      bone(`mixamorig_${sideName}Foot`, ankle);
      bone(`mixamorig_${sideName}ToeBase`, ankle.clone().addScaledVector(splay, 0.2));
    }
  }
  if (shoulders) {
    const flip = mirrorShoulders ? -1 : 1;
    bone('mixamorig_LeftShoulder', right.clone().multiplyScalar(-0.2 * flip).setY(1.4));
    bone('mixamorig_RightShoulder', right.clone().multiplyScalar(0.2 * flip).setY(1.4));
  }
  root.updateMatrixWorld(true);
  return { root, f };
}

const turned = (f: THREE.Vector3, yaw: number) =>
  f.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

describe('measuring which way a rig faces', () => {
  for (const deg of [0, 90, 180, 270, 37]) {
    it(`measures a rig facing ${deg} degrees, and turns it to north`, () => {
      const { root, f } = makeRig(deg);
      const m = measureFacing(root);
      expect(m.from).toBe('toes');
      expect(m.forward.distanceTo(f)).toBeLessThan(1e-6);
      // The correction must land on NORTH, not merely on some axis.
      expect(turned(f, yawToFaceNorth(m.forward)).distanceTo(NORTH)).toBeLessThan(1e-6);
    });
  }

  it('is the 180 degree case for a rig facing +Z, which is what Colin is', () => {
    // +Z is SOUTH in this scene. The code used to assume -Z, so he ran exactly
    // backwards at every heading — and with the camera swinging in behind him,
    // that looked like a man sprinting at the camera rather than a sign error.
    const forward = new THREE.Vector3(0, 0, 1);
    expect(yawToFaceNorth(forward)).toBeCloseTo(Math.PI, 9);
    expect(turned(forward, yawToFaceNorth(forward)).distanceTo(NORTH)).toBeLessThan(1e-9);
  });

  it('leaves an already-north-facing rig alone', () => {
    expect(yawToFaceNorth(new THREE.Vector3(0, 0, -1))).toBeCloseTo(0, 9);
  });

  it('cancels the splay of the two feet', () => {
    const { root, f } = makeRig(115, { splayDeg: 28 });
    expect(measureFacing(root).forward.distanceTo(f)).toBeLessThan(1e-6);
  });

  it('falls back to the shoulders when there are no toes, and gets the same answer', () => {
    for (const deg of [0, 90, 180, 270]) {
      const { root, f } = makeRig(deg, { toes: false });
      const m = measureFacing(root);
      expect(m.from).toBe('shoulders');
      expect(m.forward.distanceTo(f)).toBeLessThan(1e-6);
      expect(turned(f, yawToFaceNorth(m.forward)).distanceTo(NORTH)).toBeLessThan(1e-6);
    }
  });

  it('gets the shoulder cross product the right way round', () => {
    // up x right is forward; right x up is its exact negation, and that is the
    // single easiest thing to ship backwards here. Mirroring the shoulders
    // must mirror the answer — if it does not, the cross product is not
    // actually reading the shoulders.
    const straight = measureFacing(makeRig(0, { toes: false }).root).forward;
    const mirrored = measureFacing(makeRig(0, { toes: false, mirrorShoulders: true }).root).forward;
    expect(straight.distanceTo(NORTH)).toBeLessThan(1e-6);
    expect(mirrored.distanceTo(NORTH.clone().negate())).toBeLessThan(1e-6);
  });

  it('prefers the feet, and says so when the two disagree', () => {
    // Feet are a geometric fact; the shoulder span needs the rig's left/right
    // naming to be honest. Big Don shipped a rotated model and swapped strafe
    // clips at once, and they hid each other.
    const { root, f } = makeRig(0, { mirrorShoulders: true });
    const m = measureFacing(root);
    expect(m.from).toBe('toes');
    expect(m.forward.distanceTo(f)).toBeLessThan(1e-6);
    expect(m.disagreementDeg).toBeCloseTo(180, 3);
  });

  it('agrees with itself when the rig is honest', () => {
    expect(measureFacing(makeRig(214).root).disagreementDeg).toBeCloseTo(0, 3);
  });

  it('assumes the GLTF convention when there is nothing to measure', () => {
    const m = measureFacing(makeRig(90, { toes: false, shoulders: false }).root);
    expect(m.from).toBe('default');
    expect(m.forward.distanceTo(NORTH)).toBeLessThan(1e-9);
    expect(yawToFaceNorth(m.forward)).toBeCloseTo(0, 9);
  });
});

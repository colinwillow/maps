import * as THREE from 'three';
import { bearingToYaw } from '../three/geo';
import type { Prop, PropKind } from './plan';

/**
 * The props themselves: low-poly, instanced, and built facing NORTH.
 *
 * Facing north (three's -Z) is not arbitrary — it is the convention a GLTF
 * model's forward already uses here, so `bearingToYaw` turns a compass heading
 * into a yaw for a prop exactly as it does for the character. Build a sign
 * facing +Z instead and every one of them ends up pointing away from the
 * driver it is meant to be read by, which looks like nothing at all until you
 * walk up to one.
 *
 * Each kind is a handful of PARTS, and every part of a kind shares the same
 * per-instance matrix. That is what keeps a tree (trunk + canopy) and a
 * traffic light (post + arm + head + lens) down to one draw call per part
 * instead of one per object, while still letting them be different colours —
 * an InstancedMesh has one material.
 */

export const LOOK = {
  bark: 0x6b5844,
  leaf: 0x7f9c63,
  leafDark: 0x6a8753,
  timber: 0x8a7b68,
  metal: 0x9aa1a6,
  darkMetal: 0x3f4448,
  signRed: 0xc0392b,
  signFace: 0xf2ede4,
  lampHead: 0xd8d2c4,
  lens: 0xd94a3a,
} as const;

const mat = (color: number, emissive = 0) =>
  new THREE.MeshStandardMaterial({
    color,
    // Matching the house look: nothing here is shiny. A moving specular
    // hotspot is what makes hand-painted geometry read as wet plastic.
    roughness: 1,
    metalness: 0,
    emissive: new THREE.Color(emissive ? color : 0x000000),
    emissiveIntensity: emissive,
  });

type Part = { geometry: THREE.BufferGeometry; material: THREE.Material };

/**
 * A cylinder standing on the ground, given its height rather than its centre,
 * because every one of these is measured from the pavement up.
 */
const post = (rTop: number, rBottom: number, height: number, y = 0, radial = 6) => {
  const g = new THREE.CylinderGeometry(rTop, rBottom, height, radial);
  g.translate(0, y + height / 2, 0);
  return g;
};

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
};

/** Parts per kind, in metres, standing at the origin and facing north. */
function partsFor(kind: PropKind): Part[] {
  switch (kind) {
    case 'tree': {
      // A canopy of two offset icosahedra reads as a tree from any angle for
      // 80 triangles; a single sphere reads as a lollipop.
      const lower = new THREE.IcosahedronGeometry(2.1, 0);
      lower.translate(0, 4.1, 0);
      const upper = new THREE.IcosahedronGeometry(1.5, 0);
      upper.translate(0.4, 5.9, -0.3);
      return [
        { geometry: post(0.16, 0.26, 3.4), material: mat(LOOK.bark) },
        { geometry: lower, material: mat(LOOK.leaf) },
        { geometry: upper, material: mat(LOOK.leafDark) },
      ];
    }
    case 'pole': {
      // Crossarms sit ACROSS the street, which is why the pole is given the
      // road's own heading rather than a facing of its own.
      return [
        { geometry: post(0.14, 0.22, 9.4), material: mat(LOOK.timber) },
        { geometry: box(2.6, 0.12, 0.12, 0, 8.9, 0), material: mat(LOOK.timber) },
        { geometry: box(1.9, 0.1, 0.1, 0, 8.1, 0), material: mat(LOOK.timber) },
      ];
    }
    case 'lamp': {
      // The arm reaches FORWARD, over the road, and the plan hands these a
      // heading that points at the carriageway.
      return [
        { geometry: post(0.1, 0.16, 7.2), material: mat(LOOK.metal) },
        { geometry: box(0.12, 0.12, 2.4, 0, 7.15, -1.2), material: mat(LOOK.metal) },
        { geometry: box(0.5, 0.18, 1.1, 0, 7.0, -2.2), material: mat(LOOK.lampHead) },
      ];
    }
    case 'trafficLight': {
      // Mast arm reaches LEFT across the junction; facing north, left is west,
      // which is -X. The head hangs at the far end looking back at the driver.
      return [
        { geometry: post(0.12, 0.18, 5.6), material: mat(LOOK.darkMetal) },
        { geometry: box(4.2, 0.14, 0.14, -2.1, 5.5, 0), material: mat(LOOK.darkMetal) },
        { geometry: box(0.42, 1.15, 0.34, -3.6, 4.85, 0), material: mat(LOOK.darkMetal) },
        { geometry: box(0.2, 0.2, 0.06, -3.6, 5.24, -0.18), material: mat(LOOK.lens, 0.85) },
      ];
    }
    case 'stopSign': {
      // An octagon is a cylinder with eight sides stood on its edge. The
      // half-step of spin gives it a flat top instead of a point.
      const face = new THREE.CylinderGeometry(0.46, 0.46, 0.05, 8);
      face.rotateY(Math.PI / 8);
      face.rotateX(-Math.PI / 2);
      face.translate(0, 2.05, 0);
      return [
        { geometry: post(0.045, 0.045, 2.1), material: mat(LOOK.metal) },
        { geometry: face, material: mat(LOOK.signRed) },
      ];
    }
  }
}

/**
 * Builds the scene content for a plan.
 *
 * Returns a group and a dispose(), because these are rebuilt every time he
 * walks far enough and three does not free GPU buffers on its own — leaking a
 * few thousand geometries per city block is how a phone runs out of memory
 * halfway down a street.
 */
export function buildProps(props: Prop[]): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  const owned: { dispose(): void }[] = [];

  const byKind = new Map<PropKind, Prop[]>();
  for (const p of props) {
    const list = byKind.get(p.kind);
    if (list) list.push(p); else byKind.set(p.kind, [p]);
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  for (const [kind, list] of byKind) {
    for (const part of partsFor(kind)) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      // These never move once placed, so let three skip re-uploading them.
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      // Props are scattered over hundreds of metres; a bounding sphere derived
      // from the base geometry alone would cull the whole batch the moment the
      // origin left the frustum.
      mesh.frustumCulled = false;
      list.forEach((p, i) => {
        // Scene axes: X east, Y up, Z SOUTH (three/geo.ts).
        pos.set(p.east, 0, p.south);
        q.setFromAxisAngle(up, bearingToYaw(p.heading));
        scl.setScalar(p.scale);
        mesh.setMatrixAt(i, m.compose(pos, q, scl));
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      owned.push(part.geometry, part.material, mesh);
    }
  }

  return {
    group,
    dispose() {
      owned.forEach((o) => o.dispose());
      group.clear();
    },
  };
}

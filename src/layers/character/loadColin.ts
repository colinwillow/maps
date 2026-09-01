import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Loads the Colin model and makes him a real-world 1.8m tall, feet on y=0.
 *
 * The height trick is ported from Big Don, where it cost real debugging time:
 *
 * 1. `Box3.setFromObject` LIES about skinned meshes. It measures the geometry's
 *    bind-pose box through the mesh node's matrixWorld, but a skinned mesh's
 *    vertices are placed by the BONES, so the node transform does not move
 *    them. Measure the posed skeleton instead.
 * 2. `updateMatrixWorld` is NOT `updateWorldMatrix`. Different methods.
 *    SkinnedMesh overrides only the former, and that override is what
 *    recomputes `bindMatrixInverse`. Call the wrong one and every skinned
 *    vertex goes through a stale inverse — a measurement that came out 150x
 *    wrong, and then read as "the camera is broken".
 */
export function skinnedBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().makeEmpty();
  const tmp = new THREE.Box3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh & { isSkinnedMesh?: boolean; skeleton?: THREE.Skeleton };
    if (!(mesh as THREE.Mesh).isMesh && !mesh.isSkinnedMesh) return;
    if (mesh.isSkinnedMesh) {
      mesh.skeleton?.update();
      (mesh as THREE.SkinnedMesh).computeBoundingBox();
      const bb = (mesh as THREE.SkinnedMesh).boundingBox;
      if (!bb) return;
      tmp.copy(bb);
    } else {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (!mesh.geometry.boundingBox) return;
      tmp.copy(mesh.geometry.boundingBox);
    }
    tmp.applyMatrix4(mesh.matrixWorld);
    box.union(tmp);
  });
  return box;
}

/** Scale to `heightM` and drop the soles onto y=0. Returns the scale used. */
export function normaliseHeight(root: THREE.Object3D, inner: THREE.Object3D, heightM: number) {
  const box = skinnedBounds(root);
  const h = box.max.y - box.min.y;
  if (!(h > 0)) return 1;
  const scale = heightM / h;
  inner.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  const after = skinnedBounds(root);
  inner.position.y -= after.min.y; // soles to ground
  return scale;
}

export type LoadedCharacter = {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  clips: Map<string, THREE.AnimationClip>;
  height: number;
};

export async function loadColin(url: string, heightM = 1.8): Promise<LoadedCharacter> {
  const gltf = await new GLTFLoader().loadAsync(url);

  const inner = gltf.scene;
  const root = new THREE.Group();
  root.name = 'colin';
  root.add(inner);

  // The mixer must exist and be stepped once before measuring: the model is
  // measured in the pose it actually renders in, not its bind pose.
  const mixer = new THREE.AnimationMixer(inner);
  const clips = new Map<string, THREE.AnimationClip>();
  for (const c of gltf.animations) clips.set(c.name, c);

  const first = clips.get('idle_neutral_00') ?? gltf.animations[0];
  if (first) mixer.clipAction(first).play();
  mixer.update(0);

  const height = normaliseHeight(root, inner, heightM);

  // The look, straight out of Robits by way of Big Don: feed the base colour
  // map back in as an EMISSIVE map so he is lit by his own paint. Relying on
  // scene lights alone leaves him a silhouette against the bright paper
  // basemap, and a mid PBR metalness puts a moving specular hotspot on him
  // that makes hand-painted texture look like wet plastic.
  inner.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh && !(m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return;
    m.castShadow = false;
    m.receiveShadow = false;
    m.frustumCulled = false; // a skinned mesh's bounds lie; culling pops him out
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const std = mat as THREE.MeshStandardMaterial;
      if (!std) continue;
      if (std.map) {
        std.emissiveMap = std.map;
        std.emissive = new THREE.Color(0xffffff);
        std.emissiveIntensity = 0.85;
      }
      if ('metalness' in std) std.metalness = 0;
      if ('roughness' in std) std.roughness = 1;
      std.needsUpdate = true;
    }
  });

  return { root, mixer, clips, height };
}

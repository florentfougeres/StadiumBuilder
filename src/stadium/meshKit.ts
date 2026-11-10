import * as THREE from 'three';

/** Cylinder strut from `pA` to `pB`, radius `rTop` at `pB` and `rBot` at `pA`. */
export function createStrut(
  pA: THREE.Vector3,
  pB: THREE.Vector3,
  rTop: number,
  rBot: number,
  mat: THREE.Material,
  segs: number = 6
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(pB, pA);
  const len = Math.max(0.05, dir.length());
  const mid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBot, len, segs),
    mat
  );
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true;
  return mesh;
}

/**
 * Seating decor (seats, spectators, aisle rails) that rays pass straight through. Each is
 * instanced by the tens of thousands, and a ray through an instanced mesh tests every instance:
 * a halo screen's cable search or a wheel zoom would spend up to a second in them. Rays land on
 * the stand treads underneath instead, a few centimetres lower.
 */
export function ignoreRaycasts(mesh: THREE.Object3D): void {
  mesh.raycast = () => {};
}

/** Lighter geometry an instanced mesh switches to when seen from afar (see `addDistanceLods`). */
const farDetail = new WeakMap<THREE.InstancedMesh, THREE.BufferGeometry>();

export function setFarDetail(mesh: THREE.InstancedMesh, geometry: THREE.BufferGeometry): void {
  farDetail.set(mesh, geometry);
}

/**
 * Viewport only: wraps every instanced mesh that has far detail in a `THREE.LOD`, whose far level
 * draws the same instances (shared matrices and colours) with the lighter geometry once the camera
 * is `distance` metres from the mesh's origin. A full crowd and its seats weigh about 15 million
 * triangles; seen from the overview, where a head is a pixel or two, a quarter of that looks the same.
 * Exports keep the plain meshes, so a Blender file or a GLB holds each instance once.
 */
export function addDistanceLods(root: THREE.Object3D, distance: number): void {
  const meshes: THREE.InstancedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh && farDetail.has(o as THREE.InstancedMesh)) {
      meshes.push(o as THREE.InstancedMesh);
    }
  });
  for (const near of meshes) {
    const parent = near.parent;
    if (!parent) continue;
    const far = new THREE.InstancedMesh(farDetail.get(near)!, near.material, near.count);
    far.instanceMatrix = near.instanceMatrix;
    far.instanceColor = near.instanceColor;
    far.boundingSphere = near.boundingSphere?.clone() ?? null;
    far.castShadow = near.castShadow;
    far.receiveShadow = near.receiveShadow;
    far.raycast = near.raycast;
    far.name = `${near.name}Far`;

    const lod = new THREE.LOD();
    lod.name = `${near.name}Lod`;
    lod.position.copy(near.position);
    lod.quaternion.copy(near.quaternion);
    lod.scale.copy(near.scale);
    near.position.set(0, 0, 0);
    near.quaternion.identity();
    near.scale.set(1, 1, 1);
    parent.add(lod);
    parent.remove(near);
    lod.addLevel(near, 0);
    lod.addLevel(far, distance);
  }
}

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

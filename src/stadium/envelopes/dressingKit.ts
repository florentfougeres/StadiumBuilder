import * as THREE from 'three';
import { type FacadeRailSample, instancedBoxes } from './rail';

/** Unit-box transform at `out` metres outward of a rail sample, facing out. */
export function place(pt: FacadeRailSample, out: number, y: number, sx: number, sy: number, sz: number): THREE.Matrix4 {
  const dummy = new THREE.Object3D();
  dummy.position.set(pt.x + pt.nx * out, y, pt.z + pt.nz * out);
  dummy.rotation.set(0, Math.atan2(pt.nx, pt.nz), 0);
  dummy.scale.set(sx, sy, sz);
  dummy.updateMatrix();
  return dummy.matrix;
}

/** Instanced boxes of a dressing, grouped, or null when nothing fits. */
export function dressingGroup(parts: [string, THREE.Matrix4[]][], mat: THREE.Material): THREE.Group | null {
  const group = new THREE.Group();
  group.name = 'EnvelopeDressing';
  for (const [name, list] of parts) {
    const mesh = instancedBoxes(name, list, mat);
    if (mesh) group.add(mesh);
  }
  return group.children.length > 0 ? group : null;
}

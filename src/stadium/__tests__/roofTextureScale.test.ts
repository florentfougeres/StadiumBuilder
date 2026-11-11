import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateRoofGroup } from '../generateRoof';
import { ROOF_TILE_M } from '../materials';
import { createPresetDocument } from '../presets';
import { RoofMaterialId } from '../schema';

/** Metres of surface covered by one texture tile, in u and v, on each roof cladding mesh. */
function tileSizes(root: THREE.Object3D): { u: number; v: number; want: number }[] {
  root.updateMatrixWorld(true);
  const out: { u: number; v: number; want: number }[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || Array.isArray(mesh.material)) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const want = mat.userData?.roofTileM as number | undefined;
    if (!want || !mat.map) return;
    const pos = mesh.geometry.getAttribute('position');
    const uv = mesh.geometry.getAttribute('uv');
    const index = mesh.geometry.getIndex();
    if (!uv) return;
    let su = 0, sv = 0, sa = 0;
    const p = [0, 1, 2].map(() => new THREE.Vector3());
    const tris = (index ? index.count : pos.count) / 3;
    for (let t = 0; t < tris; t += Math.max(1, Math.floor(tris / 500))) {
      const ids = [0, 1, 2].map((k) => (index ? index.getX(t * 3 + k) : t * 3 + k));
      ids.forEach((id, k) => p[k].fromBufferAttribute(pos, id).applyMatrix4(mesh.matrixWorld));
      const du1 = uv.getX(ids[1]) - uv.getX(ids[0]), dv1 = uv.getY(ids[1]) - uv.getY(ids[0]);
      const du2 = uv.getX(ids[2]) - uv.getX(ids[0]), dv2 = uv.getY(ids[2]) - uv.getY(ids[0]);
      const det = du1 * dv2 - du2 * dv1;
      if (Math.abs(det) < 1e-12) continue;
      const e1 = p[1].clone().sub(p[0]), e2 = p[2].clone().sub(p[0]);
      const area = e1.clone().cross(e2).length() / 2;
      if (area < 1e-6) continue;
      su += e1.clone().multiplyScalar(dv2).addScaledVector(e2, -dv1).divideScalar(det).length() * area;
      sv += e2.clone().multiplyScalar(du1).addScaledVector(e1, -du2).divideScalar(det).length() * area;
      sa += area;
    }
    if (sa > 50) out.push({ u: su / sa / mat.map.repeat.x, v: sv / sa / mat.map.repeat.y, want });
  });
  return out;
}

describe('roof cladding at its real size', () => {
  it.each(['bowl_bowstring_60k', 'traditional_four_stands_42k', 'stepped_cable_wheel_68k', 'urban_cathedral_84k'])(
    '%s: one texture tile covers its real size',
    (id) => {
      for (const roofMat of ['standing_seam_zinc', 'etfe_cushions'] as RoofMaterialId[]) {
        const doc = createPresetDocument(id);
        doc.materials = { ...doc.materials!, roof: roofMat };
        doc.roof = { ...doc.roof, skylightMode: 'none' };
        const sizes = tileSizes(generateRoofGroup(doc));
        expect(sizes.length).toBeGreaterThan(0);
        for (const s of sizes) {
          expect(s.want).toBe(ROOF_TILE_M[roofMat]);
          // Within 10 % (repeats are rounded to two figures so similar surfaces share a material).
          expect(s.u / s.want).toBeGreaterThan(0.9);
          expect(s.u / s.want).toBeLessThan(1.1);
          expect(s.v / s.want).toBeGreaterThan(0.9);
          expect(s.v / s.want).toBeLessThan(1.1);
        }
      }
    }
  );
});

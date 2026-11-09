import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D } from '../buildStadiumScene';
import { createFacadePbrMaterial } from '../materials';
import type { FacadeRailSample } from '../envelopes/rail';
import { buildParametricFacadeOnRail } from '../parametricFacade';
import { FacadeMaterialId } from '../schema';

const rail: FacadeRailSample[] = [
  { x: -40, z: 0, nx: 0, nz: 1, yBottom: 0, yTop: 30 },
  { x: 40, z: 0, nx: 0, nz: 1, yBottom: 0, yTop: 30 },
];

function skin(pattern: 'triangulated_lace' | 'scales', bulge: number): THREE.Group {
  const mat = new THREE.MeshStandardMaterial();
  return buildParametricFacadeOnRail({
    samples: rail,
    closed: false,
    pattern,
    density: 1,
    depth: 0.8,
    bulge,
    primaryMat: mat,
    accentMat: mat,
  })!;
}

describe('reference facade materials and skins', () => {
  it('synthesizes the four new facade materials', () => {
    const ids: FacadeMaterialId[] = [
      'uhpc_lace_panels',
      'precast_concrete_scales',
      'polycarbonate_facade',
      'glulam_lattice',
    ];
    for (const id of ids) {
      const mat = createFacadePbrMaterial(id, 'night', false, 1);
      expect(mat.map).toBeTruthy();
      mat.dispose();
    }
  });

  for (const pattern of ['triangulated_lace', 'scales'] as const) {
    it(`builds the ${pattern} skin and bulges it outward`, () => {
      const flat = skin(pattern, 0);
      const bulged = skin(pattern, 1);
      const mesh = flat.children[0] as THREE.InstancedMesh;
      expect(mesh.count).toBeGreaterThan(20);
      const zFlat = new THREE.Box3().setFromObject(flat).max.z;
      const zBulged = new THREE.Box3().setFromObject(bulged).max.z;
      expect(zBulged - zFlat).toBeGreaterThan(4);
      disposeObject3D(flat);
      disposeObject3D(bulged);
    });
  }
});

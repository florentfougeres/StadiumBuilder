import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generateRoofGroup } from '../generateRoof';
import { createPresetDocument } from '../presets';
import { StadiumDocument } from '../schema';

/** Steep cauldron with a cable roof: 3-tier south stand, single-tier kop to the east. */
function asymmetricDoc(followStands: number): StadiumDocument {
  const doc = createPresetDocument('cauldron_cable_42k');
  doc.stands.south.tiers = 3;
  doc.stands.south.rows = 60;
  doc.stands.east.tiers = 1;
  doc.stands.east.rows = 20;
  doc.roof.followStands = followStands;
  return doc;
}

/** Highest roof point in a plan sector around the direction `(dx, dz)`. */
function topInSector(roof: THREE.Object3D, dx: number, dz: number): number {
  roof.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  let top = -Infinity;
  roof.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || o instanceof THREE.InstancedMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const len = Math.hypot(p.x, p.z) || 1;
      if ((p.x * dx + p.z * dz) / len > 0.95) top = Math.max(top, p.y);
    }
  });
  return top;
}

describe('roof following the stands', () => {
  it('stays level by default', () => {
    const roof = generateRoofGroup(asymmetricDoc(0));
    expect(Math.abs(topInSector(roof, 1, 0) - topInSector(roof, 0, 1))).toBeLessThan(0.5);
  });

  it('drops over the low stand and stays over the tall one', () => {
    const level = generateRoofGroup(asymmetricDoc(0));
    const follow = generateRoofGroup(asymmetricDoc(1));
    // East kop is far lower than the south stand: the roof comes down over it.
    expect(topInSector(follow, 1, 0)).toBeLessThan(topInSector(level, 1, 0) - 5);
    // Over the tallest stand it barely moves (down to the bowl's real crest, ~1.8 m under the
    // stand's nominal height that sets the level roof).
    expect(topInSector(follow, 0, 1)).toBeGreaterThan(topInSector(level, 0, 1) - 2.5);
  });
});

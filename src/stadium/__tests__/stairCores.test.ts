import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateStairCores } from '../generateStairCores';
import { createPresetDocument } from '../presets';
import { computeStadiumRingBounds } from '../roofs/ringBounds';

const coresOf = (group: THREE.Group) => group.getObjectByName('StairCoreWalls') as THREE.InstancedMesh | undefined;

describe('stair cores', () => {
  it('are off by default', () => {
    const doc = createPresetDocument('traditional_four_stands_42k');
    expect(generateStairCores(doc, false, 1).children).toHaveLength(0);
  });

  it.each(['traditional_four_stands_42k', 'stepped_cable_wheel_68k', 'horseshoe_amphitheatre_38k'])(
    '%s: stand against the facade, from the ground to above its crest',
    (id) => {
      const doc = createPresetDocument(id);
      doc.concourse = { width: doc.concourse?.width ?? 0, heightRatio: doc.concourse?.heightRatio ?? 0.5, stairCores: 8 };
      const cores = coresOf(generateStairCores(doc, false, 1))!;
      expect(cores.count).toBe(8);
      const { standHeightAtNormal } = computeStadiumRingBounds(doc);
      const m = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const size = new THREE.Vector3();
      for (let i = 0; i < cores.count; i++) {
        cores.getMatrixAt(i, m);
        m.decompose(pos, quat, size);
        // Standing on the ground.
        expect(pos.y - size.y / 2).toBeCloseTo(0, 5);
        // Taller than the stands behind it, by about the lift overrun.
        const n = new THREE.Vector3(pos.x, 0, pos.z).normalize();
        expect(pos.y + size.y / 2).toBeGreaterThan(standHeightAtNormal(n.x, n.z) * 0.8);
      }
    }
  );
});

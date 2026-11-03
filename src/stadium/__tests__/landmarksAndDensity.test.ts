import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D } from '../buildStadiumScene';
import { generatePlacedObjectGroup } from '../generateLights';
import { generateRoofGroup } from '../generateRoof';
import { createPresetDocument } from '../presets';
import { PlacedObject, PlacedObjectType } from '../schema';

function placed(type: PlacedObjectType): PlacedObject {
  return { id: `t-${type}`, type, name: type, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
}

describe('landmarks and mast settings', () => {
  it('builds the inclined mast, arch and gate at their expected scale', () => {
    const heights: Partial<Record<PlacedObjectType, number>> = {
      inclined_mast: 110,
      monumental_arch: 18,
      monumental_gate: 12,
    };
    for (const [type, minH] of Object.entries(heights) as [PlacedObjectType, number][]) {
      const g = generatePlacedObjectGroup(placed(type), 'day', false);
      expect(new THREE.Box3().setFromObject(g).max.y).toBeGreaterThan(minH);
      disposeObject3D(g);
    }
  });

  it('follows the suspended mast count and height', () => {
    const measure = (mastHeight: number, mastCount: number) => {
      const doc = createPresetDocument('olympic_masts_80k');
      doc.roof = { ...doc.roof, style: 'suspended_masts', mastHeight, mastCount };
      const roof = generateRoofGroup(doc);
      const y = new THREE.Box3().setFromObject(roof).max.y;
      let meshes = 0;
      roof.traverse(() => meshes++);
      disposeObject3D(roof);
      return { y, meshes };
    };
    const low = measure(10, 12);
    const high = measure(40, 30);
    expect(high.y - low.y).toBeGreaterThan(25);
    expect(high.meshes).toBeGreaterThan(low.meshes);
  });

});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D } from '../buildStadiumScene';
import { generateRoofGroup } from '../generateRoof';
import { createPresetDocument } from '../presets';
import { resolveCounterweightTrusses, StadiumDocument } from '../schema';

function trussDoc(presetId: string, patch: Partial<StadiumDocument['roof']> = {}): StadiumDocument {
  const doc = createPresetDocument(presetId);
  doc.roof = { ...doc.roof, style: 'counterweighted_cantilever', ...patch };
  return doc;
}

/** Box geometries merged as non-indexed triangles: 36 vertices per box. */
function boxCount(roof: THREE.Object3D, name: string): number {
  const mesh = roof.getObjectByName(name) as THREE.Mesh | undefined;
  return mesh ? mesh.geometry.getAttribute('position').count / 36 : 0;
}

describe('counterweighted cantilever roof', () => {
  it('defaults to the Groupama layout and clamps settings', () => {
    const roof = createPresetDocument('bowl_bowstring_60k').roof;
    expect(resolveCounterweightTrusses(roof)).toEqual({ trussCount: 32, backspanRatio: 0.53 });
    expect(resolveCounterweightTrusses({ ...roof, trussCount: 3, backspanRatio: 2 })).toEqual({
      trussCount: 12,
      backspanRatio: 0.7,
    });
  });

  for (const presetId of ['bowl_bowstring_60k', 'olympic_masts_80k', 'traditional_four_stands_42k']) {
    it(`builds one tie rod and pier per truss on ${presetId}`, () => {
      const roof = generateRoofGroup(trussDoc(presetId, { trussCount: 24 }));
      expect(roof.getObjectByName('RoofCanopySurface')).toBeDefined();
      expect(boxCount(roof, 'CounterweightTieRods')).toBe(24);
      expect(boxCount(roof, 'CounterweightPiers')).toBe(24);
      expect(boxCount(roof, 'CounterweightTrusses')).toBeGreaterThan(24 * 4);
      disposeObject3D(roof);
    });
  }

  it('anchors a longer back-span farther out', () => {
    const reach = (ratio: number) => {
      const roof = generateRoofGroup(trussDoc('bowl_bowstring_60k', { backspanRatio: ratio }));
      const box = new THREE.Box3().setFromObject(roof.getObjectByName('CounterweightPiers')!);
      disposeObject3D(roof);
      return box.max.x;
    };
    expect(reach(0.7)).toBeGreaterThan(reach(0.3) + 5);
  });

  it('keeps only the north half in cross-section', () => {
    const roof = generateRoofGroup(trussDoc('bowl_bowstring_60k'), true);
    const box = new THREE.Box3().setFromObject(roof.getObjectByName('CounterweightPiers')!);
    expect(box.max.z).toBeLessThanOrEqual(0.5);
    disposeObject3D(roof);
  });
});

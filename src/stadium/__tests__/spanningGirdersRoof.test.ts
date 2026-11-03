import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D } from '../buildStadiumScene';
import { generateRoofGroup } from '../generateRoof';
import { createPresetDocument } from '../presets';
import { resolveSpanningGirderCount, StadiumDocument } from '../schema';

function girderDoc(presetId: string, patch: Partial<StadiumDocument['roof']> = {}): StadiumDocument {
  const doc = createPresetDocument(presetId);
  doc.roof = { ...doc.roof, style: 'spanning_girders', ...patch };
  return doc;
}

function hitsDeck(roof: THREE.Group, x: number, z: number): boolean {
  roof.updateMatrixWorld(true);
  const deck = roof.getObjectByName('RoofCanopySurface')!;
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 500, z), new THREE.Vector3(0, -1, 0));
  return ray.intersectObject(deck, false).length > 0;
}

describe('closed roof on mega-girders', () => {
  it('clamps the girder count', () => {
    const roof = createPresetDocument('bowl_bowstring_60k').roof;
    expect(resolveSpanningGirderCount(roof)).toBe(4);
    expect(resolveSpanningGirderCount({ ...roof, girderCount: 1 })).toBe(2);
    expect(resolveSpanningGirderCount({ ...roof, girderCount: 9 })).toBe(6);
  });

  for (const presetId of ['bowl_bowstring_60k', 'olympic_masts_80k', 'traditional_four_stands_42k']) {
    it(`closes the whole bowl on ${presetId}`, () => {
      const roof = generateRoofGroup(girderDoc(presetId));
      expect(hitsDeck(roof, 0, 0)).toBe(true);
      expect(hitsDeck(roof, -40, 20)).toBe(true);
      expect(roof.getObjectByName('RoofEaveSkirt')).toBeDefined();
      expect(roof.getObjectByName('SpanningMegaGirders')).toBeDefined();
      disposeObject3D(roof);
    });
  }

  it('adds steel with more girders and keeps the north half in cross-section', () => {
    const count = (n: number) => {
      const roof = generateRoofGroup(girderDoc('bowl_bowstring_60k', { girderCount: n }));
      const mesh = roof.getObjectByName('SpanningMegaGirders') as THREE.Mesh;
      const v = mesh.geometry.getAttribute('position').count;
      disposeObject3D(roof);
      return v;
    };
    expect(count(6)).toBeGreaterThan(count(2));

    const clipped = generateRoofGroup(girderDoc('bowl_bowstring_60k'), true);
    const box = new THREE.Box3().setFromObject(clipped.getObjectByName('RoofCanopySurface')!);
    expect(box.max.z).toBeLessThanOrEqual(0.01);
    disposeObject3D(clipped);
  });
});

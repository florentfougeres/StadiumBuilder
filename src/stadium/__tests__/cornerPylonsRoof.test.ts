import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D } from '../buildStadiumScene';
import { calculateStadiumMetrics } from '../capacity';
import { generateRoofGroup } from '../generateRoof';
import { createPresetDocument } from '../presets';
import { CORNER_PYLON_MAX_HEIGHT, resolveCornerPylonFrame, StadiumDocument } from '../schema';

function pylonDoc(presetId: string, patch: Partial<StadiumDocument['roof']> = {}): StadiumDocument {
  const doc = createPresetDocument(presetId);
  doc.roof = { ...doc.roof, style: 'corner_pylons', ...patch };
  return doc;
}

function vertexCount(roof: THREE.Object3D, name: string): number {
  const mesh = roof.getObjectByName(name) as THREE.Mesh | undefined;
  return mesh ? mesh.geometry.getAttribute('position').count : 0;
}

describe('corner mega-pylons roof', () => {
  it('keeps the pylons above the girders and within the height limit', () => {
    const roof = createPresetDocument('bowl_bowstring_60k').roof;
    const low = resolveCornerPylonFrame({ ...roof, pylonHeight: 1 }, 30);
    expect(low.pylonTopY).toBe(low.girderTopY + 2);
    expect(low.girderBotY).toBeGreaterThan(low.canopyY);
    const high = resolveCornerPylonFrame({ ...roof, pylonHeight: 500 }, 30);
    expect(high.pylonTopY).toBe(CORNER_PYLON_MAX_HEIGHT);
    const domed = resolveCornerPylonFrame({ ...roof, crownRise: 12 }, 30);
    expect(domed.girderBotY - low.girderBotY).toBe(12);
  });

  for (const presetId of ['bowl_bowstring_60k', 'olympic_masts_80k', 'traditional_four_stands_42k']) {
    it(`builds pylons, girders and hangers on ${presetId}`, () => {
      const roof = generateRoofGroup(pylonDoc(presetId));
      expect(roof.getObjectByName('RoofCanopySurface')).toBeDefined();
      expect(vertexCount(roof, 'CornerMegaPylons')).toBeGreaterThan(0);
      expect(vertexCount(roof, 'CornerMegaGirders')).toBeGreaterThan(0);
      expect(vertexCount(roof, 'CornerRoofHangers')).toBeGreaterThan(0);
      disposeObject3D(roof);
    });
  }

  it('adds the space frame lattice and reports the pylon height as roof height', () => {
    const plain = generateRoofGroup(pylonDoc('bowl_bowstring_60k'));
    const lattice = generateRoofGroup(pylonDoc('bowl_bowstring_60k', { spaceFrame: true, crownRise: 10 }));
    expect(vertexCount(lattice, 'CornerMegaGirders')).toBeGreaterThan(
      vertexCount(plain, 'CornerMegaGirders')
    );
    disposeObject3D(plain);
    disposeObject3D(lattice);

    const doc = pylonDoc('bowl_bowstring_60k', { pylonHeight: 75 });
    expect(calculateStadiumMetrics(doc).maxRoofHeight).toBeGreaterThanOrEqual(75);
  });

  it('keeps only the north half in cross-section', () => {
    const roof = generateRoofGroup(pylonDoc('bowl_bowstring_60k', { spaceFrame: true }), true);
    roof.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(roof.getObjectByName('CornerMegaPylons')!);
    expect(box.max.z).toBeLessThan(0);
    disposeObject3D(roof);
  });
});

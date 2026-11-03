import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D } from '../buildStadiumScene';
import { generateRoofGroup } from '../generateRoof';
import { createPresetDocument } from '../presets';
import { resolvePortalCount, StadiumDocument } from '../schema';

function portalDoc(presetId: string, patch: Partial<StadiumDocument['roof']> = {}): StadiumDocument {
  const doc = createPresetDocument(presetId);
  doc.roof = { ...doc.roof, style: 'concrete_portals', ...patch };
  return doc;
}

function ribs(roof: THREE.Object3D): THREE.Mesh {
  return roof.getObjectByName('ConcretePortalRibs') as THREE.Mesh;
}

describe('prestressed concrete portals roof', () => {
  it('clamps the portal count', () => {
    const roof = createPresetDocument('bowl_bowstring_60k').roof;
    expect(resolvePortalCount(roof)).toBe(50);
    expect(resolvePortalCount({ ...roof, portalCount: 5 })).toBe(24);
    expect(resolvePortalCount({ ...roof, portalCount: 200 })).toBe(72);
  });

  for (const presetId of ['bowl_bowstring_60k', 'olympic_masts_80k', 'traditional_four_stands_42k']) {
    it(`builds ribs from the ground over the canopy on ${presetId}`, () => {
      const roof = generateRoofGroup(portalDoc(presetId));
      const canopy = new THREE.Box3().setFromObject(roof.getObjectByName('RoofCanopySurface')!);
      const box = new THREE.Box3().setFromObject(ribs(roof));
      expect(box.min.y).toBeLessThan(0.01);
      expect(box.max.y).toBeGreaterThan(canopy.max.y);
      // Ribs stand outside the canopy footprint.
      expect(box.max.x).toBeGreaterThan(canopy.max.x);
      disposeObject3D(roof);
    });
  }

  it('scales the rib count and keeps the north half in cross-section', () => {
    const verts = (n: number) => {
      const roof = generateRoofGroup(portalDoc('bowl_bowstring_60k', { portalCount: n }));
      const v = ribs(roof).geometry.getAttribute('position').count;
      disposeObject3D(roof);
      return v;
    };
    expect(verts(60) / verts(30)).toBeCloseTo(2, 1);

    const clipped = generateRoofGroup(portalDoc('bowl_bowstring_60k'), true);
    expect(new THREE.Box3().setFromObject(ribs(clipped)).max.z).toBeLessThan(1);
    disposeObject3D(clipped);
  });
});

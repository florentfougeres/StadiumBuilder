import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D } from '../buildStadiumScene';
import { generateRoofGroup } from '../generateRoof';
import { createPresetDocument } from '../presets';
import {
  RETRACTABLE_PANEL_LIMITS,
  RetractableMotion,
  resolveRetractable,
  StadiumDocument,
} from '../schema';

const MOTIONS = Object.keys(RETRACTABLE_PANEL_LIMITS) as RetractableMotion[];
const MOVING_PARTS = new Set(['RetractableRoofLeaf', 'RetractableRoofMembrane']);

function retractableDoc(presetId: string, motion: RetractableMotion, openRatio: number): StadiumDocument {
  const doc = createPresetDocument(presetId);
  doc.roof.style = 'retractable';
  doc.roof.retractable = { motion, openRatio };
  return doc;
}

/** Whether a vertical ray at (x, z) hits a movable panel or membrane. */
function coveredAt(roof: THREE.Group, x: number, z: number): boolean {
  roof.updateMatrixWorld(true);
  const targets: THREE.Object3D[] = [];
  roof.traverse((o) => {
    if (MOVING_PARTS.has(o.name)) targets.push(o);
  });
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 500, z), new THREE.Vector3(0, -1, 0));
  return ray.intersectObjects(targets, false).length > 0;
}

describe('retractable roof motions', () => {
  it('maps the legacy open/closed flag and clamps panel counts', () => {
    const doc = createPresetDocument('mega_retractable_88k');
    doc.roof.retractable = undefined;
    doc.roof.retractableClosed = true;
    expect(resolveRetractable(doc.roof).openRatio).toBe(0);
    doc.roof.retractableClosed = false;
    expect(resolveRetractable(doc.roof).openRatio).toBe(1);
    doc.roof.retractable = { motion: 'iris', panelCount: 99 };
    expect(resolveRetractable(doc.roof).panelCount).toBe(RETRACTABLE_PANEL_LIMITS.iris.max);
    doc.roof.style = 'petal_iris';
    doc.roof.retractable = { motion: 'slide_off' };
    expect(resolveRetractable(doc.roof).motion).toBe('iris');
  });

  for (const presetId of ['bowl_bowstring_60k', 'olympic_masts_80k', 'traditional_four_stands_42k']) {
    for (const motion of MOTIONS) {
      it(`${motion} on ${presetId}: closed covers the centre, open clears the pitch`, () => {
        const closed = generateRoofGroup(retractableDoc(presetId, motion, 0));
        // Just off the centre: with an even panel count two leaves share an edge at x = 0, where a
        // ray hits or misses on rounding alone.
        expect(coveredAt(closed, 1.3, -1)).toBe(true);
        expect(coveredAt(closed, -20, 5)).toBe(true);
        disposeObject3D(closed);

        const half = generateRoofGroup(retractableDoc(presetId, motion, 0.5));
        expect(half.children.length).toBeGreaterThan(0);
        disposeObject3D(half);

        const open = generateRoofGroup(retractableDoc(presetId, motion, 1));
        // Rotating sectors stack over the east sector of the pitch by design.
        if (motion !== 'rotate_vertical') {
          expect(coveredAt(open, -20, 5)).toBe(false);
        }
        disposeObject3D(open);
      });
    }
  }

  it('petal_iris builds an iris roof with one pin per petal', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    doc.roof.style = 'petal_iris';
    doc.roof.retractable = { panelCount: 10, openRatio: 0.3 };
    const roof = generateRoofGroup(doc);
    let pins = 0;
    roof.traverse((o) => {
      if (o.name === 'RetractableRoofIrisPin') pins++;
    });
    expect(pins).toBe(10);
    disposeObject3D(roof);
  });

  it('builds the inclined suspension mast and the cross-section variant', () => {
    const doc = retractableDoc('bowl_bowstring_60k', 'fold_central', 0.4);
    doc.roof.retractable = { ...doc.roof.retractable, suspensionMast: true };
    const roof = generateRoofGroup(doc);
    expect(roof.getObjectByName('RetractableRoofInclinedMast')).toBeDefined();
    disposeObject3D(roof);
    for (const motion of MOTIONS) {
      const clipped = generateRoofGroup(retractableDoc('bowl_bowstring_60k', motion, 0.5), true);
      expect(clipped.children.length).toBeGreaterThan(0);
      disposeObject3D(clipped);
    }
  });
});

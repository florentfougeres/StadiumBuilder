import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateRoofGroup } from '../generateRoof';
import { createPresetDocument } from '../presets';
import { computeStadiumRingBounds } from '../roofs/ringBounds';

const SIDES = [
  ['east', 1, 0],
  ['west', -1, 0],
  ['south', 0, 1],
  ['north', 0, -1],
] as const;

describe('roof outer edge', () => {
  it('follows each stand of an asymmetric bowl instead of the deepest one', () => {
    const doc = createPresetDocument('stepped_cable_wheel_68k');
    const b = computeStadiumRingBounds(doc);
    for (const [, nx, nz] of SIDES) {
      const past = b.canopyOuterOffsetAt(nx, nz, 3.2) - b.standDepthAtNormal(nx, nz);
      expect(past).toBeCloseTo(3.2, 5);
    }
  });

  it('moves by roof.outerOverhang and never stops short of the stand backs', () => {
    const wideDoc = createPresetDocument('stepped_cable_wheel_68k');
    wideDoc.roof.outerOverhang = 6;
    const tightDoc = createPresetDocument('stepped_cable_wheel_68k');
    tightDoc.roof.outerOverhang = -40;
    const wide = computeStadiumRingBounds(wideDoc);
    const tight = computeStadiumRingBounds(tightDoc);
    for (const [, nx, nz] of SIDES) {
      const d = wide.standDepthAtNormal(nx, nz);
      expect(wide.canopyOuterOffsetAt(nx, nz, 3.2) - d).toBeCloseTo(9.2, 5);
      expect(tight.canopyOuterOffsetAt(nx, nz, 3.2) - d).toBeCloseTo(0.3, 5);
    }
  });
});

describe('roof downpipes', () => {
  it('run down their column instead of hanging to the ground from a column on a stand crest', () => {
    const roof = generateRoofGroup(createPresetDocument('stepped_cable_wheel_68k'));
    roof.updateMatrixWorld(true);
    const pipes = roof.getObjectByName('RoofDownpipes') as THREE.InstancedMesh;
    expect(pipes.count).toBeGreaterThan(0);
    const m = new THREE.Matrix4();
    const foot = new THREE.Vector3();
    for (let i = 0; i < pipes.count; i++) {
      pipes.getMatrixAt(i, m);
      foot.set(0, -0.5, 0).applyMatrix4(m);
      // These columns stand on the crest of a stand, 37 m up: their pipes end there too.
      expect(foot.y).toBeGreaterThan(30);
    }
  });
});

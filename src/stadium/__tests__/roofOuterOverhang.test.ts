import { describe, expect, it } from 'vitest';
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

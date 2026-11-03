import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D } from '../buildStadiumScene';
import { calculateStadiumMetrics, getTrackRadialOffset } from '../capacity';
import { generateRoofGroup } from '../generateRoof';
import { buildMovablePitch, buildVelodrome } from '../generateVelodrome';
import { createPresetDocument } from '../presets';
import { getCyclingTrackGeometry, isContinuousBowlShape } from '../schema';

describe('velodrome, movable pitch and heritage bowl', () => {
  it('pushes the stands back behind a banked cycling track', () => {
    const doc = createPresetDocument('traditional_four_stands_42k');
    const before = getTrackRadialOffset(doc);
    doc.pitch.cyclingTrack = true;
    const after = getTrackRadialOffset(doc);
    expect(after.sideOffset).toBeGreaterThan(before.sideOffset + 8);
    expect(after.endOffset).toBeGreaterThan(before.endOffset + 8);

    const g = getCyclingTrackGeometry(doc.pitch);
    expect(g.lapLength).toBeGreaterThan(300);
    // Pitch corners stay inside the inner edge of the bends.
    const cornerX = doc.pitch.length / 2 + doc.pitch.marginEnd - g.straightHalfLength;
    const cornerZ = doc.pitch.width / 2 + doc.pitch.marginSide;
    expect(Math.hypot(Math.max(0, cornerX), cornerZ)).toBeLessThanOrEqual(g.innerRadius + 1e-6);
  });

  it('banks the bends higher with a steeper banking', () => {
    const doc = createPresetDocument('olympic_masts_80k');
    doc.pitch.cyclingTrack = true;
    const top = (banking: number) => {
      doc.pitch.cyclingBanking = banking;
      const v = buildVelodrome(doc.pitch, false);
      const y = new THREE.Box3().setFromObject(v.getObjectByName('VelodromeSurface')!).max.y;
      disposeObject3D(v);
      return y;
    };
    expect(top(45)).toBeGreaterThan(top(25) + 2);
  });

  it('lifts and slides the movable pitch tray', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    const map = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    doc.pitch.movablePitch = 'half_lift';
    doc.pitch.movablePitchState = 0;
    expect(buildMovablePitch(doc.pitch, map, 110, 72)).toBeNull();
    doc.pitch.movablePitchState = 0.5;
    const lifted = buildMovablePitch(doc.pitch, map, 110, 72)!;
    expect(lifted.getObjectByName('PitchTray')!.position.y).toBeCloseTo(6);
    doc.pitch.movablePitchState = 1;
    const parked = buildMovablePitch(doc.pitch, map, 110, 72)!;
    expect(parked.getObjectByName('PitchTray')!.position.x).toBeCloseTo(-27.5);
    doc.pitch.movablePitch = 'slide_out';
    const out = buildMovablePitch(doc.pitch, map, 110, 72)!;
    expect(out.getObjectByName('PitchTray')!.position.x).toBeGreaterThan(110);
    [lifted, parked, out].forEach(disposeObject3D);
  });

  it('builds a 1930s heritage bowl around a cycling track', () => {
    const doc = createPresetDocument('olympic_masts_80k');
    doc.shape = 'heritage_bowl';
    doc.pitch.hasTrack = false;
    doc.pitch.cyclingTrack = true;
    doc.roof = { ...doc.roof, style: 'cantilever', coveredSides: ['north'] };
    expect(isContinuousBowlShape(doc.shape)).toBe(true);
    expect(calculateStadiumMetrics(doc).totalCapacity).toBeGreaterThan(10000);
    const roof = generateRoofGroup(doc);
    expect(roof.children.length).toBeGreaterThan(0);
    disposeObject3D(roof);
  });
});

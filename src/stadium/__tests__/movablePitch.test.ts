import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D } from '../buildStadiumScene';
import { buildMovablePitch } from '../generateMovablePitch';
import { calculateStadiumMetrics } from '../capacity';
import { BLANK_PRESET_ID, createBlankDocument, createPresetDocument } from '../presets';
import { normalizeStadiumDocument } from '../../state/useStadiumStore';

describe('movable pitch', () => {
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

  it('opens saved 1930s cycling-track projects as an olympic oval', () => {
    const doc = createPresetDocument('olympic_masts_80k');
    Object.assign(doc, { shape: 'heritage_bowl' });
    Object.assign(doc.pitch, { cyclingTrack: true, cyclingBanking: 38 });
    const clean = normalizeStadiumDocument(doc);
    expect(clean.shape).toBe('olympic_oval');
    expect('cyclingTrack' in clean.pitch).toBe(false);
    expect('cyclingBanking' in clean.pitch).toBe(false);
  });

  it('starts a blank project as a small uncovered ground with nothing around it', () => {
    const doc = createBlankDocument();
    expect(doc.presetId).toBe(BLANK_PRESET_ID);
    expect(doc.roof.style).toBe('none');
    expect(doc.objects).toHaveLength(0);
    expect(doc.concourse?.width).toBe(0);
    const capacity = calculateStadiumMetrics(doc).totalCapacity;
    expect(capacity).toBeGreaterThan(1000);
    expect(capacity).toBeLessThan(12000);
  });
});

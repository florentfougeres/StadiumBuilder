import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D } from '../buildStadiumScene';
import { buildMovablePitch } from '../generateMovablePitch';
import { createPresetDocument } from '../presets';
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
});

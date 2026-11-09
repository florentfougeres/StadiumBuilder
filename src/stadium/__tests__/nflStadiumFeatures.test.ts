import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildStadiumSceneGraph } from '../buildStadiumScene';
import { createPresetDocument } from '../presets';
import {
  clampPitchToTrack,
  getEffectiveSunkenDepth,
  patchPitch,
  GRIDIRON_LENGTH_M,
  GRIDIRON_WIDTH_M,
  resolveHaloSize,
  type StadiumDocument,
} from '../schema';

/** Textures are drawn on a canvas: any 2D call is a no-op here. */
if (typeof document === 'undefined') {
  const noop = () => ({ addColorStop: () => {}, width: 0 });
  const context = new Proxy({}, { get: () => noop, set: () => true });
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({ width: 1024, height: 512, getContext: () => context }),
  };
}

const scene = (doc: StadiumDocument) => buildStadiumSceneGraph(doc, { maxAnisotropy: 1 }).rootGroup;
const count = (root: THREE.Object3D, name: string) => {
  let n = 0;
  root.traverse((o) => {
    if (o.name === name) n++;
  });
  return n;
};

describe('features from the NFL stadium analysis', () => {
  it('locks a gridiron to 120 × 53⅓ yards and gives it goal posts instead of goals', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    doc.pitch = clampPitchToTrack({ ...doc.pitch, sport: 'american_football', endZoneText: 'Home' });
    expect(doc.pitch.length).toBeCloseTo(109.73, 2);
    expect(doc.pitch.width).toBeCloseTo(48.77, 2);

    const root = scene(doc);
    expect(count(root, 'GridironGoalPost')).toBe(2);
    const post = root.getObjectByName('GridironGoalPost')!;
    const box = new THREE.Box3().setFromObject(post);
    expect(box.max.y).toBeGreaterThan(13.5);
  });

  it('restores a soccer pitch when leaving the gridiron', () => {
    const soccer = createPresetDocument('bowl_bowstring_60k').pitch;
    const gridiron = patchPitch(soccer, { sport: 'american_football' });
    expect(gridiron.width).toBe(GRIDIRON_WIDTH_M);
    expect(gridiron.length).toBe(GRIDIRON_LENGTH_M);
    const back = patchPitch(gridiron, { sport: 'football' });
    expect([back.length, back.width]).toEqual([105, 68]);
  });

  it('hangs a four-sided box board over midfield', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    doc.objects.push({
      id: 'board',
      type: 'halo_screen',
      name: 'Écran central',
      position: [0, 30, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      haloShape: 'box',
      haloDiameter: 50,
      haloBandHeight: 22,
    });
    const { rx, rz, bandHeight } = resolveHaloSize(doc.objects.at(-1)!);
    expect(rx).toBe(25);
    expect(rz).toBeCloseTo(8, 1);
    expect(bandHeight).toBe(22);
    expect(() => scene(doc)).not.toThrow();
  });

  it('digs a field 30 m below the street', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    doc.sunkenDepth = 30;
    expect(getEffectiveSunkenDepth(doc)).toBe(30);
    doc.sunkenDepth = 45;
    expect(getEffectiveSunkenDepth(doc)).toBe(30);
  });

  it('closes one end with a giant glass wall that opens', () => {
    const doc = createPresetDocument('gridiron_arches_70k');
    const shut = scene({ ...doc, roof: { ...doc.roof, glassWall: { side: 'west', motion: 'pivot', openRatio: 0 } } });
    const doors = count(shut, 'GlassWallDoor');
    expect(doors).toBeGreaterThanOrEqual(3);
    const open = scene({ ...doc, roof: { ...doc.roof, glassWall: { side: 'west', motion: 'pivot', openRatio: 1 } } });
    const yaw = (root: THREE.Object3D) => root.getObjectByName('GlassWallDoor')!.rotation.y;
    expect(Math.abs(yaw(open) - yaw(shut))).toBeGreaterThan(1.3);
  });

  it('carries the roof on over the forecourt on columns', () => {
    const doc = createPresetDocument('climatic_dome_72k');
    doc.roof.forecourtCanopy = { side: 'south', depth: 50 };
    const canopy = scene(doc).getObjectByName('ForecourtCanopy')!;
    expect(canopy).toBeTruthy();
    const box = new THREE.Box3().setFromObject(canopy);
    expect(box.max.z - box.min.z).toBeGreaterThan(50);
  });

  it('pitches sliding panels up to a central ridge', () => {
    const doc = createPresetDocument('sliding_roof_arena_50k');
    const top = (pitchDeg: number) => {
      doc.roof.retractable = { ...doc.roof.retractable, motion: 'slide_transverse', panelCount: 2, openRatio: 0, pitchDeg };
      return new THREE.Box3().setFromObject(scene(doc).getObjectByName('RetractableRoofPanels')!).max.y;
    };
    expect(top(15) - top(0)).toBeGreaterThan(5);
  });

  it('builds a Doric portico, washed louvres, a green roof and themed landmarks', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    doc.concourse = { width: 0, heightRatio: 0.5 };
    doc.materials = { ...doc.materials!, envelopeStyle: 'colonnade_forest', colonnadeShape: 'doric' };
    const doric = scene(doc);
    expect((doric.getObjectByName('EnvelopeDoricColumns') as THREE.InstancedMesh).count).toBeGreaterThan(10);
    expect(count(doric, 'EnvelopeTriglyphs')).toBeGreaterThan(0);

    doc.concourse = { width: 8, heightRatio: 0.6 };
    doc.lighting = 'night';
    doc.materials = { ...doc.materials!, envelopeStyle: 'louver_curtain', facadeGlowHex: '#2563eb', roof: 'green_roof' };
    expect(count(scene(doc), 'EnvelopeLightWash')).toBeGreaterThan(0);

    doc.objects = (['lighthouse', 'galleon'] as const).map((type) => ({
      id: type,
      type,
      name: type,
      position: [0, 0, -150] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    }));
    const root = scene(doc);
    expect(count(root, 'Lighthouse')).toBe(1);
    expect(count(root, 'Galleon')).toBe(1);
  });
});

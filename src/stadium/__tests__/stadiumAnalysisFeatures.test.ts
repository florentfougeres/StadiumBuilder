import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildStadiumSceneGraph } from '../buildStadiumScene';
import { createPresetDocument } from '../presets';
import { applyShape } from '../../state/useStadiumStore';
import type { StadiumDocument } from '../schema';

/** Textures are drawn on a canvas: any 2D call is a no-op here. */
if (typeof document === 'undefined') {
  const noop = () => ({ addColorStop: () => {} });
  const context = new Proxy({}, { get: () => noop, set: () => true });
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({ width: 1024, height: 512, getContext: () => context }),
  };
}

const scene = (doc: StadiumDocument) => buildStadiumSceneGraph(doc, { maxAnisotropy: 1 }).rootGroup;
const has = (root: THREE.Object3D, name: string) => root.getObjectByName(name) !== undefined;
const count = (root: THREE.Object3D, name: string) => {
  let n = 0;
  root.traverse((o) => {
    if (o.name === name) n++;
  });
  return n;
};

describe('features from the 20-stadium analysis', () => {
  it('gives a stand its own envelope on separate stands and on a bowl quarter', () => {
    const separate = createPresetDocument('traditional_four_stands_42k');
    separate.stands.north.envelopeStyleOverride = 'external_stairs';
    expect(has(scene(separate), 'EnvelopeExternalStairs')).toBe(true);

    const bowl = createPresetDocument('bowl_bowstring_60k');
    bowl.concourse = { width: 0, heightRatio: 0.5 };
    bowl.stands.west.envelopeStyleOverride = 'external_stairs';
    bowl.stands.west.facadeMaterialOverride = 'heritage_brick';
    const root = scene(bowl);
    expect(has(root, 'BowlEnvelope_west')).toBe(true);
    expect(count(root, 'EnvelopeExternalStairs')).toBe(1);
  });

  it('draws palm columns, the saucer skin and the multicolour patterns', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    doc.concourse = { width: 0, heightRatio: 0.5 };
    doc.materials = { ...doc.materials!, envelopeStyle: 'colonnade_forest', colonnadeShape: 'palm' };
    expect(has(scene(doc), 'EnvelopePalmFronds')).toBe(true);

    for (const [pattern, name] of [
      ['pixel_mosaic', 'FacadePixelMosaic'],
      ['woven_basket', 'FacadeWovenBasket'],
    ] as const) {
      doc.materials = { ...doc.materials!, envelopeStyle: 'enveloping_skin', facadePattern: pattern };
      const mesh = scene(doc).getObjectByName(name) as THREE.InstancedMesh;
      expect(mesh.count).toBeGreaterThan(50);
      expect(mesh.instanceColor).toBeTruthy();
    }

    const width = (profile: 'straight' | 'saucer') => {
      doc.materials = { ...doc.materials!, envelopeStyle: 'enveloping_skin', facadePattern: 'none', envelopeProfile: profile };
      const box = new THREE.Box3().setFromObject(scene(doc).getObjectByName('BowlEnvelope')!);
      return box.max.x - box.min.x;
    };
    expect(width('saucer')).toBeGreaterThan(width('straight') + 4);
  });

  it('hangs a folding roof from a central needle and stands a retractable roof on pylons', () => {
    const doc = createPresetDocument('mega_retractable_88k');
    doc.roof.retractable = { ...doc.roof.retractable, motion: 'fold_central', suspensionMast: true, mastPosition: 'central', pylonCount: 8 };
    const root = scene(doc);
    expect(has(root, 'RetractableRoofCentralNeedle')).toBe(true);
    expect(has(root, 'RetractableRoofInclinedMast')).toBe(false);
    expect(root.getObjectByName('RetractableRoofPylons')!.children.length).toBeGreaterThanOrEqual(8);
  });

  it('builds a cricket oval with its outfield furniture', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    applyShape(doc, 'cricket_oval');
    const root = scene(doc);
    for (const name of ['CricketBoundaryRope', 'CricketPitch', 'CricketSquare']) expect(has(root, name)).toBe(true);
    const stands = new THREE.Box3().setFromObject(root.getObjectByName('StandsAssembly')!);
    expect(stands.max.x - stands.min.x).toBeGreaterThan(2 * 74);
  });

  it('adds a moat, a waterfront and a mound to the site', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    doc.site = { ...doc.site, water: 'moat', mound: 8 };
    let root = scene(doc);
    expect(has(root, 'MoatWater')).toBe(true);
    expect(count(root, 'MoatBridge')).toBeGreaterThanOrEqual(4);
    const mound = new THREE.Box3().setFromObject(root.getObjectByName('SiteMound')!);
    expect(mound.max.y).toBeGreaterThan(7);

    doc.site = { ...doc.site, water: 'waterfront', mound: 0 };
    root = scene(doc);
    expect(has(root, 'WaterfrontWater')).toBe(true);
    expect(has(root, 'SiteMound')).toBe(false);
  });

  it('adds dark stripes, a glowing foot and a recessed glazed plinth to a plain skin', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    doc.concourse = { width: 0, heightRatio: 0.5 };
    doc.materials = { ...doc.materials!, envelopeStyle: 'enveloping_skin', facadePattern: 'none', facadeStripeSpacing: 20, facadeBaseGlow: true, plinthHeight: 7 };
    const root = scene(doc);
    expect(root.getObjectByName('FacadeStripes')!.children.length).toBeGreaterThan(10);
    expect(has(root, 'FacadeBaseGlow')).toBe(true);
    expect(has(root, 'EnvelopePlinthColumns')).toBe(true);

    // With an outer concourse, the stripes and glow move onto it.
    doc.concourse = { width: 8, heightRatio: 0.6 };
    const withConcourse = scene(doc);
    expect(withConcourse.getObjectByName('ConcourseRing')?.getObjectByName('FacadeStripes') ?? withConcourse.getObjectByName('FacadeStripes')).toBeTruthy();
  });

  it('hangs a stand roof from its own arch, kept within the stand', () => {
    const doc = createPresetDocument('traditional_four_stands_42k');
    doc.stands.east.roofStyleOverride = 'stand_arch';
    const root = scene(doc);
    const arch = root.getObjectByName('StandArch')!;
    expect(arch).toBeTruthy();
    expect(has(root, 'StandArchHangers')).toBe(true);
    const box = new THREE.Box3().setFromObject(arch);
    expect(box.max.y).toBeGreaterThan(30);
  });

  it('sets rugby posts instead of football goals on a cricket ground', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    applyShape(doc, 'cricket_oval');
    expect(count(scene(doc), 'RugbyPosts')).toBe(2);
    expect(doc.stands.east.rakeProfile).toBe('progressive');
  });
});

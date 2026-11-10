import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildStadiumSceneGraph } from '../buildStadiumScene';
import { calculateStadiumMetrics } from '../capacity';
import { createPresetDocument } from '../presets';
import { mosaicColourIndex } from '../parametricFacade';
import { resolveSeats3d, resolveSuspendedMasts, type StadiumDocument } from '../schema';

/** Textures are drawn on a canvas: any 2D call is a no-op here. */
if (typeof document === 'undefined') {
  const noop = () => ({ addColorStop: () => {}, width: 0 });
  const context = new Proxy({}, { get: () => noop, set: () => true });
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({ width: 1024, height: 512, getContext: () => context }),
  };
}

const scene = (doc: StadiumDocument) => buildStadiumSceneGraph(doc, { maxAnisotropy: 1 }).rootGroup;
const find = (root: THREE.Object3D, name: string) => root.getObjectByName(name);

/** Triangles of the non-instanced meshes, to compare a bowl before and after a cut. */
function triangles(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
    const index = mesh.geometry?.index;
    if (index) n += index.count / 3;
  });
  return n;
}

describe('features from the European stadium analysis', () => {
  it('grades the mosaic palette from the foot to the top', () => {
    const rows = 20;
    const foot = Array.from({ length: 30 }, (_, c) => mosaicColourIndex(c, 0, rows, 4, true));
    const top = Array.from({ length: 30 }, (_, c) => mosaicColourIndex(c, rows - 1, rows, 4, true));
    expect(Math.max(...foot)).toBeLessThanOrEqual(1);
    expect(Math.min(...top)).toBeGreaterThanOrEqual(2);
  });

  it('builds square stone piers', () => {
    const doc = createPresetDocument('sunken_colonnade_44k');
    doc.materials = { ...doc.materials!, envelopeStyle: 'colonnade_forest', colonnadeShape: 'square' };
    doc.concourse = { width: 0, heightRatio: 0.5 };
    expect(find(scene(doc), 'EnvelopeSquarePiers')).toBeDefined();
  });

  it('drops the seats on stone benches', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    doc.materials = { ...doc.materials!, seatFinish: 'stone_bench' };
    expect(resolveSeats3d(doc.materials)).toBe(false);
    expect(() => scene(doc)).not.toThrow();
  });

  it('stands a two-pylon mast roof on fans of stays', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    doc.roof = { ...doc.roof, style: 'suspended_masts', mastCount: 2 };
    expect(resolveSuspendedMasts(doc.roof).mastCount).toBe(2);
    expect(() => scene(doc)).not.toThrow();
  });

  it('runs a 360° screen under the roof edge', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    doc.roof = { ...doc.roof, style: 'cantilever' };
    doc.objects.push({
      id: 'edge',
      type: 'halo_screen',
      name: 'Edge',
      position: [0, 30, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      haloShape: 'roof_edge',
    });
    const band = find(scene(doc), 'RoofEdgeLedBand');
    expect(band).toBeDefined();
    const box = new THREE.Box3().setFromObject(band!);
    expect(box.max.x - box.min.x).toBeGreaterThan(100);
  });

  it('slides the movable panels of a giant arch roof over the pitch when closed', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    doc.roof = { ...doc.roof, style: 'giant_arch', archMovablePanels: true, retractable: { openRatio: 0 } };
    const closed = new THREE.Box3().setFromObject(find(scene(doc), 'ArchMovablePanels')!);
    doc.roof = { ...doc.roof, retractable: { openRatio: 1 } };
    const open = new THREE.Box3().setFromObject(find(scene(doc), 'ArchMovablePanels')!);
    // Panels of the south side: closed, their front edge is nearer the halfway line.
    const nearest = (b: THREE.Box3) => Math.min(Math.abs(b.min.z), Math.abs(b.max.z));
    expect(closed.isEmpty()).toBe(false);
    expect(open.isEmpty()).toBe(false);
    expect(closed.getSize(new THREE.Vector3()).z).toBeGreaterThan(open.getSize(new THREE.Vector3()).z - 1e-6);
    expect(nearest(closed)).toBeLessThanOrEqual(nearest(open));
  });

  it('adds a tower and a footbridge', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    for (const type of ['tower', 'footbridge'] as const) {
      doc.objects.push({ id: type, type, name: type, position: [-170, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    }
    const root = scene(doc);
    expect(find(root, 'Tower')).toBeDefined();
    expect(find(root, 'Footbridge')).toBeDefined();
  });

  it('cuts a breach through the ring and petals into the upper tiers', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    expect(doc.stands.south.tiers).toBeGreaterThanOrEqual(2);
    const whole = triangles(scene(doc));
    doc.ringBreach = { side: 'west', width: 30 };
    expect(triangles(scene(doc))).not.toBe(whole);
    delete doc.ringBreach;
    doc.upperRingGaps = { count: 26, width: 6 };
    expect(triangles(scene(doc))).not.toBe(whole);
  });

  it('counts the seats a ring breach and petal gaps take away', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    const whole = calculateStadiumMetrics(doc);
    doc.ringBreach = { side: 'west', width: 30 };
    const breached = calculateStadiumMetrics(doc);
    expect(breached.totalCapacity).toBeLessThan(whole.totalCapacity);
    // Only the breached stand loses seats.
    expect(breached.stands.east.capacity).toBe(whole.stands.east.capacity);
    delete doc.ringBreach;
    doc.upperRingGaps = { count: 26, width: 6 };
    expect(calculateStadiumMetrics(doc).totalCapacity).toBeLessThan(whole.totalCapacity * 0.9);
  });
});

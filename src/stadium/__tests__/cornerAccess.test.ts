import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { calculateStadiumMetrics } from '../capacity';
import { generateStandsGroup } from '../generateStand';
import { computeStandSection } from '../sightlines';
import { createPresetDocument } from '../presets';
import { CornerId, StadiumDocument, StadiumShape } from '../schema';

/** Textures are drawn on a canvas: any 2D call is a no-op here. */
if (typeof document === 'undefined') {
  const noop = () => ({ addColorStop: () => {} });
  const context = new Proxy({}, { get: () => noop, set: () => true });
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({ width: 1024, height: 512, getContext: () => context }),
  };
}

const ALL: CornerId[] = ['nw', 'ne', 'sw', 'se'];

function withAccess(doc: StadiumDocument): StadiumDocument {
  return { ...doc, cornerAccess: { nw: true, ne: true, sw: true, se: true } };
}

function count(root: THREE.Object3D, name: string): number {
  let n = 0;
  root.traverse((o) => {
    if (o.name === name) n++;
  });
  return n;
}

function seatCount(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) n += o.count;
  });
  return n;
}

describe('corner vehicle access', () => {
  it('carves a tunnel under each seated corner of a continuous bowl', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    const plain = generateStandsGroup(doc);
    const open = generateStandsGroup(withAccess(doc));
    expect(count(open, 'CornerVehicleTunnel')).toBe(4);
    expect(count(open, 'CornerTunnelDeck')).toBe(4);
    expect(seatCount(open)).toBeLessThan(seatCount(plain));
    expect(calculateStadiumMetrics(withAccess(doc)).totalCapacity).toBeLessThan(
      calculateStadiumMetrics(doc).totalCapacity
    );
  });

  it('carves a tunnel under the seated corners of separate stands', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    doc.shape = 'compact_urban';
    doc.corners = { nw: 'filled', ne: 'filled', sw: 'filled', se: 'filled' };
    const group = generateStandsGroup(withAccess(doc));
    expect(count(group, 'CornerVehicleTunnel')).toBe(4);
  });

  it('adds nothing to open corners', () => {
    const doc = createPresetDocument('traditional_four_stands_42k');
    doc.shape = 'four_stands';
    doc.corners = Object.fromEntries(ALL.map((c) => [c, 'open'])) as StadiumDocument['corners'];
    const group = generateStandsGroup(withAccess(doc));
    expect(count(group, 'CornerVehicleTunnel')).toBe(0);
  });

  it('leaves corners alone without the option', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    const group = generateStandsGroup(doc);
    expect(count(group, 'CornerVehicleTunnel')).toBe(0);
  });
});

describe('first row height', () => {
  it('raises the whole stand above a taller front wall', () => {
    const doc = createPresetDocument('traditional_four_stands_42k');
    const low = computeStandSection(doc.stands.south);
    const high = computeStandSection({ ...doc.stands.south, elevationStart: 4 });
    expect(high.rows[0].y).toBeCloseTo(4);
    // Every row is lifted, and rows set higher need taller risers to see over the row in front.
    expect(high.topHeight - low.topHeight).toBeGreaterThanOrEqual(4 - doc.stands.south.elevationStart - 1e-6);
  });

  it.each<StadiumShape>(['modern_bowl', 'saddle_bowl', 'four_stands'])(
    'builds %s with raised first rows',
    (shape) => {
      const doc = createPresetDocument('bowl_bowstring_60k');
      doc.shape = shape;
      for (const s of Object.values(doc.stands)) s.elevationStart = 3.5;
      const group = generateStandsGroup(doc);
      const box = new THREE.Box3().setFromObject(group);
      expect(Number.isFinite(box.max.y)).toBe(true);
    }
  );
});

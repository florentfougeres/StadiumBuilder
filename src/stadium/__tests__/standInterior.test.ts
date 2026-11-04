import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { calculateStadiumMetrics } from '../capacity';
import { generateStandsGroup } from '../generateStand';
import { computeStandSection, computeStandSightlines } from '../sightlines';
import { createPresetDocument } from '../presets';
import { StadiumDocument, StadiumShape, StandSide } from '../schema';

/** Textures are drawn on a canvas: any 2D call is a no-op here. */
if (typeof document === 'undefined') {
  const noop = () => ({ addColorStop: () => {} });
  const context = new Proxy({}, { get: () => noop, set: () => true });
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({ width: 1024, height: 512, getContext: () => context }),
  };
}

const SIDES: StandSide[] = ['north', 'south', 'east', 'west'];

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
    if (o.name === 'Seats' && o instanceof THREE.InstancedMesh) n += o.count;
  });
  return n;
}

function docOf(shape: StadiumShape): StadiumDocument {
  const doc = createPresetDocument('traditional_four_stands_42k');
  doc.shape = shape;
  doc.objects = [];
  return doc;
}

describe('progressive rake', () => {
  it('keeps the tier height, flatter at the front and steeper at the back', () => {
    const stand = createPresetDocument('traditional_four_stands_42k').stands.south;
    const flat = computeStandSection({ ...stand, tiers: 1, tierConfigs: undefined });
    const prog = computeStandSection({ ...stand, tiers: 1, tierConfigs: undefined, rakeProfile: 'progressive' });
    expect(prog.endY).toBeCloseTo(flat.endY, 3);
    expect(prog.rows[0].riser).toBeLessThan(prog.rows[prog.rows.length - 2].riser);
  });

  it('evens out the C-values along the stand', () => {
    const stand = { ...createPresetDocument('traditional_four_stands_42k').stands.south, tiers: 1 as const, tierConfigs: undefined };
    const flat = computeStandSightlines(stand);
    const prog = computeStandSightlines({ ...stand, rakeProfile: 'progressive' });
    const spread = (p: typeof flat.points) => Math.max(...p.slice(1).map((x) => x.cValueMm)) - Math.min(...p.slice(1).map((x) => x.cValueMm));
    expect(spread(prog.points)).toBeLessThan(spread(flat.points));
  });
});

describe('cross aisle', () => {
  it('sets the rows behind it back and up over a wall', () => {
    const stand = createPresetDocument('traditional_four_stands_42k').stands.south;
    const plain = computeStandSection(stand);
    const aisled = computeStandSection({ ...stand, crossAisle: true, crossAisleWidth: 2 });
    const k = aisled.rows.findIndex((r) => r.crossAisle);
    expect(k).toBeGreaterThan(2);
    expect(aisled.rows[k].d - plain.rows[k].d).toBeCloseTo(2);
    expect(aisled.rows[k].y - plain.rows[k].y).toBeCloseTo(1);
    expect(aisled.rows).toHaveLength(plain.rows.length);
  });

  it.each<StadiumShape>(['four_stands', 'modern_bowl', 'compact_urban'])('builds on %s', (shape) => {
    const doc = docOf(shape);
    for (const side of SIDES) Object.assign(doc.stands[side], { crossAisle: true, rakeProfile: 'progressive' });
    const group = generateStandsGroup(doc);
    expect(seatCount(group)).toBeGreaterThan(1000);
  });
});

describe('dugouts, press box and fence', () => {
  it.each<StadiumShape>(['four_stands', 'modern_bowl'])('dresses the main stand of %s', (shape) => {
    const doc = docOf(shape);
    const plain = generateStandsGroup(doc);
    Object.assign(doc.stands.south, { dugouts: true, pressBox: true });
    doc.frontFence = 'mesh';
    const group = generateStandsGroup(doc);
    expect(count(group, 'Dugout')).toBe(2);
    expect(count(group, 'PressBox')).toBe(1);
    expect(count(group, 'PitchFence')).toBeGreaterThan(0);
    expect(seatCount(group)).toBeLessThan(seatCount(plain));
  });

  it('leaves the capacity model alone', () => {
    const doc = docOf('four_stands');
    const before = calculateStadiumMetrics(doc).totalCapacity;
    Object.assign(doc.stands.south, { dugouts: true });
    doc.frontFence = 'mesh';
    expect(calculateStadiumMetrics(doc).totalCapacity).toBe(before);
  });
});

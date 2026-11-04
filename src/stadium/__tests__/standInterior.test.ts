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

  it('takes several per tier, and on any tier', () => {
    const stand = { ...createPresetDocument('traditional_four_stands_42k').stands.south, tiers: 2 as const };
    const plain = computeStandSection(stand);
    const aisled = computeStandSection({
      ...stand,
      crossAisles: [
        { tier: 0, ratio: 0.3, width: 1.5 },
        { tier: 0, ratio: 0.7, width: 1.5 },
        { tier: 1, ratio: 0.5, width: 2 },
      ],
    });
    const at = aisled.rows.flatMap((r, i) => (r.crossAisle ? [[r.tierIdx, i]] : []));
    expect(at.map(([t]) => t)).toEqual([0, 0, 1]);
    expect(at[1][1] - at[0][1]).toBeGreaterThanOrEqual(3);
    expect(aisled.rows).toHaveLength(plain.rows.length);
  });

  it('drops an aisle too close to another', () => {
    const stand = createPresetDocument('traditional_four_stands_42k').stands.south;
    const section = computeStandSection({
      ...stand,
      crossAisles: [
        { tier: 0, ratio: 0.5, width: 1.8 },
        { tier: 0, ratio: 0.52, width: 1.8 },
      ],
    });
    expect(section.rows.filter((r) => r.crossAisle)).toHaveLength(1);
  });

  it('reads the legacy single aisle', () => {
    const stand = createPresetDocument('traditional_four_stands_42k').stands.south;
    const legacy = computeStandSection({ ...stand, crossAisle: true, crossAisleRatio: 0.4, crossAisleWidth: 2 });
    const list = computeStandSection({ ...stand, crossAisles: [{ tier: 0, ratio: 0.4, width: 2 }] });
    expect(legacy.rows.map((r) => r.crossAisle)).toEqual(list.rows.map((r) => r.crossAisle));
  });

  it('stops the aisle handrails at each one', () => {
    const doc = docOf('four_stands');
    for (const side of SIDES) doc.stands[side].crossAisles = [{ tier: 0, ratio: 0.5, width: 1.2 }];
    // Rail bars join the next row (~1 m); one spanning a walkway and its wall would be over 2 m.
    // (On a bowl, a bar may bridge a row left out by a vomitory, as long, so only stands are checked.)
    let longest = 0;
    const m = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    generateStandsGroup(doc).traverse((o) => {
      if (o.name !== 'AisleHandrails') return;
      const mesh = o as THREE.InstancedMesh;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        m.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
        longest = Math.max(longest, scale.y);
      }
    });
    expect(longest).toBeGreaterThan(0);
    expect(longest).toBeLessThan(1.8);
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

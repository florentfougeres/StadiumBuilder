import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { sampleRoundedBowlRing } from '../bowlRing';
import {
  bowlMixAtNormal,
  bowlMixAtT,
  bowlSectionAt,
  bowlStepJunctions,
  buildBowlSectionModel,
} from '../bowlSection';
import { computeStadiumRingBounds } from '../roofs/ringBounds';
import { generateStandsGroup } from '../generateStand';
import { createPresetDocument } from '../presets';
import { StadiumDocument, StandSide } from '../schema';
import { computeStandSection } from '../sightlines';
import { applyShape } from '../../state/useStadiumStore';

/** Textures are drawn on a canvas: any 2D call is a no-op here. */
function ensureCanvasMock() {
  if (typeof document !== 'undefined') return;
  const noop = () => ({ addColorStop: () => {} });
  const context = new Proxy({}, { get: () => noop, set: () => true });
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({ width: 1024, height: 512, getContext: () => context }),
  };
}

/** A bowl with a tall three-tier main stand, a two-tier opposite side and low one-tier ends. */
function unevenBowl(shape: StadiumDocument['shape'] = 'modern_bowl'): StadiumDocument {
  const doc = createPresetDocument('traditional_four_stands_42k');
  applyShape(doc, shape);
  doc.objects = [];
  const { rowDepth, riserHeight, elevationStart } = doc.stands.south;
  const set = (side: StandSide, rows: number, tiers: 1 | 2 | 3) => {
    doc.stands[side] = {
      ...doc.stands[side],
      enabled: true,
      rows,
      tiers,
      tierConfigs: undefined,
      rowDepth,
      riserHeight,
      elevationStart,
    };
  };
  set('south', 52, 3);
  set('north', 30, 2);
  set('east', 18, 1);
  set('west', 18, 1);
  return doc;
}

function ringOf(doc: StadiumDocument) {
  return computeStadiumRingBounds(doc).ring;
}

/** Seat treads of a section that still hold a row (depth over 5 cm), as [depth, level] feet. */
function treadLevels(model: ReturnType<typeof buildBowlSectionModel>, pts: [number, number][]) {
  return model.treadSeg.map((rows) =>
    rows
      .filter((seg) => pts[seg + 1][0] - pts[seg][0] > 0.05)
      .map((seg) => pts[seg][1])
  );
}

describe('continuous bowl sections', () => {
  it('gives each stand its own exact section along its side', () => {
    const doc = unevenBowl();
    const model = buildBowlSectionModel(doc, false);
    for (const [side, mix] of [
      ['south', { a: 'east', b: 'south', f: 1 }],
      ['east', { a: 'east', b: 'north', f: 0 }],
      ['north', { a: 'west', b: 'north', f: 1 }],
    ] as const) {
      const section = computeStandSection(doc.stands[side]);
      const sample = bowlSectionAt(model, mix);
      expect(sample.topHeight).toBeCloseTo(section.topHeight, 6);
      expect(sample.outerD).toBeCloseTo(section.totalDepth, 6);
      const levels = treadLevels(model, sample.pts).flat();
      expect(levels).toHaveLength(section.rows.length);
      levels.forEach((y, i) => expect(y).toBeCloseTo(section.rows[i].y, 6));
    }
  });

  it('keeps every row level across a corner instead of stretching the rows', () => {
    const doc = unevenBowl();
    const model = buildBowlSectionModel(doc, false);
    const main = computeStandSection(doc.stands.south);
    const end = computeStandSection(doc.stands.east);
    // East and south both have their first rows on the same rake: those rows stay put.
    let prevTop = Infinity;
    for (let i = 0; i <= 40; i++) {
      const f = 1 - i / 40;
      const sample = bowlSectionAt(model, { a: 'east', b: 'south', f });
      const levels = treadLevels(model, sample.pts);
      // Lower tier rows sit at the main stand's levels (both stands share that rake).
      levels[0].forEach((y, r) => expect(y).toBeCloseTo(main.rows[r].y, 6));
      // The crest only ever comes down toward the low end, never ripples.
      expect(sample.topHeight).toBeLessThanOrEqual(prevTop + 1e-6);
      prevTop = sample.topHeight;
    }
    expect(prevTop).toBeCloseTo(end.topHeight, 6);
  });

  it('ends the upper tiers before the lower tier changes', () => {
    const doc = unevenBowl();
    const model = buildBowlSectionModel(doc, false);
    const visible = (f: number) =>
      treadLevels(model, bowlSectionAt(model, { a: 'east', b: 'south', f }).pts).map((t) => t.length);
    // From the main stand toward the end, the top tier empties first, then the middle one.
    const nearMain = visible(0.8);
    expect(nearMain[2]).toBeLessThan(model.specs.south.tiers[2].rows);
    expect(nearMain[1]).toBe(model.specs.south.tiers[1].rows);
    const nearEnd = visible(0.2);
    expect(nearEnd[2]).toBe(0);
  });

  it('reads the same section from a ring position and from its normal', () => {
    const doc = unevenBowl();
    const model = buildBowlSectionModel(doc, false);
    const ring = ringOf(doc);
    for (let i = 0; i < 200; i++) {
      const t = i / 200;
      const p = sampleRoundedBowlRing(ring, t, 0);
      const byT = bowlSectionAt(model, bowlMixAtT(model, ring, t, p.nz));
      const byN = bowlSectionAt(model, bowlMixAtNormal(model, ring, p.nx, p.nz));
      expect(byN.topHeight).toBeCloseTo(byT.topHeight, 1);
    }
  });

  it('keeps stepped corners at one stand and puts the step at the other stand', () => {
    const doc = unevenBowl();
    doc.cornerJoin = 'end';
    const model = buildBowlSectionModel(doc, false);
    const ring = ringOf(doc);
    const junctions = bowlStepJunctions(model, ring);
    expect(junctions).toHaveLength(4);
    const east = computeStandSection(doc.stands.east).topHeight;
    const south = computeStandSection(doc.stands.south).topHeight;
    // SE corner meets the south stand at its end: east section just before, south just after.
    const se = junctions.find((t) => t > 0 && t < 0.25)!;
    const before = sampleRoundedBowlRing(ring, se - 1e-4, 0);
    const after = sampleRoundedBowlRing(ring, se + 1e-4, 0);
    expect(bowlSectionAt(model, bowlMixAtT(model, ring, se - 1e-4, before.nz)).topHeight).toBeCloseTo(east, 6);
    expect(bowlSectionAt(model, bowlMixAtT(model, ring, se + 1e-4, after.nz)).topHeight).toBeCloseTo(south, 6);
  });

  it('builds every bowl shape with uneven stands and finite geometry', () => {
    ensureCanvasMock();
    for (const shape of [
      'modern_bowl',
      'olympic_oval',
      'octagonal_arena',
      'horseshoe',
      'circular_bowl',
      'tilted_bowl',
      'arc_stands',
      'rounded_rectangle',
    ] as const) {
      for (const join of ['blend', 'end', 'side'] as const) {
        const doc = unevenBowl(shape);
        doc.cornerJoin = join;
        const group = generateStandsGroup(doc);
        let vertices = 0;
        let nonFinite = 0;
        group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          const pos = mesh.isMesh ? mesh.geometry.getAttribute('position') : null;
          if (!pos) return;
          vertices += pos.count;
          for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) nonFinite++;
        });
        expect(nonFinite, `${shape} / ${join}`).toBe(0);
        expect(vertices).toBeGreaterThan(1000);
      }
    }
  }, 30_000);

  it('gives roofs and facades the crest of the bowl itself', () => {
    const bounds = computeStadiumRingBounds(unevenBowl());
    const doc = unevenBowl();
    expect(bounds.standHeightAtNormal(0, 1)).toBeCloseTo(computeStandSection(doc.stands.south).topHeight, 6);
    expect(bounds.standHeightAtNormal(1, 0)).toBeCloseTo(computeStandSection(doc.stands.east).topHeight, 6);
    expect(bounds.standDepthAtNormal(0, 1)).toBeCloseTo(computeStandSection(doc.stands.south).totalDepth, 6);
  });
});

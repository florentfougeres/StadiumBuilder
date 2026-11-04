import {
  RoundedBowlGeometry,
  ringCornerNormalWindow,
  ringSegmentAt,
  ringSegmentStarts,
} from './bowlRing';
import { CornerId, StadiumDocument, StandConfig, StandSide, isContinuousBowlShape } from './schema';
import { OVERHANG_HEADROOM_M, computeStandSection } from './sightlines';

/**
 * Cross-section of a continuous bowl anywhere on its ring.
 *
 * Every stand keeps its own section (rows, risers, tiers, balconies) along its whole side. Where
 * two stands of different sections meet, in a corner, rows are never stretched: each row keeps
 * its level and its size, and the rows one stand has in excess end one after another across the
 * corner, upper tier first, so the crest descends in a straight rake and each upper tier stops in
 * a clean end instead of the rows rippling from one section to the other. A `cornerJoin` of `end`
 * or `side` keeps the corner at one stand's section, and the other stand starts at a gable wall.
 *
 * All the sections share one point layout (the most tiers, and per tier the most rows, of any
 * stand), absent rows and balconies collapsing to zero size, so the bowl sweeps as one mesh.
 */

/** Stands a section is read from: `a` the end stand (east/west), `b` the long side (north/south). */
export interface BowlMix {
  a: StandSide;
  b: StandSide;
  /** `0` is the `a` stand's section, `1` the `b` stand's. */
  f: number;
}

/** Stands meeting at each corner: the end (behind the goal) and the long side. */
export const BOWL_CORNER_STANDS: Record<CornerId, { end: StandSide; side: StandSide }> = {
  se: { end: 'east', side: 'south' },
  sw: { end: 'west', side: 'south' },
  nw: { end: 'west', side: 'north' },
  ne: { end: 'east', side: 'north' },
};

/** Continuous bowls whose stands keep their own rows (the saddle bowl curves its rim by design). */
export function usesBowlSectionModel(shape: StadiumDocument['shape']): boolean {
  return isContinuousBowlShape(shape) && shape !== 'saddle_bowl';
}

interface TierSpec {
  rows: number;
  riser: number;
  overhang: number;
}

interface StandSpec {
  tiers: TierSpec[];
  rowDepth: number;
  elevation: number;
  recess: number;
  loggiaH: number;
  fasciaH: number;
  topHeight: number;
  outerD: number;
}

export interface BowlSectionModel {
  /** Rows laid out per tier (the most any stand has in that tier). */
  tierRows: number[];
  /** Points of every section, and which of their segments are seat treads. */
  pointCount: number;
  isSeatSegmentMask: boolean[];
  /** Per tier (from 1), index of the first point of the balcony break (loggia foot). */
  breakStart: number[];
  /** Per tier and row, index of the segment of the row's tread (its riser is the next one). */
  treadSeg: number[][];
  hollow: boolean;
  specs: Record<StandSide, StandSpec>;
  /** Stands absent from the bowl (the horseshoe's open end). */
  absent: Partial<Record<StandSide, true>>;
  /** Per corner, whether its two stands have different sections. */
  cornerDiffers: Record<CornerId, boolean>;
  join: 'blend' | 'end' | 'side';
  tilted: boolean;
}

/** A disabled stand still closes the bowl, as a low terrace. */
function effectiveStand(stand: StandConfig): StandConfig {
  if (stand.enabled && stand.rows > 0) return stand;
  return { ...stand, enabled: true, rows: 8, tiers: 1, tierConfigs: undefined };
}

function standSpec(stand: StandConfig): StandSpec {
  const section = computeStandSection(stand);
  const hasVip = section.tiers.length >= 2 && stand.vipLoges !== false;
  return {
    tiers: section.tiers.map((t) => ({ rows: t.rows, riser: t.riserHeight, overhang: t.overhang })),
    rowDepth: stand.rowDepth,
    elevation: stand.elevationStart,
    recess: hasVip ? 1.45 : 0.75,
    loggiaH: hasVip ? 1.95 : 0.95,
    fasciaH: hasVip ? 0.9 : 0.65,
    topHeight: section.topHeight,
    outerD: section.totalDepth,
  };
}

function sameSpec(a: StandSpec, b: StandSpec): boolean {
  const near = (x: number, y: number) => Math.abs(x - y) < 0.005;
  return (
    a.tiers.length === b.tiers.length &&
    a.tiers.every(
      (t, i) => t.rows === b.tiers[i].rows && near(t.riser, b.tiers[i].riser) && near(t.overhang, b.tiers[i].overhang)
    ) &&
    near(a.rowDepth, b.rowDepth) &&
    near(a.elevation, b.elevation) &&
    near(a.recess, b.recess) &&
    near(a.loggiaH, b.loggiaH) &&
    near(a.fasciaH, b.fasciaH)
  );
}

export function buildBowlSectionModel(doc: StadiumDocument, hollow: boolean): BowlSectionModel {
  const sides: StandSide[] = ['east', 'south', 'west', 'north'];
  const absent: Partial<Record<StandSide, true>> = {};
  if (doc.shape === 'horseshoe') absent.east = true;
  const specs = Object.fromEntries(
    sides.map((side) => [side, standSpec(effectiveStand(doc.stands[side]))])
  ) as Record<StandSide, StandSpec>;

  const present = sides.filter((side) => !absent[side]);
  const tierCount = Math.max(1, ...present.map((side) => specs[side].tiers.length));
  const tierRows = Array.from({ length: tierCount }, (_, t) =>
    Math.max(0, ...present.map((side) => specs[side].tiers[t]?.rows ?? 0))
  );

  // Layout: parapet, then per tier a balcony break (from the second) and its rows, then the
  // crest and the back.
  const isSeatSegmentMask: boolean[] = [false, false, false];
  const breakStart: number[] = [];
  const treadSeg: number[][] = [];
  let pointIdx = 3; // last point of the parapet
  for (let t = 0; t < tierCount; t++) {
    if (t > 0) {
      breakStart[t] = pointIdx + 1;
      isSeatSegmentMask.push(false, false, false, false);
      pointIdx += 4;
    }
    const rows: number[] = [];
    for (let r = 0; r < tierRows[t]; r++) {
      rows.push(isSeatSegmentMask.length);
      isSeatSegmentMask.push(true, false);
      pointIdx += 2;
    }
    treadSeg.push(rows);
  }
  isSeatSegmentMask.push(false, false);
  if (hollow) isSeatSegmentMask.push(false, false, false);
  else isSeatSegmentMask.push(false);

  const cornerDiffers = Object.fromEntries(
    (Object.keys(BOWL_CORNER_STANDS) as CornerId[]).map((cid) => {
      const { end, side } = BOWL_CORNER_STANDS[cid];
      return [cid, !absent[end] && !absent[side] && !sameSpec(specs[end], specs[side])];
    })
  ) as Record<CornerId, boolean>;

  return {
    tierRows,
    pointCount: isSeatSegmentMask.length + 1,
    isSeatSegmentMask,
    breakStart,
    treadSeg,
    hollow,
    specs,
    absent,
    cornerDiffers,
    join: doc.cornerJoin ?? 'blend',
    tilted: doc.shape === 'tilted_bowl',
  };
}

/** Corner fraction (`0` end stand, `1` long side) once the corner join is applied. */
function joinedFraction(model: BowlSectionModel, cid: CornerId, raw: number): number {
  const { end, side } = BOWL_CORNER_STANDS[cid];
  if (model.absent[end]) return 1;
  if (model.absent[side]) return 0;
  if (!model.cornerDiffers[cid] || model.join === 'blend') return Math.min(1, Math.max(0, raw));
  // The corner keeps one stand's section; the other stand starts at a gable wall.
  return model.join === 'end' ? (raw >= 1 - 1e-6 ? 1 : 0) : raw <= 1e-6 ? 0 : 1;
}

function quadrantOf(nx: number, nz: number): CornerId {
  if (nx >= 0) return nz >= 0 ? 'se' : 'ne';
  return nz >= 0 ? 'sw' : 'nw';
}

/** Section mix at ring position `t`. */
export function bowlMixAtT(model: BowlSectionModel, ring: RoundedBowlGeometry, t: number, nz: number): BowlMix {
  if (model.tilted) return { a: 'north', b: 'south', f: Math.min(1, Math.max(0, (1 + nz) / 2)) };
  const { segIdx, f } = ringSegmentAt(ring, t);
  // Segments: half east, SE, south, SW, west, NW, north, NE, half east.
  switch (segIdx) {
    case 0:
      return { a: 'east', b: 'south', f: joinedFraction(model, 'se', 0) };
    case 1:
      return { a: 'east', b: 'south', f: joinedFraction(model, 'se', f) };
    case 2:
      return { a: 'west', b: 'south', f: 1 };
    case 3:
      return { a: 'west', b: 'south', f: joinedFraction(model, 'sw', 1 - f) };
    case 4:
      return { a: 'west', b: 'north', f: 0 };
    case 5:
      return { a: 'west', b: 'north', f: joinedFraction(model, 'nw', f) };
    case 6:
      return { a: 'east', b: 'north', f: 1 };
    case 7:
      return { a: 'east', b: 'north', f: joinedFraction(model, 'ne', 1 - f) };
    default:
      return { a: 'east', b: 'north', f: joinedFraction(model, 'ne', 0) };
  }
}

/**
 * Section mix at a ring normal: the corner is read from the normal's turn between the end and the
 * long side, the same fraction a circular corner arc gives along its length.
 */
export function bowlMixAtNormal(model: BowlSectionModel, ring: RoundedBowlGeometry, nx: number, nz: number): BowlMix {
  if (model.tilted) return { a: 'north', b: 'south', f: Math.min(1, Math.max(0, (1 + nz) / 2)) };
  const cid = quadrantOf(nx, nz);
  const { end, side } = BOWL_CORNER_STANDS[cid];
  const { from, to } = ringCornerNormalWindow(ring);
  const phi = Math.atan2(Math.abs(nz), Math.abs(nx));
  const raw = phi <= from + 1e-9 ? 0 : phi >= to - 1e-9 ? 1 : (phi - from) / Math.max(1e-6, to - from);
  return { a: end, b: side, f: joinedFraction(model, cid, raw) };
}

/**
 * Ring positions where a corner kept at one stand's section meets the other stand: the bowl puts
 * two slices there, a hair apart, so the step between the two sections is a vertical gable wall.
 */
export function bowlStepJunctions(model: BowlSectionModel, ring: RoundedBowlGeometry): number[] {
  if (model.tilted || model.join === 'blend') return [];
  const starts = ringSegmentStarts(ring);
  // Corner segment index and whether the long side lies at its end (`true`) or its start.
  const corners: { cid: CornerId; seg: number; sideAtEnd: boolean }[] = [
    { cid: 'se', seg: 1, sideAtEnd: true },
    { cid: 'sw', seg: 3, sideAtEnd: false },
    { cid: 'nw', seg: 5, sideAtEnd: true },
    { cid: 'ne', seg: 7, sideAtEnd: false },
  ];
  const out: number[] = [];
  for (const { cid, seg, sideAtEnd } of corners) {
    const { end, side } = BOWL_CORNER_STANDS[cid];
    if (!model.cornerDiffers[cid] || model.absent[end] || model.absent[side]) continue;
    // `end`: the step is where the corner meets the long side; `side`: where it meets the end.
    const atSegEnd = model.join === 'end' ? sideAtEnd : !sideAtEnd;
    out.push(atSegEnd ? starts[seg + 1] : starts[seg]);
  }
  return out;
}

export interface BowlSectionSample {
  pts: [number, number][];
  /** Rear of the crest walkway and its level. */
  outerD: number;
  topHeight: number;
}

const lerp = (a: number, b: number, s: number) => a + (b - a) * s;

/**
 * Rows of each tier at a corner fraction. Seen from the taller stand, the tiers that lose rows do
 * so first, top tier first, then those that gain rows, bottom tier first; each over a share of the
 * corner proportional to its change, so rows end at an even pace and the crest falls straight.
 */
function scheduledTierRows(model: BowlSectionModel, A: StandSpec, B: StandSpec, f: number): number[] {
  const T = model.tierRows.length;
  const aTaller = A.topHeight >= B.topHeight;
  const hi = aTaller ? A : B;
  const lo = aTaller ? B : A;
  const u = aTaller ? f : 1 - f;
  const nHi = Array.from({ length: T }, (_, t) => hi.tiers[t]?.rows ?? 0);
  const nLo = Array.from({ length: T }, (_, t) => lo.tiers[t]?.rows ?? 0);
  const losing = [...Array(T).keys()].filter((t) => nHi[t] > nLo[t]).reverse();
  const gaining = [...Array(T).keys()].filter((t) => nLo[t] > nHi[t]);
  const order = [...losing, ...gaining];
  const total = order.reduce((acc, t) => acc + Math.abs(nHi[t] - nLo[t]), 0);
  const rows = nHi.slice();
  if (total <= 0) return rows;
  let start = 0;
  for (const t of order) {
    const span = Math.abs(nHi[t] - nLo[t]) / total;
    const k = Math.min(1, Math.max(0, (u - start) / span));
    rows[t] = lerp(nHi[t], nLo[t], k);
    start += span;
  }
  return rows;
}

/** Section of the bowl for a mix of two stands, in the model's shared point layout. */
export function bowlSectionAt(model: BowlSectionModel, mix: BowlMix): BowlSectionSample {
  const A = model.specs[mix.a];
  const B = model.specs[mix.b];
  const f = A === B ? 0 : mix.f;
  // Smooth easing for what both stands share (rake, depth): rows keep their level along a stand.
  const s = f * f * (3 - 2 * f);
  const tierRowsNow = f <= 0 ? model.tierRows.map((_, t) => A.tiers[t]?.rows ?? 0)
    : f >= 1 ? model.tierRows.map((_, t) => B.tiers[t]?.rows ?? 0)
    : scheduledTierRows(model, A, B, f);

  // Value of a tier parameter: blended where both stands have the tier, else the one that has it.
  const tierParam = (t: number, key: keyof TierSpec) => {
    const ta = A.tiers[t];
    const tb = B.tiers[t];
    if (ta && tb) return lerp(ta[key], tb[key], s);
    return (ta ?? tb)?.[key] ?? 0;
  };
  const standParam = (t: number, key: 'recess' | 'loggiaH' | 'fasciaH') => {
    const ta = A.tiers[t];
    const tb = B.tiers[t];
    if (ta && tb) return lerp(A[key], B[key], s);
    return ta ? A[key] : B[key];
  };
  const rowDepth = lerp(A.rowDepth, B.rowDepth, s);
  const elevation = lerp(A.elevation, B.elevation, s);

  const pts: [number, number][] = [
    [0, 0],
    [0, elevation + 0.58],
    [0.34, elevation + 0.58],
    [0.34, elevation],
  ];
  let curD = 0.34;
  let curY = elevation;
  let maxD = curD;
  const placed: { d: number; y: number; depth: number }[] = [];

  model.tierRows.forEach((rowsLaid, t) => {
    const n = Math.min(rowsLaid, Math.max(0, tierRowsNow[t]));
    if (t > 0) {
      // The balcony grows in with the tier's first row, so a tier that ends closes on a wall.
      const b = placed.length > 0 ? Math.min(1, n) : 0;
      if (b > 0) {
        const frontFull = Math.max(0.34 + 1.5, curD - tierParam(t, 'overhang'));
        const sheltered = placed.filter((r) => r.d + r.depth > frontFull);
        const highest = sheltered.reduce((m, r) => Math.max(m, r.y), -Infinity);
        const soffitFull = Math.max(
          curY + standParam(t, 'loggiaH'),
          Number.isFinite(highest) ? highest + OVERHANG_HEADROOM_M : -Infinity
        );
        const recessD = curD + standParam(t, 'recess') * b;
        const soffitY = curY + (soffitFull - curY) * b;
        const frontD = curD - (curD - frontFull) * b;
        const topY = soffitY + standParam(t, 'fasciaH') * b;
        pts.push([recessD, curY], [recessD, soffitY], [frontD, soffitY], [frontD, topY]);
        maxD = Math.max(maxD, recessD);
        curD = frontD;
        curY = topY;
      } else {
        pts.push([curD, curY], [curD, curY], [curD, curY], [curD, curY]);
      }
    }
    const riser = tierParam(t, 'riser');
    const full = Math.floor(n);
    for (let r = 0; r < rowsLaid; r++) {
      // The row being dropped tapers to nothing: rows end one by one along the corner.
      const k = r < full ? 1 : r === full ? n - full : 0;
      const dd = rowDepth * k;
      if (k > 0) placed.push({ d: curD, y: curY, depth: dd });
      pts.push([curD + dd, curY], [curD + dd, curY + riser * k]);
      curD += dd;
      curY += riser * k;
      maxD = Math.max(maxD, curD);
    }
  });

  const topHeight = curY + 1.85;
  // The back of the bowl (and the facade on it) eases from one stand's depth to the other's while
  // the rows end at their own pace; the crest walkway widens behind the shorter rows.
  const outerD = Math.max(Math.max(curD, maxD) + 2.8, lerp(A.outerD, B.outerD, s));
  pts.push([curD, topHeight], [outerD, topHeight]);
  if (model.hollow) {
    if (topHeight > 5) {
      pts.push(
        [outerD, Math.max(2.2, topHeight - 2.35)],
        [Math.max(3.6, outerD * 0.5), Math.max(1.4, topHeight * 0.44 - 1.4)],
        [2.4, 0]
      );
    } else {
      pts.push([outerD, 0], [outerD, 0], [outerD, 0]);
    }
  } else {
    pts.push([outerD, 0]);
  }
  return { pts, outerD, topHeight };
}

/** Crest height and rear depth of the bowl at a ring normal. */
export function bowlCrestAtNormal(
  model: BowlSectionModel,
  ring: RoundedBowlGeometry,
  nx: number,
  nz: number
): { height: number; depth: number } {
  const sample = bowlSectionAt(model, bowlMixAtNormal(model, ring, nx, nz));
  return { height: sample.topHeight, depth: sample.outerD };
}

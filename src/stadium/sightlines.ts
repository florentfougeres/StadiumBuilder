import {
  CROSS_AISLE_WALL_M,
  crossAisleRowsOfTier,
  riserFromSlopeDeg,
  RoofStyle,
  slopeDegFromRiser,
  StandConfig,
  StandSide,
} from './schema';

export interface SightlinePoint {
  row: number;
  tier: number;
  distanceX: number; // horizontal distance from focal point (touchline)
  eyeHeightY: number; // spectator eye height above pitch
  cValueMm: number; // C-value in millimeters
  viewingAngleDeg: number; // downward viewing angle to touchline
}

export interface ResolvedTierSpec {
  tierIndex: number;
  rows: number;
  slopeAngleDeg: number;
  riserHeight: number;
  /** How far (m) the tier's front projects over the rear rows of the tier below (`0..8.5`). */
  overhang: number;
  /** Storeys of hospitality boxes in the break below this tier (`1..3`; unused for the lowest tier). */
  vipStoreys: number;
}

/** Projection of an upper tier over the rows below, as stands were drawn before it became a setting. */
export const DEFAULT_TIER_OVERHANG_M = 1.15;
/** Clear height kept between an upper tier's soffit and the treads of the rows it shelters (m). */
export const OVERHANG_HEADROOM_M = 2.4;

/**
 * Settings that turn a stand into a vertical stack of box balconies (La Bombonera's « palcos »):
 * five short tiers, each set right above the one below with glazed boxes in every break, so the
 * stand rises almost straight up from the touchline.
 */
export function verticalBoxStandPatch(stand: StandConfig): Partial<StandConfig> {
  // Boxes hold two rows at the steepest rake: from that high above the touchline the second row
  // cannot see over the first anyway (the C-value of such stands is low by nature).
  const rows = 2;
  const recess = tierBreakDims(true).recess;
  const overhang = Math.min(8.5, rows * stand.rowDepth + recess);
  return {
    tiers: 5,
    rows: rows * 5,
    vipLoges: true,
    vipStoreys: 1,
    vipStoreysByBreak: undefined,
    rakeProfile: 'constant',
    crossAisles: undefined,
    tierConfigs: Array.from({ length: 5 }, (_, t) => ({ rows, slopeAngleDeg: 42, overhang: t === 0 ? 0 : overhang })),
  };
}

/** Height (m) of each extra storey of hospitality boxes in a tier break. */
export const VIP_STOREY_M = 3.2;

/**
 * Depth of the loggia recess, its height and the balcony fascia at a tier break: a plain break,
 * or glazed boxes (one storey, or a ring of up to three stacked storeys of suites).
 */
export function tierBreakDims(hasVip: boolean, vipStoreys: number = 1): { recess: number; loggiaH: number; fasciaH: number } {
  const storeys = Math.max(0, Math.min(3, Math.round(vipStoreys)));
  return hasVip && storeys > 0
    ? { recess: 1.45 + (storeys - 1) * 0.6, loggiaH: 1.95 + (storeys - 1) * VIP_STOREY_M, fasciaH: 0.9 }
    : { recess: 0.75, loggiaH: 0.95, fasciaH: 0.65 };
}

/**
 * Riser height of a row in tier `tierIdx` (0 = lowest). Upper tiers sit higher and further from
 * the pitch, so each one is steeper to keep a positive C-value: with a 0.40 m riser and 0.80 m
 * rows this gives roughly 27°, 30°, 32°, 35°, 37° from the lowest to the fifth tier. Shared by
 * the 3D profile, the capacity heights and the sightline engine so all three agree.
 */
export const UPPER_TIER_STEEPENING = 0.12;

/**
 * Steepest rake a seated tier may have (degrees). Beyond about 35° a stand is no longer safe to
 * walk down (codes such as the Green Guide stop at 34-35°): every riser is held under it.
 */
export const MAX_RAKE_DEG = 35;
const MAX_RAKE_TAN = Math.tan((MAX_RAKE_DEG * Math.PI) / 180);

/** `riser` held under the steepest rake for rows `rowDepth` deep. */
function cappedRiser(riser: number, rowDepth: number): number {
  return Math.min(riser, Number((MAX_RAKE_TAN * rowDepth).toFixed(3)));
}
export function tierRiserHeight(baseRiser: number, tierIdx: number): number {
  return baseRiser * (1 + Math.max(0, tierIdx) * UPPER_TIER_STEEPENING);
}

/**
 * Splits total rows across 1..5 tiers (étages), returning the start row index of each tier.
 */
export function getTierStartRows(totalRows: number, tiers: number): number[] {
  const safeTiers = Math.max(1, Math.min(5, Math.floor(tiers)));
  const starts: number[] = [0];
  if (safeTiers === 1 || totalRows < safeTiers * 2) return [0];

  // Realistic stadium distribution: lower tier deeper, upper rings progressively compact & steeper
  const weights =
    safeTiers === 2
      ? [0.52, 0.48]
      : safeTiers === 3
      ? [0.4, 0.33, 0.27]
      : safeTiers === 4
      ? [0.31, 0.26, 0.23, 0.2]
      : [0.26, 0.22, 0.19, 0.17, 0.16];

  let acc = 0;
  for (let t = 0; t < safeTiers - 1; t++) {
    acc += Math.max(2, Math.round(totalRows * weights[t]));
    if (acc < totalRows - 1) {
      starts.push(acc);
    }
  }
  return starts;
}

/**
 * Resolves exact per-tier row counts, slope angles, riser heights, and cantilever overhangs
 * for a stand, supporting both symmetric stands and asymmetric per-tier `stand.tierConfigs`.
 */
export function resolveStandTiers(stand: StandConfig): ResolvedTierSpec[] {
  const key = JSON.stringify(stand);
  const cached = resolvedTierCache.get(key);
  if (cached) return cached.map((t) => ({ ...t }));
  const tiers = resolveTierShapes(stand).map((tier) => ({
    ...tier,
    vipStoreys: tier.tierIndex === 0 ? 0 : vipStoreysAtBreak(stand, tier.tierIndex - 1),
  }));
  for (let t = 1; t < tiers.length; t++) tiers[t].overhang = sightlineOverhang(stand, tiers, t);
  if (resolvedTierCache.size >= 256) resolvedTierCache.clear();
  resolvedTierCache.set(key, tiers);
  return tiers.map((tier) => ({ ...tier }));
}

/** Overhang asked for each tier (index 0 is always 0), before sightlines hold it back. */
export function requestedTierOverhangs(stand: StandConfig): number[] {
  return resolveTierShapes(stand).map((tier) => tier.overhang);
}

/** Tiers resolved per stand settings: every builder resolves the same stands many times. */
const resolvedTierCache = new Map<string, ResolvedTierSpec[]>();

/**
 * Overhang of tier `t`: always the one asked for. Sightlines no longer set an upper tier back
 * on their own, so a tier set to overhang the one below always does.
 */
function sightlineOverhang(_stand: StandConfig, tiers: ResolvedTierSpec[], t: number): number {
  return tiers[t].overhang;
}

/**
 * Storeys of boxes in the break below tier `breakIdx + 1`: its own setting (`0` for a plain break
 * with no boxes), else the stand-wide one (`1..3`).
 */
export function vipStoreysAtBreak(stand: StandConfig, breakIdx: number): number {
  const own = stand.vipStoreysByBreak?.[breakIdx];
  if (own !== undefined) return Math.max(0, Math.min(3, Math.round(own)));
  return Math.max(1, Math.min(3, Math.round(stand.vipStoreys ?? 1)));
}

function resolveTierShapes(stand: StandConfig): Omit<ResolvedTierSpec, 'vipStoreys'>[] {
  const safeTiers = Math.max(1, Math.min(5, Math.floor(stand.tiers)));
  const fallbackOverhang = Math.max(
    0,
    Math.min(8.5, stand.tierOverhang ?? DEFAULT_TIER_OVERHANG_M)
  );

  if (stand.tierConfigs && stand.tierConfigs.length > 0) {
    const defaultStarts = getTierStartRows(Math.max(safeTiers * 3, stand.rows), safeTiers);
    const resolved: Omit<ResolvedTierSpec, 'vipStoreys'>[] = [];
    for (let t = 0; t < safeTiers; t++) {
      const cfg = stand.tierConfigs[t];
      if (cfg) {
        const rows = Math.max(2, Math.min(90, Math.round(cfg.rows)));
        const slopeAngleDeg = Number(
          Math.max(15, Math.min(MAX_RAKE_DEG, cfg.slopeAngleDeg)).toFixed(1)
        );
        const riserHeight = riserFromSlopeDeg(slopeAngleDeg, stand.rowDepth);
        const overhang =
          t === 0
            ? 0
            : Math.max(
                0,
                Math.min(
                  8.5,
                  cfg.overhang !== undefined ? cfg.overhang : fallbackOverhang
                )
              );
        resolved.push({
          tierIndex: t,
          rows,
          slopeAngleDeg,
          riserHeight,
          overhang,
        });
      } else {
        const startRow = defaultStarts[t] ?? 0;
        const endRow =
          t < defaultStarts.length - 1 ? defaultStarts[t + 1] : stand.rows;
        const rows = Math.max(3, endRow - startRow);
        const riserHeight = cappedRiser(tierRiserHeight(stand.riserHeight, t), stand.rowDepth);
        const slopeAngleDeg = slopeDegFromRiser(riserHeight, stand.rowDepth);
        resolved.push({
          tierIndex: t,
          rows,
          slopeAngleDeg,
          riserHeight,
          overhang: t === 0 ? 0 : fallbackOverhang,
        });
      }
    }
    return resolved;
  }

  const starts = getTierStartRows(stand.rows, safeTiers);
  return starts.map((startRow, t) => {
    const endRow = t === starts.length - 1 ? stand.rows : starts[t + 1];
    const rows = Math.max(1, endRow - startRow);
    const riserHeight = cappedRiser(tierRiserHeight(stand.riserHeight, t), stand.rowDepth);
    const slopeAngleDeg = slopeDegFromRiser(riserHeight, stand.rowDepth);
    return {
      tierIndex: t,
      rows,
      slopeAngleDeg,
      riserHeight,
      overhang: t === 0 ? 0 : fallbackOverhang,
    };
  });
}

export interface StandSectionRow {
  /** Front edge of the tread, measured from the pitch side of the front wall (m). */
  d: number;
  /** Tread level (m). */
  y: number;
  tierIdx: number;
  /** Rise from this row's tread to the next one's. */
  riser: number;
  /** A cross aisle runs in front of this row: walkway width, and the wall up to the row. */
  crossAisle?: { width: number; wall: number };
}

export interface StandSectionBreak {
  /** Upper tier that starts at this break. */
  tierIdx: number;
  /** Rear edge and top of the last row of the tier below. */
  fromD: number;
  fromY: number;
  /** Back wall of the loggia between the two tiers. */
  recessD: number;
  /** Underside of the upper tier balcony; raised to keep headroom over the rows it shelters. */
  soffitY: number;
  /** Pitch-side face of the upper tier balcony. */
  frontD: number;
  /** First tread of the upper tier. */
  topY: number;
  /** Rows of the tier below that sit, even partly, under the balcony. */
  shelteredRows: number;
  hasVip: boolean;
}

export interface StandSection {
  tiers: ResolvedTierSpec[];
  rows: StandSectionRow[];
  breaks: StandSectionBreak[];
  /** Rear edge and top of the last row. */
  endD: number;
  endY: number;
  /** Rear face of the stand. */
  totalDepth: number;
  topHeight: number;
}

/** C-value every row is drawn for (m): the "good" grade of the Green Guide. */
const TARGET_C_M = 0.09;
/** Eye height of a seated spectator above their tread (m). */
const SEATED_EYE_M = 1.15;
/** Pitch-side face of the front wall, from which row positions `d` are measured (m). */
const FRONT_WALL_D = 0.34;

/**
 * Risers of a tier's rows. `constant` repeats the tier's riser; `progressive` follows the riser
 * each row needs to keep the same C-value over the row in front (larger as rows get higher and
 * further back, the parabolic rake), scaled so the tier keeps its height.
 *
 * Either way, as a stand is built: no riser is lower than the one that gives the row behind it a
 * C-value of `TARGET_C_M` over the touchline, and none is steeper than `MAX_RAKE_DEG`. Where the
 * two meet (rows very high above the pitch), the rake stops at the limit and the C-value drops.
 */
export function tierRowRisers(
  stand: StandConfig,
  tier: ResolvedTierSpec,
  startD: number,
  startY: number
): number[] {
  const t = stand.rowDepth;
  const maxRiser = MAX_RAKE_TAN * t;
  /** Riser a row at (`d`, `y`) needs for the row behind it to see the touchline over it. */
  const neededRiser = (d: number, y: number): number => {
    const dist = Math.max(2, stand.distanceToPitch + d - FRONT_WALL_D);
    const h = y + SEATED_EYE_M;
    return ((TARGET_C_M + h) * (dist + t)) / dist - h;
  };

  let base = Array<number>(tier.rows).fill(tier.riserHeight);
  if (stand.rakeProfile === 'progressive' && tier.rows >= 4) {
    const ideal: number[] = [];
    let d = startD;
    let y = startY;
    for (let r = 0; r < tier.rows; r++) {
      ideal.push(neededRiser(d, y));
      d += t;
      y += tier.riserHeight;
    }
    // Keep the tier's height, with no row flatter than half or steeper than twice the mean.
    const mean = tier.riserHeight;
    const scale = (mean * tier.rows) / Math.max(1e-6, ideal.reduce((a, b) => a + b, 0));
    const clamped = ideal.map((n) => Math.max(mean * 0.5, Math.min(mean * 2, n * scale)));
    const rescale = (mean * tier.rows) / clamped.reduce((a, b) => a + b, 0);
    base = clamped.map((n) => n * rescale);
  }

  // Built row by row, as each row's position depends on the risers below it.
  const risers: number[] = [];
  let d = startD;
  let y = startY;
  for (let r = 0; r < tier.rows; r++) {
    const n = Math.min(maxRiser, Math.max(base[r], neededRiser(d, y)));
    risers.push(n);
    d += t;
    y += n;
  }
  return risers;
}

/**
 * Cross-section of a stand, the single source for the 3D profile, the capacity metrics and the
 * sightlines. Rows climb from the front wall; at each tier change the upper tier steps up over a
 * loggia and its balcony projects `overhang` metres over the last rows of the tier below. The
 * balcony soffit is raised as needed so the sheltered rows keep OVERHANG_HEADROOM_M of clearance.
 */
export function computeStandSection(stand: StandConfig): StandSection {
  return layoutSection(stand, resolveStandTiers(stand));
}

/** Smallest depth of balcony soffit left in front of a loggia, set back or not (m). */
export const MIN_BALCONY_SOFFIT_M = 0.6;

/**
 * Loggia back wall at a tier break: `recess` behind the last row below, and never in front of
 * the upper tier's balcony, which may be set back behind the tier below (negative overhang).
 */
export function loggiaRecessD(curD: number, recess: number, frontD: number): number {
  return Math.max(curD + recess, frontD + MIN_BALCONY_SOFFIT_M);
}

function layoutSection(stand: StandConfig, tiers: ResolvedTierSpec[]): StandSection {
  const hasVip = tiers.length >= 2 && stand.vipLoges !== false;
  const frontWallD = FRONT_WALL_D;

  const rows: StandSectionRow[] = [];
  const breaks: StandSectionBreak[] = [];
  let curD = frontWallD;
  let curY = stand.elevationStart;
  let maxD = curD;

  for (const tier of tiers) {
    if (tier.tierIndex > 0 && rows.length > 0) {
      const { recess, loggiaH: baseLoggiaH, fasciaH } = tierBreakDims(hasVip, tier.vipStoreys);
      const frontD = Math.max(frontWallD + 1.5, curD - tier.overhang);
      const sheltered = rows.filter((r) => r.d + stand.rowDepth > frontD);
      const highestShelteredTread = sheltered.reduce((m, r) => Math.max(m, r.y), -Infinity);
      const soffitY = Math.max(curY + baseLoggiaH, highestShelteredTread + OVERHANG_HEADROOM_M);
      const recessD = loggiaRecessD(curD, recess, frontD);
      breaks.push({
        tierIdx: tier.tierIndex,
        fromD: curD,
        fromY: curY,
        recessD,
        soffitY,
        frontD,
        topY: soffitY + fasciaH,
        shelteredRows: sheltered.length,
        hasVip: hasVip && tier.vipStoreys > 0,
      });
      maxD = Math.max(maxD, recessD);
      curD = frontD;
      curY = soffitY + fasciaH;
    }
    const risers = tierRowRisers(stand, tier, curD, curY);
    const aisleRows = crossAisleRowsOfTier(stand, tier.tierIndex, tier.rows);
    for (let r = 0; r < tier.rows; r++) {
      let aisle: StandSectionRow['crossAisle'];
      const aisleWidth = aisleRows.get(r);
      if (aisleWidth !== undefined) {
        // The walkway at the level of the next tread, then a wall up to the rows behind it.
        aisle = { width: aisleWidth, wall: CROSS_AISLE_WALL_M };
        curD += aisle.width;
        curY += aisle.wall;
      }
      rows.push({ d: curD, y: curY, tierIdx: tier.tierIndex, riser: risers[r], crossAisle: aisle });
      curD += stand.rowDepth;
      curY += risers[r];
      maxD = Math.max(maxD, curD);
    }
  }

  return {
    tiers,
    rows,
    breaks,
    endD: curD,
    endY: curY,
    totalDepth: Math.max(curD, maxD) + 2.8,
    topHeight: curY + 1.85,
  };
}

/**
 * Height of the terrace surface at `d` metres behind the stand's front wall: the highest tread
 * covering `d` (an upper-tier balcony wins over the rows it shelters), the rear deck behind the
 * last row, the pitch-side apron in front of the first one. Columns planted in the seating land here.
 */
export function standTreadHeightAt(stand: StandConfig, d: number): number {
  const section = computeStandSection(stand);
  if (section.rows.length === 0) return 0;
  if (d >= section.endD) return section.endY;
  let best = -Infinity;
  for (const row of section.rows) {
    if (d >= row.d && d < row.d + stand.rowDepth) best = Math.max(best, row.y);
  }
  return Number.isFinite(best) ? best : stand.elevationStart;
}

/**
 * Green Guide / FIFA standard C-value formula:
 * C = D * (N + R) / (D + T) - R
 * with D the horizontal distance and R the height from the focal point to the eye of the spectator
 * in front, N the riser and T the row depth between the two rows.
 */
export function computeRowCValueMm(
  distanceHorizontalM: number,
  eyeHeightM: number,
  riserHeightM: number,
  rowDepthM: number
): number {
  if (distanceHorizontalM <= 0 || distanceHorizontalM + rowDepthM <= 0) {
    return 0;
  }
  const cMeters =
    (distanceHorizontalM * (riserHeightM + eyeHeightM)) /
      (distanceHorizontalM + rowDepthM) -
    eyeHeightM;
  return Math.round(cMeters * 1000);
}

export function evaluateSightlineGrade(
  minCValueMm: number
): 'Optimal' | 'Conforme' | 'Acceptable' | 'Critique' {
  if (minCValueMm >= 120) return 'Optimal';
  if (minCValueMm >= 90) return 'Conforme';
  if (minCValueMm >= 60) return 'Acceptable';
  return 'Critique';
}

export function computeStandSightlines(
  stand: StandConfig,
  trackOffsetM: number = 0,
  effectiveRoofStyle?: RoofStyle
): {
  points: SightlinePoint[];
  minCValueMm: number;
  avgCValueMm: number;
  avgDistanceM: number;
  grade: 'Optimal' | 'Conforme' | 'Acceptable' | 'Critique';
  hasColumnObstruction: boolean;
} {
  const tierSpecs = resolveStandTiers(stand);
  const totalRows = tierSpecs.reduce((acc, t) => acc + t.rows, 0);

  if (!stand.enabled || totalRows <= 0) {
    return {
      points: [],
      minCValueMm: 0,
      avgCValueMm: 0,
      avgDistanceM: 0,
      grade: 'Optimal',
      hasColumnObstruction: false,
    };
  }

  const isStandingKop = stand.seatingType === 'safe_standing';
  const hasColumnObstruction = effectiveRoofStyle === 'column_supported';

  const eyeOffsetBase = isStandingKop && tierSpecs.length === 1 ? 1.52 : 1.15;
  const points: SightlinePoint[] = [];
  const baseDist = Math.max(2, stand.distanceToPitch + trackOffsetM);
  const section = computeStandSection(stand);
  const tierFirstRowSet = new Set<number>();

  section.rows.forEach((row, globalRow) => {
    const isTierFirstRow = globalRow === 0 || section.rows[globalRow - 1].tierIdx !== row.tierIdx;
    if (isTierFirstRow) tierFirstRowSet.add(globalRow);
    // Horizontal distance from the touchline to the spectator's eye (front of the tread).
    const curD = baseDist + row.d - 0.34;
    const tierEyeOffset = isStandingKop && row.tierIdx === 0 ? 1.52 : eyeOffsetBase;
    const eyeHeight = row.y + tierEyeOffset;

    // Green Guide: the sightline grazes the head of the spectator in front, so D and R are that
    // spectator's; a cross aisle sets this row back and raises it (larger T and N).
    const front = section.rows[globalRow - 1];
    const frontEye =
      front && front.y + (isStandingKop && front.tierIdx === 0 ? 1.52 : eyeOffsetBase);
    const rawCVal = isTierFirstRow
      ? 145
      : computeRowCValueMm(baseDist + front.d - 0.34, frontEye, row.y - front.y, row.d - front.d);

    // Roof columns planted in upper third of stands obstruct rear rows
    const colPenalty =
      hasColumnObstruction && globalRow >= Math.floor(totalRows * 0.66) ? 18 : 0;
    // Kept as computed (even negative) so a stand that cannot see the touchline reads as such.
    const cVal = rawCVal - colPenalty;

    const viewingAngleDeg = Number(
      ((Math.atan2(eyeHeight, curD) * 180) / Math.PI).toFixed(1)
    );

    points.push({
      row: globalRow + 1,
      tier: row.tierIdx + 1,
      distanceX: Number(curD.toFixed(2)),
      eyeHeightY: Number(eyeHeight.toFixed(2)),
      cValueMm: cVal,
      viewingAngleDeg,
    });
  });

  const nonBalconyRows = points.filter((p) => !tierFirstRowSet.has(p.row - 1));
  const evaluated = nonBalconyRows.length > 0 ? nonBalconyRows : points;
  const minCValueMm = Math.min(...evaluated.map((p) => p.cValueMm));
  const sum = evaluated.reduce((acc, p) => acc + p.cValueMm, 0);
  const avgCValueMm = Math.round(sum / evaluated.length);
  const avgDistanceM = Number(
    (points.reduce((acc, p) => acc + p.distanceX, 0) / points.length).toFixed(1)
  );

  return {
    points,
    minCValueMm,
    avgCValueMm,
    avgDistanceM,
    grade: evaluateSightlineGrade(minCValueMm),
    hasColumnObstruction,
  };
}

export function getSideLabelFr(side: StandSide): string {
  switch (side) {
    case 'north':
      return 'Tribune Nord (Latérale)';
    case 'south':
      return 'Tribune Sud (Principale)';
    case 'east':
      return 'Virage Est';
    case 'west':
      return 'Virage Ouest';
  }
}

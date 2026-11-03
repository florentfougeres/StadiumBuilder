import {
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
}

/** Projection of an upper tier over the rows below, as stands were drawn before it became a setting. */
export const DEFAULT_TIER_OVERHANG_M = 1.15;
/** Clear height kept between an upper tier's soffit and the treads of the rows it shelters (m). */
export const OVERHANG_HEADROOM_M = 2.4;

/**
 * Riser height of a row in tier `tierIdx` (0 = lowest). Upper tiers sit higher and further from
 * the pitch, so each one is steeper to keep a positive C-value: with a 0.40 m riser and 0.80 m
 * rows this gives roughly 27°, 30°, 32°, 35°, 37° from the lowest to the fifth tier. Shared by
 * the 3D profile, the capacity heights and the sightline engine so all three agree.
 */
export const UPPER_TIER_STEEPENING = 0.12;
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
  const safeTiers = Math.max(1, Math.min(5, Math.floor(stand.tiers)));
  const fallbackOverhang = Math.max(
    0,
    Math.min(8.5, stand.tierOverhang ?? DEFAULT_TIER_OVERHANG_M)
  );

  if (stand.tierConfigs && stand.tierConfigs.length > 0) {
    const defaultStarts = getTierStartRows(Math.max(safeTiers * 3, stand.rows), safeTiers);
    const resolved: ResolvedTierSpec[] = [];
    for (let t = 0; t < safeTiers; t++) {
      const cfg = stand.tierConfigs[t];
      if (cfg) {
        const rows = Math.max(2, Math.min(90, Math.round(cfg.rows)));
        const slopeAngleDeg = Number(
          Math.max(15, Math.min(42, cfg.slopeAngleDeg)).toFixed(1)
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
        const riserHeight = tierRiserHeight(stand.riserHeight, t);
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
    const riserHeight = tierRiserHeight(stand.riserHeight, t);
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
  riser: number;
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

/**
 * Cross-section of a stand, the single source for the 3D profile, the capacity metrics and the
 * sightlines. Rows climb from the front wall; at each tier change the upper tier steps up over a
 * loggia and its balcony projects `overhang` metres over the last rows of the tier below. The
 * balcony soffit is raised as needed so the sheltered rows keep OVERHANG_HEADROOM_M of clearance.
 */
export function computeStandSection(stand: StandConfig): StandSection {
  const tiers = resolveStandTiers(stand);
  const hasVip = tiers.length >= 2 && stand.vipLoges !== false;
  const recess = hasVip ? 1.45 : 0.75;
  const baseLoggiaH = hasVip ? 1.95 : 0.95;
  const fasciaH = hasVip ? 0.9 : 0.65;
  const frontWallD = 0.34;

  const rows: StandSectionRow[] = [];
  const breaks: StandSectionBreak[] = [];
  let curD = frontWallD;
  let curY = stand.elevationStart;
  let maxD = curD;

  for (const tier of tiers) {
    if (tier.tierIndex > 0 && rows.length > 0) {
      const frontD = Math.max(frontWallD + 1.5, curD - tier.overhang);
      const sheltered = rows.filter((r) => r.d + stand.rowDepth > frontD);
      const highestShelteredTread = sheltered.reduce((m, r) => Math.max(m, r.y), -Infinity);
      const soffitY = Math.max(curY + baseLoggiaH, highestShelteredTread + OVERHANG_HEADROOM_M);
      const recessD = curD + recess;
      breaks.push({
        tierIdx: tier.tierIndex,
        fromD: curD,
        fromY: curY,
        recessD,
        soffitY,
        frontD,
        topY: soffitY + fasciaH,
        shelteredRows: sheltered.length,
        hasVip,
      });
      maxD = Math.max(maxD, recessD);
      curD = frontD;
      curY = soffitY + fasciaH;
    }
    for (let r = 0; r < tier.rows; r++) {
      rows.push({ d: curD, y: curY, tierIdx: tier.tierIndex, riser: tier.riserHeight });
      curD += stand.rowDepth;
      curY += tier.riserHeight;
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
 * Green Guide / FIFA standard C-value formula:
 * C = D * (N + R) / (D + T) - R
 * with D the horizontal eye-to-focal-point distance, N the riser height, R the eye height above
 * the focal point and T the row depth.
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

    const rawCVal = isTierFirstRow
      ? 145
      : computeRowCValueMm(curD, eyeHeight, row.riser, stand.rowDepth);

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

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
  /** Forward cantilever projection (m) from the inter-tier concourse/loggia wall (`0..8.5`). */
  overhang: number;
}

export const DEFAULT_TIER_OVERHANG_M = 2.5;

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
  const hasVipLoges = tierSpecs.length >= 2 && stand.vipLoges !== false;
  const hasColumnObstruction = effectiveRoofStyle === 'column_supported';

  const eyeOffsetBase = isStandingKop && tierSpecs.length === 1 ? 1.52 : 1.15;
  const points: SightlinePoint[] = [];
  const baseDist = Math.max(2, stand.distanceToPitch + trackOffsetM);
  const recessStep = hasVipLoges ? 1.45 : 0.85;

  let curD = baseDist;
  let curY = stand.elevationStart;
  let globalRow = 0;
  const tierFirstRowSet = new Set<number>();

  for (let tierIdx = 0; tierIdx < tierSpecs.length; tierIdx++) {
    const spec = tierSpecs[tierIdx];
    tierFirstRowSet.add(globalRow);

    if (tierIdx > 0) {
      // Upper tier advances forward from the rear concourse/loggia line by `spec.overhang`
      curD = Math.max(baseDist + 1.2, curD + recessStep - spec.overhang);
      curY += hasVipLoges ? 2.75 : 1.6;
    }

    const tierEyeOffset =
      isStandingKop && tierIdx === 0 ? 1.52 : eyeOffsetBase;

    for (let tr = 0; tr < spec.rows; tr++) {
      const isTierFirstRow = tr === 0;
      const eyeHeight = curY + tierEyeOffset;

      const rawCVal = isTierFirstRow
        ? 145
        : computeRowCValueMm(curD, eyeHeight, spec.riserHeight, stand.rowDepth);

      // Roof columns planted in upper third of stands obstruct rear rows
      const colPenalty =
        hasColumnObstruction && globalRow >= Math.floor(totalRows * 0.66) ? 18 : 0;
      const cVal = hasColumnObstruction
        ? Math.max(6, rawCVal - colPenalty)
        : Math.max(20, rawCVal);

      const viewingAngleDeg = Number(
        ((Math.atan2(eyeHeight, curD) * 180) / Math.PI).toFixed(1)
      );

      points.push({
        row: globalRow + 1,
        tier: tierIdx + 1,
        distanceX: Number(curD.toFixed(2)),
        eyeHeightY: Number(eyeHeight.toFixed(2)),
        cValueMm: cVal,
        viewingAngleDeg,
      });

      curD += stand.rowDepth;
      curY += spec.riserHeight;
      globalRow++;
    }
  }

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

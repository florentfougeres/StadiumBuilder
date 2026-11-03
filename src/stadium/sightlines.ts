import { RoofStyle, StandConfig, StandSide } from './schema';

export interface SightlinePoint {
  row: number;
  tier: number;
  distanceX: number; // horizontal distance from focal point (touchline)
  eyeHeightY: number; // spectator eye height above pitch
  cValueMm: number; // C-value in millimeters
  viewingAngleDeg: number; // downward viewing angle to touchline
}

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
  grade: 'Optimal' | 'Conforme' | 'Acceptable' | 'Critique';
  hasColumnObstruction: boolean;
} {
  if (!stand.enabled || stand.rows <= 0) {
    return {
      points: [],
      minCValueMm: 0,
      avgCValueMm: 0,
      grade: 'Optimal',
      hasColumnObstruction: false,
    };
  }

  const isStandingKop = stand.seatingType === 'safe_standing';
  const hasVipLoges = stand.tiers >= 2 && stand.vipLoges !== false;
  const hasColumnObstruction = effectiveRoofStyle === 'column_supported';

  const eyeOffsetBase = isStandingKop && stand.tiers === 1 ? 1.52 : 1.15;
  const points: SightlinePoint[] = [];
  const baseDist = Math.max(2, stand.distanceToPitch + trackOffsetM);
  const tierStarts = getTierStartRows(stand.rows, stand.tiers);

  let curD = baseDist;
  let curY = stand.elevationStart;

  for (let r = 0; r < stand.rows; r++) {
    const tierIdx = tierStarts.findIndex((startRow, idx) =>
      idx === tierStarts.length - 1
        ? r >= startRow
        : r >= startRow && r < tierStarts[idx + 1]
    );
    const isTierFirstRow = tierStarts.includes(r);

    if (r > 0 && isTierFirstRow) {
      curD += 1.35;
      curY += hasVipLoges ? 2.75 : 1.6;
    }

    const effectiveRiser = tierRiserHeight(stand.riserHeight, tierIdx);
    const tierEyeOffset =
      isStandingKop && tierIdx === 0 ? 1.52 : eyeOffsetBase;
    const eyeHeight = curY + tierEyeOffset;

    const rawCVal = isTierFirstRow
      ? 145
      : computeRowCValueMm(curD, eyeHeight, effectiveRiser, stand.rowDepth);

    // Roof columns planted in upper third of stands obstruct rear rows slightly
    const colPenalty =
      hasColumnObstruction && r >= Math.floor(stand.rows * 0.66) ? 16 : 0;
    const cVal = Math.max(25, rawCVal - colPenalty);

    const viewingAngleDeg = Number(
      ((Math.atan2(eyeHeight, curD) * 180) / Math.PI).toFixed(1)
    );

    points.push({
      row: r + 1,
      tier: tierIdx + 1,
      distanceX: Number(curD.toFixed(2)),
      eyeHeightY: Number(eyeHeight.toFixed(2)),
      cValueMm: cVal,
      viewingAngleDeg,
    });

    curD += stand.rowDepth;
    curY += effectiveRiser;
  }

  const nonBalconyRows = points.filter((p) => !tierStarts.includes(p.row - 1));
  const evaluated = nonBalconyRows.length > 0 ? nonBalconyRows : points;
  const minCValueMm = Math.min(...evaluated.map((p) => p.cValueMm));
  const sum = evaluated.reduce((acc, p) => acc + p.cValueMm, 0);
  const avgCValueMm = Math.round(sum / evaluated.length);

  return {
    points,
    minCValueMm,
    avgCValueMm,
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

import { buildShapeBowlRing } from './bowlRing';
import {
  getEffectiveSunkenDepth,
  isContinuousBowlShape,
  RoofStyle,
  SeatingType,
  slopeDegFromRiser,
  StadiumDocument,
  StadiumMetrics,
  StandConfig,
  StandMetrics,
  StandSide,
} from './schema';
import { computeStandSightlines, getTierStartRows } from './sightlines';

const STAND_SIDES: StandSide[] = ['north', 'south', 'east', 'west'];

/**
 * Computes running track radial offset around pitch when athletics track is enabled.
 */
export function getTrackRadialOffset(doc: StadiumDocument): {
  sideOffset: number;
  endOffset: number;
} {
  if (!doc.pitch.hasTrack) {
    return { sideOffset: 0, endOffset: 0 };
  }
  const laneWidth = 1.22;
  const trackWidth = doc.pitch.trackLanes * laneWidth + 2.5;
  return {
    sideOffset: trackWidth,
    endOffset: trackWidth + 14.5,
  };
}

function getAdjacentStands(side: StandSide): [StandSide, StandSide] {
  if (side === 'north' || side === 'south') {
    return ['east', 'west'];
  }
  return ['north', 'south'];
}

export function resolveStandRoofStyle(
  doc: StadiumDocument,
  side: StandSide
): RoofStyle {
  const stand = doc.stands[side];
  if (
    !isContinuousBowlShape(doc.shape) &&
    stand.roofStyleOverride &&
    stand.roofStyleOverride !== 'inherit'
  ) {
    return stand.roofStyleOverride;
  }
  return doc.roof.style;
}

/**
 * Computes deployable modular lower-tier parameters for `seatingType === 'telescopic'`.
 * Guarantees front edge stays strictly >= 3.6m outside the pitch boundary (zero pitch intrusion).
 */
export function computeTelescopicProjection(
  doc: StadiumDocument,
  side: StandSide
): { extraRows: number; advanceMeters: number } {
  const stand = doc.stands[side];
  if (!stand.enabled || stand.seatingType !== 'telescopic') {
    return { extraRows: 0, advanceMeters: 0 };
  }
  const isSide = side === 'north' || side === 'south';
  const trackOffsets = getTrackRadialOffset(doc);
  const trackExtra = isSide ? trackOffsets.sideOffset : trackOffsets.endOffset;
  const availableClearance = Math.max(0, stand.distanceToPitch + trackExtra - 3.6);
  if (availableClearance < 2.2) {
    return { extraRows: 0, advanceMeters: 0 };
  }
  const advanceMeters = Math.min(8.4, availableClearance);
  const extraRows = Math.max(3, Math.floor(advanceMeters / 0.78));
  return { extraRows, advanceMeters };
}

/**
 * Calibrates a 1-tier steep "Mur / Kop" stand (`tiers: 1`) so its total crest height (`maxHeight`)
 * aligns accurately with the tallest multi-tier neighbour stand in the stadium!
 */
export function computeKopWallStandPatch(
  doc: StadiumDocument,
  side: StandSide,
  seatingType: SeatingType = 'safe_standing'
): Partial<StandConfig> {
  const stand = doc.stands[side];
  const otherHeights = STAND_SIDES.filter((s) => s !== side)
    .map((s) => calculateStandMetrics(doc, s))
    .filter((m) => m.enabled)
    .map((m) => m.maxHeight);

  const currentMetrics = calculateStandMetrics(doc, side);
  const targetHeight =
    otherHeights.length > 0
      ? Math.max(...otherHeights)
      : Math.max(28, currentMetrics.maxHeight);

  const cauldronBoost = doc.shape === 'steep_cauldron' ? 1.05 : 1.0;
  const rowDepth = 0.75;
  const requiredRise = Math.max(8, targetHeight - stand.elevationStart - 1.85);

  // Target steep Kop inclination ~36°
  const preferredRiser = Math.tan((36 * Math.PI) / 180) * rowDepth;
  const rows = Math.max(
    14,
    Math.min(108, Math.round(requiredRise / (preferredRiser * cauldronBoost)))
  );

  const rawRiser = requiredRise / (rows * cauldronBoost);
  const minRiser = Math.tan((22 * Math.PI) / 180) * rowDepth;
  const maxRiser = Math.tan((38.5 * Math.PI) / 180) * rowDepth;
  const riserHeight = Number(
    Math.max(minRiser, Math.min(maxRiser, rawRiser)).toFixed(4)
  );
  const slopeAngleDeg = slopeDegFromRiser(riserHeight, rowDepth);

  return {
    tiers: 1,
    rows,
    rowDepth,
    riserHeight,
    slopeAngleDeg,
    seatingType,
    vipLoges: false,
  };
}

/**
 * Geometric capacity & dimensional engine integrating Steiner perimeter expansion,
 * cantilevered multi-tier overhangs (1 to 5 tiers), safe-standing terraces, telescopic lower rings,
 * and VIP loggia seating across all 9 morphologies.
 */
export function calculateStandMetrics(
  doc: StadiumDocument,
  side: StandSide
): StandMetrics {
  const stand: StandConfig = doc.stands[side];
  const isHorseshoeOpenEnd = doc.shape === 'horseshoe' && side === 'east';
  const effectiveEnabled = stand.enabled && !isHorseshoeOpenEnd;

  const seatingType: SeatingType = stand.seatingType ?? 'seated';
  const hasVipLoges = stand.tiers >= 2 && stand.vipLoges !== false;

  const isSideStand = side === 'north' || side === 'south';
  const trackOffsets = getTrackRadialOffset(doc);
  const trackExtra = isSideStand ? trackOffsets.sideOffset : trackOffsets.endOffset;

  const baseSpan = isSideStand ? doc.pitch.length : doc.pitch.width;
  const hasClosedCorners =
    isContinuousBowlShape(doc.shape) ||
    doc.shape === 'compact_urban' ||
    (doc.shape === 'english_rectangular' && doc.cornerFill);

  const avgDistX =
    (doc.stands.east.distanceToPitch + doc.stands.west.distanceToPitch) * 0.5;
  const avgDistZ =
    (doc.stands.north.distanceToPitch + doc.stands.south.distanceToPitch) * 0.5;

  const bowlRing = isContinuousBowlShape(doc.shape)
    ? buildShapeBowlRing(
        doc.shape,
        doc.pitch.length,
        doc.pitch.width,
        avgDistX,
        avgDistZ,
        trackOffsets.endOffset,
        trackOffsets.sideOffset,
        doc.pitch.hasTrack
      )
    : buildShapeBowlRing(
        'modern_bowl',
        doc.pitch.length,
        doc.pitch.width,
        avgDistX,
        avgDistZ,
        trackOffsets.endOffset,
        trackOffsets.sideOffset,
        doc.pitch.hasTrack
      );

  let straightFrontSpan = baseSpan;
  let cornerQuadrants = 0;

  if (hasClosedCorners) {
    straightFrontSpan = isSideStand
      ? bowlRing.halfStraightX * 2
      : bowlRing.halfStraightZ * 2;
    if (doc.shape === 'horseshoe') {
      cornerQuadrants = side === 'west' ? 1.0 : isSideStand ? 0.65 : 0;
    } else {
      const [adjA, adjB] = getAdjacentStands(side);
      cornerQuadrants =
        (doc.stands[adjA].enabled ? 0.5 : 0.8) +
        (doc.stands[adjB].enabled ? 0.5 : 0.8);
    }
  } else if (doc.shape === 'four_stands') {
    straightFrontSpan = isSideStand ? baseSpan + 14 : baseSpan + 12;
  } else {
    straightFrontSpan = isSideStand ? baseSpan + 8 : baseSpan + 6;
  }

  const innerCornerArcPerQuadrant = bowlRing.facetedCorners
    ? Math.SQRT2 * bowlRing.cornerRadius
    : (Math.PI / 2) * bowlRing.cornerRadius;

  const effectiveLength = Number(
    (straightFrontSpan + cornerQuadrants * innerCornerArcPerQuadrant).toFixed(1)
  );

  const tierStarts = getTierStartRows(stand.rows, stand.tiers);
  const upperTierCount = Math.max(0, tierStarts.length - 1);

  const overhangStepM = doc.shape === 'steep_cauldron' ? -1.4 : -1.15;
  const tierOverhangNetStep = overhangStepM * upperTierCount;
  const walkwayUnitH = hasVipLoges ? 2.85 : 1.6;
  const tierWalkwayHeight = upperTierCount * walkwayUnitH;

  let cumulativeRiserHeight = 0;
  for (let r = 0; r < stand.rows; r++) {
    const tIdx = tierStarts.findIndex((sr, idx) =>
      idx === tierStarts.length - 1 ? r >= sr : r >= sr && r < tierStarts[idx + 1]
    );
    const cauldronBoost = doc.shape === 'steep_cauldron' ? 1.05 : 1.0;
    cumulativeRiserHeight +=
      stand.riserHeight * (1 + Math.max(0, tIdx) * 0.08) * cauldronBoost;
  }

  const totalDepth = effectiveEnabled
    ? Number(
        Math.max(
          8,
          stand.rows * stand.rowDepth + tierOverhangNetStep + 2.8
        ).toFixed(2)
      )
    : 0;

  const maxHeight = effectiveEnabled
    ? Number(
        (
          stand.elevationStart +
          cumulativeRiserHeight +
          tierWalkwayHeight +
          1.85
        ).toFixed(2)
      )
    : 0;

  const slopeDegrees =
    stand.slopeAngleDeg !== undefined
      ? Number(stand.slopeAngleDeg.toFixed(1))
      : slopeDegFromRiser(stand.riserHeight, stand.rowDepth);

  if (!effectiveEnabled || stand.rows <= 0) {
    return {
      side,
      name: stand.name,
      enabled: false,
      effectiveLength,
      totalDepth: 0,
      maxHeight: 0,
      slopeDegrees,
      tiers: stand.tiers,
      seatingType,
      vipLoges: hasVipLoges,
      seatsPerRow: 0,
      totalRows: 0,
      capacity: 0,
      minCValueMm: 0,
      avgCValueMm: 0,
      sightlineGrade: 'Optimal',
    };
  }

  const totalAisleWidth = stand.aisleCount * (stand.aisleWidth * 0.82);
  const cornerExpansionEfficiency = bowlRing.facetedCorners
    ? 0.92
    : isContinuousBowlShape(doc.shape)
    ? 1.08
    : doc.shape === 'compact_urban'
    ? 0.96
    : 0.9;

  const multiTierWingBonus = 1 + upperTierCount * 0.068;
  const safeSeatWidth = Math.max(0.44, stand.seatWidth * 0.94);

  let totalRowSeats = 0;
  let curOutwardD = 0.4;

  for (let r = 0; r < stand.rows; r++) {
    if (r > 0 && tierStarts.includes(r)) {
      curOutwardD = Math.max(2.0, curOutwardD + overhangStepM);
    }

    const tierIdx = tierStarts.findIndex((sr, idx) =>
      idx === tierStarts.length - 1 ? r >= sr : r >= sr && r < tierStarts[idx + 1]
    );

    const openEndWingFlare = cornerQuadrants === 0 ? curOutwardD * 0.38 : 0;
    const cornerDelta = bowlRing.facetedCorners
      ? 2 * (Math.SQRT2 - 1) * curOutwardD * cornerExpansionEfficiency
      : (Math.PI / 2) * curOutwardD * cornerExpansionEfficiency;

    const rowArcSpan =
      straightFrontSpan * multiTierWingBonus +
      openEndWingFlare +
      cornerQuadrants * (innerCornerArcPerQuadrant + cornerDelta);

    const netSeatLen = Math.max(0, (rowArcSpan - totalAisleWidth) * 0.975);
    const baseRowCount = Math.floor(netSeatLen / safeSeatWidth);

    // Safe standing terrace boosts spectator density (~1.34x) on the standing tier (full wall if 1 tier, lower tier if multi-tier)
    const standingDensityFactor =
      seatingType === 'safe_standing' && (stand.tiers === 1 || tierIdx === 0)
        ? 1.34
        : 1.0;

    totalRowSeats += Math.round(baseRowCount * standingDensityFactor);
    curOutwardD += stand.rowDepth;
  }

  // Telescopic pitch-side lower tiers add deployable modular rows
  const tele = computeTelescopicProjection(doc, side);
  const telescopicSeats =
    tele.extraRows > 0
      ? tele.extraRows *
        Math.floor(Math.max(0, (straightFrontSpan - totalAisleWidth) * 0.92) / safeSeatWidth)
      : 0;

  const skyboxBaysPerLevel = Math.floor((effectiveLength * 0.85) / 5.2);
  const hospitalitySeats = hasVipLoges ? upperTierCount * skyboxBaysPerLevel * 14 : 0;

  const capacity = totalRowSeats + telescopicSeats + hospitalitySeats;
  const totalEffectiveRows = stand.rows + tele.extraRows;
  const seatsPerRow = Math.round(capacity / Math.max(1, totalEffectiveRows));

  const effectiveRoof = resolveStandRoofStyle(doc, side);
  const sightlines = computeStandSightlines(stand, trackExtra, effectiveRoof);

  return {
    side,
    name: stand.name,
    enabled: true,
    effectiveLength,
    totalDepth,
    maxHeight,
    slopeDegrees,
    tiers: stand.tiers,
    seatingType,
    vipLoges: hasVipLoges,
    seatsPerRow,
    totalRows: stand.rows,
    capacity,
    minCValueMm: sightlines.minCValueMm,
    avgCValueMm: sightlines.avgCValueMm,
    sightlineGrade: sightlines.grade,
  };
}

/**
 * Pure calculation of overall stadium KPIs: total capacity, built surface, roof height, budget estimate
 */
export function calculateStadiumMetrics(doc: StadiumDocument): StadiumMetrics {
  const standsMetrics = {
    north: calculateStandMetrics(doc, 'north'),
    south: calculateStandMetrics(doc, 'south'),
    east: calculateStandMetrics(doc, 'east'),
    west: calculateStandMetrics(doc, 'west'),
  };

  const activeStands = STAND_SIDES.map((s) => standsMetrics[s]).filter((m) => m.enabled);

  const totalCapacity = activeStands.reduce((sum, s) => sum + s.capacity, 0);
  const totalRowsAvg =
    activeStands.length > 0
      ? Math.round(
          activeStands.reduce((sum, s) => sum + s.totalRows, 0) / activeStands.length
        )
      : 0;

  const maxStandHeight = activeStands.reduce((max, s) => Math.max(max, s.maxHeight), 0);
  const maxRoofHeight =
    doc.roof.style === 'none'
      ? maxStandHeight
      : doc.roof.style === 'fixed_dome'
      ? Number((maxStandHeight + doc.roof.heightOffset + 22).toFixed(1))
      : doc.roof.style === 'giant_arch'
      ? Number((maxStandHeight + doc.roof.heightOffset + 38).toFixed(1))
      : Number((maxStandHeight + doc.roof.heightOffset).toFixed(1));

  const standsFootprint = activeStands.reduce(
    (sum, s) => sum + s.effectiveLength * s.totalDepth * 1.15,
    0
  );

  const objectsFootprint = doc.objects.reduce((sum, obj) => {
    const scaleFactor = obj.scale[0] * obj.scale[2];
    switch (obj.type) {
      case 'locker_room':
        return sum + 480 * scaleFactor;
      case 'shop':
        return sum + 320 * scaleFactor;
      case 'parking':
        return sum + 2400 * scaleFactor;
      case 'esplanade':
        return sum + 1800 * scaleFactor;
      default:
        return sum + 25 * scaleFactor;
    }
  }, 0);

  const builtFootprintM2 = Math.round(standsFootprint + objectsFootprint);

  const maxTiers = activeStands.reduce(
    (mx, s) => Math.max(mx, doc.stands[s.side].tiers),
    1
  );
  const tierFactor = 1.2 + maxTiers * 0.58;
  const totalGrossFloorAreaM2 = Math.round(
    standsFootprint * tierFactor + objectsFootprint * 0.65
  );

  let baseCostPerSeat = 2650 + (maxTiers - 1) * 310;
  if (isContinuousBowlShape(doc.shape)) baseCostPerSeat += 520;
  if (doc.shape === 'steep_cauldron') baseCostPerSeat += 180;
  if (doc.shape === 'compact_urban') baseCostPerSeat += 420;
  if (totalCapacity > 55000) baseCostPerSeat += 550;

  const sunkenDepth = getEffectiveSunkenDepth(doc);
  if (sunkenDepth > 0) {
    // Semi-buried excavation saves superstructure facade cost while adding earthworks/retaining wall
    baseCostPerSeat += Math.round(sunkenDepth * 22);
  }

  const envelopeStyle = doc.materials?.envelopeStyle ?? 'enveloping_skin';
  if (envelopeStyle === 'exposed_structure') {
    baseCostPerSeat -= 210;
  } else if (envelopeStyle === 'colonnade_forest') {
    baseCostPerSeat += 190;
  } else if (envelopeStyle === 'louver_curtain') {
    baseCostPerSeat += 150;
  }

  switch (doc.roof.style) {
    case 'column_supported':
      baseCostPerSeat += 310 * doc.roof.coverageRatio;
      break;
    case 'cantilever':
      baseCostPerSeat += 520 * doc.roof.coverageRatio;
      break;
    case 'truss':
      baseCostPerSeat += 560 * doc.roof.coverageRatio;
      break;
    case 'goalpost_truss':
      baseCostPerSeat += 720 * doc.roof.coverageRatio;
      break;
    case 'bowstring_arch':
      baseCostPerSeat += 780 * doc.roof.coverageRatio;
      break;
    case 'bicycle_wheel':
      baseCostPerSeat += 840 * doc.roof.coverageRatio;
      break;
    case 'tensile_net':
      baseCostPerSeat += 910 * doc.roof.coverageRatio;
      break;
    case 'enveloping_shell':
      baseCostPerSeat += 940 * doc.roof.coverageRatio;
      break;
    case 'suspended_masts':
      baseCostPerSeat += 980 * doc.roof.coverageRatio;
      break;
    case 'giant_arch':
      baseCostPerSeat += 1180 * doc.roof.coverageRatio;
      break;
    case 'retractable_arch':
      baseCostPerSeat += 1350 * doc.roof.coverageRatio;
      break;
    case 'fixed_dome':
      baseCostPerSeat += 1520 * doc.roof.coverageRatio;
      break;
  }

  const trackCostM = doc.pitch.hasTrack ? 5.2 : 0;
  const objectsCostM = doc.objects.reduce((sum, obj) => {
    switch (obj.type) {
      case 'screen':
        return sum + 1.4;
      case 'floodlight':
        return sum + 0.65;
      case 'locker_room':
        return sum + 3.4;
      case 'shop':
        return sum + 1.9;
      case 'parking':
        return sum + 2.5;
      case 'esplanade':
        return sum + 1.6;
      case 'custom_roof':
        return sum + 2.8;
      default:
        return sum + 0.15;
    }
  }, 0);

  const seatsBudgetM = (totalCapacity * baseCostPerSeat) / 1_000_000;
  const estimatedBudgetMillionsEur = Number(
    (seatsBudgetM + trackCostM + objectsCostM).toFixed(1)
  );
  const costPerSeatEur =
    totalCapacity > 0
      ? Math.round((estimatedBudgetMillionsEur * 1_000_000) / totalCapacity)
      : 0;

  const avgCValueMm =
    activeStands.length > 0
      ? Math.round(
          activeStands.reduce((sum, s) => sum + s.avgCValueMm, 0) / activeStands.length
        )
      : 0;
  const minCValueMm =
    activeStands.length > 0
      ? Math.min(...activeStands.map((s) => s.minCValueMm))
      : 0;

  return {
    totalCapacity,
    totalRowsAvg,
    maxRoofHeight,
    builtFootprintM2,
    totalGrossFloorAreaM2,
    estimatedBudgetMillionsEur,
    costPerSeatEur,
    avgCValueMm,
    minCValueMm,
    stands: standsMetrics,
  };
}

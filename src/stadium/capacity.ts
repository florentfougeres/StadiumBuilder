import { buildShapeBowlRing } from './bowlRing';
import {
  clampPitchToTrack,
  CornerId,
  getEffectiveSunkenDepth,
  getTrackGeometry,
  isContinuousBowlShape,
  resolveAllCorners,
  resolveFloodlightRig,
  resolveStandVomitories,
  RoofStyle,
  SeatingType,
  slopeDegFromRiser,
  StadiumDocument,
  StadiumMetrics,
  StandConfig,
  StandMetrics,
  StandSide,
} from './schema';
import { computeStandSection, computeStandSightlines, resolveStandTiers } from './sightlines';

const STAND_SIDES: StandSide[] = ['north', 'south', 'east', 'west'];

/**
 * Computes running track radial offset around the clamped pitch when the official 400m athletics
 * track is enabled, so `safePitch.width / 2 + sideOffset` and `safePitch.length / 2 + endOffset`
 * align with the outer perimeter of the 400m track (`84.39m` straights, `36.5m` kerb radius).
 */
export function getTrackRadialOffset(doc: StadiumDocument): {
  sideOffset: number;
  endOffset: number;
} {
  if (!doc.pitch.hasTrack) {
    return { sideOffset: 0, endOffset: 0 };
  }
  const safePitch = clampPitchToTrack(doc.pitch);
  const track = getTrackGeometry(safePitch);
  return {
    sideOffset: Math.max(0, track.outerHalfWidthZ - safePitch.width * 0.5),
    endOffset: Math.max(0, track.outerHalfLengthX - safePitch.length * 0.5),
  };
}

function getAdjacentCornersAndStands(
  side: StandSide
): Array<{ corner: CornerId; adjSide: StandSide }> {
  switch (side) {
    case 'north':
      return [
        { corner: 'nw', adjSide: 'west' },
        { corner: 'ne', adjSide: 'east' },
      ];
    case 'south':
      return [
        { corner: 'sw', adjSide: 'west' },
        { corner: 'se', adjSide: 'east' },
      ];
    case 'east':
      return [
        { corner: 'ne', adjSide: 'north' },
        { corner: 'se', adjSide: 'south' },
      ];
    case 'west':
      return [
        { corner: 'nw', adjSide: 'north' },
        { corner: 'sw', adjSide: 'south' },
      ];
  }
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
  const availableClearance = doc.pitch.hasTrack
    ? Math.max(0, stand.distanceToPitch - 1.5)
    : Math.max(0, stand.distanceToPitch - 3.6);
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
    tierConfigs: undefined,
    seatingType,
    vipLoges: false,
  };
}

/**
 * Geometric capacity & dimensional engine integrating Steiner perimeter expansion,
 * cantilevered multi-tier overhangs (1 to 5 asymmetric tiers), carved vomitories,
 * custom per-corner modes, safe-standing terraces, telescopic lower rings, and VIP loggias.
 */
export function calculateStandMetrics(
  doc: StadiumDocument,
  side: StandSide
): StandMetrics {
  const stand: StandConfig = doc.stands[side];
  const isHorseshoeOpenEnd = doc.shape === 'horseshoe' && side === 'east';
  const effectiveEnabled = stand.enabled && !isHorseshoeOpenEnd;

  const tierSpecs = resolveStandTiers(stand);
  const totalStandRows = tierSpecs.reduce((sum, t) => sum + t.rows, 0);
  const upperTierCount = Math.max(0, tierSpecs.length - 1);

  const seatingType: SeatingType = stand.seatingType ?? 'seated';
  const hasVipLoges = tierSpecs.length >= 2 && stand.vipLoges !== false;

  const safePitch = clampPitchToTrack(doc.pitch);
  const isSideStand = side === 'north' || side === 'south';
  const trackOffsets = getTrackRadialOffset(doc);
  const trackExtra = isSideStand ? trackOffsets.sideOffset : trackOffsets.endOffset;

  const baseSpan = isSideStand ? safePitch.length : safePitch.width;
  const cornerModes = resolveAllCorners(doc);
  const adjEnds = getAdjacentCornersAndStands(side);

  const avgDistX =
    (doc.stands.east.distanceToPitch + doc.stands.west.distanceToPitch) * 0.5;
  const avgDistZ =
    (doc.stands.north.distanceToPitch + doc.stands.south.distanceToPitch) * 0.5;

  const bowlRing = isContinuousBowlShape(doc.shape)
    ? buildShapeBowlRing(
        doc.shape,
        safePitch.length,
        safePitch.width,
        avgDistX,
        avgDistZ,
        trackOffsets.endOffset,
        trackOffsets.sideOffset,
        safePitch.hasTrack
      )
    : buildShapeBowlRing(
        'modern_bowl',
        safePitch.length,
        safePitch.width,
        avgDistX,
        avgDistZ,
        trackOffsets.endOffset,
        trackOffsets.sideOffset,
        safePitch.hasTrack
      );

  const trimmedSpan = isSideStand
    ? bowlRing.halfStraightX * 2
    : bowlRing.halfStraightZ * 2;
  const openSpan =
    doc.shape === 'four_stands'
      ? isSideStand
        ? baseSpan + 14
        : baseSpan + 12
      : isSideStand
      ? baseSpan + 8
      : baseSpan + 6;

  let straightFrontSpan = 0;
  let cornerQuadrants = 0;

  if (doc.shape === 'horseshoe' && !doc.corners) {
    straightFrontSpan = trimmedSpan;
    cornerQuadrants = side === 'west' ? 1.0 : isSideStand ? 0.65 : 0;
  } else {
    for (const { corner, adjSide } of adjEnds) {
      const mode = cornerModes[corner];
      const adjLive = doc.stands[adjSide].enabled && !(doc.shape === 'horseshoe' && adjSide === 'east');
      const endTrimmed =
        (mode === 'filled' || mode === 'building') &&
        (adjLive || isContinuousBowlShape(doc.shape));
      straightFrontSpan += 0.5 * (endTrimmed ? trimmedSpan : openSpan);

      if (mode === 'filled') {
        if (doc.shape === 'horseshoe' && isSideStand) {
          cornerQuadrants += 0.65;
        } else {
          cornerQuadrants += adjLive ? 0.5 : 0.8;
        }
      }
    }
  }

  const innerCornerArcPerQuadrant = bowlRing.facetedCorners
    ? Math.SQRT2 * bowlRing.cornerRadius
    : (Math.PI / 2) * bowlRing.cornerRadius;

  const effectiveLength = Number(
    (straightFrontSpan + cornerQuadrants * innerCornerArcPerQuadrant).toFixed(1)
  );

  const section = computeStandSection(stand);
  // Cauldrons are drawn ~5% steeper than their nominal risers (see the bowl sweep).
  const cauldronRise =
    doc.shape === 'steep_cauldron'
      ? 0.05 * section.rows.reduce((acc, r) => acc + r.riser, 0)
      : 0;

  const totalDepth = effectiveEnabled
    ? Number(Math.max(8, section.totalDepth).toFixed(2))
    : 0;

  const maxHeight = effectiveEnabled
    ? Number((section.topHeight + cauldronRise).toFixed(2))
    : 0;

  const weightedSlopeSum = tierSpecs.reduce(
    (acc, t) => acc + t.slopeAngleDeg * t.rows,
    0
  );
  const slopeDegrees =
    stand.tierConfigs && stand.tierConfigs.length > 0 && totalStandRows > 0
      ? Number((weightedSlopeSum / totalStandRows).toFixed(1))
      : stand.slopeAngleDeg !== undefined
      ? Number(stand.slopeAngleDeg.toFixed(1))
      : slopeDegFromRiser(stand.riserHeight, stand.rowDepth);

  if (!effectiveEnabled || totalStandRows <= 0) {
    return {
      side,
      name: stand.name,
      enabled: false,
      effectiveLength,
      totalDepth: 0,
      maxHeight: 0,
      slopeDegrees,
      tiers: tierSpecs.length,
      seatingType,
      vipLoges: hasVipLoges,
      seatsPerRow: 0,
      totalRows: 0,
      capacity: 0,
      minCValueMm: 0,
      avgCValueMm: 0,
      sightlineGrade: 'Optimal',
      evacuationMinutes: 0,
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

  for (const row of section.rows) {
    const curOutwardD = row.d + 0.06;
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

    const standingDensityFactor =
      seatingType === 'safe_standing' && (tierSpecs.length === 1 || row.tierIdx === 0)
        ? 1.34
        : 1.0;

    totalRowSeats += Math.round(baseRowCount * standingDensityFactor);
  }

  // Account for custom vomitory portal cutouts relative to baseline
  if (stand.vomitoryCount !== undefined) {
    const defaultVom = Math.max(2, Math.min(8, Math.round(stand.aisleCount * 0.5)));
    const resolvedVom = resolveStandVomitories(stand);
    const deltaPortals = resolvedVom.count - defaultVom;
    const seatsPerPortal = Math.round((2.8 / safeSeatWidth) * 5);
    totalRowSeats = Math.max(
      120,
      totalRowSeats - deltaPortals * tierSpecs.length * seatsPerPortal
    );
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
  const totalEffectiveRows = totalStandRows + tele.extraRows;
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
    tiers: tierSpecs.length,
    seatingType,
    vipLoges: hasVipLoges,
    seatsPerRow,
    totalRows: totalStandRows,
    capacity,
    minCValueMm: sightlines.minCValueMm,
    avgCValueMm: sightlines.avgCValueMm,
    sightlineGrade: sightlines.grade,
    evacuationMinutes: computeEvacuationMinutes(stand, tierSpecs, capacity),
  };
}

/** Green Guide rate of passage on stairways and through vomitories (persons per metre per minute). */
const STAIRWAY_FLOW_PER_M_MIN = 79;
/** Clear width of one vomitory mouth (m), as drawn by the 3D portals. */
const VOMITORY_WIDTH_M = 1.8;

/**
 * Each tier empties through its own vomitories; a tier without any falls back to its radial
 * stairways. The stand takes as long as its slowest tier (Green Guide target: 8 min or less).
 */
function computeEvacuationMinutes(
  stand: StandConfig,
  tierSpecs: ReturnType<typeof resolveStandTiers>,
  capacity: number
): number {
  const totalRows = tierSpecs.reduce((acc, t) => acc + t.rows, 0);
  if (capacity <= 0 || totalRows <= 0) return 0;
  const vomitories = resolveStandVomitories(stand).count;
  const exitWidth =
    vomitories > 0
      ? vomitories * VOMITORY_WIDTH_M
      : Math.max(1, stand.aisleCount) * stand.aisleWidth;
  const worst = Math.max(
    ...tierSpecs.map((t) => (capacity * t.rows) / totalRows / (exitWidth * STAIRWAY_FLOW_PER_M_MIN))
  );
  return Number(worst.toFixed(1));
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

  const cornerModes = resolveAllCorners(doc);
  const cornerBuildingCount = (['nw', 'ne', 'sw', 'se'] as CornerId[]).filter(
    (c) => cornerModes[c] === 'building'
  ).length;
  const cornerScreenCount = (['nw', 'ne', 'sw', 'se'] as CornerId[]).filter(
    (c) => cornerModes[c] === 'screen'
  ).length;

  const cornerHospitalitySeats = doc.corners ? cornerBuildingCount * 220 : 0;
  const totalCapacity =
    activeStands.reduce((sum, s) => sum + s.capacity, 0) + cornerHospitalitySeats;

  const totalRowsAvg =
    activeStands.length > 0
      ? Math.round(
          activeStands.reduce((sum, s) => sum + s.totalRows, 0) / activeStands.length
        )
      : 0;

  const maxStandHeight = activeStands.reduce((max, s) => Math.max(max, s.maxHeight), 0);
  const rigMode = resolveFloodlightRig(doc);
  const mastHeight =
    rigMode === 'corner_masts' || rigMode === 'both' ? maxStandHeight + 16 : 0;
  const roofStructuralHeight =
    doc.roof.style === 'none'
      ? maxStandHeight
      : doc.roof.style === 'fixed_dome'
      ? Number((maxStandHeight + doc.roof.heightOffset + 22).toFixed(1))
      : doc.roof.style === 'giant_arch'
      ? Number((maxStandHeight + doc.roof.heightOffset + 38).toFixed(1))
      : doc.roof.style === 'twin_arch'
      ? Number((maxStandHeight + Math.max(4, doc.roof.heightOffset) + 29).toFixed(1))
      : Number((maxStandHeight + doc.roof.heightOffset).toFixed(1));
  const maxRoofHeight = Number(Math.max(roofStructuralHeight, mastHeight).toFixed(1));

  const standsFootprint = activeStands.reduce(
    (sum, s) => sum + s.effectiveLength * s.totalDepth * 1.15,
    0
  );
  const cornersFootprint = cornerBuildingCount * 620 + cornerScreenCount * 48;

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

  const builtFootprintM2 = Math.round(standsFootprint + cornersFootprint + objectsFootprint);

  const maxTiers = activeStands.reduce(
    (mx, s) => Math.max(mx, doc.stands[s.side].tiers),
    1
  );
  const tierFactor = 1.2 + maxTiers * 0.58;
  const totalGrossFloorAreaM2 = Math.round(
    standsFootprint * tierFactor + cornerBuildingCount * 2480 + objectsFootprint * 0.65
  );

  let baseCostPerSeat = 2650 + (maxTiers - 1) * 310;
  if (isContinuousBowlShape(doc.shape)) baseCostPerSeat += 520;
  if (doc.shape === 'steep_cauldron') baseCostPerSeat += 180;
  if (doc.shape === 'compact_urban') baseCostPerSeat += 420;
  if (totalCapacity > 55000) baseCostPerSeat += 550;

  const sunkenDepth = getEffectiveSunkenDepth(doc);
  if (sunkenDepth > 0) {
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

  const facadePattern = doc.materials?.facadePattern ?? 'none';
  const facadeDensity = doc.materials?.facadeDensity ?? 1.0;
  if (facadePattern === 'vertical_fins') {
    baseCostPerSeat += Math.round(145 * facadeDensity);
  } else if (facadePattern === 'diagrid') {
    baseCostPerSeat += Math.round(235 * facadeDensity);
  } else if (facadePattern === 'cassette_panels') {
    baseCostPerSeat += Math.round(175 * facadeDensity);
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
    case 'twin_arch':
      baseCostPerSeat += 1100 * doc.roof.coverageRatio;
      break;
    case 'vaulted_ring':
      baseCostPerSeat += 960 * doc.roof.coverageRatio;
      break;
    case 'folded_plate':
      baseCostPerSeat += 900 * doc.roof.coverageRatio;
      break;
    case 'retractable':
    case 'petal_iris':
      baseCostPerSeat += 1350 * doc.roof.coverageRatio;
      break;
    case 'fixed_dome':
      baseCostPerSeat += 1520 * doc.roof.coverageRatio;
      break;
  }

  if (doc.roof.skylightMode && doc.roof.skylightMode !== 'none') {
    baseCostPerSeat += Math.round(95 * (doc.roof.skylightRatio ?? 0.3));
  }

  const trackCostM = doc.pitch.hasTrack ? 5.2 : 0;
  const cornerStructuresCostM = cornerBuildingCount * 4.8 + cornerScreenCount * 1.6;
  const floodlightRigCostM =
    doc.floodlightRig === 'corner_masts'
      ? 2.6
      : doc.floodlightRig === 'both'
      ? 3.4
      : 0;

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
    (
      seatsBudgetM +
      trackCostM +
      cornerStructuresCostM +
      floodlightRigCostM +
      objectsCostM
    ).toFixed(1)
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
    evacuationMinutes: activeStands.reduce((max, s) => Math.max(max, s.evacuationMinutes), 0),
    stands: standsMetrics,
  };
}

import { buildShapeBowlRing, computeRectangularCornerLayout, ringSideSpans } from './bowlRing';
import { CORNER_ACCESS_DECK_Y, CORNER_ACCESS_WIDTH } from './generateCornerAccess';
import {
  clampPitchToTrack,
  CornerId,
  getEffectiveSunkenDepth,
  getTrackGeometry,
  isContinuousBowlShape,
  resolveAllCorners,
  resolveCornerPylonFrame,
  resolveFloodlightRig,
  resolveStandVomitories,
  vomitoryLevelsOfTier,
  resolveWaveAmplitude,
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
  const safePitch = clampPitchToTrack(doc.pitch);
  if (!safePitch.hasTrack) {
    return { sideOffset: 0, endOffset: 0 };
  }
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
        safePitch.hasTrack,
    doc.cornerRoundness
      )
    : buildShapeBowlRing(
        'modern_bowl',
        safePitch.length,
        safePitch.width,
        avgDistX,
        avgDistZ,
        trackOffsets.endOffset,
        trackOffsets.sideOffset,
        safePitch.hasTrack,
        undefined,
        true
      );

  const spans = ringSideSpans(bowlRing);
  const trimmedSpan = isSideStand ? spans.longSide : spans.end;
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

  // Seated corners crossed by a vehicle tunnel (the horseshoe's open end has none).
  let tunnelCorners = adjEnds.filter(
    ({ corner }) =>
      doc.cornerAccess?.[corner] &&
      cornerModes[corner] === 'filled' &&
      !(doc.shape === 'horseshoe' && (corner === 'ne' || corner === 'se'))
  ).length;

  let cornerRadius = bowlRing.cornerRadius;
  if (!isContinuousBowlShape(doc.shape)) {
    // Separate stands: the same spans and corner quadrants the 3D stands are built on.
    const layout = computeRectangularCornerLayout({
      shape: doc.shape,
      cornerFill: doc.cornerFill,
      cornerModes,
      crossSectionClip: false,
      pitchLength: safePitch.length,
      pitchWidth: safePitch.width,
      endTrackOffset: trackOffsets.endOffset,
      sideTrackOffset: trackOffsets.sideOffset,
      stands: doc.stands,
    });
    straightFrontSpan = layout.straight[side].span;
    const seatedCorners = adjEnds
      .map(({ corner }) => layout.corners[corner])
      .filter((c) => c.active && c.mode === 'filled');
    // Each seated corner is shared with the neighbouring stand.
    cornerQuadrants = seatedCorners.length * 0.5;
    tunnelCorners = seatedCorners.filter((c) => doc.cornerAccess?.[c.id]).length;
    if (seatedCorners.length > 0) {
      cornerRadius = seatedCorners.reduce((sum, c) => sum + c.radius, 0) / seatedCorners.length;
    }
  }

  // A bowl's corner is the ring's own (shorter than a quarter circle once the sides are bowed).
  const innerCornerArcPerQuadrant = isContinuousBowlShape(doc.shape)
    ? spans.corner
    : (Math.PI / 2) * cornerRadius;

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

  // Same rules as the 3D seats (buildSweepSeatInstances): one seat per seat width along each row,
  // none within half an aisle plus 0.4 seat of an aisle's centre line.
  const safeSeatWidth = Math.max(0.42, stand.seatWidth);
  const totalAisleWidth = stand.aisleCount * (stand.aisleWidth + 0.8 * safeSeatWidth);

  let totalRowSeats = 0;

  for (const row of section.rows) {
    // Seats sit just past the middle of their tread, as in the 3D build.
    const curOutwardD = row.d + stand.rowDepth * 0.52;
    // A row set back by d runs along the corner offset by d: a quarter turn adds (π/2)·d, and a
    // mitered chamfer adds 2·tan(22.5°)·d at each of its two vertices.
    const cornerDelta = bowlRing.facetedCorners
      ? 4 * (Math.SQRT2 - 1) * curOutwardD
      : (Math.PI / 2) * curOutwardD;

    const rowArcSpan =
      straightFrontSpan +
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
  // (one row of the default count per tier is the baseline; extra rows of them take seats too).
  if (stand.vomitoryCount !== undefined || (stand.vomitoryLevels ?? 1) > 1) {
    const defaultVom = Math.max(2, Math.min(8, Math.round(stand.aisleCount * 0.5)));
    const resolvedVom = resolveStandVomitories(stand);
    const portals = tierSpecs.reduce((n, t) => n + resolvedVom.count * vomitoryLevelsOfTier(stand, t.rows), 0);
    const deltaPortals = portals - defaultVom * tierSpecs.length;
    const seatsPerPortal = Math.round((2.8 / safeSeatWidth) * 5);
    totalRowSeats = Math.max(120, totalRowSeats - deltaPortals * seatsPerPortal);
  }

  // A vehicle tunnel takes the rows under its deck over the access width, widening with the
  // corner's fan; each corner is shared with the neighbouring stand.
  if (tunnelCorners > 0) {
    const fanRadius = Math.max(4, innerCornerArcPerQuadrant / (Math.PI / 2));
    let lost = 0;
    for (const row of section.rows) {
      if (row.y >= CORNER_ACCESS_DECK_Y) continue;
      const d = row.d + stand.rowDepth * 0.52;
      lost += Math.floor((CORNER_ACCESS_WIDTH * (fanRadius + d)) / fanRadius / safeSeatWidth);
    }
    totalRowSeats = Math.max(0, totalRowSeats - Math.round(0.5 * tunnelCorners * lost));
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
  // Every row of vomitories of a tier adds its openings to that tier's exits.
  const exitWidth = (tierRows: number) =>
    vomitories > 0
      ? vomitories * vomitoryLevelsOfTier(stand, tierRows) * VOMITORY_WIDTH_M
      : Math.max(1, stand.aisleCount) * stand.aisleWidth;
  const worst = Math.max(
    ...tierSpecs.map((t) => (capacity * t.rows) / totalRows / (exitWidth(t.rows) * STAIRWAY_FLOW_PER_M_MIN))
  );
  return Number(worst.toFixed(1));
}

/**
 * Pure calculation of overall stadium KPIs: total capacity, built surface, roof height, budget estimate
 */
/**
 * Sets the row count of every enabled stand (ends at 92 % of the sides) so the total capacity
 * comes closest to `targetCapacity`, adding tiers as stands grow.
 */
export function fitStandRowsToCapacity(doc: StadiumDocument, targetCapacity: number): void {
  const sides: StandSide[] = ['north', 'south', 'east', 'west'];
  const active = sides.filter((s) => doc.stands[s].enabled);
  if (active.length === 0) return;

  const tiersForRows = (r: number): 1 | 2 | 3 | 4 | 5 =>
    r >= 70 ? 5 : r >= 54 ? 4 : r >= 38 ? 3 : r >= 24 ? 2 : 1;
  const applyRows = (target: StadiumDocument, rows: number) => {
    for (const s of active) {
      const isEnd = s === 'east' || s === 'west';
      const rCount = isEnd ? Math.max(6, Math.round(rows * 0.92)) : rows;
      target.stands[s].rows = rCount;
      if (target.stands[s].seatingType !== 'safe_standing' || target.stands[s].tiers > 1) {
        target.stands[s].tiers = tiersForRows(rCount);
      }
    }
  };

  let bestRows = 24;
  let smallestError = Infinity;
  for (let candidateRows = 6; candidateRows <= 104; candidateRows++) {
    const testDoc = structuredClone(doc);
    applyRows(testDoc, candidateRows);
    const err = Math.abs(calculateStadiumMetrics(testDoc).totalCapacity - targetCapacity);
    if (err < smallestError) {
      smallestError = err;
      bestRows = candidateRows;
    }
  }
  applyRows(doc, bestRows);
}

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
      : doc.roof.style === 'air_dome'
      ? Number((maxStandHeight + Math.max(2.4, doc.roof.heightOffset * 0.7) + 11).toFixed(1))
      : doc.roof.style === 'cable_dome'
      ? Number((maxStandHeight + Math.max(2.4, doc.roof.heightOffset * 0.7) + 14).toFixed(1))
      : doc.roof.style === 'giant_arch'
      ? Number((maxStandHeight + doc.roof.heightOffset + 38).toFixed(1))
      : doc.roof.style === 'timber_lattice'
      ? Number((maxStandHeight + Math.max(4, doc.roof.heightOffset) + 9).toFixed(1))
      : doc.roof.style === 'wave_canopy'
      ? Number((maxStandHeight + Math.max(4, doc.roof.heightOffset) + 1.8 + resolveWaveAmplitude(doc.roof)).toFixed(1))
      : doc.roof.style === 'concrete_portals'
      ? Number((maxStandHeight + Math.max(4, doc.roof.heightOffset) + 10.6).toFixed(1))
      : doc.roof.style === 'spanning_girders'
      ? Number((maxStandHeight + Math.max(2.8, doc.roof.heightOffset * 0.7) + 10).toFixed(1))
      : doc.roof.style === 'counterweighted_cantilever'
      ? Number((maxStandHeight + Math.max(4, doc.roof.heightOffset) + 10).toFixed(1))
      : doc.roof.style === 'corner_pylons'
      ? Number(resolveCornerPylonFrame(doc.roof, maxStandHeight).pylonTopY.toFixed(1))
      : doc.roof.style === 'crossed_arches'
      ? Number((maxStandHeight + Math.max(4, doc.roof.heightOffset) + 21).toFixed(1))
      : doc.roof.style === 'saddle_vault'
      ? Number((maxStandHeight + Math.max(4, doc.roof.heightOffset) + 14).toFixed(1))
      : doc.roof.style === 'rising_canopy' || doc.roof.style === 'dished_canopy'
      ? Number((maxStandHeight + Math.max(4, doc.roof.heightOffset) + 8).toFixed(1))
      : doc.roof.style === 'saucer_dome' || doc.roof.style === 'girder_grid'
      ? Number((maxStandHeight + Math.max(4, doc.roof.heightOffset) + 7.5).toFixed(1))
      : doc.roof.style === 'faceted_shell'
      ? Number((maxStandHeight + Math.max(4, doc.roof.heightOffset) + 4.5).toFixed(1))
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
  } else if (envelopeStyle === 'stacked_arcades') {
    baseCostPerSeat += 230;
  } else if (envelopeStyle === 'media_mesh') {
    baseCostPerSeat += 320;
  } else if (envelopeStyle === 'helical_ramps') {
    baseCostPerSeat += 260;
  } else if (envelopeStyle === 'horizontal_strata') {
    baseCostPerSeat += 210;
  }

  // Podium of shops and car parks under the forecourt.
  baseCostPerSeat += Math.round(Math.max(0, doc.site?.podiumHeight ?? 0) * 28);

  const facadePattern = doc.materials?.facadePattern ?? 'none';
  const facadeDensity = doc.materials?.facadeDensity ?? 1.0;
  if (facadePattern === 'vertical_fins') {
    baseCostPerSeat += Math.round(145 * facadeDensity);
  } else if (facadePattern === 'diagrid') {
    baseCostPerSeat += Math.round(235 * facadeDensity);
  } else if (facadePattern === 'cassette_panels') {
    baseCostPerSeat += Math.round(175 * facadeDensity);
  } else if (facadePattern === 'honeycomb') {
    baseCostPerSeat += Math.round(190 * facadeDensity);
  } else if (facadePattern === 'voronoi') {
    baseCostPerSeat += Math.round(260 * facadeDensity);
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
    case 'timber_lattice':
      baseCostPerSeat += 1260 * doc.roof.coverageRatio;
      break;
    case 'wave_canopy':
      baseCostPerSeat += 1320 * doc.roof.coverageRatio;
      break;
    case 'dished_canopy':
    case 'rising_canopy':
      baseCostPerSeat += 980 * doc.roof.coverageRatio;
      break;
    case 'pleated_crown':
    case 'faceted_shell':
      baseCostPerSeat += 1240 * doc.roof.coverageRatio;
      break;
    case 'saucer_dome':
    case 'saddle_vault':
      baseCostPerSeat += 1380 * doc.roof.coverageRatio;
      break;
    case 'girder_grid':
    case 'crossed_arches':
      baseCostPerSeat += 1300 * doc.roof.coverageRatio;
      break;
    case 'historic_gable':
    case 'sawtooth':
    case 'butterfly':
      baseCostPerSeat += 520 * doc.roof.coverageRatio;
      break;
    case 'barrel_vault':
    case 'tree_columns':
      baseCostPerSeat += 760 * doc.roof.coverageRatio;
      break;
    case 'hypar_shells':
      baseCostPerSeat += 880 * doc.roof.coverageRatio;
      break;
    case 'air_dome':
      baseCostPerSeat += 1050;
      break;
    case 'cable_dome':
      baseCostPerSeat += 1500;
      break;
    case 'concrete_portals':
      baseCostPerSeat += 1180 * doc.roof.coverageRatio;
      break;
    case 'spanning_girders':
      baseCostPerSeat += 1450 * doc.roof.coverageRatio;
      break;
    case 'counterweighted_cantilever':
      baseCostPerSeat += 1020 * doc.roof.coverageRatio;
      break;
    case 'corner_pylons':
      baseCostPerSeat += (doc.roof.spaceFrame ? 1280 : 1150) * doc.roof.coverageRatio;
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
      case 'inclined_mast':
        return sum + 38;
      case 'monumental_arch':
        return sum + 1.2;
      case 'monumental_gate':
        return sum + 0.8;
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

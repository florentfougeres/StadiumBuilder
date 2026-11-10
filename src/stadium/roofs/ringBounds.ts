import { resolveCornerFollow } from '../generateStand';
import { bowlCrestAtNormal, buildBowlSectionModel, usesBowlSectionModel } from '../bowlSection';
import { bowlSideWeights, buildShapeBowlRing, rectangularFootprintRay, MIN_PITCH_SETBACK, sampleRoundedBowlRing } from '../bowlRing';
import { calculateStandMetrics, getTrackRadialOffset, stadiumCornerLayout } from '../capacity';
import { clampPitchToTrack, isContinuousBowlShape, StadiumDocument, StandSide } from '../schema';

/**
 * Reach and crest height of separate stands along the ring normal `(nx, nz)`, from their real plan
 * footprint, or null where the normal meets no stand (an open corner).
 */
function footprintLookup(
  doc: StadiumDocument,
  ring: ReturnType<typeof buildShapeBowlRing>,
  metrics: Record<StandSide, { enabled: boolean; totalDepth: number; maxHeight: number }>
): (nx: number, nz: number) => { reach: number; height: number } | null {
  const section = (side: StandSide) => ({
    live: metrics[side].enabled && doc.stands[side].rows > 0,
    depth: metrics[side].totalDepth,
    height: metrics[side].maxHeight,
  });
  const ray = rectangularFootprintRay(stadiumCornerLayout(doc, false, resolveCornerFollow(doc)), {
    north: section('north'),
    south: section('south'),
    east: section('east'),
    west: section('west'),
  });
  const SAMPLES = 360;
  const table: { angle: number; reach: number; height: number }[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const p = sampleRoundedBowlRing(ring, i / SAMPLES, 0);
    const hit = ray(p.x, p.z, p.nx, p.nz);
    if (hit) table.push({ angle: Math.atan2(p.nz, p.nx), ...hit });
  }
  table.sort((a, b) => a.angle - b.angle);
  // Wider than this between two hits, the normal falls in a gap (an open corner).
  const maxGap = (3 * Math.PI * 2) / SAMPLES;
  return (nx, nz) => {
    if (table.length < 2) return null;
    const angle = Math.atan2(nz, nx);
    let hi = table.findIndex((e) => e.angle >= angle);
    if (hi < 0) hi = 0;
    const lo = (hi - 1 + table.length) % table.length;
    const a = table[lo];
    const b = table[hi];
    const span = (b.angle - a.angle + Math.PI * 4) % (Math.PI * 2);
    if (span > maxGap) return null;
    const f = span < 1e-9 ? 0 : (((angle - a.angle + Math.PI * 4) % (Math.PI * 2)) / span);
    return { reach: a.reach + (b.reach - a.reach) * f, height: a.height + (b.height - a.height) * f };
  };
}

/** Narrowest the outer eave may get past the back of the stand below it (m). */
const MIN_EAVE_PAST_STAND = 0.3;

/**
 * Outer edge offset `eave` (m from the ring, or from the pitch-side front of a stand) moved by the
 * user's `roof.outerOverhang`, never pulled back inside the stand whose back is at `standDepth`.
 */
export function withOuterOverhang(doc: StadiumDocument, standDepth: number, eave: number): number {
  return Math.max(standDepth + MIN_EAVE_PAST_STAND, eave + (doc.roof.outerOverhang ?? 0));
}

export function computeStadiumRingBounds(doc: StadiumDocument) {
  const safePitch = clampPitchToTrack(doc.pitch);
  const trackOffsets = getTrackRadialOffset(doc);
  const southMetrics = calculateStandMetrics(doc, 'south');
  const northMetrics = calculateStandMetrics(doc, 'north');
  const eastMetrics = calculateStandMetrics(doc, 'east');
  const westMetrics = calculateStandMetrics(doc, 'west');

  const maxStandH = Math.max(
    southMetrics.maxHeight,
    northMetrics.maxHeight,
    eastMetrics.maxHeight,
    westMetrics.maxHeight,
    12
  );
  const avgDepth = Math.max(
    southMetrics.totalDepth,
    northMetrics.totalDepth,
    eastMetrics.totalDepth,
    westMetrics.totalDepth,
    18
  );

  const avgDistX =
    (doc.stands.east.distanceToPitch + doc.stands.west.distanceToPitch) * 0.5;
  const avgDistZ =
    (doc.stands.north.distanceToPitch + doc.stands.south.distanceToPitch) * 0.5;

  const ring = buildShapeBowlRing(
    doc.shape,
    safePitch.length,
    safePitch.width,
    avgDistX,
    avgDistZ,
    trackOffsets.endOffset,
    trackOffsets.sideOffset,
    safePitch.hasTrack,
    doc.cornerRoundness
  );

  // Separate stands: depth and crest height along each ring normal come from the stands' real
  // plan footprint (straight stands and corners), so whole-arena roofs reach every corner.
  const separate = !isContinuousBowlShape(doc.shape);
  const footprintAt = separate
    ? footprintLookup(doc, ring, { south: southMetrics, north: northMetrics, east: eastMetrics, west: westMetrics })
    : () => null;

  // Continuous bowls: the crest of the bowl's own section there (stands keep their rows and the
  // corners end the extra ones), so roofs and facades follow the stands exactly.
  const sectionModel = usesBowlSectionModel(doc.shape) ? buildBowlSectionModel(doc, false) : null;
  const bowlCrest = (nx: number, nz: number) => bowlCrestAtNormal(sectionModel!, ring, nx, nz);

  const standHeightAtNormal = (nx: number, nz: number): number => {
    if (sectionModel) return bowlCrest(nx, nz).height;
    const hit = footprintAt(nx, nz);
    if (hit) return hit.height;
    const { east: wE, west: wW, south: wS, north: wN } = bowlSideWeights(doc.shape, nx, nz);
    const hE = eastMetrics.enabled ? eastMetrics.maxHeight : maxStandH * 0.5;
    const hW = westMetrics.enabled ? westMetrics.maxHeight : maxStandH * 0.5;
    const hS = southMetrics.enabled ? southMetrics.maxHeight : maxStandH * 0.5;
    const hN = northMetrics.enabled ? northMetrics.maxHeight : maxStandH * 0.5;
    return wE * hE + wW * hW + wS * hS + wN * hN;
  };

  const standDepthAtNormal = (nx: number, nz: number): number => {
    if (sectionModel) return bowlCrest(nx, nz).depth;
    const hit = footprintAt(nx, nz);
    if (hit) return hit.reach;
    const { east: wE, west: wW, south: wS, north: wN } = bowlSideWeights(doc.shape, nx, nz);
    const dE = eastMetrics.enabled ? eastMetrics.totalDepth : avgDepth * 0.6;
    const dW = westMetrics.enabled ? westMetrics.totalDepth : avgDepth * 0.6;
    const dS = southMetrics.enabled ? southMetrics.totalDepth : avgDepth * 0.6;
    const dN = northMetrics.enabled ? northMetrics.totalDepth : avgDepth * 0.6;
    return wE * dE + wW * dW + wS * dS + wN * dN;
  };

  // Separate stands sit at their own distance from the pitch, while the ring uses the mean per
  // axis: this is how far a stand's front (and back) is pushed out from the ring.
  const standShiftAtNormal = (nx: number, nz: number): number => {
    if (!separate) return 0;
    const wE = Math.pow(Math.max(0, nx), 2.2);
    const wW = Math.pow(Math.max(0, -nx), 2.2);
    const wS = Math.pow(Math.max(0, nz), 2.2);
    const wN = Math.pow(Math.max(0, -nz), 2.2);
    const sum = wE + wW + wS + wN || 1;
    const halfX = (doc.stands.east.distanceToPitch - doc.stands.west.distanceToPitch) / 2;
    const halfZ = (doc.stands.south.distanceToPitch - doc.stands.north.distanceToPitch) / 2;
    return (wE * halfX - wW * halfX + wS * halfZ - wN * halfZ) / sum;
  };

  const concourseWidth = Math.max(0, doc.concourse?.width ?? 0);
  const hasConcourse = concourseWidth > 0.5;
  const overConcourse = doc.roof.overConcourse !== false;

  const canopyOuterOffsetAt = (
    nx: number,
    nz: number,
    defaultExtra: number = 3.4
  ): number => {
    const d = standDepthAtNormal(nx, nz);
    if (hasConcourse) return withOuterOverhang(doc, d, overConcourse ? d + concourseWidth + 0.45 : d + 0.8);
    // The stand's own depth there, not the deepest stand's, so a bowl with one tall side keeps the
    // edge just past its lower stands; an open corner between separate stands has none, and takes
    // the deepest one so whole-arena roofs still reach over it.
    const reach = separate ? footprintAt(nx, nz)?.reach ?? avgDepth : d;
    return withOuterOverhang(doc, reach, reach + defaultExtra);
  };

  const nominalOuterOffset = (defaultExtra: number = 3.4): number => {
    const eave = !hasConcourse
      ? avgDepth + defaultExtra
      : overConcourse
      ? avgDepth + concourseWidth + 0.45
      : avgDepth + 0.8;
    return withOuterOverhang(doc, avgDepth, eave);
  };

  const exteriorSupportMinOffsetAt = (nx: number, nz: number): number => {
    const d = standDepthAtNormal(nx, nz);
    return hasConcourse ? d + concourseWidth + 1.6 : d + 2.2;
  };

  const innerHalfX =
    safePitch.length / 2 +
    Math.max(safePitch.hasTrack ? 0 : MIN_PITCH_SETBACK, avgDistX) +
    trackOffsets.endOffset;
  const innerHalfZ =
    safePitch.width / 2 +
    Math.max(safePitch.hasTrack ? 0 : MIN_PITCH_SETBACK, avgDistZ) +
    trackOffsets.sideOffset;


  return {
    ring,
    innerHalfX,
    innerHalfZ,
    maxStandH,
    avgDepth,
    concourseWidth,
    hasConcourse,
    overConcourse,
    canopyOuterOffsetAt,
    nominalOuterOffset,
    exteriorSupportMinOffsetAt,
    standHeightAtNormal,
    standDepthAtNormal,
    standShiftAtNormal,
    trackOffsets,
    standsMetrics: {
      south: southMetrics,
      north: northMetrics,
      east: eastMetrics,
      west: westMetrics,
    },
  };
}

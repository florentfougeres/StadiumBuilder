import * as THREE from 'three';
import { CornerMode, StadiumShape, StandCrestProfile, StandSide, TRACK_STRAIGHT_LENGTH_M } from './schema';

/**
 * Share of each stand in the bowl at a ring normal, summing to 1. A bowl blends smoothly from
 * one stand to the next (steep falloff, so each side keeps its own section); a `tilted_bowl`
 * blends only its two long sides, linearly across its width, so the rim falls in one straight
 * slope from the north stand to the south stand and the ends carry no section of their own;
 * a `saddle_bowl` blends over the whole bend so its rim dips smoothly from sides to ends.
 */
export function bowlSideWeights(shape: StadiumShape, nx: number, nz: number): Record<StandSide, number> {
  if (shape === 'tilted_bowl') {
    const south = Math.max(0, Math.min(1, (1 + nz) / 2));
    return { north: 1 - south, south, east: 0, west: 0 };
  }
  // A saddle bowl spreads the blend over the whole bend, so the rim dips in one smooth curve
  // from the high sides to the low ends instead of stepping at the corners.
  const k = shape === 'saddle_bowl' ? 0.9 : 2.2;
  const east = Math.pow(Math.max(0, nx), k);
  const west = Math.pow(Math.max(0, -nx), k);
  const south = Math.pow(Math.max(0, nz), k);
  const north = Math.pow(Math.max(0, -nz), k);
  const sum = east + west + south + north || 1;
  return { north: north / sum, south: south / sum, east: east / sum, west: west / sum };
}

/**
 * Evaluates the normalized vertical crest height multiplier along a stand span for `u` in `[-1, 1]`
 * (`0` = center of the stand, `±1` = outer ends near the corners):
 * - `'flat'`: constant `1.0`
 * - `'arch_crest'`: parabolic crown (`+18%` taller at center, `-8%` lower at ends — classic arched main stand / sweeping wave crest)
 * - `'saddle_dip'`: concave saddle (`-11%` lower at center, `+12%` higher toward the corners)
 */
export function evaluateCrestHeightFactor(
  profile: StandCrestProfile | undefined,
  uCentered: number
): number {
  if (!profile || profile === 'flat') return 1.0;
  const u = Math.max(-1, Math.min(1, uCentered));
  const parabola = 1 - u * u; // 1 at center, 0 at ends
  if (profile === 'arch_crest') {
    return 0.92 + 0.26 * parabola;
  }
  return 1.12 - 0.23 * parabola;
}

/**
 * Computes an exact rounded or 8-faceted polygonal stadium perimeter point and outward normal.
 *
 * CRITICAL GUARANTEE:
 * Every point stays strictly outside `[±halfLength, ±halfWidth]` by at least the specified
 * clearances so no stand row or corner facet ever intrudes onto the pitch or corner flags.
 */
export interface RoundedBowlGeometry {
  halfStraightX: number;
  halfStraightZ: number;
  cornerRadius: number;
  facetedCorners: boolean;
  perimeter: number;
  /**
   * Outward bow (sagitta, m) of the long sides (north/south) and of the ends (east/west): a
   * positive value turns that side into a circular arc concave toward the pitch, so its middle
   * stands further back than its ends. Absent or zero means a straight side.
   */
  sideBulgeX?: number;
  sideBulgeZ?: number;
}

/** Circular arc through a straight side's two ends, bowed outward by `bulge`. */
function sideArc(halfChord: number, bulge: number): { radius: number; halfAngle: number } | null {
  if (bulge <= 0.01 || halfChord <= 0.01) return null;
  const radius = (halfChord * halfChord + bulge * bulge) / (2 * bulge);
  return { radius, halfAngle: Math.asin(Math.min(1, halfChord / radius)) };
}

/**
 * How a ring with bowed sides joins them to its corners, in the +x/+z quadrant. Each corner arc
 * is tangent to the end arc and to the long-side arc (a classic multi-centre oval), so the bowl has
 * no crease where a side meets a corner. A straight side keeps `radius` null.
 */
interface BowedJoint {
  /** End arc: centre on the x axis at `endCentreX`, normal angle at the joint `endAngle` (from +x). */
  endRadius: number | null;
  endCentreX: number;
  endAngle: number;
  /** Long-side arc: centre on the z axis at `sideCentreZ`, normal angle at the joint `sideAngle` (from +z). */
  sideRadius: number | null;
  sideCentreZ: number;
  sideAngle: number;
  /** Corner arc centre. */
  cx: number;
  cz: number;
  /** Lengths of half an end, of half a long side and of one corner. */
  endHalfLen: number;
  sideHalfLen: number;
  cornerLen: number;
}

const jointCache = new WeakMap<RoundedBowlGeometry, BowedJoint | null>();

function bowedJoint(ring: RoundedBowlGeometry): BowedJoint | null {
  if (jointCache.has(ring)) return jointCache.get(ring)!;
  const joint = computeBowedJoint(ring);
  jointCache.set(ring, joint);
  return joint;
}

function computeBowedJoint(ring: RoundedBowlGeometry): BowedJoint | null {
  if (ring.facetedCorners) return null;
  const hx = ring.halfStraightX;
  const hz = ring.halfStraightZ;
  const r = ring.cornerRadius;
  const endArc = sideArc(hz, ring.sideBulgeZ ?? 0);
  const longArc = sideArc(hx, ring.sideBulgeX ?? 0);
  if (!endArc && !longArc) return null;

  const endRadius = endArc?.radius ?? null;
  const sideRadius = longArc?.radius ?? null;
  // Arc centres keep the apex where the chord-and-bulge construction puts it.
  const endCentreX = endRadius === null ? 0 : hx + r + (ring.sideBulgeZ ?? 0) - endRadius;
  const sideCentreZ = sideRadius === null ? 0 : hz + r + (ring.sideBulgeX ?? 0) - sideRadius;

  // Corner centre: `endRadius - r` from the end arc's centre and `sideRadius - r` from the
  // long side's (or `r` inside a straight side).
  const onEnd = (a: number) => ({
    x: endCentreX + (endRadius! - r) * Math.cos(a),
    z: (endRadius! - r) * Math.sin(a),
  });
  let cx: number;
  let cz: number;
  if (endRadius === null) {
    cx = hx;
    cz = sideCentreZ + Math.sqrt(Math.max(0, (sideRadius! - r) ** 2 - cx * cx));
  } else if (sideRadius === null) {
    cz = hz;
    cx = endCentreX + Math.sqrt(Math.max(0, (endRadius - r) ** 2 - cz * cz));
  } else {
    // Walk the end arc's offset circle until it meets the long side's: distance to the side
    // centre grows with the angle, so bisection finds the single crossing in the quadrant.
    const miss = (a: number) => {
      const p = onEnd(a);
      return Math.hypot(p.x, p.z - sideCentreZ) - (sideRadius - r);
    };
    let lo = 0;
    let hi = Math.PI / 2;
    if (miss(lo) > 0 || miss(hi) < 0) return null;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if (miss(mid) < 0) lo = mid;
      else hi = mid;
    }
    ({ x: cx, z: cz } = onEnd((lo + hi) / 2));
  }

  const endAngle = endRadius === null ? 0 : Math.atan2(cz, cx - endCentreX);
  const sideAngle = sideRadius === null ? 0 : Math.atan2(cx, cz - sideCentreZ);
  const cornerSpan = Math.PI / 2 - endAngle - sideAngle;
  if (!(cx > 0 && cz > 0 && cornerSpan > 0)) return null;
  return {
    endRadius,
    endCentreX,
    endAngle,
    sideRadius,
    sideCentreZ,
    sideAngle,
    cx,
    cz,
    endHalfLen: endRadius === null ? cz : endRadius * endAngle,
    sideHalfLen: sideRadius === null ? cx : sideRadius * sideAngle,
    cornerLen: r * cornerSpan,
  };
}

/**
 * Point and outward normal of a bowed ring in the +x/+z quadrant: along the end (`s` from the
 * axis to the corner), the corner (from the end to the long side) or the long side (from the
 * corner to the axis).
 */
function bowedQuadrantPoint(
  ring: RoundedBowlGeometry,
  j: BowedJoint,
  part: 'end' | 'corner' | 'side',
  s: number
): { bx: number; bz: number; nx: number; nz: number } {
  if (part === 'end') {
    if (j.endRadius === null) return { bx: ring.halfStraightX + ring.cornerRadius, bz: s * j.cz, nx: 1, nz: 0 };
    const a = s * j.endAngle;
    return { bx: j.endCentreX + j.endRadius * Math.cos(a), bz: j.endRadius * Math.sin(a), nx: Math.cos(a), nz: Math.sin(a) };
  }
  if (part === 'corner') {
    const phi = j.endAngle + s * (Math.PI / 2 - j.endAngle - j.sideAngle);
    const nx = Math.cos(phi);
    const nz = Math.sin(phi);
    return { bx: j.cx + ring.cornerRadius * nx, bz: j.cz + ring.cornerRadius * nz, nx, nz };
  }
  if (j.sideRadius === null) return { bx: (1 - s) * j.cx, bz: ring.halfStraightZ + ring.cornerRadius, nx: 0, nz: 1 };
  const a = (1 - s) * j.sideAngle;
  return { bx: j.sideRadius * Math.sin(a), bz: j.sideCentreZ + j.sideRadius * Math.cos(a), nx: Math.sin(a), nz: Math.cos(a) };
}

/**
 * Front length of a long side (north/south) and of an end (east/west), from corner joint to
 * corner joint, following the arc when the side is bowed, and of one corner between them.
 */
export function ringSideSpans(ring: RoundedBowlGeometry): { longSide: number; end: number; corner: number } {
  const lengths = ringSegmentLengths(ring);
  return { longSide: lengths[2], end: lengths[4], corner: lengths[1] };
}

export function computeSafeBowlCornerRadius(
  innerHalfX: number,
  innerHalfZ: number,
  pitchHalfX: number,
  pitchHalfZ: number,
  minCornerMargin: number = 3.0,
  desiredMaxRadius: number = 18,
  facetedCorners: boolean = false
): number {
  const dx = Math.max(0.4, innerHalfX - (pitchHalfX + minCornerMargin));
  const dz = Math.max(0.4, innerHalfZ - (pitchHalfZ + minCornerMargin));

  if (facetedCorners) {
    // Straight 45° chamfer line `x + z = innerHalfX + innerHalfZ - r` clears `(pitchHalfX+m, pitchHalfZ+m)`
    // whenever `r <= dx + dz`.
    const safeChamfer = Math.max(1.0, dx + dz - 0.5);
    return Math.min(desiredMaxRadius, safeChamfer, innerHalfX * 0.78, innerHalfZ * 0.78);
  }

  const safeMaxR = dx + dz + Math.sqrt(2 * dx * dz);
  return Math.min(desiredMaxRadius, safeMaxR, innerHalfX * 0.94, innerHalfZ * 0.95);
}

export function createRoundedBowlRing(
  innerHalfX: number,
  innerHalfZ: number,
  cornerRadius: number = 14,
  facetedCorners: boolean = false,
  sideBulgeX: number = 0,
  sideBulgeZ: number = 0
): RoundedBowlGeometry {
  const maxFrac = facetedCorners ? 0.78 : 0.95;
  const r = Math.min(cornerRadius, innerHalfX * maxFrac, innerHalfZ * maxFrac);
  const halfStraightX = Math.max(2, innerHalfX - r);
  const halfStraightZ = Math.max(2, innerHalfZ - r);

  // Bowed sides only exist on rounded rings (the faceted octagon keeps its straight pans).
  const bulgeX = facetedCorners ? 0 : sideBulgeX;
  const bulgeZ = facetedCorners ? 0 : sideBulgeZ;
  const ring: RoundedBowlGeometry = {
    halfStraightX,
    halfStraightZ,
    cornerRadius: r,
    facetedCorners,
    perimeter: 0,
    sideBulgeX: bulgeX,
    sideBulgeZ: bulgeZ,
  };
  // Summed in this order so rings without bowed sides keep their exact former perimeter.
  const [, corner, longSide, , end] = ringSegmentLengths(ring);
  ring.perimeter = 2 * longSide + 2 * end + 4 * corner;
  return ring;
}

/**
 * Returns the normalized `[tStart, tEnd]` arc span and loop closure for swept bowl shapes.
 * - Full bowls (`modern_bowl`, `steep_cauldron`, `olympic_oval`, `octagonal_arena`): `[0, 1]` closed
 * - Open U-bowl (`horseshoe`): `[0.125, 0.875]` open on the East (`+X`) goal end
 */
export function getBowlArcRange(
  shape: StadiumShape,
  crossSectionClip: boolean
): { tStart: number; tEnd: number; closed: boolean } {
  if (shape === 'horseshoe') {
    if (crossSectionClip) {
      return { tStart: 0.5, tEnd: 0.875, closed: false };
    }
    return { tStart: 0.125, tEnd: 0.875, closed: false };
  }

  if (shape === 'd_shape_vertical') {
    // 3-sided curved cauldron (SW -> West -> North -> East -> SE), open on +Z South for the vertical VIP balcony wall!
    if (crossSectionClip) {
      return { tStart: 0.5, tEnd: 1.0, closed: false };
    }
    return { tStart: 0.37, tEnd: 1.13, closed: false };
  }

  if (crossSectionClip) {
    return { tStart: 0.5, tEnd: 1.0, closed: false };
  }

  return { tStart: 0, tEnd: 1.0, closed: true };
}

/**
 * Lengths of the ring's nine segments, starting at East and going through South: half east
 * side, SE corner, south side, SW corner, west side, NW corner, north side, NE corner, half east
 * side. Odd indices are the corners.
 */
function ringSegmentLengths(ring: RoundedBowlGeometry): number[] {
  const r = ring.cornerRadius;
  const joint = bowedJoint(ring);
  const corner = joint ? joint.cornerLen : ring.facetedCorners ? Math.SQRT2 * r : (Math.PI / 2) * r;
  const halfX = joint ? joint.sideHalfLen : ring.halfStraightX;
  const halfZ = joint ? joint.endHalfLen : ring.halfStraightZ;
  return [halfZ, corner, halfX * 2, corner, halfZ * 2, corner, halfX * 2, corner, halfZ];
}

/** Segment of the ring at normalized position `u` in [0, 1), and the fraction along it. */
function locateRingSegment(ring: RoundedBowlGeometry, u: number): { segIdx: number; f: number } {
  const lengths = ringSegmentLengths(ring);
  let s = u * ring.perimeter;
  let segIdx = lengths.length - 1;
  for (let i = 0; i < lengths.length; i++) {
    if (s <= lengths[i]) {
      segIdx = i;
      break;
    }
    s -= lengths[i];
  }
  return { segIdx, f: Math.min(1, Math.max(0, s / Math.max(1e-6, lengths[segIdx]))) };
}

/** Whether ring position `t` lies on one of the four corner arcs (or chamfers). */
export function isOnRingCorner(ring: RoundedBowlGeometry, t: number): boolean {
  return locateRingSegment(ring, ((t % 1) + 1) % 1).segIdx % 2 === 1;
}

/**
 * Evaluates a point along the rounded or 8-faceted stadium ring at parameter `t` in `[0, 1]`
 * with radial outward offset `radialOffset` (>= 0 moves away from pitch).
 *
 * Orientation convention:
 * - `t = 0.00` : East (+X, Z = 0)
 * - `t = 0.25` : South (X = 0, +Z)
 * - `t = 0.50` : West (-X, Z = 0)
 * - `t = 0.75` : North (X = 0, -Z)
 */
export function sampleRoundedBowlRing(
  ring: RoundedBowlGeometry,
  t: number,
  radialOffset: number
): { x: number; z: number; nx: number; nz: number; angle: number } {
  const u = ((t % 1) + 1) % 1;
  const hx = ring.halfStraightX;
  const hz = ring.halfStraightZ;
  const r = ring.cornerRadius;

  // Watertight mitered octagon sampling when `ring.facetedCorners === true`
  if (ring.facetedCorners) {
    const d = radialOffset;
    const k = Math.SQRT2 - 1; // tan(22.5°) — exact parallel miter extension for 8-sided octagon!
    const X = hx + r + d;
    const Z = hz + r + d;
    const cx = hx + d * k;
    const cz = hz + d * k;

    // Segments: E lower, SE chamfer, S, SW chamfer, W, NW chamfer, N, NE chamfer, E upper.
    const { segIdx, f } = locateRingSegment(ring, u);
    const invSqrt2 = Math.SQRT1_2;

    let x = 0;
    let z = 0;
    let nx = 1;
    let nz = 0;

    switch (segIdx) {
      case 0: // East lower: (X, 0) -> (X, cz)
        x = X;
        z = f * cz;
        nx = 1;
        nz = 0;
        break;
      case 1: // SE 45° facet: (X, cz) -> (cx, Z)
        x = X + (cx - X) * f;
        z = cz + (Z - cz) * f;
        nx = invSqrt2;
        nz = invSqrt2;
        break;
      case 2: // South straight: (+cx, Z) -> (-cx, Z)
        x = cx - f * (2 * cx);
        z = Z;
        nx = 0;
        nz = 1;
        break;
      case 3: // SW 45° facet: (-cx, Z) -> (-X, cz)
        x = -cx + (-X + cx) * f;
        z = Z + (cz - Z) * f;
        nx = -invSqrt2;
        nz = invSqrt2;
        break;
      case 4: // West straight: (-X, +cz) -> (-X, -cz)
        x = -X;
        z = cz - f * (2 * cz);
        nx = -1;
        nz = 0;
        break;
      case 5: // NW 45° facet: (-X, -cz) -> (-cx, -Z)
        x = -X + (-cx + X) * f;
        z = -cz + (-Z + cz) * f;
        nx = -invSqrt2;
        nz = -invSqrt2;
        break;
      case 6: // North straight: (-cx, -Z) -> (+cx, -Z)
        x = -cx + f * (2 * cx);
        z = -Z;
        nx = 0;
        nz = -1;
        break;
      case 7: // NE 45° facet: (+cx, -Z) -> (+X, -cz)
        x = cx + (X - cx) * f;
        z = -Z + (-cz + Z) * f;
        nx = invSqrt2;
        nz = -invSqrt2;
        break;
      case 8:
      default: // East upper: (+X, -cz) -> (+X, 0)
        x = X;
        z = -cz + f * cz;
        nx = 1;
        nz = 0;
        break;
    }

    return {
      x,
      z,
      nx,
      nz,
      angle: Math.atan2(nz, nx),
    };
  }

  const { segIdx, f } = locateRingSegment(ring, u);

  let bx = 0;
  let bz = 0;
  let nx = 1;
  let nz = 0;

  const joint = bowedJoint(ring);
  if (joint) {
    // Each segment is a quadrant piece mirrored by (sx, sz); `s` runs as in bowedQuadrantPoint.
    const piece: [part: 'end' | 'corner' | 'side', s: number, sx: number, sz: number] =
      segIdx === 0
        ? ['end', f, 1, 1]
        : segIdx === 1
        ? ['corner', f, 1, 1]
        : segIdx === 2
        ? f < 0.5 ? ['side', 2 * f, 1, 1] : ['side', 2 - 2 * f, -1, 1]
        : segIdx === 3
        ? ['corner', 1 - f, -1, 1]
        : segIdx === 4
        ? f < 0.5 ? ['end', 1 - 2 * f, -1, 1] : ['end', 2 * f - 1, -1, -1]
        : segIdx === 5
        ? ['corner', f, -1, -1]
        : segIdx === 6
        ? f < 0.5 ? ['side', 2 * f, -1, -1] : ['side', 2 - 2 * f, 1, -1]
        : segIdx === 7
        ? ['corner', 1 - f, 1, -1]
        : ['end', 1 - f, 1, -1];
    const [part, sPart, sx, sz] = piece;
    const q = bowedQuadrantPoint(ring, joint, part, sPart);
    bx = sx * q.bx;
    bz = sz * q.bz;
    nx = sx * q.nx;
    nz = sz * q.nz;
  } else {
    switch (segIdx) {
      case 0:
        bx = hx + r;
        bz = f * hz;
        break;
      case 1: {
        const phi = f * (Math.PI / 2);
        nx = Math.cos(phi);
        nz = Math.sin(phi);
        bx = hx + nx * r;
        bz = hz + nz * r;
        break;
      }
      case 2:
        bx = hx - f * (hx * 2);
        bz = hz + r;
        nx = 0;
        nz = 1;
        break;
      case 3: {
        const phi = Math.PI / 2 + f * (Math.PI / 2);
        nx = Math.cos(phi);
        nz = Math.sin(phi);
        bx = -hx + nx * r;
        bz = hz + nz * r;
        break;
      }
      case 4:
        bx = -(hx + r);
        bz = hz - f * (hz * 2);
        nx = -1;
        nz = 0;
        break;
      case 5: {
        const phi = Math.PI + f * (Math.PI / 2);
        nx = Math.cos(phi);
        nz = Math.sin(phi);
        bx = -hx + nx * r;
        bz = -hz + nz * r;
        break;
      }
      case 6:
        bx = -hx + f * (hx * 2);
        bz = -(hz + r);
        nx = 0;
        nz = -1;
        break;
      case 7: {
        const phi = Math.PI * 1.5 + f * (Math.PI / 2);
        nx = Math.cos(phi);
        nz = Math.sin(phi);
        bx = hx + nx * r;
        bz = -hz + nz * r;
        break;
      }
      case 8:
      default:
        bx = hx + r;
        bz = -hz + f * hz;
        break;
    }
  }

  return {
    x: bx + nx * radialOffset,
    z: bz + nz * radialOffset,
    nx,
    nz,
    angle: Math.atan2(nz, nx),
  };
}

/** Bow of the `arc_stands` shape as a share of the ring half-size: long sides, then ends. */
const ARC_STANDS_SIDE_BOW = 0.09;
const ARC_STANDS_END_BOW = 0.26;

/** Smallest gap between the pitch edge and the front of the stands when there is no track (m). */
export const MIN_PITCH_SETBACK = 4.5;

export function buildShapeBowlRing(
  shape: StadiumShape,
  pitchLength: number,
  pitchWidth: number,
  avgDistX: number,
  avgDistZ: number,
  endTrackOffset: number,
  sideTrackOffset: number,
  hasTrack: boolean,
  /** `rounded_rectangle`: corner rounding from a tight 6 m radius (`0`) to a full bend (`1`). */
  cornerRoundness: number = 0.5,
  /** Reference ring for stand-by-stand shapes: the bowl's footprint without its bowed sides. */
  plain: boolean = false
): RoundedBowlGeometry {
  if (shape === 'circular_bowl') {
    // A round bowl must clear the pitch corners: ends sit close to the goals, sides far away.
    const radius =
      Math.hypot(pitchLength / 2 + endTrackOffset, pitchWidth / 2 + sideTrackOffset) +
      Math.max(3, Math.min(avgDistX, avgDistZ) * 0.6);
    return createRoundedBowlRing(radius, radius, radius, false);
  }

  const octPush = shape === 'octagonal_arena' ? 6.2 : 0;
  const cauldronPull = shape === 'steep_cauldron' || shape === 'd_shape_vertical' ? -0.6 : 0;
  // With a track the stand setback is measured from the track's outer edge and may be zero.
  const ovalTrack = shape === 'olympic_oval';
  const olympicPush = ovalTrack && !hasTrack ? 1.8 : 0;
  const sunkenPush = shape === 'sunken_bowl' ? 0.6 : 0;
  const minSetback = hasTrack ? 0 : MIN_PITCH_SETBACK;

  const innerHalfX =
    pitchLength / 2 +
    Math.max(minSetback, avgDistX + cauldronPull + olympicPush + octPush + sunkenPush) +
    endTrackOffset;
  const innerHalfZ =
    pitchWidth / 2 +
    Math.max(minSetback, avgDistZ + cauldronPull + olympicPush + octPush + sunkenPush) +
    sideTrackOffset;

  const faceted = shape === 'octagonal_arena';
  const desiredR =
    ovalTrack
      ? hasTrack
        ? innerHalfZ // bends follow the track's own semicircles
        : innerHalfZ * 0.94
      : shape === 'sunken_bowl'
      ? hasTrack
        ? innerHalfZ * 0.9
        : 19
      : shape === 'steep_cauldron' || shape === 'd_shape_vertical'
      ? hasTrack
        ? innerHalfZ * 0.85
        : 13.5
      : shape === 'compact_urban'
      ? hasTrack
        ? innerHalfZ * 0.78
        : 8.6
      : shape === 'english_rectangular' || shape === 'four_stands'
      ? hasTrack
        ? innerHalfZ * 0.8
        : 10.2
      : shape === 'octagonal_arena'
      ? 22
      : shape === 'rounded_rectangle'
      ? 6 + Math.max(0, Math.min(1, cornerRoundness)) * Math.max(0, innerHalfZ - 6)
      : shape === 'arc_stands'
      ? 9
      : shape === 'horseshoe'
      ? hasTrack
        ? innerHalfZ * 0.88
        : 16
      : hasTrack
      ? innerHalfZ * 0.92
      : 17;

  const trackHalfStraightX = TRACK_STRAIGHT_LENGTH_M * 0.5;
  const trackOuterApexX = pitchLength * 0.5 + endTrackOffset;
  const trackOuterR = Math.max(
    pitchWidth * 0.5 + sideTrackOffset,
    trackOuterApexX - trackHalfStraightX
  );
  const effectiveDesiredR = hasTrack
    ? Math.min(
        desiredR,
        faceted
          ? Math.max(
              2,
              innerHalfX -
                trackHalfStraightX +
                innerHalfZ -
                Math.SQRT2 * (trackOuterR + 2.2)
            )
          : Math.max(4, Math.min(innerHalfX - trackHalfStraightX, innerHalfZ))
      )
    : desiredR;

  const cornerR = computeSafeBowlCornerRadius(
    innerHalfX,
    innerHalfZ,
    pitchLength / 2,
    pitchWidth / 2,
    2.6,
    effectiveDesiredR,
    faceted
  );

  if (shape === 'arc_stands') {
    // Four stands each drawn on a circular arc: the ends bow more than the long sides, so every
    // seat turns toward the centre spot; the narrow corners between them stay open by default.
    return createRoundedBowlRing(
      innerHalfX,
      innerHalfZ,
      cornerR,
      false,
      innerHalfX * ARC_STANDS_SIDE_BOW,
      innerHalfZ * ARC_STANDS_END_BOW
    );
  }

  if (shape === 'modern_bowl' && !plain) {
    return createOvalBowlRing(innerHalfX, innerHalfZ, cornerR, pitchLength / 2, pitchWidth / 2);
  }

  return createRoundedBowlRing(innerHalfX, innerHalfZ, cornerR, faceted);
}

/** Outward bow of the bowl's long sides and of its ends, as a share of the ring half-size. */
const BOWL_SIDE_BOW = 0.05;
const BOWL_END_BOW = 0.16;
/** Clear distance kept between a corner of the pitch and the front of the bowl (m). */
const BOWL_CORNER_CLEARANCE = 2.6;

/**
 * The continuous bowl's oval: long sides and ends bowed outward and joined tangentially to the
 * corners, so it reads as a bowl rather than a rounded rectangle. A tangent corner sits further
 * in than a quarter circle, so its radius is reduced until it clears the pitch corner again.
 */
function createOvalBowlRing(
  innerHalfX: number,
  innerHalfZ: number,
  cornerRadius: number,
  pitchHalfX: number,
  pitchHalfZ: number
): RoundedBowlGeometry {
  const build = (r: number) =>
    createRoundedBowlRing(innerHalfX, innerHalfZ, r, false, innerHalfX * BOWL_SIDE_BOW, innerHalfZ * BOWL_END_BOW);
  for (let r = cornerRadius; r > 4; r -= 0.25) {
    const ring = build(r);
    if (ringCornerClearance(ring, pitchHalfX, pitchHalfZ) >= BOWL_CORNER_CLEARANCE) return ring;
  }
  return build(4);
}

/** Smallest distance from the pitch corner (+x, +z) to the ring's front. */
function ringCornerClearance(ring: RoundedBowlGeometry, pitchHalfX: number, pitchHalfZ: number): number {
  let min = Infinity;
  for (let i = 0; i <= 64; i++) {
    const p = sampleRoundedBowlRing(ring, (i / 64) * 0.25, 0);
    min = Math.min(min, Math.hypot(p.x - pitchHalfX, p.z - pitchHalfZ));
  }
  return min;
}

export function pointVectorOnRing(
  ring: RoundedBowlGeometry,
  t: number,
  radialOffset: number,
  y: number
): THREE.Vector3 {
  const pt = sampleRoundedBowlRing(ring, t, radialOffset);
  return new THREE.Vector3(pt.x, y, pt.z);
}

export type CornerQuadrantId = 'se' | 'sw' | 'nw' | 'ne';
export type RectangularSideId = 'north' | 'south' | 'east' | 'west';

export interface StraightStandSpanSpec {
  span: number;
  centerCoord: number;
  frontDist: number;
  capNegLocalX: boolean;
  capPosLocalX: boolean;
}

export interface RectangularCornerSpec {
  id: CornerQuadrantId;
  active: boolean;
  mode: CornerMode;
  cx: number;
  cz: number;
  radius: number;
  thetaStart: number;
  thetaEnd: number;
  facetedThreeBay: boolean;
  sideA: RectangularSideId;
  sideB: RectangularSideId;
  /** Stand whose section the corner keeps; unset, it joins both (exactly, or morphing). */
  follow?: RectangularSideId;
}

export interface RectangularCornerLayout {
  closedCornersMode: boolean;
  eastX: number;
  westX: number;
  southZ: number;
  northZ: number;
  straight: Record<RectangularSideId, StraightStandSpanSpec>;
  corners: Record<CornerQuadrantId, RectangularCornerSpec>;
}

/**
 * Computes exact tangent-matched straight-stand spans and 90-degree corner quadrants
 * for rectangular morphologies (`four_stands`, `compact_urban`, `english_rectangular`).
 * Guarantees 0.000m watertight joins, zero internal gable-wall overlaps, and zero pitch intrusions.
 */
export function computeRectangularCornerLayout(params: {
  shape: StadiumShape;
  cornerFill: boolean;
  cornerModes?: Partial<Record<CornerQuadrantId, CornerMode>>;
  crossSectionClip: boolean;
  pitchLength: number;
  pitchWidth: number;
  endTrackOffset: number;
  sideTrackOffset: number;
  stands: Record<
    RectangularSideId,
    { enabled: boolean; rows: number; distanceToPitch: number }
  >;
  /**
   * Seated corners that keep one stand's section instead of morphing: the other stand ends
   * with a capped wall at that corner.
   */
  cornerFollow?: Partial<Record<CornerQuadrantId, RectangularSideId>>;
}): RectangularCornerLayout {
  const {
    shape,
    cornerFill,
    cornerModes,
    crossSectionClip,
    pitchLength,
    pitchWidth,
    endTrackOffset,
    sideTrackOffset,
    stands,
    cornerFollow = {},
  } = params;

  const pitchHalfX = pitchLength * 0.5;
  const pitchHalfZ = pitchWidth * 0.5;

  const eastDist = pitchHalfX + stands.east.distanceToPitch + endTrackOffset;
  const westDist = pitchHalfX + stands.west.distanceToPitch + endTrackOffset;
  const southDist = pitchHalfZ + stands.south.distanceToPitch + sideTrackOffset;
  const northDist = pitchHalfZ + stands.north.distanceToPitch + sideTrackOffset;

  const eastX = eastDist;
  const westX = -westDist;
  const southZ = southDist;
  const northZ = -northDist;

  const defaultClosed =
    shape === 'compact_urban' || (shape === 'english_rectangular' && cornerFill);
  const defaultMode: CornerMode = defaultClosed ? 'filled' : 'open';

  const modeSE: CornerMode = cornerModes?.se ?? defaultMode;
  const modeSW: CornerMode = cornerModes?.sw ?? defaultMode;
  const modeNW: CornerMode = cornerModes?.nw ?? defaultMode;
  const modeNE: CornerMode = cornerModes?.ne ?? defaultMode;

  const facetedThreeBay = shape === 'english_rectangular';
  const desiredR = shape === 'compact_urban' ? 8.6 : 10.2;

  const safeCornerRadius = (absX: number, absZ: number): number => {
    const clearX = Math.max(0.6, absX - (pitchHalfX + 2.4));
    const clearZ = Math.max(0.6, absZ - (pitchHalfZ + 2.4));
    const maxSafe = Math.min(clearX / 0.34, clearZ / 0.34);
    return Math.max(2.2, Math.min(desiredR, maxSafe, absX * 0.45, absZ * 0.45));
  };

  const isStandLive = (s: RectangularSideId) =>
    stands[s].enabled && stands[s].rows > 0 && !(crossSectionClip && s === 'south');

  const rSE = safeCornerRadius(eastDist, southDist);
  const rSW = safeCornerRadius(westDist, southDist);
  const rNW = safeCornerRadius(westDist, northDist);
  const rNE = safeCornerRadius(eastDist, northDist);

  const evalCorner = (
    cid: CornerQuadrantId,
    mode: CornerMode,
    sA: RectangularSideId,
    sB: RectangularSideId
  ) => {
    const clippedSouth = crossSectionClip && (cid === 'se' || cid === 'sw');
    if (clippedSouth || mode === 'open') {
      return { active: false, trimsStand: false, seamlessVirage: false };
    }
    const bothLive = isStandLive(sA) && isStandLive(sB);
    const anyLive = isStandLive(sA) || isStandLive(sB);
    if (mode === 'filled') {
      return {
        active: bothLive,
        trimsStand: bothLive,
        seamlessVirage: bothLive,
      };
    }
    if (mode === 'building' || mode === 'pavilion' || mode === 'spiral_tower') {
      return {
        active: anyLive,
        trimsStand: anyLive,
        seamlessVirage: false,
      };
    }
    // mode === 'screen'
    return {
      active: true,
      trimsStand: anyLive,
      seamlessVirage: false,
    };
  };

  const seState = evalCorner('se', modeSE, 'east', 'south');
  const swState = evalCorner('sw', modeSW, 'south', 'west');
  const nwState = evalCorner('nw', modeNW, 'west', 'north');
  const neState = evalCorner('ne', modeNE, 'north', 'east');

  const closedCornersMode =
    seState.seamlessVirage ||
    swState.seamlessVirage ||
    nwState.seamlessVirage ||
    neState.seamlessVirage;

  const openOverhang = shape === 'four_stands' ? 4.0 : 2.0;

  // A stand meets a corner flush unless the corner keeps the other stand's section.
  const joinsFlush = (state: { seamlessVirage: boolean }, cid: CornerQuadrantId, side: RectangularSideId) =>
    state.seamlessVirage && (cornerFollow[cid] === undefined || cornerFollow[cid] === side);

  // South stand (+Z, rotY = 0: local +X -> world +X)
  const southMinX = swState.trimsStand ? westX + rSW : -(pitchHalfX + openOverhang);
  const southMaxX = seState.trimsStand ? eastX - rSE : pitchHalfX + openOverhang;

  // North stand (-Z, rotY = PI: local -X -> world +X [NE], local +X -> world -X [NW])
  const northMinX = nwState.trimsStand ? westX + rNW : -(pitchHalfX + openOverhang);
  const northMaxX = neState.trimsStand ? eastX - rNE : pitchHalfX + openOverhang;

  // East stand (+X, rotY = +PI/2: local -X -> world +Z [SE], local +X -> world -Z [NE])
  const eastMinZ = neState.trimsStand ? northZ + rNE : -(pitchHalfZ + openOverhang);
  const eastMaxZ = seState.trimsStand ? southZ - rSE : pitchHalfZ + openOverhang;

  // West stand (-X, rotY = -PI/2: local -X -> world -Z [NW], local +X -> world +Z [SW])
  const westMinZ = nwState.trimsStand ? northZ + rNW : -(pitchHalfZ + openOverhang);
  const westMaxZ = swState.trimsStand ? southZ - rSW : pitchHalfZ + openOverhang;

  return {
    closedCornersMode,
    eastX,
    westX,
    southZ,
    northZ,
    straight: {
      south: {
        span: Math.max(8, southMaxX - southMinX),
        centerCoord: (southMinX + southMaxX) * 0.5,
        frontDist: southDist,
        capNegLocalX: !joinsFlush(swState, 'sw', 'south'),
        capPosLocalX: !joinsFlush(seState, 'se', 'south'),
      },
      north: {
        span: Math.max(8, northMaxX - northMinX),
        centerCoord: (northMinX + northMaxX) * 0.5,
        frontDist: northDist,
        capNegLocalX: !joinsFlush(neState, 'ne', 'north'),
        capPosLocalX: !joinsFlush(nwState, 'nw', 'north'),
      },
      east: {
        span: Math.max(8, eastMaxZ - eastMinZ),
        centerCoord: (eastMinZ + eastMaxZ) * 0.5,
        frontDist: eastDist,
        capNegLocalX: !joinsFlush(seState, 'se', 'east'),
        capPosLocalX: !joinsFlush(neState, 'ne', 'east'),
      },
      west: {
        span: Math.max(8, westMaxZ - westMinZ),
        centerCoord: (westMinZ + westMaxZ) * 0.5,
        frontDist: westDist,
        capNegLocalX: !joinsFlush(nwState, 'nw', 'west'),
        capPosLocalX: !joinsFlush(swState, 'sw', 'west'),
      },
    },
    corners: {
      se: {
        id: 'se',
        active: seState.active,
        follow: seState.seamlessVirage ? cornerFollow.se : undefined,
        mode: modeSE,
        cx: eastX - rSE,
        cz: southZ - rSE,
        radius: rSE,
        thetaStart: 0,
        thetaEnd: Math.PI * 0.5,
        facetedThreeBay,
        sideA: 'east',
        sideB: 'south',
      },
      sw: {
        id: 'sw',
        active: swState.active,
        follow: swState.seamlessVirage ? cornerFollow.sw : undefined,
        mode: modeSW,
        cx: westX + rSW,
        cz: southZ - rSW,
        radius: rSW,
        thetaStart: Math.PI * 0.5,
        thetaEnd: Math.PI,
        facetedThreeBay,
        sideA: 'south',
        sideB: 'west',
      },
      nw: {
        id: 'nw',
        active: nwState.active,
        follow: nwState.seamlessVirage ? cornerFollow.nw : undefined,
        mode: modeNW,
        cx: westX + rNW,
        cz: northZ + rNW,
        radius: rNW,
        thetaStart: Math.PI,
        thetaEnd: Math.PI * 1.5,
        facetedThreeBay,
        sideA: 'west',
        sideB: 'north',
      },
      ne: {
        id: 'ne',
        active: neState.active,
        follow: neState.seamlessVirage ? cornerFollow.ne : undefined,
        mode: modeNE,
        cx: eastX - rNE,
        cz: northZ + rNE,
        radius: rNE,
        thetaStart: Math.PI * 1.5,
        thetaEnd: Math.PI * 2.0,
        facetedThreeBay,
        sideA: 'north',
        sideB: 'east',
      },
    },
  };
}

/**
 * Samples a world-space point & outward normal along a 90° corner quadrant for `u` in `[0, 1]`:
 * - `facetedThreeBay === false` (`compact_urban`): smooth circular quarter-arc
 * - `facetedThreeBay === true` (`english_rectangular`): 3 crisp 30° planar precast bays
 *   with exact `1 / cos(15°)` interior radial miter and exact `1.0` orthogonal end joins at `u=0` and `u=1`.
 */
export function sampleCornerQuadrantPoint(
  corner: RectangularCornerSpec,
  u: number,
  radialOffset: number
): { x: number; z: number; nx: number; nz: number; theta: number } {
  const clampedU = Math.min(1, Math.max(0, u));
  const spanTheta = corner.thetaEnd - corner.thetaStart;

  if (!corner.facetedThreeBay) {
    const theta = corner.thetaStart + clampedU * spanTheta;
    const nx = Math.cos(theta);
    const nz = Math.sin(theta);
    const r = corner.radius + radialOffset;
    return {
      x: corner.cx + nx * r,
      z: corner.cz + nz * r,
      nx,
      nz,
      theta,
    };
  }

  // 3 planar 30° bays (`bay = 0, 1, 2`) for modular rectangular closed-corner stadiums
  const scaled = clampedU * 3;
  const bay = Math.min(2, Math.floor(scaled));
  const f = Math.min(1, Math.max(0, scaled - bay));

  const interiorMiter = 1 / Math.cos(Math.PI / 12); // ~1.035276 exact bisector miter
  const miters = [1.0, interiorMiter, interiorMiter, 1.0];

  const a0 = corner.thetaStart + (bay / 3) * spanTheta;
  const a1 = corner.thetaStart + ((bay + 1) / 3) * spanTheta;

  const r0 = corner.radius + radialOffset * miters[bay];
  const r1 = corner.radius + radialOffset * miters[bay + 1];

  const x0 = corner.cx + Math.cos(a0) * r0;
  const z0 = corner.cz + Math.sin(a0) * r0;
  const x1 = corner.cx + Math.cos(a1) * r1;
  const z1 = corner.cz + Math.sin(a1) * r1;

  const midTheta = (a0 + a1) * 0.5;
  return {
    x: x0 + (x1 - x0) * f,
    z: z0 + (z1 - z0) * f,
    nx: Math.cos(midTheta),
    nz: Math.sin(midTheta),
    theta: a0 + (a1 - a0) * f,
  };
}


import * as THREE from 'three';
import { StadiumShape } from './schema';

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
  facetedCorners: boolean = false
): RoundedBowlGeometry {
  const maxFrac = facetedCorners ? 0.78 : 0.95;
  const r = Math.min(cornerRadius, innerHalfX * maxFrac, innerHalfZ * maxFrac);
  const halfStraightX = Math.max(2, innerHalfX - r);
  const halfStraightZ = Math.max(2, innerHalfZ - r);

  const straightXLen = halfStraightX * 2;
  const straightZLen = halfStraightZ * 2;
  const cornerSegLen = facetedCorners ? Math.SQRT2 * r : (Math.PI / 2) * r;
  const perimeter = 2 * straightXLen + 2 * straightZLen + 4 * cornerSegLen;

  return {
    halfStraightX,
    halfStraightZ,
    cornerRadius: r,
    facetedCorners,
    perimeter,
  };
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

  if (crossSectionClip) {
    return { tStart: 0.5, tEnd: 1.0, closed: false };
  }

  return { tStart: 0, tEnd: 1.0, closed: true };
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

    const cLen = Math.SQRT2 * r;
    const segLengths = [
      hz, // 0: E lower
      cLen, // 1: SE 45° chamfer
      hx * 2, // 2: S straight
      cLen, // 3: SW 45° chamfer
      hz * 2, // 4: W straight
      cLen, // 5: NW 45° chamfer
      hx * 2, // 6: N straight
      cLen, // 7: NE 45° chamfer
      hz, // 8: E upper
    ];

    let s = u * ring.perimeter;
    let segIdx = 0;
    for (let i = 0; i < segLengths.length; i++) {
      if (s <= segLengths[i] || i === segLengths.length - 1) {
        segIdx = i;
        break;
      }
      s -= segLengths[i];
    }
    const f = Math.min(1, Math.max(0, s / Math.max(1e-6, segLengths[segIdx])));
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

  const qArc = (Math.PI / 2) * r;
  const segLengths = [
    hz,
    qArc,
    hx * 2,
    qArc,
    hz * 2,
    qArc,
    hx * 2,
    qArc,
    hz,
  ];

  let s = u * ring.perimeter;
  let segIdx = 0;
  for (let i = 0; i < segLengths.length; i++) {
    if (s <= segLengths[i] || i === segLengths.length - 1) {
      segIdx = i;
      break;
    }
    s -= segLengths[i];
  }

  const segLen = Math.max(1e-6, segLengths[segIdx]);
  const f = Math.min(1, Math.max(0, s / segLen));

  let bx = 0;
  let bz = 0;
  let nx = 1;
  let nz = 0;

  switch (segIdx) {
    case 0:
      bx = hx + r;
      bz = f * hz;
      nx = 1;
      nz = 0;
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
      nx = 1;
      nz = 0;
      break;
  }

  return {
    x: bx + nx * radialOffset,
    z: bz + nz * radialOffset,
    nx,
    nz,
    angle: Math.atan2(nz, nx),
  };
}

export function buildShapeBowlRing(
  shape: StadiumShape,
  pitchLength: number,
  pitchWidth: number,
  avgDistX: number,
  avgDistZ: number,
  endTrackOffset: number,
  sideTrackOffset: number,
  hasTrack: boolean
): RoundedBowlGeometry {
  const octPush = shape === 'octagonal_arena' ? 6.2 : 0;
  const cauldronPull = shape === 'steep_cauldron' ? -0.6 : 0;
  const olympicPush = shape === 'olympic_oval' ? 1.8 : 0;
  const sunkenPush = shape === 'sunken_bowl' ? 0.6 : 0;

  const innerHalfX =
    pitchLength / 2 +
    Math.max(4.5, avgDistX + cauldronPull + olympicPush + octPush + sunkenPush) +
    endTrackOffset;
  const innerHalfZ =
    pitchWidth / 2 +
    Math.max(4.5, avgDistZ + cauldronPull + olympicPush + octPush + sunkenPush) +
    sideTrackOffset;

  const faceted = shape === 'octagonal_arena';
  const desiredR =
    shape === 'olympic_oval'
      ? innerHalfZ * 0.94
      : shape === 'sunken_bowl'
      ? hasTrack
        ? innerHalfZ * 0.9
        : 19
      : shape === 'steep_cauldron'
      ? hasTrack
        ? innerHalfZ * 0.85
        : 12.5
      : shape === 'compact_urban'
      ? hasTrack
        ? innerHalfZ * 0.78
        : 8.6
      : shape === 'english_rectangular'
      ? hasTrack
        ? innerHalfZ * 0.8
        : 10.2
      : shape === 'octagonal_arena'
      ? 22
      : shape === 'horseshoe'
      ? hasTrack
        ? innerHalfZ * 0.88
        : 16
      : hasTrack
      ? innerHalfZ * 0.92
      : 17;

  const cornerR = computeSafeBowlCornerRadius(
    innerHalfX,
    innerHalfZ,
    pitchLength / 2,
    pitchWidth / 2,
    2.6,
    desiredR,
    faceted
  );

  return createRoundedBowlRing(innerHalfX, innerHalfZ, cornerR, faceted);
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
  cx: number;
  cz: number;
  radius: number;
  thetaStart: number;
  thetaEnd: number;
  facetedThreeBay: boolean;
  sideA: RectangularSideId;
  sideB: RectangularSideId;
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
  crossSectionClip: boolean;
  pitchLength: number;
  pitchWidth: number;
  endTrackOffset: number;
  sideTrackOffset: number;
  stands: Record<
    RectangularSideId,
    { enabled: boolean; rows: number; distanceToPitch: number }
  >;
}): RectangularCornerLayout {
  const {
    shape,
    cornerFill,
    crossSectionClip,
    pitchLength,
    pitchWidth,
    endTrackOffset,
    sideTrackOffset,
    stands,
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

  const closedCornersMode =
    shape === 'compact_urban' || (shape === 'english_rectangular' && cornerFill);
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

  const seActive = closedCornersMode && isStandLive('east') && isStandLive('south');
  const swActive = closedCornersMode && isStandLive('west') && isStandLive('south');
  const nwActive = closedCornersMode && isStandLive('west') && isStandLive('north');
  const neActive = closedCornersMode && isStandLive('east') && isStandLive('north');

  const openOverhang = shape === 'four_stands' ? 4.0 : 2.0;

  // South stand (+Z, rotY = 0: local +X -> world +X)
  const southMinX = swActive ? westX + rSW : -(pitchHalfX + openOverhang);
  const southMaxX = seActive ? eastX - rSE : pitchHalfX + openOverhang;

  // North stand (-Z, rotY = PI: local -X -> world +X [NE], local +X -> world -X [NW])
  const northMinX = nwActive ? westX + rNW : -(pitchHalfX + openOverhang);
  const northMaxX = neActive ? eastX - rNE : pitchHalfX + openOverhang;

  // East stand (+X, rotY = +PI/2: local -X -> world +Z [SE], local +X -> world -Z [NE])
  const eastMinZ = neActive ? northZ + rNE : -(pitchHalfZ + openOverhang);
  const eastMaxZ = seActive ? southZ - rSE : pitchHalfZ + openOverhang;

  // West stand (-X, rotY = -PI/2: local -X -> world -Z [NW], local +X -> world +Z [SW])
  const westMinZ = nwActive ? northZ + rNW : -(pitchHalfZ + openOverhang);
  const westMaxZ = swActive ? southZ - rSW : pitchHalfZ + openOverhang;

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
        capNegLocalX: !swActive,
        capPosLocalX: !seActive,
      },
      north: {
        span: Math.max(8, northMaxX - northMinX),
        centerCoord: (northMinX + northMaxX) * 0.5,
        frontDist: northDist,
        capNegLocalX: !neActive,
        capPosLocalX: !nwActive,
      },
      east: {
        span: Math.max(8, eastMaxZ - eastMinZ),
        centerCoord: (eastMinZ + eastMaxZ) * 0.5,
        frontDist: eastDist,
        capNegLocalX: !seActive,
        capPosLocalX: !neActive,
      },
      west: {
        span: Math.max(8, westMaxZ - westMinZ),
        centerCoord: (westMinZ + westMaxZ) * 0.5,
        frontDist: westDist,
        capNegLocalX: !nwActive,
        capPosLocalX: !swActive,
      },
    },
    corners: {
      se: {
        id: 'se',
        active: seActive,
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
        active: swActive,
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
        active: nwActive,
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
        active: neActive,
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


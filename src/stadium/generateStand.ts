import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  buildShapeBowlRing,
  bowlSideWeights,
  computeRectangularCornerLayout,
  CornerQuadrantId,
  bowlSweepSegments,
  getBowlArcRange,
  isOnRingCorner,
  RectangularCornerSpec,
  ringSegmentStarts,
  RoundedBowlGeometry,
  sampleCornerQuadrantPoint,
  sampleRoundedBowlRing,
} from './bowlRing';
import {
  bowlMixAtT,
  bowlSectionAt,
  bowlStepJunctions,
  buildBowlSectionModel,
  usesBowlSectionModel,
} from './bowlSection';
import {
  buildCornerTunnel,
  CORNER_ACCESS_DECK_Y,
  CornerTunnelPlan,
  isTunnelBay,
  isTunnelQuad,
  planCornerTunnel,
  SweptStand,
} from './generateCornerAccess';
import {
  buildDugout,
  buildPressDesks,
  buildWireFence,
  DUGOUT_OFFSET,
  PRESS_PITCH,
  PressPlace,
  pressBoxLength,
  pressBoxTier,
  pressRowRange,
  resolveFenceHeight,
} from './generateStandFittings';
import { buildSkyboxGlazing } from './skyboxGlazing';
import {
  computeTelescopicProjection,
  getTrackRadialOffset,
  stadiumCornerLayout,
} from './capacity';
import {
  applyTurfCloseUpDetail,
  createConcreteBowlMaterial,
  createFacadePbrMaterial,
  createLedSponsorRibbonTexture,
  createPlazaDetailNormalAndRoughness,
  createSeatTerracePbrMaterial,
  createStructurePbrMaterial,
  resolveStadiumMaterials,
} from './materials';
import {
  clampPitchToTrack,
  CornerId,
  EnvelopeStyle,
  getEffectiveSunkenDepth,
  isContinuousBowlShape,
  isCornerConfigured,
  resolveAllCorners,
  resolveStandVomitories,
  vomitoryLevelLayout,
  StadiumDocument,
  StandConfig,
  StandSide,
  resolveCrowdAttendance,
  resolveSeats3d,
  resolveRingBreach,
  resolveUpperRingGaps,
  SIDE_RING_T,
} from './schema';
import { createStandSeatPainter, SeatPainter } from './seatPattern';
import { buildStandEnvelope, facadeGradeY, hasOwnFacade, isHollowStand, resolveStandFacade } from './envelopes';
import { splitRail } from './envelopes/rail';
import { CORNER_STRUCTURES } from './corners';
import { createStrut, ignoreRaycasts, setFarDetail } from './meshKit';
import { buildStandDetails } from './standDetails';
import {
  computeStandSection,
  StandSection,
  getTierStartRows,
  loggiaRecessD,
  OVERHANG_HEADROOM_M,
  resolveStandTiers,
  tierBreakDims,
  UPPER_TIER_STEEPENING,
} from './sightlines';

interface RowSample {
  d: number;
  y: number;
  tierIdx: number;
  riser: number;
  treadSegIdx: number;
}

interface BalconySample {
  d: number;
  y: number;
  tierIdx: number;
  loggiaD: number;
  loggiaY: number;
  recessD: number;
  soffitY: number;
  overhangSpan: number;
  /** Lowest level structure under the soffit may reach without entering the sheltered rows' headroom. */
  clearY: number;
  hasVipGlass: boolean;
}

interface TierBandSample {
  tierIdx: number;
  dStart: number;
  yStart: number;
  dEnd: number;
  yEnd: number;
  treadSegIndices: number[];
}

/** Run of rows a handrail or side guard follows: a tier, cut at each cross aisle. */
interface RailBandSample {
  tierIdx: number;
  dStart: number;
  yStart: number;
  dEnd: number;
  yEnd: number;
}

interface StandProfile {
  shape: THREE.Shape;
  profilePts: [number, number][];
  isSeatSegmentMask: boolean[];
  totalDepth: number;
  topHeight: number;
  rowPositions: RowSample[];
  balconies: BalconySample[];
  tierBands: TierBandSample[];
  railBands: RailBandSample[];
}

/** Lit sponsor-panel material for the balcony LED bands (one 8-panel tile per `LED_BAND_TILE_M`). */
function createLedFasciaMaterial(isDay: boolean): THREE.MeshStandardMaterial {
  const tex = createLedSponsorRibbonTexture();
  tex.repeat.set(1, 1);
  return new THREE.MeshStandardMaterial({
    map: tex,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: tex,
    emissiveIntensity: isDay ? 0.5 : 1.1,
    roughness: 0.3,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
}

const LED_BAND_TILE_M = 14.4;

/**
 * Pitch-facing LED advertising band hung on a balcony fascia: a vertical strip of `height`
 * centred on `centres`, with texture U following arc length so panels keep a constant width.
 */
function buildLedFasciaBand(
  centres: THREE.Vector3[],
  height: number,
  mat: THREE.Material
): THREE.Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let run = 0;
  centres.forEach((p, i) => {
    if (i > 0) {
      run += p.distanceTo(centres[i - 1]);
      const b = (i - 1) * 2;
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
    const u = run / LED_BAND_TILE_M;
    pos.push(p.x, p.y - height / 2, p.z, p.x, p.y + height / 2, p.z);
    uv.push(u, 0, u, 1);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'BalconyLedBand';
  return mesh;
}

/**
 * Builds the 2D cross-section profile of a stand (1 to 5 asymmetric tiers) with adjustable
 * cantilevered upper-tier overhangs, optional VIP skybox loggias, and optional hollow structural soffit
 * when `hollowUnderside === true` (for `exposed_structure` and `colonnade_forest` envelopes).
 */
function buildStandProfilePoints(
  stand: StandConfig,
  hollowUnderside: boolean = false
): StandProfile {
  const shape = new THREE.Shape();
  const profilePts: [number, number][] = [];
  const isSeatSegmentMask: boolean[] = [];
  const rowPositions: RowSample[] = [];
  const balconies: BalconySample[] = [];
  const tierBands: TierBandSample[] = [];
  const railBands: RailBandSample[] = [];

  const section = computeStandSection(stand);

  const pushStart = (x: number, y: number) => {
    shape.moveTo(x, y);
    profilePts.push([x, y]);
  };

  const pushSeg = (x: number, y: number, isSeatTread: boolean): number => {
    const segIdx = isSeatSegmentMask.length;
    shape.lineTo(x, y);
    profilePts.push([x, y]);
    isSeatSegmentMask.push(isSeatTread);
    return segIdx;
  };

  pushStart(0, 0);

  // Front pitch-side retaining wall + parapet
  const parapetTop = stand.elevationStart + 0.58;
  pushSeg(0, parapetTop, false);
  pushSeg(0.34, parapetTop, false);
  pushSeg(0.34, stand.elevationStart, false);

  let rowIdx = 0;
  for (const tier of section.tiers) {
    const brk = section.breaks.find((b) => b.tierIdx === tier.tierIndex);
    if (brk) {
      // Loggia back wall, soffit over the sheltered rows, then the balcony fascia.
      pushSeg(brk.recessD, brk.fromY, false);
      pushSeg(brk.recessD, brk.soffitY, false);
      pushSeg(brk.frontD, brk.soffitY, false);
      pushSeg(brk.frontD, brk.topY, false);

      const sheltered = section.rows.filter((r) => r.d + stand.rowDepth > brk.frontD);
      const highestShelteredTread = sheltered.reduce((m, r) => Math.max(m, r.y), -Infinity);
      balconies.push({
        d: brk.frontD,
        y: (brk.soffitY + brk.topY) * 0.5,
        tierIdx: brk.tierIdx,
        loggiaD: brk.recessD - 0.15,
        loggiaY: (brk.fromY + brk.soffitY) * 0.5,
        recessD: brk.recessD,
        soffitY: brk.soffitY,
        overhangSpan: Math.max(0, brk.recessD - brk.frontD),
        clearY: Number.isFinite(highestShelteredTread)
          ? highestShelteredTread + OVERHANG_HEADROOM_M - 0.2
          : brk.fromY,
        hasVipGlass: brk.hasVip,
      });
    }

    const tierRows = section.rows.slice(rowIdx, rowIdx + tier.rows);
    rowIdx += tier.rows;
    if (tierRows.length === 0) continue;
    const treadSegIndices: number[] = [];
    for (const row of tierRows) {
      if (row.crossAisle) {
        // Cross aisle walkway, then the wall up to the rows behind it.
        pushSeg(row.d, row.y - row.crossAisle.wall, false);
        pushSeg(row.d, row.y, false);
      }
      const treadIdx = pushSeg(row.d + stand.rowDepth, row.y, true);
      treadSegIndices.push(treadIdx);
      rowPositions.push({
        d: row.d + stand.rowDepth * 0.52,
        y: row.y,
        tierIdx: row.tierIdx,
        riser: row.riser,
        treadSegIdx: treadIdx,
      });
      pushSeg(row.d + stand.rowDepth, row.y + row.riser, false);
    }
    const last = tierRows[tierRows.length - 1];
    let runStart = tierRows[0];
    tierRows.forEach((row, i) => {
      const next = tierRows[i + 1];
      if (next && !next.crossAisle) return;
      railBands.push({
        tierIdx: tier.tierIndex,
        dStart: runStart.d,
        yStart: runStart.y,
        dEnd: row.d + stand.rowDepth,
        yEnd: row.y + row.riser,
      });
      if (next) runStart = next;
    });
    tierBands.push({
      tierIdx: tier.tierIndex,
      dStart: tierRows[0].d,
      yStart: tierRows[0].y,
      dEnd: last.d + stand.rowDepth,
      yEnd: last.y + last.riser,
      treadSegIndices,
    });
  }

  const curD = section.endD;
  const outerWallD = section.totalDepth;
  const topHeight = section.topHeight;
  pushSeg(curD, topHeight, false);
  pushSeg(outerWallD, topHeight, false);

  if (hollowUnderside && topHeight > 5.0) {
    // Open inclined concrete slab soffit (~1.55m thickness) revealing the underside of the tiers!
    const rearBeamBotY = Math.max(2.2, topHeight - 2.35);
    const midSoffitD = Math.max(3.6, outerWallD * 0.5);
    const midSoffitY = Math.max(1.4, topHeight * 0.44 - 1.4);
    pushSeg(outerWallD, rearBeamBotY, false);
    pushSeg(midSoffitD, midSoffitY, false);
    pushSeg(2.4, 0, false);
  } else {
    pushSeg(outerWallD, 0, false);
  }

  shape.closePath();

  return {
    shape,
    profilePts,
    isSeatSegmentMask,
    totalDepth: outerWallD,
    topHeight,
    rowPositions,
    balconies,
    tierBands,
    railBands,
  };
}

function createConcourseTurnstileTexture(isNight: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, 512, 128);

  for (let x = 8; x < 512; x += 32) {
    const grad = ctx.createLinearGradient(0, 14, 0, 124);
    if (isNight) {
      grad.addColorStop(0, '#b45309');
      grad.addColorStop(0.45, '#fde68a');
      grad.addColorStop(1, '#78350f');
    } else {
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(0.5, '#1e3a5f');
      grad.addColorStop(1, '#334155');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(x, 14, 24, 110);

    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(x + 10, 68, 3, 56);
    ctx.fillRect(x + 2, 88, 20, 2.5);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(8, 1);
  tex.needsUpdate = true;
  return tex;
}

function createPlayersTunnelPortal(): THREE.Group {
  const tunnel = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.42,
    metalness: 0.25,
  });
  const darkMouthMat = new THREE.MeshStandardMaterial({
    color: 0x020617,
    roughness: 0.95,
  });

  const portalFrame = new THREE.Mesh(new THREE.BoxGeometry(6.8, 3.1, 2.2), frameMat);
  portalFrame.position.set(0, 1.55, 0.9);
  portalFrame.castShadow = true;

  const darkOpening = new THREE.Mesh(new THREE.BoxGeometry(5.4, 2.55, 2.3), darkMouthMat);
  darkOpening.position.set(0, 1.28, 0.82);

  tunnel.add(portalFrame, darkOpening);
  return tunnel;
}

/**
 * Builds a pitch-side retractable/telescopic modular lower tier cassette
 * (`z` in `[-advanceMeters, -0.08]`, strictly outside pitch safety zone).
 */
function buildStraightTelescopicModule(
  spanLength: number,
  extraRows: number,
  advanceMeters: number,
  elevationEnd: number,
  seatMat: THREE.Material
): THREE.Group {
  const modGroup = new THREE.Group();
  const usableSpan = Math.max(12, spanLength - 4.0);
  const stepD = advanceMeters / Math.max(1, extraRows);
  const startY = 0.22;
  const stepRiser = Math.max(0.11, (elevationEnd - startY) / Math.max(1, extraRows));

  const steelUnderMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.44,
    metalness: 0.78,
  });

  // Stepped dark modular steel deck + instanced seat rows
  const deckGeo = new THREE.BoxGeometry(usableSpan, 0.14, stepD * 0.96);
  const seatGeo = new THREE.BoxGeometry(usableSpan - 0.5, 0.28, stepD * 0.78);
  const decks = new THREE.InstancedMesh(deckGeo, steelUnderMat, extraRows);
  const seats = new THREE.InstancedMesh(seatGeo, seatMat, extraRows);
  decks.castShadow = true;
  seats.castShadow = true;
  seats.receiveShadow = true;

  const dummy = new THREE.Object3D();
  for (let r = 0; r < extraRows; r++) {
    const zPos = -advanceMeters + (r + 0.5) * stepD;
    const yPos = startY + r * stepRiser;
    dummy.position.set(0, yPos, zPos);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    decks.setMatrixAt(r, dummy.matrix);

    dummy.position.set(0, yPos + 0.18, zPos + 0.04);
    dummy.updateMatrix();
    seats.setMatrixAt(r, dummy.matrix);
  }
  decks.instanceMatrix.needsUpdate = true;
  seats.instanceMatrix.needsUpdate = true;
  decks.computeBoundingSphere();
  seats.computeBoundingSphere();
  modGroup.add(decks, seats);

  // Scissor undercarriage steel support frames every ~9m
  const frameBays = Math.max(4, Math.floor(usableSpan / 9));
  for (let b = 0; b <= frameBays; b++) {
    const bx = -usableSpan / 2 + (b * usableSpan) / frameBays;
    modGroup.add(
      createStrut(
        new THREE.Vector3(bx, 0.05, -advanceMeters + 0.2),
        new THREE.Vector3(bx, elevationEnd - 0.08, -0.15),
        0.07,
        0.07,
        steelUnderMat,
        5
      ),
      createStrut(
        new THREE.Vector3(bx, 0.05, -0.2),
        new THREE.Vector3(bx, elevationEnd - 0.12, -0.2),
        0.08,
        0.08,
        steelUnderMat,
        5
      )
    );
  }

  // Front low modular guardrail
  const frontRail = new THREE.Mesh(
    new THREE.BoxGeometry(usableSpan, 0.52, 0.06),
    steelUnderMat
  );
  frontRail.position.set(0, startY + 0.32, -advanceMeters + 0.04);
  modGroup.add(frontRail);

  return modGroup;
}

/**
 * Builds a recessed 3D concourse vomitory tunnel fitting cleanly inside a physically carved
 * terrace opening (`[0 .. openDepth]` in local +Z, `[0 .. openRise]` in local +Y).
 */
/** Block numbers over the vomitories: 128 plates in one atlas, numbered 101, 102… in build order. */
const VOM_SIGN_COLS = 8;
const VOM_SIGN_ROWS = 16;
let vomitorySigns: { mat: THREE.MeshStandardMaterial; next: number } | null = null;

/** Starts each stadium build's numbering at 101 with a fresh atlas (freed with the build). */
function resetVomitorySigns(): void {
  vomitorySigns = null;
}

/** A sign plate (1 x 1, facing -z) showing the next block number. */
function nextVomitorySign(): THREE.Mesh {
  if (!vomitorySigns) {
    const cw = 64;
    const ch = 32;
    const canvas = document.createElement('canvas');
    canvas.width = cw * VOM_SIGN_COLS;
    canvas.height = ch * VOM_SIGN_ROWS;
    const ctx = canvas.getContext('2d')!;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 20px Arial, Helvetica, sans-serif';
    for (let i = 0; i < VOM_SIGN_COLS * VOM_SIGN_ROWS; i++) {
      const x = (i % VOM_SIGN_COLS) * cw;
      const y = Math.floor(i / VOM_SIGN_COLS) * ch;
      ctx.fillStyle = '#1d2a48';
      ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = '#f2f4f7';
      ctx.fillRect(x + 2, y + 2, cw - 4, 2);
      ctx.fillText(String(101 + i), x + cw / 2, y + ch / 2 + 2);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    vomitorySigns = { mat: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.1 }), next: 0 };
  }
  const cell = vomitorySigns.next++ % (VOM_SIGN_COLS * VOM_SIGN_ROWS);
  const col = cell % VOM_SIGN_COLS;
  const row = Math.floor(cell / VOM_SIGN_COLS);
  const geo = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (col + uv.getX(i)) / VOM_SIGN_COLS, 1 - (row + 1 - uv.getY(i)) / VOM_SIGN_ROWS);
  }
  const sign = new THREE.Mesh(geo, vomitorySigns.mat);
  sign.name = 'VomitoryBlockSign';
  return sign;
}

function createCarvedVomitoryTunnel(
  width: number,
  openDepth: number,
  openRise: number,
  portalMat: THREE.Material,
  darkMouthMat: THREE.Material,
  railMat: THREE.Material,
  isNight: boolean = false
): THREE.Group {
  const unit = new THREE.Group();
  unit.name = 'VomitoryOpeningPortal';

  const safeW = Math.max(1.4, width);
  const safeD = Math.max(1.8, openDepth);
  const safeH = Math.max(1.4, openRise);
  const cheekThick = 0.2;

  // Horizontal walk-in concourse landing floor inside the carved steps
  const floorSlab = new THREE.Mesh(
    new THREE.BoxGeometry(safeW + cheekThick, 0.2, safeD + 0.35),
    portalMat
  );
  floorSlab.position.set(0, -0.08, safeD * 0.5 + 0.1);
  floorSlab.receiveShadow = true;
  unit.add(floorSlab);

  // Left & right triangular/stepped concrete cheek walls sealing the cut terrace profile
  const cheekShape = new THREE.Shape();
  cheekShape.moveTo(0, -0.12);
  cheekShape.lineTo(safeD + 0.25, -0.12);
  cheekShape.lineTo(safeD + 0.25, safeH + 0.28);
  cheekShape.lineTo(safeD * 0.35, safeH * 0.55 + 0.24);
  cheekShape.lineTo(0, 0.22);
  cheekShape.closePath();

  const cheekExtrude = new THREE.ExtrudeGeometry(cheekShape, {
    depth: cheekThick,
    bevelEnabled: false,
  });
  cheekExtrude.rotateY(-Math.PI * 0.5);
  // After -90° Y rotation: shape X -> +Z, shape Y -> +Y, extrude Z -> -X
  const leftCheek = new THREE.Mesh(cheekExtrude, portalMat);
  leftCheek.position.set(-safeW * 0.5 + cheekThick * 0.5, 0, 0);
  leftCheek.castShadow = true;
  leftCheek.receiveShadow = true;

  const rightCheek = new THREE.Mesh(cheekExtrude, portalMat);
  rightCheek.position.set(safeW * 0.5 + cheekThick * 0.5, 0, 0);
  rightCheek.castShadow = true;
  rightCheek.receiveShadow = true;
  unit.add(leftCheek, rightCheek);

  // Rear concrete lintel hood at top of the carved opening
  const hood = new THREE.Mesh(
    new THREE.BoxGeometry(safeW + cheekThick * 2, 0.28, 0.95),
    portalMat
  );
  hood.position.set(0, safeH + 0.14, safeD - 0.2);
  hood.castShadow = true;
  unit.add(hood);

  // Deep dark concourse throat recessed at the rear of the opening
  const throatH = Math.max(1.25, safeH - 0.08);
  const darkThroat = new THREE.Mesh(
    new THREE.BoxGeometry(safeW - cheekThick * 0.8, throatH, 0.9),
    darkMouthMat
  );
  darkThroat.position.set(0, throatH * 0.5, safeD + 0.08);
  unit.add(darkThroat);

  // Block number on the back wall of the opening, read from the pitch and the rows below.
  const sign = nextVomitorySign();
  sign.scale.set(Math.min(1.1, safeW * 0.55), 0.4, 1);
  sign.position.set(0, throatH - 0.34, safeD - 0.38);
  unit.add(sign);

  // Steel gates folded back against both cheeks, and the threshold strip at the landing's edge.
  const gateH = throatH * 0.92;
  const gateW = (safeW - cheekThick * 2) * 0.45;
  for (const side of [-1, 1]) {
    const gate = new THREE.Mesh(new THREE.BoxGeometry(0.05, gateH, gateW), railMat);
    gate.position.set(side * (safeW * 0.5 - cheekThick - 0.06), gateH * 0.5 + 0.02, safeD - 0.4 - gateW * 0.5);
    gate.castShadow = true;
    unit.add(gate);
    for (let k = 1; k < 3; k++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, gateW), railMat);
      bar.position.set(gate.position.x, (gateH * k) / 3, gate.position.z);
      unit.add(bar);
    }
  }

  if (isNight) {
    const warmCeilingMat = new THREE.MeshBasicMaterial({
      color: 0xfde68a,
    });
    const lightStrip = new THREE.Mesh(
      new THREE.BoxGeometry((safeW - 0.5) * 0.8, 0.08, 0.35),
      warmCeilingMat
    );
    lightStrip.position.set(0, throatH - 0.08, safeD - 0.12);
    unit.add(lightStrip);
  }

  // Tubular galvanized safety guardrails around the rear brow & side flanks
  const browY = safeH + 0.82;
  const browZ = safeD + 0.08;
  const rearGuard = new THREE.Mesh(
    new THREE.BoxGeometry(safeW + 0.16, 0.055, 0.055),
    railMat
  );
  rearGuard.position.set(0, browY, browZ);
  const midRearGuard = new THREE.Mesh(
    new THREE.BoxGeometry(safeW + 0.16, 0.04, 0.04),
    railMat
  );
  midRearGuard.position.set(0, safeH + 0.48, browZ);
  unit.add(rearGuard, midRearGuard);

  for (const sx of [-safeW * 0.5, safeW * 0.5]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.62, 6),
      railMat
    );
    post.position.set(sx, safeH + 0.52, browZ);
    unit.add(post);

    // Inclined side guardrail along cheek wall
    unit.add(
      createStrut(
        new THREE.Vector3(sx, 0.72, 0.18),
        new THREE.Vector3(sx, browY, browZ),
        0.028,
        0.028,
        railMat,
        6
      )
    );
  }

  return unit;
}

function createVomitoryPortalUnit(
  portalMat: THREE.Material,
  darkMouthMat: THREE.Material,
  railMat: THREE.Material
): THREE.Group {
  return createCarvedVomitoryTunnel(2.2, 2.2, 1.65, portalMat, darkMouthMat, railMat, false);
}

function buildStraightStandMesh(
  stand: StandConfig,
  spanLength: number,
  capNegLocalX: boolean,
  capPosLocalX: boolean,
  doc: StadiumDocument,
  seatMat: THREE.MeshPhysicalMaterial,
  concreteMat: THREE.MeshStandardMaterial,
  facadeMat: THREE.MeshPhysicalMaterial,
  structureMat: THREE.MeshPhysicalMaterial,
  turnstileTex: THREE.CanvasTexture
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const isHollow = isHollowStand(doc, stand);
  const isNight = doc.lighting !== 'day';

  const {
    shape,
    profilePts,
    isSeatSegmentMask,
    totalDepth,
    topHeight,
    rowPositions,
    balconies,
    tierBands,
    railBands,
  } = buildStandProfilePoints(stand, isHollow);

  const sunkenDepth = getEffectiveSunkenDepth(doc);
  const gradeY = facadeGradeY(sunkenDepth, topHeight);
  const totalRowsCount = Math.max(1, rowPositions.length);

  // Resolve vomitory openings & longitudinal slice breaks so openings are physically carved into the stand mesh
  const vomSpec = resolveStandVomitories(stand);
  const vomHalfW = Math.min(1.3, Math.max(0.85, spanLength / Math.max(18, vomSpec.count * 6)));

  interface CarvedVomitoryZone {
    tierIdx: number;
    vx: number;
    xMin: number;
    xMax: number;
    dStart: number;
    yStart: number;
    dEnd: number;
    yEnd: number;
    segSet: Set<number>;
  }

  const carvedZones: CarvedVomitoryZone[] = [];
  if (vomSpec.count > 0 && spanLength > 10) {
    for (const band of tierBands) {
      const nBandRows = band.treadSegIndices.length;
      if (nBandRows < 5 || band.dEnd - band.dStart < 3.6) continue;

      // One or more rows of openings up the tier, each in its share of the rows.
      const layout = vomitoryLevelLayout(stand, nBandRows);
      const rowsPerLevel = nBandRows / layout.length;
      const openRows = Math.min(5, Math.max(3, Math.round(rowsPerLevel * 0.24)));
      layout.forEach((level, k) => {
        const lo = Math.max(1, Math.round(k * rowsPerLevel));
        const hi = Math.min(nBandRows - 1, Math.round((k + 1) * rowsPerLevel) - 1);
        const centerRow = Math.min(nBandRows - 2, Math.max(1, Math.round((nBandRows - 1) * level.ratio)));
        const rStart = Math.max(lo, Math.min(hi - openRows + 1, centerRow - Math.floor(openRows * 0.5)));
        const rEnd = Math.min(hi, rStart + openRows - 1);
        if (rEnd - rStart < 2) return;

        const segSet = new Set<number>();
        for (let r = rStart; r <= rEnd; r++) {
          const tSeg = band.treadSegIndices[r];
          segSet.add(tSeg); // horizontal tread
          segSet.add(tSeg + 1); // vertical riser behind tread
        }
        const firstSeg = band.treadSegIndices[rStart];
        const lastSeg = band.treadSegIndices[rEnd];
        const [dOpenStart, yOpenStart] = profilePts[firstSeg];
        const [dOpenEnd, yOpenEnd] = profilePts[Math.min(profilePts.length - 1, lastSeg + 2)];

        for (const posFrac of level.positions) {
          const vx = -spanLength * 0.5 + posFrac * spanLength;
          if (stand.id === 'south' && band.tierIdx === 0 && k === 0 && Math.abs(vx) < 6.4) {
            continue;
          }
          const xMin = Math.max(-spanLength * 0.5 + 0.8, vx - vomHalfW);
          const xMax = Math.min(spanLength * 0.5 - 0.8, vx + vomHalfW);
          if (xMax - xMin < 1.2) continue;

          carvedZones.push({
            tierIdx: band.tierIdx,
            vx: (xMin + xMax) * 0.5,
            xMin,
            xMax,
            dStart: dOpenStart,
            yStart: yOpenStart,
            dEnd: dOpenEnd,
            yEnd: yOpenEnd,
            segSet,
          });
        }
      });
    }
  }

  // Build descending X slice coordinates `[+span/2 ... -span/2]` with exact cuts at every vomitory cheek
  const rawXs: number[] = [spanLength * 0.5, -spanLength * 0.5];
  for (const cz of carvedZones) {
    rawXs.push(cz.xMin, cz.xMax);
  }
  rawXs.sort((a, b) => b - a);
  const sliceXs: number[] = [];
  for (const x of rawXs) {
    if (sliceXs.length === 0 || Math.abs(sliceXs[sliceXs.length - 1] - x) > 0.08) {
      sliceXs.push(x);
    }
  }
  if (sliceXs.length < 2) {
    sliceXs.length = 0;
    sliceXs.push(spanLength * 0.5, -spanLength * 0.5);
  }

  const sliceRingCount = sliceXs.length;
  const sliceActiveSegs = sliceRingCount - 1;
  const profilePtsPerSlice = Array.from({ length: sliceRingCount }, () => profilePts);

  const isHoleQuad = (s: number, p: number): boolean => {
    if (carvedZones.length === 0) return false;
    const xMid = (sliceXs[s] + sliceXs[s + 1]) * 0.5;
    for (const cz of carvedZones) {
      if (xMid > cz.xMin + 0.02 && xMid < cz.xMax - 0.02 && cz.segSet.has(p)) {
        return true;
      }
    }
    return false;
  };

  // 1. Multi-material stepped concrete + 1:1 life-size seat terrace bowl (`+Y` upward treads, `-Z` pitch risers)
  const uRepeat = Math.max(1, Math.round(spanLength / 46));
  const vRepeat = Math.max(1.0, totalRowsCount / 24);
  const straightBowlGeo = buildMultiMaterialSweptStandGeometry(
    sliceRingCount,
    sliceActiveSegs,
    false,
    profilePtsPerSlice,
    (s, radD, py) => [sliceXs[s], py, radD],
    isSeatSegmentMask,
    uRepeat,
    vRepeat,
    isHoleQuad,
    (s) => (spanLength * 0.5 - sliceXs[s]) / Math.max(1e-5, spanLength)
  );

  const seats3d = resolveSeats3d(mats);
  const bowlMesh = new THREE.Mesh(straightBowlGeo, [concreteMat, seats3d ? concreteMat : seatMat]);
  bowlMesh.castShadow = true;
  bowlMesh.receiveShadow = true;
  group.add(bowlMesh);

  // Press box: rows of the chosen tier, in the middle of the stand.
  const pressSegs = new Set<number>();
  const pressPlaces: PressPlace[] = [];
  const pressHalf = pressBoxLength(stand, spanLength) / 2;
  if (stand.pressBox && stand.seatingType !== 'safe_standing') {
    const tierCount = rowPositions.reduce((n, r) => Math.max(n, r.tierIdx + 1), 1);
    const pressTier = pressBoxTier(stand, tierCount);
    const tierRowsList = rowPositions.filter((r) => r.tierIdx === pressTier);
    const [r0, r1] = pressRowRange(tierRowsList.length, pressTier, tierCount, stand);
    for (const row of tierRowsList.slice(r0, r1)) {
      pressSegs.add(row.treadSegIdx);
      const front = profilePts[row.treadSegIdx];
      for (let x = -pressHalf + PRESS_PITCH / 2; x < pressHalf; x += PRESS_PITCH) {
        pressPlaces.push({ x, y: front[1], z: front[0], yaw: 0 });
      }
    }
    const desks = buildPressDesks(pressPlaces, isNight);
    if (desks) group.add(desks);
  }

  const details = buildStandDetails({
    ringCount: sliceRingCount,
    activeSegments: sliceActiveSegs,
    closed: false,
    profilePtsPerSlice,
    sampleWorldPoint: (s, radD, py) => [sliceXs[s], py, radD],
    isSeatSegmentMask,
    isHoleQuad,
    aisleCount: stand.aisleCount,
    aisleWidth: stand.aisleWidth,
    lit: doc.lighting !== 'day',
  });
  if (details) group.add(details);

  if (seats3d && stand.seatingType !== 'safe_standing') {
    const standPainter = createStandSeatPainter(doc, stand);
    const seats = buildSweepSeatInstances({
      ringCount: sliceRingCount,
      activeSegments: sliceActiveSegs,
      closed: false,
      profilePtsPerSlice,
      sampleWorldPoint: (s, radD, py) => [sliceXs[s], py, radD],
      isSeatSegmentMask,
      rowDepth: stand.rowDepth,
      seatWidth: stand.seatWidth,
      aisleCount: stand.aisleCount,
      aisleWidth: stand.aisleWidth,
      primaryHex: doc.colors.seatsPrimary,
      secondaryHex: doc.colors.seatsSecondary,
      isHoleQuad,
      skipSeat: (pos, p) => pressSegs.has(p) && Math.abs(pos.x) < pressHalf,
      attendance: resolveCrowdAttendance(mats),
      tifo: mats.crowd === true && stand.tifo,
      // Rows run left to right as seen from the pitch.
      paint: (seat, out) => standPainter(seat.tier, { ...seat, u: seat.along / Math.max(1e-6, seat.rowLength) }, out),
    });
    if (seats) group.add(seats);
  }

  if (seats3d && stand.seatingType === 'safe_standing') {
    const fans = buildCrowd(
      standingSpots(rowPositions, spanLength, stand.aisleCount, stand.aisleWidth),
      {
        attendance: resolveCrowdAttendance(mats),
        primary: new THREE.Color(doc.colors.seatsPrimary),
        secondary: new THREE.Color(doc.colors.seatsSecondary),
        pose: 'standing',
        tifo: mats.crowd === true && stand.tifo,
      }
    );
    if (fans) group.add(fans);
  }

  // 2. Open-End Concrete Gable Walls & Stepped Side Safety Balustrades ONLY on genuinely open ends!
  if (capNegLocalX || capPosLocalX) {
    const capWallMat = concreteMat.clone();
    capWallMat.side = THREE.DoubleSide;
    const sideGuardMat = new THREE.MeshPhysicalMaterial({
      color: 0xcbd5e1,
      roughness: 0.14,
      metalness: 0.25,
      clearcoat: 0.85,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
    });

    for (const endSpec of [
      { open: capNegLocalX, lx: -spanLength * 0.5 },
      { open: capPosLocalX, lx: spanLength * 0.5 },
    ]) {
      if (!endSpec.open) continue;

      const capGeo = new THREE.ShapeGeometry(shape);
      const posAttr = capGeo.attributes.position;
      const uvAttr = capGeo.attributes.uv;
      for (let i = 0; i < posAttr.count; i++) {
        const d = posAttr.getX(i);
        const y = posAttr.getY(i);
        posAttr.setXYZ(i, endSpec.lx, y, d);
        if (uvAttr) uvAttr.setXY(i, d * 0.08, y * 0.08);
      }
      capGeo.computeVertexNormals();
      const capMesh = new THREE.Mesh(capGeo, capWallMat);
      capMesh.castShadow = true;
      capMesh.receiveShadow = true;
      group.add(capMesh);

      for (const band of railBands) {
        const pStart = new THREE.Vector3(
          endSpec.lx + (endSpec.lx > 0 ? -0.12 : 0.12),
          band.yStart + 0.9,
          band.dStart + 0.2
        );
        const pEnd = new THREE.Vector3(
          endSpec.lx + (endSpec.lx > 0 ? -0.12 : 0.12),
          band.yEnd + 0.9,
          band.dEnd - 0.1
        );
        group.add(createStrut(pStart, pEnd, 0.055, 0.055, sideGuardMat, 5));
      }
    }
  }

  // 3. Pitch-Side Laminated Glass Safety Guardrail
  const glassRailMat = new THREE.MeshPhysicalMaterial({
    color: 0xe0f2fe,
    roughness: 0.08,
    metalness: 0.1,
    clearcoat: 0.95,
    transparent: true,
    opacity: 0.52,
    side: THREE.DoubleSide,
  });
  if (doc.frontFence === 'mesh') {
    const steps = Math.max(2, Math.ceil(spanLength / 1.5));
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      points.push(new THREE.Vector3(spanLength * (0.5 - i / steps), stand.elevationStart + 0.58, 0.12));
    }
    group.add(
      buildWireFence(
        [{ points, inward: points.map(() => new THREE.Vector3(0, 0, -1)) }],
        resolveFenceHeight(doc.frontFenceHeight)
      )
    );
  } else {
    const frontGlassRail = new THREE.Mesh(
      new THREE.BoxGeometry(spanLength - 0.06, 0.68, 0.06),
      glassRailMat
    );
    frontGlassRail.position.set(0, stand.elevationStart + 0.92, 0.17);
    group.add(frontGlassRail);
  }

  // 4. Continuous backrest strips stand in for seats on the lighter painted terrace
  if (!seats3d && rowPositions.length > 0) {
    const backrestGeo = new THREE.BoxGeometry(
      Math.max(1, spanLength - 0.16),
      0.27,
      0.11
    );
    const instancedBackrests = new THREE.InstancedMesh(
      backrestGeo,
      seatMat,
      rowPositions.length
    );
    instancedBackrests.castShadow = true;
    instancedBackrests.receiveShadow = true;

    const dummyBack = new THREE.Object3D();
    rowPositions.forEach((rp, idx) => {
      dummyBack.position.set(0, rp.y + 0.23, rp.d + stand.rowDepth * 0.24);
      dummyBack.rotation.set(-0.14, 0, 0);
      dummyBack.scale.set(1, 1, 1);
      dummyBack.updateMatrix();
      instancedBackrests.setMatrixAt(idx, dummyBack.matrix);
    });
    instancedBackrests.instanceMatrix.needsUpdate = true;
    instancedBackrests.computeBoundingSphere();
    group.add(instancedBackrests);
  }

  // 5. Recessed 3D Vomitory Tunnel Portals inside each carved terrace opening + 3D Stepped Radial Stairs
  const vomPortalMat = new THREE.MeshStandardMaterial({
    color: 0x8b9199,
    roughness: 0.9,
    metalness: 0.02,
  });
  const darkVomMat = new THREE.MeshStandardMaterial({
    color: 0x1a1714,
    roughness: 0.96,
  });
  const vomRailMat = new THREE.MeshStandardMaterial({
    color: 0x9ca3af,
    roughness: 0.28,
    metalness: 0.85,
  });

  for (const cz of carvedZones) {
    const portal = createCarvedVomitoryTunnel(
      cz.xMax - cz.xMin,
      cz.dEnd - cz.dStart,
      cz.yEnd - cz.yStart,
      vomPortalMat,
      darkVomMat,
      vomRailMat,
      isNight
    );
    portal.position.set(cz.vx, cz.yStart, cz.dStart);
    group.add(portal);
  }

  const dummy = new THREE.Object3D();

  // 5b. Central handrails along aisles (the stair steps themselves come from standDetails).
  if (stand.aisleCount > 0 && rowPositions.length > 0) {
    for (let a = 0; a < stand.aisleCount; a++) {
      // Match buildSweepSeatInstances X coordinates (`s=0` is `+span/2`, `s=end` is `-span/2`)
      const ax = spanLength * 0.5 - ((a + 0.5) / stand.aisleCount) * spanLength;

      // Central brushed-steel stair handrail per run of rows: stopped at each cross aisle and
      // around any carved vomitory.
      for (const band of railBands) {
        const zones = carvedZones
          .filter(
            (cz) =>
              cz.tierIdx === band.tierIdx &&
              ax > cz.xMin - 0.35 &&
              ax < cz.xMax + 0.35 &&
              cz.dStart < band.dEnd &&
              cz.dEnd > band.dStart
          )
          .sort((a, b) => a.dStart - b.dStart);
        const rail = (d0: number, y0: number, d1: number, y1: number) =>
          group.add(
            createStrut(
              new THREE.Vector3(ax, y0 + 0.85, d0),
              new THREE.Vector3(ax, y1 + 0.85, d1),
              0.028,
              0.028,
              vomRailMat,
              6
            )
          );
        if (zones.length === 0) {
          if (band.dEnd - band.dStart > 1.8) rail(band.dStart + 0.25, band.yStart, band.dEnd - 0.25, band.yEnd);
          continue;
        }
        // From the band's foot to the first opening, between openings, then on to its top.
        let d = band.dStart;
        let y = band.yStart;
        for (const z of zones) {
          if (z.dStart - d > 1.2) rail(d + 0.25, y, z.dStart - 0.15, z.yStart);
          d = z.dEnd;
          y = z.yEnd;
        }
        if (band.dEnd - d > 1.2) rail(d + 0.25, y, band.dEnd - 0.25, band.yEnd);
      }
    }
  }

  // Safe Standing Continuous Steel Crush-Barrier Rails (`seatingType === 'safe_standing'`)
  if (stand.seatingType === 'safe_standing') {
    const standingRows = rowPositions.filter(
      (rp) => stand.tiers === 1 || rp.tierIdx === 0
    );
    if (standingRows.length > 0) {
      const railGeo = new THREE.BoxGeometry(spanLength - 0.4, 0.065, 0.065);
      const rails = new THREE.InstancedMesh(railGeo, vomRailMat, standingRows.length);
      standingRows.forEach((rp, idx) => {
        dummy.position.set(0, rp.y + 0.72, rp.d - stand.rowDepth * 0.34);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        rails.setMatrixAt(idx, dummy.matrix);
      });
      rails.instanceMatrix.needsUpdate = true;
      rails.computeBoundingSphere();
      group.add(rails);
    }
  }

  // Telescopic / Modular Retractable Lower Tier (`seatingType === 'telescopic'`)
  if (stand.seatingType === 'telescopic') {
    const tele = computeTelescopicProjection(doc, stand.id);
    if (tele.extraRows > 0 && tele.advanceMeters > 0) {
      group.add(
        buildStraightTelescopicModule(
          spanLength,
          tele.extraRows,
          tele.advanceMeters,
          stand.elevationStart,
          seatMat
        )
      );
    }
  }

  // Stacked Cantilevered Balconies + Structural Cantilever Brackets + Glazed VIP Skyboxes
  if (balconies.length > 0) {
    const fasciaSlabMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.34,
      metalness: 0.16,
    });
    const ledFasciaMat = createLedFasciaMaterial(doc.lighting === 'day');

    for (const bal of balconies) {
      const whiteFascia = new THREE.Mesh(
        new THREE.BoxGeometry(spanLength - 0.08, bal.hasVipGlass ? 1.05 : 0.92, 0.4),
        fasciaSlabMat
      );
      whiteFascia.position.set(0, bal.y, bal.d - 0.04);
      whiteFascia.castShadow = true;
      group.add(whiteFascia);

      const bandZ = bal.d - 0.27;
      group.add(
        buildLedFasciaBand(
          [
            new THREE.Vector3(-(spanLength - 0.1) / 2, bal.y, bandZ),
            new THREE.Vector3((spanLength - 0.1) / 2, bal.y, bandZ),
          ],
          bal.hasVipGlass ? 1.0 : 0.88,
          ledFasciaMat
        )
      );

      if (bal.hasVipGlass) {
        // Boxes over the whole loggia height, against its back wall.
        const loggiaH = Math.max(1.8, 2 * (bal.soffitY - bal.loggiaY) - 0.15);
        const half = (spanLength - 0.12) / 2;
        const glazing = buildSkyboxGlazing(
          {
            line: [new THREE.Vector3(-half, 0, bal.loggiaD), new THREE.Vector3(half, 0, bal.loggiaD)],
            bottomY: [bal.loggiaY - loggiaH / 2, bal.loggiaY - loggiaH / 2],
            topY: [bal.loggiaY + loggiaH / 2, bal.loggiaY + loggiaH / 2],
            inward: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1)],
          },
          doc.lighting !== 'day'
        );
        if (glazing) group.add(glazing);
      }

    }
  }

  if (stand.id === 'south') {
    group.add(createPlayersTunnelPortal());
  }
  if (stand.dugouts && spanLength > 2 * (DUGOUT_OFFSET + 4)) {
    for (const sx of [-1, 1]) {
      const dugout = buildDugout(isNight);
      dugout.position.x = sx * DUGOUT_OFFSET;
      group.add(dugout);
    }
  }

  // Exterior envelope along the back of the stand.
  group.add(
    buildStandEnvelope({
      doc,
      rail: [-1, 1].map((side) => ({
        x: (side * spanLength) / 2,
        z: totalDepth,
        nx: 0,
        nz: 1,
        yBottom: gradeY,
        yTop: topHeight,
        depth: totalDepth,
      })),
      closed: false,
      stand,
      facadeMat,
      structureMat,
      concreteMat,
      turnstileTex,
      name: `StandEnvelope_${stand.id}`,
    })
  );

  if (stand.banners) {
    const parapetTop = stand.elevationStart + 0.58;
    const banners = buildStandBanners(
      [
        // Over the pitch wall, and hanging from each balcony front below its fascia
        { top: parapetTop - 0.04, z: -0.05, maxHeight: parapetTop - 0.15 },
        ...balconies.map((bal) => ({ top: bal.y - 0.47, z: bal.d - 0.32, maxHeight: 1.3 })),
      ],
      spanLength,
      new THREE.Color(doc.colors.seatsPrimary),
      new THREE.Color(doc.colors.seatsSecondary),
      ['north', 'south', 'east', 'west'].indexOf(stand.id) + 1
    );
    if (banners) group.add(banners);
  }

  if (stand.embankment) {
    group.add(buildGrassEmbankment(spanLength, totalDepth, topHeight, concreteMat.map?.anisotropy ?? 4));
  }

  return group;
}

/** Earth bank slope (run per metre of rise) behind and beside terraces built into a bank. */
const EMBANKMENT_SLOPE = 1.7;

let embankmentMaterialCache: THREE.MeshStandardMaterial | null = null;

/**
 * Grassed earth mound filling under and behind a stand's terraces, in the stand's local frame
 * (x along the stand, z away from the pitch): it meets the rear of the top row and falls to the
 * ground behind and at both ends, as on athletics grounds and small clubs' open terraces.
 */
function buildGrassEmbankment(
  spanLength: number,
  totalDepth: number,
  topHeight: number,
  maxAnisotropy: number
): THREE.Mesh {
  if (!embankmentMaterialCache) {
    embankmentMaterialCache = new THREE.MeshStandardMaterial({
      color: 0x4d7a36,
      roughness: 0.96,
      side: THREE.DoubleSide,
    });
    applyTurfCloseUpDetail(embankmentMaterialCache, maxAnisotropy);
  }
  const crestY = Math.max(0.5, topHeight - 0.25);
  const run = crestY * EMBANKMENT_SLOPE;
  // Cross-section (z, y): tucked under the front rows, up to the rear crest, down the back slope.
  const section: [number, number][] = [
    [0.4, 0],
    [totalDepth * 0.35, crestY * 0.3],
    [totalDepth, crestY],
    [totalDepth + 0.8, crestY],
    [totalDepth + 0.8 + run, 0],
  ];
  const half = spanLength * 0.5;
  // Full section along the stand, collapsing to the ground line over `run` past each end.
  const stations: { x: number; k: number }[] = [
    { x: -half - run, k: 0 },
    { x: -half, k: 1 },
    { x: half, k: 1 },
    { x: half + run, k: 0 },
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  const cols = section.length;
  stations.forEach(({ x, k }) => {
    section.forEach(([z, y]) => positions.push(x, y * k, z));
  });
  for (let r = 0; r < stations.length - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = (r + 1) * cols + c;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, embankmentMaterialCache);
  mesh.name = 'GrassEmbankment';
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

function buildMultiMaterialSweptStandGeometry(
  ringCount: number,
  activeSegments: number,
  closed: boolean,
  profilePtsPerSlice: [number, number][][],
  sampleWorldPoint: (sliceIdx: number, radD: number, py: number) => [number, number, number],
  isSeatSegmentMask: boolean[],
  uRepeat: number,
  vRepeat: number = 2.2,
  isHoleQuad?: (sliceIdx: number, profileSegIdx: number) => boolean,
  uFractionAtSlice?: (sliceIdx: number) => number
): THREE.BufferGeometry {
  const pCount = profilePtsPerSlice[0].length;
  const positions = new Float32Array(ringCount * pCount * 3);
  const uvs = new Float32Array(ringCount * pCount * 2);

  let seatSegTotal = 0;
  for (const flag of isSeatSegmentMask) if (flag) seatSegTotal++;

  for (let s = 0; s < ringCount; s++) {
    const pts = profilePtsPerSlice[s];
    let seatProgress = 0;
    const uFrac = uFractionAtSlice
      ? uFractionAtSlice(s)
      : s / Math.max(1, activeSegments);
    for (let p = 0; p < pCount; p++) {
      const [radD, py] = pts[p];
      const [wx, wy, wz] = sampleWorldPoint(s, radD, py);

      const base = (s * pCount + p) * 3;
      positions[base] = wx;
      positions[base + 1] = wy;
      positions[base + 2] = wz;

      if (p > 0 && isSeatSegmentMask[p - 1]) {
        seatProgress += 1;
      }

      const uvBase = (s * pCount + p) * 2;
      uvs[uvBase] = uFrac * uRepeat;
      uvs[uvBase + 1] =
        seatSegTotal > 0 ? (seatProgress / seatSegTotal) * vRepeat : p / (pCount - 1);
    }
  }

  const concreteIndices: number[] = [];
  const seatIndices: number[] = [];

  for (let s = 0; s < activeSegments; s++) {
    const nextS = closed ? (s + 1) % ringCount : s + 1;
    for (let p = 0; p < pCount - 1; p++) {
      if (isHoleQuad && isHoleQuad(s, p)) {
        continue;
      }
      const a = s * pCount + p;
      const b = nextS * pCount + p;
      const c = nextS * pCount + (p + 1);
      const d = s * pCount + (p + 1);
      const targetArr = isSeatSegmentMask[p] ? seatIndices : concreteIndices;
      targetArr.push(a, b, d);
      targetArr.push(b, c, d);
    }
  }

  const allIndices = [...concreteIndices, ...seatIndices];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(allIndices);
  geo.clearGroups();
  geo.addGroup(0, concreteIndices.length, 0);
  geo.addGroup(concreteIndices.length, seatIndices.length, 1);
  geo.computeVertexNormals();
  return geo;
}

/** Extrudes a side profile (shape x = depth toward +Z, shape y = height) across a seat width. */
function extrudeSeatProfile(points: [number, number][], width: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
  // Shape x -> world z, extrusion -> world -x; then centre across the width.
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2, 0, 0);
  return geo;
}

/**
 * One tip-up stadium seat in metres, facing -Z, as found in an empty ground: a moulded shell
 * back curving away from the pitch, the seat pan folded up against it, and a side bracket
 * bolted to the tread.
 */
let seatGeometryCache: THREE.BufferGeometry | null = null;
function getSeatGeometry(): THREE.BufferGeometry {
  if (seatGeometryCache) return seatGeometryCache;
  const back = extrudeSeatProfile(
    [
      [0.13, 0.3],
      [0.17, 0.3],
      [0.21, 0.55],
      [0.245, 0.8],
      [0.24, 0.86],
      [0.205, 0.86],
      [0.2, 0.8],
      [0.17, 0.56],
    ],
    0.44
  );
  const foldedPan = extrudeSeatProfile(
    [
      [0.075, 0.36],
      [0.125, 0.34],
      [0.15, 0.72],
      [0.1, 0.74],
    ],
    0.4
  );
  const bracket = new THREE.BoxGeometry(0.05, 0.36, 0.2);
  bracket.translate(-0.2, 0.18, 0.12);
  // Extrusions come out non-indexed; the bracket box is indexed, so match it to them.
  const merged = mergeGeometries([back, foldedPan, bracket.toNonIndexed()]);
  back.dispose();
  foldedPan.dispose();
  bracket.dispose();
  merged?.computeVertexNormals();
  seatGeometryCache = merged ?? new THREE.BoxGeometry(0.44, 0.5, 0.4);
  return seatGeometryCache;
}

/** A seat seen from afar: its back alone, as one slab (12 triangles instead of 46). */
let seatFarGeometryCache: THREE.BufferGeometry | null = null;
function getSeatFarGeometry(): THREE.BufferGeometry {
  if (seatFarGeometryCache) return seatFarGeometryCache;
  const back = extrudeSeatProfile(
    [
      [0.13, 0.3],
      [0.17, 0.3],
      [0.245, 0.84],
      [0.205, 0.86],
    ],
    0.44
  );
  back.computeVertexNormals();
  seatFarGeometryCache = back;
  return back;
}

/** Shared seat material; instance colours carry the club palette. */
let seatMaterialCache: THREE.MeshStandardMaterial | null = null;
function getSeatMaterial(): THREE.MeshStandardMaterial {
  seatMaterialCache ??= new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.02 });
  return seatMaterialCache;
}

/** One seat of a swept stand, as `buildSweepSeatInstances` hands it to its painter. */
interface SweepSeat {
  tier: number;
  /** Row within the tier, front row first, and the tier's row count. */
  rowInTier: number;
  rowsInTier: number;
  /** Profile slice the seat stands on, and how far along it toward the next one (`0..1`). */
  slice: number;
  sliceFrac: number;
  /** Distance along the row from its start (m), and the row's length. */
  along: number;
  rowLength: number;
  index: number;
}

/**
 * Places individual seats on every seat tread of a swept stand, using the same profile slices and
 * world mapping as `buildMultiMaterialSweptStandGeometry`. Seats are spaced by `seatWidth`, leave
 * radial aisles and carved vomitory openings empty, fill deep treads with several rows, and colour
 * each seat through `paint` (club colours alternating per tier without it).
 */
function buildSweepSeatInstances(opts: {
  ringCount: number;
  activeSegments: number;
  closed: boolean;
  profilePtsPerSlice: [number, number][][];
  sampleWorldPoint: (sliceIdx: number, radD: number, py: number) => [number, number, number];
  isSeatSegmentMask: boolean[];
  rowDepth: number;
  seatWidth: number;
  aisleCount: number;
  aisleWidth: number;
  primaryHex: string;
  secondaryHex: string;
  isHoleQuad?: (sliceIdx: number, profileSegIdx: number) => boolean;
  /** Seats left out (press desks take their place), by position and profile segment. */
  skipSeat?: (pos: THREE.Vector3, profileSegIdx: number) => boolean;
  /** Share of seats with a spectator sitting in them (`0..1`). */
  attendance: number;
  /** Dress every spectator in the club-colour tifo pattern. */
  tifo?: boolean;
  /** Seat colour; without it tiers alternate the two club colours. */
  paint?: (seat: SweepSeat, out: THREE.Color) => THREE.Color;
  /**
   * Each seat tread is one row, possibly ending along the ring (its tread shrinking to nothing):
   * seats stop where the tread gets too shallow to sit on.
   */
  rowPerTread?: boolean;
}): THREE.Group | null {
  const {
    ringCount,
    activeSegments,
    closed,
    profilePtsPerSlice,
    sampleWorldPoint,
    isSeatSegmentMask,
    rowDepth,
    seatWidth,
    aisleCount,
    aisleWidth,
    primaryHex,
    secondaryHex,
    isHoleQuad,
    skipSeat,
    attendance,
    tifo = false,
    paint,
    rowPerTread = false,
  } = opts;
  const pitch = Math.max(0.42, seatWidth);
  const nextSlice = (s: number) => (closed ? (s + 1) % ringCount : s + 1);

  // Tier index per seat tread: a run of four or more non-seat segments is a balcony break (a
  // cross aisle makes three: riser, walkway, wall).
  const tierOfSegment: number[] = [];
  // Per seat tread, the latest tread at or before it that a cross aisle slot (riser, walkway,
  // wall) leads into: rows on either side of a cross aisle carry different slots.
  const aisleSlotOf: number[] = [];
  let aisleSlot = -1;
  let tier = 0;
  let gap = 0;
  let seenSeat = false;
  isSeatSegmentMask.forEach((isSeat, p) => {
    if (isSeat) {
      if (gap === 3) aisleSlot = p;
      aisleSlotOf[p] = aisleSlot;
      if (seenSeat && gap >= 4) tier++;
      seenSeat = true;
      gap = 0;
    } else {
      gap++;
    }
    tierOfSegment[p] = tier;
  });

  type SeatRow = { p: number; f: number; rowInTier: number };
  const rows: SeatRow[] = [];
  const rowsPerTier: number[] = [];
  const ref = profilePtsPerSlice[0];
  // A tread holds as many rows as fit in its depth. The bowl sweeps a fixed number of terrace
  // steps whatever the row count, so each step's share is fractional: carrying the remainder from
  // step to step keeps the drawn rows equal to the depth's (rounding each step lost or added rows).
  let rowsSoFar = 0;
  let placedRows = 0;
  isSeatSegmentMask.forEach((isSeat, p) => {
    if (!isSeat) return;
    rowsSoFar += Math.abs(ref[p + 1][0] - ref[p][0]) / Math.max(0.6, rowDepth);
    // A shallow step may hold no row at all when the stand has fewer rows than steps.
    const count = rowPerTread ? 1 : Math.max(0, Math.round(rowsSoFar - placedRows));
    placedRows += count;
    const t = tierOfSegment[p];
    for (let k = 0; k < count; k++) {
      rows.push({ p, f: (k + 0.52) / count, rowInTier: rowsPerTier[t] ?? 0 });
      rowsPerTier[t] = (rowsPerTier[t] ?? 0) + 1;
    }
  });
  if (rows.length === 0) return null;

  const pointAt = (s: number, row: SeatRow, dOffset = 0) => {
    const pts = profilePtsPerSlice[s];
    const [d0, y0] = pts[row.p];
    const [d1, y1] = pts[row.p + 1];
    const d = d0 + (d1 - d0) * row.f + dOffset;
    const y = y0 + (y1 - y0) * row.f;
    return new THREE.Vector3(...sampleWorldPoint(s, d, y));
  };

  const placements: { m: THREE.Matrix4; seat: SweepSeat }[] = [];
  // Centre of each aisle on each row, front to back, for the aisle handrails.
  const aislePoints: AisleRailPoint[][] = Array.from(
    { length: Math.max(0, aisleCount) },
    () => []
  );
  const up = new THREE.Vector3(0, 1, 0);
  for (const row of rows) {
    // Row length first, so aisles sit at the same fractions along every row.
    const segLens: number[] = [];
    let total = 0;
    for (let s = 0; s < activeSegments; s++) {
      const len = pointAt(s, row).distanceTo(pointAt(nextSlice(s), row));
      segLens.push(len);
      total += len;
    }
    const aisleAt = Array.from(
      { length: Math.max(0, aisleCount) },
      (_, k) => ((k + 0.5) / aisleCount) * total
    );

    let run = 0;
    let carry = pitch * 0.5;
    for (let s = 0; s < activeSegments; s++) {
      const len = segLens[s];
      const treadDepth = (slice: number) =>
        profilePtsPerSlice[slice][row.p + 1][0] - profilePtsPerSlice[slice][row.p][0];
      const holeHere =
        (isHoleQuad ? isHoleQuad(s, row.p) : false) ||
        (rowPerTread && Math.min(treadDepth(s), treadDepth(nextSlice(s))) < rowDepth * 0.55);
      // Width here of the walkway in front of the row's aisle slot: corner slots of a stand
      // without the aisle there are zero wide.
      const slot = aisleSlotOf[row.p];
      const pts = profilePtsPerSlice[s];
      const walkway = slot >= 2 ? pts[slot - 1][0] - pts[slot - 2][0] : 0;
      aisleAt.forEach((x, k) => {
        if (!holeHere && len > 1e-4 && x >= run && x < run + len) {
          aislePoints[k].push({
            pos: new THREE.Vector3().lerpVectors(pointAt(s, row), pointAt(nextSlice(s), row), (x - run) / len),
            tier: tierOfSegment[row.p],
            aisleSlot: slot,
            walkway,
          });
        }
      });
      if (!holeHere && len > 1e-4) {
        const a = pointAt(s, row);
        const b = pointAt(nextSlice(s), row);
        const front = pointAt(s, row, -0.5);
        const zAxis = new THREE.Vector3().subVectors(a, front).setY(0).normalize();
        const xAxis = new THREE.Vector3().crossVectors(up, zAxis).normalize();
        for (let along = carry; along < len; along += pitch) {
          const at = run + along;
          if (aisleAt.some((x) => Math.abs(x - at) < aisleWidth * 0.5 + pitch * 0.4)) continue;
          const pos = new THREE.Vector3().lerpVectors(a, b, along / len);
          if (skipSeat?.(pos, row.p)) continue;
          const m = new THREE.Matrix4().makeBasis(xAxis, up, zAxis).setPosition(pos);
          const tierIdx = tierOfSegment[row.p];
          placements.push({
            m,
            seat: {
              tier: tierIdx,
              rowInTier: row.rowInTier,
              rowsInTier: rowsPerTier[tierIdx] ?? 1,
              slice: s,
              sliceFrac: along / len,
              along: at,
              rowLength: total,
              index: placements.length,
            },
          });
        }
      }
      // Carry the spacing into the next slice so seats stay evenly spaced across slice joins.
      if (len < carry) carry -= len;
      else carry = pitch - ((len - carry) % pitch);
      run += len;
    }
  }
  if (placements.length === 0) return null;

  const mesh = new THREE.InstancedMesh(getSeatGeometry(), getSeatMaterial(), placements.length);
  const primary = new THREE.Color(primaryHex);
  const secondary = new THREE.Color(secondaryHex);
  const tint = new THREE.Color();
  placements.forEach(({ m, seat }, i) => {
    mesh.setMatrixAt(i, m);
    const jitter = 0.92 + (((Math.sin(i * 12.9898) * 43758.5453) % 1) + 1) % 1 * 0.14;
    if (paint) paint(seat, tint);
    else tint.copy(seat.tier % 2 === 0 ? primary : secondary);
    mesh.setColorAt(i, tint.multiplyScalar(jitter));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  // Each row's seat backs shade the tread behind them: that banding is what makes the rows read.
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'Seats';
  ignoreRaycasts(mesh);
  setFarDetail(mesh, getSeatFarGeometry());

  const group = new THREE.Group();
  group.name = 'SeatingDressing';
  group.add(mesh);
  const rails = buildAisleHandrails(aislePoints);
  if (rails) group.add(rails);
  const crowd = buildCrowd(
    placements.map((p) => p.m),
    { attendance, primary, secondary, pose: 'seated', tifo }
  );
  if (crowd) group.add(crowd);
  return group;
}

/** Deterministic per-seat hash in `[0, 1)`, so the crowd does not reshuffle between rebuilds. */
function seatHash(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

type BoxPart = [w: number, h: number, d: number, x: number, y: number, z: number, shade: number];

/** Merges shaded boxes into one non-indexed geometry; `shade` goes into the vertex colour. */
function mergeShadedBoxes(parts: BoxPart[]): THREE.BufferGeometry {
  const geos = parts.map(([w, h, d, x, y, z, shade]) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, y, z);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(shade), 3));
    return g;
  });
  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  merged?.computeVertexNormals();
  return merged ?? new THREE.BoxGeometry(0.36, 1, 0.3);
}

/**
 * Spectator bodies in metres on the spot's frame (facing -Z, like the seats). Vertex colours shade
 * trousers and shoes darker than the shirt, which the instance colour tints. Seated fans have
 * thighs on the pan and shins down to the tread; standing fans either keep their arms down or hold
 * a scarf up over their heads.
 */
const crowdBodyGeometryCache = new Map<string, THREE.BufferGeometry>();
function getCrowdBodyGeometry(kind: 'seated' | 'standing' | 'scarf'): THREE.BufferGeometry {
  const cached = crowdBodyGeometryCache.get(kind);
  if (cached) return cached;
  const shoes: BoxPart = [0.3, 0.06, 0.18, 0, 0.03, -0.04, 0.12];
  const parts: BoxPart[] =
    kind === 'seated'
      ? [
          [0.36, 0.5, 0.22, 0, 0.72, 0.04, 1], // torso
          [0.46, 0.12, 0.2, 0, 0.92, 0.04, 1], // shoulders
          [0.1, 0.34, 0.1, -0.21, 0.66, 0.02, 1], // arms
          [0.1, 0.34, 0.1, 0.21, 0.66, 0.02, 1],
          [0.34, 0.14, 0.42, 0, 0.47, -0.1, 0.32], // thighs on the pan
          [0.3, 0.42, 0.12, 0, 0.22, -0.28, 0.3], // shins
          [0.3, 0.06, 0.18, 0, 0.03, -0.32, 0.12], // shoes
        ]
      : [
          [0.13, 0.84, 0.14, -0.09, 0.48, 0, 0.3], // legs
          [0.13, 0.84, 0.14, 0.09, 0.48, 0, 0.3],
          shoes,
          [0.36, 0.56, 0.22, 0, 1.17, 0, 1], // torso
          [0.46, 0.12, 0.2, 0, 1.39, 0, 1], // shoulders
          ...(kind === 'standing'
            ? ([
                [0.1, 0.6, 0.1, -0.24, 1.11, 0, 1],
                [0.1, 0.6, 0.1, 0.24, 1.11, 0, 1],
              ] as BoxPart[])
            : ([
                [0.1, 0.6, 0.1, -0.22, 1.72, -0.02, 1], // arms raised
                [0.1, 0.6, 0.1, 0.22, 1.72, -0.02, 1],
                [0.62, 0.16, 0.03, 0, 2.02, -0.06, 1.15], // scarf held between the hands
              ] as BoxPart[])),
        ];
  const geo = mergeShadedBoxes(parts);
  crowdBodyGeometryCache.set(kind, geo);
  return geo;
}

/**
 * A spectator seen from afar: the torso and what shows below it as two boxes (24 triangles
 * instead of 84), in the same pose and shades as `getCrowdBodyGeometry`.
 */
function getCrowdBodyFarGeometry(kind: 'seated' | 'standing' | 'scarf'): THREE.BufferGeometry {
  const key = `far-${kind}`;
  const cached = crowdBodyGeometryCache.get(key);
  if (cached) return cached;
  const parts: BoxPart[] =
    kind === 'seated'
      ? [
          [0.46, 0.62, 0.22, 0, 0.75, 0.04, 1], // torso and shoulders
          [0.34, 0.5, 0.42, 0, 0.27, -0.1, 0.3], // legs
        ]
      : [
          [0.46, 0.68, 0.22, 0, 1.2, 0, 1],
          [0.3, 0.9, 0.14, 0, 0.45, 0, 0.3],
        ];
  const geo = mergeShadedBoxes(parts);
  crowdBodyGeometryCache.set(key, geo);
  return geo;
}

/** Head with a darker crown of hair at height `y`; the instance colour carries the skin tone. */
const crowdHeadGeometryCache = new Map<string, THREE.BufferGeometry>();
/** `detail` 1 for close views (80 triangles), 0 for the far level (20 triangles). */
function getCrowdHeadGeometry(y: number, detail: 0 | 1 = 1): THREE.BufferGeometry {
  const key = `${y}/${detail}`;
  const cached = crowdHeadGeometryCache.get(key);
  if (cached) return cached;
  const g = new THREE.IcosahedronGeometry(0.105, detail);
  g.scale(0.92, 1.08, 1);
  const pos = g.attributes.position;
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    // Hair over the crown and the back of the head (+Z faces away from the pitch)
    const hair = pos.getY(i) > 0.02 || (pos.getZ(i) > 0.05 && pos.getY(i) > -0.05);
    const c = hair ? 0.22 : 1;
    colors.push(c, c, c);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.translate(0, y, 0.03);
  crowdHeadGeometryCache.set(key, g);
  return g;
}

/** Hand-held flag: a pole from the raised hand and a cloth the instance colour tints. */
let crowdFlagGeometryCache: THREE.BufferGeometry | null = null;
function getCrowdFlagGeometry(): THREE.BufferGeometry {
  crowdFlagGeometryCache ??= mergeShadedBoxes([
    [0.03, 1.6, 0.03, 0.24, 2.15, -0.05, 0.25], // pole
    [0.8, 0.52, 0.02, 0.65, 2.68, -0.05, 1], // cloth
  ]);
  return crowdFlagGeometryCache;
}

let crowdMaterialCache: THREE.MeshStandardMaterial | null = null;
function getCrowdMaterial(): THREE.MeshStandardMaterial {
  crowdMaterialCache ??= new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  return crowdMaterialCache;
}

const CROWD_NEUTRAL_CLOTHES = ['#f4f4f2', '#1c1f26', '#27344f', '#6b7280', '#3f4a3c', '#8a1c1c'];
const CROWD_SKIN_TONES = ['#f1c7a5', '#e0ac85', '#c68863', '#9c6644', '#6e4630', '#4a2f22'];
/** Width (m) of each diagonal band of a tifo. */
const TIFO_BAND_M = 2.4;

interface CrowdOptions {
  attendance: number;
  primary: THREE.Color;
  secondary: THREE.Color;
  pose: 'seated' | 'standing';
  tifo?: boolean;
}

/**
 * Fills a share of the spots (seats, or standing places on a terrace) with supporters: club shirts
 * in the seat palette mixed with everyday clothing, varied skin tones, build and angle. Occupancy
 * is clustered in blocks so empty places read as gaps rather than noise. Standing ends add raised
 * scarves and a scatter of flags; a tifo fills every spot and dresses it in diagonal club bands.
 */
function buildCrowd(spots: THREE.Matrix4[], opts: CrowdOptions): THREE.Group | null {
  const { primary, secondary, pose, tifo = false } = opts;
  const share = tifo ? 1 : Math.max(0, Math.min(1, opts.attendance));
  if (share <= 0 || spots.length === 0) return null;
  const occupied: number[] = [];
  spots.forEach((_, i) => {
    // Neighbouring spots share most of their draw, so fans gather in groups
    const block = seatHash(Math.floor(i / 6), 3);
    if (block * 0.55 + seatHash(i, 7) * 0.45 < share) occupied.push(i);
  });
  if (occupied.length === 0) return null;

  type Variant = { kind: 'seated' | 'standing' | 'scarf'; headY: number; idx: number[] };
  const variants: Variant[] =
    pose === 'seated'
      ? [{ kind: 'seated', headY: 1.11, idx: occupied }]
      : [
          { kind: 'standing', headY: 1.6, idx: [] },
          { kind: 'scarf', headY: 1.6, idx: [] },
        ];
  const flagIdx: number[] = [];
  if (pose === 'standing') {
    for (const i of occupied) {
      const r = seatHash(i, 37);
      variants[r < 0.3 ? 1 : 0].idx.push(i);
      if (r > 0.985) flagIdx.push(i);
    }
  }

  const neutral = CROWD_NEUTRAL_CLOTHES.map((h) => new THREE.Color(h));
  const skins = CROWD_SKIN_TONES.map((h) => new THREE.Color(h));
  const shirtOf = (i: number, m: THREE.Matrix4, out: THREE.Color) => {
    if (tifo) {
      const band = Math.floor((m.elements[12] * 0.35 + m.elements[13]) / TIFO_BAND_M);
      return out.copy(band % 2 === 0 ? primary : secondary);
    }
    const pick = seatHash(i, 19);
    if (pick < 0.58) out.copy(primary);
    else if (pick < 0.76) out.copy(secondary);
    else out.copy(neutral[Math.floor(seatHash(i, 23) * neutral.length)]);
    return out.multiplyScalar(0.85 + seatHash(i, 29) * 0.25);
  };
  const placed = (i: number) => {
    const build = 0.92 + seatHash(i, 11) * 0.16;
    const yaw = (seatHash(i, 13) - 0.5) * 0.35;
    // Seated fans lean toward the pitch
    const lean = pose === 'seated' ? -seatHash(i, 17) * 0.12 : 0;
    return spots[i]
      .clone()
      .multiply(new THREE.Matrix4().makeRotationY(yaw))
      .multiply(new THREE.Matrix4().makeRotationX(lean))
      .multiply(new THREE.Matrix4().makeScale(build, build, build));
  };

  const group = new THREE.Group();
  group.name = 'Crowd';
  const color = new THREE.Color();
  const finish = (mesh: THREE.InstancedMesh, name: string) => {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    // Tens of thousands of casters would swamp the shadow pass; the crowd only receives
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.name = name;
    ignoreRaycasts(mesh);
    group.add(mesh);
  };
  for (const v of variants) {
    if (v.idx.length === 0) continue;
    const bodies = new THREE.InstancedMesh(getCrowdBodyGeometry(v.kind), getCrowdMaterial(), v.idx.length);
    const heads = new THREE.InstancedMesh(getCrowdHeadGeometry(v.headY), getCrowdMaterial(), v.idx.length);
    v.idx.forEach((i, k) => {
      const m = placed(i);
      bodies.setMatrixAt(k, m);
      heads.setMatrixAt(k, m);
      bodies.setColorAt(k, shirtOf(i, m, color));
      heads.setColorAt(k, skins[Math.floor(seatHash(i, 31) * skins.length)]);
    });
    finish(bodies, 'CrowdBodies');
    finish(heads, 'CrowdHeads');
    setFarDetail(bodies, getCrowdBodyFarGeometry(v.kind));
    setFarDetail(heads, getCrowdHeadGeometry(v.headY, 0));
  }
  if (flagIdx.length > 0) {
    const flags = new THREE.InstancedMesh(getCrowdFlagGeometry(), getCrowdMaterial(), flagIdx.length);
    flagIdx.forEach((i, k) => {
      flags.setMatrixAt(k, placed(i));
      flags.setColorAt(k, seatHash(i, 41) < 0.6 ? primary : secondary);
    });
    finish(flags, 'CrowdFlags');
  }
  return group;
}

/**
 * Standing places on a terrace in the stand's local frame (x along the stand, facing the pitch at
 * -Z): one fan every half metre along each row, keeping the aisles clear.
 */
function standingSpots(
  rows: { y: number; d: number }[],
  spanLength: number,
  aisleCount: number,
  aisleWidth: number
): THREE.Matrix4[] {
  const spacing = 0.52;
  const half = spanLength * 0.5 - 0.6;
  const aisles = Array.from({ length: Math.max(0, aisleCount) }, (_, k) => -half + ((k + 0.5) / aisleCount) * half * 2);
  const spots: THREE.Matrix4[] = [];
  for (const row of rows) {
    for (let x = -half; x <= half; x += spacing) {
      if (aisles.some((a) => Math.abs(a - x) < aisleWidth * 0.5 + 0.2)) continue;
      spots.push(new THREE.Matrix4().makeTranslation(x, row.y, row.d));
    }
  }
  return spots;
}

/** Height range (m) of a supporters' banner. */
const BANNER_HEIGHT_M = 1.15;

/**
 * Supporters' banners hung against a wall face in the stand's local frame: each `rail` is a run
 * along x at the face (`z`) with the banners' top edge at `top`. Designs (stripes, halves, bordered
 * panels) mix the two club colours; banners vary in width and leave gaps, as hung by fan groups.
 */
function buildStandBanners(
  rails: { top: number; z: number; maxHeight: number }[],
  spanLength: number,
  primary: THREE.Color,
  secondary: THREE.Color,
  seed: number
): THREE.Mesh | null {
  const pos: number[] = [];
  const col: number[] = [];
  const quad = (x0: number, x1: number, y0: number, y1: number, z: number, c: THREE.Color) => {
    pos.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z);
    for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
  };
  const white = new THREE.Color('#f5f5f4');
  let n = 0;
  rails.forEach((rail, r) => {
    const h = Math.min(BANNER_HEIGHT_M, rail.maxHeight);
    if (h < 0.4) return;
    const y1 = rail.top;
    const y0 = rail.top - h;
    const z = rail.z;
    let x = -spanLength * 0.5 + 1.5 + seatHash(seed + r, 3) * 6;
    while (x < spanLength * 0.5 - 4) {
      const i = seed * 97 + r * 31 + n++;
      const w = 3.5 + seatHash(i, 5) * 6;
      const x1 = Math.min(spanLength * 0.5 - 1, x + w);
      const a = seatHash(i, 7) < 0.6 ? primary : secondary;
      const b = a === primary ? (seatHash(i, 9) < 0.5 ? secondary : white) : primary;
      const design = Math.floor(seatHash(i, 11) * 4);
      if (design === 0) {
        // Horizontal tricolour bands
        const t = (y1 - y0) / 3;
        quad(x, x1, y0, y0 + t, z, a);
        quad(x, x1, y0 + t, y0 + 2 * t, z, b);
        quad(x, x1, y0 + 2 * t, y1, z, a);
      } else if (design === 1) {
        // Vertical stripes
        const stripes = 4 + Math.floor(seatHash(i, 13) * 5);
        const sw = (x1 - x) / stripes;
        for (let k = 0; k < stripes; k++) quad(x + k * sw, x + (k + 1) * sw, y0, y1, z, k % 2 ? b : a);
      } else if (design === 2) {
        // Halves
        const mid = (x + x1) / 2;
        quad(x, mid, y0, y1, z, a);
        quad(mid, x1, y0, y1, z, b);
      } else {
        // Panel with a border
        const e = 0.16;
        quad(x, x1, y0, y1, z, b);
        quad(x + e, x1 - e, y0 + e, y1 - e, z - 0.01, a);
      }
      x = x1 + 1 + seatHash(i, 15) * 4;
    }
  });
  if (pos.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  bannerMaterialCache ??= new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, bannerMaterialCache);
  mesh.name = 'SupporterBanners';
  mesh.receiveShadow = true;
  return mesh;
}
let bannerMaterialCache: THREE.MeshStandardMaterial | null = null;

/** Centre of an aisle on one row, and the cross aisle it follows. */
interface AisleRailPoint {
  pos: THREE.Vector3;
  tier: number;
  /** Seat tread the latest cross aisle slot before this row leads into, and its walkway width here. */
  aisleSlot: number;
  walkway: number;
}

/** Galvanised steel shared by every aisle handrail. */
let handrailMaterialCache: THREE.MeshStandardMaterial | null = null;

/**
 * Centre handrails down every aisle: a top rail 0.9 m above the steps on posts every second row,
 * broken at each tier change, at each cross aisle and every six rows so spectators can cross
 * into the rows.
 */
function buildAisleHandrails(aisles: AisleRailPoint[][]): THREE.InstancedMesh | null {
  const matrices: THREE.Matrix4[] = [];
  const yAxis = new THREE.Vector3(0, 1, 0);
  const bar = (a: THREE.Vector3, b: THREE.Vector3, size: number) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-3) return;
    matrices.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5),
        new THREE.Quaternion().setFromUnitVectors(yAxis, dir.normalize()),
        new THREE.Vector3(size, len, size)
      )
    );
  };
  const railHeight = 0.9;
  for (const points of aisles) {
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const top = p.pos.clone().setY(p.pos.y + railHeight);
      if (i % 2 === 0) bar(p.pos, top, 0.045);
      const next = points[i + 1];
      if (!next || next.tier !== p.tier || (next.aisleSlot !== p.aisleSlot && next.walkway > 0.3) || i % 6 === 5) continue;
      if (next.pos.distanceTo(p.pos) > 2.5) continue;
      bar(top, next.pos.clone().setY(next.pos.y + railHeight), 0.05);
    }
  }
  if (matrices.length === 0) return null;
  handrailMaterialCache ??= new THREE.MeshStandardMaterial({ color: 0xc4cad1, roughness: 0.32, metalness: 0.85 });
  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 6), handrailMaterialCache, matrices.length);
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  mesh.name = 'AisleHandrails';
  ignoreRaycasts(mesh);
  return mesh;
}

/** The stand behind the goal and the side stand each corner joins. */
const CORNER_STANDS: Record<CornerQuadrantId, { end: StandSide; side: StandSide }> = {
  se: { end: 'east', side: 'south' },
  sw: { end: 'west', side: 'south' },
  nw: { end: 'west', side: 'north' },
  ne: { end: 'east', side: 'north' },
};

/**
 * Corners that keep one stand's section (`cornerJoin` `end` or `side`): only where the two
 * stands' sections differ, since identical ones already meet flush through the corner.
 */
export function resolveCornerFollow(doc: StadiumDocument): Partial<Record<CornerQuadrantId, StandSide>> {
  const join = doc.cornerJoin ?? 'blend';
  if (join === 'blend') return {};
  const sections = new Map<StandSide, StandProfile>();
  const section = (side: StandSide) => {
    const stand = doc.stands[side];
    if (!sections.has(side)) sections.set(side, buildStandProfilePoints(stand, isHollowStand(doc, stand)));
    return sections.get(side)!;
  };
  const follow: Partial<Record<CornerQuadrantId, StandSide>> = {};
  for (const [cid, { end, side }] of Object.entries(CORNER_STANDS) as [CornerQuadrantId, { end: StandSide; side: StandSide }][]) {
    if (!haveSameSection(section(end), section(side))) follow[cid] = join === 'end' ? end : side;
  }
  return follow;
}

/** Same layout and the same points to the centimetre. */
function haveSameSection(a: StandProfile, b: StandProfile): boolean {
  return (
    haveSameSectionLayout(a, b) &&
    a.profilePts.every(([d, y], i) => Math.abs(d - b.profilePts[i][0]) < 0.01 && Math.abs(y - b.profilePts[i][1]) < 0.01)
  );
}

/** Whether two stand sections have the same points, seat treads and balconies, in the same order. */
function haveSameSectionLayout(a: StandProfile, b: StandProfile): boolean {
  return (
    a.profilePts.length === b.profilePts.length &&
    a.rowPositions.length === b.rowPositions.length &&
    a.balconies.length === b.balconies.length &&
    a.isSeatSegmentMask.length === b.isSeatSegmentMask.length &&
    a.isSeatSegmentMask.every((v, i) => v === b.isSeatSegmentMask[i]) &&
    a.rowPositions.every((r, i) => r.tierIdx === b.rowPositions[i].tierIdx)
  );
}

/**
 * Builds a high-realism, C1-tangent-lofted 90° corner virage quadrant in World Space:
 * - `compact_urban` (`!corner.facetedThreeBay`): smooth curved UEFA urban cauldron corner + glazed spiral core tower
 * - `english_rectangular` (`corner.facetedThreeBay`): 3 crisp 30° precast planar bays with radial stair joints
 * Guarantees +Y upward tread normals, pitch-facing risers, 3D seat shells, vomitories, inward-facing balconies/LED/VIP,
 * and 0.000m flush alignment with both adjacent straight stands (even when asymmetric or 1-tier Kop meets 3-tier Main Stand).
 */
function buildCornerVirageQuadrant(
  corner: RectangularCornerSpec,
  doc: StadiumDocument,
  seatMat: THREE.MeshPhysicalMaterial,
  concreteMat: THREE.MeshStandardMaterial,
  facadeMat: THREE.MeshPhysicalMaterial,
  structureMat: THREE.MeshPhysicalMaterial,
  turnstileTex: THREE.CanvasTexture
): THREE.Group {
  const group = new THREE.Group();
  group.name = `CornerVirage_${corner.id.toUpperCase()}`;

  // A corner that keeps one stand's section is built from that stand alone, at both ends.
  const standA = doc.stands[corner.follow ?? corner.sideA];
  const standB = doc.stands[corner.follow ?? corner.sideB];

  const mats = resolveStadiumMaterials(doc);
  const envelope: EnvelopeStyle = mats.envelopeStyle ?? 'enveloping_skin';
  const isHollow =
    isHollowStand(doc, standA) || isHollowStand(doc, standB);

  const profA = buildStandProfilePoints(standA, isHollow);
  const profB = buildStandProfilePoints(standB, isHollow);
  const tiersA = resolveStandTiers(standA);
  const tiersB = resolveStandTiers(standB);

  const sunkenDepth = getEffectiveSunkenDepth(doc);
  const isNight = doc.lighting !== 'day';

  // 18 smooth slices for curved `compact_urban`, 15 slices (3 planar bays x 5 sub-slices) for `english_rectangular`
  const segs = corner.facetedThreeBay ? 15 : 18;
  // Stands laid out alike (same rows, tiers and balconies) are joined by their own sections, point
  // for point, so the corner meets each one flush and stays level between two identical stands.
  const exact = haveSameSectionLayout(profA, profB);
  const nSteps = exact
    ? profA.rowPositions.length
    : Math.max(16, Math.min(76, Math.max(standA.rows, standB.rows)));
  const maxTiers = Math.max(standA.tiers, standB.tiers) as 1 | 2 | 3 | 4 | 5;
  // Tier changes follow the neighbouring stands' row split (averaged, as the corner morphs from
  // one to the other); the automatic split fills in for a stand with fewer tiers.
  const cumulativeShare = (tiers: ReturnType<typeof resolveStandTiers>, b: number) => {
    if (tiers.length <= b) return undefined;
    const total = tiers.reduce((acc, t) => acc + t.rows, 0) || 1;
    return tiers.slice(0, b).reduce((acc, t) => acc + t.rows, 0) / total;
  };
  const autoBreaks = maxTiers >= 2 ? getTierStartRows(nSteps, maxTiers).slice(1) : [];
  const exactBreaks = profA.rowPositions.flatMap((r, k) =>
    k > 0 && r.tierIdx !== profA.rowPositions[k - 1].tierIdx ? [k] : []
  );
  const breakRows = exact ? exactBreaks : autoBreaks.map((auto, i) => {
    const shares = [cumulativeShare(tiersA, i + 1), cumulativeShare(tiersB, i + 1)].filter(
      (v): v is number => v !== undefined
    );
    if (shares.length === 0) return auto;
    const k = Math.round((nSteps * shares.reduce((a, b) => a + b, 0)) / shares.length);
    return Math.max(2 + i * 2, Math.min(nSteps - 2 * (autoBreaks.length - i), k));
  });
  for (let i = 1; i < breakRows.length; i++) {
    breakRows[i] = Math.max(breakRows[i], breakRows[i - 1] + 2);
  }
  const breakRowSet = new Set(breakRows);

  // Build exact canonical `isSeatSegmentMask` shared by all `segs + 1` slices
  const isSeatMask: boolean[] = exact ? [...profA.isSeatSegmentMask] : [false, false, false];
  for (let k = 0; k < (exact ? 0 : nSteps); k++) {
    if (breakRowSet.has(k)) {
      isSeatMask.push(false, false, false, false);
    }
    isSeatMask.push(true, false);
  }
  if (!exact) {
    isSeatMask.push(false, false); // crest parapet & top deck
    if (isHollow) {
      isSeatMask.push(false, false, false);
    } else {
      isSeatMask.push(false);
    }
  }

  interface CornerBalconySample {
    d: number;
    y: number;
    loggiaD: number;
    loggiaBottomY: number;
    loggiaTopY: number;
    weight: number;
    hasVipGlass: boolean;
  }

  const profilePtsPerSlice: [number, number][][] = [];
  const rowSamplesPerSlice: { d: number; y: number; stepD: number }[][] = [];
  const balconiesPerSlice: CornerBalconySample[][] = [];
  const crestPerSlice: { outerD: number; topH: number; elev: number; gradeY: number }[] = [];

  if (exact) {
    for (let s = 0; s <= segs; s++) {
      const u = s / segs;
      const w = u * u * (3 - 2 * u);
      const mix = (a: number, b: number) => a + (b - a) * w;
      profilePtsPerSlice.push(
        profA.profilePts.map(([d, y], i): [number, number] => [mix(d, profB.profilePts[i][0]), mix(y, profB.profilePts[i][1])])
      );
      rowSamplesPerSlice.push(
        profA.rowPositions.map((r, k) => ({
          d: mix(r.d, profB.rowPositions[k].d),
          y: mix(r.y, profB.rowPositions[k].y),
          stepD: mix(standA.rowDepth, standB.rowDepth),
        }))
      );
      balconiesPerSlice.push(
        profA.balconies.map((a, k) => {
          const b = profB.balconies[k];
          // The section keeps the loggia's mid-height; its floor is as far below as its soffit is above.
          const floor = (bal: BalconySample) => 2 * bal.loggiaY - bal.soffitY;
          return {
            d: mix(a.d, b.d),
            y: mix(a.y, b.y),
            loggiaD: mix(a.loggiaD, b.loggiaD),
            loggiaBottomY: mix(floor(a), floor(b)) + 0.06,
            loggiaTopY: mix(a.soffitY, b.soffitY) - 0.06,
            weight: 1,
            hasVipGlass: a.hasVipGlass || b.hasVipGlass,
          };
        })
      );
      const topH = mix(profA.topHeight, profB.topHeight);
      crestPerSlice.push({
        outerD: mix(profA.totalDepth, profB.totalDepth),
        topH,
        elev: mix(standA.elevationStart, standB.elevationStart),
        gradeY: facadeGradeY(sunkenDepth, topH),
      });
    }
  }

  for (let s = 0; s <= (exact ? -1 : segs); s++) {
    const u = s / segs;
    const w = u * u * (3 - 2 * u); // Hermite C1 smoothstep (`w(0)=0, w(1)=1, w'(0)=w'(1)=0`)

    const elev = standA.elevationStart + (standB.elevationStart - standA.elevationStart) * w;
    const targetOuterD = profA.totalDepth + (profB.totalDepth - profA.totalDepth) * w;
    const targetTopH = profA.topHeight + (profB.topHeight - profA.topHeight) * w;

    // Precompute active tier-break deltas at slice `s` so total depth & height hit exact targets at `u=0` and `u=1`
    const slotConfigs = breakRows.map((rowK, bIdx) => {
      const activeA = bIdx < standA.tiers - 1;
      const activeB = bIdx < standB.tiers - 1;
      const weight = (activeA ? 1 - w : 0) + (activeB ? w : 0);
      const storeysA = activeA && standA.vipLoges !== false ? tiersA[bIdx + 1]?.vipStoreys ?? 1 : 0;
      const storeysB = activeB && standB.vipLoges !== false ? tiersB[bIdx + 1]?.vipStoreys ?? 1 : 0;
      const hasVip = storeysA > 0 || storeysB > 0;
      const dims = tierBreakDims(hasVip, Math.max(storeysA, storeysB));
      const recessAdd = weight * dims.recess;
      const baseLoggiaH = weight * dims.loggiaH;
      // Same projection as each neighbouring stand, blended across the corner.
      const overhang =
        (activeA ? (1 - w) * (tiersA[bIdx + 1]?.overhang ?? 0) : 0) +
        (activeB ? w * (tiersB[bIdx + 1]?.overhang ?? 0) : 0);
      const overhangDelta = -overhang;
      const fasciaH = weight * dims.fasciaH;
      return {
        rowK,
        weight,
        hasVip,
        recessAdd,
        loggiaH: baseLoggiaH,
        overhangDelta,
        fasciaH,
      };
    });

    // Raise each soffit that shelters rows so they keep standing headroom; the riser estimate
    // uses the base budget, which is close enough for a clearance check.
    {
      const baseVertical = slotConfigs.reduce((acc, sc) => acc + sc.loggiaH + sc.fasciaH, 0);
      const estRiser = Math.max(0.2, (targetTopH - 1.85 - elev - baseVertical) / nSteps);
      for (const sc of slotConfigs) {
        if (sc.overhangDelta < 0 && sc.weight > 0.001) {
          sc.loggiaH = Math.max(sc.loggiaH, sc.weight * OVERHANG_HEADROOM_M - estRiser);
        }
      }
    }

    const netBalconyHorizontal = slotConfigs.reduce((acc, sc) => acc + sc.overhangDelta, 0);
    const netBalconyVertical = slotConfigs.reduce(
      (acc, sc) => acc + sc.loggiaH + sc.fasciaH,
      0
    );

    const netTreadTotal = Math.max(5.5, targetOuterD - 2.8 - 0.34 - netBalconyHorizontal);
    const netRiserTotal = Math.max(
      2.5,
      targetTopH - 1.85 - elev - netBalconyVertical
    );

    const stepD = netTreadTotal / nSteps;

    // Progressive upper-tier steepness matching `buildStandProfilePoints` (see tierRiserHeight)
    const rawWeights: number[] = [];
    let wSum = 0;
    let curTier = 0;
    for (let k = 0; k < nSteps; k++) {
      if (breakRowSet.has(k)) curTier++;
      const rw = 1 + curTier * UPPER_TIER_STEEPENING;
      rawWeights.push(rw);
      wSum += rw;
    }

    const pts: [number, number][] = [];
    const sliceRows: { d: number; y: number; stepD: number }[] = [];
    const sliceBals: CornerBalconySample[] = [];

    const parapetTop = elev + 0.58;
    pts.push([0, 0]);
    pts.push([0, parapetTop]);
    pts.push([0.34, parapetTop]);
    pts.push([0.34, elev]);

    let curD = 0.34;
    let curY = elev;
    let maxD = curD;
    let slotCursor = 0;

    for (let k = 0; k < nSteps; k++) {
      if (slotCursor < slotConfigs.length && slotConfigs[slotCursor].rowK === k) {
        const sc = slotConfigs[slotCursor++];
        if (sc.weight > 0.001) {
          const overD = Math.max(1.8, curD + sc.overhangDelta);
          const recD = loggiaRecessD(curD, sc.recessAdd, overD);
          pts.push([recD, curY]);
          pts.push([recD, curY + sc.loggiaH]);
          pts.push([overD, curY + sc.loggiaH]);
          pts.push([overD, curY + sc.loggiaH + sc.fasciaH]);

          sliceBals.push({
            d: overD,
            y: curY + sc.loggiaH + sc.fasciaH * 0.5,
            loggiaD: recD - 0.14,
            loggiaBottomY: curY + 0.06,
            loggiaTopY: curY + sc.loggiaH - 0.06,
            weight: sc.weight,
            hasVipGlass: sc.hasVip && sc.weight > 0.35,
          });

          maxD = Math.max(maxD, recD);
          curD = overD;
          curY += sc.loggiaH + sc.fasciaH;
        } else {
          pts.push([curD, curY]);
          pts.push([curD, curY]);
          pts.push([curD, curY]);
          pts.push([curD, curY]);
          sliceBals.push({
            d: curD,
            y: curY,
            loggiaD: curD,
            loggiaBottomY: curY,
            loggiaTopY: curY,
            weight: 0,
            hasVipGlass: false,
          });
        }
      }

      const thisRiser = (netRiserTotal * rawWeights[k]) / Math.max(1e-5, wSum);
      sliceRows.push({
        d: curD + stepD * 0.52,
        y: curY,
        stepD,
      });

      curD += stepD;
      maxD = Math.max(maxD, curD);
      pts.push([curD, curY]);

      curY += thisRiser;
      pts.push([curD, curY]);
    }

    const outerWallD = Math.max(curD + 2.8, targetOuterD);
    const crestY = curY + 1.85;
    pts.push([curD, crestY]);
    pts.push([outerWallD, crestY]);

    if (isHollow && crestY > 5.0) {
      pts.push([outerWallD, Math.max(2.2, crestY - 2.35)]);
      pts.push([Math.max(3.6, outerWallD * 0.5), Math.max(1.4, crestY * 0.44 - 1.4)]);
      pts.push([2.4, 0]);
    } else {
      pts.push([outerWallD, 0]);
    }

    const gradeY = facadeGradeY(sunkenDepth, crestY);
    profilePtsPerSlice.push(pts);
    rowSamplesPerSlice.push(sliceRows);
    balconiesPerSlice.push(sliceBals);
    crestPerSlice.push({ outerD: outerWallD, topH: crestY, elev, gradeY });
  }

  // Vehicle access: a tunnel carved under the corner's lower rows.
  const cornerSwept: SweptStand = {
    sliceCount: segs + 1,
    closed: false,
    profiles: profilePtsPerSlice,
    world: (sl, radD, py) => {
      const pt = sampleCornerQuadrantPoint(corner, sl / segs, radD);
      return [pt.x, py, pt.z];
    },
  };
  const tunnel = doc.cornerAccess?.[corner.id]
    ? planCornerTunnel(cornerSwept, sampleCornerQuadrantPoint(corner, 0.5, 0))
    : null;
  if (tunnel) group.add(buildCornerTunnel(cornerSwept, tunnel, concreteMat, isNight));
  const isCornerHole = (sl: number, p: number) => (tunnel ? isTunnelQuad(tunnel, sl, p) : false);
  const overTunnel = (sl: number, y: number) =>
    tunnel !== null && isTunnelBay(tunnel, sl) && y < CORNER_ACCESS_DECK_Y;

  // 1. Multi-material stepped corner bowl (`s = 0 -> segs` clockwise around +Y => guaranteed +Y upward treads!)
  const midDepth = (profA.totalDepth + profB.totalDepth) * 0.5;
  const midArcLen = (corner.radius + midDepth * 0.5) * (Math.PI * 0.5);
  const cornerURepeat = Math.max(1, Math.round(midArcLen / 34));
  const cornerVRepeat = Math.max(1.0, nSteps / 24);

  const cornerGeo = buildMultiMaterialSweptStandGeometry(
    segs + 1,
    segs,
    false,
    profilePtsPerSlice,
    (s, radD, py) => {
      const pt = sampleCornerQuadrantPoint(corner, s / segs, radD);
      return [pt.x, py, pt.z];
    },
    isSeatMask,
    cornerURepeat,
    cornerVRepeat,
    isCornerHole
  );

  const cornerSeats3d = resolveSeats3d(resolveStadiumMaterials(doc));
  const cornerMesh = new THREE.Mesh(cornerGeo, [concreteMat, cornerSeats3d ? concreteMat : seatMat]);
  cornerMesh.name = 'CornerTerrace';
  cornerMesh.castShadow = true;
  cornerMesh.receiveShadow = true;
  group.add(cornerMesh);

  // Keeping one stand's section, the corner ends with a wall against the other stand: whichever is
  // taller there shows a clean step instead of a morph.
  if (corner.follow) {
    const uEnd = corner.follow === corner.sideA ? 1 : 0;
    const capGeo = new THREE.ShapeGeometry(profA.shape);
    const pos = capGeo.attributes.position;
    const uv = capGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const d = pos.getX(i);
      const y = pos.getY(i);
      const pt = sampleCornerQuadrantPoint(corner, uEnd, d);
      pos.setXYZ(i, pt.x, y, pt.z);
      if (uv) uv.setXY(i, d * 0.08, y * 0.08);
    }
    capGeo.computeVertexNormals();
    const capMat = concreteMat.clone();
    capMat.side = THREE.DoubleSide;
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.name = 'CornerStepWall';
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(cap);
  }

  const cornerDetails = buildStandDetails({
    ringCount: segs + 1,
    activeSegments: segs,
    closed: false,
    profilePtsPerSlice,
    sampleWorldPoint: (s, radD, py) => {
      const pt = sampleCornerQuadrantPoint(corner, s / segs, radD);
      return [pt.x, py, pt.z];
    },
    isSeatSegmentMask: isSeatMask,
    isHoleQuad: isCornerHole,
    aisleCount: 2,
    aisleWidth: (standA.aisleWidth + standB.aisleWidth) * 0.5,
    lit: doc.lighting !== 'day',
  });
  if (cornerDetails) group.add(cornerDetails);

  if (cornerSeats3d) {
    const painterA = createStandSeatPainter(doc, standA, { lettering: false });
    const painterB = createStandSeatPainter(doc, standB, { lettering: false });
    const seats = buildSweepSeatInstances({
      ringCount: segs + 1,
      activeSegments: segs,
      closed: false,
      profilePtsPerSlice,
      sampleWorldPoint: (s, radD, py) => {
        const pt = sampleCornerQuadrantPoint(corner, s / segs, radD);
        return [pt.x, py, pt.z];
      },
      isSeatSegmentMask: isSeatMask,
      isHoleQuad: isCornerHole,
      rowDepth: (standA.rowDepth + standB.rowDepth) * 0.5,
      seatWidth: (standA.seatWidth + standB.seatWidth) * 0.5,
      aisleCount: 2,
      aisleWidth: (standA.aisleWidth + standB.aisleWidth) * 0.5,
      primaryHex: doc.colors.seatsPrimary,
      secondaryHex: doc.colors.seatsSecondary,
      attendance: resolveCrowdAttendance(resolveStadiumMaterials(doc)),
      // Each half of the corner carries the colours of the stand it runs into.
      paint: (seat, out) => {
        const u = seat.along / Math.max(1e-6, seat.rowLength);
        return (u < 0.5 ? painterA : painterB)(seat.tier, { ...seat, u }, out);
      },
    });
    if (seats) group.add(seats);
  }

  // 2. 3D Molded Ergonomic Bucket-Seat Backrest Shells sweeping across every corner row
  const rowStride = nSteps > 52 ? 2 : 1;
  const sampledRowIndices: number[] = [];
  for (let k = 0; k < nSteps; k += rowStride) sampledRowIndices.push(k);
  const totalBackrestSegs = cornerSeats3d ? 0 : segs * sampledRowIndices.length;

  if (totalBackrestSegs > 0) {
    const unitBackGeo = new THREE.BoxGeometry(1.0, 0.26, 0.11);
    const cornerBackrests = new THREE.InstancedMesh(
      unitBackGeo,
      seatMat,
      totalBackrestSegs
    );
    cornerBackrests.castShadow = true;
    cornerBackrests.receiveShadow = true;

    const dummySeat = new THREE.Object3D();
    let instIdx = 0;
    for (let s = 0; s < segs; s++) {
      const u0 = s / segs;
      const u1 = (s + 1) / segs;
      for (const k of sampledRowIndices) {
        const r0 = rowSamplesPerSlice[s][k];
        const r1 = rowSamplesPerSlice[s + 1][k];
        if (overTunnel(s, r0.y)) continue;
        const p0 = sampleCornerQuadrantPoint(corner, u0, r0.d + r0.stepD * 0.24);
        const p1 = sampleCornerQuadrantPoint(corner, u1, r1.d + r1.stepD * 0.24);
        const chordLen = Math.max(0.2, Math.hypot(p1.x - p0.x, p1.z - p0.z));
        const mx = (p0.x + p1.x) * 0.5;
        const mz = (p0.z + p1.z) * 0.5;
        const my = (r0.y + r1.y) * 0.5 + 0.23;

        // Outward normal angle around Y so local +Z points outward and local X runs along the chord
        const dx = p1.x - p0.x;
        const dz = p1.z - p0.z;
        const yaw = Math.atan2(-dx, -dz) + Math.PI * 0.5;

        dummySeat.position.set(mx, my, mz);
        dummySeat.rotation.set(0, yaw, 0);
        dummySeat.rotateX(-0.14);
        dummySeat.scale.set(chordLen * 0.96, 1, 1);
        dummySeat.updateMatrix();
        cornerBackrests.setMatrixAt(instIdx++, dummySeat.matrix);
      }
    }
    cornerBackrests.count = instIdx;
    cornerBackrests.instanceMatrix.needsUpdate = true;
    cornerBackrests.computeBoundingSphere();
    group.add(cornerBackrests);
  }

  // 3. Radial Concrete Stairway Joint Ribs on 3-Bay Faceted Modular Corners (`english_rectangular`)
  if (corner.facetedThreeBay) {
    const stairRibMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.78,
      metalness: 0.06,
    });
    const handrailMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      roughness: 0.35,
      metalness: 0.65,
    });
    // One rib per tier, from its first row to its last: a single rib would cut through balconies.
    const tierStarts = [0, ...breakRows];
    const tierRuns = tierStarts.map((k0, i) => [k0, (tierStarts[i + 1] ?? nSteps) - 1] as const);
    for (const uSeam of [1 / 3, 2 / 3]) for (const [kBot, kTop] of tierRuns) {
      const sIdx = Math.round(uSeam * segs);
      const rBot = rowSamplesPerSlice[sIdx][kBot];
      const rTop = rowSamplesPerSlice[sIdx][kTop];
      if (rBot && rTop && kTop > kBot) {
        const pBot = sampleCornerQuadrantPoint(corner, uSeam, rBot.d);
        const pTop = sampleCornerQuadrantPoint(corner, uSeam, rTop.d);
        group.add(
          createStrut(
            new THREE.Vector3(pBot.x, rBot.y + 0.12, pBot.z),
            new THREE.Vector3(pTop.x, rTop.y + 0.12, pTop.z),
            0.38,
            0.38,
            stairRibMat,
            4
          ),
          createStrut(
            new THREE.Vector3(pBot.x, rBot.y + 0.72, pBot.z),
            new THREE.Vector3(pTop.x, rTop.y + 0.72, pTop.z),
            0.04,
            0.04,
            handrailMat,
            5
          )
        );
      }
    }
  }

  // 4. Pitch-Side Laminated Glass Safety Guardrail wrapping seamlessly around the corner parapet
  const glassRailPos = new Float32Array((segs + 1) * 2 * 3);
  const glassRailIdx: number[] = [];
  for (let s = 0; s <= segs; s++) {
    const pt = sampleCornerQuadrantPoint(corner, s / segs, 0.17);
    const botY = crestPerSlice[s].elev + 0.58;
    const topY = botY + 0.68;
    const b = s * 6;
    glassRailPos[b] = pt.x;
    glassRailPos[b + 1] = botY;
    glassRailPos[b + 2] = pt.z;
    glassRailPos[b + 3] = pt.x;
    glassRailPos[b + 4] = topY;
    glassRailPos[b + 5] = pt.z;
  }
  for (let s = 0; s < segs; s++) {
    // The tunnel deck carries its own parapet; a wire fence replaces the glass.
    if ((tunnel && isTunnelBay(tunnel, s)) || doc.frontFence === 'mesh') continue;
    const a = s * 2;
    const b = (s + 1) * 2;
    const c = b + 1;
    const d = a + 1;
    glassRailIdx.push(a, d, b, b, d, c);
  }
  const glassRailGeo = new THREE.BufferGeometry();
  glassRailGeo.setAttribute('position', new THREE.BufferAttribute(glassRailPos, 3));
  glassRailGeo.setIndex(glassRailIdx);
  glassRailGeo.computeVertexNormals();
  const cornerGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xe0f2fe,
    roughness: 0.08,
    metalness: 0.1,
    clearcoat: 0.95,
    transparent: true,
    opacity: 0.52,
    side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(glassRailGeo, cornerGlassMat));

  if (doc.frontFence === 'mesh') {
    const runs: { points: THREE.Vector3[]; inward: THREE.Vector3[] }[] = [];
    let cur: { points: THREE.Vector3[]; inward: THREE.Vector3[] } | null = null;
    const pushSlice = (sl: number) => {
      const pt = sampleCornerQuadrantPoint(corner, sl / segs, 0.12);
      cur!.points.push(new THREE.Vector3(pt.x, crestPerSlice[sl].elev + 0.58, pt.z));
      cur!.inward.push(new THREE.Vector3(-pt.nx, 0, -pt.nz));
    };
    for (let sl = 0; sl < segs; sl++) {
      if (tunnel && isTunnelBay(tunnel, sl)) {
        cur = null;
        continue;
      }
      if (!cur) {
        cur = { points: [], inward: [] };
        runs.push(cur);
        pushSlice(sl);
      }
      pushSlice(sl + 1);
    }
    group.add(buildWireFence(runs, resolveFenceHeight(doc.frontFenceHeight)));
  }

  // 5. 3D Precast Corner Vomitory Portals at the 45° Corner Bisector
  const vomPortalMat = new THREE.MeshStandardMaterial({
    color: 0x8b9199,
    roughness: 0.9,
    metalness: 0.02,
  });
  const darkVomMat = new THREE.MeshStandardMaterial({
    color: 0x1a1714,
    roughness: 0.96,
  });
  const vomRailMat = new THREE.MeshStandardMaterial({
    color: 0x9ca3af,
    roughness: 0.28,
    metalness: 0.85,
  });
  const midSlice = Math.floor(segs * 0.5);
  const vomRowTargets =
    maxTiers >= 3
      ? [Math.floor(nSteps * 0.18), Math.floor(nSteps * 0.52)]
      : [Math.floor(nSteps * 0.36)];
  for (const rk of vomRowTargets) {
    const rSample = rowSamplesPerSlice[midSlice][Math.min(nSteps - 2, Math.max(2, rk))];
    if (!rSample || overTunnel(midSlice, rSample.y + 1.8)) continue;
    const vPt = sampleCornerQuadrantPoint(corner, 0.5, rSample.d);
    const portal = createVomitoryPortalUnit(vomPortalMat, darkVomMat, vomRailMat);
    portal.position.set(vPt.x, rSample.y, vPt.z);
    // Orient portal local -Z toward pitch center (`(-nx, 0, -nz)`) => local +Z points outward `(nx, 0, nz)`
    portal.rotation.y = Math.atan2(vPt.nx, vPt.nz);
    group.add(portal);
  }

  // 6. Safe-Standing Crush Barriers in Corner if adjacent stand uses `safe_standing`
  if (standA.seatingType === 'safe_standing' || standB.seatingType === 'safe_standing') {
    for (let k = 2; k < Math.min(nSteps, maxTiers === 1 ? nSteps : Math.ceil(nSteps * 0.36)); k += 3) {
      const railPts: THREE.Vector3[] = [];
      for (let s = 0; s <= segs; s++) {
        const u = s / segs;
        const activeHere =
          (u <= 0.55 && standA.seatingType === 'safe_standing') ||
          (u >= 0.45 && standB.seatingType === 'safe_standing');
        if (!activeHere) continue;
        const rs = rowSamplesPerSlice[s][k];
        const p = sampleCornerQuadrantPoint(corner, u, rs.d - rs.stepD * 0.32);
        railPts.push(new THREE.Vector3(p.x, rs.y + 0.72, p.z));
      }
      if (railPts.length >= 3) {
        group.add(
          new THREE.Mesh(
            new THREE.TubeGeometry(
              new THREE.CatmullRomCurve3(railPts, false),
              railPts.length * 2,
              0.05,
              5,
              false
            ),
            vomRailMat
          )
        );
      }
    }
  }

  // 7. Inward-Facing Cantilevered Balcony Fascias, LED Ribbons & Backlit VIP Skybox Glazing
  if (breakRows.length > 0) {
    const fasciaSlabMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.32,
      metalness: 0.18,
    });
    const ledFasciaMat = createLedFasciaMaterial(doc.lighting === 'day');

    const curveType = corner.facetedThreeBay ? 'centripetal' : 'catmullrom';
    const curveTension = corner.facetedThreeBay ? 0.04 : 0.5;

    for (let bIdx = 0; bIdx < breakRows.length; bIdx++) {
      const fasciaPts: THREE.Vector3[] = [];
      const ledPts: THREE.Vector3[] = [];
      const vipLine: THREE.Vector3[] = [];
      const vipInward: THREE.Vector3[] = [];
      const vipBot: number[] = [];
      const vipTop: number[] = [];

      for (let s = 0; s <= segs; s++) {
        const bal = balconiesPerSlice[s][bIdx];
        if (!bal || bal.weight < 0.18) continue;
        const u = s / segs;
        const fp = sampleCornerQuadrantPoint(corner, u, bal.d - 0.04);
        const lp = sampleCornerQuadrantPoint(corner, u, bal.d - 0.42);
        fasciaPts.push(new THREE.Vector3(fp.x, bal.y, fp.z));
        ledPts.push(new THREE.Vector3(lp.x, bal.y, lp.z));

        if (bal.hasVipGlass && bal.loggiaTopY - bal.loggiaBottomY > 0.6) {
          const gp = sampleCornerQuadrantPoint(corner, u, bal.loggiaD);
          const gb = sampleCornerQuadrantPoint(corner, u, bal.loggiaD + 1);
          vipLine.push(new THREE.Vector3(gp.x, 0, gp.z));
          vipInward.push(new THREE.Vector3(gb.x - gp.x, 0, gb.z - gp.z).normalize());
          vipBot.push(bal.loggiaBottomY);
          vipTop.push(bal.loggiaTopY);
        }
      }

      if (fasciaPts.length >= 3) {
        const fCurve = new THREE.CatmullRomCurve3(fasciaPts, false, curveType, curveTension);
        const fasciaTube = new THREE.Mesh(
          new THREE.TubeGeometry(fCurve, fasciaPts.length * 2, 0.36, 6, false),
          fasciaSlabMat
        );
        fasciaTube.castShadow = true;
        group.add(fasciaTube);

        const lCurve = new THREE.CatmullRomCurve3(ledPts, false, curveType, curveTension);
        group.add(buildLedFasciaBand(lCurve.getPoints(ledPts.length * 2), 0.88, ledFasciaMat));
      }

      if (vipLine.length >= 2) {
        const glazing = buildSkyboxGlazing(
          { line: vipLine, bottomY: vipBot, topY: vipTop, inward: vipInward },
          doc.lighting !== 'day'
        );
        if (glazing) group.add(glazing);
      }
    }
  }

  // 8. Exterior envelope around the corner.
  group.add(
    buildStandEnvelope({
      doc,
      rail: crestPerSlice.map((cr, s) => {
        const pt = sampleCornerQuadrantPoint(corner, s / segs, cr.outerD);
        return { x: pt.x, z: pt.z, nx: pt.nx, nz: pt.nz, yBottom: cr.gradeY, yTop: cr.topH, depth: cr.outerD };
      }),
      closed: false,
      facadeMat,
      structureMat,
      concreteMat,
      turnstileTex,
      name: `CornerEnvelope_${corner.id.toUpperCase()}`,
    })
  );

  // Glazed circulation rotunda on `compact_urban` corners.
  if (doc.shape === 'compact_urban' && envelope === 'enveloping_skin' && doc.roof.style !== 'enveloping_shell') {
    {
      const midCr = crestPerSlice[midSlice];
      const wallH = Math.max(4.0, midCr.topH - midCr.gradeY);
      const tPt = sampleCornerQuadrantPoint(corner, 0.5, midCr.outerD + 2.1);
      const towerR = 4.4;
      const towerH = wallH + 1.2;

      const rotundaGlassMat = new THREE.MeshPhysicalMaterial({
        color: isNight ? 0xfef3c7 : 0x38bdf8,
        emissive: new THREE.Color(isNight ? 0xf59e0b : 0x000000),
        emissiveIntensity: isNight ? 0.35 : 0,
        roughness: 0.14,
        metalness: 0.28,
        clearcoat: 0.92,
        transparent: true,
        opacity: 0.78,
      });
      const coreCyl = new THREE.Mesh(
        new THREE.CylinderGeometry(towerR * 0.86, towerR * 0.9, towerH, 24),
        rotundaGlassMat
      );
      coreCyl.position.set(tPt.x, midCr.gradeY + towerH * 0.5, tPt.z);
      coreCyl.castShadow = true;
      group.add(coreCyl);

      // Horizontal concourse slab rings & rooftop crown ring around the corner rotunda
      for (let h = midCr.gradeY + 3.6; h <= midCr.topH + 0.8; h += 4.2) {
        const slabRing = new THREE.Mesh(
          new THREE.CylinderGeometry(towerR + 0.35, towerR + 0.35, 0.48, 24),
          structureMat
        );
        slabRing.position.set(tPt.x, h, tPt.z);
        slabRing.castShadow = true;
        group.add(slabRing);
      }
      const crownCap = new THREE.Mesh(
        new THREE.CylinderGeometry(towerR + 0.55, towerR + 0.45, 0.72, 24),
        structureMat
      );
      crownCap.position.set(tPt.x, midCr.gradeY + towerH + 0.2, tPt.z);
      crownCap.castShadow = true;
      group.add(crownCap);
    }
  }

  return group;
}

/**
 * Builds the excavated sunken amphitheatre earth berm, inner concrete retaining collar,
 * elevated mineral esplanade promenade (`Y = sunkenDepth`), and axial grand stairways!
 */
function buildSunkenAmphitheatreBerm(
  doc: StadiumDocument,
  bowlRing: RoundedBowlGeometry,
  outerStandDepth: number,
  sunkenDepth: number,
  crossSectionClip: boolean,
  concreteMat: THREE.MeshStandardMaterial,
  maxAnisotropy: number
): THREE.Group {
  const bermGroup = new THREE.Group();
  bermGroup.name = 'SunkenAmphitheatreBerm';

  const mats = resolveStadiumMaterials(doc);
  const plazaDetail = createPlazaDetailNormalAndRoughness(
    mats.plazaSurface,
    maxAnisotropy
  );

  const parvisColor =
    mats.plazaSurface === 'sandstone_esplanade'
      ? 0xc2b9ac
      : mats.plazaSurface === 'urban_asphalt'
      ? 0x263244
      : 0x566578;

  const parvisMat = new THREE.MeshStandardMaterial({
    color: parvisColor,
    normalMap: plazaDetail.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: plazaDetail.roughnessMap,
    roughness: 0.86,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });

  const embankmentGrassMat = new THREE.MeshStandardMaterial({
    color: doc.lighting === 'night' ? 0x173322 : 0x285934,
    roughness: 0.94,
    metalness: 0.01,
    side: THREE.DoubleSide,
  });

  const tStart = crossSectionClip ? 0.5 : 0.0;
  const tEnd = 1.0;
  const closed = !crossSectionClip;
  const segs = crossSectionClip ? 64 : 128;
  const ringCount = closed ? segs : segs + 1;

  // Profile of excavated collar + elevated parvis + landscaped outer talus slope:
  // [radialOffsetFromInnerBowl, y]
  const rCollar = outerStandDepth + 0.6;
  const rParvisInner = outerStandDepth + 0.8;
  const rParvisOuter = outerStandDepth + 22.0;
  const rTalusFoot = outerStandDepth + 68.0;

  // 1. Retaining collar + Upper Parvis Deck (`rCollar -> rParvisOuter`)
  const parvisPos = new Float32Array(ringCount * 3 * 3);
  const parvisUvs = new Float32Array(ringCount * 3 * 2);
  const parvisIdx: number[] = [];

  // 2. Landscaped green embankment sloping back down to `Y = 0` (`rParvisOuter -> rTalusFoot`)
  const talusPos = new Float32Array(ringCount * 2 * 3);
  const talusUvs = new Float32Array(ringCount * 2 * 2);
  const talusIdx: number[] = [];

  for (let s = 0; s < ringCount; s++) {
    const t = tStart + (s / segs) * (tEnd - tStart);
    const p0 = sampleRoundedBowlRing(bowlRing, t, rCollar);
    const p1 = sampleRoundedBowlRing(bowlRing, t, rParvisInner);
    const p2 = sampleRoundedBowlRing(bowlRing, t, rParvisOuter);
    const p3 = sampleRoundedBowlRing(bowlRing, t, rTalusFoot);

    const b3 = s * 9;
    parvisPos[b3] = p0.x;
    parvisPos[b3 + 1] = 0;
    parvisPos[b3 + 2] = p0.z;

    parvisPos[b3 + 3] = p1.x;
    parvisPos[b3 + 4] = sunkenDepth;
    parvisPos[b3 + 5] = p1.z;

    parvisPos[b3 + 6] = p2.x;
    parvisPos[b3 + 7] = sunkenDepth;
    parvisPos[b3 + 8] = p2.z;

    const u = (s / segs) * 28;
    const u3 = s * 6;
    parvisUvs[u3] = u;
    parvisUvs[u3 + 1] = 0;
    parvisUvs[u3 + 2] = u;
    parvisUvs[u3 + 3] = 0.35;
    parvisUvs[u3 + 4] = u;
    parvisUvs[u3 + 5] = 1.0;

    const bt = s * 6;
    talusPos[bt] = p2.x;
    talusPos[bt + 1] = sunkenDepth - 0.05;
    talusPos[bt + 2] = p2.z;

    talusPos[bt + 3] = p3.x;
    talusPos[bt + 4] = 0.01;
    talusPos[bt + 5] = p3.z;

    const ut = s * 4;
    talusUvs[ut] = u;
    talusUvs[ut + 1] = 0;
    talusUvs[ut + 2] = u;
    talusUvs[ut + 3] = 1;
  }

  for (let s = 0; s < segs; s++) {
    const nxt = closed ? (s + 1) % ringCount : s + 1;
    for (let k = 0; k < 2; k++) {
      const a = s * 3 + k;
      const b = nxt * 3 + k;
      const c = nxt * 3 + k + 1;
      const d = s * 3 + k + 1;
      parvisIdx.push(a, b, d, b, c, d);
    }
    const ta = s * 2;
    const tb = nxt * 2;
    const tc = nxt * 2 + 1;
    const td = s * 2 + 1;
    talusIdx.push(ta, tb, td, tb, tc, td);
  }

  const parvisGeo = new THREE.BufferGeometry();
  parvisGeo.setAttribute('position', new THREE.BufferAttribute(parvisPos, 3));
  parvisGeo.setAttribute('uv', new THREE.BufferAttribute(parvisUvs, 2));
  parvisGeo.setIndex(parvisIdx);
  parvisGeo.computeVertexNormals();
  const parvisMesh = new THREE.Mesh(parvisGeo, parvisMat);
  parvisMesh.receiveShadow = true;
  parvisMesh.castShadow = true;
  bermGroup.add(parvisMesh);

  const talusGeo = new THREE.BufferGeometry();
  talusGeo.setAttribute('position', new THREE.BufferAttribute(talusPos, 3));
  talusGeo.setAttribute('uv', new THREE.BufferAttribute(talusUvs, 2));
  talusGeo.setIndex(talusIdx);
  talusGeo.computeVertexNormals();
  const talusMesh = new THREE.Mesh(talusGeo, embankmentGrassMat);
  talusMesh.receiveShadow = true;
  bermGroup.add(talusMesh);

  // Monumental axial access stairways cut into the embankment up to the upper concourse!
  const stairParams = crossSectionClip ? [0.5, 0.75, 1.0] : [0.0, 0.25, 0.5, 0.75];
  for (const tStair of stairParams) {
    const pTop = sampleRoundedBowlRing(bowlRing, tStair, rParvisOuter - 1.0);
    const pBot = sampleRoundedBowlRing(bowlRing, tStair, rTalusFoot - 2.0);
    const rampLen = Math.hypot(pBot.x - pTop.x, pBot.z - pTop.z);
    const slopeAng = Math.atan2(sunkenDepth, rampLen);
    const stairRamp = new THREE.Mesh(
      new THREE.BoxGeometry(14, 0.9, rampLen),
      concreteMat
    );
    stairRamp.position.set(
      (pTop.x + pBot.x) * 0.5,
      sunkenDepth * 0.5,
      (pTop.z + pBot.z) * 0.5
    );
    stairRamp.rotation.y = -pTop.angle + Math.PI / 2;
    stairRamp.rotation.x = slopeAng;
    stairRamp.castShadow = true;
    stairRamp.receiveShadow = true;
    bermGroup.add(stairRamp);
  }

  return bermGroup;
}

/**
 * Generates a stepped multi-material swept stadium bowl supporting all continuous morphologies
 * (`modern_bowl`, `steep_cauldron`, `olympic_oval`, `sunken_bowl`, `octagonal_arena`, `horseshoe`),
 * full-height 1-tier Kop walls seamlessly flush with multi-tier stands, safe standing barriers,
 * telescopic pitch-side tiers, and all 4 exterior facade envelope architectures.
 */
function buildModernBowlSweep(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  concreteMat: THREE.MeshStandardMaterial,
  turnstileTex: THREE.CanvasTexture,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const isHollow = isHollowStand(doc);

  const trackOffsets = getTrackRadialOffset(doc);
  const sunkenDepth = getEffectiveSunkenDepth(doc);

  const segments = bowlSweepSegments(doc.shape);
  const profiles: Record<StandSide, StandProfile> = {
    east: buildStandProfilePoints(doc.stands.east, isHollow),
    south: buildStandProfilePoints(doc.stands.south, isHollow),
    west: buildStandProfilePoints(doc.stands.west, isHollow),
    north: buildStandProfilePoints(doc.stands.north, isHollow),
  };

  const maxRows = Math.max(
    doc.stands.north.enabled ? doc.stands.north.rows : 0,
    doc.stands.south.enabled ? doc.stands.south.rows : 0,
    doc.shape !== 'horseshoe' && doc.stands.east.enabled ? doc.stands.east.rows : 0,
    doc.stands.west.enabled ? doc.stands.west.rows : 0
  );
  if (maxRows <= 0) return group;

  const avgDistX =
    (doc.stands.east.distanceToPitch + doc.stands.west.distanceToPitch) * 0.5;
  const avgDistZ =
    (doc.stands.north.distanceToPitch + doc.stands.south.distanceToPitch) * 0.5;

  const safePitch = clampPitchToTrack(doc.pitch);
  const bowlRing = buildShapeBowlRing(
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

  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const baseSegments = Math.max(36, Math.round(segments * arcFraction));

  // Stands keep their own rows; corners end the extra rows one by one (see bowlSection).
  const sectionModel = usesBowlSectionModel(doc.shape) ? buildBowlSectionModel(doc, isHollow) : null;

  const sliceT: number[] = [];
  for (let s = 0; s < baseSegments + (closed ? 0 : 1); s++) {
    sliceT.push(tStart + (s / baseSegments) * (tEnd - tStart));
  }
  if (sectionModel) {
    // A corner kept at one stand's section meets the other stand at a gable wall: two slices a
    // hair apart, one with each section.
    const STEP_GAP = 1e-5;
    const arcEnd = closed ? tStart + 1 : tEnd;
    for (const junction of bowlStepJunctions(sectionModel, bowlRing)) {
      const t = [junction, junction + 1, junction - 1].find(
        (c) => c - STEP_GAP > tStart && c + STEP_GAP < arcEnd
      );
      if (t !== undefined) sliceT.push(t - STEP_GAP, t + STEP_GAP);
    }
    sliceT.sort((a, b) => a - b);
  }
  const ringCount = sliceT.length;
  const activeSegments = closed ? ringCount : ringCount - 1;

  /** Ring position of slice `s`; fractional slices interpolate to the next one. */
  const tAtSlice = (s: number) => {
    const i = Math.floor(s);
    const frac = s - i;
    const tOf = (k: number) => (closed ? sliceT[((k % ringCount) + ringCount) % ringCount] + Math.floor(k / ringCount) : sliceT[Math.min(ringCount - 1, Math.max(0, k))]);
    return frac > 0 ? tOf(i) + (tOf(i + 1) - tOf(i)) * frac : tOf(i);
  };

  const sectorWeightsAt = (nx: number, nz: number) => {
    const w = bowlSideWeights(doc.shape, nx, nz);
    // The horseshoe's open end has no east stand.
    const wE = doc.shape === 'horseshoe' ? 0 : w.east;
    const sum = wE + w.west + w.south + w.north || 1;
    return { e: wE / sum, s: w.south / sum, w: w.west / sum, n: w.north / sum };
  };

  const dominantSideAt = (nx: number, nz: number): StandSide => {
    if (doc.shape === 'tilted_bowl') return nz >= 0 ? 'south' : 'north';
    if (doc.shape === 'horseshoe' && nx > 0 && Math.abs(nx) >= Math.abs(nz)) {
      return nz >= 0 ? 'south' : 'north';
    }
    if (Math.abs(nx) >= Math.abs(nz)) {
      return nx >= 0 ? 'east' : 'west';
    }
    return nz >= 0 ? 'south' : 'north';
  };

  const evalStandEnvelopeAt = (nx: number, nz: number) => {
    const w = sectorWeightsAt(nx, nz);
    const dE = doc.stands.east.enabled ? profiles.east.totalDepth : 12;
    const dS = doc.stands.south.enabled ? profiles.south.totalDepth : 12;
    const dW = doc.stands.west.enabled ? profiles.west.totalDepth : 12;
    const dN = doc.stands.north.enabled ? profiles.north.totalDepth : 12;

    const hE = doc.stands.east.enabled ? profiles.east.topHeight : 6;
    const hS = doc.stands.south.enabled ? profiles.south.topHeight : 6;
    const hW = doc.stands.west.enabled ? profiles.west.topHeight : 6;
    const hN = doc.stands.north.enabled ? profiles.north.topHeight : 6;

    return {
      depth: w.e * dE + w.s * dS + w.w * dW + w.n * dN,
      height: w.e * hE + w.s * hS + w.w * hW + w.n * hN,
    };
  };

  const sideSections: Record<StandSide, StandSection> = {
    east: computeStandSection(doc.stands.east),
    south: computeStandSection(doc.stands.south),
    west: computeStandSection(doc.stands.west),
    north: computeStandSection(doc.stands.north),
  };

  /**
   * Tier layout at a point of the ring. The tier count follows the dominant stand; rows share,
   * rake and overhang are blended across the stands that have that many tiers, so the profile
   * morphs smoothly from one stand to the next instead of jumping at the sector boundary.
   */
  const blendTierParamsAt = (nx: number, nz: number) => {
    const domStand = doc.stands[dominantSideAt(nx, nz)];
    const tiers = domStand.enabled ? sideSections[domStand.id].tiers.length : 1;
    const w = sectorWeightsAt(nx, nz);
    const weights: Record<StandSide, number> = { east: w.e, south: w.s, west: w.w, north: w.n };
    const contributors = (Object.keys(weights) as StandSide[]).filter(
      (side) =>
        weights[side] > 0 &&
        doc.stands[side].enabled &&
        sideSections[side].tiers.length === tiers
    );
    const sides = contributors.length > 0 ? contributors : [domStand.id];
    const total = sides.reduce((acc, side) => acc + (contributors.length > 0 ? weights[side] : 1), 0) || 1;
    const share = Array<number>(tiers).fill(0);
    const slopeTan = Array<number>(tiers).fill(0);
    const overhang = Array<number>(tiers).fill(0);
    for (const side of sides) {
      const wt = (contributors.length > 0 ? weights[side] : 1) / total;
      const sec = sideSections[side];
      const rowsTotal = Math.max(1, sec.rows.length);
      sec.tiers.slice(0, tiers).forEach((tier, t) => {
        share[t] += (wt * tier.rows) / rowsTotal;
        slopeTan[t] += wt * (tier.riserHeight / Math.max(0.4, doc.stands[side].rowDepth));
        overhang[t] += wt * tier.overhang;
      });
    }
    const shareSum = share.reduce((a, b) => a + b, 0) || 1;
    return {
      tiers,
      hasVip: tiers >= 2 && domStand.vipLoges !== false,
      /** Storeys of boxes in the break below each tier, from the dominant stand. */
      vipStoreys: sideSections[domStand.id].tiers.map((t) => t.vipStoreys),
      share: share.map((v) => v / shareSum),
      slopeTan,
      overhang,
    };
  };

  const N_TERRACE_STEPS = 30;
  const isSeatSegmentMask: boolean[] = [];
  if (sectionModel) {
    isSeatSegmentMask.push(...sectionModel.isSeatSegmentMask);
  } else {
    isSeatSegmentMask.push(false, false, false);
    for (let k = 0; k < N_TERRACE_STEPS; k++) {
      if (k === 6 || k === 12 || k === 18 || k === 24) {
        isSeatSegmentMask.push(false, false, false, false);
      }
      isSeatSegmentMask.push(true, false);
    }
    if (isHollow) {
      isSeatSegmentMask.push(false, false, false, false);
    } else {
      isSeatSegmentMask.push(false, false);
    }
  }

  const profilePtsPerSlice: [number, number][][] = [];
  /** Share of hospitality boxes in each slice's tier breaks. */
  const vipPerSlice: number[] = [];
  const topCrestPerSlice: [number, number][] = [];
  const sliceCornerId: (CornerId | null)[] = [];

  for (let s = 0; s < ringCount; s++) {
    const t = tAtSlice(s);
    const baseSample = sampleRoundedBowlRing(bowlRing, t, 0);

    // Corner quadrant when the slice lies well inside a corner arc/chamfer; bowed sides also
    // tilt their normals near their ends, hence the segment test.
    let cQuad: CornerId | null = null;
    if (
      isOnRingCorner(bowlRing, t) &&
      Math.abs(baseSample.nx) > 0.22 &&
      Math.abs(baseSample.nz) > 0.22
    ) {
      if (baseSample.nx > 0 && baseSample.nz > 0) cQuad = 'se';
      else if (baseSample.nx < 0 && baseSample.nz > 0) cQuad = 'sw';
      else if (baseSample.nx < 0 && baseSample.nz < 0) cQuad = 'nw';
      else cQuad = 'ne';
    }
    sliceCornerId.push(cQuad);

    if (sectionModel) {
      const section = bowlSectionAt(sectionModel, bowlMixAtT(sectionModel, bowlRing, t, baseSample.nz));
      topCrestPerSlice.push([section.outerD, section.topHeight]);
      profilePtsPerSlice.push(section.pts);
      vipPerSlice.push(section.vip);
      continue;
    }

    const env = evalStandEnvelopeAt(baseSample.nx, baseSample.nz);
    const tierBlend = blendTierParamsAt(baseSample.nx, baseSample.nz);
    const domTiers = tierBlend.tiers;
    const domVip = tierBlend.hasVip;
    const breakDimsOfTier = (t: number) => tierBreakDims(domVip, tierBlend.vipStoreys[t] ?? 1);

    const activeBreakSlots =
      domTiers === 2
        ? [12]
        : domTiers === 3
        ? [12, 24]
        : domTiers === 4
        ? [6, 12, 18]
        : domTiers >= 5
        ? [6, 12, 18, 24]
        : [];

    // Terrace steps per tier: tier boundaries stay on fixed slots (shared mesh topology), while
    // each tier's depth follows its share of rows and its risers follow its own rake.
    const tierOfStep = (k: number) => activeBreakSlots.filter((slot) => k >= slot).length;
    const stepsPerTier = Array.from({ length: domTiers }, (_, t) =>
      Array.from({ length: N_TERRACE_STEPS }, (_, k) => k).filter((k) => tierOfStep(k) === t).length
    );
    const overhangTotal = activeBreakSlots.reduce((acc, _, b) => acc + tierBlend.overhang[b + 1], 0);
    const netStepsDepth = Math.max(4, env.depth - 3.16 + overhangTotal);
    const stepDOfTier = stepsPerTier.map((n, t) =>
      n > 0 ? (netStepsDepth * tierBlend.share[t]) / n : 0
    );
    const rawRise = (k: number) => {
      const t = tierOfStep(k);
      return stepDOfTier[t] * tierBlend.slopeTan[t];
    };
    const rawRiseTotal = Array.from({ length: N_TERRACE_STEPS }, (_, k) => rawRise(k)).reduce(
      (a, b) => a + b,
      0
    );
    const targetRise = env.height * (doc.shape === 'steep_cauldron' ? 1.06 : 1.0) - 2.72;
    // Break heights grow when the soffit must clear the sheltered rows; solve the riser scale
    // with them (two passes are enough since the correction is small).
    const breakRise = (scale: number) =>
      activeBreakSlots.reduce((acc, slot) => {
        const lastRise = rawRise(slot - 1) * scale;
        const sheltered = tierBlend.overhang[tierOfStep(slot)] > 0;
        const { loggiaH: baseLoggiaH, fasciaH } = breakDimsOfTier(tierOfStep(slot));
        const loggia = sheltered
          ? Math.max(baseLoggiaH, OVERHANG_HEADROOM_M - lastRise)
          : baseLoggiaH;
        return acc + loggia + fasciaH;
      }, 0);
    let riseScale = Math.max(2, targetRise - breakRise(1)) / Math.max(0.1, rawRiseTotal);
    riseScale = Math.max(2, targetRise - breakRise(riseScale)) / Math.max(0.1, rawRiseTotal);

    // First-row height blended across the stands, like the rest of the section.
    const elevW = sectorWeightsAt(baseSample.nx, baseSample.nz);
    const firstRowY =
      elevW.e * doc.stands.east.elevationStart +
      elevW.s * doc.stands.south.elevationStart +
      elevW.w * doc.stands.west.elevationStart +
      elevW.n * doc.stands.north.elevationStart;
    const pts: [number, number][] = [];
    pts.push([0, 0]);
    pts.push([0, firstRowY + 0.58]);
    pts.push([0.36, firstRowY + 0.58]);
    pts.push([0.36, firstRowY]);

    let curD = 0.36;
    let curY = firstRowY;
    let maxD = curD;
    let lastRise = 0;

    for (let k = 0; k < N_TERRACE_STEPS; k++) {
      if (k === 6 || k === 12 || k === 18 || k === 24) {
        if (activeBreakSlots.includes(k)) {
          const overhang = tierBlend.overhang[tierOfStep(k)];
          const { recess: recOffset, loggiaH: baseLoggiaH, fasciaH } = breakDimsOfTier(tierOfStep(k));
          const overD = Math.max(2.0, curD - overhang);
          const recD = loggiaRecessD(curD, recOffset, overD);
          // The last tread sits one riser below `curY`; keep standing headroom above it.
          const soffitY =
            overhang > 0
              ? Math.max(curY + baseLoggiaH, curY - lastRise + OVERHANG_HEADROOM_M)
              : curY + baseLoggiaH;
          pts.push([recD, curY]);
          pts.push([recD, soffitY]);
          pts.push([overD, soffitY]);
          pts.push([overD, soffitY + fasciaH]);
          maxD = Math.max(maxD, recD);
          curD = overD;
          curY = soffitY + fasciaH;
        } else {
          pts.push([curD, curY]);
          pts.push([curD, curY]);
          pts.push([curD, curY]);
          pts.push([curD, curY]);
        }
      }

      const thisRise = rawRise(k) * riseScale;
      lastRise = thisRise;

      curD += stepDOfTier[tierOfStep(k)];
      maxD = Math.max(maxD, curD);
      pts.push([curD, curY + thisRise * 0.72]);

      curY += thisRise;
      pts.push([curD, curY]);
    }

    const outerD = Math.max(curD, maxD) + 2.8;
    const crestY = curY + 1.8;
    pts.push([outerD, crestY]);
    topCrestPerSlice.push([outerD, crestY]);

    if (isHollow) {
      pts.push([outerD, Math.max(2.4, crestY - 2.3)]);
      pts.push([outerD * 0.52, Math.max(1.5, crestY * 0.44)]);
      pts.push([2.6, 0]);
    } else {
      pts.push([outerD, 0]);
    }

    profilePtsPerSlice.push(pts);
    vipPerSlice.push(tierBlend.hasVip ? 1 : 0);
  }

  // Custom corner cutouts (`open`, `building`, `screen`) when user configures `doc.corners` on a continuous bowl
  const resolvedCorners = resolveAllCorners(doc);
  const hasCustomCornerCutout = (['nw', 'ne', 'sw', 'se'] as CornerId[]).some(
    (cid) => isCornerConfigured(doc, cid) && resolvedCorners[cid] !== 'filled'
  );
  const isSliceInOpenCorner = (s: number): boolean => {
    if (!hasCustomCornerCutout) return false;
    const cid = sliceCornerId[s % ringCount];
    if (!cid) return false;
    return isCornerConfigured(doc, cid) && resolvedCorners[cid] !== 'filled';
  };

  // Breach through the whole ring (Berlin's marathon gate) and gaps through the upper tiers only
  // (Bari's petals), as ring positions of each slice.
  const breach = resolveRingBreach(doc);
  const ringPos = (s: number) => ((sliceT[((s % ringCount) + ringCount) % ringCount] % 1) + 1) % 1;
  const ringDist = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));
  const isSliceInBreach = (s: number): boolean =>
    breach !== null && bowlRing.perimeter > 0 && ringDist(ringPos(s), SIDE_RING_T[breach.side]) * bowlRing.perimeter < breach.width / 2;
  const isSliceCut = (s: number) => isSliceInOpenCorner(s) || isSliceInBreach(s);
  const petals = resolveUpperRingGaps(doc);
  const upperTierSegs = sectionModel?.treadSeg[1]?.length ? sectionModel.treadSeg[1] : null;
  const upperFirstSeg = upperTierSegs ? Math.max(0, Math.min(...upperTierSegs) - 2) : -1;
  const isSliceInPetalGap = (s: number): boolean => {
    if (!petals || !upperTierSegs || bowlRing.perimeter <= 0) return false;
    const pitch = 1 / petals.count;
    const phase = ((ringPos(s) + pitch / 2) % pitch) - pitch / 2;
    return Math.abs(phase) * bowlRing.perimeter < petals.width / 2;
  };
  /** Profile segments of the upper tiers, from the tier break up to the crest. */
  const isUpperSeg = (s: number, p: number) => p >= upperFirstSeg && p < profilePtsPerSlice[s % ringCount].length - (isHollow ? 4 : 2);

  // Map each terrace step `k` (`0..N_TERRACE_STEPS-1`) to its `[treadSegIdx, riserSegIdx]` in `profilePtsPerSlice`
  const stepSegPairs: [number, number][] = [];
  {
    let pCursor = 3; // after front parapet [0..3]
    for (let k = 0; k < N_TERRACE_STEPS; k++) {
      if (k === 6 || k === 12 || k === 18 || k === 24) {
        pCursor += 4;
      }
      stepSegPairs.push([pCursor, pCursor + 1]);
      pCursor += 2;
    }
  }

  // Compute carved vomitory holes & recessed 3D vomitory portals around the bowl sectors
  const bowlHoleMap = new Map<number, Set<number>>();
  const vomPortalMat = new THREE.MeshStandardMaterial({
    color: 0x8b9199,
    roughness: 0.9,
    metalness: 0.02,
  });
  const darkVomMat = new THREE.MeshStandardMaterial({
    color: 0x1a1714,
    roughness: 0.96,
  });
  const vomRailMat = new THREE.MeshStandardMaterial({
    color: 0x9ca3af,
    roughness: 0.28,
    metalness: 0.85,
  });

  const sectorTDefs: { side: StandSide; tCenter: number; halfSpan: number }[] = [
    { side: 'south', tCenter: 0.25, halfSpan: 0.072 },
    { side: 'west', tCenter: 0.5, halfSpan: 0.052 },
    { side: 'north', tCenter: 0.75, halfSpan: 0.072 },
    { side: 'east', tCenter: 0.0, halfSpan: 0.052 },
  ];

  for (const sec of sectorTDefs) {
    if (crossSectionClip && sec.side === 'south') continue;
    if (doc.shape === 'horseshoe' && sec.side === 'east') continue;
    const st = doc.stands[sec.side];
    if (!st.enabled || st.rows <= 0) continue;

    const vomSpec = resolveStandVomitories(st);
    if (vomSpec.count <= 0) continue;

    // Three treads (and their risers) of the lower tier carved out for each vomitory mouth, on
    // one or more rows of openings up the tier.
    const vomLevels: { treads: number[]; positions: number[] }[] = [];
    if (sectionModel) {
      const rowsHere = sectionModel.specs[sec.side].tiers[0]?.rows ?? 0;
      if (rowsHere - 4 < 1) continue;
      const layout = vomitoryLevelLayout(st, rowsHere);
      const share = rowsHere / layout.length;
      layout.forEach((level, k) => {
        const lo = Math.max(1, Math.round(k * share));
        const hi = Math.min(rowsHere - 4, Math.round((k + 1) * share) - 3);
        if (hi < lo) return;
        const rStart = Math.max(lo, Math.min(hi, Math.round((rowsHere - 4) * level.ratio)));
        const treads = [0, 1, 2].map((dr) => sectionModel.treadSeg[0][rStart + dr]);
        vomLevels.push({ treads, positions: level.positions });
      });
    } else {
      // Pick step ranges on the lower/primary tier (`kStart .. kStart + 2`) avoiding break slots `6, 12, 18, 24`
      const maxStep = st.tiers >= 2 ? 10 : N_TERRACE_STEPS - 4;
      const used = new Set<number>();
      for (const level of vomitoryLevelLayout(st, st.tiers >= 2 ? st.rows / st.tiers : st.rows)) {
        let kStart = Math.max(2, Math.min(maxStep, Math.round(maxStep * level.ratio)));
        if (kStart === 5 || kStart === 6) kStart = 7;
        if ([...used].some((k) => Math.abs(k - kStart) < 4)) continue;
        used.add(kStart);
        const treads: number[] = [];
        for (let dk = 0; dk < 3 && kStart + dk < N_TERRACE_STEPS; dk++) treads.push(stepSegPairs[kStart + dk][0]);
        vomLevels.push({ treads, positions: level.positions });
      }
    }

    for (const { treads: vomTreads, positions } of vomLevels) {
      const segSet = new Set<number>();
      for (const tSeg of vomTreads) {
        segSet.add(tSeg);
        segSet.add(tSeg + 1);
      }

      for (const pos of positions) {
        const frac = pos - 0.5;
        let tTarget = sec.tCenter + frac * (sec.halfSpan * 2);
        tTarget = ((tTarget % 1) + 1) % 1;

        // Find nearest active slice
        let bestS = -1;
        let bestDist = 999;
        for (let s = 0; s < activeSegments; s++) {
          const ts = ((tAtSlice(s) % 1) + 1) % 1;
          let diff = Math.abs(ts - tTarget);
          if (diff > 0.5) diff = 1 - diff;
          if (diff < bestDist) {
            bestDist = diff;
            bestS = s;
          }
        }
        if (bestS < 0 || bestDist > 0.025 || isSliceInOpenCorner(bestS)) continue;

        let existing = bowlHoleMap.get(bestS);
        if (!existing) {
          existing = new Set<number>();
          bowlHoleMap.set(bestS, existing);
        }
        for (const segId of segSet) existing.add(segId);

        // Place 3D recessed vomitory portal centered on slice `bestS` -> `nextS`
        const nextS = closed ? (bestS + 1) % ringCount : Math.min(ringCount - 1, bestS + 1);
        const tMid = 0.5 * (tAtSlice(bestS) + tAtSlice(nextS));
        // Foot of the first tread, top of the last riser.
        const pStart = profilePtsPerSlice[bestS][vomTreads[0]];
        const pEnd = profilePtsPerSlice[bestS][vomTreads[vomTreads.length - 1] + 2];
        if (pStart && pEnd) {
          const ptA = sampleRoundedBowlRing(bowlRing, tAtSlice(bestS), pStart[0]);
          const ptB = sampleRoundedBowlRing(bowlRing, tAtSlice(nextS), pStart[0]);
          const chordW = Math.max(1.8, Math.hypot(ptB.x - ptA.x, ptB.z - ptA.z) * 0.94);
          const openD = Math.max(1.6, pEnd[0] - pStart[0]);
          const openH = Math.max(1.4, pEnd[1] - pStart[1]);
          const midPt = sampleRoundedBowlRing(bowlRing, tMid, pStart[0]);

          const portal = createCarvedVomitoryTunnel(
            chordW,
            openD,
            openH,
            vomPortalMat,
            darkVomMat,
            vomRailMat,
            doc.lighting !== 'day'
          );
          portal.position.set(midPt.x, pStart[1], midPt.z);
          portal.rotation.y = Math.atan2(midPt.nx, midPt.nz);
          group.add(portal);
        }
      }
    }
  }

  // Vehicle accesses: a tunnel under each seated corner given one.
  const bowlSwept: SweptStand = {
    sliceCount: ringCount,
    closed,
    profiles: profilePtsPerSlice,
    world: (sl, radD, py) => {
      const pt = sampleRoundedBowlRing(bowlRing, tAtSlice(sl), radD);
      return [pt.x, py, pt.z];
    },
  };
  const bowlTunnels: CornerTunnelPlan[] = [];
  {
    const starts = ringSegmentStarts(bowlRing);
    const cornerSeg: Record<CornerId, number> = { se: 1, sw: 3, nw: 5, ne: 7 };
    for (const cid of ['se', 'sw', 'nw', 'ne'] as CornerId[]) {
      if (!doc.cornerAccess?.[cid]) continue;
      if (doc.shape === 'horseshoe' && (cid === 'se' || cid === 'ne')) continue;
      if (crossSectionClip && (cid === 'se' || cid === 'sw')) continue;
      const mode = isCornerConfigured(doc, cid) ? resolvedCorners[cid] : 'filled';
      const tMid = (starts[cornerSeg[cid]] + starts[cornerSeg[cid] + 1]) / 2;
      const front = sampleRoundedBowlRing(bowlRing, tMid, 0);
      if (mode === 'filled') {
        const plan = planCornerTunnel(bowlSwept, front);
        if (plan) {
          bowlTunnels.push(plan);
          group.add(buildCornerTunnel(bowlSwept, plan, concreteMat, doc.lighting !== 'day'));
        }
      }
    }
  }
  const isTunnelSlice = (s: number) => bowlTunnels.some((plan) => isTunnelBay(plan, s));

  // Dugouts and press boxes at the middle of each stand's side of the ring.
  const sideCentreT: Record<StandSide, number> = { east: 0, south: 0.25, west: 0.5, north: 0.75 };
  const sideNormal: Record<StandSide, [number, number]> = {
    east: [1, 0],
    south: [0, 1],
    west: [-1, 0],
    north: [0, -1],
  };
  const bowlPresses: { side: StandSide; segs: Set<number>; half: number }[] = [];
  const bowlPressPlaces: PressPlace[] = [];
  for (const side of ['east', 'south', 'west', 'north'] as StandSide[]) {
    const st = doc.stands[side];
    if (!st.enabled || st.rows <= 0) continue;
    if (doc.shape === 'horseshoe' && side === 'east') continue;
    if (crossSectionClip && side === 'south') continue;
    const tc = sideCentreT[side];
    if (st.dugouts && bowlRing.perimeter > 0) {
      for (const sx of [-1, 1]) {
        const pt = sampleRoundedBowlRing(bowlRing, tc + (sx * DUGOUT_OFFSET) / bowlRing.perimeter, 0);
        const dugout = buildDugout(doc.lighting !== 'day');
        dugout.position.set(pt.x, 0, pt.z);
        dugout.rotation.y = Math.atan2(pt.nx, pt.nz);
        group.add(dugout);
      }
    }
    if (st.pressBox && sectionModel && st.seatingType !== 'safe_standing' && bowlRing.perimeter > 0) {
      const sideLen = side === 'east' || side === 'west' ? safePitch.width : safePitch.length;
      const half = pressBoxLength(st, sideLen * 0.9) / 2;
      const tierCount = sectionModel.specs[side].tiers.length;
      const pressTier = pressBoxTier(st, tierCount);
      const tierRows = sectionModel.specs[side].tiers[pressTier]?.rows ?? 0;
      const [r0, r1] = pressRowRange(tierRows, pressTier, tierCount, st);
      const segs = new Set<number>();
      const dt = half / bowlRing.perimeter;
      const count = Math.max(2, Math.round((2 * half) / PRESS_PITCH));
      for (let r = r0; r < r1; r++) {
        const p = sectionModel.treadSeg[pressTier]?.[r];
        if (p === undefined) continue;
        segs.add(p);
        const section = bowlSectionAt(
          sectionModel,
          bowlMixAtT(sectionModel, bowlRing, tc, sideNormal[side][1])
        );
        const [d, y] = section.pts[p];
        for (let k = 0; k < count; k++) {
          const t = tc - dt + ((k + 0.5) / count) * 2 * dt;
          const pt = sampleRoundedBowlRing(bowlRing, t, d);
          bowlPressPlaces.push({ x: pt.x, y, z: pt.z, yaw: Math.atan2(pt.nx, pt.nz) });
        }
      }
      bowlPresses.push({ side, segs, half });
    }
  }
  {
    const desks = buildPressDesks(bowlPressPlaces, doc.lighting !== 'day');
    if (desks) group.add(desks);
  }
  const skipBowlSeat = (pos: THREE.Vector3, p: number) =>
    bowlPresses.some(({ side, segs, half }) => {
      if (!segs.has(p)) return false;
      const [nx, nz] = sideNormal[side];
      const outward = pos.x * nx + pos.z * nz;
      const along = Math.abs(pos.x * nz - pos.z * nx);
      return outward > 0 && along < half;
    });

  const isBowlQuadHole = (s: number, p: number): boolean => {
    const nextS = closed ? (s + 1) % ringCount : s + 1;
    if (isSliceCut(s) || isSliceCut(nextS)) {
      return true;
    }
    if ((isSliceInPetalGap(s) || isSliceInPetalGap(nextS)) && isUpperSeg(s, p)) return true;
    if (bowlTunnels.some((plan) => isTunnelQuad(plan, s, p))) return true;
    const set = bowlHoleMap.get(s);
    return set ? set.has(p) : false;
  };

  const bowlGeo = buildMultiMaterialSweptStandGeometry(
    ringCount,
    activeSegments,
    closed,
    profilePtsPerSlice,
    (s, radD, py) => {
      const pt = sampleRoundedBowlRing(bowlRing, tAtSlice(s), radD);
      return [pt.x, py, pt.z];
    },
    isSeatSegmentMask,
    Math.max(10, Math.round(18 * arcFraction)),
    2.2,
    isBowlQuadHole
  );

  const seatMat = createSeatTerracePbrMaterial(
    mats.seatFinish,
    doc.colors.seatsPrimary,
    doc.colors.seatsSecondary,
    Math.max(8, doc.stands.south.aisleCount),
    maxAnisotropy,
    true
  );

  const bowlSeats3d = resolveSeats3d(mats);
  const bowlMesh = new THREE.Mesh(bowlGeo, [concreteMat, bowlSeats3d ? concreteMat : seatMat]);
  bowlMesh.castShadow = true;
  bowlMesh.receiveShadow = true;
  group.add(bowlMesh);

  const bowlDetails = buildStandDetails({
    ringCount,
    activeSegments,
    closed,
    profilePtsPerSlice,
    sampleWorldPoint: (s, radD, py) => {
      const pt = sampleRoundedBowlRing(bowlRing, tAtSlice(s), radD);
      return [pt.x, py, pt.z];
    },
    isSeatSegmentMask,
    isHoleQuad: isBowlQuadHole,
    aisleCount: Math.max(8, doc.stands.south.aisleCount * 4),
    aisleWidth: doc.stands.south.aisleWidth,
    lit: doc.lighting !== 'day',
  });
  if (bowlDetails) group.add(bowlDetails);

  if (bowlSeats3d) {
    const refStand = doc.stands.south;
    // Quarters of the ring from t = 0: east, south, west, north.
    const bowlPainters: SeatPainter[] = (['east', 'south', 'west', 'north'] as StandSide[]).map((side) =>
      createStandSeatPainter(doc, doc.stands[side])
    );
    const seats = buildSweepSeatInstances({
      ringCount,
      activeSegments,
      closed,
      profilePtsPerSlice,
      sampleWorldPoint: (s, radD, py) => {
        const pt = sampleRoundedBowlRing(bowlRing, tAtSlice(s), radD);
        return [pt.x, py, pt.z];
      },
      isSeatSegmentMask,
      rowDepth: refStand.rowDepth,
      seatWidth: refStand.seatWidth,
      aisleCount: Math.max(8, refStand.aisleCount * 4),
      aisleWidth: refStand.aisleWidth,
      primaryHex: doc.colors.seatsPrimary,
      secondaryHex: doc.colors.seatsSecondary,
      isHoleQuad: isBowlQuadHole,
      skipSeat: bowlPresses.length > 0 ? skipBowlSeat : undefined,
      rowPerTread: sectionModel !== null,
      attendance: resolveCrowdAttendance(mats),
      paint: (seat, out) => {
        // The stand whose quarter of the ring the seat is in; t grows to a spectator's right.
        const t = tAtSlice(seat.slice + seat.sliceFrac);
        const quarter = ((Math.round(t * 4) % 4) + 4) % 4;
        const offset = t - quarter / 4;
        const local = offset - Math.round(offset);
        return bowlPainters[quarter](
          seat.tier,
          { ...seat, u: local * 4 + 0.5, rowLength: seat.rowLength / 4 },
          out
        );
      },
    });
    if (seats) group.add(seats);
  }

  // Walls closing the ring where it is cut: a breach through all of it, a petal gap above the
  // tier break (the cap then runs from the break up to the crest).
  if (breach || petals) {
    const capMat = concreteMat.clone();
    capMat.side = THREE.DoubleSide;
    const capAt = (idx: number, pts2d: [number, number][]) => {
      const shape = new THREE.Shape();
      shape.moveTo(pts2d[0][0], pts2d[0][1]);
      for (let i = 1; i < pts2d.length; i++) shape.lineTo(pts2d[i][0], pts2d[i][1]);
      shape.closePath();
      const geo = new THREE.ShapeGeometry(shape);
      const pos = geo.attributes.position;
      const t = tAtSlice(idx);
      for (let i = 0; i < pos.count; i++) {
        const w = sampleRoundedBowlRing(bowlRing, t, pos.getX(i));
        pos.setXYZ(i, w.x, pos.getY(i), w.z);
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, capMat);
      mesh.castShadow = true;
      group.add(mesh);
    };
    for (let s = 0; s < activeSegments; s++) {
      const nextS = closed ? (s + 1) % ringCount : s + 1;
      if (breach && !hasCustomCornerCutout && isSliceCut(s) !== isSliceCut(nextS)) {
        const idx = isSliceCut(s) ? nextS : s;
        capAt(idx, profilePtsPerSlice[idx]);
      }
      if (petals && isSliceInPetalGap(s) !== isSliceInPetalGap(nextS) && !isSliceCut(s) && !isSliceCut(nextS)) {
        const idx = isSliceInPetalGap(s) ? nextS : s;
        const pts2d = profilePtsPerSlice[idx];
        const top = pts2d.length - (isHollow ? 4 : 2);
        const upper = pts2d.slice(upperFirstSeg, top + 1);
        // Down the back to the foot of the break, so the cap closes the petal's hollow end.
        const back = pts2d[top];
        capAt(idx, [...upper, [back[0], pts2d[upperFirstSeg][1]]]);
      }
    }
  }

  // When a continuous bowl has custom non-filled corners (`open`, `building`, `screen`), cap cut ends & build corner inserts!
  if (hasCustomCornerCutout) {
    const capWallMat = concreteMat.clone();
    capWallMat.side = THREE.DoubleSide;
    for (let s = 0; s < activeSegments; s++) {
      const nextS = closed ? (s + 1) % ringCount : s + 1;
      const openCur = isSliceCut(s);
      const openNxt = isSliceCut(nextS);
      if (openCur !== openNxt) {
        const boundaryIdx = openCur ? nextS : s;
        const pts2d = profilePtsPerSlice[boundaryIdx];
        const capShape = new THREE.Shape();
        capShape.moveTo(pts2d[0][0], pts2d[0][1]);
        for (let i = 1; i < pts2d.length; i++) {
          capShape.lineTo(pts2d[i][0], pts2d[i][1]);
        }
        capShape.closePath();
        const capGeo = new THREE.ShapeGeometry(capShape);
        const posAttr = capGeo.attributes.position;
        const tCap = tAtSlice(boundaryIdx);
        for (let i = 0; i < posAttr.count; i++) {
          const radD = posAttr.getX(i);
          const py = posAttr.getY(i);
          const wPt = sampleRoundedBowlRing(bowlRing, tCap, radD);
          posAttr.setXYZ(i, wPt.x, py, wPt.z);
        }
        capGeo.computeVertexNormals();
        const capMesh = new THREE.Mesh(capGeo, capWallMat);
        capMesh.castShadow = true;
        group.add(capMesh);
      }
    }

    const cornerLayout = computeRectangularCornerLayout({
      shape: 'compact_urban',
      cornerFill: true,
      cornerModes: resolvedCorners,
      crossSectionClip,
      pitchLength: safePitch.length,
      pitchWidth: safePitch.width,
      endTrackOffset: trackOffsets.endOffset,
      sideTrackOffset: trackOffsets.sideOffset,
      stands: doc.stands,
    });
    const cFacadeMat = createFacadePbrMaterial(mats.facade, doc.lighting, false, maxAnisotropy, mats.facadeGlowHex);
    const cStructMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);

    for (const cid of ['se', 'sw', 'nw', 'ne'] as CornerId[]) {
      if (!isCornerConfigured(doc, cid)) continue;
      const spec = cornerLayout.corners[cid];
      if (!spec.active) continue;
      if (doc.shape === 'horseshoe' && (cid === 'se' || cid === 'ne')) continue;
      const build = CORNER_STRUCTURES[spec.mode];
      if (build) {
        group.add(
          build({
            doc,
            corner: spec,
            section: (side) => buildStandProfilePoints(doc.stands[side], false),
            concreteMat,
            facadeMat: cFacadeMat,
            structureMat: cStructMat,
            turnstileTex,
          })
        );
      }
    }
  }

  // Continuous Pitch-Side Laminated Glass Safety Balustrade around the swept bowl front parapet
  if (doc.frontFence === 'mesh') {
    // Wire fence on the front wall, broken where a tunnel deck interrupts it.
    const runs: { points: THREE.Vector3[]; inward: THREE.Vector3[] }[] = [];
    let cur: { points: THREE.Vector3[]; inward: THREE.Vector3[] } | null = null;
    const pushSlice = (sl: number) => {
      const gp = sampleRoundedBowlRing(bowlRing, tAtSlice(sl), 0.12);
      cur!.points.push(new THREE.Vector3(gp.x, profilePtsPerSlice[sl][1][1], gp.z));
      cur!.inward.push(new THREE.Vector3(-gp.nx, 0, -gp.nz));
    };
    for (let sl = 0; sl < activeSegments; sl++) {
      if (isTunnelSlice(sl)) {
        cur = null;
        continue;
      }
      const nxt = closed ? (sl + 1) % ringCount : sl + 1;
      if (!cur) {
        cur = { points: [], inward: [] };
        runs.push(cur);
        pushSlice(sl);
      }
      pushSlice(nxt);
    }
    group.add(buildWireFence(runs, resolveFenceHeight(doc.frontFenceHeight)));
  }
  const bowlGlassPos = new Float32Array(ringCount * 2 * 3);
  const bowlGlassIdx: number[] = [];
  for (let s = 0; s < ringCount; s++) {
    const gp = sampleRoundedBowlRing(bowlRing, tAtSlice(s), 0.18);
    // On top of the front parapet, whatever the first row's height.
    const parapetY = profilePtsPerSlice[s][1][1];
    const b = s * 6;
    bowlGlassPos[b] = gp.x;
    bowlGlassPos[b + 1] = parapetY;
    bowlGlassPos[b + 2] = gp.z;
    bowlGlassPos[b + 3] = gp.x;
    bowlGlassPos[b + 4] = parapetY + 0.68;
    bowlGlassPos[b + 5] = gp.z;
  }
  for (let s = 0; s < activeSegments; s++) {
    // The tunnel deck carries its own parapet; a wire fence replaces the glass.
    if (isTunnelSlice(s) || doc.frontFence === 'mesh') continue;
    const nxt = closed ? (s + 1) % ringCount : s + 1;
    const a = s * 2;
    const b = nxt * 2;
    const c = nxt * 2 + 1;
    const d = s * 2 + 1;
    bowlGlassIdx.push(a, d, b, b, d, c);
  }
  const bowlGlassGeo = new THREE.BufferGeometry();
  bowlGlassGeo.setAttribute('position', new THREE.BufferAttribute(bowlGlassPos, 3));
  bowlGlassGeo.setIndex(bowlGlassIdx);
  bowlGlassGeo.computeVertexNormals();
  group.add(
    new THREE.Mesh(
      bowlGlassGeo,
      new THREE.MeshPhysicalMaterial({
        color: 0xe0f2fe,
        roughness: 0.08,
        metalness: 0.1,
        clearcoat: 0.95,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
      })
    )
  );

  // Safe Standing Barrier Rails along standing sectors on swept bowls
  const railSteelMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.28,
    metalness: 0.85,
  });
  // Crush barriers every few rows of the lower tier (profile point at the foot of a tread).
  const railPointIdx = sectionModel
    ? sectionModel.treadSeg[0].filter((_, r) => r % 6 === 5)
    : [8, 14, 22, 30, 38, 46, 56, 66];
  for (const stepIdx of railPointIdx) {
    let runPts: THREE.Vector3[] = [];
    const flushRail = () => {
      if (runPts.length >= 3) {
        const curve = new THREE.CatmullRomCurve3(runPts, false);
        group.add(
          new THREE.Mesh(
            new THREE.TubeGeometry(curve, runPts.length * 2, 0.055, 5, false),
            railSteelMat
          )
        );
      }
      runPts = [];
    };
    for (let s = 0; s < ringCount; s++) {
      const t = tAtSlice(s);
      const baseS = sampleRoundedBowlRing(bowlRing, t, 0);
      const domSide = dominantSideAt(baseS.nx, baseS.nz);
      const st = doc.stands[domSide];
      const inStandingZone =
        st.enabled &&
        st.seatingType === 'safe_standing' &&
        (sectionModel ? true : st.tiers === 1 || stepIdx <= 24);
      // A row that has ended in the corner carries no barrier.
      const rowHere =
        !sectionModel || profilePtsPerSlice[s][stepIdx + 1][0] - profilePtsPerSlice[s][stepIdx][0] > 0.3;
      const overTunnel =
        isTunnelSlice(s) && profilePtsPerSlice[s][stepIdx]?.[1] < CORNER_ACCESS_DECK_Y;
      if (inStandingZone && rowHere && !overTunnel && stepIdx < profilePtsPerSlice[s].length - 5) {
        const [rd, ry] = profilePtsPerSlice[s][stepIdx];
        const wp = sampleRoundedBowlRing(bowlRing, t, rd - 0.12);
        runPts.push(new THREE.Vector3(wp.x, ry + 0.55, wp.z));
      } else {
        flushRail();
      }
    }
    flushRail();
  }

  // Telescopic Pitch-Side Lower Modules on swept bowls (e.g. athletics oval or multipurpose arena)
  const bowlTeleSides: { side: StandSide; rotY: number; isSide: boolean; sign: number }[] = [
    { side: 'south', rotY: 0, isSide: true, sign: 1 },
    { side: 'north', rotY: Math.PI, isSide: true, sign: -1 },
    { side: 'west', rotY: -Math.PI / 2, isSide: false, sign: -1 },
    { side: 'east', rotY: Math.PI / 2, isSide: false, sign: 1 },
  ];
  for (const bts of bowlTeleSides) {
    if (crossSectionClip && bts.side === 'south') continue;
    if (doc.shape === 'horseshoe' && bts.side === 'east') continue;
    const tele = computeTelescopicProjection(doc, bts.side);
    if (tele.extraRows > 0 && tele.advanceMeters > 0) {
      const span = bts.isSide
        ? Math.max(28, bowlRing.halfStraightX * 1.85)
        : Math.max(20, bowlRing.halfStraightZ * 1.85);
      const sampleT =
        bts.side === 'east'
          ? 0
          : bts.side === 'south'
          ? 0.25
          : bts.side === 'west'
          ? 0.5
          : 0.75;
      const anchor = sampleRoundedBowlRing(bowlRing, sampleT, 0);
      const mod = buildStraightTelescopicModule(
        span,
        tele.extraRows,
        tele.advanceMeters,
        0.92,
        seatMat
      );
      mod.position.set(anchor.x, 0, anchor.z);
      mod.rotation.y = bts.rotY;
      group.add(mod);
    }
  }

  // Solid Concrete Gable End-Walls when open-ended (`horseshoe` U-tips or 3D cross-section cut)
  if (!closed) {
    for (const endSliceIdx of [0, ringCount - 1]) {
      const pts2d = profilePtsPerSlice[endSliceIdx];
      const capShape = new THREE.Shape();
      capShape.moveTo(pts2d[0][0], pts2d[0][1]);
      for (let i = 1; i < pts2d.length; i++) {
        capShape.lineTo(pts2d[i][0], pts2d[i][1]);
      }
      capShape.closePath();

      const capGeo = new THREE.ShapeGeometry(capShape);
      const posAttr = capGeo.attributes.position;
      const uvAttr = capGeo.attributes.uv;
      const tCap = tAtSlice(endSliceIdx);
      for (let i = 0; i < posAttr.count; i++) {
        const radD = posAttr.getX(i);
        const py = posAttr.getY(i);
        const wPt = sampleRoundedBowlRing(bowlRing, tCap, radD);
        posAttr.setXYZ(i, wPt.x, py, wPt.z);
        if (uvAttr) uvAttr.setXY(i, radD * 0.08, py * 0.08);
      }
      capGeo.computeVertexNormals();
      const capWallMat = concreteMat.clone();
      capWallMat.side = THREE.DoubleSide;
      const capMesh = new THREE.Mesh(capGeo, capWallMat);
      capMesh.castShadow = true;
      group.add(capMesh);
    }
  }

  // Open East Panoramic Concourse & Plaza Terrace for `horseshoe`
  if (doc.shape === 'horseshoe' && !crossSectionClip) {
    const eastEdgeX = bowlRing.halfStraightX + bowlRing.cornerRadius + 1.2;
    const terraceSpanZ = (bowlRing.halfStraightZ + bowlRing.cornerRadius) * 1.45;
    const podiumDeck = new THREE.Mesh(
      new THREE.BoxGeometry(11, 1.35, terraceSpanZ),
      concreteMat
    );
    podiumDeck.position.set(eastEdgeX + 5.5, 0.675, 0);
    podiumDeck.receiveShadow = true;
    podiumDeck.castShadow = true;
    group.add(podiumDeck);

    const glassBalustrade = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 1.15, terraceSpanZ - 1.2),
      new THREE.MeshPhysicalMaterial({
        color: 0xbae6fd,
        transparent: true,
        opacity: 0.55,
        roughness: 0.08,
        clearcoat: 0.9,
      })
    );
    glassBalustrade.position.set(eastEdgeX + 0.35, 1.9, 0);
    group.add(glassBalustrade);
  }

  // Cantilevered Balcony Fascias, LED Ribbons & Optional Glazed VIP Skyboxes
  const whiteFasciaMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    roughness: 0.3,
    metalness: 0.2,
  });
  const ledFasciaMat = createLedFasciaMaterial(doc.lighting === 'day');

  // First point of each balcony break (loggia foot); its fascia top is three points on.
  const slotStartIndices = sectionModel
    ? sectionModel.breakStart.filter((i) => i !== undefined)
    : [16, 32, 48, 64];

  for (const baseIdx of slotStartIndices) {
    let runFascia: THREE.Vector3[] = [];
    let runGlass: THREE.Vector3[] = [];
    let runGlassIn: THREE.Vector3[] = [];
    let runGlassBot: number[] = [];
    let runGlassTop: number[] = [];
    const resetGlass = () => {
      runGlass = [];
      runGlassIn = [];
      runGlassBot = [];
      runGlassTop = [];
    };

    const flushBalconyRun = (looped: boolean) => {
      if (runFascia.length < 3) {
        runFascia = [];
        resetGlass();
        return;
      }
      const fCurve = new THREE.CatmullRomCurve3(
        runFascia,
        looped,
        doc.shape === 'octagonal_arena' ? 'centripetal' : 'catmullrom',
        doc.shape === 'octagonal_arena' ? 0.05 : 0.5
      );
      group.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(fCurve, Math.max(16, runFascia.length * 2), 0.4, 6, looped),
          whiteFasciaMat
        )
      );

      // Band sits just pitch-side of the fascia tube (radius 0.4), toward the bowl centre.
      const ledCentres = fCurve
        .getPoints(Math.max(16, runFascia.length * 2))
        .map((p) => {
          const inward = new THREE.Vector3(-p.x, 0, -p.z).normalize().multiplyScalar(0.44);
          return p.clone().add(inward);
        });
      group.add(buildLedFasciaBand(ledCentres, 0.88, ledFasciaMat));

      // A full ring of boxes loops only when every slice of it is glazed.
      const glazing = buildSkyboxGlazing(
        {
          line: runGlass,
          bottomY: runGlassBot,
          topY: runGlassTop,
          inward: runGlassIn,
          closed: looped && runGlass.length === runFascia.length,
        },
        doc.lighting !== 'day'
      );
      if (glazing) group.add(glazing);

      runFascia = [];
      resetGlass();
    };

    let fullRingActive = closed;
    for (let s = 0; s < ringCount; s++) {
      const pts = profilePtsPerSlice[s];
      const recBot = pts[baseIdx];
      const overTop = pts[baseIdx + 3];
      const hDiff = overTop[1] - recBot[1];
      const isActiveSlot = hDiff > 0.5;

      if (isActiveSlot) {
        const t = tAtSlice(s);
        const fPt = sampleRoundedBowlRing(bowlRing, t, overTop[0] - 0.12);
        runFascia.push(new THREE.Vector3(fPt.x, overTop[1] - 0.35, fPt.z));
        if (vipPerSlice[s] >= 0.5 && pts[baseIdx + 1][1] - recBot[1] > 1.6) {
          const gPt = sampleRoundedBowlRing(bowlRing, t, recBot[0] - 0.15);
          const gIn = sampleRoundedBowlRing(bowlRing, t, recBot[0] + 0.85);
          runGlass.push(new THREE.Vector3(gPt.x, 0, gPt.z));
          runGlassIn.push(new THREE.Vector3(gIn.x - gPt.x, 0, gIn.z - gPt.z).normalize());
          runGlassBot.push(recBot[1] + 0.08);
          runGlassTop.push(pts[baseIdx + 1][1] - 0.08);
        }
      } else {
        fullRingActive = false;
        flushBalconyRun(false);
      }
    }
    flushBalconyRun(fullRingActive);
  }

  // Players' Tunnel on South Side
  if (!crossSectionClip && doc.stands.south.enabled) {
    const southSample = sampleRoundedBowlRing(bowlRing, 0.25, 0.2);
    const tunnel = createPlayersTunnelPortal();
    tunnel.position.set(southSample.x, 0, southSample.z);
    group.add(tunnel);
  }

  // Sunken Amphitheatre Berm & Elevated Concourse Esplanade (`sunkenDepth > 0`)
  const avgOuterDepth =
    topCrestPerSlice.reduce((acc, tc) => acc + tc[0], 0) /
    Math.max(1, topCrestPerSlice.length);

  if (sunkenDepth > 0.5) {
    group.add(
      buildSunkenAmphitheatreBerm(
        doc,
        bowlRing,
        avgOuterDepth,
        sunkenDepth,
        crossSectionClip,
        concreteMat,
        maxAnisotropy
      )
    );
  }

  // Exterior envelope around the bowl, interrupted where a corner is left open.
  const facadeMat = createFacadePbrMaterial(
    mats.facade,
    doc.lighting,
    doc.shape === 'octagonal_arena',
    maxAnisotropy,
    mats.facadeGlowHex
  );
  const structureMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const bowlRail = topCrestPerSlice.map(([outerD, crestY], s) => {
    if (isSliceInOpenCorner(s)) return null;
    const pt = sampleRoundedBowlRing(bowlRing, tAtSlice(s), outerD);
    return {
      x: pt.x,
      z: pt.z,
      nx: pt.nx,
      nz: pt.nz,
      yBottom: facadeGradeY(sunkenDepth, crestY),
      yTop: crestY,
      depth: outerD,
    };
  });
  // Quarters of the ring from t = 0: east, south, west, north (as the seats). A stand with its own
  // envelope or cladding gets its quarter of the facade; the others share one rail.
  const quarterSides: StandSide[] = ['east', 'south', 'west', 'north'];
  const ownFacades = quarterSides.some((side) => hasOwnFacade(doc.stands[side]));
  const quarterOf = (s: number) => ((Math.round(tAtSlice(s) * 4) % 4) + 4) % 4;
  const facadeRuns: { samples: (typeof bowlRail)[number][]; closed: boolean; side?: StandSide }[] = [];
  if (!ownFacades) facadeRuns.push({ samples: bowlRail, closed });
  else {
    for (let q = 0; q < 4; q++) {
      // Each quarter keeps the first sample of the next one so the facade stays continuous.
      const samples = bowlRail.map((pt, s) =>
        quarterOf(s) === q || quarterOf((s - 1 + bowlRail.length) % bowlRail.length) === q ? pt : null
      );
      facadeRuns.push({ samples, closed: false, side: quarterSides[q] });
    }
  }
  for (const facadeRun of facadeRuns) {
    const stand = facadeRun.side ? doc.stands[facadeRun.side] : undefined;
    const runFacadeMat =
      stand && hasOwnFacade(stand)
        ? createFacadePbrMaterial(
            resolveStandFacade(doc, stand).facade,
            doc.lighting,
            doc.shape === 'octagonal_arena',
            maxAnisotropy,
            mats.facadeGlowHex
          )
        : facadeMat;
    for (const run of splitRail(facadeRun.samples, facadeRun.closed)) {
      group.add(
        buildStandEnvelope({
          doc,
          rail: run.samples,
          closed: run.closed,
          stand,
          facadeMat: runFacadeMat,
          structureMat,
          concreteMat,
          turnstileTex,
          skinAccent:
            doc.shape === 'steep_cauldron' ? 'piers' : doc.shape === 'olympic_oval' ? 'bands' : undefined,
          name: facadeRun.side ? `BowlEnvelope_${facadeRun.side}` : 'BowlEnvelope',
        })
      );
    }
  }
  return group;
}

export function generateStandsGroup(
  doc: StadiumDocument,
  crossSectionClip: boolean = false,
  maxAnisotropy: number = 4
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'StandsAssembly';
  resetVomitorySigns();

  const mats = resolveStadiumMaterials(doc);
  const concreteMat = createConcreteBowlMaterial(maxAnisotropy);
  const turnstileTex = createConcourseTurnstileTexture(doc.lighting !== 'day');

  if (isContinuousBowlShape(doc.shape)) {
    root.add(
      buildModernBowlSweep(
        doc,
        crossSectionClip,
        concreteMat,
        turnstileTex,
        maxAnisotropy
      )
    );
    return root;
  }

  const trackOffsets = getTrackRadialOffset(doc);
  const facadeMat = createFacadePbrMaterial(
    mats.facade,
    doc.lighting,
    false,
    maxAnisotropy,
    mats.facadeGlowHex
  );
  const structureMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);

  const safePitch = clampPitchToTrack(doc.pitch);
  const rectLayout = stadiumCornerLayout(doc, crossSectionClip, resolveCornerFollow(doc));

  const sides: StandSide[] = ['north', 'south', 'east', 'west'];

  for (const side of sides) {
    if (crossSectionClip && side === 'south') {
      continue;
    }

    const stand = doc.stands[side];
    if (!stand.enabled || stand.rows <= 0) continue;

    const spanSpec = rectLayout.straight[side];

    const seatMat = createSeatTerracePbrMaterial(
      mats.seatFinish,
      doc.colors.seatsPrimary,
      doc.colors.seatsSecondary,
      Math.max(4, Math.round(stand.aisleCount * 0.5)),
      maxAnisotropy,
      false
    );

    const standMesh = buildStraightStandMesh(
      stand,
      spanSpec.span,
      spanSpec.capNegLocalX,
      spanSpec.capPosLocalX,
      doc,
      seatMat,
      concreteMat,
      hasOwnFacade(stand)
        ? createFacadePbrMaterial(resolveStandFacade(doc, stand).facade, doc.lighting, false, maxAnisotropy, mats.facadeGlowHex)
        : facadeMat,
      stand.structureMaterialOverride && stand.structureMaterialOverride !== 'inherit'
        ? createStructurePbrMaterial(stand.structureMaterialOverride, maxAnisotropy)
        : structureMat,
      turnstileTex
    );

    standMesh.name = `Stand_${side.toUpperCase()}`;

    if (side === 'south') {
      standMesh.position.set(spanSpec.centerCoord, 0, spanSpec.frontDist);
      standMesh.rotation.set(0, 0, 0);
    } else if (side === 'north') {
      standMesh.position.set(spanSpec.centerCoord, 0, -spanSpec.frontDist);
      standMesh.rotation.set(0, Math.PI, 0);
    } else if (side === 'east') {
      standMesh.position.set(spanSpec.frontDist, 0, spanSpec.centerCoord);
      standMesh.rotation.set(0, Math.PI / 2, 0);
    } else if (side === 'west') {
      standMesh.position.set(-spanSpec.frontDist, 0, spanSpec.centerCoord);
      standMesh.rotation.set(0, -Math.PI / 2, 0);
    }

    root.add(standMesh);
  }

  const cornerOrder: CornerQuadrantId[] = ['se', 'sw', 'nw', 'ne'];
  let cornerSeatMat: THREE.MeshPhysicalMaterial | null = null;
  for (const cId of cornerOrder) {
    const cornerSpec = rectLayout.corners[cId];
    if (!cornerSpec.active) continue;

    if (cornerSpec.mode === 'filled') {
      cornerSeatMat ??= createSeatTerracePbrMaterial(
        mats.seatFinish,
        doc.colors.seatsPrimary,
        doc.colors.seatsSecondary,
        4,
        maxAnisotropy,
        false
      );
      root.add(
        buildCornerVirageQuadrant(
          cornerSpec,
          doc,
          cornerSeatMat,
          concreteMat,
          facadeMat,
          structureMat,
          turnstileTex
        )
      );
    } else {
      const build = CORNER_STRUCTURES[cornerSpec.mode];
      if (build) {
        root.add(
          build({
            doc,
            corner: cornerSpec,
            section: (side) => buildStandProfilePoints(doc.stands[side], false),
            concreteMat,
            facadeMat,
            structureMat,
            turnstileTex,
          })
        );
      }
    }
  }

  // Sunken berm on rectangular / 4-stand stadiums if user explicitly sets `sunkenDepth > 0.5`
  const sunkenRect = getEffectiveSunkenDepth(doc);
  if (sunkenRect > 0.5) {
    const avgDistX =
      (doc.stands.east.distanceToPitch + doc.stands.west.distanceToPitch) * 0.5;
    const avgDistZ =
      (doc.stands.north.distanceToPitch + doc.stands.south.distanceToPitch) * 0.5;
    const rectRing = buildShapeBowlRing(
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
    const maxD = Math.max(
      buildStandProfilePoints(doc.stands.south).totalDepth,
      buildStandProfilePoints(doc.stands.north).totalDepth,
      20
    );
    root.add(
      buildSunkenAmphitheatreBerm(
        doc,
        rectRing,
        maxD + 4,
        sunkenRect,
        crossSectionClip,
        concreteMat,
        maxAnisotropy
      )
    );
  }

  return root;
}

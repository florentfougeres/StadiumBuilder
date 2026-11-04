import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  buildShapeBowlRing,
  bowlSideWeights,
  computeRectangularCornerLayout,
  CornerQuadrantId,
  getBowlArcRange,
  isOnRingCorner,
  RectangularCornerSpec,
  RoundedBowlGeometry,
  sampleCornerQuadrantPoint,
  sampleRoundedBowlRing,
} from './bowlRing';
import {
  computeTelescopicProjection,
  getTrackRadialOffset,
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
  BOWL_CURTAIN_WALL_OFFSET,
  buildCurtainWallArticulation,
  buildEnvelopeDressing,
  buildParametricFacadeOnRail,
  buildStraightParametricFacade,
  FacadeRailSample,
} from './parametricFacade';
import {
  clampPitchToTrack,
  CornerId,
  CornerMode,
  EnvelopeStyle,
  getEffectiveSunkenDepth,
  isContinuousBowlShape,
  isCornerConfigured,
  resolveAllCorners,
  resolveStandVomitories,
  StadiumDocument,
  StandConfig,
  StandSide,
  resolveCrowdAttendance,
} from './schema';
import { createStandSeatPainter, SeatPainter } from './seatPattern';
import {
  computeStandSection,
  StandSection,
  getTierStartRows,
  OVERHANG_HEADROOM_M,
  resolveStandTiers,
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

interface StandProfile {
  shape: THREE.Shape;
  profilePts: [number, number][];
  isSeatSegmentMask: boolean[];
  totalDepth: number;
  topHeight: number;
  rowPositions: RowSample[];
  balconies: BalconySample[];
  tierBands: TierBandSample[];
}

function createStrut(
  pA: THREE.Vector3,
  pB: THREE.Vector3,
  rTop: number,
  rBot: number,
  mat: THREE.Material,
  segs: number = 6
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(pB, pA);
  const len = Math.max(0.05, dir.length());
  const mid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBot, len, segs),
    mat
  );
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true;
  return mesh;
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
  };
}

function createVipSkyboxTexture(isNight: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  if (isNight) {
    grad.addColorStop(0, '#78350f');
    grad.addColorStop(0.35, '#fef3c7');
    grad.addColorStop(1, '#f59e0b');
  } else {
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(0.5, '#1e3a5f');
    grad.addColorStop(1, '#38bdf8');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 128);

  ctx.fillStyle = '#0f172a';
  for (let x = 0; x <= 512; x += 64) {
    ctx.fillRect(x - 2, 0, 4, 128);
  }
  ctx.fillRect(0, 0, 512, 8);
  ctx.fillRect(0, 120, 512, 8);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(6, 1);
  tex.needsUpdate = true;
  return tex;
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

/** Envelopes drawn as a dressing on a rail in front of the plain facade wall. */
function isRailDressedEnvelope(envelope: EnvelopeStyle): boolean {
  return (
    envelope === 'stacked_arcades' ||
    envelope === 'media_mesh' ||
    envelope === 'helical_ramps' ||
    envelope === 'horizontal_strata'
  );
}

/** The rail dressing of an envelope drawn on a rail (see `isRailDressedEnvelope`). */
function railEnvelopeDressing(
  doc: StadiumDocument,
  envelope: EnvelopeStyle,
  samples: FacadeRailSample[],
  closed: boolean,
  facadeMat: THREE.Material,
  structureMat: THREE.Material
): THREE.Group | null {
  return buildEnvelopeDressing({
    samples,
    closed,
    style: envelope,
    frameMat: structureMat,
    facadeMat,
    ledColors: [doc.colors.seatsPrimary, doc.colors.seatsSecondary],
    night: doc.lighting !== 'day',
  });
}

/** Column density multiplier of a `colonnade_forest` envelope. */
function colonnadeDensity(mats: { colonnadeDensity?: number }): number {
  return Math.max(0.5, Math.min(4, mats.colonnadeDensity ?? 1));
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
  vipTex: THREE.CanvasTexture,
  turnstileTex: THREE.CanvasTexture
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const envelope: EnvelopeStyle = mats.envelopeStyle ?? 'enveloping_skin';
  const ownStructure = stand.structureMaterialOverride;
  const isHollow =
    doc.roof.style !== 'enveloping_shell' &&
    (envelope === 'exposed_structure' ||
      envelope === 'colonnade_forest' ||
      (ownStructure !== undefined &&
        ownStructure !== 'inherit' &&
        ownStructure !== 'reinforced_concrete'));
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
  } = buildStandProfilePoints(stand, isHollow);

  const sunkenDepth = getEffectiveSunkenDepth(doc);
  const gradeY = Math.min(sunkenDepth, Math.max(0, topHeight * 0.68));
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

      const openRows = Math.min(5, Math.max(3, Math.round(nBandRows * 0.24)));
      const centerRow = Math.min(
        nBandRows - 2,
        Math.max(1, Math.round((nBandRows - 1) * vomSpec.rowRatio))
      );
      const rStart = Math.max(1, Math.min(nBandRows - openRows, centerRow - Math.floor(openRows * 0.5)));
      const rEnd = Math.min(nBandRows - 1, rStart + openRows - 1);

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

      for (const posFrac of vomSpec.positions) {
        const vx = -spanLength * 0.5 + posFrac * spanLength;
        if (stand.id === 'south' && band.tierIdx === 0 && Math.abs(vx) < 6.4) {
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

  const seats3d = mats.seats3d !== false;
  const bowlMesh = new THREE.Mesh(straightBowlGeo, [concreteMat, seats3d ? concreteMat : seatMat]);
  bowlMesh.castShadow = true;
  bowlMesh.receiveShadow = true;
  group.add(bowlMesh);

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

      for (const band of tierBands) {
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
  const frontGlassRail = new THREE.Mesh(
    new THREE.BoxGeometry(spanLength - 0.06, 0.68, 0.06),
    glassRailMat
  );
  frontGlassRail.position.set(0, stand.elevationStart + 0.92, 0.17);
  group.add(frontGlassRail);

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

  // 5b. 3D Stepped Radial Stair Flights + Yellow Safety Nosings + Central Handrails along aisles
  if (stand.aisleCount > 0 && rowPositions.length > 0) {
    const stairStepMatrices: THREE.Matrix4[] = [];
    const nosingMatrices: THREE.Matrix4[] = [];
    const stairW = Math.max(0.85, stand.aisleWidth * 0.84);
    const halfStepD = stand.rowDepth * 0.48;

    for (let a = 0; a < stand.aisleCount; a++) {
      // Match buildSweepSeatInstances X coordinates (`s=0` is `+span/2`, `s=end` is `-span/2`)
      const ax = spanLength * 0.5 - ((a + 0.5) / stand.aisleCount) * spanLength;

      for (const rp of rowPositions) {
        if (stand.id === 'south' && rp.tierIdx === 0 && Math.abs(ax) < 4.2 && rp.y < stand.elevationStart + 2.8) {
          continue;
        }
        const inCarvedVom = carvedZones.some(
          (cz) =>
            cz.tierIdx === rp.tierIdx &&
            ax > cz.xMin - stairW * 0.45 &&
            ax < cz.xMax + stairW * 0.45 &&
            cz.segSet.has(rp.treadSegIdx)
        );
        if (inCarvedVom) continue;

        const halfRise = rp.riser * 0.5;
        const rowFrontZ = rp.d - stand.rowDepth * 0.52;

        // Intermediate half-step block creating real 2-riser-per-row stair steps
        dummy.position.set(
          ax,
          rp.y + halfRise * 0.5,
          rowFrontZ + stand.rowDepth * 0.74
        );
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(stairW, Math.max(0.08, halfRise), halfStepD);
        dummy.updateMatrix();
        stairStepMatrices.push(dummy.matrix.clone());

        // High-visibility safety nosing on both stair steps
        for (const [ny, nz] of [
          [rp.y + 0.018, rowFrontZ + 0.05],
          [rp.y + halfRise + 0.018, rowFrontZ + stand.rowDepth * 0.52],
        ]) {
          dummy.position.set(ax, ny, nz);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(stairW * 0.94, 0.032, 0.065);
          dummy.updateMatrix();
          nosingMatrices.push(dummy.matrix.clone());
        }
      }

      // Central brushed-steel stair handrail per tier band (split cleanly around any carved vomitory)
      for (const band of tierBands) {
        const hitZone = carvedZones.find(
          (cz) =>
            cz.tierIdx === band.tierIdx &&
            ax > cz.xMin - 0.35 &&
            ax < cz.xMax + 0.35
        );
        if (hitZone) {
          if (hitZone.dStart - band.dStart > 1.2) {
            group.add(
              createStrut(
                new THREE.Vector3(ax, band.yStart + 0.85, band.dStart + 0.25),
                new THREE.Vector3(ax, hitZone.yStart + 0.85, hitZone.dStart - 0.15),
                0.028,
                0.028,
                vomRailMat,
                6
              )
            );
          }
          if (band.dEnd - hitZone.dEnd > 1.2) {
            group.add(
              createStrut(
                new THREE.Vector3(ax, hitZone.yEnd + 0.85, hitZone.dEnd + 0.25),
                new THREE.Vector3(ax, band.yEnd + 0.85, band.dEnd - 0.25),
                0.028,
                0.028,
                vomRailMat,
                6
              )
            );
          }
        } else if (band.dEnd - band.dStart > 1.8) {
          group.add(
            createStrut(
              new THREE.Vector3(ax, band.yStart + 0.85, band.dStart + 0.25),
              new THREE.Vector3(ax, band.yEnd + 0.85, band.dEnd - 0.25),
              0.028,
              0.028,
              vomRailMat,
              6
            )
          );
        }
      }
    }

    if (stairStepMatrices.length > 0) {
      const stepGeom = new THREE.BoxGeometry(1, 1, 1);
      const stepMesh = new THREE.InstancedMesh(
        stepGeom,
        vomPortalMat,
        stairStepMatrices.length
      );
      stepMesh.name = 'RadialStairSteps';
      for (let i = 0; i < stairStepMatrices.length; i++) {
        stepMesh.setMatrixAt(i, stairStepMatrices[i]);
      }
      stepMesh.instanceMatrix.needsUpdate = true;
      stepMesh.receiveShadow = true;
      group.add(stepMesh);
    }

    if (nosingMatrices.length > 0) {
      const nosingMat = new THREE.MeshStandardMaterial({
        color: 0xeab308,
        roughness: 0.52,
        metalness: 0.08,
      });
      const nosingGeom = new THREE.BoxGeometry(1, 1, 1);
      const nosingMesh = new THREE.InstancedMesh(
        nosingGeom,
        nosingMat,
        nosingMatrices.length
      );
      nosingMesh.name = 'RadialStairNosings';
      for (let i = 0; i < nosingMatrices.length; i++) {
        nosingMesh.setMatrixAt(i, nosingMatrices[i]);
      }
      nosingMesh.instanceMatrix.needsUpdate = true;
      group.add(nosingMesh);
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
    const vipGlassMat = new THREE.MeshPhysicalMaterial({
      map: vipTex,
      emissive: new THREE.Color(doc.lighting === 'day' ? 0x000000 : 0xf59e0b),
      emissiveMap: vipTex,
      emissiveIntensity: doc.lighting === 'day' ? 0 : 0.68,
      roughness: 0.1,
      metalness: 0.3,
      clearcoat: 0.9,
    });

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
        const skyboxGlass = new THREE.Mesh(
          new THREE.BoxGeometry(spanLength - 0.12, 1.8, 0.32),
          vipGlassMat
        );
        skyboxGlass.position.set(0, bal.loggiaY, bal.loggiaD);
        group.add(skyboxGlass);
      }

      // Structural tapered cantilever soffit beams underneath deep cantilevered upper tiers
      if (bal.overhangSpan > 1.5) {
        const bracketCount = Math.max(4, Math.floor(spanLength / 9.5));
        for (let b = 0; b <= bracketCount; b++) {
          const bx = -spanLength * 0.47 + (b / bracketCount) * (spanLength * 0.94);
          group.add(
            createStrut(
              new THREE.Vector3(
                bx,
                bal.soffitY -
                  Math.max(0.15, Math.min(1.35, bal.overhangSpan * 0.22, bal.soffitY - bal.clearY)),
                bal.recessD - 0.15
              ),
              new THREE.Vector3(bx, bal.soffitY - 0.06, bal.d + 0.22),
              0.11,
              0.24,
              structureMat,
              4
            )
          );
        }
      }
    }
  }

  if (stand.id === 'south') {
    group.add(createPlayersTunnelPortal());
  }

  // Exterior Envelope Architecture (above `gradeY`)
  const wallH = Math.max(2.0, topHeight - gradeY);
  const extOverhang = capNegLocalX && capPosLocalX ? 2.4 : 0.0;

  if (doc.roof.style !== 'enveloping_shell') {
    if (envelope === 'exposed_structure') {
      const bayCount = Math.max(6, Math.floor(spanLength / 8.5));
      const concourseY = Math.min(topHeight - 2.5, Math.max(gradeY + 4.2, topHeight * 0.42));

      if (topHeight - gradeY > 7.5) {
        const walkway = new THREE.Mesh(
          new THREE.BoxGeometry(spanLength - 0.4, 0.42, Math.max(3.5, totalDepth * 0.36)),
          concreteMat
        );
        walkway.position.set(0, concourseY, totalDepth * 0.72);
        walkway.castShadow = true;
        walkway.receiveShadow = true;
        group.add(walkway);

        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(spanLength - 0.4, 1.05, 0.08),
          structureMat
        );
        rail.position.set(0, concourseY + 0.65, totalDepth * 0.9);
        group.add(rail);
      }

      for (let b = 0; b <= bayCount; b++) {
        const bx = -spanLength / 2 + 1.2 + (b * (spanLength - 2.4)) / bayCount;
        const innerFootZ = Math.max(3.2, totalDepth * 0.25);
        const midZ = totalDepth * 0.58;
        const midSoffitY = Math.max(gradeY + 1.5, topHeight * 0.48);

        group.add(
          createStrut(
            new THREE.Vector3(bx, Math.max(0.2, gradeY * 0.4), innerFootZ),
            new THREE.Vector3(bx, topHeight - 1.2, totalDepth - 0.4),
            0.34,
            0.42,
            structureMat,
            6
          ),
          createStrut(
            new THREE.Vector3(bx, gradeY, totalDepth - 0.4),
            new THREE.Vector3(bx, topHeight, totalDepth - 0.4),
            0.34,
            0.38,
            structureMat,
            6
          ),
          createStrut(
            new THREE.Vector3(bx, gradeY, midZ),
            new THREE.Vector3(bx, midSoffitY, midZ),
            0.28,
            0.32,
            structureMat,
            6
          )
        );

        if (b < bayCount && b % 2 === 0 && topHeight - gradeY > 6) {
          const nextBx =
            -spanLength / 2 + 1.2 + ((b + 1) * (spanLength - 2.4)) / bayCount;
          const stairFlight = createStrut(
            new THREE.Vector3(bx, gradeY + 0.2, totalDepth + 0.8),
            new THREE.Vector3(nextBx, concourseY, totalDepth + 0.8),
            0.45,
            0.45,
            concreteMat,
            4
          );
          group.add(stairFlight);
          if (topHeight - concourseY > 4.5) {
            group.add(
              createStrut(
                new THREE.Vector3(nextBx, concourseY, totalDepth + 1.5),
                new THREE.Vector3(bx, topHeight - 1.8, totalDepth + 0.4),
                0.42,
                0.42,
                concreteMat,
                4
              )
            );
          }
        }
      }
    } else if (envelope === 'colonnade_forest') {
      const innerCoreWall = new THREE.Mesh(
        new THREE.BoxGeometry(spanLength, wallH * 0.94, 0.55),
        facadeMat
      );
      innerCoreWall.position.set(0, gradeY + (wallH * 0.94) / 2, totalDepth - 1.6);
      group.add(innerCoreWall);

      const cornice = new THREE.Mesh(
        new THREE.BoxGeometry(spanLength + extOverhang, 0.95, 7.6),
        structureMat
      );
      cornice.position.set(0, topHeight - 0.35, totalDepth + 1.8);
      cornice.castShadow = true;
      group.add(cornice);

      const colsPerRow = Math.max(12, Math.floor(spanLength / (4.2 / colonnadeDensity(mats))));
      const rowOffsets = [0.2, 2.5, 4.8];
      const totalCols = colsPerRow * rowOffsets.length;
      const slenderGeo = new THREE.CylinderGeometry(0.21, 0.24, wallH, 10);
      const forest = new THREE.InstancedMesh(slenderGeo, structureMat, totalCols);
      forest.castShadow = true;

      let idx = 0;
      for (let r = 0; r < rowOffsets.length; r++) {
        const zOff = totalDepth + rowOffsets[r];
        const stagger = r % 2 === 1 ? 0.5 : 0;
        for (let c = 0; c < colsPerRow; c++) {
          const cx =
            -spanLength / 2 +
            ((c + 0.25 + stagger * 0.5) / colsPerRow) * spanLength;
          dummy.position.set(cx, gradeY + wallH / 2, zOff);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          forest.setMatrixAt(idx++, dummy.matrix);
        }
      }
      forest.instanceMatrix.needsUpdate = true;
      forest.computeBoundingSphere();
      group.add(forest);
    } else if (envelope === 'louver_curtain') {
      const coreWall = new THREE.Mesh(
        new THREE.BoxGeometry(spanLength, wallH * 0.98, 0.6),
        facadeMat
      );
      coreWall.position.set(0, gradeY + (wallH * 0.98) / 2, totalDepth - 0.2);
      group.add(coreWall);

      const bladeLevels = Math.max(5, Math.floor(wallH / 2.2));
      const bladeGeo = new THREE.BoxGeometry(spanLength + extOverhang * 0.3, 0.32, 1.35);
      const blades = new THREE.InstancedMesh(bladeGeo, structureMat, bladeLevels);
      blades.castShadow = true;
      for (let l = 0; l < bladeLevels; l++) {
        const ly = gradeY + 2.6 + (l * Math.max(1, wallH - 3.0)) / Math.max(1, bladeLevels - 1);
        dummy.position.set(0, ly, totalDepth + 1.15);
        dummy.rotation.set(0.28, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        blades.setMatrixAt(l, dummy.matrix);
      }
      blades.instanceMatrix.needsUpdate = true;
      blades.computeBoundingSphere();
      group.add(blades);
    } else {
      const rearFacadeWall = new THREE.Mesh(
        new THREE.BoxGeometry(spanLength, wallH * 0.98, 0.78),
        facadeMat
      );
      rearFacadeWall.position.set(0, gradeY + (wallH * 0.98) / 2, totalDepth + 0.15);
      rearFacadeWall.castShadow = true;
      rearFacadeWall.receiveShadow = true;
      group.add(rearFacadeWall);

      const dressing = isRailDressedEnvelope(envelope)
        ? railEnvelopeDressing(
            doc,
            envelope,
            [-1, 1].map((side) => ({
              x: (side * (spanLength + extOverhang)) / 2,
              z: totalDepth + 0.55,
              nx: 0,
              nz: 1,
              yBottom: gradeY,
              yTop: topHeight,
            })),
            false,
            facadeMat,
            structureMat
          )
        : null;
      if (dressing) group.add(dressing);

      // Pilasters, unless the arcades or LED skin already articulate the wall.
      if (!dressing) {
        const colCount = Math.max(6, Math.floor(spanLength / 7.5));
        const colGeo = new THREE.BoxGeometry(0.62, wallH, 2.2);
        const colInstanced = new THREE.InstancedMesh(colGeo, structureMat, colCount);
        colInstanced.castShadow = true;

        for (let i = 0; i < colCount; i++) {
          const x = -spanLength / 2 + (i + 0.5) * (spanLength / colCount);
          dummy.position.set(x, gradeY + wallH / 2, totalDepth + 0.58);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          colInstanced.setMatrixAt(i, dummy.matrix);
        }
        colInstanced.instanceMatrix.needsUpdate = true;
        colInstanced.computeBoundingSphere();
        group.add(colInstanced);
      }
    }

    // 3D Parametric Facade Relief on straight stand exterior when concourse ring is not wrapping it
    const facadePattern = mats.facadePattern ?? 'none';
    if (facadePattern !== 'none' && (doc.concourse?.width ?? 0) <= 0.5) {
      const lobbyTop = envelope !== 'exposed_structure' ? Math.min(3.4, wallH * 0.85) + 0.35 : 0;
      const relief = buildStraightParametricFacade({
        span: spanLength,
        rearWallZ: totalDepth + 0.65,
        yBottom: gradeY + lobbyTop,
        yTop: topHeight - 0.15,
        pattern: facadePattern,
        density: mats.facadeDensity ?? 1.0,
        depth: mats.facadeDepth ?? 0.85,
        bulge: mats.facadeBulge ?? 0,
        primaryMat: facadeMat,
        accentMat: structureMat,
        name: `StandParametricFacade_${stand.id}`,
      });
      if (relief) {
        group.add(relief);
      }
    }
  }

  // Concourse Entrance Plinth & Turnstiles (`Y = gradeY .. gradeY + 3.4m`)
  if (envelope !== 'exposed_structure') {
    const entranceMat = new THREE.MeshPhysicalMaterial({
      map: turnstileTex,
      emissive: new THREE.Color(isNight ? 0xfbbf24 : 0x000000),
      emissiveMap: turnstileTex,
      emissiveIntensity: isNight ? 0.55 : 0,
      roughness: 0.18,
      metalness: 0.35,
      clearcoat: 0.85,
    });
    const lobbyH = Math.min(3.4, wallH * 0.85);
    const entranceLobby = new THREE.Mesh(
      new THREE.BoxGeometry(spanLength * 0.98, lobbyH, 2.4),
      entranceMat
    );
    entranceLobby.position.set(0, gradeY + lobbyH / 2, totalDepth + 1.05);
    entranceLobby.castShadow = true;
    group.add(entranceLobby);

    const entranceCanopy = new THREE.Mesh(
      new THREE.BoxGeometry(spanLength + extOverhang * 0.5, 0.45, 3.8),
      structureMat
    );
    entranceCanopy.position.set(0, gradeY + lobbyH + 0.22, totalDepth + 1.45);
    entranceCanopy.castShadow = true;
    group.add(entranceCanopy);
  }

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
  /** Share of seats with a spectator sitting in them (`0..1`). */
  attendance: number;
  /** Dress every spectator in the club-colour tifo pattern. */
  tifo?: boolean;
  /** Seat colour; without it tiers alternate the two club colours. */
  paint?: (seat: SweepSeat, out: THREE.Color) => THREE.Color;
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
    attendance,
    tifo = false,
    paint,
  } = opts;
  const pitch = Math.max(0.42, seatWidth);
  const nextSlice = (s: number) => (closed ? (s + 1) % ringCount : s + 1);

  // Tier index per seat tread: a run of three or more non-seat segments is a balcony break.
  const tierOfSegment: number[] = [];
  let tier = 0;
  let gap = 0;
  let seenSeat = false;
  isSeatSegmentMask.forEach((isSeat, p) => {
    if (isSeat) {
      if (seenSeat && gap >= 3) tier++;
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
    const count = Math.max(0, Math.round(rowsSoFar - placedRows));
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
  const aislePoints: { pos: THREE.Vector3; tier: number }[][] = Array.from(
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
      const holeHere = isHoleQuad ? isHoleQuad(s, row.p) : false;
      aisleAt.forEach((x, k) => {
        if (!holeHere && len > 1e-4 && x >= run && x < run + len) {
          aislePoints[k].push({
            pos: new THREE.Vector3().lerpVectors(pointAt(s, row), pointAt(nextSlice(s), row), (x - run) / len),
            tier: tierOfSegment[row.p],
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

/** Head with a darker crown of hair at height `y`; the instance colour carries the skin tone. */
const crowdHeadGeometryCache = new Map<number, THREE.BufferGeometry>();
function getCrowdHeadGeometry(y: number): THREE.BufferGeometry {
  const cached = crowdHeadGeometryCache.get(y);
  if (cached) return cached;
  const g = new THREE.IcosahedronGeometry(0.105, 1);
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
  crowdHeadGeometryCache.set(y, g);
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

  type Variant = { geo: THREE.BufferGeometry; headY: number; idx: number[] };
  const variants: Variant[] =
    pose === 'seated'
      ? [{ geo: getCrowdBodyGeometry('seated'), headY: 1.11, idx: occupied }]
      : [
          { geo: getCrowdBodyGeometry('standing'), headY: 1.6, idx: [] },
          { geo: getCrowdBodyGeometry('scarf'), headY: 1.6, idx: [] },
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
    group.add(mesh);
  };
  for (const v of variants) {
    if (v.idx.length === 0) continue;
    const bodies = new THREE.InstancedMesh(v.geo, getCrowdMaterial(), v.idx.length);
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

/** Galvanised steel shared by every aisle handrail. */
let handrailMaterialCache: THREE.MeshStandardMaterial | null = null;

/**
 * Centre handrails down every aisle: a top rail 0.9 m above the steps on posts every second row,
 * broken at each tier change and every six rows so spectators can cross into the rows.
 */
function buildAisleHandrails(aisles: { pos: THREE.Vector3; tier: number }[][]): THREE.InstancedMesh | null {
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
      if (!next || next.tier !== p.tier || i % 6 === 5) continue;
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
function resolveCornerFollow(doc: StadiumDocument): Partial<Record<CornerQuadrantId, StandSide>> {
  const join = doc.cornerJoin ?? 'blend';
  if (join === 'blend') return {};
  const mats = resolveStadiumMaterials(doc);
  const envelope: EnvelopeStyle = mats.envelopeStyle ?? 'enveloping_skin';
  const isHollow =
    doc.roof.style !== 'enveloping_shell' &&
    (envelope === 'exposed_structure' || envelope === 'colonnade_forest');
  const sections = new Map<StandSide, StandProfile>();
  const section = (side: StandSide) => {
    if (!sections.has(side)) sections.set(side, buildStandProfilePoints(doc.stands[side], isHollow));
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
  vipTex: THREE.CanvasTexture,
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
    doc.roof.style !== 'enveloping_shell' &&
    (envelope === 'exposed_structure' || envelope === 'colonnade_forest');

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
        gradeY: Math.min(sunkenDepth, Math.max(0, topH * 0.68)),
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
      const vipA = activeA && standA.vipLoges !== false;
      const vipB = activeB && standB.vipLoges !== false;
      const hasVip = vipA || vipB;
      const recessAdd = weight * (hasVip ? 1.45 : 0.75);
      const baseLoggiaH = weight * (hasVip ? 1.95 : 0.95);
      // Same projection as each neighbouring stand, blended across the corner.
      const overhang =
        (activeA ? (1 - w) * (tiersA[bIdx + 1]?.overhang ?? 0) : 0) +
        (activeB ? w * (tiersB[bIdx + 1]?.overhang ?? 0) : 0);
      const overhangDelta = -overhang;
      const fasciaH = weight * (hasVip ? 0.9 : 0.65);
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
          const recD = curD + sc.recessAdd;
          const overD = Math.max(1.8, curD + sc.overhangDelta);
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

    const gradeY = Math.min(sunkenDepth, Math.max(0, crestY * 0.68));
    profilePtsPerSlice.push(pts);
    rowSamplesPerSlice.push(sliceRows);
    balconiesPerSlice.push(sliceBals);
    crestPerSlice.push({ outerD: outerWallD, topH: crestY, elev, gradeY });
  }

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
    cornerVRepeat
  );

  const cornerSeats3d = resolveStadiumMaterials(doc).seats3d !== false;
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
    if (!rSample) continue;
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
    const vipGlassMat = new THREE.MeshPhysicalMaterial({
      map: vipTex,
      emissive: new THREE.Color(doc.lighting === 'day' ? 0x000000 : 0xf59e0b),
      emissiveMap: vipTex,
      emissiveIntensity: doc.lighting === 'day' ? 0 : 0.68,
      roughness: 0.1,
      metalness: 0.3,
      clearcoat: 0.9,
      side: THREE.DoubleSide,
    });

    const curveType = corner.facetedThreeBay ? 'centripetal' : 'catmullrom';
    const curveTension = corner.facetedThreeBay ? 0.04 : 0.5;

    for (let bIdx = 0; bIdx < breakRows.length; bIdx++) {
      const fasciaPts: THREE.Vector3[] = [];
      const ledPts: THREE.Vector3[] = [];
      const vipBotPts: THREE.Vector3[] = [];
      const vipTopPts: THREE.Vector3[] = [];

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
          vipBotPts.push(new THREE.Vector3(gp.x, bal.loggiaBottomY, gp.z));
          vipTopPts.push(new THREE.Vector3(gp.x, bal.loggiaTopY, gp.z));
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

      if (vipBotPts.length >= 3) {
        const vLen = vipBotPts.length;
        const vPos = new Float32Array(vLen * 2 * 3);
        const vUvs = new Float32Array(vLen * 2 * 2);
        const vIdx: number[] = [];
        for (let i = 0; i < vLen; i++) {
          const bot = vipBotPts[i];
          const top = vipTopPts[i];
          const b = i * 6;
          vPos[b] = bot.x;
          vPos[b + 1] = bot.y;
          vPos[b + 2] = bot.z;
          vPos[b + 3] = top.x;
          vPos[b + 4] = top.y;
          vPos[b + 5] = top.z;

          const uCoord = (i / Math.max(1, vLen - 1)) * 2.5;
          vUvs[i * 4] = uCoord;
          vUvs[i * 4 + 1] = 0;
          vUvs[i * 4 + 2] = uCoord;
          vUvs[i * 4 + 3] = 1;
        }
        for (let i = 0; i < vLen - 1; i++) {
          const a = i * 2;
          const b = (i + 1) * 2;
          const c = b + 1;
          const d = a + 1;
          vIdx.push(a, d, b, b, d, c);
        }
        const vGeo = new THREE.BufferGeometry();
        vGeo.setAttribute('position', new THREE.BufferAttribute(vPos, 3));
        vGeo.setAttribute('uv', new THREE.BufferAttribute(vUvs, 2));
        vGeo.setIndex(vIdx);
        vGeo.computeVertexNormals();
        group.add(new THREE.Mesh(vGeo, vipGlassMat));
      }
    }
  }

  // 8. Exterior Corner Envelope Architecture (`exposed_structure`, `colonnade_forest`, `louver_curtain`, `enveloping_skin`)
  if (doc.roof.style !== 'enveloping_shell') {
    const doubleFacadeMat = facadeMat.clone();
    doubleFacadeMat.side = THREE.DoubleSide;

    const buildSweptCornerWall = (
      offsetFromOuter: number,
      bottomYFn: (s: number) => number,
      topYFn: (s: number) => number,
      mat: THREE.Material,
      uTile: number = 3.0
    ): THREE.Mesh => {
      const pos = new Float32Array((segs + 1) * 2 * 3);
      const uvs = new Float32Array((segs + 1) * 2 * 2);
      const idx: number[] = [];
      for (let s = 0; s <= segs; s++) {
        const cr = crestPerSlice[s];
        const pt = sampleCornerQuadrantPoint(corner, s / segs, cr.outerD + offsetFromOuter);
        const y0 = bottomYFn(s);
        const y1 = topYFn(s);
        const b = s * 6;
        pos[b] = pt.x;
        pos[b + 1] = y0;
        pos[b + 2] = pt.z;
        pos[b + 3] = pt.x;
        pos[b + 4] = y1;
        pos[b + 5] = pt.z;

        const uCoord = (s / segs) * uTile;
        uvs[s * 4] = uCoord;
        uvs[s * 4 + 1] = 0;
        uvs[s * 4 + 2] = uCoord;
        uvs[s * 4 + 3] = 1;
      }
      for (let s = 0; s < segs; s++) {
        const a = s * 2;
        const b = (s + 1) * 2;
        const c = b + 1;
        const d = a + 1;
        // Outward normal `(+nx, 0, +nz)` for clockwise `s`
        idx.push(a, b, d, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };

    if (envelope === 'exposed_structure') {
      const concPts: THREE.Vector3[] = [];
      for (let s = 0; s <= segs; s++) {
        const cr = crestPerSlice[s];
        const concY = Math.min(cr.topH - 2.5, Math.max(cr.gradeY + 4.2, cr.topH * 0.42));
        const cp = sampleCornerQuadrantPoint(corner, s / segs, cr.outerD * 0.76);
        concPts.push(new THREE.Vector3(cp.x, concY, cp.z));
      }
      group.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3(concPts, false), segs, 1.35, 6, false),
          concreteMat
        )
      );

      for (let s = 1; s < segs; s += 3) {
        const u = s / segs;
        const cr = crestPerSlice[s];
        const pIn = sampleCornerQuadrantPoint(corner, u, Math.max(3.2, cr.outerD * 0.26));
        const pMid = sampleCornerQuadrantPoint(corner, u, cr.outerD * 0.58);
        const pOut = sampleCornerQuadrantPoint(corner, u, cr.outerD - 0.4);
        group.add(
          createStrut(
            new THREE.Vector3(pIn.x, Math.max(0.2, cr.gradeY * 0.4), pIn.z),
            new THREE.Vector3(pOut.x, cr.topH - 1.2, pOut.z),
            0.34,
            0.42,
            structureMat,
            6
          ),
          createStrut(
            new THREE.Vector3(pOut.x, cr.gradeY, pOut.z),
            new THREE.Vector3(pOut.x, cr.topH, pOut.z),
            0.32,
            0.38,
            structureMat,
            6
          ),
          createStrut(
            new THREE.Vector3(pMid.x, cr.gradeY, pMid.z),
            new THREE.Vector3(pMid.x, Math.max(cr.gradeY + 1.5, cr.topH * 0.48), pMid.z),
            0.28,
            0.32,
            structureMat,
            6
          )
        );
      }
    } else if (envelope === 'colonnade_forest') {
      group.add(
        buildSweptCornerWall(
          -1.6,
          (s) => crestPerSlice[s].gradeY,
          (s) => crestPerSlice[s].topH - 0.8,
          doubleFacadeMat
        ),
        buildSweptCornerWall(
          3.2,
          (s) => crestPerSlice[s].topH - 1.1,
          (s) => crestPerSlice[s].topH - 0.15,
          structureMat
        )
      );

      for (const rAdd of [0.2, 2.5, 4.8]) {
        const colN = 7;
        for (let i = 0; i < colN; i++) {
          const u = (i + 0.5) / colN;
          const sIdx = Math.min(segs, Math.round(u * segs));
          const cr = crestPerSlice[sIdx];
          const wallH = Math.max(2.0, cr.topH - cr.gradeY);
          const pt = sampleCornerQuadrantPoint(corner, u, cr.outerD + rAdd);
          const col = new THREE.Mesh(
            new THREE.CylinderGeometry(0.21, 0.24, wallH, 10),
            structureMat
          );
          col.position.set(pt.x, cr.gradeY + wallH * 0.5, pt.z);
          col.castShadow = true;
          group.add(col);
        }
      }
    } else if (envelope === 'louver_curtain') {
      group.add(
        buildSweptCornerWall(
          -0.2,
          (s) => crestPerSlice[s].gradeY,
          (s) => crestPerSlice[s].topH - 0.3,
          doubleFacadeMat
        )
      );

      const midCr = crestPerSlice[midSlice];
      const bladeLevels = Math.max(5, Math.floor(Math.max(2, midCr.topH - midCr.gradeY) / 2.2));
      for (let l = 0; l < bladeLevels; l++) {
        const fracH = l / Math.max(1, bladeLevels - 1);
        const bladePts: THREE.Vector3[] = [];
        for (let s = 0; s <= segs; s++) {
          const cr = crestPerSlice[s];
          const ly = cr.gradeY + 2.6 + fracH * Math.max(1, cr.topH - cr.gradeY - 3.0);
          const bp = sampleCornerQuadrantPoint(corner, s / segs, cr.outerD + 1.15);
          bladePts.push(new THREE.Vector3(bp.x, ly, bp.z));
        }
        group.add(
          new THREE.Mesh(
            new THREE.TubeGeometry(
              new THREE.CatmullRomCurve3(bladePts, false),
              segs,
              0.24,
              4,
              false
            ),
            structureMat
          )
        );
      }
    } else {
      // `enveloping_skin`: Continuous corner facade wall + vertical structural fins
      group.add(
        buildSweptCornerWall(
          0.15,
          (s) => crestPerSlice[s].gradeY,
          (s) => crestPerSlice[s].topH - 0.25,
          doubleFacadeMat
        )
      );

      const dressing = isRailDressedEnvelope(envelope)
        ? railEnvelopeDressing(
            doc,
            envelope,
            crestPerSlice.map((cr, s) => {
              const pt = sampleCornerQuadrantPoint(corner, s / segs, cr.outerD + 0.15);
              return { x: pt.x, z: pt.z, nx: pt.nx, nz: pt.nz, yBottom: cr.gradeY, yTop: cr.topH - 0.25 };
            }),
            false,
            facadeMat,
            structureMat
          )
        : null;
      if (dressing) group.add(dressing);

      const finCount = dressing ? 0 : corner.facetedThreeBay ? 4 : 6;
      for (let i = 0; i < finCount; i++) {
        const u = corner.facetedThreeBay ? i / 3 : (i + 0.5) / finCount;
        const sIdx = Math.min(segs, Math.round(u * segs));
        const cr = crestPerSlice[sIdx];
        const pt = sampleCornerQuadrantPoint(corner, u, cr.outerD + 0.62);
        group.add(
          createStrut(
            new THREE.Vector3(pt.x, cr.gradeY, pt.z),
            new THREE.Vector3(pt.x, cr.topH - 0.15, pt.z),
            0.34,
            0.38,
            structureMat,
            6
          )
        );
      }

      // Architectural Glazed Spiral-Ramp / Circulation Rotunda on `compact_urban` corners
      if (doc.shape === 'compact_urban') {
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

    // Corner Concourse Turnstile Lobby Plinth & Canopy (`envelope !== 'exposed_structure'`)
    if (envelope !== 'exposed_structure') {
      const entranceMat = new THREE.MeshPhysicalMaterial({
        map: turnstileTex,
        emissive: new THREE.Color(isNight ? 0xfbbf24 : 0x000000),
        emissiveMap: turnstileTex,
        emissiveIntensity: isNight ? 0.55 : 0,
        roughness: 0.18,
        metalness: 0.35,
        clearcoat: 0.85,
        side: THREE.DoubleSide,
      });
      group.add(
        buildSweptCornerWall(
          1.2,
          (s) => crestPerSlice[s].gradeY,
          (s) =>
            crestPerSlice[s].gradeY +
            Math.min(3.4, Math.max(2.0, crestPerSlice[s].topH - crestPerSlice[s].gradeY) * 0.85),
          entranceMat,
          2.0
        ),
        buildSweptCornerWall(
          2.2,
          (s) =>
            crestPerSlice[s].gradeY +
            Math.min(3.4, Math.max(2.0, crestPerSlice[s].topH - crestPerSlice[s].gradeY) * 0.85),
          (s) =>
            crestPerSlice[s].gradeY +
            Math.min(3.4, Math.max(2.0, crestPerSlice[s].topH - crestPerSlice[s].gradeY) * 0.85) +
            0.42,
          structureMat,
          1.0
        )
      );
    }

    if (
      (doc.concourse?.width ?? 0) <= 0.5 &&
      mats.facadePattern &&
      mats.facadePattern !== 'none'
    ) {
      const cornerFacadeRail: FacadeRailSample[] = [];
      for (let s = 0; s <= segs; s++) {
        const cr = crestPerSlice[s];
        const pt = sampleCornerQuadrantPoint(corner, s / segs, cr.outerD + 0.15);
        cornerFacadeRail.push({
          x: pt.x,
          z: pt.z,
          nx: pt.nx,
          nz: pt.nz,
          yBottom: cr.gradeY + 0.2,
          yTop: Math.max(cr.gradeY + 1.8, cr.topH - 0.15),
        });
      }
      const patGroup = buildParametricFacadeOnRail({
        samples: cornerFacadeRail,
        closed: false,
        pattern: mats.facadePattern,
        density: mats.facadeDensity ?? 1.0,
        depth: mats.facadeDepth ?? 0.85,
        bulge: mats.facadeBulge ?? 0,
        primaryMat: facadeMat,
        accentMat: structureMat,
      });
      if (patGroup) group.add(patGroup);
    }
  }

  return group;
}

let cornerScoreboardTexCache: THREE.CanvasTexture | null = null;
function getCornerScoreboardTexture(): THREE.CanvasTexture {
  if (cornerScoreboardTexCache) return cornerScoreboardTexCache;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 288;
  const ctx = canvas.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, 0, 288);
  bg.addColorStop(0, '#071326');
  bg.addColorStop(0.55, '#0b223e');
  bg.addColorStop(1, '#061527');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 288);

  // Subtle LED pixel matrix scanlines
  ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
  for (let y = 0; y < 288; y += 6) {
    ctx.fillRect(0, y, 512, 2);
  }

  // Top telemetry header bar
  ctx.fillStyle = '#0ea5e9';
  ctx.fillRect(24, 20, 464, 34);
  ctx.fillStyle = '#04101f';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('DIRECT  •  67:42', 256, 44);

  // Home / Away neutral badges & score
  ctx.fillStyle = '#1e3a5f';
  ctx.fillRect(36, 76, 132, 132);
  ctx.fillRect(344, 76, 132, 132);

  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(58, 98, 88, 88);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(366, 98, 88, 88);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 84px monospace';
  ctx.fillText('2 : 1', 256, 168);

  // Bottom match metrics strip
  ctx.fillStyle = '#0f2942';
  ctx.fillRect(24, 228, 464, 38);
  ctx.fillStyle = '#34d399';
  ctx.fillRect(36, 242, 248, 10);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(290, 242, 186, 10);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cornerScoreboardTexCache = tex;
  return tex;
}

/**
 * Builds a glazed multi-storey corner hospitality / club offices / media pavilion (`mode === 'building'`).
 * Every vertex stays strictly at `radialOffset >= 1.2`, guaranteeing zero pitch intrusion.
 */
function buildCornerBuildingPavilion(
  corner: RectangularCornerSpec,
  doc: StadiumDocument,
  concreteMat: THREE.MeshStandardMaterial,
  facadeMat: THREE.Material,
  structureMat: THREE.Material,
  vipTex: THREE.CanvasTexture,
  turnstileTex: THREE.CanvasTexture
): THREE.Group {
  const group = new THREE.Group();
  group.name = `CornerBuilding_${corner.id.toUpperCase()}`;

  const mats = resolveStadiumMaterials(doc);
  const isNight = doc.lighting !== 'day';
  const sunkenDepth = getEffectiveSunkenDepth(doc);

  const standA = doc.stands[corner.sideA];
  const standB = doc.stands[corner.sideB];
  const profA = buildStandProfilePoints(standA, false);
  const profB = buildStandProfilePoints(standB, false);

  const segs = corner.facetedThreeBay ? 15 : 22;
  const frontOff = 1.45;
  // The pitch-facing glass front runs as one straight chamfer across the corner: swept around
  // the tight corner radius it pinched into a thin, warped cylinder.
  const frontZone = frontOff + 1.5;
  const at = (u: number, r: number) => {
    if (r > frontZone) return sampleCornerQuadrantPoint(corner, u, r);
    const p0 = sampleCornerQuadrantPoint(corner, 0, r);
    const p1 = sampleCornerQuadrantPoint(corner, 1, r);
    const mid = sampleCornerQuadrantPoint(corner, 0.5, r);
    return { x: p0.x + (p1.x - p0.x) * u, z: p0.z + (p1.z - p0.z) * u, nx: mid.nx, nz: mid.nz };
  };
  const sliceSpecs: { outerD: number; topH: number; gradeY: number }[] = [];

  for (let s = 0; s <= segs; s++) {
    const u = s / segs;
    const w = u * u * (3 - 2 * u);
    const dA = standA.enabled ? profA.totalDepth : profB.totalDepth;
    const dB = standB.enabled ? profB.totalDepth : profA.totalDepth;
    const hA = standA.enabled ? profA.topHeight : profB.topHeight;
    const hB = standB.enabled ? profB.topHeight : profA.topHeight;
    const outerD = Math.max(frontOff + 10.5, dA + (dB - dA) * w);
    const topH = Math.max(10.5, hA + (hB - hA) * w);
    const gradeY = Math.min(sunkenDepth, Math.max(0, topH * 0.55));
    sliceSpecs.push({ outerD, topH, gradeY });
  }

  const buildSweptWall = (
    radFn: (s: number) => number,
    yBotFn: (s: number) => number,
    yTopFn: (s: number) => number,
    mat: THREE.Material,
    uRep: number = 4,
    vRep: number = 2
  ) => {
    const pos = new Float32Array((segs + 1) * 2 * 3);
    const uvs = new Float32Array((segs + 1) * 2 * 2);
    const idx: number[] = [];
    for (let s = 0; s <= segs; s++) {
      const pt = at(s / segs, radFn(s));
      const b = s * 6;
      pos[b] = pt.x;
      pos[b + 1] = yBotFn(s);
      pos[b + 2] = pt.z;
      pos[b + 3] = pt.x;
      pos[b + 4] = yTopFn(s);
      pos[b + 5] = pt.z;

      const u = (s / segs) * uRep;
      uvs[s * 4] = u;
      uvs[s * 4 + 1] = 0;
      uvs[s * 4 + 2] = u;
      uvs[s * 4 + 3] = vRep;
    }
    for (let s = 0; s < segs; s++) {
      const a = s * 2;
      const b = (s + 1) * 2;
      const c = b + 1;
      const d = a + 1;
      idx.push(a, d, b, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  const buildSweptDeck = (
    radInFn: (s: number) => number,
    radOutFn: (s: number) => number,
    yFn: (s: number) => number,
    mat: THREE.Material
  ) => {
    const pos = new Float32Array((segs + 1) * 2 * 3);
    const uvs = new Float32Array((segs + 1) * 2 * 2);
    const idx: number[] = [];
    for (let s = 0; s <= segs; s++) {
      const pIn = at(s / segs, radInFn(s));
      const pOut = at(s / segs, radOutFn(s));
      const py = yFn(s);
      const b = s * 6;
      pos[b] = pIn.x;
      pos[b + 1] = py;
      pos[b + 2] = pIn.z;
      pos[b + 3] = pOut.x;
      pos[b + 4] = py;
      pos[b + 5] = pOut.z;
      uvs[s * 4] = (s / segs) * 4;
      uvs[s * 4 + 1] = 0;
      uvs[s * 4 + 2] = (s / segs) * 4;
      uvs[s * 4 + 3] = 1;
    }
    for (let s = 0; s < segs; s++) {
      const a = s * 2;
      const b = (s + 1) * 2;
      const c = b + 1;
      const d = a + 1;
      idx.push(a, b, d, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  const curtainGlassMat = new THREE.MeshPhysicalMaterial({
    map: vipTex,
    emissive: new THREE.Color(isNight ? 0xf59e0b : 0x0ea5e9),
    emissiveMap: vipTex,
    emissiveIntensity: isNight ? 0.72 : 0.14,
    roughness: 0.08,
    metalness: 0.32,
    clearcoat: 0.94,
    side: THREE.DoubleSide,
  });

  const balconyGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xdbeafe,
    roughness: 0.08,
    metalness: 0.12,
    clearcoat: 0.95,
    transparent: true,
    opacity: 0.56,
    side: THREE.DoubleSide,
  });

  // 1. Pitch-facing panoramic glazed curtain wall (`radialOffset = frontOff + 1.15`, recessed behind balconies)
  group.add(
    buildSweptWall(
      () => frontOff + 1.15,
      () => 0,
      (s) => sliceSpecs[s].topH - 0.35,
      curtainGlassMat,
      5,
      4
    )
  );

  // 2. Ground plinth wall facing pitch + multi-level cantilevered panoramic VIP terrace slabs & glass railings
  group.add(
    buildSweptWall(
      () => frontOff,
      () => 0,
      () => 2.6,
      concreteMat,
      3,
      1
    )
  );

  const avgTopH = sliceSpecs[Math.floor(segs / 2)].topH;
  const floorStep = 3.85;
  const floorCount = Math.max(2, Math.floor((avgTopH - 2.4) / floorStep));

  for (let f = 1; f <= floorCount; f++) {
    const frac = f / (floorCount + 0.35);
    // Floor slab fascia + balcony deck + glass balustrade
    group.add(
      buildSweptDeck(
        () => frontOff,
        (s) => sliceSpecs[s].outerD,
        (s) => 1.8 + frac * (sliceSpecs[s].topH - 2.2),
        concreteMat
      ),
      buildSweptWall(
        () => frontOff,
        (s) => 1.8 + frac * (sliceSpecs[s].topH - 2.2) - 0.32,
        (s) => 1.8 + frac * (sliceSpecs[s].topH - 2.2) + 0.05,
        structureMat,
        4,
        1
      ),
      buildSweptWall(
        () => frontOff + 0.06,
        (s) => 1.8 + frac * (sliceSpecs[s].topH - 2.2) + 0.05,
        (s) => 1.8 + frac * (sliceSpecs[s].topH - 2.2) + 1.1,
        balconyGlassMat,
        4,
        1
      )
    );
  }

  // 3. Rooftop slab, penthouse mechanical volume & overhang cornice
  group.add(
    buildSweptDeck(
      () => frontOff - 0.2,
      (s) => sliceSpecs[s].outerD + 0.45,
      (s) => sliceSpecs[s].topH,
      concreteMat
    ),
    buildSweptWall(
      () => frontOff - 0.2,
      (s) => sliceSpecs[s].topH - 0.48,
      (s) => sliceSpecs[s].topH + 0.45,
      structureMat,
      4,
      1
    ),
    // Exterior rear facade + ground entrance lobby
    buildSweptWall(
      (s) => sliceSpecs[s].outerD,
      (s) => Math.min(sliceSpecs[s].topH - 0.8, sliceSpecs[s].gradeY + 3.4),
      (s) => sliceSpecs[s].topH,
      facadeMat,
      4,
      2
    )
  );

  const turnMat = new THREE.MeshPhysicalMaterial({
    map: turnstileTex,
    emissive: new THREE.Color(isNight ? 0xfbbf24 : 0x000000),
    emissiveMap: turnstileTex,
    emissiveIntensity: isNight ? 0.55 : 0,
    roughness: 0.18,
    metalness: 0.35,
    clearcoat: 0.85,
    side: THREE.DoubleSide,
  });
  group.add(
    buildSweptWall(
      (s) => sliceSpecs[s].outerD + 0.45,
      (s) => sliceSpecs[s].gradeY,
      (s) => Math.min(sliceSpecs[s].topH - 0.6, sliceSpecs[s].gradeY + 3.4),
      turnMat,
      3,
      1
    )
  );

  // 4. Vertical structural mullions on pitch-facing curtain wall + flank end-walls
  const mullionCount = 7;
  for (let m = 0; m <= mullionCount; m++) {
    const u = m / mullionCount;
    const sIdx = Math.min(segs, Math.round(u * segs));
    const pt = at(u, frontOff + 1.05);
    group.add(
      createStrut(
        new THREE.Vector3(pt.x, 0, pt.z),
        new THREE.Vector3(pt.x, sliceSpecs[sIdx].topH, pt.z),
        0.16,
        0.18,
        structureMat,
        6
      )
    );
  }

  for (const endIdx of [0, segs]) {
    const uEnd = endIdx / segs;
    const spec = sliceSpecs[endIdx];
    const pIn = sampleCornerQuadrantPoint(corner, uEnd, frontOff);
    const pOut = sampleCornerQuadrantPoint(corner, uEnd, spec.outerD);
    const spanD = Math.hypot(pOut.x - pIn.x, pOut.z - pIn.z);
    const flankWall = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, spec.topH, spanD),
      concreteMat
    );
    flankWall.position.set(
      (pIn.x + pOut.x) * 0.5,
      spec.topH * 0.5,
      (pIn.z + pOut.z) * 0.5
    );
    flankWall.rotation.y = Math.atan2(pOut.x - pIn.x, pOut.z - pIn.z);
    flankWall.castShadow = true;
    flankWall.receiveShadow = true;
    group.add(flankWall);
  }

  // 5. Parametric facade relief on outer pavilion wall when concourse is disabled
  if (
    (doc.concourse?.width ?? 0) <= 0.5 &&
    mats.facadePattern &&
    mats.facadePattern !== 'none'
  ) {
    const rail: FacadeRailSample[] = [];
    for (let s = 0; s <= segs; s++) {
      const sp = sliceSpecs[s];
      const pt = at(s / segs, sp.outerD + 0.15);
      rail.push({
        x: pt.x,
        z: pt.z,
        nx: pt.nx,
        nz: pt.nz,
        yBottom: sp.gradeY + 0.3,
        yTop: Math.max(sp.gradeY + 2.0, sp.topH - 0.15),
      });
    }
    const pat = buildParametricFacadeOnRail({
      samples: rail,
      closed: false,
      pattern: mats.facadePattern,
      density: mats.facadeDensity ?? 1.0,
      depth: mats.facadeDepth ?? 0.85,
      bulge: mats.facadeBulge ?? 0,
      primaryMat: facadeMat,
      accentMat: structureMat,
    });
    if (pat) group.add(pat);
  }

  return group;
}

/**
 * Builds a monumental corner LED giant scoreboard on a 4-column steel lattice gantry (`mode === 'screen'`).
 * Positioned at `radialOffset = 6.5` along the 45° corner bisector, strictly outside pitch bounds.
 */
function buildCornerScreenStructure(
  corner: RectangularCornerSpec,
  doc: StadiumDocument,
  concreteMat: THREE.MeshStandardMaterial,
  structureMat: THREE.Material
): THREE.Group {
  const wrapper = new THREE.Group();
  wrapper.name = `CornerScreen_${corner.id.toUpperCase()}`;

  const standA = doc.stands[corner.sideA];
  const standB = doc.stands[corner.sideB];
  const profA = buildStandProfilePoints(standA, false);
  const profB = buildStandProfilePoints(standB, false);
  const refH = Math.max(
    15.5,
    ((standA.enabled ? profA.topHeight : 18) + (standB.enabled ? profB.topHeight : 18)) * 0.5
  );

  const anchor = sampleCornerQuadrantPoint(corner, 0.5, 6.8);
  const assembly = new THREE.Group();
  assembly.position.set(anchor.x, 0, anchor.z);
  // Orient local +Z directly toward pitch center `(0, 0, 0)`
  assembly.rotation.y = Math.atan2(-anchor.x, -anchor.z);

  const screenW = 15.8;
  const screenH = 8.9;
  const screenCenterY = Math.max(12.2, refH * 0.66);
  const gantryTopY = screenCenterY + screenH * 0.5 + 1.65;
  const legHalfX = screenW * 0.42;
  const frontLegZ = -0.35;
  const rearLegZ = -3.45;

  // Concrete foundation pedestals + 4 vertical lattice legs
  for (const lx of [-legHalfX, legHalfX]) {
    for (const lz of [frontLegZ, rearLegZ]) {
      const plinth = new THREE.Mesh(
        new THREE.BoxGeometry(1.65, 1.8, 1.65),
        concreteMat
      );
      plinth.position.set(lx, 0.9, lz);
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      assembly.add(plinth);

      assembly.add(
        createStrut(
          new THREE.Vector3(lx, 1.5, lz),
          new THREE.Vector3(lx, gantryTopY, lz),
          0.26,
          0.34,
          structureMat,
          8
        )
      );
    }

    // Transverse & K-bracing between front & rear legs
    const levels = 5;
    for (let lv = 1; lv <= levels; lv++) {
      const y0 = 1.6 + ((lv - 1) * (gantryTopY - 2.0)) / levels;
      const y1 = 1.6 + (lv * (gantryTopY - 2.0)) / levels;
      assembly.add(
        createStrut(
          new THREE.Vector3(lx, y1, frontLegZ),
          new THREE.Vector3(lx, y1, rearLegZ),
          0.14,
          0.14,
          structureMat,
          5
        ),
        createStrut(
          new THREE.Vector3(lx, y0, frontLegZ),
          new THREE.Vector3(lx, y1, rearLegZ),
          0.11,
          0.11,
          structureMat,
          5
        )
      );
    }
  }

  // Horizontal portal cross-beams & X-bracing across the gantry width
  for (const by of [
    screenCenterY - screenH * 0.5 - 0.65,
    screenCenterY,
    gantryTopY - 0.25,
  ]) {
    assembly.add(
      createStrut(
        new THREE.Vector3(-legHalfX - 0.9, by, frontLegZ),
        new THREE.Vector3(legHalfX + 0.9, by, frontLegZ),
        0.2,
        0.2,
        structureMat,
        6
      ),
      createStrut(
        new THREE.Vector3(-legHalfX - 0.9, by, rearLegZ),
        new THREE.Vector3(legHalfX + 0.9, by, rearLegZ),
        0.18,
        0.18,
        structureMat,
        6
      )
    );
  }
  assembly.add(
    createStrut(
      new THREE.Vector3(-legHalfX, 2.0, rearLegZ),
      new THREE.Vector3(legHalfX, screenCenterY - screenH * 0.5 - 0.65, rearLegZ),
      0.13,
      0.13,
      structureMat,
      5
    ),
    createStrut(
      new THREE.Vector3(legHalfX, 2.0, rearLegZ),
      new THREE.Vector3(-legHalfX, screenCenterY - screenH * 0.5 - 0.65, rearLegZ),
      0.13,
      0.13,
      structureMat,
      5
    )
  );

  // Rear maintenance catwalks
  const catwalkMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.5,
    metalness: 0.72,
  });
  for (const cy of [screenCenterY - screenH * 0.32, screenCenterY + screenH * 0.28]) {
    const walk = new THREE.Mesh(
      new THREE.BoxGeometry(screenW - 0.8, 0.16, 2.4),
      catwalkMat
    );
    walk.position.set(0, cy, (frontLegZ + rearLegZ) * 0.5);
    assembly.add(walk);
  }

  // Dark anodized LED cabinet housing + top architectural visor hood + line-array audio pods
  const cabinetMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.36,
    metalness: 0.68,
  });
  const cabinet = new THREE.Mesh(
    new THREE.BoxGeometry(screenW + 0.75, screenH + 0.75, 0.88),
    cabinetMat
  );
  cabinet.position.set(0, screenCenterY, 0.22);
  cabinet.castShadow = true;
  cabinet.receiveShadow = true;
  assembly.add(cabinet);

  const sunHood = new THREE.Mesh(
    new THREE.BoxGeometry(screenW + 0.95, 0.26, 1.35),
    cabinetMat
  );
  sunHood.position.set(0, screenCenterY + screenH * 0.5 + 0.32, 0.48);
  sunHood.castShadow = true;
  assembly.add(sunHood);

  const scoreTex = getCornerScoreboardTexture();
  const screenMat = new THREE.MeshStandardMaterial({
    map: scoreTex,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: scoreTex,
    emissiveIntensity: doc.lighting === 'day' ? 0.62 : 1.25,
    roughness: 0.16,
    metalness: 0.08,
  });
  const ledFace = new THREE.Mesh(new THREE.PlaneGeometry(screenW, screenH), screenMat);
  ledFace.position.set(0, screenCenterY, 0.68);
  assembly.add(ledFace);

  // Line-array stadium loudspeaker clusters suspended beneath the cabinet
  for (const sx of [-screenW * 0.28, screenW * 0.28]) {
    const arrayPod = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 2.1, 0.95),
      cabinetMat
    );
    arrayPod.position.set(sx, screenCenterY - screenH * 0.5 - 1.35, 0.35);
    arrayPod.rotation.x = 0.22;
    arrayPod.castShadow = true;
    assembly.add(arrayPod);
  }

  wrapper.add(assembly);
  return wrapper;
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
  vipTex: THREE.CanvasTexture,
  turnstileTex: THREE.CanvasTexture,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const envelope: EnvelopeStyle = mats.envelopeStyle ?? 'enveloping_skin';
  const isHollow =
    doc.roof.style !== 'enveloping_shell' &&
    (envelope === 'exposed_structure' || envelope === 'colonnade_forest');

  const trackOffsets = getTrackRadialOffset(doc);
  const sunkenDepth = getEffectiveSunkenDepth(doc);

  const segments = doc.shape === 'octagonal_arena' ? 160 : 144;
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
  const activeSegments = Math.max(36, Math.round(segments * arcFraction));
  const ringCount = closed ? activeSegments : activeSegments + 1;

  const tAtSlice = (s: number) => tStart + (s / activeSegments) * (tEnd - tStart);

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
      share: share.map((v) => v / shareSum),
      slopeTan,
      overhang,
    };
  };

  const N_TERRACE_STEPS = 30;
  const isSeatSegmentMask: boolean[] = [];
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

  const profilePtsPerSlice: [number, number][][] = [];
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

    const env = evalStandEnvelopeAt(baseSample.nx, baseSample.nz);
    const tierBlend = blendTierParamsAt(baseSample.nx, baseSample.nz);
    const domTiers = tierBlend.tiers;
    const domVip = tierBlend.hasVip;
    const recOffset = domVip ? 1.45 : 0.75;
    const baseLoggiaH = domVip ? 1.95 : 0.95;
    const fasciaH = domVip ? 0.9 : 0.65;

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
        const loggia = sheltered
          ? Math.max(baseLoggiaH, OVERHANG_HEADROOM_M - lastRise)
          : baseLoggiaH;
        return acc + loggia + fasciaH;
      }, 0);
    let riseScale = Math.max(2, targetRise - breakRise(1)) / Math.max(0.1, rawRiseTotal);
    riseScale = Math.max(2, targetRise - breakRise(riseScale)) / Math.max(0.1, rawRiseTotal);

    const pts: [number, number][] = [];
    pts.push([0, 0]);
    pts.push([0, 1.5]);
    pts.push([0.36, 1.5]);
    pts.push([0.36, 0.92]);

    let curD = 0.36;
    let curY = 0.92;
    let maxD = curD;
    let lastRise = 0;

    for (let k = 0; k < N_TERRACE_STEPS; k++) {
      if (k === 6 || k === 12 || k === 18 || k === 24) {
        if (activeBreakSlots.includes(k)) {
          const overhang = tierBlend.overhang[tierOfStep(k)];
          const recD = curD + recOffset;
          const overD = Math.max(2.0, curD - overhang);
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

    // Pick step range on lower/primary tier (`kStart .. kStart + 2`) avoiding break slots `6, 12, 18, 24`
    const maxStep = st.tiers >= 2 ? 10 : N_TERRACE_STEPS - 4;
    let kStart = Math.max(
      2,
      Math.min(maxStep, Math.round(maxStep * vomSpec.rowRatio))
    );
    if (kStart === 5 || kStart === 6) kStart = 7;

    const segSet = new Set<number>();
    for (let dk = 0; dk < 3 && kStart + dk < N_TERRACE_STEPS; dk++) {
      const [tSeg, rSeg] = stepSegPairs[kStart + dk];
      segSet.add(tSeg);
      segSet.add(rSeg);
    }

    for (let v = 0; v < vomSpec.count; v++) {
      const frac =
        (v + 0.5) / vomSpec.count - 0.5 + vomSpec.offsetRatio * 0.35;
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
      const pStart = profilePtsPerSlice[bestS][stepSegPairs[kStart][0]];
      const pEnd =
        profilePtsPerSlice[bestS][
          stepSegPairs[Math.min(N_TERRACE_STEPS - 1, kStart + 2)][1] + 1
        ];
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

  const isBowlQuadHole = (s: number, p: number): boolean => {
    const nextS = closed ? (s + 1) % ringCount : s + 1;
    if (isSliceInOpenCorner(s) || isSliceInOpenCorner(nextS)) {
      return true;
    }
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

  const bowlSeats3d = mats.seats3d !== false;
  const bowlMesh = new THREE.Mesh(bowlGeo, [concreteMat, bowlSeats3d ? concreteMat : seatMat]);
  bowlMesh.castShadow = true;
  bowlMesh.receiveShadow = true;
  group.add(bowlMesh);

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

  // When a continuous bowl has custom non-filled corners (`open`, `building`, `screen`), cap cut ends & build corner inserts!
  if (hasCustomCornerCutout) {
    const capWallMat = concreteMat.clone();
    capWallMat.side = THREE.DoubleSide;
    for (let s = 0; s < activeSegments; s++) {
      const nextS = closed ? (s + 1) % ringCount : s + 1;
      const openCur = isSliceInOpenCorner(s);
      const openNxt = isSliceInOpenCorner(nextS);
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
      if (spec.mode === 'building') {
        group.add(
          buildCornerBuildingPavilion(
            spec,
            doc,
            concreteMat,
            cFacadeMat,
            cStructMat,
            vipTex,
            turnstileTex
          )
        );
      } else if (spec.mode === 'screen') {
        group.add(buildCornerScreenStructure(spec, doc, concreteMat, cStructMat));
      }
    }
  }

  // Continuous Pitch-Side Laminated Glass Safety Balustrade around the swept bowl front parapet
  const bowlGlassPos = new Float32Array(ringCount * 2 * 3);
  const bowlGlassIdx: number[] = [];
  for (let s = 0; s < ringCount; s++) {
    const gp = sampleRoundedBowlRing(bowlRing, tAtSlice(s), 0.18);
    const b = s * 6;
    bowlGlassPos[b] = gp.x;
    bowlGlassPos[b + 1] = 1.48;
    bowlGlassPos[b + 2] = gp.z;
    bowlGlassPos[b + 3] = gp.x;
    bowlGlassPos[b + 4] = 2.16;
    bowlGlassPos[b + 5] = gp.z;
  }
  for (let s = 0; s < activeSegments; s++) {
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
  for (const stepIdx of [8, 14, 22, 30, 38, 46, 56, 66]) {
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
        (st.tiers === 1 || stepIdx <= 24);
      if (inStandingZone && stepIdx < profilePtsPerSlice[s].length - 5) {
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
  const vipGlassMat = new THREE.MeshPhysicalMaterial({
    map: vipTex,
    emissive: new THREE.Color(doc.lighting === 'day' ? 0x000000 : 0xf59e0b),
    emissiveMap: vipTex,
    emissiveIntensity: doc.lighting === 'day' ? 0 : 0.72,
    roughness: 0.1,
    metalness: 0.35,
    clearcoat: 0.92,
    side: THREE.DoubleSide,
  });

  const slotStartIndices = [16, 32, 48, 64];

  for (const baseIdx of slotStartIndices) {
    let runFascia: THREE.Vector3[] = [];
    let runGlassTop: THREE.Vector3[] = [];
    let runGlassBot: THREE.Vector3[] = [];

    const flushBalconyRun = (looped: boolean) => {
      if (runFascia.length < 3) {
        runFascia = [];
        runGlassTop = [];
        runGlassBot = [];
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

      const gLen = runGlassTop.length;
      if (gLen >= 3) {
        const gPos = new Float32Array(gLen * 2 * 3);
        const gUvs = new Float32Array(gLen * 2 * 2);
        const gIdx: number[] = [];
        for (let i = 0; i < gLen; i++) {
          const bot = runGlassBot[i];
          const top = runGlassTop[i];
          const b = i * 6;
          gPos[b] = bot.x;
          gPos[b + 1] = bot.y;
          gPos[b + 2] = bot.z;
          gPos[b + 3] = top.x;
          gPos[b + 4] = top.y;
          gPos[b + 5] = top.z;

          gUvs[i * 4] = (i / Math.max(1, gLen - 1)) * 8;
          gUvs[i * 4 + 1] = 0;
          gUvs[i * 4 + 2] = (i / Math.max(1, gLen - 1)) * 8;
          gUvs[i * 4 + 3] = 1;
        }
        const lim = looped ? gLen : gLen - 1;
        for (let i = 0; i < lim; i++) {
          const nxt = looped ? (i + 1) % gLen : i + 1;
          const a = i * 2;
          const b = nxt * 2;
          const c = nxt * 2 + 1;
          const d = i * 2 + 1;
          gIdx.push(a, b, d);
          gIdx.push(b, c, d);
        }
        const gGeo = new THREE.BufferGeometry();
        gGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
        gGeo.setAttribute('uv', new THREE.BufferAttribute(gUvs, 2));
        gGeo.setIndex(gIdx);
        gGeo.computeVertexNormals();
        group.add(new THREE.Mesh(gGeo, vipGlassMat));
      }

      runFascia = [];
      runGlassTop = [];
      runGlassBot = [];
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
        if (hDiff > 1.8) {
          const gPt = sampleRoundedBowlRing(bowlRing, t, recBot[0] - 0.15);
          runGlassBot.push(new THREE.Vector3(gPt.x, recBot[1] + 0.08, gPt.z));
          runGlassTop.push(new THREE.Vector3(gPt.x, recBot[1] + 1.62, gPt.z));
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

  // Exterior Envelope Architecture (`enveloping_skin`, `exposed_structure`, `colonnade_forest`, `louver_curtain`)
  if (doc.roof.style !== 'enveloping_shell') {
    const facadeMat = createFacadePbrMaterial(
      mats.facade,
      doc.lighting,
      doc.shape === 'octagonal_arena',
      maxAnisotropy,
      mats.facadeGlowHex
    );
    const structureMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
    const isNight = doc.lighting !== 'day';

    if (envelope === 'exposed_structure') {
      // 1. EXPOSED STRUCTURE: Radial raker A-frames, open elevated concourse walkway & diagonal exterior stair flights!
      const frameCount = Math.max(18, Math.round(52 * arcFraction));
      const concoursePts: THREE.Vector3[] = [];
      for (let s = 0; s < ringCount; s++) {
        const [outerD, crestY] = topCrestPerSlice[s];
        const gradeY = Math.min(sunkenDepth, crestY * 0.65);
        const concY = Math.min(crestY - 2.4, Math.max(gradeY + 4.2, crestY * 0.44));
        const cp = sampleRoundedBowlRing(bowlRing, tAtSlice(s), outerD * 0.8);
        concoursePts.push(new THREE.Vector3(cp.x, concY, cp.z));
      }
      if (concoursePts.length >= 4) {
        const concCurve = new THREE.CatmullRomCurve3(concoursePts, closed);
        group.add(
          new THREE.Mesh(
            new THREE.TubeGeometry(concCurve, activeSegments, 1.45, 6, closed),
            concreteMat
          )
        );
      }

      for (let i = 0; i < frameCount; i++) {
        const frac = closed ? i / frameCount : i / Math.max(1, frameCount - 1);
        const nextFrac = closed
          ? (i + 1) / frameCount
          : Math.min(1, (i + 1) / Math.max(1, frameCount - 1));
        const t = tStart + frac * (tEnd - tStart);
        const tNext = tStart + nextFrac * (tEnd - tStart);
        const sliceIdx = Math.min(ringCount - 1, Math.floor(frac * activeSegments));
        const [outerD, crestY] = topCrestPerSlice[sliceIdx];
        const gradeY = Math.min(sunkenDepth, crestY * 0.65);
        const concY = Math.min(crestY - 2.4, Math.max(gradeY + 4.2, crestY * 0.44));

        const pInFoot = sampleRoundedBowlRing(bowlRing, t, Math.max(3.4, outerD * 0.28));
        const pMidCol = sampleRoundedBowlRing(bowlRing, t, outerD * 0.62);
        const pOutCol = sampleRoundedBowlRing(bowlRing, t, outerD - 0.35);

        group.add(
          // Inclined raker beam directly under the open concrete soffit
          createStrut(
            new THREE.Vector3(pInFoot.x, Math.max(0.2, gradeY * 0.4), pInFoot.z),
            new THREE.Vector3(pOutCol.x, crestY - 1.2, pOutCol.z),
            0.34,
            0.44,
            structureMat,
            6
          ),
          // Outer vertical structural column
          createStrut(
            new THREE.Vector3(pOutCol.x, gradeY, pOutCol.z),
            new THREE.Vector3(pOutCol.x, crestY, pOutCol.z),
            0.32,
            0.38,
            structureMat,
            6
          ),
          // Intermediate vertical support column
          createStrut(
            new THREE.Vector3(pMidCol.x, gradeY, pMidCol.z),
            new THREE.Vector3(pMidCol.x, Math.max(gradeY + 1.5, crestY * 0.48), pMidCol.z),
            0.28,
            0.32,
            structureMat,
            6
          )
        );

        // Diagonal exterior access stairflights on every 2nd structural bay
        if (i % 2 === 0 && crestY - gradeY > 6.5) {
          const pStairA = sampleRoundedBowlRing(bowlRing, t, outerD + 1.1);
          const pStairB = sampleRoundedBowlRing(bowlRing, tNext, outerD + 1.1);
          group.add(
            createStrut(
              new THREE.Vector3(pStairA.x, gradeY + 0.2, pStairA.z),
              new THREE.Vector3(pStairB.x, concY, pStairB.z),
              0.44,
              0.44,
              concreteMat,
              4
            )
          );
          if (crestY - concY > 4.5) {
            group.add(
              createStrut(
                new THREE.Vector3(pStairB.x, concY, pStairB.z),
                new THREE.Vector3(pStairA.x, crestY - 1.8, pStairA.z),
                0.4,
                0.4,
                concreteMat,
                4
              )
            );
          }
        }
      }
    } else if (envelope === 'colonnade_forest') {
      // 2. COLONNADE / FOREST OF SLENDER PERIPHERAL COLUMNS:
      // Recessed concourse glass core + monumental overhanging cornice ring + 3 staggered rings of slender columns!
      const corePos = new Float32Array(ringCount * 2 * 3);
      const coreUvs = new Float32Array(ringCount * 2 * 2);
      const coreIdx: number[] = [];
      const cornicePts: THREE.Vector3[] = [];

      for (let s = 0; s < ringCount; s++) {
        const t = tAtSlice(s);
        const [outerD, crestY] = topCrestPerSlice[s];
        const gradeY = Math.min(sunkenDepth, crestY * 0.65);
        const corePt = sampleRoundedBowlRing(bowlRing, t, outerD - 1.5);
        const cornPt = sampleRoundedBowlRing(bowlRing, t, outerD + 3.2);
        cornicePts.push(new THREE.Vector3(cornPt.x, crestY - 0.3, cornPt.z));

        const idx = s * 6;
        corePos[idx] = corePt.x;
        corePos[idx + 1] = gradeY;
        corePos[idx + 2] = corePt.z;
        corePos[idx + 3] = corePt.x;
        corePos[idx + 4] = crestY - 0.8;
        corePos[idx + 5] = corePt.z;

        const u = (s / activeSegments) * 14;
        coreUvs[s * 4] = u;
        coreUvs[s * 4 + 1] = 0;
        coreUvs[s * 4 + 2] = u;
        coreUvs[s * 4 + 3] = 1;
      }

      for (let s = 0; s < activeSegments; s++) {
        const nxt = closed ? (s + 1) % ringCount : s + 1;
        const a = s * 2;
        const b = nxt * 2;
        const c = nxt * 2 + 1;
        const d = s * 2 + 1;
        coreIdx.push(a, d, b, b, d, c);
      }

      const coreGeo = new THREE.BufferGeometry();
      coreGeo.setAttribute('position', new THREE.BufferAttribute(corePos, 3));
      coreGeo.setAttribute('uv', new THREE.BufferAttribute(coreUvs, 2));
      coreGeo.setIndex(coreIdx);
      coreGeo.computeVertexNormals();
      group.add(new THREE.Mesh(coreGeo, facadeMat));

      if (cornicePts.length >= 4) {
        const cornCurve = new THREE.CatmullRomCurve3(cornicePts, closed);
        const cornMesh = new THREE.Mesh(
          new THREE.TubeGeometry(cornCurve, activeSegments, 2.8, 6, closed),
          structureMat
        );
        cornMesh.scale.set(1, 0.24, 1);
        cornMesh.position.y = topCrestPerSlice[0][1] * 0.76 - 0.2;
        group.add(cornMesh);
      }

      // 3 staggered concentric rings of ultra-slender architectural columns
      const ringOffsets = [0.6, 2.9, 5.2];
      const colsPerRing = Math.max(24, Math.round(58 * arcFraction * colonnadeDensity(mats)));
      const totalCols = colsPerRing * ringOffsets.length;
      const colGeo = new THREE.CylinderGeometry(0.21, 0.24, 1, 10);
      const colForest = new THREE.InstancedMesh(colGeo, structureMat, totalCols);
      colForest.castShadow = true;

      const dummy = new THREE.Object3D();
      let instIdx = 0;
      for (let r = 0; r < ringOffsets.length; r++) {
        const stagger = (r * 0.37) / colsPerRing;
        for (let c = 0; c < colsPerRing; c++) {
          const frac = closed
            ? (c / colsPerRing + stagger) % 1
            : Math.min(1, c / Math.max(1, colsPerRing - 1));
          const t = tStart + frac * (tEnd - tStart);
          const sliceIdx = Math.min(ringCount - 1, Math.floor(frac * activeSegments));
          const [outerD, crestY] = topCrestPerSlice[sliceIdx];
          const gradeY = Math.min(sunkenDepth, crestY * 0.65);
          const colH = Math.max(2.0, crestY - gradeY);
          const cp = sampleRoundedBowlRing(bowlRing, t, outerD + ringOffsets[r]);

          dummy.position.set(cp.x, gradeY + colH / 2, cp.z);
          dummy.scale.set(1, colH, 1);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          colForest.setMatrixAt(instIdx++, dummy.matrix);
        }
      }
      colForest.instanceMatrix.needsUpdate = true;
      colForest.computeBoundingSphere();
      group.add(colForest);
    } else {
      // 3 & 4. `enveloping_skin` (including sculpted pneumatic ETFE cushion curve!) OR `louver_curtain`
      const profile = mats.envelopeProfile ?? 'straight';
      const isEtfeBelly =
        envelope === 'enveloping_skin' && mats.facade === 'etfe_cushions_facade';
      const isShaped = profile !== 'straight' && envelope === 'enveloping_skin';
      const vBands = isShaped ? 9 : isEtfeBelly ? 5 : 2;
      const facadePositions = new Float32Array(ringCount * vBands * 3);
      const facadeUvs = new Float32Array(ringCount * vBands * 2);
      const facadeIndices: number[] = [];

      const turnstilePositions = new Float32Array(ringCount * 2 * 3);
      const turnstileUvs = new Float32Array(ringCount * 2 * 2);
      const turnstileIndices: number[] = [];

      for (let s = 0; s < ringCount; s++) {
        const t = tAtSlice(s);
        const [outerD, crestY] = topCrestPerSlice[s];
        const gradeY = Math.min(sunkenDepth, crestY * 0.65);
        const lobbyTopY = Math.min(crestY - 0.8, gradeY + 3.5);

        for (let b = 0; b < vBands; b++) {
          const vf = b / (vBands - 1);
          const py = lobbyTopY + vf * Math.max(0.5, crestY - lobbyTopY);
          const skinH = Math.max(0.5, crestY - lobbyTopY);
          const bellyOut = isShaped
            ? profile === 'bulging'
              ? // Calabash: swells to a sixth of its height at mid-height
                BOWL_CURTAIN_WALL_OFFSET + Math.sin(vf * Math.PI) * Math.min(7, skinH * 0.17)
              : // Tent: a wide concave foot leaning in to meet the roof at the crest
                BOWL_CURTAIN_WALL_OFFSET + Math.pow(1 - vf, 1.5) * Math.min(16, skinH * 0.55)
            : isEtfeBelly
            ? Math.sin(vf * Math.PI) * 3.8 + vf * 0.8
            : envelope === 'louver_curtain'
            ? -0.25
            : doc.shape === 'steep_cauldron'
            ? 0.12 + vf * 0.25
            : BOWL_CURTAIN_WALL_OFFSET;

          const fp = sampleRoundedBowlRing(bowlRing, t, outerD + bellyOut);
          const pIdx = (s * vBands + b) * 3;
          facadePositions[pIdx] = fp.x;
          facadePositions[pIdx + 1] = py;
          facadePositions[pIdx + 2] = fp.z;

          const uIdx = (s * vBands + b) * 2;
          facadeUvs[uIdx] = (s / activeSegments) * 16;
          facadeUvs[uIdx + 1] = vf;
        }

        const gPt = sampleRoundedBowlRing(bowlRing, t, outerD + 0.85);
        const tIdx = s * 6;
        turnstilePositions[tIdx] = gPt.x;
        turnstilePositions[tIdx + 1] = gradeY;
        turnstilePositions[tIdx + 2] = gPt.z;
        turnstilePositions[tIdx + 3] = gPt.x;
        turnstilePositions[tIdx + 4] = lobbyTopY + 0.05;
        turnstilePositions[tIdx + 5] = gPt.z;

        turnstileUvs[s * 4] = (s / activeSegments) * 24;
        turnstileUvs[s * 4 + 1] = 0;
        turnstileUvs[s * 4 + 2] = (s / activeSegments) * 24;
        turnstileUvs[s * 4 + 3] = 1;
      }

      for (let s = 0; s < activeSegments; s++) {
        const nextS = closed ? (s + 1) % ringCount : s + 1;
        for (let b = 0; b < vBands - 1; b++) {
          const a = s * vBands + b;
          const nb = nextS * vBands + b;
          const nc = nextS * vBands + b + 1;
          const d = s * vBands + b + 1;
          facadeIndices.push(a, d, nb, nb, d, nc);
        }
        const ta = s * 2;
        const tb = nextS * 2;
        const tc = nextS * 2 + 1;
        const td = s * 2 + 1;
        turnstileIndices.push(ta, td, tb, tb, td, tc);
      }

      const facadeGeo = new THREE.BufferGeometry();
      facadeGeo.setAttribute('position', new THREE.BufferAttribute(facadePositions, 3));
      facadeGeo.setAttribute('uv', new THREE.BufferAttribute(facadeUvs, 2));
      facadeGeo.setIndex(facadeIndices);
      facadeGeo.computeVertexNormals();

      const facadeMesh = new THREE.Mesh(facadeGeo, facadeMat);
      facadeMesh.castShadow = true;
      facadeMesh.receiveShadow = true;
      group.add(facadeMesh);

      const turnGeo = new THREE.BufferGeometry();
      turnGeo.setAttribute('position', new THREE.BufferAttribute(turnstilePositions, 3));
      turnGeo.setAttribute('uv', new THREE.BufferAttribute(turnstileUvs, 2));
      turnGeo.setIndex(turnstileIndices);
      turnGeo.computeVertexNormals();

      const turnMat = new THREE.MeshPhysicalMaterial({
        map: turnstileTex,
        emissive: new THREE.Color(isNight ? 0xfbbf24 : 0x000000),
        emissiveMap: turnstileTex,
        emissiveIntensity: isNight ? 0.6 : 0,
        roughness: 0.16,
        metalness: 0.35,
        clearcoat: 0.85,
        side: THREE.DoubleSide,
      });
      group.add(new THREE.Mesh(turnGeo, turnMat));

      if (isRailDressedEnvelope(envelope)) {
        const rail: FacadeRailSample[] = [];
        for (let s = 0; s < ringCount; s++) {
          if (isSliceInOpenCorner(s)) continue;
          const [outerD, crestY] = topCrestPerSlice[s];
          const gradeY = Math.min(sunkenDepth, crestY * 0.65);
          const pt = sampleRoundedBowlRing(bowlRing, tAtSlice(s), outerD + BOWL_CURTAIN_WALL_OFFSET);
          rail.push({ x: pt.x, z: pt.z, nx: pt.nx, nz: pt.nz, yBottom: gradeY, yTop: crestY });
        }
        const dressing = railEnvelopeDressing(
          doc,
          envelope,
          rail,
          closed && !hasCustomCornerCutout,
          facadeMat,
          structureMat
        );
        if (dressing) group.add(dressing);
      } else if (envelope === 'louver_curtain') {
        // Dense horizontal architectural brise-soleil rings wrapping the stadium!
        const louverCount = 7;
        for (let l = 0; l < louverCount; l++) {
          const lf = (l + 0.5) / louverCount;
          const lPts: THREE.Vector3[] = [];
          for (let s = 0; s < ringCount; s++) {
            const [outerD, crestY] = topCrestPerSlice[s];
            const gradeY = Math.min(sunkenDepth, crestY * 0.65);
            const ly = gradeY + 3.6 + lf * Math.max(1, crestY - gradeY - 3.8);
            const p = sampleRoundedBowlRing(bowlRing, tAtSlice(s), outerD + 1.45);
            lPts.push(new THREE.Vector3(p.x, ly, p.z));
          }
          if (lPts.length >= 4) {
            const curve = new THREE.CatmullRomCurve3(lPts, closed);
            group.add(
              new THREE.Mesh(
                new THREE.TubeGeometry(curve, activeSegments, 0.28, 5, closed),
                structureMat
              )
            );
          }
        }
      } else if (!isEtfeBelly && !isShaped) {
        if (doc.shape === 'steep_cauldron') {
          const pierCount = crossSectionClip ? 24 : 48;
          const pierGeo = new THREE.BoxGeometry(1.45, 1, 2.6);
          const piers = new THREE.InstancedMesh(pierGeo, structureMat, pierCount);
          piers.castShadow = true;
          const dummy = new THREE.Object3D();
          for (let i = 0; i < pierCount; i++) {
            const frac = closed ? i / pierCount : i / Math.max(1, pierCount - 1);
            const t = tStart + frac * (tEnd - tStart);
            const sliceIdx = Math.min(ringCount - 1, Math.round(frac * activeSegments));
            const [outerD, crestY] = topCrestPerSlice[sliceIdx];
            const gradeY = Math.min(sunkenDepth, crestY * 0.65);
            const h = Math.max(2, crestY - gradeY);
            const fPt = sampleRoundedBowlRing(bowlRing, t, outerD + 1.1);
            dummy.position.set(fPt.x, gradeY + h / 2, fPt.z);
            dummy.scale.set(1, h + 0.4, 1);
            dummy.rotation.set(0, -fPt.angle + Math.PI / 2, 0);
            dummy.updateMatrix();
            piers.setMatrixAt(i, dummy.matrix);
          }
          piers.instanceMatrix.needsUpdate = true;
          piers.computeBoundingSphere();
          group.add(piers);
        } else if (doc.shape === 'olympic_oval') {
          const maxH = topCrestPerSlice[0][1];
          for (const hFrac of [0.34, 0.66, 0.96]) {
            const louverPts: THREE.Vector3[] = [];
            for (let s = 0; s < ringCount; s++) {
              const [outerD, crestY] = topCrestPerSlice[s];
              const p = sampleRoundedBowlRing(
                bowlRing,
                tAtSlice(s),
                outerD + 0.35 + hFrac * 1.3
              );
              louverPts.push(new THREE.Vector3(p.x, Math.min(crestY, maxH * hFrac), p.z));
            }
            if (louverPts.length >= 4) {
              const curve = new THREE.CatmullRomCurve3(louverPts, closed);
              group.add(
                new THREE.Mesh(
                  new THREE.TubeGeometry(curve, activeSegments, 0.48, 6, closed),
                  structureMat
                )
              );
            }
          }
        } else {
          const rail: FacadeRailSample[] = [];
          for (let s = 0; s < ringCount; s++) {
            if (isSliceInOpenCorner(s)) continue;
            const [outerD, crestY] = topCrestPerSlice[s];
            const gradeY = Math.min(sunkenDepth, crestY * 0.65);
            const pt = sampleRoundedBowlRing(bowlRing, tAtSlice(s), outerD + BOWL_CURTAIN_WALL_OFFSET);
            rail.push({
              x: pt.x,
              z: pt.z,
              nx: pt.nx,
              nz: pt.nz,
              yBottom: Math.min(crestY - 0.8, gradeY + 3.5),
              yTop: crestY,
            });
          }
          const articulation = buildCurtainWallArticulation({
            samples: rail,
            closed: closed && !hasCustomCornerCutout,
            frameMat: structureMat,
          });
          if (articulation) group.add(articulation);
        }
      }
    }

    // Parametric 3D Facade Relief on swept bowl exterior when outer concourse is disabled
    if (
      (doc.concourse?.width ?? 0) <= 0.5 &&
      mats.facadePattern &&
      mats.facadePattern !== 'none'
    ) {
      const bowlRail: FacadeRailSample[] = [];
      for (let s = 0; s < ringCount; s++) {
        if (isSliceInOpenCorner(s)) continue;
        const [outerD, crestY] = topCrestPerSlice[s];
        const gradeY = Math.min(sunkenDepth, crestY * 0.65);
        const pt = sampleRoundedBowlRing(bowlRing, tAtSlice(s), outerD + 1.05);
        bowlRail.push({
          x: pt.x,
          z: pt.z,
          nx: pt.nx,
          nz: pt.nz,
          yBottom: gradeY + 0.3,
          yTop: Math.max(gradeY + 2.0, crestY - 0.15),
        });
      }
      const pat = buildParametricFacadeOnRail({
        samples: bowlRail,
        closed: closed && !hasCustomCornerCutout,
        pattern: mats.facadePattern,
        density: mats.facadeDensity ?? 1.0,
        depth: mats.facadeDepth ?? 0.85,
        bulge: mats.facadeBulge ?? 0,
        primaryMat: facadeMat,
        accentMat: structureMat,
      });
      if (pat) group.add(pat);
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

  const mats = resolveStadiumMaterials(doc);
  const concreteMat = createConcreteBowlMaterial(maxAnisotropy);
  const vipTex = createVipSkyboxTexture(doc.lighting !== 'day');
  const turnstileTex = createConcourseTurnstileTexture(doc.lighting !== 'day');

  if (isContinuousBowlShape(doc.shape)) {
    root.add(
      buildModernBowlSweep(
        doc,
        crossSectionClip,
        concreteMat,
        vipTex,
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
  const cornerModes = resolveAllCorners(doc);
  const rectLayout = computeRectangularCornerLayout({
    shape: doc.shape,
    cornerFill: doc.cornerFill,
    cornerModes,
    crossSectionClip,
    pitchLength: safePitch.length,
    pitchWidth: safePitch.width,
    endTrackOffset: trackOffsets.endOffset,
    sideTrackOffset: trackOffsets.sideOffset,
    stands: {
      north: doc.stands.north,
      south: doc.stands.south,
      east: doc.stands.east,
      west: doc.stands.west,
    },
    cornerFollow: resolveCornerFollow(doc),
  });

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
      facadeMat,
      stand.structureMaterialOverride && stand.structureMaterialOverride !== 'inherit'
        ? createStructurePbrMaterial(stand.structureMaterialOverride, maxAnisotropy)
        : structureMat,
      vipTex,
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
          vipTex,
          turnstileTex
        )
      );
    } else if (cornerSpec.mode === 'building') {
      root.add(
        buildCornerBuildingPavilion(
          cornerSpec,
          doc,
          concreteMat,
          facadeMat,
          structureMat,
          vipTex,
          turnstileTex
        )
      );
    } else if (cornerSpec.mode === 'screen') {
      root.add(
        buildCornerScreenStructure(cornerSpec, doc, concreteMat, structureMat)
      );
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

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  buildShapeBowlRing,
  computeRectangularCornerLayout,
  CornerQuadrantId,
  getBowlArcRange,
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
  createConcreteBowlMaterial,
  createFacadePbrMaterial,
  createPlazaDetailNormalAndRoughness,
  createSeatTerracePbrMaterial,
  createStructurePbrMaterial,
  resolveStadiumMaterials,
} from './materials';
import {
  EnvelopeStyle,
  getEffectiveSunkenDepth,
  isContinuousBowlShape,
  StadiumDocument,
  StandConfig,
  StandSide,
} from './schema';
import { getTierStartRows, tierRiserHeight, UPPER_TIER_STEEPENING } from './sightlines';

interface RowSample {
  d: number;
  y: number;
  tierIdx: number;
  riser: number;
}

interface BalconySample {
  d: number;
  y: number;
  tierIdx: number;
  loggiaD: number;
  loggiaY: number;
  hasVipGlass: boolean;
}

interface TierBandSample {
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

/**
 * Builds the 2D cross-section profile of a stand (1 to 5 tiers) with cantilevered
 * upper-tier overhangs, optional VIP skybox loggias, and optional hollow structural soffit
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

  const tierStarts = getTierStartRows(stand.rows, stand.tiers);
  const hasVipLoges = stand.tiers >= 2 && stand.vipLoges !== false;

  const pushStart = (x: number, y: number) => {
    shape.moveTo(x, y);
    profilePts.push([x, y]);
  };

  const pushSeg = (x: number, y: number, isSeatTread: boolean) => {
    shape.lineTo(x, y);
    profilePts.push([x, y]);
    isSeatSegmentMask.push(isSeatTread);
  };

  pushStart(0, 0);

  // Front pitch-side retaining wall + parapet
  const parapetTop = stand.elevationStart + 0.58;
  pushSeg(0, parapetTop, false);
  pushSeg(0.34, parapetTop, false);
  pushSeg(0.34, stand.elevationStart, false);

  let curD = 0.34;
  let curY = stand.elevationStart;
  let maxOutwardD = curD;

  let bandStartD = curD;
  let bandStartY = curY;
  let bandRows = 0;
  let currentBandTier = 0;

  for (let r = 0; r < stand.rows; r++) {
    const tierIdx = tierStarts.findIndex((sr, idx) =>
      idx === tierStarts.length - 1 ? r >= sr : r >= sr && r < tierStarts[idx + 1]
    );
    const safeTierIdx = Math.max(0, tierIdx);

    if (r > 0 && tierStarts.includes(r)) {
      tierBands.push({
        tierIdx: currentBandTier,
        dStart: bandStartD,
        yStart: bandStartY,
        dEnd: curD,
        yEnd: curY,
      });

      const recessD = curD + (hasVipLoges ? 1.45 : 0.75);
      const loggiaH = hasVipLoges ? 1.95 : 0.95;
      const balconyOverhangD = Math.max(2.2, curD - 1.15);
      const balconyFasciaH = hasVipLoges ? 0.9 : 0.65;

      pushSeg(recessD, curY, false);
      pushSeg(recessD, curY + loggiaH, false);
      pushSeg(balconyOverhangD, curY + loggiaH, false);

      balconies.push({
        d: balconyOverhangD,
        y: curY + loggiaH + balconyFasciaH * 0.5,
        tierIdx: safeTierIdx,
        loggiaD: recessD - 0.15,
        loggiaY: curY + loggiaH * 0.5,
        hasVipGlass: hasVipLoges,
      });

      pushSeg(balconyOverhangD, curY + loggiaH + balconyFasciaH, false);

      maxOutwardD = Math.max(maxOutwardD, recessD);
      curD = balconyOverhangD;
      curY += loggiaH + balconyFasciaH;

      bandStartD = curD;
      bandStartY = curY;
      bandRows = 0;
      currentBandTier = safeTierIdx;
    }

    const riser = tierRiserHeight(stand.riserHeight, safeTierIdx);

    rowPositions.push({
      d: curD + stand.rowDepth * 0.52,
      y: curY,
      tierIdx: safeTierIdx,
      riser,
    });

    curD += stand.rowDepth;
    maxOutwardD = Math.max(maxOutwardD, curD);
    pushSeg(curD, curY, true);

    curY += riser;
    pushSeg(curD, curY, false);

    bandRows++;
  }

  if (bandRows > 0) {
    tierBands.push({
      tierIdx: currentBandTier,
      dStart: bandStartD,
      yStart: bandStartY,
      dEnd: curD,
      yEnd: curY,
    });
  }

  const outerWallD = Math.max(curD, maxOutwardD) + 2.8;
  const topHeight = curY + 1.85;
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

function createVomitoryPortalUnit(
  portalMat: THREE.Material,
  darkMouthMat: THREE.Material,
  railMat: THREE.Material
): THREE.Group {
  const unit = new THREE.Group();

  // Precast architectural concrete vomitory hood & side cheeks
  const hood = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.24, 1.55), portalMat);
  hood.position.set(0, 1.52, 0.35);
  hood.castShadow = true;

  const leftCheek = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.55, 1.55), portalMat);
  leftCheek.position.set(-0.96, 0.77, 0.35);
  leftCheek.castShadow = true;

  const rightCheek = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.55, 1.55), portalMat);
  rightCheek.position.set(0.96, 0.77, 0.35);
  rightCheek.castShadow = true;

  // Deep recessed concourse tunnel mouth
  const darkMouth = new THREE.Mesh(new THREE.BoxGeometry(1.72, 1.38, 1.58), darkMouthMat);
  darkMouth.position.set(0, 0.71, 0.38);

  // Tubular galvanized safety handrail above vomitory brow
  const topGuard = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.06), railMat);
  topGuard.position.set(0, 1.98, -0.35);
  const leftPost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.38, 6), railMat);
  leftPost.position.set(-1.02, 1.8, -0.35);
  const rightPost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.38, 6), railMat);
  rightPost.position.set(1.02, 1.8, -0.35);

  unit.add(hood, leftCheek, rightCheek, darkMouth, topGuard, leftPost, rightPost);
  return unit;
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
  const isHollow =
    doc.roof.style !== 'enveloping_shell' &&
    (envelope === 'exposed_structure' || envelope === 'colonnade_forest');

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

  // 1. Multi-material stepped concrete + 1:1 life-size seat terrace bowl (`+Y` upward treads, `-Z` pitch risers)
  const uRepeat = Math.max(1, Math.round(spanLength / 46));
  const vRepeat = Math.max(1.0, stand.rows / 24);
  const straightBowlGeo = buildMultiMaterialSweptStandGeometry(
    2,
    1,
    false,
    [profilePts, profilePts],
    (s, radD, py) => {
      const lx = s === 0 ? spanLength * 0.5 : -spanLength * 0.5;
      return [lx, py, radD];
    },
    isSeatSegmentMask,
    uRepeat,
    vRepeat
  );

  const seats3d = mats.seats3d !== false;
  const bowlMesh = new THREE.Mesh(straightBowlGeo, [concreteMat, seats3d ? concreteMat : seatMat]);
  bowlMesh.castShadow = true;
  bowlMesh.receiveShadow = true;
  group.add(bowlMesh);

  if (seats3d && stand.seatingType !== 'safe_standing') {
    const seats = buildSweepSeatInstances({
      ringCount: 2,
      activeSegments: 1,
      closed: false,
      profilePtsPerSlice: [profilePts, profilePts],
      sampleWorldPoint: (s, radD, py) => [s === 0 ? spanLength * 0.5 : -spanLength * 0.5, py, radD],
      isSeatSegmentMask,
      rowDepth: stand.rowDepth,
      seatWidth: stand.seatWidth,
      aisleCount: stand.aisleCount,
      aisleWidth: stand.aisleWidth,
      primaryHex: doc.colors.seatsPrimary,
      secondaryHex: doc.colors.seatsSecondary,
    });
    if (seats) group.add(seats);
  }

  // 2. Open-End Concrete Gable Walls & Stepped Side Safety Balustrades ONLY on genuinely open ends!
  //    (Never emitted inside closed corners -> 0 concrete wall artifacts in corners!)
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

      // Stepped side safety balustrade along open terrace flanks
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

  // 3. Pitch-Side Laminated Glass Safety Guardrail + Stainless Stanchions
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

  // 5. 3D Precast Architectural Vomitory Portals & Concourse Tunnels
  const vomPortalMat = new THREE.MeshStandardMaterial({
    color: 0xdbe2ea,
    roughness: 0.72,
    metalness: 0.08,
  });
  const darkVomMat = new THREE.MeshStandardMaterial({
    color: 0x030712,
    roughness: 0.96,
  });
  const vomRailMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.28,
    metalness: 0.85,
  });

  const vomCount = Math.max(3, Math.min(8, Math.round(spanLength / 18)));
  for (const band of tierBands) {
    if (band.dEnd - band.dStart < 5.2 || band.yEnd - band.yStart < 2.2) continue;
    const vomFrac = 0.44;
    const vd = band.dStart + (band.dEnd - band.dStart) * vomFrac;
    const vy = band.yStart + (band.yEnd - band.yStart) * vomFrac;
    for (let v = 0; v < vomCount; v++) {
      const vx = -spanLength * 0.5 + ((v + 0.5) / vomCount) * spanLength;
      if (stand.id === 'south' && band.tierIdx === 0 && Math.abs(vx) < 6.5) continue;
      const portal = createVomitoryPortalUnit(vomPortalMat, darkVomMat, vomRailMat);
      portal.position.set(vx, vy, vd);
      group.add(portal);
    }
  }

  const dummy = new THREE.Object3D();

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

  // Stacked Cantilevered Balconies + Optional Glazed VIP Skyboxes
  if (balconies.length > 0) {
    const fasciaSlabMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.34,
      metalness: 0.16,
    });
    const ledRibbonMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      emissive: new THREE.Color(doc.colors.seatsSecondary),
      emissiveIntensity: doc.lighting === 'day' ? 0.25 : 0.95,
      roughness: 0.2,
      metalness: 0.4,
    });
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
        new THREE.BoxGeometry(spanLength - 0.08, bal.hasVipGlass ? 0.85 : 0.58, 0.4),
        fasciaSlabMat
      );
      whiteFascia.position.set(0, bal.y, bal.d - 0.04);
      whiteFascia.castShadow = true;
      group.add(whiteFascia);

      const ledStrip = new THREE.Mesh(
        new THREE.BoxGeometry(spanLength - 0.06, 0.26, 0.12),
        ledRibbonMat
      );
      ledStrip.position.set(0, bal.y, bal.d - 0.25);
      group.add(ledStrip);

      if (bal.hasVipGlass) {
        const skyboxGlass = new THREE.Mesh(
          new THREE.BoxGeometry(spanLength - 0.12, 1.8, 0.32),
          vipGlassMat
        );
        skyboxGlass.position.set(0, bal.loggiaY, bal.loggiaD);
        group.add(skyboxGlass);
      }
    }
  }

  if (stand.id === 'south') {
    group.add(createPlayersTunnelPortal());
  }

  // Exterior Envelope Architecture (above `gradeY`)
  const wallH = Math.max(2.0, topHeight - gradeY);
  const isNight = doc.lighting !== 'day';
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

      const colsPerRow = Math.max(12, Math.floor(spanLength / 4.2));
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

  return group;
}

function buildMultiMaterialSweptStandGeometry(
  ringCount: number,
  activeSegments: number,
  closed: boolean,
  profilePtsPerSlice: [number, number][][],
  sampleWorldPoint: (sliceIdx: number, radD: number, py: number) => [number, number, number],
  isSeatSegmentMask: boolean[],
  uRepeat: number,
  vRepeat: number = 2.2
): THREE.BufferGeometry {
  const pCount = profilePtsPerSlice[0].length;
  const positions = new Float32Array(ringCount * pCount * 3);
  const uvs = new Float32Array(ringCount * pCount * 2);

  let seatSegTotal = 0;
  for (const flag of isSeatSegmentMask) if (flag) seatSegTotal++;

  for (let s = 0; s < ringCount; s++) {
    const pts = profilePtsPerSlice[s];
    let seatProgress = 0;
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
      uvs[uvBase] = (s / Math.max(1, activeSegments)) * uRepeat;
      uvs[uvBase + 1] =
        seatSegTotal > 0 ? (seatProgress / seatSegTotal) * vRepeat : p / (pCount - 1);
    }
  }

  const concreteIndices: number[] = [];
  const seatIndices: number[] = [];

  for (let s = 0; s < activeSegments; s++) {
    const nextS = closed ? (s + 1) % ringCount : s + 1;
    for (let p = 0; p < pCount - 1; p++) {
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

/** One seat in metres, facing -Z: pedestal, pan and a back tilted away from the pitch. */
let seatGeometryCache: THREE.BufferGeometry | null = null;
function getSeatGeometry(): THREE.BufferGeometry {
  if (seatGeometryCache) return seatGeometryCache;
  const pedestal = new THREE.BoxGeometry(0.07, 0.36, 0.07);
  pedestal.translate(0, 0.18, 0.06);
  const pan = new THREE.BoxGeometry(0.44, 0.05, 0.4);
  pan.translate(0, 0.4, 0);
  const back = new THREE.BoxGeometry(0.44, 0.42, 0.045);
  back.rotateX(-0.16);
  back.translate(0, 0.64, 0.2);
  const merged = mergeGeometries([pedestal, pan, back]);
  pedestal.dispose();
  pan.dispose();
  back.dispose();
  seatGeometryCache = merged ?? new THREE.BoxGeometry(0.44, 0.5, 0.4);
  return seatGeometryCache;
}

/** Shared seat material; instance colours carry the club palette. */
let seatMaterialCache: THREE.MeshStandardMaterial | null = null;
function getSeatMaterial(): THREE.MeshStandardMaterial {
  seatMaterialCache ??= new THREE.MeshStandardMaterial({ roughness: 0.48, metalness: 0.02 });
  return seatMaterialCache;
}

/**
 * Places individual seats on every seat tread of a swept stand, using the same profile slices and
 * world mapping as `buildMultiMaterialSweptStandGeometry`. Seats are spaced by `seatWidth`, leave
 * radial aisles empty, fill deep treads with several rows, and alternate club colours per tier.
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
}): THREE.InstancedMesh | null {
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

  type SeatRow = { p: number; f: number };
  const rows: SeatRow[] = [];
  const ref = profilePtsPerSlice[0];
  isSeatSegmentMask.forEach((isSeat, p) => {
    if (!isSeat) return;
    const treadDepth = Math.abs(ref[p + 1][0] - ref[p][0]);
    const count = Math.max(1, Math.round(treadDepth / Math.max(0.6, rowDepth)));
    for (let k = 0; k < count; k++) rows.push({ p, f: (k + 0.52) / count });
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

  const placements: { m: THREE.Matrix4; tier: number }[] = [];
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
    const aisleAt = Array.from({ length: Math.max(0, aisleCount) }, (_, k) => ((k + 0.5) / aisleCount) * total);

    let run = 0;
    let carry = pitch * 0.5;
    for (let s = 0; s < activeSegments; s++) {
      const len = segLens[s];
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
        placements.push({ m, tier: tierOfSegment[row.p] });
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
  placements.forEach(({ m, tier: t }, i) => {
    mesh.setMatrixAt(i, m);
    // Slight per-seat value drift reads as sun-faded plastic instead of a flat fill.
    const jitter = 0.92 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.14;
    tint.copy(t % 2 === 0 ? primary : secondary).multiplyScalar(jitter);
    mesh.setColorAt(i, tint);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  mesh.name = 'Seats';
  return mesh;
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

  const standA = doc.stands[corner.sideA];
  const standB = doc.stands[corner.sideB];

  const mats = resolveStadiumMaterials(doc);
  const envelope: EnvelopeStyle = mats.envelopeStyle ?? 'enveloping_skin';
  const isHollow =
    doc.roof.style !== 'enveloping_shell' &&
    (envelope === 'exposed_structure' || envelope === 'colonnade_forest');

  const profA = buildStandProfilePoints(standA, isHollow);
  const profB = buildStandProfilePoints(standB, isHollow);

  const sunkenDepth = getEffectiveSunkenDepth(doc);
  const isNight = doc.lighting !== 'day';

  // 18 smooth slices for curved `compact_urban`, 15 slices (3 planar bays x 5 sub-slices) for `english_rectangular`
  const segs = corner.facetedThreeBay ? 15 : 18;
  const nSteps = Math.max(16, Math.min(76, Math.max(standA.rows, standB.rows)));
  const maxTiers = Math.max(standA.tiers, standB.tiers) as 1 | 2 | 3 | 4 | 5;
  const breakRows = maxTiers >= 2 ? getTierStartRows(nSteps, maxTiers).slice(1) : [];
  const breakRowSet = new Set(breakRows);

  // Build exact canonical `isSeatSegmentMask` shared by all `segs + 1` slices
  const isSeatMask: boolean[] = [false, false, false];
  for (let k = 0; k < nSteps; k++) {
    if (breakRowSet.has(k)) {
      isSeatMask.push(false, false, false, false);
    }
    isSeatMask.push(true, false);
  }
  isSeatMask.push(false, false); // crest parapet & top deck
  if (isHollow) {
    isSeatMask.push(false, false, false);
  } else {
    isSeatMask.push(false);
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

  for (let s = 0; s <= segs; s++) {
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
      const loggiaH = weight * (hasVip ? 1.95 : 0.95);
      const overhangDelta = -weight * 1.15;
      const fasciaH = weight * (hasVip ? 0.9 : 0.65);
      return {
        rowK,
        weight,
        hasVip,
        recessAdd,
        loggiaH,
        overhangDelta,
        fasciaH,
      };
    });

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
  cornerMesh.castShadow = true;
  cornerMesh.receiveShadow = true;
  group.add(cornerMesh);

  if (cornerSeats3d) {
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
    for (const uSeam of [1 / 3, 2 / 3]) {
      const sIdx = Math.round(uSeam * segs);
      const rBot = rowSamplesPerSlice[sIdx][0];
      const rTop = rowSamplesPerSlice[sIdx][nSteps - 1];
      if (rBot && rTop) {
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
    color: 0xdbe2ea,
    roughness: 0.72,
    metalness: 0.08,
  });
  const darkVomMat = new THREE.MeshStandardMaterial({
    color: 0x030712,
    roughness: 0.96,
  });
  const vomRailMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
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
    const ledRibbonMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      emissive: new THREE.Color(doc.colors.seatsSecondary),
      emissiveIntensity: doc.lighting === 'day' ? 0.25 : 0.95,
      roughness: 0.2,
      metalness: 0.4,
    });
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
        const lp = sampleCornerQuadrantPoint(corner, u, bal.d - 0.26);
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
        group.add(
          new THREE.Mesh(
            new THREE.TubeGeometry(lCurve, ledPts.length * 2, 0.14, 6, false),
            ledRibbonMat
          )
        );
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

      const finCount = corner.facetedThreeBay ? 4 : 6;
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

  const bowlRing = buildShapeBowlRing(
    doc.shape,
    doc.pitch.length,
    doc.pitch.width,
    avgDistX,
    avgDistZ,
    trackOffsets.endOffset,
    trackOffsets.sideOffset,
    doc.pitch.hasTrack
  );

  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const activeSegments = Math.max(36, Math.round(segments * arcFraction));
  const ringCount = closed ? activeSegments : activeSegments + 1;

  const tAtSlice = (s: number) => tStart + (s / activeSegments) * (tEnd - tStart);

  const sectorWeightsAt = (nx: number, nz: number) => {
    const wE = doc.shape === 'horseshoe' ? 0 : Math.pow(Math.max(0, nx), 2.2);
    const wW = Math.pow(Math.max(0, -nx), 2.2);
    const wS = Math.pow(Math.max(0, nz), 2.2);
    const wN = Math.pow(Math.max(0, -nz), 2.2);
    const sum = wE + wW + wS + wN || 1;
    return { e: wE / sum, s: wS / sum, w: wW / sum, n: wN / sum };
  };

  const dominantSideAt = (nx: number, nz: number): StandSide => {
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

  const balconyOverhangDist = doc.shape === 'steep_cauldron' ? -1.35 : -0.9;
  const profilePtsPerSlice: [number, number][][] = [];
  const topCrestPerSlice: [number, number][] = [];

  for (let s = 0; s < ringCount; s++) {
    const t = tAtSlice(s);
    const baseSample = sampleRoundedBowlRing(bowlRing, t, 0);

    const env = evalStandEnvelopeAt(baseSample.nx, baseSample.nz);
    const domSide = dominantSideAt(baseSample.nx, baseSample.nz);
    const domStand = doc.stands[domSide];
    const domTiers = domStand.enabled ? domStand.tiers : 1;
    const domVip = domTiers >= 2 && domStand.vipLoges !== false;
    const breakUnitH = domVip ? 2.4 : 1.45;

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

    const activeBreaksCount = activeBreakSlots.length;
    const balconyVerticalTotal = activeBreaksCount * breakUnitH;
    const balconyNetHorizontal = activeBreaksCount * balconyOverhangDist;

    const netStepsDepth = Math.max(4, env.depth - 3.15 - balconyNetHorizontal);
    const netStepsRise = Math.max(
      2,
      env.height * (doc.shape === 'steep_cauldron' ? 1.06 : 1.0) -
        2.75 -
        balconyVerticalTotal
    );

    const stepD = netStepsDepth / N_TERRACE_STEPS;
    const baseStepRise = netStepsRise / N_TERRACE_STEPS;

    const pts: [number, number][] = [];
    pts.push([0, 0]);
    pts.push([0, 1.5]);
    pts.push([0.36, 1.5]);
    pts.push([0.36, 0.92]);

    let curD = 0.36;
    let curY = 0.92;
    let maxD = curD;

    for (let k = 0; k < N_TERRACE_STEPS; k++) {
      if (k === 6 || k === 12 || k === 18 || k === 24) {
        if (activeBreakSlots.includes(k)) {
          const recD = curD + (domVip ? 1.35 : 0.75);
          const overD = Math.max(2.0, curD + balconyOverhangDist);
          const logH = domVip ? 1.65 : 0.9;
          pts.push([recD, curY]);
          pts.push([recD, curY + logH]);
          pts.push([overD, curY + logH]);
          pts.push([overD, curY + breakUnitH]);
          maxD = Math.max(maxD, recD);
          curD = overD;
          curY += breakUnitH;
        } else {
          pts.push([curD, curY]);
          pts.push([curD, curY]);
          pts.push([curD, curY]);
          pts.push([curD, curY]);
        }
      }

      const stepFactor =
        doc.shape === 'steep_cauldron'
          ? 0.82 + (k / N_TERRACE_STEPS) * 0.38
          : doc.shape === 'olympic_oval'
          ? 0.92 + (k / N_TERRACE_STEPS) * 0.16
          : 0.86 + (k / N_TERRACE_STEPS) * 0.28;
      const thisRise = baseStepRise * stepFactor;

      curD += stepD;
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
    Math.max(10, Math.round(18 * arcFraction))
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
    });
    if (seats) group.add(seats);
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
  const ledRibbonMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    emissive: new THREE.Color(doc.colors.seatsSecondary),
    emissiveIntensity: doc.lighting === 'day' ? 0.25 : 0.95,
    roughness: 0.22,
  });
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

      const ledCurve = new THREE.CatmullRomCurve3(
        runFascia.map((p) => new THREE.Vector3(p.x * 0.997, p.y - 0.28, p.z * 0.997)),
        looped,
        doc.shape === 'octagonal_arena' ? 'centripetal' : 'catmullrom',
        doc.shape === 'octagonal_arena' ? 0.05 : 0.5
      );
      group.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(ledCurve, Math.max(16, runFascia.length * 2), 0.16, 6, looped),
          ledRibbonMat
        )
      );

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
      maxAnisotropy
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
      const colsPerRing = Math.max(24, Math.round(58 * arcFraction));
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
      const isEtfeBelly =
        envelope === 'enveloping_skin' && mats.facade === 'etfe_cushions_facade';
      const vBands = isEtfeBelly ? 5 : 2;
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
          const bellyOut = isEtfeBelly
            ? Math.sin(vf * Math.PI) * 3.8 + vf * 0.8
            : envelope === 'louver_curtain'
            ? -0.25
            : 0.12 + vf * (doc.shape === 'steep_cauldron' ? 0.25 : 1.25);

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

      if (envelope === 'louver_curtain') {
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
      } else if (!isEtfeBelly) {
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
          const finCount = Math.max(20, Math.round(64 * arcFraction));
          const finGeo = new THREE.BoxGeometry(0.55, 1, 2.2);
          const fins = new THREE.InstancedMesh(finGeo, structureMat, finCount);
          fins.castShadow = true;

          const dummy = new THREE.Object3D();
          for (let i = 0; i < finCount; i++) {
            const frac = closed ? i / finCount : i / Math.max(1, finCount - 1);
            const sliceIdx = Math.min(ringCount - 1, Math.floor(frac * activeSegments));
            const t = tStart + frac * (tEnd - tStart);
            const [outerD, crestY] = topCrestPerSlice[sliceIdx];
            const gradeY = Math.min(sunkenDepth, crestY * 0.65);
            const h = Math.max(2, crestY - gradeY);
            const fPt = sampleRoundedBowlRing(bowlRing, t, outerD + 0.95);

            dummy.position.set(fPt.x, gradeY + h / 2, fPt.z);
            dummy.scale.set(1, h, 1);
            dummy.rotation.set(
              0,
              -fPt.angle + Math.PI / 2,
              doc.shape === 'octagonal_arena' ? 0 : i % 2 === 0 ? 0.08 : -0.08
            );
            dummy.updateMatrix();
            fins.setMatrixAt(i, dummy.matrix);
          }
          fins.instanceMatrix.needsUpdate = true;
          fins.computeBoundingSphere();
          group.add(fins);
        }
      }
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
    maxAnisotropy
  );
  const structureMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);

  const rectLayout = computeRectangularCornerLayout({
    shape: doc.shape,
    cornerFill: doc.cornerFill,
    crossSectionClip,
    pitchLength: doc.pitch.length,
    pitchWidth: doc.pitch.width,
    endTrackOffset: trackOffsets.endOffset,
    sideTrackOffset: trackOffsets.sideOffset,
    stands: {
      north: doc.stands.north,
      south: doc.stands.south,
      east: doc.stands.east,
      west: doc.stands.west,
    },
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
      structureMat,
      vipTex,
      turnstileTex
    );

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

  if (rectLayout.closedCornersMode) {
    const cornerSeatMat = createSeatTerracePbrMaterial(
      mats.seatFinish,
      doc.colors.seatsPrimary,
      doc.colors.seatsSecondary,
      4,
      maxAnisotropy,
      false
    );

    const cornerOrder: CornerQuadrantId[] = ['se', 'sw', 'nw', 'ne'];
    for (const cId of cornerOrder) {
      const cornerSpec = rectLayout.corners[cId];
      if (!cornerSpec.active) continue;

      const virage = buildCornerVirageQuadrant(
        cornerSpec,
        doc,
        cornerSeatMat,
        concreteMat,
        facadeMat,
        structureMat,
        vipTex,
        turnstileTex
      );
      root.add(virage);
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
      doc.pitch.length,
      doc.pitch.width,
      avgDistX,
      avgDistZ,
      trackOffsets.endOffset,
      trackOffsets.sideOffset,
      doc.pitch.hasTrack
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

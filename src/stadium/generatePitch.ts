import * as THREE from 'three';
import { buildMovablePitch } from './generateMovablePitch';
import {
  applyTurfCloseUpDetail,
  createGrassBladeNormalMap,
  createLedSponsorRibbonTexture,
  createTrackPbrMaterial,
  getTurfPresetColors,
} from './materials';
import {
  clampPitchToTrack,
  DEFAULT_STADIUM_MATERIALS,
  getTrackGeometry,
  LightingMode,
  OfficialTrackGeometry,
  PitchConfig,
  PitchTurfMaterialId,
  StadiumColors,
  StadiumMaterialsConfig,
} from './schema';

/**
 * Generates high-resolution broadcast-grade FIFA football pitch diffuse + directional mowing roughness map:
 * - Natural UEFA mowing stripes / checker with directional blade roughness sheen contrast
 * - Authentic goal-mouth & center-circle turf wear calibrated to turf material preset
 * - Crisp FIFA markings, penalty arcs, corner arcs, and technical coaching areas
 */
function createPitchTextures(
  pitch: PitchConfig,
  turfId: PitchTurfMaterialId,
  maxAnisotropy: number,
  effectiveMarginEnd: number,
  effectiveMarginSide: number
): { colorMap: THREE.CanvasTexture; roughnessMap: THREE.DataTexture } {
  const totalW = pitch.length + effectiveMarginEnd * 2;
  const totalH = pitch.width + effectiveMarginSide * 2;
  const turfColors = getTurfPresetColors(turfId);

  // ~30 px/m keeps 12 cm markings crisp at touchline camera distance.
  const pxPerMeter = 30;
  const cw = Math.min(4096, Math.max(1024, Math.round(totalW * pxPerMeter)));
  const ch = Math.min(4096, Math.max(1024, Math.round(totalH * pxPerMeter)));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;

  const scaleX = cw / totalW;
  const scaleY = ch / totalH;

  // 1. Perimeter grass surround (or narrow technical moat border on non-track pitches)
  ctx.fillStyle = pitch.hasTrack ? turfColors.surround : '#243242';
  ctx.fillRect(0, 0, cw, ch);

  const px0 = effectiveMarginEnd * scaleX;
  const py0 = effectiveMarginSide * scaleY;
  const pw = pitch.length * scaleX;
  const ph = pitch.width * scaleY;

  // Hybrid synthetic green surround border around touchlines/goallines
  const greenBorderX = pitch.hasTrack ? effectiveMarginEnd : Math.min(effectiveMarginEnd, 4.2);
  const greenBorderY = pitch.hasTrack ? effectiveMarginSide : Math.min(effectiveMarginSide, 3.8);
  ctx.fillStyle = turfColors.surround;
  ctx.fillRect(
    px0 - greenBorderX * scaleX,
    py0 - greenBorderY * scaleY,
    pw + greenBorderX * 2 * scaleX,
    ph + greenBorderY * 2 * scaleY
  );

  // Inner natural grass run-off
  ctx.fillStyle = turfColors.primary;
  ctx.fillRect(
    px0 - 2.1 * scaleX,
    py0 - 1.9 * scaleY,
    pw + 4.2 * scaleX,
    ph + 3.8 * scaleY
  );

  // 2. UEFA Mowing pattern inside field
  if (pitch.grassPattern === 'stripes') {
    const stripeCount = 18;
    const stripeW = pw / stripeCount;
    for (let i = 0; i < stripeCount; i++) {
      ctx.fillStyle = i % 2 === 0 ? turfColors.primary : turfColors.secondary;
      ctx.fillRect(
        px0 + i * stripeW,
        py0 - 1.2 * scaleY,
        stripeW + 0.6,
        ph + 2.4 * scaleY
      );
    }
  } else if (pitch.grassPattern === 'checker') {
    const cols = 18;
    const rows = 12;
    const cellW = pw / cols;
    const cellH = ph / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle =
          (r + c) % 2 === 0 ? turfColors.primary : turfColors.secondary;
        ctx.fillRect(px0 + c * cellW, py0 + r * cellH, cellW + 0.6, cellH + 0.6);
      }
    }
  } else {
    ctx.fillStyle = turfColors.secondary;
    ctx.fillRect(px0, py0, pw, ph);
  }

  // Goal-mouth & center-circle organic turf wear
  const midX = px0 + pw / 2;
  const midY = py0 + ph / 2;
  if (turfColors.wearOpacity > 0.04) {
    for (const gx of [px0 + 2.4 * scaleX, px0 + pw - 2.4 * scaleX]) {
      const wearGrad = ctx.createRadialGradient(
        gx,
        midY,
        2,
        gx,
        midY,
        6.5 * scaleX
      );
      wearGrad.addColorStop(0, `rgba(116, 86, 48, ${turfColors.wearOpacity})`);
      wearGrad.addColorStop(1, 'rgba(116, 86, 48, 0)');
      ctx.fillStyle = wearGrad;
      ctx.beginPath();
      ctx.arc(gx, midY, 6.5 * scaleX, 0, Math.PI * 2);
      ctx.fill();
    }
    if (turfId === 'winter_worn') {
      const centerWear = ctx.createRadialGradient(
        midX,
        midY,
        3,
        midX,
        midY,
        9.5 * scaleX
      );
      centerWear.addColorStop(0, 'rgba(112, 84, 46, 0.22)');
      centerWear.addColorStop(1, 'rgba(112, 84, 46, 0)');
      ctx.fillStyle = centerWear;
      ctx.beginPath();
      ctx.arc(midX, midY, 9.5 * scaleX, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Organic grass micro-grain
  for (let i = 0; i < 7500; i++) {
    const rx = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
    const ry = Math.abs((Math.cos(i * 78.233) * 29432.1234) % 1);
    ctx.fillStyle =
      i % 2 === 0 ? 'rgba(255,255,255,0.036)' : 'rgba(0,0,0,0.045)';
    ctx.fillRect(rx * cw, ry * ch, 2.0, 2.0);
  }

  // 3. Crisp white FIFA pitch markings (12 cm line width)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = Math.max(2.4, 0.13 * scaleX);

  ctx.strokeRect(px0, py0, pw, ph);

  ctx.beginPath();
  ctx.moveTo(midX, py0);
  ctx.lineTo(midX, py0 + ph);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(midX, midY, 9.15 * scaleX, 9.15 * scaleY, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(midX, midY, 0.26 * scaleX, 0.26 * scaleY, 0, 0, Math.PI * 2);
  ctx.fill();

  const penDepth = 16.5 * scaleX;
  const penWidth = Math.min(pitch.width * 0.85, 40.32) * scaleY;
  const goalAreaDepth = 5.5 * scaleX;
  const goalAreaWidth = Math.min(pitch.width * 0.5, 18.32) * scaleY;

  ctx.strokeRect(px0, midY - penWidth / 2, penDepth, penWidth);
  ctx.strokeRect(px0, midY - goalAreaWidth / 2, goalAreaDepth, goalAreaWidth);

  ctx.strokeRect(px0 + pw - penDepth, midY - penWidth / 2, penDepth, penWidth);
  ctx.strokeRect(
    px0 + pw - goalAreaDepth,
    midY - goalAreaWidth / 2,
    goalAreaDepth,
    goalAreaWidth
  );

  const penSpotOffset = 11.0 * scaleX;
  const arcAngle = Math.acos(5.5 / 9.15);

  ctx.beginPath();
  ctx.ellipse(
    px0 + penSpotOffset,
    midY,
    0.24 * scaleX,
    0.24 * scaleY,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    px0 + penSpotOffset,
    midY,
    9.15 * scaleX,
    9.15 * scaleY,
    0,
    -arcAngle,
    arcAngle
  );
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(
    px0 + pw - penSpotOffset,
    midY,
    0.24 * scaleX,
    0.24 * scaleY,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    px0 + pw - penSpotOffset,
    midY,
    9.15 * scaleX,
    9.15 * scaleY,
    0,
    Math.PI - arcAngle,
    Math.PI + arcAngle
  );
  ctx.stroke();

  const cornerR = 1.0;
  const corners: [number, number, number, number][] = [
    [px0, py0, 0, Math.PI / 2],
    [px0 + pw, py0, Math.PI / 2, Math.PI],
    [px0 + pw, py0 + ph, Math.PI, Math.PI * 1.5],
    [px0, py0 + ph, Math.PI * 1.5, Math.PI * 2],
  ];
  for (const [cx, cy, a0, a1] of corners) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, cornerR * scaleX, cornerR * scaleY, 0, a0, a1);
    ctx.stroke();
  }

  // Technical Coaching Areas
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = Math.max(1.5, 0.1 * scaleX);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  const techW = 14 * scaleX;
  const techD = Math.min(effectiveMarginSide - 0.6, 3.6) * scaleY;
  if (techD > 0.5) {
    ctx.strokeRect(midX - 18 * scaleX, py0 + ph + 0.5 * scaleY, techW, techD);
    ctx.strokeRect(midX + 4 * scaleX, py0 + ph + 0.5 * scaleY, techW, techD);
  }
  ctx.restore();

  const colorMap = new THREE.CanvasTexture(canvas);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.anisotropy = maxAnisotropy;
  colorMap.needsUpdate = true;

  // Directional mowing-stripe PBR roughness map (bent grass blades reflect specular light differently!)
  const rw = 256;
  const rh = 128;
  const roughBytes = new Uint8Array(rw * rh * 4);
  const uStart = effectiveMarginEnd / totalW;
  const uEnd = 1 - uStart;
  const vStart = effectiveMarginSide / totalH;
  const vEnd = 1 - vStart;

  for (let y = 0; y < rh; y++) {
    const v = y / rh;
    for (let x = 0; x < rw; x++) {
      const u = x / rw;
      let rVal = 0.86; // outer technical apron

      if (u >= uStart && u <= uEnd && v >= vStart && v <= vEnd) {
        const fu = (u - uStart) / Math.max(0.01, uEnd - uStart);
        const fv = (v - vStart) / Math.max(0.01, vEnd - vStart);
        if (pitch.grassPattern === 'stripes') {
          const sIdx = Math.floor(fu * 18);
          rVal = sIdx % 2 === 0 ? 0.58 : 0.79;
        } else if (pitch.grassPattern === 'checker') {
          const sIdx = Math.floor(fu * 18) + Math.floor(fv * 12);
          rVal = sIdx % 2 === 0 ? 0.58 : 0.79;
        } else {
          rVal = 0.68;
        }
        if (turfId === 'hybrid_emerald') rVal -= 0.05;
      }

      const b = Math.round(Math.max(0.2, Math.min(0.98, rVal)) * 255);
      const idx = (y * rw + x) * 4;
      roughBytes[idx] = b;
      roughBytes[idx + 1] = b;
      roughBytes[idx + 2] = b;
      roughBytes[idx + 3] = 255;
    }
  }

  const roughnessMap = new THREE.DataTexture(roughBytes, rw, rh, THREE.RGBAFormat);
  roughnessMap.generateMipmaps = true;
  roughnessMap.minFilter = THREE.LinearMipmapLinearFilter;
  roughnessMap.magFilter = THREE.LinearFilter;
  roughnessMap.needsUpdate = true;

  return { colorMap, roughnessMap };
}

/**
 * Generates woven hexagonal FIFA goal-net texture (clean white cords on transparent alpha).
 */
function createGoalNetTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, 256);

  ctx.strokeStyle = 'rgba(248, 250, 252, 0.85)';
  ctx.lineWidth = 2.1;
  const step = 16;
  for (let i = -256; i <= 512; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 256, 256);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(i, 256);
    ctx.lineTo(i + 256, 0);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 2.5);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Sloped broadcast FIFA Goal with hexagonal woven net, curved top D-brackets & rear ground frame.
 */
function createGoalGroup(sideSign: -1 | 1, netTex: THREE.CanvasTexture): THREE.Group {
  const goal = new THREE.Group();
  const goalWidth = 7.32;
  const goalHeight = 2.44;
  const topDepth = 0.95;
  const bottomDepth = 2.15;

  const postMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.18,
    metalness: 0.35,
  });

  const postGeo = new THREE.CylinderGeometry(0.06, 0.06, goalHeight, 12);
  const leftPost = new THREE.Mesh(postGeo, postMat);
  leftPost.position.set(0, goalHeight / 2, -goalWidth / 2);
  leftPost.castShadow = true;

  const rightPost = new THREE.Mesh(postGeo, postMat);
  rightPost.position.set(0, goalHeight / 2, goalWidth / 2);
  rightPost.castShadow = true;

  const crossbarGeo = new THREE.CylinderGeometry(0.06, 0.06, goalWidth + 0.12, 12);
  crossbarGeo.rotateX(Math.PI / 2);
  const crossbar = new THREE.Mesh(crossbarGeo, postMat);
  crossbar.position.set(0, goalHeight, 0);
  crossbar.castShadow = true;

  const rearSupportMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.35,
    metalness: 0.75,
  });
  const backFrameGeo = new THREE.CylinderGeometry(0.04, 0.04, goalWidth + 0.2, 8);
  backFrameGeo.rotateX(Math.PI / 2);
  const backBottomBar = new THREE.Mesh(backFrameGeo, rearSupportMat);
  backBottomBar.position.set(sideSign * bottomDepth, 0.05, 0);

  for (const zSign of [-1, 1] as const) {
    const topArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, topDepth, 8),
      rearSupportMat
    );
    topArm.rotation.z = Math.PI / 2;
    topArm.position.set(
      (sideSign * topDepth) / 2,
      goalHeight - 0.04,
      zSign * (goalWidth / 2)
    );
    goal.add(topArm);
  }

  const netMat = new THREE.MeshStandardMaterial({
    map: netTex,
    roughness: 0.85,
    metalness: 0.05,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const roofNet = new THREE.Mesh(new THREE.PlaneGeometry(topDepth, goalWidth), netMat);
  roofNet.rotation.x = -Math.PI / 2;
  roofNet.position.set((sideSign * topDepth) / 2, goalHeight, 0);

  const slopeLen = Math.hypot(bottomDepth - topDepth, goalHeight);
  const slopeAngle = Math.atan2(bottomDepth - topDepth, goalHeight);
  const backNet = new THREE.Mesh(new THREE.PlaneGeometry(goalWidth, slopeLen), netMat);
  backNet.rotation.y = sideSign === 1 ? Math.PI / 2 : -Math.PI / 2;
  backNet.rotation.x = sideSign === 1 ? -slopeAngle : slopeAngle;
  backNet.position.set(
    sideSign * ((topDepth + bottomDepth) / 2),
    goalHeight / 2,
    0
  );

  for (const zSign of [-1, 1] as const) {
    const sShape = new THREE.Shape();
    sShape.moveTo(0, 0);
    sShape.lineTo(sideSign * bottomDepth, 0);
    sShape.lineTo(sideSign * topDepth, goalHeight);
    sShape.lineTo(0, goalHeight);
    sShape.closePath();
    const sGeo = new THREE.ShapeGeometry(sShape);
    const sideNet = new THREE.Mesh(sGeo, netMat);
    sideNet.position.set(0, 0, zSign * (goalWidth / 2));
    goal.add(sideNet);
  }

  goal.add(leftPost, rightPost, crossbar, backBottomBar, roofNet, backNet);
  return goal;
}

function createHollowHorizontalFrameGeometry(
  outerW: number,
  outerH: number,
  holeW: number,
  holeH: number,
  uvMode: 'normalized' | 'metric_004'
): THREE.ShapeGeometry {
  const hw = outerW * 0.5;
  const hh = outerH * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();

  const ihw = Math.max(1, Math.min(hw - 0.5, holeW * 0.5));
  const ihh = Math.max(1, Math.min(hh - 0.5, holeH * 0.5));
  const hole = new THREE.Path();
  hole.moveTo(-ihw, -ihh);
  hole.lineTo(-ihw, ihh);
  hole.lineTo(ihw, ihh);
  hole.lineTo(ihw, -ihh);
  hole.closePath();
  shape.holes.push(hole);

  const geo = new THREE.ShapeGeometry(shape, 1);
  const posAttr = geo.attributes.position;
  const uvAttr = geo.attributes.uv;
  if (uvAttr) {
    for (let i = 0; i < uvAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      if (uvMode === 'normalized') {
        uvAttr.setXY(i, (x + hw) / outerW, (y + hh) / outerH);
      } else {
        uvAttr.setXY(i, x * 0.04, y * 0.04);
      }
    }
    uvAttr.needsUpdate = true;
  }
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function createHollowStadiumFrameGeometry(
  outerW: number,
  outerH: number,
  straightHalfLen: number,
  holeRadius: number,
  uvMode: 'normalized' | 'metric_004'
): THREE.ShapeGeometry {
  const hw = outerW * 0.5;
  const hh = outerH * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();

  const hole = new THREE.Path();
  hole.absarc(straightHalfLen, 0, holeRadius, -Math.PI / 2, Math.PI / 2, false);
  hole.absarc(-straightHalfLen, 0, holeRadius, Math.PI / 2, Math.PI * 1.5, false);
  hole.closePath();
  shape.holes.push(hole);

  const geo = new THREE.ShapeGeometry(shape, 56);
  const posAttr = geo.attributes.position;
  const uvAttr = geo.attributes.uv;
  if (uvAttr) {
    for (let i = 0; i < uvAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      if (uvMode === 'normalized') {
        uvAttr.setXY(i, (x + hw) / outerW, (y + hh) / outerH);
      } else {
        uvAttr.setXY(i, x * 0.04, y * 0.04);
      }
    }
    uvAttr.needsUpdate = true;
  }
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function createStadiumInfieldTurfGeometry(
  straightHalfLen: number,
  innerRadius: number,
  totalLength: number,
  totalWidth: number
): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.absarc(straightHalfLen, 0, innerRadius, -Math.PI / 2, Math.PI / 2, false);
  shape.absarc(-straightHalfLen, 0, innerRadius, Math.PI / 2, Math.PI * 1.5, false);
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape, 56);
  const posAttr = geo.attributes.position;
  const uvAttr = geo.attributes.uv;
  if (uvAttr) {
    for (let i = 0; i < uvAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      uvAttr.setXY(
        i,
        (x + totalLength * 0.5) / totalLength,
        (y + totalWidth * 0.5) / totalWidth
      );
    }
    uvAttr.needsUpdate = true;
  }
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function createRunningTrackGroup(
  pitch: PitchConfig,
  mats: StadiumMaterialsConfig,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'RunningTrack400m';
  const track = getTrackGeometry(pitch);
  const straightHalfLen = track.straightHalfLength;
  const innerRadius = track.innerRadius;
  const outerRadius = track.outerRadius;
  const laneWidth = track.laneWidth;

  const outerShape = new THREE.Shape();
  outerShape.absarc(straightHalfLen, 0, outerRadius, -Math.PI / 2, Math.PI / 2, false);
  outerShape.absarc(-straightHalfLen, 0, outerRadius, Math.PI / 2, Math.PI * 1.5, false);
  outerShape.closePath();

  const innerHole = new THREE.Path();
  innerHole.absarc(straightHalfLen, 0, innerRadius, -Math.PI / 2, Math.PI / 2, false);
  innerHole.absarc(-straightHalfLen, 0, innerRadius, Math.PI / 2, Math.PI * 1.5, false);
  innerHole.closePath();
  outerShape.holes.push(innerHole);

  const trackGeo = new THREE.ShapeGeometry(outerShape, 64);
  const posAttr = trackGeo.attributes.position;
  const uvAttr = trackGeo.attributes.uv;
  if (uvAttr) {
    for (let i = 0; i < uvAttr.count; i++) {
      uvAttr.setXY(i, posAttr.getX(i) * 0.04, posAttr.getY(i) * 0.04);
    }
    uvAttr.needsUpdate = true;
  }
  trackGeo.rotateX(-Math.PI / 2);

  const trackMat = createTrackPbrMaterial(mats.trackSurface, maxAnisotropy);
  const trackMesh = new THREE.Mesh(trackGeo, trackMat);
  trackMesh.name = 'AthleticsTrackSurface';
  trackMesh.position.y = 0.025;
  trackMesh.receiveShadow = true;
  group.add(trackMesh);

  // Raised white inner kerb ("lice à la corde" at R = 36.50 m)
  const kerbPath = new THREE.Path();
  kerbPath.absarc(straightHalfLen, 0, innerRadius + 0.03, -Math.PI / 2, Math.PI / 2, false);
  kerbPath.absarc(-straightHalfLen, 0, innerRadius + 0.03, Math.PI / 2, Math.PI * 1.5, false);
  kerbPath.closePath();
  const kerbPts = kerbPath
    .getPoints(96)
    .map((p) => new THREE.Vector3(p.x, 0.05, -p.y));
  const kerbCurve = new THREE.CatmullRomCurve3(kerbPts, true);
  const kerbMesh = new THREE.Mesh(
    new THREE.TubeGeometry(kerbCurve, 128, 0.035, 5, true),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45, metalness: 0.2 })
  );
  kerbMesh.name = 'TrackInnerKerb';
  group.add(kerbMesh);

  const lineMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.82,
  });

  for (let l = 1; l <= track.lanes; l++) {
    const r = innerRadius + l * laneWidth;
    const lanePath = new THREE.Path();
    lanePath.absarc(straightHalfLen, 0, r, -Math.PI / 2, Math.PI / 2, false);
    lanePath.absarc(-straightHalfLen, 0, r, Math.PI / 2, Math.PI * 1.5, false);
    lanePath.closePath();

    const pts2d = lanePath.getPoints(80);
    const pts3d = pts2d.map((p) => new THREE.Vector3(p.x, 0.042, -p.y));
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts3d);
    group.add(new THREE.LineLoop(lineGeo, lineMat));
  }

  // Official finish line at the end of the South home straight (`x = +42.195 m`)
  const finishLine = new THREE.Mesh(
    new THREE.PlaneGeometry(0.14, track.lanesWidth),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  finishLine.rotation.x = -Math.PI / 2;
  finishLine.position.set(
    straightHalfLen,
    0.044,
    innerRadius + track.lanesWidth * 0.5
  );
  group.add(finishLine);

  return group;
}

/** Extent of the turf plane: the pitch plus its run-offs, or the infield inside a track. */
function pitchSurfaceExtent(pitch: PitchConfig) {
  const track = pitch.hasTrack ? getTrackGeometry(pitch) : null;
  const effectiveMarginEnd = track
    ? Math.max(2.0, track.infieldHalfLengthX - pitch.length * 0.5)
    : pitch.marginEnd;
  const effectiveMarginSide = track
    ? Math.max(1.2, track.infieldHalfWidthZ - pitch.width * 0.5)
    : pitch.marginSide;
  return {
    track,
    effectiveMarginEnd,
    effectiveMarginSide,
    totalLength: pitch.length + effectiveMarginEnd * 2,
    totalWidth: pitch.width + effectiveMarginSide * 2,
  };
}

/**
 * Site ground of `width` × `depth` m with the pitch (or the whole track) cut out, so the site
 * never covers the turf. UVs are normalized over the rectangle: u runs with +x, v against +z.
 */
export function createSiteGroundGeometry(rawPitch: PitchConfig, width: number, depth: number): THREE.ShapeGeometry {
  const pitch = clampPitchToTrack(rawPitch);
  const { track, totalLength, totalWidth } = pitchSurfaceExtent(pitch);
  return track
    ? createHollowStadiumFrameGeometry(width, depth, track.straightHalfLength, track.outerRadius - 0.15, 'normalized')
    : createHollowHorizontalFrameGeometry(width, depth, totalLength - 0.24, totalWidth - 0.24, 'normalized');
}

/** Period of the blade field (m): each blade wraps to the copy nearest the camera. */
const BLADE_FIELD_PERIOD = 12;
const BLADE_FIELD_COUNT = 220_000;
/** Distance from the camera (m) over which blades shrink into the painted turf. */
const BLADE_FADE_START = 3.2;
const BLADE_FADE_END = 5.8;

/** Blade positions inside one tile; identical for every pitch, so computed once. */
let bladeOffsetsCache: Float32Array | null = null;
function getBladeOffsets(): Float32Array {
  if (bladeOffsetsCache) return bladeOffsetsCache;
  const offsets = new Float32Array(BLADE_FIELD_COUNT * 2);
  let seed = 1;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < BLADE_FIELD_COUNT; i++) {
    offsets[i * 2] = rand() * BLADE_FIELD_PERIOD;
    offsets[i * 2 + 1] = rand() * BLADE_FIELD_PERIOD;
  }
  bladeOffsetsCache = offsets;
  return offsets;
}

/**
 * Real grass blades around the camera, so the turf reads as grass and not as a printed carpet
 * once you get close. One tapered blade is instanced ~1 500 times per m² over a 12 m tile; the
 * vertex shader wraps every blade to its copy nearest the camera, so the field stays fixed on the
 * ground while following the viewer, and blades shrink to nothing past ~6 m where the painted
 * turf takes over. Each blade takes its colour from the pitch texture underneath (mowing stripes
 * and white lines included) and only grows on the turf itself.
 */
function createGrassBladeField(
  pitchMap: THREE.Texture,
  totalLength: number,
  totalWidth: number,
  track: OfficialTrackGeometry | null
): THREE.Mesh {
  // A blade 1 unit tall: two tapering quads and a pointed tip (x = width, y = height).
  const blade = new THREE.BufferGeometry();
  blade.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-0.5, 0, 0, 0.5, 0, 0, -0.42, 0.4, 0, 0.42, 0.4, 0, -0.26, 0.75, 0, 0.26, 0.75, 0, 0, 1, 0],
      3
    )
  );
  blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6]);

  const geo = new THREE.InstancedBufferGeometry();
  geo.index = blade.index;
  geo.setAttribute('position', blade.getAttribute('position'));
  geo.setAttribute('bladeOffset', new THREE.InstancedBufferAttribute(getBladeOffsets(), 2));
  geo.instanceCount = BLADE_FIELD_COUNT;

  const material = new THREE.MeshStandardMaterial({ roughness: 0.78, side: THREE.DoubleSide });
  material.customProgramCacheKey = () => 'grass-blade-field-v1';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPitchMap = { value: pitchMap };
    shader.uniforms.uTurfHalf = { value: new THREE.Vector2(totalLength / 2, totalWidth / 2) };
    shader.uniforms.uTrack = {
      value: new THREE.Vector3(track ? 1 : 0, track?.straightHalfLength ?? 0, track?.innerRadius ?? 0),
    };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 bladeOffset;
uniform sampler2D uPitchMap;
uniform vec2 uTurfHalf;
uniform vec3 uTrack;
varying vec3 vBladeColor;
varying float vBladeT;
float bladeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`
      )
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace(
        '#include <begin_vertex>',
        `float period = ${BLADE_FIELD_PERIOD.toFixed(1)};
vec2 base = bladeOffset + period * floor((cameraPosition.xz - bladeOffset) / period + 0.5);
float h1 = bladeHash(base);
float h2 = bladeHash(base + 17.3);
float h3 = bladeHash(base - 5.1);
bool onTurf = uTrack.x > 0.5
  ? length(vec2(max(abs(base.x) - uTrack.y, 0.0), base.y)) < uTrack.z - 0.3
  : abs(base.x) < uTurfHalf.x - 0.05 && abs(base.y) < uTurfHalf.y - 0.05;
float fade = 1.0 - smoothstep(${BLADE_FADE_START.toFixed(1)}, ${BLADE_FADE_END.toFixed(1)}, distance(cameraPosition, vec3(base.x, 0.0, base.y)));
float bladeH = onTurf ? (0.02 + 0.018 * h1) * fade : 0.0;
float angle = h2 * 6.2831853;
vec2 dir = vec2(cos(angle), sin(angle));
float t = position.y;
// Blades lean and curve over with height; width 4-6 mm.
float bend = t * t * (0.25 + 0.45 * h3);
vec2 side = vec2(-dir.y, dir.x) * position.x * (0.004 + 0.002 * h3);
vec3 transformed = vec3(
  base.x + side.x + dir.x * bend * bladeH,
  0.03 + t * bladeH * (1.0 - 0.25 * bend),
  base.y + side.y + dir.y * bend * bladeH
);
vec2 pitchUv = vec2(base.x / (2.0 * uTurfHalf.x) + 0.5, 0.5 - base.y / (2.0 * uTurfHalf.y));
vBladeColor = texture2D(uPitchMap, pitchUv).rgb * (0.85 + 0.3 * h1);
vBladeT = t;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vBladeColor;
varying float vBladeT;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
// Dark at the root where blades shade each other, lighter and slightly yellow at the tip.
diffuseColor.rgb = vBladeColor * mix(0.45, 1.15, vBladeT) * mix(vec3(1.0), vec3(1.08, 1.06, 0.86), vBladeT * vBladeT);`
      );
  };

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'TurfGrassBlades';
  // Positions come from the shader around the camera: never cull or pick it.
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  mesh.receiveShadow = true;
  return mesh;
}

export function generatePitchGroup(
  rawPitch: PitchConfig,
  _colors: StadiumColors,
  maxAnisotropy: number = 4,
  lighting: LightingMode = 'day',
  materials?: StadiumMaterialsConfig
): THREE.Group {
  const pitch = clampPitchToTrack(rawPitch);
  const { track, effectiveMarginEnd, effectiveMarginSide, totalLength, totalWidth } =
    pitchSurfaceExtent(pitch);
  const mats: StadiumMaterialsConfig = {
    ...DEFAULT_STADIUM_MATERIALS,
    ...(materials ?? {}),
  };

  const root = new THREE.Group();
  root.name = 'PitchAssembly';

  // Exterior-Only Annular Ground Contact-Shadow Apron (strictly outside the stadium bowl, zero geometry over pitch!)
  const aoCanvas = document.createElement('canvas');
  aoCanvas.width = 256;
  aoCanvas.height = 256;
  const aoCtx = aoCanvas.getContext('2d')!;
  aoCtx.clearRect(0, 0, 256, 256);
  const aoGrad = aoCtx.createRadialGradient(128, 128, 58, 128, 128, 126);
  aoGrad.addColorStop(0.0, 'rgba(2, 6, 23, 0)');
  aoGrad.addColorStop(0.28, 'rgba(2, 6, 23, 0.36)');
  aoGrad.addColorStop(0.68, 'rgba(2, 6, 23, 0.34)');
  aoGrad.addColorStop(0.88, 'rgba(2, 6, 23, 0.12)');
  aoGrad.addColorStop(1.0, 'rgba(2, 6, 23, 0)');
  aoCtx.fillStyle = aoGrad;
  aoCtx.fillRect(0, 0, 256, 256);
  const aoTex = new THREE.CanvasTexture(aoCanvas);
  const aoGeo = track
    ? createHollowStadiumFrameGeometry(
        340,
        280,
        track.straightHalfLength,
        track.outerRadius + 12,
        'normalized'
      )
    : createHollowHorizontalFrameGeometry(
        300,
        240,
        totalLength + 28,
        totalWidth + 28,
        'normalized'
      );
  const aoMesh = new THREE.Mesh(
    aoGeo,
    new THREE.MeshBasicMaterial({
      map: aoTex,
      transparent: true,
      depthWrite: false,
      opacity: lighting === 'night' ? 0.55 : 0.42,
    })
  );
  aoMesh.name = 'ExteriorContactShadow';
  aoMesh.position.y = -0.025;
  root.add(aoMesh);

  // Hollow Perimeter Technical Pit Apron & Optional Sunken Safety Moat (ZERO triangles underneath PitchTurf!)
  if (!track) {
    const pitApronMat = createTrackPbrMaterial('anthracite_apron', maxAnisotropy);
    if (pitch.hasMoat) {
      const moatInL = totalLength + 0.56;
      const moatInW = totalWidth + 0.56;
      const moatOutL = totalLength + 4.36;
      const moatOutW = totalWidth + 4.36;
      const moatDepth = 1.65;

      const innerApron = new THREE.Mesh(
        createHollowHorizontalFrameGeometry(
          moatInL,
          moatInW,
          totalLength - 0.24,
          totalWidth - 0.24,
          'metric_004'
        ),
        pitApronMat
      );
      innerApron.name = 'TechnicalPitApronInner';
      innerApron.position.y = 0.015;
      innerApron.receiveShadow = true;
      root.add(innerApron);

      const outerApron = new THREE.Mesh(
        createHollowHorizontalFrameGeometry(
          pitch.length + 56,
          pitch.width + 56,
          moatOutL,
          moatOutW,
          'metric_004'
        ),
        pitApronMat
      );
      outerApron.name = 'TechnicalPitApron';
      outerApron.position.y = 0.015;
      outerApron.receiveShadow = true;
      root.add(outerApron);

      const moatGroup = new THREE.Group();
      moatGroup.name = 'PerimeterSafetyMoat';

      const moatWaterMat = new THREE.MeshPhysicalMaterial({
        color: 0x0c2438,
        roughness: 0.12,
        metalness: 0.18,
        clearcoat: 0.92,
        clearcoatRoughness: 0.08,
      });
      const moatFloor = new THREE.Mesh(
        createHollowHorizontalFrameGeometry(
          moatOutL + 0.1,
          moatOutW + 0.1,
          moatInL - 0.1,
          moatInW - 0.1,
          'normalized'
        ),
        moatWaterMat
      );
      moatFloor.position.y = -moatDepth;
      moatFloor.receiveShadow = true;
      moatGroup.add(moatFloor);

      const moatWallMat = new THREE.MeshStandardMaterial({
        color: 0x64748b,
        roughness: 0.86,
        metalness: 0.05,
      });
      const moatRailMat = new THREE.MeshPhysicalMaterial({
        color: 0xcbd5e1,
        roughness: 0.15,
        metalness: 0.35,
        clearcoat: 0.85,
        transparent: true,
        opacity: 0.62,
        side: THREE.DoubleSide,
      });

      // Inner & outer vertical concrete retaining walls + low pitch-side protective balustrade
      for (const [fL, fW, isInner] of [
        [moatInL, moatInW, true],
        [moatOutL, moatOutW, false],
      ] as const) {
        for (const zSign of [-1, 1] as const) {
          const wMesh = new THREE.Mesh(
            new THREE.BoxGeometry(fL + 0.24, moatDepth + 0.14, 0.22),
            moatWallMat
          );
          wMesh.position.set(0, -moatDepth * 0.5 + 0.05, zSign * (fW * 0.5));
          wMesh.receiveShadow = true;
          moatGroup.add(wMesh);

          if (isInner) {
            const rail = new THREE.Mesh(
              new THREE.BoxGeometry(fL - 8.5, 0.68, 0.06),
              moatRailMat
            );
            rail.position.set(0, 0.46, zSign * (fW * 0.5));
            moatGroup.add(rail);
          }
        }
        for (const xSign of [-1, 1] as const) {
          const wMesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.22, moatDepth + 0.14, fW + 0.24),
            moatWallMat
          );
          wMesh.position.set(xSign * (fL * 0.5), -moatDepth * 0.5 + 0.05, 0);
          wMesh.receiveShadow = true;
          moatGroup.add(wMesh);

          if (isInner) {
            const rail = new THREE.Mesh(
              new THREE.BoxGeometry(0.06, 0.68, fW - 7.5),
              moatRailMat
            );
            rail.position.set(xSign * (fL * 0.5), 0.46, 0);
            moatGroup.add(rail);
          }
        }
      }

      // 4 Players' & Steward Access Bridges spanning the moat on main axes
      const moatSpan = (moatOutW - moatInW) * 0.5 + 0.45;
      for (const zSign of [-1, 1] as const) {
        const bridge = new THREE.Mesh(
          new THREE.BoxGeometry(6.8, 0.24, moatSpan),
          moatWallMat
        );
        bridge.position.set(0, 0.02, zSign * ((moatInW + moatOutW) * 0.25));
        bridge.castShadow = true;
        bridge.receiveShadow = true;
        moatGroup.add(bridge);
      }
      for (const xSign of [-1, 1] as const) {
        const bridge = new THREE.Mesh(
          new THREE.BoxGeometry(moatSpan, 0.24, 5.4),
          moatWallMat
        );
        bridge.position.set(xSign * ((moatInL + moatOutL) * 0.25), 0.02, 0);
        bridge.castShadow = true;
        bridge.receiveShadow = true;
        moatGroup.add(bridge);
      }

      root.add(moatGroup);
    } else {
      const pitApronGeo = createHollowHorizontalFrameGeometry(
        pitch.length + 56,
        pitch.width + 56,
        totalLength - 0.24,
        totalWidth - 0.24,
        'metric_004'
      );
      const pitApron = new THREE.Mesh(pitApronGeo, pitApronMat);
      pitApron.name = 'TechnicalPitApron';
      pitApron.position.y = 0.015;
      pitApron.receiveShadow = true;
      root.add(pitApron);
    }
  }

  // 2. Main Turf Plane — the SOLE horizontal surface across the playing field & D-zones (100% immune to Z-fighting!)
  const turfGeo = track
    ? createStadiumInfieldTurfGeometry(
        track.straightHalfLength,
        track.innerRadius,
        totalLength,
        totalWidth
      )
    : (() => {
        const g = new THREE.PlaneGeometry(totalLength, totalWidth);
        g.rotateX(-Math.PI / 2);
        return g;
      })();

  const { colorMap, roughnessMap } = createPitchTextures(
    pitch,
    mats.pitchTurf,
    maxAnisotropy,
    effectiveMarginEnd,
    effectiveMarginSide
  );
  const grassNormalMap = createGrassBladeNormalMap(maxAnisotropy);

  const turfMat = new THREE.MeshStandardMaterial({
    map: colorMap,
    normalMap: grassNormalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughnessMap,
    roughness: 0.96,
    metalness: 0.0,
    envMapIntensity: 0.55,
  });
  applyTurfCloseUpDetail(turfMat, maxAnisotropy);

  const turfMesh = new THREE.Mesh(turfGeo, turfMat);
  turfMesh.name = 'PitchTurf';
  turfMesh.position.y = 0.03;
  turfMesh.receiveShadow = true;
  root.add(turfMesh);
  root.add(createGrassBladeField(colorMap, totalLength, totalWidth, track));
  const movable = buildMovablePitch(pitch, colorMap, totalLength, totalWidth);
  if (movable) root.add(movable);

  // 3. Concrete Perimeter Drainage Curb framing the pitch apron (on non-track stadiums)
  if (!track) {
    const curbMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.82,
      metalness: 0.05,
    });
    for (const zSign of [-1, 1] as const) {
      const curb = new THREE.Mesh(
        new THREE.BoxGeometry(totalLength + 0.5, 0.14, 0.28),
        curbMat
      );
      curb.position.set(0, 0.06, zSign * (totalWidth / 2 + 0.14));
      curb.receiveShadow = true;
      root.add(curb);
    }
    for (const xSign of [-1, 1] as const) {
      const curb = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.14, totalWidth + 0.5),
        curbMat
      );
      curb.position.set(xSign * (totalLength / 2 + 0.14), 0.06, 0);
      curb.receiveShadow = true;
      root.add(curb);
    }
  }

  if (track) {
    root.add(createRunningTrackGroup(pitch, mats, maxAnisotropy));
  }

  // Two FIFA Goals with woven hexagonal nets
  const netTex = createGoalNetTexture();
  const westGoal = createGoalGroup(-1, netTex);
  westGoal.position.set(-pitch.length / 2, 0.03, 0);
  const eastGoal = createGoalGroup(1, netTex);
  eastGoal.position.set(pitch.length / 2, 0.03, 0);
  root.add(westGoal, eastGoal);

  // Corner Flags with 3D Pennants
  const flagPoleGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.55, 6);
  const flagPoleMat = new THREE.MeshStandardMaterial({
    color: 0xfef08a,
    roughness: 0.35,
  });
  const pennantGeo = new THREE.PlaneGeometry(0.42, 0.28);
  const pennantMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });

  const cornerCoords: [number, number][] = [
    [-pitch.length / 2, -pitch.width / 2],
    [pitch.length / 2, -pitch.width / 2],
    [pitch.length / 2, pitch.width / 2],
    [-pitch.length / 2, pitch.width / 2],
  ];
  for (const [cx, cz] of cornerCoords) {
    const pole = new THREE.Mesh(flagPoleGeo, flagPoleMat);
    pole.position.set(cx, 0.8, cz);
    const pennant = new THREE.Mesh(pennantGeo, pennantMat);
    pennant.position.set(cx + 0.21, 1.4, cz);
    root.add(pole, pennant);
  }

  // Multi-brand 360° Broadcast LED Perimeter Advertising Boards + Curved Corner Arcs + TV Camera Decks
  if (pitch.adBoards) {
    const boardHeight = 0.96;
    const boardThickness = 0.22;
    const sponsorTex = createLedSponsorRibbonTexture();
    const ledMat = new THREE.MeshStandardMaterial({
      map: sponsorTex,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: sponsorTex,
      emissiveIntensity: lighting === 'day' ? 0.38 : 1.05,
      roughness: 0.2,
      metalness: 0.35,
      side: THREE.DoubleSide,
    });
    const backBoardMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.65,
      metalness: 0.58,
    });

    const adCornerR = track ? 8.5 : 2.6;
    const adSideOffset = track
      ? Math.min(2.4, Math.max(1.15, track.innerRadius - pitch.width * 0.5 - 0.55))
      : 2.8;
    const northZ = -(pitch.width / 2 + adSideOffset);
    const southZ = pitch.width / 2 + adSideOffset;
    const endX = pitch.length / 2 + (track ? 2.6 : 3.2);

    const straightNorthLen = Math.max(20, (endX - adCornerR) * 2);
    const northBoard = new THREE.Mesh(
      new THREE.BoxGeometry(straightNorthLen, boardHeight, boardThickness),
      [backBoardMat, backBoardMat, backBoardMat, backBoardMat, ledMat, backBoardMat]
    );
    northBoard.position.set(0, boardHeight / 2 + 0.03, northZ);
    northBoard.castShadow = true;
    root.add(northBoard);

    // South touchline flanking LED boards (leaving central technical/dugout zone `[-23..+23]` clear)
    const southWingLen = Math.max(8, endX - adCornerR - 23);
    for (const xSign of [-1, 1] as const) {
      const southWing = new THREE.Mesh(
        new THREE.BoxGeometry(southWingLen, boardHeight * 0.86, boardThickness),
        [backBoardMat, backBoardMat, backBoardMat, backBoardMat, backBoardMat, ledMat]
      );
      southWing.position.set(
        xSign * (23 + southWingLen * 0.5),
        (boardHeight * 0.86) / 2 + 0.03,
        southZ
      );
      southWing.castShadow = true;
      root.add(southWing);
    }

    // East & West goal-line LED boards flanking the goals + photographer turf benches behind
    const sideSegmentLen = Math.max(6, Math.abs(northZ) - adCornerR - 5.2);
    for (const xSign of [-1, 1] as const) {
      const xPos = xSign * endX;
      for (const zSign of [-1, 1] as const) {
        const segMats =
          xSign === 1
            ? [backBoardMat, ledMat, backBoardMat, backBoardMat, backBoardMat, backBoardMat]
            : [ledMat, backBoardMat, backBoardMat, backBoardMat, backBoardMat, backBoardMat];
        const seg = new THREE.Mesh(
          new THREE.BoxGeometry(boardThickness, boardHeight, sideSegmentLen),
          segMats
        );
        seg.position.set(
          xPos,
          boardHeight / 2 + 0.03,
          zSign * (5.2 + sideSegmentLen / 2)
        );
        seg.castShadow = true;
        root.add(seg);

        // Photographer / broadcast camera position behind goal-line LED boards
        const camRig = new THREE.Mesh(
          new THREE.BoxGeometry(0.55, 0.72, 2.4),
          backBoardMat
        );
        camRig.position.set(
          xPos + xSign * 1.15,
          0.39,
          zSign * (7.5 + sideSegmentLen * 0.35)
        );
        camRig.castShadow = true;
        root.add(camRig);
      }
    }

    // 4 Curved Quarter-Circle Corner LED Sponsor Arcs seamlessly connecting North/South & East/West!
    const arcConfigs: { cx: number; cz: number; thetaStart: number }[] = [
      { cx: endX - adCornerR, cz: southZ - adCornerR, thetaStart: 0 },
      { cx: -(endX - adCornerR), cz: southZ - adCornerR, thetaStart: Math.PI * 1.5 },
      { cx: -(endX - adCornerR), cz: northZ + adCornerR, thetaStart: Math.PI },
      { cx: endX - adCornerR, cz: northZ + adCornerR, thetaStart: Math.PI * 0.5 },
    ];
    for (const ac of arcConfigs) {
      const cylArc = new THREE.CylinderGeometry(
        adCornerR,
        adCornerR,
        boardHeight,
        12,
        1,
        true,
        ac.thetaStart,
        Math.PI * 0.5
      );
      const arcMesh = new THREE.Mesh(cylArc, ledMat);
      arcMesh.position.set(ac.cx, boardHeight / 2 + 0.03, ac.cz);
      arcMesh.castShadow = true;
      root.add(arcMesh);
    }
  }

  return root;
}

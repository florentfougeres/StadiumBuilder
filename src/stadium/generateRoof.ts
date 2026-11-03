import * as THREE from 'three';
import {
  buildShapeBowlRing,
  computeRectangularCornerLayout,
  CornerQuadrantId,
  getBowlArcRange,
  RectangularCornerSpec,
  sampleCornerQuadrantPoint,
  sampleRoundedBowlRing,
} from './bowlRing';
import {
  calculateStandMetrics,
  getTrackRadialOffset,
  resolveStandRoofStyle,
} from './capacity';
import {
  createConcreteBowlMaterial,
  createRoofPbrMaterial,
  createStructurePbrMaterial,
  resolveStadiumMaterials,
} from './materials';
import {
  getEffectiveSunkenDepth,
  isContinuousBowlShape,
  LightingMode,
  RoofStyle,
  StadiumDocument,
  StadiumShape,
  StandSide,
} from './schema';

/**
 * Helper to create a cylinder strut connecting arbitrary 3D point A to point B.
 * Guarantees physically connected structural steel/timber work with zero floating gaps.
 */
function createStrutBetween(
  pA: THREE.Vector3,
  pB: THREE.Vector3,
  radiusTop: number,
  radiusBot: number,
  mat: THREE.Material,
  radialSegs: number = 6
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(pB, pA);
  const len = Math.max(0.05, dir.length());
  const mid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBot, len, radialSegs);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true;
  return mesh;
}

function computeStadiumRingBounds(doc: StadiumDocument) {
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
    18
  );

  const standHeightAtNormal = (nx: number, nz: number): number => {
    const wE = Math.pow(Math.max(0, nx), 2.2);
    const wW = Math.pow(Math.max(0, -nx), 2.2);
    const wS = Math.pow(Math.max(0, nz), 2.2);
    const wN = Math.pow(Math.max(0, -nz), 2.2);
    const sum = wE + wW + wS + wN || 1;
    const hE = eastMetrics.enabled ? eastMetrics.maxHeight : maxStandH * 0.5;
    const hW = westMetrics.enabled ? westMetrics.maxHeight : maxStandH * 0.5;
    const hS = southMetrics.enabled ? southMetrics.maxHeight : maxStandH * 0.5;
    const hN = northMetrics.enabled ? northMetrics.maxHeight : maxStandH * 0.5;
    return (wE * hE + wW * hW + wS * hS + wN * hN) / sum;
  };

  const standDepthAtNormal = (nx: number, nz: number): number => {
    const wE = Math.pow(Math.max(0, nx), 2.2);
    const wW = Math.pow(Math.max(0, -nx), 2.2);
    const wS = Math.pow(Math.max(0, nz), 2.2);
    const wN = Math.pow(Math.max(0, -nz), 2.2);
    const sum = wE + wW + wS + wN || 1;
    const dE = eastMetrics.enabled ? eastMetrics.totalDepth : avgDepth * 0.6;
    const dW = westMetrics.enabled ? westMetrics.totalDepth : avgDepth * 0.6;
    const dS = southMetrics.enabled ? southMetrics.totalDepth : avgDepth * 0.6;
    const dN = northMetrics.enabled ? northMetrics.totalDepth : avgDepth * 0.6;
    return (wE * dE + wW * dW + wS * dS + wN * dN) / sum;
  };

  const avgDistX =
    (doc.stands.east.distanceToPitch + doc.stands.west.distanceToPitch) * 0.5;
  const avgDistZ =
    (doc.stands.north.distanceToPitch + doc.stands.south.distanceToPitch) * 0.5;

  const innerHalfX =
    doc.pitch.length / 2 + Math.max(4.5, avgDistX) + trackOffsets.endOffset;
  const innerHalfZ =
    doc.pitch.width / 2 + Math.max(4.5, avgDistZ) + trackOffsets.sideOffset;

  const ring = buildShapeBowlRing(
    doc.shape,
    doc.pitch.length,
    doc.pitch.width,
    avgDistX,
    avgDistZ,
    trackOffsets.endOffset,
    trackOffsets.sideOffset,
    doc.pitch.hasTrack
  );

  return {
    ring,
    innerHalfX,
    innerHalfZ,
    maxStandH,
    avgDepth,
    standHeightAtNormal,
    standDepthAtNormal,
    trackOffsets,
    standsMetrics: {
      south: southMetrics,
      north: northMetrics,
      east: eastMetrics,
      west: westMetrics,
    },
  };
}

function buildAnnularCanopyMesh(
  ring: ReturnType<typeof buildShapeBowlRing>,
  shape: StadiumShape,
  innerOffset: number,
  outerOffset: number,
  innerY: number,
  outerY: number,
  crossSectionClip: boolean,
  mat: THREE.Material
): THREE.Mesh {
  const { tStart, tEnd, closed } = getBowlArcRange(shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const segments = shape === 'octagonal_arena' ? 160 : 128;
  const activeSegs = Math.max(32, Math.round(segments * arcFraction));
  const ringCount = closed ? activeSegs : activeSegs + 1;

  const positions = new Float32Array(ringCount * 2 * 3);
  const uvs = new Float32Array(ringCount * 2 * 2);
  const indices: number[] = [];

  for (let s = 0; s < ringCount; s++) {
    const t = tStart + (s / activeSegs) * (tEnd - tStart);
    const inPt = sampleRoundedBowlRing(ring, t, innerOffset);
    const outPt = sampleRoundedBowlRing(ring, t, outerOffset);

    const base = s * 6;
    positions[base] = inPt.x;
    positions[base + 1] = innerY;
    positions[base + 2] = inPt.z;

    positions[base + 3] = outPt.x;
    positions[base + 4] = outerY;
    positions[base + 5] = outPt.z;

    const uvBase = s * 4;
    uvs[uvBase] = (s / activeSegs) * 14 * arcFraction;
    uvs[uvBase + 1] = 0;
    uvs[uvBase + 2] = (s / activeSegs) * 14 * arcFraction;
    uvs[uvBase + 3] = 1;
  }

  for (let s = 0; s < activeSegs; s++) {
    const nextS = closed ? (s + 1) % ringCount : s + 1;
    const a = s * 2;
    const b = nextS * 2;
    const c = nextS * 2 + 1;
    const d = s * 2 + 1;
    indices.push(a, b, d);
    indices.push(b, c, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  return mesh;
}

function buildAnnularCatwalkFloodlights(
  ring: ReturnType<typeof buildShapeBowlRing>,
  shape: StadiumShape,
  innerOffset: number,
  catwalkY: number,
  lighting: LightingMode,
  crossSectionClip: boolean
): THREE.Group {
  const group = new THREE.Group();
  const { tStart, tEnd, closed } = getBowlArcRange(shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const segs = Math.max(24, Math.round(96 * arcFraction));

  const catwalkPts: THREE.Vector3[] = [];
  for (let s = 0; s <= segs; s++) {
    const t = tStart + (s / segs) * (tEnd - tStart);
    const pt = sampleRoundedBowlRing(ring, t, innerOffset + 1.1);
    catwalkPts.push(new THREE.Vector3(pt.x, catwalkY, pt.z));
  }

  const gantryMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.38,
    metalness: 0.82,
  });
  group.add(
    new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(catwalkPts, closed), segs, 0.24, 6, closed),
      gantryMat
    )
  );

  const isLit = lighting !== 'day';
  const podCount = Math.max(12, Math.round(48 * arcFraction));
  const podGeo = new THREE.BoxGeometry(2.2, 0.62, 0.55);
  const podMat = new THREE.MeshStandardMaterial({
    color: isLit ? 0xffffff : 0xcbd5e1,
    emissive: new THREE.Color(isLit ? 0xfef9c3 : 0x000000),
    emissiveIntensity: lighting === 'night' ? 2.6 : lighting === 'dusk' ? 1.8 : 0,
    roughness: 0.2,
    metalness: 0.6,
  });

  const pods = new THREE.InstancedMesh(podGeo, podMat, podCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < podCount; i++) {
    const frac = closed ? i / podCount : i / Math.max(1, podCount - 1);
    const t = tStart + frac * (tEnd - tStart);
    const pt = sampleRoundedBowlRing(ring, t, innerOffset + 0.9);
    dummy.position.set(pt.x, catwalkY - 0.35, pt.z);
    dummy.lookAt(0, 0, 0);
    dummy.updateMatrix();
    pods.setMatrixAt(i, dummy.matrix);
  }
  pods.instanceMatrix.needsUpdate = true;
  pods.computeBoundingSphere();
  group.add(pods);

  return group;
}

function buildStraightCatwalkFloodlights(
  roofSpan: number,
  frontZ: number,
  roofHeight: number,
  lighting: LightingMode
): THREE.Group {
  const group = new THREE.Group();
  const isLit = lighting !== 'day';

  const gantryMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.38,
    metalness: 0.82,
  });
  const gantry = new THREE.Mesh(
    new THREE.BoxGeometry(roofSpan - 3, 0.28, 0.65),
    gantryMat
  );
  gantry.position.set(0, roofHeight - 0.38, frontZ + 1.1);
  group.add(gantry);

  const podCount = Math.max(6, Math.floor(roofSpan / 9.5));
  const podGeo = new THREE.BoxGeometry(2.1, 0.58, 0.45);
  const podMat = new THREE.MeshStandardMaterial({
    color: isLit ? 0xffffff : 0xcbd5e1,
    emissive: new THREE.Color(isLit ? 0xfef9c3 : 0x000000),
    emissiveIntensity: lighting === 'night' ? 2.6 : lighting === 'dusk' ? 1.8 : 0,
    roughness: 0.2,
    metalness: 0.6,
  });

  const pods = new THREE.InstancedMesh(podGeo, podMat, podCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < podCount; i++) {
    const px = -roofSpan / 2 + 4 + (i * (roofSpan - 8)) / Math.max(1, podCount - 1);
    dummy.position.set(px, roofHeight - 0.68, frontZ + 0.9);
    dummy.rotation.set(0.45, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    pods.setMatrixAt(i, dummy.matrix);
  }
  pods.instanceMatrix.needsUpdate = true;
  pods.computeBoundingSphere();
  group.add(pods);

  return group;
}

/**
 * 1. ENVELOPING SHELL (`enveloping_shell`):
 * Continuous curved envelope rising from foundations (`gradeY`) and folding over the seating bowl.
 */
function buildEnvelopingShellRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const { ring, maxStandH, avgDepth } = computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const sunkenDepth = getEffectiveSunkenDepth(doc);
  const baseY = Math.min(sunkenDepth, maxStandH * 0.6);
  const roofTopY = maxStandH + doc.roof.heightOffset;
  const innerDripOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const outerBaseOffset = avgDepth + 3.2;
  const outerBellyOffset = avgDepth + 8.6;

  const spanH = Math.max(4, roofTopY - baseY);
  const shellProfile: [number, number][] = [
    [outerBaseOffset, baseY],
    [outerBellyOffset * 0.96, baseY + spanH * 0.25],
    [outerBellyOffset, baseY + spanH * 0.56],
    [outerBellyOffset * 0.95, baseY + spanH * 0.84],
    [avgDepth + 2.2, roofTopY - 0.5],
    [avgDepth * 0.62, roofTopY + 1.4],
    [avgDepth * 0.28, roofTopY + 0.9],
    [innerDripOffset, roofTopY - 0.15],
  ];

  const segments = doc.shape === 'octagonal_arena' ? 160 : 128;
  const activeSegs = Math.max(32, Math.round(segments * arcFraction));
  const ringCount = closed ? activeSegs : activeSegs + 1;
  const pCount = shellProfile.length;

  const positions = new Float32Array(ringCount * pCount * 3);
  const uvs = new Float32Array(ringCount * pCount * 2);
  const indices: number[] = [];

  for (let s = 0; s < ringCount; s++) {
    const t = tStart + (s / activeSegs) * (tEnd - tStart);
    for (let p = 0; p < pCount; p++) {
      const [radOff, py] = shellProfile[p];
      const pt = sampleRoundedBowlRing(ring, t, radOff);
      const base = (s * pCount + p) * 3;
      positions[base] = pt.x;
      positions[base + 1] = py;
      positions[base + 2] = pt.z;

      const uvBase = (s * pCount + p) * 2;
      uvs[uvBase] = (s / activeSegs) * 14 * arcFraction;
      uvs[uvBase + 1] = p / (pCount - 1);
    }
  }

  for (let s = 0; s < activeSegs; s++) {
    const nextS = closed ? (s + 1) % ringCount : s + 1;
    for (let p = 0; p < pCount - 1; p++) {
      const a = s * pCount + p;
      const b = nextS * pCount + p;
      const c = nextS * pCount + (p + 1);
      const d = s * pCount + (p + 1);
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const shellGeo = new THREE.BufferGeometry();
  shellGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  shellGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  shellGeo.setIndex(indices);
  shellGeo.computeVertexNormals();

  const shellMat = createRoofPbrMaterial(
    mats.roof,
    doc.roof.opacity,
    doc.lighting,
    doc.shape === 'octagonal_arena',
    maxAnisotropy,
    12,
    4
  );

  const shellMesh = new THREE.Mesh(shellGeo, shellMat);
  shellMesh.castShadow = true;
  shellMesh.receiveShadow = true;
  shellMesh.renderOrder = 2;
  group.add(shellMesh);

  const structureMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);

  const ribCount = Math.max(12, Math.round(36 * arcFraction));
  for (let i = 0; i < ribCount; i++) {
    const frac = closed ? i / ribCount : i / Math.max(1, ribCount - 1);
    const t = tStart + frac * (tEnd - tStart);
    const ribPts = shellProfile.map(([rOff, ry]) => {
      const p = sampleRoundedBowlRing(ring, t, rOff - 0.28);
      return new THREE.Vector3(p.x, ry, p.z);
    });
    const curve = new THREE.CatmullRomCurve3(ribPts);
    group.add(
      new THREE.Mesh(new THREE.TubeGeometry(curve, 18, 0.28, 6, false), structureMat)
    );
  }

  group.add(
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerDripOffset,
      roofTopY - 0.45,
      doc.lighting,
      crossSectionClip
    )
  );

  return group;
}

/**
 * 2. SUSPENDED NEEDLE MASTS (`suspended_masts`)
 */
function buildSuspendedMastsRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const { ring, maxStandH, avgDepth, standHeightAtNormal, standDepthAtNormal } =
    computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const sunkenDepth = getEffectiveSunkenDepth(doc);
  const groundY = Math.min(sunkenDepth, maxStandH * 0.6);
  const roofY = maxStandH + Math.max(4.5, doc.roof.heightOffset);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const outerOffset = avgDepth + 6.5;

  const canopyMat = createRoofPbrMaterial(
    mats.roof,
    doc.roof.opacity,
    doc.lighting,
    doc.shape === 'octagonal_arena',
    maxAnisotropy
  );

  group.add(
    buildAnnularCanopyMesh(
      ring,
      doc.shape,
      innerOffset,
      outerOffset,
      roofY - 0.3,
      roofY + 0.4,
      crossSectionClip,
      canopyMat
    ),
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerOffset,
      roofY - 0.55,
      doc.lighting,
      crossSectionClip
    )
  );

  const mastStructureMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const cableMat = new THREE.MeshStandardMaterial({
    color: 0xdbeafe,
    roughness: 0.24,
    metalness: 0.9,
  });
  const concretePedestalMat = createConcreteBowlMaterial(maxAnisotropy);

  const mastCount = Math.max(6, Math.round(18 * arcFraction));
  for (let i = 0; i < mastCount; i++) {
    const frac = closed ? i / mastCount : i / Math.max(1, mastCount - 1);
    const t = tStart + frac * (tEnd - tStart);

    const baseSample = sampleRoundedBowlRing(ring, t, 0);
    const localStandD = standDepthAtNormal(baseSample.nx, baseSample.nz);
    const localStandH = standHeightAtNormal(baseSample.nx, baseSample.nz);

    const mastGroundPt = sampleRoundedBowlRing(
      ring,
      t,
      Math.max(avgDepth + 4.2, localStandD + 3.2)
    );
    const mastTopPt = sampleRoundedBowlRing(
      ring,
      t,
      Math.max(avgDepth + 3.4, localStandD + 2.4)
    );
    const innerAnchor = sampleRoundedBowlRing(ring, t, innerOffset + 2.2);
    const midAnchor = sampleRoundedBowlRing(ring, t, (innerOffset + outerOffset) * 0.48);
    const backstayGround = sampleRoundedBowlRing(ring, t, outerOffset + 10.5);
    const standCrestPt = sampleRoundedBowlRing(ring, t, localStandD - 0.4);

    const pBase = new THREE.Vector3(mastGroundPt.x, groundY, mastGroundPt.z);
    const pTip = new THREE.Vector3(mastTopPt.x, roofY + 19.5, mastTopPt.z);
    const pRoofPierce = new THREE.Vector3(
      (mastGroundPt.x + mastTopPt.x) * 0.5,
      roofY + 0.2,
      (mastGroundPt.z + mastTopPt.z) * 0.5
    );

    const pier = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.45, 3.2, 8),
      concretePedestalMat
    );
    pier.position.set(pBase.x, groundY + 1.6, pBase.z);
    pier.castShadow = true;
    group.add(pier);

    group.add(createStrutBetween(pBase, pRoofPierce, 0.72, 0.55, mastStructureMat, 8));
    group.add(createStrutBetween(pRoofPierce, pTip, 0.16, 0.72, mastStructureMat, 8));

    group.add(
      createStrutBetween(
        new THREE.Vector3(standCrestPt.x, localStandH - 0.5, standCrestPt.z),
        pRoofPierce,
        0.28,
        0.28,
        mastStructureMat,
        6
      )
    );

    group.add(
      createStrutBetween(
        pTip,
        new THREE.Vector3(innerAnchor.x, roofY - 0.2, innerAnchor.z),
        0.075,
        0.075,
        cableMat,
        5
      ),
      createStrutBetween(
        pTip,
        new THREE.Vector3(midAnchor.x, roofY + 0.1, midAnchor.z),
        0.075,
        0.075,
        cableMat,
        5
      ),
      createStrutBetween(
        pTip,
        new THREE.Vector3(backstayGround.x, groundY + 0.8, backstayGround.z),
        0.09,
        0.09,
        cableMat,
        5
      )
    );

    const anchorBlock = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 1.6, 1.8),
      concretePedestalMat
    );
    anchorBlock.position.set(backstayGround.x, groundY + 0.8, backstayGround.z);
    group.add(anchorBlock);
  }

  return group;
}

/**
 * Shared perimeter crown for whole-arena roofs with an open centre: annular canopy following the
 * bowl contour, catwalk floodlights on its inner edge and raking columns down to the stand crest.
 */
function buildPerimeterCanopyCrown(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
) {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const bounds = computeStadiumRingBounds(doc);
  const { ring, maxStandH, avgDepth, standHeightAtNormal, standDepthAtNormal } = bounds;
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const roofY = maxStandH + Math.max(4.0, doc.roof.heightOffset);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const outerOffset = avgDepth + 3.8;

  const canopyMat = createRoofPbrMaterial(
    mats.roof,
    doc.roof.opacity,
    doc.lighting,
    doc.shape === 'octagonal_arena',
    maxAnisotropy
  );

  group.add(
    buildAnnularCanopyMesh(
      ring,
      doc.shape,
      innerOffset,
      outerOffset,
      roofY + 1.8,
      roofY,
      crossSectionClip,
      canopyMat
    ),
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerOffset,
      roofY + 1.45,
      doc.lighting,
      crossSectionClip
    )
  );

  const primaryStructMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);

  const colBays = Math.max(12, Math.round(40 * arcFraction));
  for (let i = 0; i < colBays; i++) {
    const f0 = closed ? i / colBays : i / Math.max(1, colBays - 1);
    const f1 = closed
      ? (i + 0.5) / colBays
      : Math.min(1, (i + 0.5) / Math.max(1, colBays - 1));
    const t0 = tStart + f0 * (tEnd - tStart);
    const t1 = tStart + f1 * (tEnd - tStart);
    const s0 = sampleRoundedBowlRing(ring, t0, 0);
    const d0 = standDepthAtNormal(s0.nx, s0.nz);
    const h0 = standHeightAtNormal(s0.nx, s0.nz);

    const wallBase = sampleRoundedBowlRing(ring, t0, d0 - 0.3);
    const roofNode = sampleRoundedBowlRing(ring, t1, outerOffset - 0.8);
    group.add(
      createStrutBetween(
        new THREE.Vector3(wallBase.x, h0 - 0.6, wallBase.z),
        new THREE.Vector3(roofNode.x, roofY, roofNode.z),
        0.32,
        0.38,
        primaryStructMat,
        6
      )
    );
  }

  return { group, bounds, roofY, innerOffset, outerOffset, primaryStructMat };
}

/**
 * 3. RETRACTABLE ROOF (`retractable`):
 * Perimeter canopy whose central opening is covered by two motorized sliding leaves.
 * Each leaf is cut from the opening contour so its outer edges follow the bowl outline.
 * Supports `doc.roof.retractableClosed` (`true` = closed indoor arena, `false` = open to sky).
 */
function buildRetractableRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, roofY, innerOffset, outerOffset, primaryStructMat } =
    buildPerimeterCanopyCrown(doc, crossSectionClip, maxAnisotropy);
  const { ring } = bounds;

  if (doc.shape === 'horseshoe') {
    return group;
  }

  // Leaves overlap the canopy rim by 2 m; the cross-section keeps only the north half (z <= 0).
  const leafOverlap = 2.0;
  const contourSegs = 96;
  const contour: { x: number; z: number }[] = [];
  for (let s = 0; s < contourSegs; s++) {
    const p = sampleRoundedBowlRing(ring, s / contourSegs, innerOffset + leafOverlap);
    contour.push({ x: p.x, z: crossSectionClip ? Math.min(0, p.z) : p.z });
  }
  const openingHalfX = Math.max(...contour.map((p) => Math.abs(p.x)));

  // Half-depth of the (convex) contour at a given x, by intersecting its edges with that line.
  const contourHalfDepthAt = (x: number): number => {
    let maxZ = 0;
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      if ((a.x - x) * (b.x - x) > 0 || a.x === b.x) continue;
      const f = (x - a.x) / (b.x - a.x);
      maxZ = Math.max(maxZ, Math.abs(a.z + f * (b.z - a.z)));
    }
    return maxZ;
  };

  // Open leaves park over the canopy, so their travel is bounded by its width.
  const maxTravel = Math.max(0, outerOffset - innerOffset - leafOverlap);
  const isClosed = Boolean(doc.roof.retractableClosed);
  const travel = isClosed ? 0 : maxTravel;
  const leafY = roofY + 2.15;

  const leafMat = new THREE.MeshPhysicalMaterial({
    color: 0xe0f2fe,
    roughness: 0.12,
    metalness: 0.15,
    clearcoat: 0.9,
    transparent: true,
    opacity: isClosed ? 0.84 : 0.65,
    side: THREE.DoubleSide,
  });

  for (const xSign of [-1, 1] as const) {
    // Clamping a convex outline to one side of x = 0 yields that half of the opening.
    const shape = new THREE.Shape(
      contour.map((p) => {
        const x = xSign > 0 ? Math.max(0, p.x) : Math.min(0, p.x);
        return new THREE.Vector2(x, -p.z);
      })
    );
    const leafGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.55, bevelEnabled: false });
    leafGeo.rotateX(-Math.PI / 2);
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.position.set(xSign * travel, leafY, 0);
    leaf.castShadow = true;
    leaf.renderOrder = 3;
    group.add(leaf);

    // Transverse motorized box-trusses, each trimmed to the leaf outline at its station
    for (const frac of [0.12, 0.4, 0.68, 0.94]) {
      const localX = xSign * openingHalfX * frac;
      const beamZ = contourHalfDepthAt(localX);
      if (beamZ < 2) continue;
      const zMin = -beamZ;
      const zMax = crossSectionClip ? 0 : beamZ;
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(0.65, 1.15, zMax - zMin),
        primaryStructMat
      );
      beam.position.set(localX + xSign * travel, leafY + 1.05, (zMin + zMax) / 2);
      beam.castShadow = true;
      group.add(beam);
    }
  }

  // Longitudinal runway rails the leaves slide along, laid over the canopy
  const railHalfLen = openingHalfX + maxTravel;
  const railZ = contourHalfDepthAt(0) * 0.6;
  for (const zSign of crossSectionClip ? [-1] : [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(railHalfLen * 2, 0.4, 0.9),
      primaryStructMat
    );
    rail.position.set(0, roofY + 1.9, zSign * railZ);
    group.add(rail);
  }

  return group;
}

/**
 * 4. MONUMENTAL TWIN ARCHES (`twin_arch`):
 * Annular canopy hung from two parallel lattice arches, with a suspended centre-hung scoreboard.
 */
function buildTwinArchRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, roofY, primaryStructMat } = buildPerimeterCanopyCrown(
    doc,
    crossSectionClip,
    maxAnisotropy
  );
  const { innerHalfX, innerHalfZ, avgDepth } = bounds;
  const cableSteelMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.3,
    metalness: 0.84,
  });
  const concreteMat = createConcreteBowlMaterial(maxAnisotropy);

  const archHalfSpanX = innerHalfX + avgDepth + 24;
  const archApexY = roofY + 26;
  const archZPos = Math.max(24, innerHalfZ * 0.58);
  const archZOffsets = crossSectionClip ? [-archZPos] : [-archZPos, archZPos];

  for (const zArch of archZOffsets) {
    for (const xSign of [-1, 1] as const) {
      const abut = new THREE.Mesh(
        new THREE.BoxGeometry(9.5, 6.5, 5.2),
        concreteMat
      );
      abut.position.set(xSign * archHalfSpanX, 3.25, zArch);
      abut.rotation.z = xSign * 0.32;
      abut.castShadow = true;
      group.add(abut);
    }

    const upperPts: THREE.Vector3[] = [];
    const lowerPts: THREE.Vector3[] = [];
    const archSegs = 44;
    for (let s = 0; s <= archSegs; s++) {
      const u = s / archSegs;
      const x = -archHalfSpanX + u * (archHalfSpanX * 2);
      const parabola = 1 - Math.pow(x / archHalfSpanX, 2);
      const yLow = 2.0 + parabola * (archApexY - 4.5);
      const yHigh = yLow + 3.2;
      lowerPts.push(new THREE.Vector3(x, yLow, zArch));
      upperPts.push(new THREE.Vector3(x, yHigh, zArch));
    }

    group.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(upperPts), 56, 0.68, 8, false),
        primaryStructMat
      ),
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lowerPts), 56, 0.68, 8, false),
        primaryStructMat
      )
    );

    for (let s = 1; s < archSegs; s++) {
      group.add(createStrutBetween(lowerPts[s], upperPts[s], 0.22, 0.22, primaryStructMat, 5));
      if (s < archSegs - 1) {
        group.add(
          createStrutBetween(lowerPts[s], upperPts[s + 1], 0.16, 0.16, primaryStructMat, 5)
        );
      }
      if (s % 3 === 0 && lowerPts[s].y > roofY + 2.2) {
        group.add(
          createStrutBetween(
            lowerPts[s],
            new THREE.Vector3(lowerPts[s].x, roofY + 1.8, zArch),
            0.09,
            0.09,
            cableSteelMat,
            5
          )
        );
      }
    }
  }

  if (!crossSectionClip) {
    for (let x = -72; x <= 72; x += 24) {
      const parabola = 1 - Math.pow(x / archHalfSpanX, 2);
      const yTie = 2.0 + parabola * (archApexY - 4.5) + 1.6;
      group.add(
        createStrutBetween(
          new THREE.Vector3(x, yTie, -archZPos),
          new THREE.Vector3(x, yTie, archZPos),
          0.36,
          0.36,
          primaryStructMat,
          6
        )
      );
    }

    const jumboY = Math.max(24, roofY - 7.5);
    const jumboBody = new THREE.Mesh(
      new THREE.BoxGeometry(34, 9.5, 13),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.6 })
    );
    jumboBody.position.set(0, jumboY, 0);
    jumboBody.castShadow = true;
    group.add(jumboBody);

    const screenGlowMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: new THREE.Color(0x38bdf8),
      emissiveIntensity: doc.lighting === 'day' ? 0.45 : 1.15,
      roughness: 0.18,
    });
    for (const zSign of [-1, 1] as const) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(32.5, 8.2), screenGlowMat);
      face.position.set(0, jumboY, zSign * 6.56);
      if (zSign === -1) face.rotation.y = Math.PI;
      group.add(face);
    }
    for (const sx of [-14, 14]) {
      for (const sz of [-6, 6]) {
        const archZ = sz < 0 ? -archZPos : archZPos;
        const parabola = 1 - Math.pow(sx / archHalfSpanX, 2);
        const archY = 2.0 + parabola * (archApexY - 4.5);
        group.add(
          createStrutBetween(
            new THREE.Vector3(sx, archY, archZ),
            new THREE.Vector3(sx, jumboY + 4.75, sz),
            0.08,
            0.08,
            cableSteelMat,
            5
          )
        );
      }
    }
  }

  return group;
}

/**
 * 5. ICONIC GIANT SINGLE ARCH (`giant_arch`):
 * Monumental 3-chord spatial lattice steel arch spanning ~275m across the entire stadium
 * at a tilted architectural angle, suspending the roof canopy via fan stay cables!
 */
function buildGiantArchRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const {
    ring,
    innerHalfX,
    innerHalfZ,
    maxStandH,
    avgDepth,
    standHeightAtNormal,
    standDepthAtNormal,
  } = computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);

  const roofY = maxStandH + Math.max(4.0, doc.roof.heightOffset);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const outerOffset = avgDepth + 3.6;

  const canopyMat = createRoofPbrMaterial(
    mats.roof,
    doc.roof.opacity,
    doc.lighting,
    doc.shape === 'octagonal_arena',
    maxAnisotropy
  );

  group.add(
    buildAnnularCanopyMesh(
      ring,
      doc.shape,
      innerOffset,
      outerOffset,
      roofY - 0.4,
      roofY + 0.5,
      crossSectionClip,
      canopyMat
    ),
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerOffset,
      roofY - 0.72,
      doc.lighting,
      crossSectionClip
    )
  );

  const primaryStructMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const cableMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.22,
    metalness: 0.9,
  });
  const concreteMat = createConcreteBowlMaterial(maxAnisotropy);

  // Rear perimeter struts connecting stand crest to outer roof ring
  const perimCols = Math.max(12, Math.round(40 * arcFraction));
  for (let i = 0; i < perimCols; i++) {
    const frac = closed ? i / perimCols : i / Math.max(1, perimCols - 1);
    const t = tStart + frac * (tEnd - tStart);
    const s0 = sampleRoundedBowlRing(ring, t, 0);
    const d0 = standDepthAtNormal(s0.nx, s0.nz);
    const h0 = standHeightAtNormal(s0.nx, s0.nz);
    const wallPt = sampleRoundedBowlRing(ring, t, d0 - 0.2);
    const roofPt = sampleRoundedBowlRing(ring, t, outerOffset - 0.6);
    group.add(
      createStrutBetween(
        new THREE.Vector3(wallPt.x, h0 - 0.5, wallPt.z),
        new THREE.Vector3(roofPt.x, roofY + 0.4, roofPt.z),
        0.32,
        0.38,
        primaryStructMat,
        6
      )
    );
  }

  // Monumental 125m-class tilted 3-chord tubular lattice arch spanning East-to-West!
  const archHalfSpanX = innerHalfX + avgDepth + 32;
  const archApexY = roofY + 46;
  const archBaseZ = -Math.max(16, innerHalfZ * 0.36);
  const archTiltZ = 14.5; // Tilts gracefully southward toward center pitch at apex

  for (const xSign of [-1, 1] as const) {
    const thrustBlock = new THREE.Mesh(
      new THREE.BoxGeometry(11, 7.5, 8.5),
      concreteMat
    );
    thrustBlock.position.set(xSign * archHalfSpanX, 3.75, archBaseZ);
    thrustBlock.rotation.z = xSign * 0.35;
    thrustBlock.castShadow = true;
    group.add(thrustBlock);
  }

  const archSegs = 48;
  const topChord: THREE.Vector3[] = [];
  const botLeftChord: THREE.Vector3[] = [];
  const botRightChord: THREE.Vector3[] = [];

  for (let s = 0; s <= archSegs; s++) {
    const u = s / archSegs;
    const x = -archHalfSpanX + u * (archHalfSpanX * 2);
    const parabola = Math.max(0, 1 - Math.pow(x / archHalfSpanX, 2));
    const centerY = 2.5 + parabola * (archApexY - 2.5);
    const centerZ = archBaseZ + parabola * archTiltZ;
    // Lenticular basket diameter widens at mid-span (~6.5m) and tapers to pins at thrust blocks!
    const spread = 0.8 + parabola * 2.8;

    topChord.push(new THREE.Vector3(x, centerY + spread * 1.15, centerZ));
    botLeftChord.push(new THREE.Vector3(x, centerY - spread * 0.85, centerZ - spread));
    botRightChord.push(new THREE.Vector3(x, centerY - spread * 0.85, centerZ + spread));
  }

  for (const chordPts of [topChord, botLeftChord, botRightChord]) {
    group.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(chordPts), 64, 0.62, 8, false),
        primaryStructMat
      )
    );
  }

  // Diaphragm rings + diagonal lattice lacing along the giant arch + fan stay cables to North & South roofs!
  for (let s = 1; s < archSegs; s++) {
    group.add(
      createStrutBetween(topChord[s], botLeftChord[s], 0.18, 0.18, primaryStructMat, 5),
      createStrutBetween(topChord[s], botRightChord[s], 0.18, 0.18, primaryStructMat, 5),
      createStrutBetween(botLeftChord[s], botRightChord[s], 0.18, 0.18, primaryStructMat, 5)
    );
    if (s < archSegs - 1) {
      group.add(
        createStrutBetween(topChord[s], botLeftChord[s + 1], 0.13, 0.13, primaryStructMat, 4),
        createStrutBetween(topChord[s], botRightChord[s + 1], 0.13, 0.13, primaryStructMat, 4)
      );
    }

    // Forest of diagonal suspension cables fanning down to North roof edge & South roof edge
    if (s % 3 === 0 && topChord[s].y > roofY + 6) {
      const xPos = topChord[s].x;
      if (Math.abs(xPos) < innerHalfX + avgDepth * 0.65) {
        const northTargetZ = -(innerHalfZ + innerOffset + 3.5);
        group.add(
          createStrutBetween(
            botLeftChord[s],
            new THREE.Vector3(xPos, roofY - 0.1, northTargetZ),
            0.085,
            0.085,
            cableMat,
            5
          )
        );
        if (!crossSectionClip) {
          const southTargetZ = innerHalfZ + innerOffset + 3.5;
          group.add(
            createStrutBetween(
              botRightChord[s],
              new THREE.Vector3(xPos, roofY - 0.1, southTargetZ),
              0.085,
              0.085,
              cableMat,
              5
            )
          );
        }
      }
    }
  }

  return group;
}

/**
 * 5. BOWSTRING LENTICULAR MEGA-TRUSSES (`bowstring_arch`)
 */
function buildBowstringArchRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const {
    ring,
    innerHalfX,
    innerHalfZ,
    maxStandH,
    avgDepth,
    standHeightAtNormal,
    standDepthAtNormal,
  } = computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);

  const roofY = maxStandH + Math.max(3.8, doc.roof.heightOffset);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const outerOffset = avgDepth + 3.4;

  const canopyMat = createRoofPbrMaterial(
    mats.roof,
    doc.roof.opacity,
    doc.lighting,
    doc.shape === 'octagonal_arena',
    maxAnisotropy
  );

  group.add(
    buildAnnularCanopyMesh(
      ring,
      doc.shape,
      innerOffset,
      outerOffset,
      roofY - 0.5,
      roofY + 0.5,
      crossSectionClip,
      canopyMat
    ),
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerOffset,
      roofY - 0.78,
      doc.lighting,
      crossSectionClip
    )
  );

  const tubularStructMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const pylonConcreteMat = createConcreteBowlMaterial(maxAnisotropy);

  const perimCols = Math.max(12, Math.round(40 * arcFraction));
  for (let i = 0; i < perimCols; i++) {
    const frac = closed ? i / perimCols : i / Math.max(1, perimCols - 1);
    const t = tStart + frac * (tEnd - tStart);
    const s0 = sampleRoundedBowlRing(ring, t, 0);
    const d0 = standDepthAtNormal(s0.nx, s0.nz);
    const h0 = standHeightAtNormal(s0.nx, s0.nz);
    const wallPt = sampleRoundedBowlRing(ring, t, d0 - 0.2);
    const roofPt = sampleRoundedBowlRing(ring, t, outerOffset - 0.6);
    group.add(
      createStrutBetween(
        new THREE.Vector3(wallPt.x, h0 - 0.5, wallPt.z),
        new THREE.Vector3(roofPt.x, roofY + 0.4, roofPt.z),
        0.34,
        0.4,
        tubularStructMat,
        6
      )
    );
  }

  const spanHalfX = innerHalfX + avgDepth * 0.65;
  const trussZPositions = crossSectionClip
    ? [-(innerHalfZ + innerOffset + 3)]
    : [-(innerHalfZ + innerOffset + 3), innerHalfZ + innerOffset + 3];

  for (const zPos of trussZPositions) {
    for (const xSign of [-1, 1] as const) {
      const pylon = new THREE.Mesh(
        new THREE.BoxGeometry(4.2, roofY + 2.2, 4.2),
        pylonConcreteMat
      );
      pylon.position.set(xSign * spanHalfX, (roofY + 2.2) / 2, zPos);
      pylon.castShadow = true;
      pylon.receiveShadow = true;
      group.add(pylon);
    }

    const topPts: THREE.Vector3[] = [];
    const botPts: THREE.Vector3[] = [];
    const segs = 32;
    for (let s = 0; s <= segs; s++) {
      const u = s / segs;
      const x = -spanHalfX + u * (spanHalfX * 2);
      const lens = Math.sin(u * Math.PI);
      topPts.push(new THREE.Vector3(x, roofY + 1.2 + lens * 11.5, zPos));
      botPts.push(new THREE.Vector3(x, roofY + 0.6 + lens * 1.8, zPos));
    }

    group.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(topPts), 40, 0.58, 8, false),
        tubularStructMat
      ),
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(botPts), 40, 0.42, 8, false),
        tubularStructMat
      )
    );

    for (let s = 1; s < segs; s++) {
      group.add(
        createStrutBetween(botPts[s], topPts[s], 0.16, 0.16, tubularStructMat, 5)
      );
      if (s % 2 === 0) {
        group.add(
          createStrutBetween(botPts[s], topPts[s + 1], 0.12, 0.12, tubularStructMat, 5)
        );
      }
    }
  }

  return group;
}

/**
 * 6. BICYCLE-WHEEL CABLE ROOF ON V-COLONNADE (`bicycle_wheel`)
 */
function buildBicycleWheelCableRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const { ring, maxStandH, avgDepth, standHeightAtNormal, standDepthAtNormal } =
    computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const roofY = maxStandH + Math.max(3.6, doc.roof.heightOffset);

  const innerDripOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const outerRingOffset = avgDepth + 3.2;

  const canopyMat = createRoofPbrMaterial(
    mats.roof,
    doc.roof.opacity,
    doc.lighting,
    doc.shape === 'octagonal_arena',
    maxAnisotropy
  );

  group.add(
    buildAnnularCanopyMesh(
      ring,
      doc.shape,
      innerDripOffset,
      outerRingOffset,
      roofY - 0.55,
      roofY + 0.35,
      crossSectionClip,
      canopyMat
    ),
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerDripOffset,
      roofY - 0.85,
      doc.lighting,
      crossSectionClip
    )
  );

  const ringStructMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const cableMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.22,
    metalness: 0.92,
  });

  const segments = doc.shape === 'octagonal_arena' ? 160 : 128;
  const activeSegs = Math.max(32, Math.round(segments * arcFraction));

  const outerRingPts: THREE.Vector3[] = [];
  const innerUpperPts: THREE.Vector3[] = [];
  const innerLowerPts: THREE.Vector3[] = [];

  for (let s = 0; s <= activeSegs; s++) {
    const t = tStart + (s / activeSegs) * (tEnd - tStart);
    const outPt = sampleRoundedBowlRing(ring, t, outerRingOffset);
    const inPt = sampleRoundedBowlRing(ring, t, innerDripOffset + 0.5);

    outerRingPts.push(new THREE.Vector3(outPt.x, roofY + 0.4, outPt.z));
    innerUpperPts.push(new THREE.Vector3(inPt.x, roofY + 2.0, inPt.z));
    innerLowerPts.push(new THREE.Vector3(inPt.x, roofY - 2.3, inPt.z));
  }

  group.add(
    new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(outerRingPts, closed), 112, 0.72, 8, closed),
      ringStructMat
    ),
    new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(innerUpperPts, closed), 112, 0.22, 6, closed),
      cableMat
    ),
    new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(innerLowerPts, closed), 112, 0.22, 6, closed),
      cableMat
    )
  );

  const bayCount = Math.max(14, Math.round(44 * arcFraction));
  for (let i = 0; i < bayCount; i++) {
    const fMid = (i + 0.5) / bayCount;
    const fL = i / bayCount;
    const fR = (i + 1) / bayCount;
    const tMid = tStart + fMid * (tEnd - tStart);
    const tLeft = tStart + fL * (tEnd - tStart);
    const tRight = tStart + fR * (tEnd - tStart);

    const sL = sampleRoundedBowlRing(ring, tLeft, 0);
    const sR = sampleRoundedBowlRing(ring, tRight, 0);
    const dL = standDepthAtNormal(sL.nx, sL.nz);
    const dR = standDepthAtNormal(sR.nx, sR.nz);
    const hL = standHeightAtNormal(sL.nx, sL.nz);
    const hR = standHeightAtNormal(sR.nx, sR.nz);

    const wallFootL = sampleRoundedBowlRing(ring, tLeft, dL - 0.1);
    const wallFootR = sampleRoundedBowlRing(ring, tRight, dR - 0.1);
    const outApex = sampleRoundedBowlRing(ring, tMid, outerRingOffset);
    const inAnchor = sampleRoundedBowlRing(ring, tMid, innerDripOffset + 0.5);

    const pOut = new THREE.Vector3(outApex.x, roofY + 0.4, outApex.z);
    const pFootL = new THREE.Vector3(wallFootL.x, hL - 0.6, wallFootL.z);
    const pFootR = new THREE.Vector3(wallFootR.x, hR - 0.6, wallFootR.z);

    group.add(
      createStrutBetween(pFootL, pOut, 0.34, 0.4, ringStructMat, 6),
      createStrutBetween(pFootR, pOut, 0.34, 0.4, ringStructMat, 6)
    );

    const pInTop = new THREE.Vector3(inAnchor.x, roofY + 2.0, inAnchor.z);
    const pInBot = new THREE.Vector3(inAnchor.x, roofY - 2.3, inAnchor.z);
    group.add(
      createStrutBetween(pInBot, pInTop, 0.13, 0.13, ringStructMat, 6),
      createStrutBetween(pOut, pInTop, 0.075, 0.075, cableMat, 5),
      createStrutBetween(pOut, pInBot, 0.075, 0.075, cableMat, 5)
    );
  }

  return group;
}

/**
 * 7. TENSILE CABLE-NET & SADDLE MEMBRANE PEAKS (`tensile_net`):
 * Sweeping anticlastic peaks & catenary valleys in PTFE/ETFE suspended from inclined masts
 * with ridge cables, valley tie-downs, and perimeter ground anchors!
 */
function buildTensileNetMembraneRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const { ring, maxStandH, avgDepth } = computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const sunkenDepth = getEffectiveSunkenDepth(doc);
  const groundY = Math.min(sunkenDepth, maxStandH * 0.6);

  const baseRoofY = maxStandH + Math.max(3.5, doc.roof.heightOffset);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const outerOffset = avgDepth + 5.5;

  const peakTotalFull = 12;
  const activePeaks = Math.max(4, Math.round(peakTotalFull * arcFraction));
  const uSegs = activePeaks * 12;
  const vSegs = 8;
  const ringCount = closed ? uSegs : uSegs + 1;

  const positions = new Float32Array(ringCount * (vSegs + 1) * 3);
  const uvs = new Float32Array(ringCount * (vSegs + 1) * 2);
  const indices: number[] = [];

  for (let s = 0; s < ringCount; s++) {
    const frac = s / uSegs;
    const t = tStart + frac * (tEnd - tStart);
    const wavePhase = frac * activePeaks * Math.PI * 2;
    const peakWave = Math.pow(0.5 + 0.5 * Math.cos(wavePhase), 1.8); // 1 at mast peaks, 0 in valleys

    for (let v = 0; v <= vSegs; v++) {
      const vf = v / vSegs; // 0 = inner edge, 1 = outer edge
      const radOff = innerOffset + vf * (outerOffset - innerOffset);
      // Saddle-cone anticlastic height: peaks sharply near v=0.68 at mast stations, dips in valleys
      const radialCone = Math.exp(-Math.pow((vf - 0.65) / 0.34, 2));
      const catenarySag = Math.sin(vf * Math.PI) * -1.4;
      const py =
        baseRoofY +
        peakWave * radialCone * 11.5 -
        (1 - peakWave) * 2.2 +
        catenarySag;

      const pt = sampleRoundedBowlRing(ring, t, radOff);
      const base = (s * (vSegs + 1) + v) * 3;
      positions[base] = pt.x;
      positions[base + 1] = py;
      positions[base + 2] = pt.z;

      const uvBase = (s * (vSegs + 1) + v) * 2;
      uvs[uvBase] = frac * 16 * arcFraction;
      uvs[uvBase + 1] = vf * 3;
    }
  }

  for (let s = 0; s < uSegs; s++) {
    const nextS = closed ? (s + 1) % ringCount : s + 1;
    for (let v = 0; v < vSegs; v++) {
      const a = s * (vSegs + 1) + v;
      const b = nextS * (vSegs + 1) + v;
      const c = nextS * (vSegs + 1) + v + 1;
      const d = s * (vSegs + 1) + v + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const netGeo = new THREE.BufferGeometry();
  netGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  netGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  netGeo.setIndex(indices);
  netGeo.computeVertexNormals();

  const membraneMat = createRoofPbrMaterial(
    mats.roof,
    Math.min(0.92, doc.roof.opacity),
    doc.lighting,
    false,
    maxAnisotropy,
    14,
    3
  );
  const netMesh = new THREE.Mesh(netGeo, membraneMat);
  netMesh.castShadow = true;
  netMesh.receiveShadow = true;
  netMesh.renderOrder = 2;
  group.add(netMesh);

  const mastMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const cableMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.22,
    metalness: 0.92,
  });
  const concreteMat = createConcreteBowlMaterial(maxAnisotropy);

  // Catenary inner edge cable ring
  const innerEdgePts: THREE.Vector3[] = [];
  for (let s = 0; s < ringCount; s++) {
    const idx = s * (vSegs + 1) * 3;
    innerEdgePts.push(
      new THREE.Vector3(positions[idx], positions[idx + 1], positions[idx + 2])
    );
  }
  group.add(
    new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(innerEdgePts, closed),
        uSegs,
        0.18,
        6,
        closed
      ),
      cableMat
    )
  );

  // Inclined perimeter tubular masts + flying peak struts + backstay cables at each peak!
  const mastLimit = closed ? activePeaks : activePeaks + 1;
  for (let p = 0; p < mastLimit; p++) {
    const frac = p / activePeaks;
    const t = tStart + frac * (tEnd - tStart);
    const mastFoot = sampleRoundedBowlRing(ring, t, outerOffset + 3.2);
    const mastHead = sampleRoundedBowlRing(
      ring,
      t,
      innerOffset + 0.65 * (outerOffset - innerOffset)
    );
    const anchorOut = sampleRoundedBowlRing(ring, t, outerOffset + 14.5);
    const inEdge = sampleRoundedBowlRing(ring, t, innerOffset);

    const pFoot = new THREE.Vector3(mastFoot.x, groundY, mastFoot.z);
    const pPeak = new THREE.Vector3(mastHead.x, baseRoofY + 11.2, mastHead.z);
    const pMastTip = new THREE.Vector3(mastHead.x, baseRoofY + 19.5, mastHead.z);
    const pAnchor = new THREE.Vector3(anchorOut.x, groundY + 0.7, anchorOut.z);

    group.add(
      createStrutBetween(pFoot, pMastTip, 0.24, 0.65, mastMat, 8),
      createStrutBetween(pMastTip, pPeak, 0.09, 0.09, cableMat, 5),
      createStrutBetween(pMastTip, pAnchor, 0.1, 0.1, cableMat, 5),
      createStrutBetween(
        pMastTip,
        new THREE.Vector3(inEdge.x, baseRoofY - 0.2, inEdge.z),
        0.08,
        0.08,
        cableMat,
        5
      )
    );

    const block = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 2.2), concreteMat);
    block.position.copy(pAnchor);
    group.add(block);

    // Valley tie-down cable halfway to next peak
    if (p < activePeaks) {
      const tVal = tStart + ((p + 0.5) / activePeaks) * (tEnd - tStart);
      const valOut = sampleRoundedBowlRing(ring, tVal, outerOffset);
      const valGround = sampleRoundedBowlRing(ring, tVal, outerOffset + 6.5);
      group.add(
        createStrutBetween(
          new THREE.Vector3(valOut.x, baseRoofY - 2.2, valOut.z),
          new THREE.Vector3(valGround.x, groundY + 0.5, valGround.z),
          0.08,
          0.08,
          cableMat,
          5
        )
      );
    }
  }

  return group;
}

/**
 * 8. FULL PERMANENT CLIMATIC DOME (`fixed_dome`):
 * Complete elliptical geodesic/lamella spatial dome enclosing 100% of the bowl & pitch,
 * with zenithal daylight oculus, steel rib arches, and central 360° halo scoreboard!
 */
function buildFixedDomeRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const { ring, maxStandH, avgDepth, standHeightAtNormal, standDepthAtNormal } =
    computeStadiumRingBounds(doc);

  const springY = maxStandH + Math.max(2.8, doc.roof.heightOffset * 0.7);
  const domeRise = 23.5;
  const eaveOffset = avgDepth + 3.2;

  // Dome surface point: the eave follows the bowl contour, and each higher course is that
  // contour scaled toward the centre, so the sides hug the stadium outline instead of an ellipse.
  const domePoint = (t: number, theta: number, yAdjust = 0): THREE.Vector3 => {
    const eave = sampleRoundedBowlRing(ring, t, eaveOffset);
    const scale = Math.cos(theta);
    return new THREE.Vector3(
      eave.x * scale,
      springY + Math.sin(theta) * domeRise + yAdjust,
      eave.z * scale
    );
  };

  const uSegs = crossSectionClip ? 48 : 96;
  const vSegs = 16;
  // The dome always closes the full contour (even over a horseshoe's open end).
  const tStart = crossSectionClip ? 0.5 : 0;
  const tSpan = crossSectionClip ? 0.5 : 1;
  const uCount = crossSectionClip ? uSegs + 1 : uSegs;

  // Main outer dome shell (`v` from `0` = perimeter eaves to `0.84` = zenithal oculus edge)
  const positions = new Float32Array(uCount * (vSegs + 1) * 3);
  const uvs = new Float32Array(uCount * (vSegs + 1) * 2);
  const indices: number[] = [];

  for (let u = 0; u < uCount; u++) {
    const t = tStart + (u / uSegs) * tSpan;

    for (let v = 0; v <= vSegs; v++) {
      const theta = (v / vSegs) * (Math.PI * 0.43); // Leaves central glazed skylight oculus (`theta > 0.43*PI`)
      const p = domePoint(t, theta);

      const idx = (u * (vSegs + 1) + v) * 3;
      positions[idx] = p.x;
      positions[idx + 1] = p.y;
      positions[idx + 2] = p.z;

      const uvIdx = (u * (vSegs + 1) + v) * 2;
      uvs[uvIdx] = (u / uSegs) * (crossSectionClip ? 8 : 16);
      uvs[uvIdx + 1] = (v / vSegs) * 4;
    }
  }

  for (let u = 0; u < uSegs; u++) {
    const nextU = crossSectionClip ? u + 1 : (u + 1) % uCount;
    for (let v = 0; v < vSegs; v++) {
      const a = u * (vSegs + 1) + v;
      const b = nextU * (vSegs + 1) + v;
      const c = nextU * (vSegs + 1) + v + 1;
      const d = u * (vSegs + 1) + v + 1;
      indices.push(a, d, b, b, d, c);
    }
  }

  const domeGeo = new THREE.BufferGeometry();
  domeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  domeGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  domeGeo.setIndex(indices);
  domeGeo.computeVertexNormals();

  const domeMat = createRoofPbrMaterial(
    mats.roof,
    doc.roof.opacity,
    doc.lighting,
    false,
    maxAnisotropy,
    14,
    4
  );
  const domeMesh = new THREE.Mesh(domeGeo, domeMat);
  domeMesh.castShadow = true;
  domeMesh.receiveShadow = true;
  domeMesh.renderOrder = 2;
  group.add(domeMesh);

  // Translucent Zenithal Skylight Crown Cap: a low cone fanned over the contour-shaped oculus
  const oculusTheta = Math.PI * 0.43;
  const capSegs = crossSectionClip ? 48 : 96;
  const capRimCount = crossSectionClip ? capSegs + 1 : capSegs;
  const capPositions: number[] = [];
  for (let s = 0; s < capRimCount; s++) {
    const p = domePoint(tStart + (s / capSegs) * tSpan, oculusTheta, -0.15);
    capPositions.push(p.x, p.y, p.z);
  }
  const capApexY = springY + Math.sin(oculusTheta) * domeRise + 2.25;
  capPositions.push(0, capApexY, 0);
  const capIndices: number[] = [];
  for (let s = 0; s < capSegs; s++) {
    capIndices.push(capRimCount, (s + 1) % capRimCount, s);
  }
  const skylightGeo = new THREE.BufferGeometry();
  skylightGeo.setAttribute('position', new THREE.Float32BufferAttribute(capPositions, 3));
  skylightGeo.setIndex(capIndices);
  skylightGeo.computeVertexNormals();
  const skylightMat = new THREE.MeshPhysicalMaterial({
    color: 0xe0f2fe,
    roughness: 0.08,
    metalness: 0.1,
    clearcoat: 0.95,
    transparent: true,
    opacity: 0.58,
    side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(skylightGeo, skylightMat));

  const structMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);

  // Radial spatial arch ribs + circumferential purlin rings
  const ribCount = crossSectionClip ? 13 : 24;
  for (let r = 0; r < ribCount; r++) {
    const t =
      tStart + (r / (crossSectionClip ? Math.max(1, ribCount - 1) : ribCount)) * tSpan;
    const ribPts: THREE.Vector3[] = [];
    for (let v = 0; v <= 12; v++) {
      ribPts.push(domePoint(t, (v / 12) * (Math.PI * 0.43), -0.25));
    }
    group.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ribPts), 20, 0.42, 6, false),
        structMat
      )
    );
  }

  for (const ringFrac of [0.0, 0.28, 0.56, 0.84]) {
    const th = ringFrac * (Math.PI * 0.43);
    const purlinPts: THREE.Vector3[] = [];
    const segN = crossSectionClip ? 36 : 72;
    for (let s = 0; s <= segN; s++) {
      purlinPts.push(domePoint(tStart + (s / segN) * tSpan, th, -0.2));
    }
    const closedRing = !crossSectionClip;
    group.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(purlinPts, closedRing),
          segN,
          ringFrac === 0 ? 0.68 : 0.34,
          6,
          closedRing
        ),
        structMat
      )
    );
  }

  // V-struts connecting stand crest to dome perimeter compression ring
  const vBayCount = crossSectionClip ? 18 : 36;
  for (let i = 0; i < vBayCount; i++) {
    const frac = crossSectionClip ? i / Math.max(1, vBayCount - 1) : i / vBayCount;
    const t = tStart + frac * tSpan;
    const s0 = sampleRoundedBowlRing(ring, t, 0);
    const d0 = standDepthAtNormal(s0.nx, s0.nz);
    const h0 = standHeightAtNormal(s0.nx, s0.nz);
    const wallPt = sampleRoundedBowlRing(ring, t, d0 - 0.3);
    const domeEdge = domePoint(t, 0);

    group.add(
      createStrutBetween(
        new THREE.Vector3(wallPt.x, h0 - 0.5, wallPt.z),
        domeEdge,
        0.34,
        0.4,
        structMat,
        6
      )
    );
  }

  // Suspended 360° Halo LED Scoreboard & Catwalk Ring under the dome crown!
  if (!crossSectionClip) {
    const haloY = springY + domeRise * 0.45;
    const haloRing = new THREE.Mesh(
      new THREE.CylinderGeometry(19, 19, 4.6, 48, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        emissive: new THREE.Color(0x38bdf8),
        emissiveIntensity: doc.lighting === 'day' ? 0.55 : 1.35,
        roughness: 0.2,
        side: THREE.DoubleSide,
      })
    );
    haloRing.position.y = haloY;
    group.add(haloRing);
  }

  return group;
}

/**
 * Continuous-bowl implementations of `column_supported` and `goalpost_truss`
 */
function buildContinuousColumnOrGoalpostRoof(
  doc: StadiumDocument,
  style: 'column_supported' | 'goalpost_truss',
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const {
    ring,
    innerHalfX,
    innerHalfZ,
    maxStandH,
    avgDepth,
    standHeightAtNormal,
    standDepthAtNormal,
  } = computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);

  const roofY = maxStandH + Math.max(2.6, doc.roof.heightOffset * 0.78);
  const innerOff = avgDepth * (1 - doc.roof.coverageRatio);
  const outerOff = avgDepth + 3.2;

  const membraneMat = createRoofPbrMaterial(
    mats.roof,
    doc.roof.opacity,
    doc.lighting,
    doc.shape === 'octagonal_arena',
    maxAnisotropy
  );
  const primaryStructMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);

  group.add(
    buildAnnularCanopyMesh(
      ring,
      doc.shape,
      innerOff,
      outerOff,
      roofY + (style === 'column_supported' ? -0.4 : 0.4),
      roofY + 0.3,
      crossSectionClip,
      membraneMat
    ),
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerOff,
      roofY - 0.65,
      doc.lighting,
      crossSectionClip
    )
  );

  // Rear perimeter columns
  const rearCols = Math.max(14, Math.round(40 * arcFraction));
  for (let i = 0; i < rearCols; i++) {
    const frac = closed ? i / rearCols : i / Math.max(1, rearCols - 1);
    const t = tStart + frac * (tEnd - tStart);
    const s0 = sampleRoundedBowlRing(ring, t, 0);
    const d0 = standDepthAtNormal(s0.nx, s0.nz);
    const h0 = standHeightAtNormal(s0.nx, s0.nz);
    const pRear = sampleRoundedBowlRing(ring, t, d0 - 0.3);
    const pRoof = sampleRoundedBowlRing(ring, t, outerOff - 0.6);
    group.add(
      createStrutBetween(
        new THREE.Vector3(pRear.x, h0 - 0.6, pRear.z),
        new THREE.Vector3(pRoof.x, roofY + 0.25, pRoof.z),
        0.3,
        0.34,
        primaryStructMat,
        6
      )
    );
  }

  if (style === 'column_supported') {
    // Slender stanchion columns planted directly inside the upper third of the seating bowl!
    const stanchionCount = Math.max(12, Math.round(32 * arcFraction));
    for (let i = 0; i < stanchionCount; i++) {
      const frac = closed ? i / stanchionCount : i / Math.max(1, stanchionCount - 1);
      const t = tStart + frac * (tEnd - tStart);
      const s0 = sampleRoundedBowlRing(ring, t, 0);
      const d0 = standDepthAtNormal(s0.nx, s0.nz);
      const h0 = standHeightAtNormal(s0.nx, s0.nz);
      const plantOff = Math.max(innerOff + 2.2, d0 * 0.58);
      const pStand = sampleRoundedBowlRing(ring, t, plantOff);
      const footY = Math.max(2.0, h0 * 0.56);
      group.add(
        createStrutBetween(
          new THREE.Vector3(pStand.x, footY, pStand.z),
          new THREE.Vector3(pStand.x, roofY - 0.15, pStand.z),
          0.16,
          0.18,
          primaryStructMat,
          6
        )
      );
    }
  } else {
    // `goalpost_truss`: 4 corner steel lattice pylons carrying monumental full-length box-girders!
    const cornerX = innerHalfX + avgDepth * 0.55;
    const cornerZ = innerHalfZ + innerOff + 2.5;
    const girderTopY = roofY + 7.5;
    const girderBotY = roofY + 3.8;

    const zList = crossSectionClip ? [-cornerZ] : [-cornerZ, cornerZ];
    for (const gz of zList) {
      for (const xSign of [-1, 1] as const) {
        const tower = new THREE.Mesh(
          new THREE.BoxGeometry(3.4, girderTopY + 1.2, 3.4),
          primaryStructMat
        );
        tower.position.set(xSign * cornerX, (girderTopY + 1.2) / 2, gz);
        tower.castShadow = true;
        group.add(tower);
      }
      // Top & bottom chords of the monumental goalpost box-truss
      for (const cy of [girderBotY, girderTopY]) {
        const chord = new THREE.Mesh(
          new THREE.BoxGeometry(cornerX * 2, 0.52, 2.2),
          primaryStructMat
        );
        chord.position.set(0, cy, gz);
        chord.castShadow = true;
        group.add(chord);
      }
      const bays = 16;
      const bw = (cornerX * 2) / bays;
      for (let b = 0; b < bays; b++) {
        const x0 = -cornerX + b * bw;
        const x1 = x0 + bw;
        const xm = (x0 + x1) * 0.5;
        group.add(
          createStrutBetween(
            new THREE.Vector3(x0, girderBotY, gz),
            new THREE.Vector3(x1, girderTopY, gz),
            0.16,
            0.16,
            primaryStructMat,
            5
          ),
          createStrutBetween(
            new THREE.Vector3(x1, girderBotY, gz),
            new THREE.Vector3(x0, girderTopY, gz),
            0.16,
            0.16,
            primaryStructMat,
            5
          ),
          // Vertical hanger rod down to canopy
          createStrutBetween(
            new THREE.Vector3(xm, girderBotY, gz),
            new THREE.Vector3(xm, roofY + 0.3, gz),
            0.1,
            0.1,
            primaryStructMat,
            5
          )
        );
      }
    }
  }

  return group;
}

/**
 * Stand-by-stand roof builder supporting `cantilever`, `truss`, `column_supported`,
 * and `goalpost_truss` (including per-stand heterogeneity on English / 4-stand grounds!).
 */
function buildSingleStandRoofGroup(
  style: RoofStyle,
  roofSpan: number,
  roofDepth: number,
  frontZ: number,
  rearZ: number,
  standTopY: number,
  roofHeight: number,
  doc: StadiumDocument,
  membraneMat: THREE.Material,
  primaryStructMat: THREE.Material,
  secondarySteelMat: THREE.Material,
  openNegEnd: boolean = true,
  openPosEnd: boolean = true
): THREE.Group {
  const standRoofGroup = new THREE.Group();
  const midZ = (rearZ + frontZ) / 2;

  if (style === 'none') {
    return standRoofGroup;
  }

  if (style === 'column_supported') {
    // Classic British / historic roof resting on slender columns planted in the upper rows!
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(roofSpan, 0.32, roofDepth),
      membraneMat
    );
    deck.position.set(0, roofHeight - 0.2, midZ);
    deck.rotation.x = 0.035; // Slight pitched marquee slope
    deck.castShadow = true;
    deck.receiveShadow = true;
    standRoofGroup.add(deck);

    // Front lattice valance fascia girder
    const valance = new THREE.Mesh(
      new THREE.BoxGeometry(roofSpan, 1.15, 0.28),
      primaryStructMat
    );
    valance.position.set(0, roofHeight - 0.55, frontZ + 0.5);
    standRoofGroup.add(valance);

    standRoofGroup.add(
      buildStraightCatwalkFloodlights(roofSpan, frontZ, roofHeight - 0.25, doc.lighting)
    );

    const colCount = Math.max(6, Math.floor(roofSpan / 13.5));
    const stanchionZ = frontZ + Math.min(3.4, roofDepth * 0.22);
    const terraceFootY = Math.max(1.8, standTopY * 0.54);

    for (let i = 0; i < colCount; i++) {
      const cx =
        -roofSpan / 2 + 3.5 + (i * (roofSpan - 7)) / Math.max(1, colCount - 1);
      standRoofGroup.add(
        // Slender steel stanchion column planted right inside the seating rows!
        createStrutBetween(
          new THREE.Vector3(cx, terraceFootY, stanchionZ),
          new THREE.Vector3(cx, roofHeight - 0.2, stanchionZ),
          0.16,
          0.19,
          primaryStructMat,
          6
        ),
        // Knee braces from stanchion top to front valance
        createStrutBetween(
          new THREE.Vector3(cx, roofHeight - 1.5, stanchionZ),
          new THREE.Vector3(cx - 1.4, roofHeight - 0.35, stanchionZ),
          0.08,
          0.08,
          secondarySteelMat,
          4
        ),
        createStrutBetween(
          new THREE.Vector3(cx, roofHeight - 1.5, stanchionZ),
          new THREE.Vector3(cx + 1.4, roofHeight - 0.35, stanchionZ),
          0.08,
          0.08,
          secondarySteelMat,
          4
        ),
        // Rear support column on back wall
        createStrutBetween(
          new THREE.Vector3(cx, Math.max(0, standTopY - 2.0), rearZ - 1.2),
          new THREE.Vector3(cx, roofHeight + 0.1, rearZ - 1.2),
          0.26,
          0.3,
          primaryStructMat,
          6
        )
      );
    }

    return standRoofGroup;
  }

  if (style === 'goalpost_truss') {
    // Monumental "Poutre-portique" (Goalpost) box-girder resting on 2 corner mega-pylons!
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(roofSpan, 0.38, roofDepth),
      membraneMat
    );
    deck.position.set(0, roofHeight, midZ);
    deck.castShadow = true;
    deck.receiveShadow = true;
    standRoofGroup.add(deck);

    standRoofGroup.add(
      buildStraightCatwalkFloodlights(roofSpan, frontZ, roofHeight, doc.lighting)
    );

    const pylonX = roofSpan / 2 + 1.8;
    const girderBotY = roofHeight + 3.6;
    const girderTopY = roofHeight + 7.6;
    const girderZ = frontZ + Math.min(4.2, roofDepth * 0.24);

    // 2 Corner Mega-Pylons: planted at front girder ONLY on open ends; shifted behind rear wall on closed corners!
    for (const sSign of [-1, 1] as const) {
      const isOpenEnd = sSign === -1 ? openNegEnd : openPosEnd;
      const px = sSign * (isOpenEnd ? pylonX : roofSpan * 0.5 - 0.6);
      const pylonZ = isOpenEnd ? girderZ : rearZ + 1.2;
      const pylon = new THREE.Mesh(
        new THREE.BoxGeometry(3.0, girderTopY + 1.4, 3.2),
        primaryStructMat
      );
      pylon.position.set(px, (girderTopY + 1.4) / 2, pylonZ);
      pylon.castShadow = true;
      standRoofGroup.add(pylon);

      standRoofGroup.add(
        createStrutBetween(
          new THREE.Vector3(px, isOpenEnd ? 0 : standTopY, isOpenEnd ? rearZ + 1.5 : rearZ - 0.5),
          new THREE.Vector3(px, girderTopY, girderZ),
          0.38,
          0.48,
          primaryStructMat,
          6
        )
      );
    }

    // Horizontal 4-chord spatial goalpost box-girder spanning the full stand!
    for (const cy of [girderBotY, girderTopY]) {
      for (const czOff of [-1.1, 1.1]) {
        const chord = new THREE.Mesh(
          new THREE.BoxGeometry(pylonX * 2 + 1.2, 0.44, 0.44),
          primaryStructMat
        );
        chord.position.set(0, cy, girderZ + czOff);
        chord.castShadow = true;
        standRoofGroup.add(chord);
      }
    }

    const bayCount = Math.max(10, Math.floor((pylonX * 2) / 7.5));
    const bayW = (pylonX * 2) / bayCount;
    for (let b = 0; b < bayCount; b++) {
      const x0 = -pylonX + b * bayW;
      const x1 = x0 + bayW;
      const xm = (x0 + x1) * 0.5;
      standRoofGroup.add(
        createStrutBetween(
          new THREE.Vector3(x0, girderBotY, girderZ - 1.1),
          new THREE.Vector3(x1, girderTopY, girderZ - 1.1),
          0.14,
          0.14,
          primaryStructMat,
          5
        ),
        createStrutBetween(
          new THREE.Vector3(x1, girderBotY, girderZ + 1.1),
          new THREE.Vector3(x0, girderTopY, girderZ + 1.1),
          0.14,
          0.14,
          primaryStructMat,
          5
        ),
        // Vertical hanger rod suspending roof rafter from goalpost girder
        createStrutBetween(
          new THREE.Vector3(xm, girderBotY, girderZ),
          new THREE.Vector3(xm, roofHeight + 0.15, girderZ),
          0.11,
          0.11,
          secondarySteelMat,
          5
        ),
        // Transverse roof rafter back to rear stand crest
        createStrutBetween(
          new THREE.Vector3(xm, roofHeight + 0.2, frontZ + 0.5),
          new THREE.Vector3(xm, roofHeight + 0.2, rearZ - 0.5),
          0.18,
          0.18,
          secondarySteelMat,
          5
        ),
        createStrutBetween(
          new THREE.Vector3(xm, Math.max(0, standTopY - 1.8), rearZ - 1.4),
          new THREE.Vector3(xm, roofHeight + 0.2, rearZ - 1.4),
          0.26,
          0.3,
          primaryStructMat,
          6
        )
      );
    }

    return standRoofGroup;
  }

  if (style === 'truss') {
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(roofSpan, 0.36, roofDepth),
      membraneMat
    );
    deck.position.set(0, roofHeight, midZ);
    deck.castShadow = true;
    deck.receiveShadow = true;
    standRoofGroup.add(deck);

    standRoofGroup.add(
      buildStraightCatwalkFloodlights(roofSpan, frontZ, roofHeight, doc.lighting)
    );

    const rearCols = Math.max(6, Math.floor(roofSpan / 13));
    for (let c = 0; c < rearCols; c++) {
      const cx = -roofSpan / 2 + 2 + (c * (roofSpan - 4)) / Math.max(1, rearCols - 1);
      standRoofGroup.add(
        createStrutBetween(
          new THREE.Vector3(cx, Math.max(0, standTopY - 2.2), rearZ - 1.6),
          new THREE.Vector3(cx, roofHeight + 0.2, rearZ - 1.6),
          0.28,
          0.32,
          primaryStructMat,
          6
        ),
        createStrutBetween(
          new THREE.Vector3(cx, roofHeight - 0.25, rearZ - 0.4),
          new THREE.Vector3(cx, roofHeight - 0.25, frontZ + 0.4),
          0.2,
          0.2,
          secondarySteelMat,
          5
        )
      );
    }

    const gableGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0xcbd5e1,
      roughness: 0.14,
      metalness: 0.15,
      clearcoat: 0.9,
      transparent: true,
      opacity: 0.52,
      side: THREE.DoubleSide,
    });

    const girderH = 2.8;
    for (const sSign of [-1, 1] as const) {
      const isOpenEnd = sSign === -1 ? openNegEnd : openPosEnd;
      if (!isOpenEnd) continue;

      const gx = sSign * (roofSpan / 2 - 0.6);
      standRoofGroup.add(
        createStrutBetween(
          new THREE.Vector3(gx, 0, frontZ + 1.4),
          new THREE.Vector3(gx, roofHeight + girderH, frontZ + 0.8),
          0.42,
          0.52,
          primaryStructMat,
          6
        ),
        createStrutBetween(
          new THREE.Vector3(gx, 0, rearZ - 0.8),
          new THREE.Vector3(gx, roofHeight + 0.4, rearZ - 0.8),
          0.42,
          0.52,
          primaryStructMat,
          6
        )
      );

      const gableH = Math.max(3.5, roofHeight - standTopY * 0.55);
      const gable = new THREE.Mesh(
        new THREE.PlaneGeometry(roofDepth * 0.88, gableH),
        gableGlassMat
      );
      gable.rotation.y = Math.PI / 2;
      gable.position.set(gx, roofHeight - gableH / 2, midZ);
      standRoofGroup.add(gable);
    }

    for (const yOff of [0.25, girderH]) {
      const chord = new THREE.Mesh(
        new THREE.BoxGeometry(roofSpan, 0.34, 0.42),
        primaryStructMat
      );
      chord.position.set(0, roofHeight + yOff, frontZ + 0.6);
      standRoofGroup.add(chord);
    }

    const bayCount = Math.max(10, Math.floor(roofSpan / 6));
    const bayW = roofSpan / bayCount;
    for (let b = 0; b < bayCount; b++) {
      const x0 = -roofSpan / 2 + b * bayW;
      const x1 = x0 + bayW;
      standRoofGroup.add(
        createStrutBetween(
          new THREE.Vector3(x0, roofHeight + 0.25, frontZ + 0.6),
          new THREE.Vector3(x1, roofHeight + girderH, frontZ + 0.6),
          0.1,
          0.1,
          primaryStructMat,
          5
        ),
        createStrutBetween(
          new THREE.Vector3(x1, roofHeight + 0.25, frontZ + 0.6),
          new THREE.Vector3(x0, roofHeight + girderH, frontZ + 0.6),
          0.1,
          0.1,
          primaryStructMat,
          5
        )
      );
    }

    return standRoofGroup;
  }

  // Default stand roof: `cantilever` (rear-anchored cantilever frames without front columns)
  const tiltAngle = -0.055;
  const deckSlab = new THREE.Mesh(
    new THREE.BoxGeometry(roofSpan, 0.42, roofDepth),
    membraneMat
  );
  deckSlab.position.set(0, roofHeight + 0.4, midZ);
  deckSlab.rotation.x = tiltAngle;
  deckSlab.castShadow = true;
  deckSlab.receiveShadow = true;
  standRoofGroup.add(deckSlab);

  standRoofGroup.add(
    buildStraightCatwalkFloodlights(roofSpan, frontZ, roofHeight + 0.4, doc.lighting)
  );

  const frameCount = Math.max(7, Math.floor(roofSpan / 11));
  for (let i = 0; i < frameCount; i++) {
    const rx = -roofSpan / 2 + 2.5 + (i * (roofSpan - 5)) / Math.max(1, frameCount - 1);

    standRoofGroup.add(
      createStrutBetween(
        new THREE.Vector3(rx, 0, rearZ + 0.6),
        new THREE.Vector3(rx, roofHeight + 3.4, rearZ - 0.2),
        0.34,
        0.46,
        primaryStructMat,
        6
      ),
      createStrutBetween(
        new THREE.Vector3(rx, standTopY - 1.2, rearZ - 2.6),
        new THREE.Vector3(rx, roofHeight + 0.3, rearZ - 2.6),
        0.26,
        0.26,
        secondarySteelMat,
        6
      ),
      createStrutBetween(
        new THREE.Vector3(rx, roofHeight + 3.3, rearZ - 0.2),
        new THREE.Vector3(rx, roofHeight + 1.25, frontZ + 2.5),
        0.18,
        0.34,
        primaryStructMat,
        6
      ),
      createStrutBetween(
        new THREE.Vector3(rx, roofHeight + 2.3, midZ),
        new THREE.Vector3(rx, roofHeight + 0.55, midZ),
        0.12,
        0.12,
        secondarySteelMat,
        5
      )
    );
  }

  return standRoofGroup;
}

export function generateRoofGroup(
  doc: StadiumDocument,
  crossSectionClip: boolean = false,
  maxAnisotropy: number = 4
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'RoofAssembly';

  const sides: StandSide[] = ['north', 'south', 'east', 'west'];
  const hasPerStandOverrides =
    !isContinuousBowlShape(doc.shape) &&
    sides.some(
      (s) =>
        doc.stands[s].enabled &&
        doc.stands[s].roofStyleOverride &&
        doc.stands[s].roofStyleOverride !== 'inherit'
    );

  if (doc.roof.style === 'none' && !hasPerStandOverrides) {
    return root;
  }

  // Whole-arena roof systems (when no heterogeneous per-stand overrides are active)
  if (!hasPerStandOverrides) {
    if (doc.roof.style === 'enveloping_shell') {
      root.add(buildEnvelopingShellRoof(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    if (doc.roof.style === 'suspended_masts') {
      root.add(buildSuspendedMastsRoof(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    if (doc.roof.style === 'twin_arch') {
      root.add(buildTwinArchRoof(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    if (doc.roof.style === 'retractable') {
      root.add(buildRetractableRoof(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    if (doc.roof.style === 'giant_arch') {
      root.add(buildGiantArchRoof(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    if (doc.roof.style === 'bowstring_arch') {
      root.add(buildBowstringArchRoof(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    if (doc.roof.style === 'bicycle_wheel') {
      root.add(buildBicycleWheelCableRoof(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    if (doc.roof.style === 'tensile_net') {
      root.add(buildTensileNetMembraneRoof(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    if (doc.roof.style === 'fixed_dome') {
      root.add(buildFixedDomeRoof(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    if (
      isContinuousBowlShape(doc.shape) &&
      (doc.roof.style === 'column_supported' || doc.roof.style === 'goalpost_truss')
    ) {
      root.add(
        buildContinuousColumnOrGoalpostRoof(
          doc,
          doc.roof.style,
          crossSectionClip,
          maxAnisotropy
        )
      );
      return root;
    }
  }

  const mats = resolveStadiumMaterials(doc);
  const membraneMat = createRoofPbrMaterial(
    mats.roof,
    doc.roof.opacity,
    doc.lighting,
    doc.shape === 'octagonal_arena',
    maxAnisotropy,
    10,
    2
  );
  const primaryStructMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const secondarySteelMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.34,
    metalness: 0.82,
  });

  // Continuous Bowl / Octagon / Horseshoe External Spine Cantilever (or Truss fallback on continuous bowl)
  if (isContinuousBowlShape(doc.shape)) {
    const { ring, maxStandH, avgDepth, standDepthAtNormal } = computeStadiumRingBounds(doc);
    const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
    const arcFraction = Math.max(0.25, tEnd - tStart);
    const sunkenDepth = getEffectiveSunkenDepth(doc);
    const groundY = Math.min(sunkenDepth, maxStandH * 0.6);
    const roofY = maxStandH + Math.max(2.2, doc.roof.heightOffset * 0.75);
    const innerOff = avgDepth * (1 - doc.roof.coverageRatio);
    const outerOff = avgDepth + 3.2;

    root.add(
      buildAnnularCanopyMesh(
        ring,
        doc.shape,
        innerOff,
        outerOff,
        roofY + 0.9,
        roofY - 0.2,
        crossSectionClip,
        membraneMat
      ),
      buildAnnularCatwalkFloodlights(
        ring,
        doc.shape,
        innerOff,
        roofY + 0.55,
        doc.lighting,
        crossSectionClip
      )
    );

    const frameCount = Math.max(12, Math.round(40 * arcFraction));
    for (let i = 0; i < frameCount; i++) {
      const frac = closed ? i / frameCount : i / Math.max(1, frameCount - 1);
      const t = tStart + frac * (tEnd - tStart);
      const s0 = sampleRoundedBowlRing(ring, t, 0);
      const localD = standDepthAtNormal(s0.nx, s0.nz);

      const pGround = sampleRoundedBowlRing(ring, t, Math.max(outerOff + 1.2, localD + 2.2));
      const pKnee = sampleRoundedBowlRing(ring, t, outerOff + 0.5);
      const pMid = sampleRoundedBowlRing(ring, t, (innerOff + outerOff) * 0.52);
      const pTip = sampleRoundedBowlRing(ring, t, innerOff + 1.2);

      const spineCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(pGround.x, groundY, pGround.z),
        new THREE.Vector3(pKnee.x, groundY + (roofY - groundY) * 0.72, pKnee.z),
        new THREE.Vector3(pKnee.x, roofY + 3.2, pKnee.z),
        new THREE.Vector3(pMid.x, roofY + 2.6, pMid.z),
        new THREE.Vector3(pTip.x, roofY + 1.1, pTip.z),
      ]);
      root.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(spineCurve, 20, 0.34, 6, false),
          primaryStructMat
        )
      );

      root.add(
        createStrutBetween(
          new THREE.Vector3(pMid.x, roofY + 2.5, pMid.z),
          new THREE.Vector3(pMid.x, roofY + 0.35, pMid.z),
          0.12,
          0.12,
          secondarySteelMat,
          5
        )
      );
    }

    return root;
  }

  // Stand-by-Stand Anchored Roofs (`cantilever`, `truss`, `column_supported`, `goalpost_truss`)
  const trackOffsets = getTrackRadialOffset(doc);
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

  const standRoofBounds: Partial<
    Record<
      StandSide,
      {
        style: RoofStyle;
        frontZ: number;
        rearZ: number;
        standTopY: number;
        roofHeight: number;
      }
    >
  > = {};

  for (const side of sides) {
    if (crossSectionClip && side === 'south') continue;

    const stand = doc.stands[side];
    if (!stand.enabled || stand.rows <= 0) continue;

    const effectiveStyle = resolveStandRoofStyle(doc, side);
    if (effectiveStyle === 'none') continue;

    const metrics = calculateStandMetrics(doc, side);
    const spanSpec = rectLayout.straight[side];
    const roofSpan = spanSpec.span;

    const standTopY = metrics.maxHeight;
    const roofHeight = standTopY + Math.max(2.4, doc.roof.heightOffset * 0.72);
    const roofDepth = Math.max(12, metrics.totalDepth * doc.roof.coverageRatio + 3.6);
    const rearZ = metrics.totalDepth + 2.8;
    const frontZ = rearZ - roofDepth;

    standRoofBounds[side] = {
      style: effectiveStyle,
      frontZ,
      rearZ,
      standTopY,
      roofHeight,
    };

    const standRoofGroup = buildSingleStandRoofGroup(
      effectiveStyle,
      roofSpan,
      roofDepth,
      frontZ,
      rearZ,
      standTopY,
      roofHeight,
      doc,
      membraneMat,
      primaryStructMat,
      secondarySteelMat,
      spanSpec.capNegLocalX,
      spanSpec.capPosLocalX
    );

    if (side === 'south') {
      standRoofGroup.position.set(spanSpec.centerCoord, 0, spanSpec.frontDist);
    } else if (side === 'north') {
      standRoofGroup.position.set(spanSpec.centerCoord, 0, -spanSpec.frontDist);
      standRoofGroup.rotation.y = Math.PI;
    } else if (side === 'east') {
      standRoofGroup.position.set(spanSpec.frontDist, 0, spanSpec.centerCoord);
      standRoofGroup.rotation.y = Math.PI / 2;
    } else if (side === 'west') {
      standRoofGroup.position.set(-spanSpec.frontDist, 0, spanSpec.centerCoord);
      standRoofGroup.rotation.y = -Math.PI / 2;
    }

    root.add(standRoofGroup);
  }

  // Seamless 3D Corner Roof Canopy Quadrants + Hip Cantilever Rafters when corners are closed
  if (rectLayout.closedCornersMode) {
    const cornerOrder: CornerQuadrantId[] = ['se', 'sw', 'nw', 'ne'];
    for (const cId of cornerOrder) {
      const corner = rectLayout.corners[cId];
      if (!corner.active) continue;

      const bA = standRoofBounds[corner.sideA];
      const bB = standRoofBounds[corner.sideB];
      if (!bA && !bB) continue;

      const boundA = bA ?? bB!;
      const boundB = bB ?? bA!;
      const segs = corner.facetedThreeBay ? 15 : 18;
      const cornerRoofGroup = new THREE.Group();
      cornerRoofGroup.name = `CornerRoof_${cId.toUpperCase()}`;

      const pos = new Float32Array((segs + 1) * 2 * 3);
      const uvs = new Float32Array((segs + 1) * 2 * 2);
      const idx: number[] = [];
      const catwalkPts: THREE.Vector3[] = [];

      const sliceBounds: {
        frontD: number;
        rearD: number;
        frontY: number;
        rearY: number;
        standTopY: number;
      }[] = [];

      for (let s = 0; s <= segs; s++) {
        const u = s / segs;
        const w = u * u * (3 - 2 * u);

        const frontD = boundA.frontZ + (boundB.frontZ - boundA.frontZ) * w;
        const rearD = boundA.rearZ + (boundB.rearZ - boundA.rearZ) * w;
        const baseRoofH = boundA.roofHeight + (boundB.roofHeight - boundA.roofHeight) * w;
        const standTopY = boundA.standTopY + (boundB.standTopY - boundA.standTopY) * w;

        const frontY = baseRoofH + 0.65;
        const rearY = baseRoofH + 0.05;
        sliceBounds.push({ frontD, rearD, frontY, rearY, standTopY });

        const pIn = sampleCornerQuadrantPoint(corner, u, frontD);
        const pOut = sampleCornerQuadrantPoint(corner, u, rearD);
        const pCat = sampleCornerQuadrantPoint(corner, u, frontD + 1.1);
        catwalkPts.push(new THREE.Vector3(pCat.x, frontY - 0.38, pCat.z));

        const b = s * 6;
        pos[b] = pIn.x;
        pos[b + 1] = frontY;
        pos[b + 2] = pIn.z;
        pos[b + 3] = pOut.x;
        pos[b + 4] = rearY;
        pos[b + 5] = pOut.z;

        const uCoord = u * 3.5;
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
        idx.push(a, b, d, b, c, d);
      }

      const canopyGeo = new THREE.BufferGeometry();
      canopyGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      canopyGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      canopyGeo.setIndex(idx);
      canopyGeo.computeVertexNormals();
      const canopyMesh = new THREE.Mesh(canopyGeo, membraneMat);
      canopyMesh.castShadow = true;
      canopyMesh.receiveShadow = true;
      canopyMesh.renderOrder = 2;
      cornerRoofGroup.add(canopyMesh);

      // Radial Hip Cantilever Frames & Rear Structural Columns
      const hipCount = corner.facetedThreeBay ? 4 : 5;
      for (let h = 0; h < hipCount; h++) {
        const u = corner.facetedThreeBay ? h / 3 : (h + 0.5) / hipCount;
        const sIdx = Math.min(segs, Math.round(u * segs));
        const sb = sliceBounds[sIdx];
        const pRearFoot = sampleCornerQuadrantPoint(corner, u, sb.rearD + 0.3);
        const pRearCrest = sampleCornerQuadrantPoint(corner, u, sb.rearD - 2.2);
        const pMid = sampleCornerQuadrantPoint(corner, u, (sb.frontD + sb.rearD) * 0.5);
        const pFront = sampleCornerQuadrantPoint(corner, u, sb.frontD + 1.8);

        cornerRoofGroup.add(
          createStrutBetween(
            new THREE.Vector3(pRearFoot.x, 0, pRearFoot.z),
            new THREE.Vector3(pRearFoot.x, sb.rearY + 3.0, pRearFoot.z),
            0.32,
            0.44,
            primaryStructMat,
            6
          ),
          createStrutBetween(
            new THREE.Vector3(pRearCrest.x, Math.max(0, sb.standTopY - 1.2), pRearCrest.z),
            new THREE.Vector3(pRearCrest.x, sb.rearY, pRearCrest.z),
            0.24,
            0.26,
            secondarySteelMat,
            6
          ),
          createStrutBetween(
            new THREE.Vector3(pRearFoot.x, sb.rearY + 2.9, pRearFoot.z),
            new THREE.Vector3(pFront.x, sb.frontY + 0.75, pFront.z),
            0.18,
            0.32,
            primaryStructMat,
            6
          ),
          createStrutBetween(
            new THREE.Vector3(pMid.x, sb.rearY + 1.85, pMid.z),
            new THREE.Vector3(pMid.x, (sb.frontY + sb.rearY) * 0.5 + 0.1, pMid.z),
            0.12,
            0.12,
            secondarySteelMat,
            5
          )
        );
      }

      // Corner Catwalk Gantry + Floodlight Pods
      if (catwalkPts.length >= 3) {
        const gantryMat = new THREE.MeshStandardMaterial({
          color: 0x1e293b,
          roughness: 0.38,
          metalness: 0.82,
        });
        cornerRoofGroup.add(
          new THREE.Mesh(
            new THREE.TubeGeometry(
              new THREE.CatmullRomCurve3(catwalkPts, false),
              segs,
              0.22,
              6,
              false
            ),
            gantryMat
          )
        );

        const isLit = doc.lighting !== 'day';
        const podMat = new THREE.MeshStandardMaterial({
          color: isLit ? 0xffffff : 0xcbd5e1,
          emissive: new THREE.Color(isLit ? 0xfef9c3 : 0x000000),
          emissiveIntensity:
            doc.lighting === 'night' ? 2.6 : doc.lighting === 'dusk' ? 1.8 : 0,
          roughness: 0.2,
          metalness: 0.6,
        });
        const podGeo = new THREE.BoxGeometry(1.9, 0.55, 0.45);
        for (const uPod of [0.22, 0.5, 0.78]) {
          const sIdx = Math.min(segs, Math.round(uPod * segs));
          const sb = sliceBounds[sIdx];
          const pp = sampleCornerQuadrantPoint(corner, uPod, sb.frontD + 0.9);
          const pod = new THREE.Mesh(podGeo, podMat);
          pod.position.set(pp.x, sb.frontY - 0.65, pp.z);
          pod.lookAt(0, 0, 0);
          cornerRoofGroup.add(pod);
        }
      }

      root.add(cornerRoofGroup);
    }
  }

  return root;
}

import * as THREE from 'three';
import {
  buildShapeBowlRing,
  computeRectangularCornerLayout,
  CornerQuadrantId,
  getBowlArcRange,
  MIN_PITCH_SETBACK,
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
  createFacadePbrMaterial,
  createRoofPbrMaterial,
  createRoofShadowDepthMaterial,
  createStructurePbrMaterial,
  resolveStadiumMaterials,
} from './materials';
import {
  clampPitchToTrack,
  getEffectiveSunkenDepth,
  isContinuousBowlShape,
  LightingMode,
  resolveAllCorners,
  resolveCornerPylonFrame,
  resolveCounterweightTrusses,
  resolveFloodlightRig,
  resolvePortalCount,
  resolveSpanningGirderCount,
  resolveSuspendedMasts,
  resolveWaveAmplitude,
  RoofStyle,
  StadiumDocument,
  StadiumShape,
  StandSide,
} from './schema';
import { buildRetractablePanels } from './generateRetractableRoof';
import { beamGeometry, chordAt, mergedMesh } from './roofBeams';

function hasRoofGantryLights(doc: StadiumDocument): boolean {
  const rig = resolveFloodlightRig(doc);
  return rig === 'roof_gantry' || rig === 'both';
}

function buildCanopyMaterialBundle(
  doc: StadiumDocument,
  maxAnisotropy: number,
  repeatU: number = 12,
  repeatV: number = 2,
  shadowRepeatU: number = 1,
  opacityCap?: number
): {
  surfaceMat: THREE.MeshPhysicalMaterial;
  shadowDepthMat: THREE.MeshDepthMaterial;
} {
  const mats = resolveStadiumMaterials(doc);
  const effOpacity =
    opacityCap !== undefined ? Math.min(opacityCap, doc.roof.opacity) : doc.roof.opacity;
  const skyMode = doc.roof.skylightMode ?? 'none';
  const skyRatio = doc.roof.skylightRatio ?? 0;

  return {
    surfaceMat: createRoofPbrMaterial(
      mats.roof,
      effOpacity,
      doc.lighting,
      doc.shape === 'octagonal_arena',
      maxAnisotropy,
      repeatU,
      repeatV,
      skyMode,
      skyRatio
    ),
    shadowDepthMat: createRoofShadowDepthMaterial(
      mats.roof,
      effOpacity,
      skyMode,
      skyRatio,
      shadowRepeatU,
      1
    ),
  };
}

function createOrientedRoofBoxGeometry(
  width: number,
  height: number,
  depth: number
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(width, height, depth);
  const uv = geo.attributes.uv;
  if (uv) {
    for (let i = 0; i < uv.count; i++) {
      uv.setY(i, 1 - uv.getY(i));
    }
    uv.needsUpdate = true;
  }
  return geo;
}

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

  // Separate stands sit at their own distance from the pitch, while the ring uses the mean per
  // axis: this is how far a stand's front (and back) is pushed out from the ring.
  const separateStands = !isContinuousBowlShape(doc.shape);
  const standShiftAtNormal = (nx: number, nz: number): number => {
    if (!separateStands) return 0;
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
    if (!hasConcourse) {
      return avgDepth + defaultExtra;
    }
    const d = standDepthAtNormal(nx, nz);
    return overConcourse ? d + concourseWidth + 0.45 : d + 0.8;
  };

  const nominalOuterOffset = (defaultExtra: number = 3.4): number => {
    if (!hasConcourse) {
      return avgDepth + defaultExtra;
    }
    return overConcourse ? avgDepth + concourseWidth + 0.45 : avgDepth + 0.8;
  };

  const exteriorSupportMinOffsetAt = (nx: number, nz: number): number => {
    const d = standDepthAtNormal(nx, nz);
    return hasConcourse ? d + concourseWidth + 1.6 : d + 2.2;
  };

  const avgDistX =
    (doc.stands.east.distanceToPitch + doc.stands.west.distanceToPitch) * 0.5;
  const avgDistZ =
    (doc.stands.north.distanceToPitch + doc.stands.south.distanceToPitch) * 0.5;

  const innerHalfX =
    safePitch.length / 2 +
    Math.max(safePitch.hasTrack ? 0 : MIN_PITCH_SETBACK, avgDistX) +
    trackOffsets.endOffset;
  const innerHalfZ =
    safePitch.width / 2 +
    Math.max(safePitch.hasTrack ? 0 : MIN_PITCH_SETBACK, avgDistZ) +
    trackOffsets.sideOffset;

  const ring = buildShapeBowlRing(
    doc.shape,
    safePitch.length,
    safePitch.width,
    avgDistX,
    avgDistZ,
    trackOffsets.endOffset,
    trackOffsets.sideOffset,
    safePitch.hasTrack
  );

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

/** Spacing of the standing-seam ribs across a canopy, along the ring (m). */
const CANOPY_SEAM_SPACING = 4.5;

/**
 * Architectural finish of a canopy surface described by its spokes (one polyline per ring sample,
 * from the pitch-side edge to the rear edge, on the top surface):
 * - a deep leading-edge fascia and a slimmer rear fascia, so the roof reads as a built slab with
 *   thickness instead of a sheet;
 * - raised standing-seam ribs running from front to back, which catch the sun the way metal and
 *   membrane roofs do.
 */
function buildCanopyDetail(
  spokes: THREE.Vector3[][],
  closed: boolean,
  surfaceMat: THREE.Material
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'RoofCanopyDetail';
  if (spokes.length < 2) return group;

  const base =
    (surfaceMat as THREE.MeshStandardMaterial).color?.clone() ?? new THREE.Color(0xf1f5f9);
  const edgeMat = new THREE.MeshStandardMaterial({
    color: base.clone().lerp(new THREE.Color(0xffffff), 0.35),
    roughness: 0.42,
    metalness: 0.35,
    side: THREE.DoubleSide,
  });
  const seamMat = new THREE.MeshStandardMaterial({
    color: base.clone().lerp(new THREE.Color(0xffffff), 0.5),
    roughness: 0.3,
    metalness: 0.55,
    side: THREE.DoubleSide,
  });

  const count = spokes.length;
  const segs = closed ? count : count - 1;

  // Vertical band hanging under one edge rail.
  const fascia = (pick: (spoke: THREE.Vector3[]) => THREE.Vector3, depth: number) => {
    const pos: number[] = [];
    const idx: number[] = [];
    for (const spoke of spokes) {
      const p = pick(spoke);
      pos.push(p.x, p.y + 0.05, p.z, p.x, p.y - depth, p.z);
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      const b = ((i + 1) % count) * 2;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, edgeMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  group.add(
    fascia((spoke) => spoke[0], 1.5),
    fascia((spoke) => spoke[spoke.length - 1], 0.9)
  );

  // Seam ribs: a small triangular ridge along every n-th spoke, n chosen for the target spacing.
  let frontLength = 0;
  for (let i = 1; i < count; i++) frontLength += spokes[i][0].distanceTo(spokes[i - 1][0]);
  const step = Math.max(1, Math.round(CANOPY_SEAM_SPACING / Math.max(0.1, frontLength / segs)));
  const pos: number[] = [];
  const idx: number[] = [];
  const side = new THREE.Vector3();
  for (let i = 0; i < count; i += step) {
    const spoke = spokes[i];
    const neighbour = i + 1 < count ? spokes[i + 1] : spokes[i - 1];
    const start = pos.length / 3;
    spoke.forEach((p, k) => {
      side.subVectors(neighbour[k], p).setY(0).normalize().multiplyScalar(0.16);
      pos.push(p.x - side.x, p.y + 0.03, p.z - side.z);
      pos.push(p.x, p.y + 0.22, p.z);
      pos.push(p.x + side.x, p.y + 0.03, p.z + side.z);
    });
    for (let k = 0; k < spoke.length - 1; k++) {
      const a = start + k * 3;
      const b = a + 3;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
      idx.push(a + 1, b + 1, a + 2, b + 1, b + 2, a + 2);
    }
  }
  if (idx.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const seams = new THREE.Mesh(geo, seamMat);
    seams.castShadow = true;
    seams.receiveShadow = true;
    group.add(seams);
  }
  return group;
}

/**
 * Same finish as the ring canopies for the flat box decks of per-stand roofs: spokes run across
 * the deck's depth (local Z) on its top face, so seams and fasciae follow the deck's own tilt.
 */
function addSlabDeckDetail(roof: THREE.Object3D): void {
  const decks: THREE.Mesh[] = [];
  roof.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.name === 'RoofCanopySurface') decks.push(mesh);
  });
  for (const deck of decks) {
    deck.geometry.computeBoundingBox();
    const box = deck.geometry.boundingBox;
    if (!box) continue;
    const size = box.getSize(new THREE.Vector3());
    // Only flat slabs; curved corner canopies already come from the ring builders.
    if (size.y > 1.5 || size.x < 8 || size.z < 4) continue;
    const columns = Math.max(2, Math.round(size.x / 1.5));
    const spokes = Array.from({ length: columns + 1 }, (_, i) => {
      const x = box.min.x + (size.x * i) / columns;
      return Array.from({ length: 4 }, (_, k) =>
        new THREE.Vector3(x, box.max.y, box.min.z + (size.z * k) / 3)
      );
    });
    deck.add(buildCanopyDetail(spokes, false, deck.material as THREE.Material));
    const rows = Math.max(1, Math.round(size.z / TRUSS_ROW_PITCH));
    const soffit = spokes.map((spoke) =>
      Array.from({ length: rows + 1 }, (_, k) =>
        new THREE.Vector3(spoke[0].x, box.min.y, box.min.z + (size.z * k) / rows)
      )
    );
    const truss = buildUndersideTruss(soffit, false);
    if (truss) deck.add(truss);
  }
}

const TRUSS_NODE_PITCH = 3;
const TRUSS_ROW_PITCH = 3.6;
const TRUSS_DEPTH = 0.9;

/**
 * Exposed steel space frame hung under a canopy soffit: `spokes[i][k]` are soffit points
 * (i along the span, k across the depth). Bottom chords run along the span at every k, zig-zag
 * web diagonals climb to the soffit between nodes and transverse ties link the chords — the
 * triangulated underside spectators see instead of a flat slab.
 */
function buildUndersideTruss(spokes: THREE.Vector3[][], closed: boolean): THREE.InstancedMesh | null {
  const count = spokes.length;
  if (count < 2) return null;
  const segs = closed ? count : count - 1;
  let frontLength = 0;
  for (let i = 1; i < count; i++) frontLength += spokes[i][0].distanceTo(spokes[i - 1][0]);
  const step = Math.max(1, Math.round(TRUSS_NODE_PITCH / Math.max(0.1, frontLength / segs)));
  const nodes: number[] = [];
  for (let i = 0; i < segs; i += step) nodes.push(i);
  if (!closed && nodes[nodes.length - 1] !== count - 1) nodes.push(count - 1);

  const down = new THREE.Vector3(0, -TRUSS_DEPTH, 0);
  const bottom = (i: number, k: number) => spokes[i % count][k].clone().add(down);
  const members: [THREE.Vector3, THREE.Vector3, number][] = [];
  const spans = closed ? nodes.length : nodes.length - 1;
  for (let n = 0; n < nodes.length; n++) {
    const i = nodes[n];
    const depthPts = spokes[i].length;
    for (let k = 0; k < depthPts; k++) {
      if (k > 0) members.push([bottom(i, k - 1), bottom(i, k), 0.04]);
      if (n >= spans) continue;
      const j = nodes[(n + 1) % nodes.length];
      const mid = spokes[i][k].clone().lerp(spokes[j][k], 0.5);
      members.push([bottom(i, k), bottom(j, k), 0.07]);
      members.push([bottom(i, k), mid, 0.045]);
      members.push([mid, bottom(j, k), 0.045]);
    }
  }

  const mat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.42, metalness: 0.55 });
  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 5), mat, members.length);
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  members.forEach(([a, b, r], idx) => {
    dir.subVectors(b, a);
    const len = dir.length();
    q.setFromUnitVectors(up, dir.normalize());
    m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(r, len, r));
    mesh.setMatrixAt(idx, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  mesh.name = 'RoofUndersideTruss';
  return mesh;
}

function buildAnnularCanopyMesh(
  ring: ReturnType<typeof buildShapeBowlRing>,
  shape: StadiumShape,
  innerOffset: number,
  outerOffset: number | ((nx: number, nz: number) => number),
  innerY: number,
  outerY: number,
  crossSectionClip: boolean,
  mat: THREE.Material,
  shadowDepthMat?: THREE.MeshDepthMaterial
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
    const resolvedOuter =
      typeof outerOffset === 'function' ? outerOffset(inPt.nx, inPt.nz) : outerOffset;
    const outPt = sampleRoundedBowlRing(ring, t, resolvedOuter);

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
  mesh.name = 'RoofCanopySurface';
  if (shadowDepthMat) {
    mesh.customDepthMaterial = shadowDepthMat;
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;

  const spokes = Array.from({ length: ringCount }, (_, s) => {
    const a = new THREE.Vector3(positions[s * 6], positions[s * 6 + 1], positions[s * 6 + 2]);
    const b = new THREE.Vector3(positions[s * 6 + 3], positions[s * 6 + 4], positions[s * 6 + 5]);
    return Array.from({ length: 6 }, (_, k) => a.clone().lerp(b, k / 5));
  });
  mesh.add(buildCanopyDetail(spokes, closed, mat));
  const truss = buildUndersideTruss(spokes, closed);
  if (truss) mesh.add(truss);
  return mesh;
}

function buildAnnularCatwalkFloodlights(
  ring: ReturnType<typeof buildShapeBowlRing>,
  shape: StadiumShape,
  innerOffset: number,
  catwalkY: number,
  lighting: LightingMode,
  crossSectionClip: boolean,
  enabled: boolean = true
): THREE.Group {
  const group = new THREE.Group();
  if (!enabled) return group;
  group.name = 'RoofFloodlightCatwalk';
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
  lighting: LightingMode,
  enabled: boolean = true
): THREE.Group {
  const group = new THREE.Group();
  if (!enabled) return group;
  group.name = 'RoofFloodlightCatwalk';
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
  const {
    ring,
    maxStandH,
    avgDepth,
    hasConcourse,
    overConcourse,
    canopyOuterOffsetAt,
    standHeightAtNormal,
  } = computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const sunkenDepth = getEffectiveSunkenDepth(doc);
  const baseY = Math.min(sunkenDepth, maxStandH * 0.6);
  const roofTopY = maxStandH + doc.roof.heightOffset;
  const innerDripOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const spanH = Math.max(4, roofTopY - baseY);

  const shellProfileAt = (nx: number, nz: number): [number, number][] => {
    const localOuter = canopyOuterOffsetAt(nx, nz, 3.2);
    if (hasConcourse && !overConcourse) {
      const crestH = standHeightAtNormal(nx, nz);
      const midY = (crestH + roofTopY) * 0.5;
      return [
        [localOuter, Math.max(baseY, crestH - 0.6)],
        [localOuter + 0.15, crestH + (roofTopY - crestH) * 0.3],
        [localOuter + 0.25, midY],
        [localOuter + 0.15, roofTopY - 0.8],
        [localOuter, roofTopY - 0.4],
        [avgDepth * 0.62, roofTopY + 1.4],
        [avgDepth * 0.28, roofTopY + 0.9],
        [innerDripOffset, roofTopY - 0.15],
      ];
    }
    const outerBaseOffset = hasConcourse ? localOuter + 0.2 : avgDepth + 3.2;
    const outerBellyOffset = hasConcourse ? localOuter + 2.8 : avgDepth + 8.6;
    return [
      [outerBaseOffset, baseY],
      [outerBellyOffset * 0.96, baseY + spanH * 0.25],
      [outerBellyOffset, baseY + spanH * 0.56],
      [outerBellyOffset * 0.95, baseY + spanH * 0.84],
      [localOuter, roofTopY - 0.5],
      [avgDepth * 0.62, roofTopY + 1.4],
      [avgDepth * 0.28, roofTopY + 0.9],
      [innerDripOffset, roofTopY - 0.15],
    ];
  };

  const segments = doc.shape === 'octagonal_arena' ? 160 : 128;
  const activeSegs = Math.max(32, Math.round(segments * arcFraction));
  const ringCount = closed ? activeSegs : activeSegs + 1;
  const pCount = 8;

  const positions = new Float32Array(ringCount * pCount * 3);
  const uvs = new Float32Array(ringCount * pCount * 2);
  const indices: number[] = [];

  for (let s = 0; s < ringCount; s++) {
    const t = tStart + (s / activeSegs) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const sliceProfile = shellProfileAt(n.nx, n.nz);
    for (let p = 0; p < pCount; p++) {
      const [radOff, py] = sliceProfile[p];
      const pt = sampleRoundedBowlRing(ring, t, radOff);
      const base = (s * pCount + p) * 3;
      positions[base] = pt.x;
      positions[base + 1] = py;
      positions[base + 2] = pt.z;

      const uvBase = (s * pCount + p) * 2;
      uvs[uvBase] = (s / activeSegs) * 14 * arcFraction;
      uvs[uvBase + 1] = 1 - p / (pCount - 1);
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

  const { surfaceMat: shellMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy,
    12,
    4,
    1
  );

  const shellMesh = new THREE.Mesh(shellGeo, shellMat);
  shellMesh.name = 'RoofCanopySurface';
  shellMesh.customDepthMaterial = shadowDepthMat;
  shellMesh.castShadow = true;
  shellMesh.receiveShadow = true;
  shellMesh.renderOrder = 2;
  group.add(shellMesh);

  const structureMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);

  const ribCount = Math.max(12, Math.round(36 * arcFraction));
  for (let i = 0; i < ribCount; i++) {
    const frac = closed ? i / ribCount : i / Math.max(1, ribCount - 1);
    const t = tStart + frac * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const ribProfile = shellProfileAt(n.nx, n.nz);
    const ribPts = ribProfile.map(([rOff, ry]) => {
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
      crossSectionClip,
      hasRoofGantryLights(doc)
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
  const {
    ring,
    maxStandH,
    avgDepth,
    canopyOuterOffsetAt,
    exteriorSupportMinOffsetAt,
    standHeightAtNormal,
    standDepthAtNormal,
  } = computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const sunkenDepth = getEffectiveSunkenDepth(doc);
  const groundY = Math.min(sunkenDepth, maxStandH * 0.6);
  const roofY = maxStandH + Math.max(4.5, doc.roof.heightOffset);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const outerOffsetFn = (nx: number, nz: number) => canopyOuterOffsetAt(nx, nz, 6.5);

  const { surfaceMat: canopyMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy
  );

  group.add(
    buildAnnularCanopyMesh(
      ring,
      doc.shape,
      innerOffset,
      outerOffsetFn,
      roofY - 0.3,
      roofY + 0.4,
      crossSectionClip,
      canopyMat,
      shadowDepthMat
    ),
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerOffset,
      roofY - 0.55,
      doc.lighting,
      crossSectionClip,
      hasRoofGantryLights(doc)
    )
  );

  const mastStructureMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const cableMat = new THREE.MeshStandardMaterial({
    color: 0xdbeafe,
    roughness: 0.24,
    metalness: 0.9,
  });
  const concretePedestalMat = createConcreteBowlMaterial(maxAnisotropy);

  const masts = resolveSuspendedMasts(doc.roof);
  const mastCount = Math.max(3, Math.round(masts.mastCount * arcFraction));
  for (let i = 0; i < mastCount; i++) {
    const frac = closed ? i / mastCount : i / Math.max(1, mastCount - 1);
    const t = tStart + frac * (tEnd - tStart);

    const baseSample = sampleRoundedBowlRing(ring, t, 0);
    const localStandD = standDepthAtNormal(baseSample.nx, baseSample.nz);
    const localStandH = standHeightAtNormal(baseSample.nx, baseSample.nz);
    const localOuter = outerOffsetFn(baseSample.nx, baseSample.nz);
    const extMin = exteriorSupportMinOffsetAt(baseSample.nx, baseSample.nz);
    const mastGroundOff = Math.max(extMin + 1.8, localOuter + 1.6);
    const mastTopOff = Math.max(extMin + 1.0, localOuter + 0.8);

    const mastGroundPt = sampleRoundedBowlRing(ring, t, mastGroundOff);
    const mastTopPt = sampleRoundedBowlRing(ring, t, mastTopOff);
    const innerAnchor = sampleRoundedBowlRing(ring, t, innerOffset + 2.2);
    const midAnchor = sampleRoundedBowlRing(ring, t, (innerOffset + localOuter) * 0.48);
    const backstayGround = sampleRoundedBowlRing(ring, t, mastGroundOff + 9.5);
    const standCrestPt = sampleRoundedBowlRing(ring, t, localStandD - 0.4);

    const pBase = new THREE.Vector3(mastGroundPt.x, groundY, mastGroundPt.z);
    const pTip = new THREE.Vector3(mastTopPt.x, roofY + masts.mastHeight, mastTopPt.z);
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
/** Canopy height at ring position `t` and depth fraction `f` (0 = front edge, 1 = rear edge). */
type CanopySurface = (t: number, f: number) => number;

/** Builds a canopy that follows the bowl contour with an arbitrary surface (vaults, folds…). */
function buildShapedCanopyMesh(
  ring: ReturnType<typeof buildShapeBowlRing>,
  shape: StadiumShape,
  innerOffset: number,
  outerOffset: number | ((nx: number, nz: number) => number),
  surface: CanopySurface,
  crossSectionClip: boolean,
  segments: number,
  mat: THREE.Material,
  shadowDepthMat?: THREE.MeshDepthMaterial
): THREE.Mesh {
  const { tStart, tEnd, closed } = getBowlArcRange(shape, crossSectionClip);
  const activeSegs = Math.max(32, Math.round(segments * Math.max(0.25, tEnd - tStart)));
  const ringCount = closed ? activeSegs : activeSegs + 1;
  const depthSteps = 10;
  const cols = depthSteps + 1;

  const positions = new Float32Array(ringCount * cols * 3);
  const uvs = new Float32Array(ringCount * cols * 2);
  const indices: number[] = [];
  for (let s = 0; s < ringCount; s++) {
    const t = tStart + (s / activeSegs) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const resolvedOuter =
      typeof outerOffset === 'function' ? outerOffset(n.nx, n.nz) : outerOffset;
    for (let c = 0; c < cols; c++) {
      const f = c / depthSteps;
      const pt = sampleRoundedBowlRing(ring, t, innerOffset + (resolvedOuter - innerOffset) * f);
      const i = s * cols + c;
      positions.set([pt.x, surface(t, f), pt.z], i * 3);
      uvs.set([(s / activeSegs) * 14, f], i * 2);
    }
  }
  for (let s = 0; s < activeSegs; s++) {
    const n = closed ? (s + 1) % ringCount : s + 1;
    for (let c = 0; c < depthSteps; c++) {
      const a = s * cols + c;
      const b = n * cols + c;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'RoofCanopySurface';
  if (shadowDepthMat) {
    mesh.customDepthMaterial = shadowDepthMat;
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;

  const spokes = Array.from({ length: ringCount }, (_, s) =>
    Array.from({ length: cols }, (_, c) => {
      const i = (s * cols + c) * 3;
      return new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
    })
  );
  mesh.add(buildCanopyDetail(spokes, closed, mat));
  const truss = buildUndersideTruss(spokes, closed);
  if (truss) mesh.add(truss);
  return mesh;
}

function buildPerimeterCanopyCrown(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number,
  shaped?: {
    surface: (ctx: { roofY: number; depth: number; perimeter: number }) => CanopySurface;
    segments: number;
  },
  // Raking steel columns from the stand crest to the canopy rear edge.
  rearColumns: boolean = true
) {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const bounds = computeStadiumRingBounds(doc);
  const {
    ring,
    maxStandH,
    avgDepth,
    canopyOuterOffsetAt,
    nominalOuterOffset,
    standHeightAtNormal,
    standDepthAtNormal,
  } = bounds;
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const roofY = maxStandH + Math.max(4.0, doc.roof.heightOffset);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const outerOffset = nominalOuterOffset(3.8);
  const outerOffsetFn = (nx: number, nz: number) => canopyOuterOffsetAt(nx, nz, 3.8);

  const { surfaceMat: canopyMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy
  );

  const surface: CanopySurface = shaped
    ? shaped.surface({ roofY, depth: outerOffset - innerOffset, perimeter: ring.perimeter })
    : (_t, f) => roofY + 1.8 * (1 - f);

  group.add(
    shaped
      ? buildShapedCanopyMesh(
          ring,
          doc.shape,
          innerOffset,
          outerOffsetFn,
          surface,
          crossSectionClip,
          shaped.segments,
          canopyMat,
          shadowDepthMat
        )
      : buildAnnularCanopyMesh(
          ring,
          doc.shape,
          innerOffset,
          outerOffsetFn,
          roofY + 1.8,
          roofY,
          crossSectionClip,
          canopyMat,
          shadowDepthMat
        ),
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerOffset,
      roofY + 1.45,
      doc.lighting,
      crossSectionClip,
      hasRoofGantryLights(doc)
    )
  );

  const primaryStructMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);

  const colBays = rearColumns ? Math.max(12, Math.round(40 * arcFraction)) : 0;
  for (let i = 0; i < colBays; i++) {
    const f0 = closed ? i / colBays : i / Math.max(1, colBays - 1);
    const f1 = closed
      ? (i + 0.5) / colBays
      : Math.min(1, (i + 0.5) / Math.max(1, colBays - 1));
    const t0 = tStart + f0 * (tEnd - tStart);
    const t1 = tStart + f1 * (tEnd - tStart);
    const s0 = sampleRoundedBowlRing(ring, t0, 0);
    const s1 = sampleRoundedBowlRing(ring, t1, 0);
    const d0 = standDepthAtNormal(s0.nx, s0.nz);
    const h0 = standHeightAtNormal(s0.nx, s0.nz);
    const localOuter1 = outerOffsetFn(s1.nx, s1.nz);

    const wallBase = sampleRoundedBowlRing(ring, t0, d0 - 0.3);
    const roofNode = sampleRoundedBowlRing(ring, t1, localOuter1 - 0.8);
    group.add(
      createStrutBetween(
        new THREE.Vector3(wallBase.x, h0 - 0.6, wallBase.z),
        new THREE.Vector3(roofNode.x, surface(t1, 1) - 0.4, roofNode.z),
        0.32,
        0.38,
        primaryStructMat,
        6
      )
    );
  }

  return {
    group,
    bounds,
    roofY,
    innerOffset,
    outerOffset,
    outerOffsetFn,
    primaryStructMat,
    surface,
  };
}

/** Tube following the canopy surface across its depth at ring position `t`. */
function buildCanopyRib(
  ring: ReturnType<typeof buildShapeBowlRing>,
  t: number,
  innerOffset: number,
  outerOffset: number,
  surface: CanopySurface,
  radius: number,
  mat: THREE.Material
): THREE.Mesh {
  const pts = Array.from({ length: 13 }, (_, k) => {
    const f = k / 12;
    const p = sampleRoundedBowlRing(ring, t, innerOffset + (outerOffset - innerOffset) * f);
    return new THREE.Vector3(p.x, surface(t, f) - radius, p.z);
  });
  return new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, radius, 6, false),
    mat
  );
}

/**
 * VAULTED RING (`vaulted_ring`): a canopy whose cross-section is an arch springing from the rear
 * and dipping to a thin front edge, carried by arched ribs at regular bays.
 */
function buildVaultedRingRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, innerOffset, outerOffsetFn, primaryStructMat, surface } =
    buildPerimeterCanopyCrown(doc, crossSectionClip, maxAnisotropy, {
      segments: 160,
      surface:
        ({ roofY, depth }) =>
        (_t, f) =>
          roofY + 1.2 * (1 - f) + Math.min(9, depth * 0.2) * Math.sin(Math.PI * f),
    });
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const ribs = Math.max(12, Math.round(48 * Math.max(0.25, tEnd - tStart)));
  for (let i = 0; i < ribs; i++) {
    const t = tStart + (closed ? i / ribs : i / Math.max(1, ribs - 1)) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(bounds.ring, t, 0);
    group.add(
      buildCanopyRib(
        bounds.ring,
        t,
        innerOffset,
        outerOffsetFn(n.nx, n.nz),
        surface,
        0.32,
        primaryStructMat
      )
    );
  }
  return group;
}

/**
 * FOLDED PLATE (`folded_plate`): a zigzag canopy whose ridges and valleys alternate around the
 * bowl like a sawtooth crown, with a steel ridge beam on every fold.
 */
function buildFoldedPlateRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  let folds = 0;
  const { group, bounds, innerOffset, outerOffsetFn, primaryStructMat, surface } =
    buildPerimeterCanopyCrown(doc, crossSectionClip, maxAnisotropy, {
      segments: 320,
      surface: ({ roofY, perimeter }) => {
        folds = Math.max(16, Math.round(perimeter / 16));
        return (t, f) => {
          const phase = (((t * folds) % 1) + 1) % 1;
          const ridge = 1 - Math.abs(2 * phase - 1);
          return roofY + 1.6 * (1 - f) + ridge * (1.2 + 3.2 * f);
        };
      },
    });
  const { tStart, tEnd } = getBowlArcRange(doc.shape, crossSectionClip);
  for (let k = 0; k < folds; k++) {
    const t = (k + 0.5) / folds;
    if (t < tStart || t > tEnd) continue;
    const n = sampleRoundedBowlRing(bounds.ring, t, 0);
    group.add(
      buildCanopyRib(
        bounds.ring,
        t,
        innerOffset,
        outerOffsetFn(n.nx, n.nz),
        surface,
        0.22,
        primaryStructMat
      )
    );
  }
  return group;
}

/**
 * 3. RETRACTABLE ROOF (`retractable`, `petal_iris`):
 * Perimeter canopy whose central opening is covered by movable panels (see
 * `generateRetractableRoof.ts` for the nine motions and `doc.roof.retractable` for settings).
 */
function buildRetractableRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, roofY, innerOffset, outerOffset, primaryStructMat } =
    buildPerimeterCanopyCrown(doc, crossSectionClip, maxAnisotropy);

  // The open end of a horseshoe leaves no closed opening for the panels to cover.
  if (doc.shape === 'horseshoe') {
    return group;
  }

  group.add(
    buildRetractablePanels(doc, {
      ring: bounds.ring,
      roofY,
      innerOffset,
      outerOffset,
      primaryStructMat,
      crossSectionClip,
      maxAnisotropy,
    })
  );
  return group;
}

/** Even-odd point-in-polygon test in the XZ plane. */
function insideXZ(poly: { x: number; z: number }[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Warren truss (top and bottom chords, alternating diagonals, posts) between two points. */
function warrenTrussParts(
  a: THREE.Vector3,
  b: THREE.Vector3,
  depth: number,
  bays: number,
  chord: number,
  web: number
): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  const at = (f: number, top: boolean) => {
    const p = new THREE.Vector3().lerpVectors(a, b, f);
    if (top) p.y += depth;
    return p;
  };
  parts.push(beamGeometry(at(0, false), at(1, false), chord, chord));
  parts.push(beamGeometry(at(0, true), at(1, true), chord, chord));
  for (let k = 0; k <= bays; k++) {
    const f0 = k / bays;
    parts.push(beamGeometry(at(f0, false), at(f0, true), web * 0.8, web * 0.8));
    if (k < bays) {
      parts.push(beamGeometry(at(f0, k % 2 === 0), at((k + 1) / bays, k % 2 !== 0), web, web));
    }
  }
  return parts;
}

/**
 * CORNER MEGA-PYLONS (`corner_pylons`), after Lens Bollaert-Delelis and the Marseille Vélodrome:
 * four corner pylons carry four mega-girders framing the pitch above the canopy's front edge;
 * the canopy hangs from them at the front and rests on the stand crests at the rear. Optional
 * `spaceFrame` adds a two-layer lattice over the canopy, and `crownRise` domes it toward the pitch.
 */
function buildCornerPylonsRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const frame = resolveCornerPylonFrame(doc.roof, computeStadiumRingBounds(doc).maxStandH);
  const { group, bounds, innerOffset, outerOffsetFn, primaryStructMat, surface } =
    buildPerimeterCanopyCrown(doc, crossSectionClip, maxAnisotropy, {
      segments: 160,
      surface:
        ({ roofY }) =>
        (_t, f) =>
          roofY + 1.8 * (1 - f) + frame.crownRise * Math.pow(1 - f, 1.6),
    });
  const { ring } = bounds;
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const zMax = crossSectionClip ? 0 : Infinity;

  // Girder rectangle over the front quarter of the canopy depth.
  const lineOffset = innerOffset + (bounds.avgDepth - innerOffset) * 0.25;
  let gx = 0;
  let gz = 0;
  const innerPoly: { x: number; z: number }[] = [];
  const outerPoly: { x: number; z: number }[] = [];
  for (let s = 0; s < 128; s++) {
    const t = s / 128;
    const p = sampleRoundedBowlRing(ring, t, lineOffset);
    gx = Math.max(gx, Math.abs(p.x));
    gz = Math.max(gz, Math.abs(p.z));
    const n = sampleRoundedBowlRing(ring, t, 0);
    innerPoly.push(sampleRoundedBowlRing(ring, t, innerOffset));
    outerPoly.push(sampleRoundedBowlRing(ring, t, outerOffsetFn(n.nx, n.nz)));
  }
  const coversPoint = (x: number, z: number) =>
    insideXZ(outerPoly, x, z) && !insideXZ(innerPoly, x, z);
  const corners = [
    new THREE.Vector3(gx, 0, gz),
    new THREE.Vector3(-gx, 0, gz),
    new THREE.Vector3(-gx, 0, -gz),
    new THREE.Vector3(gx, 0, -gz),
  ];

  const pylonParts: THREE.BufferGeometry[] = [];
  const steelParts: THREE.BufferGeometry[] = [];
  const cableParts: THREE.BufferGeometry[] = [];
  for (const c of corners) {
    if (c.z > zMax) continue;
    // Tapered lattice pylon: four legs converging toward the head, braced every ~8 m.
    const baseHalf = 3.2;
    const topHalf = 1.6;
    const legs = [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ].map(([sx, sz]) => ({
      bot: new THREE.Vector3(c.x + sx * baseHalf, 0, c.z + sz * baseHalf),
      top: new THREE.Vector3(c.x + sx * topHalf, frame.pylonTopY, c.z + sz * topHalf),
    }));
    for (const leg of legs) pylonParts.push(beamGeometry(leg.bot, leg.top, 1.1, 1.1));
    const levels = Math.max(3, Math.round(frame.pylonTopY / 8));
    for (let l = 1; l <= levels; l++) {
      const cur = legs.map((leg) => new THREE.Vector3().lerpVectors(leg.bot, leg.top, l / levels));
      const prev = legs.map((leg) =>
        new THREE.Vector3().lerpVectors(leg.bot, leg.top, (l - 1) / levels)
      );
      for (let k = 0; k < 4; k++) {
        pylonParts.push(beamGeometry(cur[k], cur[(k + 1) % 4], 0.5, 0.5));
        pylonParts.push(beamGeometry(prev[k], cur[(k + 1) % 4], 0.35, 0.35));
      }
    }
  }

  // Four mega-girders: Warren trusses between the pylon centrelines.
  for (let i = 0; i < 4; i++) {
    const a = corners[i].clone().setY(frame.girderBotY);
    const b = corners[(i + 1) % 4].clone().setY(frame.girderBotY);
    if (a.z > zMax && b.z > zMax) continue;
    a.z = Math.min(a.z, zMax);
    b.z = Math.min(b.z, zMax);
    const span = a.distanceTo(b);
    if (span < 1) continue;
    steelParts.push(
      ...warrenTrussParts(
        a,
        b,
        frame.girderTopY - frame.girderBotY,
        Math.max(6, Math.round(span / 8)),
        1.6,
        0.6
      )
    );
    // Hangers down to the canopy wherever the girder runs over it.
    const hangers = Math.max(4, Math.round(span / 10));
    for (let k = 1; k < hangers; k++) {
      const p = new THREE.Vector3().lerpVectors(a, b, k / hangers);
      if (!coversPoint(p.x, p.z)) continue;
      cableParts.push(beamGeometry(p, new THREE.Vector3(p.x, frame.canopyY + 1.0, p.z), 0.22, 0.22));
    }
    // Stays from pylon heads standing well above the girders down to their third points.
    if (frame.pylonTopY > frame.girderTopY + 4) {
      for (const [end, f] of [
        [corners[i], 0.3],
        [corners[(i + 1) % 4], 0.7],
      ] as const) {
        if (end.z > zMax) continue;
        const head = end.clone().setY(frame.pylonTopY - 0.5);
        const anchor = new THREE.Vector3().lerpVectors(a, b, f).setY(frame.girderTopY);
        cableParts.push(beamGeometry(head, anchor, 0.25, 0.25));
      }
    }
  }

  if (doc.roof.spaceFrame) {
    // Two-layer lattice following the canopy: bottom nodes on the deck, top nodes 3.5 m above.
    const along = Math.max(24, Math.round(72 * Math.max(0.25, tEnd - tStart)));
    const across = 4;
    const node = (s: number, c: number, top: boolean): THREE.Vector3 => {
      const t = tStart + (s / along) * (tEnd - tStart);
      const n = sampleRoundedBowlRing(ring, t, 0);
      const outer = outerOffsetFn(n.nx, n.nz);
      const f = c / across;
      const p = sampleRoundedBowlRing(ring, t, innerOffset + (outer - innerOffset) * f);
      return new THREE.Vector3(p.x, surface(t, f) + (top ? 3.5 : 0.35), p.z);
    };
    const stations = closed ? along : along + 1;
    for (let s = 0; s < stations; s++) {
      const next = closed ? (s + 1) % along : s + 1;
      const last = !closed && s === along;
      for (let c = 0; c <= across; c++) {
        steelParts.push(beamGeometry(node(s, c, false), node(s, c, true), 0.22, 0.22));
        if (c < across) {
          steelParts.push(beamGeometry(node(s, c, true), node(s, c + 1, true), 0.32, 0.32));
          steelParts.push(beamGeometry(node(s, c, false), node(s, c + 1, true), 0.2, 0.2));
        }
        if (!last) {
          steelParts.push(beamGeometry(node(s, c, true), node(next, c, true), 0.32, 0.32));
          steelParts.push(beamGeometry(node(s, c, false), node(next, c, true), 0.2, 0.2));
        }
      }
    }
  }

  const named: [THREE.BufferGeometry[], string][] = [
    [pylonParts, 'CornerMegaPylons'],
    [steelParts, 'CornerMegaGirders'],
    [cableParts, 'CornerRoofHangers'],
  ];
  for (const [parts, name] of named) {
    const mesh = mergedMesh(parts, primaryStructMat, name);
    if (mesh) group.add(mesh);
  }
  return group;
}

/**
 * COUNTERWEIGHTED CANTILEVER (`counterweighted_cantilever`), after the Groupama Stadium: radial
 * steel trusses pivot on a post at the stand crest; the front arm carries the canopy over the
 * seats, and the shorter back-span is tied down to a pier behind the stands.
 */
function buildCounterweightedCantileverRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, innerOffset, outerOffsetFn, primaryStructMat, surface } =
    buildPerimeterCanopyCrown(doc, crossSectionClip, maxAnisotropy);
  const { ring, standDepthAtNormal, standHeightAtNormal } = bounds;
  const { trussCount, backspanRatio } = resolveCounterweightTrusses(doc.roof);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const stations = Math.max(4, Math.round(trussCount * Math.max(0.25, tEnd - tStart)));

  const trussParts: THREE.BufferGeometry[] = [];
  const tieParts: THREE.BufferGeometry[] = [];
  const pierParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < stations; i++) {
    const t = tStart + ((closed ? i : i + 0.5) / stations) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const outer = outerOffsetFn(n.nx, n.nz);
    const pivotOff = Math.max(innerOffset + 4, standDepthAtNormal(n.nx, n.nz) - 0.5);
    const frontLen = pivotOff - innerOffset;
    const backOff = pivotOff + frontLen * backspanRatio;
    const maxDepth = Math.max(3, Math.min(8, frontLen * 0.12));
    // Bottom chord follows the canopy (held flat past its rear edge); the top chord peaks at the pivot.
    const deckY = (off: number) => {
      const f = Math.max(0, Math.min(1, (off - innerOffset) / Math.max(1, outer - innerOffset)));
      return surface(t, f) + 0.35;
    };
    const depthAt = (off: number) =>
      off <= pivotOff
        ? 0.8 + (maxDepth - 0.8) * ((off - innerOffset) / frontLen)
        : maxDepth - (maxDepth - 1.2) * ((off - pivotOff) / (backOff - pivotOff));
    const nodes = Math.max(6, Math.round((backOff - innerOffset) / 4));
    const bottom: THREE.Vector3[] = [];
    const top: THREE.Vector3[] = [];
    for (let k = 0; k <= nodes; k++) {
      const off = innerOffset + ((backOff - innerOffset) * k) / nodes;
      const p = sampleRoundedBowlRing(ring, t, off);
      const y = deckY(Math.min(off, outer));
      bottom.push(new THREE.Vector3(p.x, y, p.z));
      top.push(new THREE.Vector3(p.x, y + depthAt(off), p.z));
    }
    for (let k = 0; k < nodes; k++) {
      trussParts.push(beamGeometry(bottom[k], bottom[k + 1], 0.55, 0.55));
      trussParts.push(beamGeometry(top[k], top[k + 1], 0.6, 0.6));
      const [d0, d1] = k % 2 === 0 ? [bottom[k], top[k + 1]] : [top[k], bottom[k + 1]];
      trussParts.push(beamGeometry(d0, d1, 0.28, 0.28));
      trussParts.push(beamGeometry(bottom[k + 1], top[k + 1], 0.24, 0.24));
    }

    // Fulcrum post from the stand crest up to the truss.
    const pivot = sampleRoundedBowlRing(ring, t, pivotOff);
    trussParts.push(
      beamGeometry(
        new THREE.Vector3(pivot.x, standHeightAtNormal(n.nx, n.nz) - 0.5, pivot.z),
        new THREE.Vector3(pivot.x, deckY(pivotOff), pivot.z),
        1.1,
        1.1
      )
    );

    // Vertical tie rod from the back-span end down to a concrete pier behind the stands.
    const tail = bottom[nodes];
    const anchor = sampleRoundedBowlRing(ring, t, backOff);
    tieParts.push(beamGeometry(tail, new THREE.Vector3(anchor.x, 1.6, anchor.z), 0.3, 0.3));
    const pier = new THREE.BoxGeometry(2.4, 1.6, 2.4);
    pier.translate(anchor.x, 0.8, anchor.z);
    pierParts.push(pier);
  }

  const named: [THREE.BufferGeometry[], string, THREE.Material][] = [
    [trussParts, 'CounterweightTrusses', primaryStructMat],
    [tieParts, 'CounterweightTieRods', primaryStructMat],
    [pierParts, 'CounterweightPiers', createConcreteBowlMaterial(maxAnisotropy)],
  ];
  for (const [parts, name, mat] of named) {
    const mesh = mergedMesh(parts, mat, name);
    if (mesh) group.add(mesh);
  }
  return group;
}

/**
 * CLOSED ROOF ON MEGA-GIRDERS (`spanning_girders`), after Paris La Défense Arena: a slightly
 * cambered deck closes the whole bowl out to the eaves, carried by transverse Warren mega-girders
 * resting on the perimeter walls; a skirt closes the gap between stands and deck.
 */
function buildSpanningGirdersRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const { ring, maxStandH, canopyOuterOffsetAt, standHeightAtNormal, standDepthAtNormal } =
    computeStadiumRingBounds(doc);
  const primaryStructMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const { surfaceMat, shadowDepthMat } = buildCanopyMaterialBundle(doc, maxAnisotropy, 14, 4, 1);

  const girderDepth = 7;
  const springY = maxStandH + Math.max(2.8, doc.roof.heightOffset * 0.7);
  const deckY = springY + girderDepth + 0.4;
  const camber = 2.5;

  // Eave outline over the concourse; the cross-section keeps the north half (z <= 0).
  const segs = 128;
  const eave: { x: number; z: number; h: number }[] = [];
  // Girders bear on the rear wall of the stands, inside the facade.
  const crest: { x: number; z: number; h: number }[] = [];
  for (let s = 0; s < segs; s++) {
    const n = sampleRoundedBowlRing(ring, s / segs, 0);
    const h = standHeightAtNormal(n.nx, n.nz);
    const clipZ = (z: number) => (crossSectionClip ? Math.min(0, z) : z);
    const p = sampleRoundedBowlRing(ring, s / segs, canopyOuterOffsetAt(n.nx, n.nz, 3.2));
    eave.push({ x: p.x, z: clipZ(p.z), h });
    const c = sampleRoundedBowlRing(ring, s / segs, standDepthAtNormal(n.nx, n.nz) - 1.5);
    crest.push({ x: c.x, z: clipZ(c.z), h });
  }

  // Deck: concentric copies of the eave shrinking to the centre, cambered up toward it.
  const rings = 10;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let s = 0; s < segs; s++) {
    for (let r = 0; r <= rings; r++) {
      const k = 1 - r / rings;
      pos.push(eave[s].x * k, deckY + camber * (1 - k * k), eave[s].z * k);
      uv.push((s / segs) * 16, r / rings);
    }
  }
  for (let s = 0; s < segs; s++) {
    const a0 = s * (rings + 1);
    const b0 = ((s + 1) % segs) * (rings + 1);
    for (let r = 0; r < rings; r++) {
      idx.push(a0 + r, a0 + r + 1, b0 + r, b0 + r, a0 + r + 1, b0 + r + 1);
    }
  }
  const deckGeo = new THREE.BufferGeometry();
  deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  deckGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  deckGeo.setIndex(idx);
  deckGeo.computeVertexNormals();
  const deck = new THREE.Mesh(deckGeo, surfaceMat);
  deck.name = 'RoofCanopySurface';
  deck.customDepthMaterial = shadowDepthMat;
  deck.castShadow = true;
  deck.receiveShadow = true;
  deck.renderOrder = 2;
  group.add(deck);

  // Eave skirt from the stand crest up to the deck edge.
  const skirtPos: number[] = [];
  const skirtIdx: number[] = [];
  for (let s = 0; s < segs; s++) {
    skirtPos.push(eave[s].x, eave[s].h - 0.5, eave[s].z, eave[s].x, deckY + 0.6, eave[s].z);
    const a = s * 2;
    const b = ((s + 1) % segs) * 2;
    skirtIdx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtPos, 3));
  skirtGeo.setIndex(skirtIdx);
  skirtGeo.computeVertexNormals();
  const skirt = new THREE.Mesh(skirtGeo, primaryStructMat);
  skirt.name = 'RoofEaveSkirt';
  skirt.castShadow = true;
  group.add(skirt);

  // Transverse mega-girders across the short axis, evenly spaced along the pitch.
  const count = resolveSpanningGirderCount(doc.roof);
  const halfX = Math.max(...crest.map((p) => p.x));
  const steel: THREE.BufferGeometry[] = [];
  for (let g = 0; g < count; g++) {
    const x = -halfX * 0.72 + (1.44 * halfX * g) / Math.max(1, count - 1);
    const chord = chordAt(crest, 'x', x);
    if (!chord || chord[1] - chord[0] < 4) continue;
    const a = new THREE.Vector3(x, springY, chord[0]);
    const b = new THREE.Vector3(x, springY, chord[1]);
    steel.push(...warrenTrussParts(a, b, girderDepth, Math.max(8, Math.round((b.z - a.z) / 7)), 1.8, 0.7));
    // Bearing columns down to the stand crest at both ends.
    for (const end of crossSectionClip ? [a] : [a, b]) {
      const nearest = crest.reduce((best, p) =>
        Math.hypot(p.x - end.x, p.z - end.z) < Math.hypot(best.x - end.x, best.z - end.z) ? p : best
      );
      steel.push(
        beamGeometry(
          new THREE.Vector3(end.x, nearest.h - 1, end.z),
          end,
          2.2,
          2.2
        )
      );
    }
  }
  // Longitudinal purlin trusses tying the girders together under the deck.
  for (const zf of crossSectionClip ? [-0.45] : [-0.45, 0.45]) {
    const mid = chordAt(eave, 'z', 0) ?? [-halfX, halfX];
    const zHalf = Math.max(...eave.map((p) => Math.abs(p.z)));
    steel.push(
      ...warrenTrussParts(
        new THREE.Vector3(mid[0] * 0.8, springY + girderDepth * 0.45, zf * zHalf),
        new THREE.Vector3(mid[1] * 0.8, springY + girderDepth * 0.45, zf * zHalf),
        girderDepth * 0.5,
        16,
        0.7,
        0.35
      )
    );
  }
  const girders = mergedMesh(steel, primaryStructMat, 'SpanningMegaGirders');
  if (girders) group.add(girders);
  return group;
}

/**
 * TIMBER LATTICE (`timber_lattice`), after the Allianz Riviera: a diamond lattice of glulam
 * members rises from the ground outside the facade, bows outward, then arches over the canopy to
 * its front edge, so skin and roof read as one timber structure.
 */
function buildTimberLatticeRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, innerOffset, outerOffsetFn, surface } = buildPerimeterCanopyCrown(
    doc,
    crossSectionClip,
    maxAnisotropy,
    undefined,
    false
  );
  const { ring } = bounds;
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const along = Math.max(16, Math.round(80 * Math.max(0.25, tEnd - tStart)));
  const across = 14;
  const wallShare = 0.55;

  const node = (i: number, j: number): THREE.Vector3 => {
    const t = tStart + ((closed ? i % along : i) / along) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const rOut = outerOffsetFn(n.nx, n.nz) + 1.5;
    const eaveY = surface(t, 1) + 3;
    const f = j / across;
    let r: number;
    let y: number;
    if (f <= wallShare) {
      const s = f / wallShare;
      r = rOut + 2.5 * Math.sin(Math.PI * s);
      y = eaveY * s;
    } else {
      const s = (f - wallShare) / (1 - wallShare);
      r = rOut + (innerOffset - rOut) * s;
      y = eaveY + (surface(t, 0) + 1.2 - eaveY) * s + 4 * Math.sin(Math.PI * s);
    }
    const p = sampleRoundedBowlRing(ring, t, r);
    return new THREE.Vector3(p.x, y, p.z);
  };

  const members: THREE.BufferGeometry[] = [];
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < across; j++) {
      members.push(beamGeometry(node(i, j), node(i + 1, j + 1), 0.45, 0.7));
      members.push(beamGeometry(node(i + 1, j), node(i, j + 1), 0.45, 0.7));
    }
  }
  const lattice = mergedMesh(
    members,
    createStructurePbrMaterial('glulam_timber', maxAnisotropy),
    'TimberLattice'
  );
  if (lattice) group.add(lattice);
  return group;
}

/**
 * UNDULATING LACE CANOPY (`wave_canopy`), after Stade Jean-Bouin: roof and facade form one skin of
 * perforated UHPC whose height undulates around the bowl (two crests per side), carried by steel
 * cantilever arms under the canopy.
 */
function buildWaveCanopyRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const amp = resolveWaveAmplitude(doc.roof);
  const wave = (t: number) => amp * (0.5 + 0.5 * Math.cos(4 * Math.PI * t + 0.6));
  const { group, bounds, innerOffset, outerOffsetFn, primaryStructMat, surface } =
    buildPerimeterCanopyCrown(
      doc,
      crossSectionClip,
      maxAnisotropy,
      {
        segments: 192,
        surface:
          ({ roofY }) =>
          (t, f) =>
            roofY + 1.8 * (1 - f) + wave(t),
      },
      false
    );
  const { ring } = bounds;
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);

  // Lace skin from the ground up to the canopy's rear edge.
  const segs = Math.max(48, Math.round(192 * Math.max(0.25, tEnd - tStart)));
  const count = closed ? segs : segs + 1;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let s = 0; s < count; s++) {
    const t = tStart + (s / segs) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const p = sampleRoundedBowlRing(ring, t, outerOffsetFn(n.nx, n.nz) + 0.4);
    pos.push(p.x, 0, p.z, p.x, surface(t, 1) + 0.2, p.z);
    uv.push(s / 4, 0, s / 4, 1);
  }
  for (let s = 0; s < segs; s++) {
    const a = s * 2;
    const b = ((s + 1) % count) * 2;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const skinGeo = new THREE.BufferGeometry();
  skinGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  skinGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  skinGeo.setIndex(idx);
  skinGeo.computeVertexNormals();
  const skin = new THREE.Mesh(
    skinGeo,
    createFacadePbrMaterial('uhpc_lace_panels', doc.lighting, false, maxAnisotropy)
  );
  skin.name = 'WaveCanopyLaceSkin';
  skin.castShadow = true;
  skin.receiveShadow = true;
  group.add(skin);

  // Steel cantilever arms under the canopy.
  const arms = Math.max(12, Math.round(74 * Math.max(0.25, tEnd - tStart)));
  for (let i = 0; i < arms; i++) {
    const t = tStart + ((closed ? i : i + 0.5) / arms) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    group.add(
      buildCanopyRib(ring, t, innerOffset, outerOffsetFn(n.nx, n.nz), surface, 0.28, primaryStructMat)
    );
  }
  return group;
}

/** Highest point of a `concrete_portals` rib above the canopy deck (m). */
const PORTAL_MAX_RISE = 10;

/**
 * PRESTRESSED CONCRETE PORTALS (`concrete_portals`), after the Parc des Princes: ribs stand
 * outside the facade, rise past the stands and cantilever inward over them, carrying the canopy
 * with no column in the bowl. Their crests undulate around the perimeter, two waves per side.
 */
function buildConcretePortalsRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, roofY, innerOffset, outerOffsetFn, surface } = buildPerimeterCanopyCrown(
    doc,
    crossSectionClip,
    maxAnisotropy,
    undefined,
    false
  );
  const { ring } = bounds;
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const stations = Math.max(
    6,
    Math.round(resolvePortalCount(doc.roof) * Math.max(0.25, tEnd - tStart))
  );
  const ribWidth = 0.9;
  const parts: THREE.BufferGeometry[] = [];

  for (let i = 0; i < stations; i++) {
    const t = tStart + ((closed ? i : i + 0.5) / stations) * (tEnd - tStart);
    const base = sampleRoundedBowlRing(ring, t, 0);
    const rOut = outerOffsetFn(base.nx, base.nz);
    const crestY = roofY + 4 + (PORTAL_MAX_RISE - 4) * (0.5 + 0.5 * Math.cos(4 * Math.PI * t));
    const tipY = surface(t, 0) + 0.3;
    // Rib profile in (radial offset, height): an outer leg leaning in, a crest, and a cantilever
    // whose underside runs from the deck's rear edge to a slender tip at the canopy front.
    const profile = new THREE.Shape([
      new THREE.Vector2(rOut + 4.2, 0),
      new THREE.Vector2(rOut + 2.4, crestY),
      new THREE.Vector2(rOut - 2, crestY + 0.6),
      new THREE.Vector2(innerOffset, tipY + 0.9),
      new THREE.Vector2(innerOffset, tipY),
      new THREE.Vector2(rOut - 1, surface(t, 1) + 0.4),
      new THREE.Vector2(rOut + 0.8, Math.max(4, crestY - 12)),
      new THREE.Vector2(rOut + 1.2, 0),
    ]);
    const geo = new THREE.ExtrudeGeometry(profile, { depth: ribWidth, bevelEnabled: false });
    // Map (radial offset, height, width) onto the ring normal and tangent at `t`.
    const tx = -base.nz;
    const tz = base.nx;
    const pos = geo.getAttribute('position');
    for (let v = 0; v < pos.count; v++) {
      const r = pos.getX(v);
      const w = pos.getZ(v) - ribWidth / 2;
      pos.setXYZ(v, base.x + base.nx * r + tx * w, pos.getY(v), base.z + base.nz * r + tz * w);
    }
    geo.computeVertexNormals();
    parts.push(geo);
  }

  const ribs = mergedMesh(parts, createConcreteBowlMaterial(maxAnisotropy), 'ConcretePortalRibs');
  if (ribs) {
    ribs.receiveShadow = true;
    group.add(ribs);
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
  const { innerHalfX, innerHalfZ, avgDepth, concourseWidth } = bounds;
  const cableSteelMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.3,
    metalness: 0.84,
  });
  const concreteMat = createConcreteBowlMaterial(maxAnisotropy);

  const archHalfSpanX = innerHalfX + avgDepth + concourseWidth + 24;
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
    concourseWidth,
    canopyOuterOffsetAt,
    standHeightAtNormal,
    standDepthAtNormal,
  } = computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);

  const roofY = maxStandH + Math.max(4.0, doc.roof.heightOffset);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const outerOffsetFn = (nx: number, nz: number) => canopyOuterOffsetAt(nx, nz, 3.6);

  const { surfaceMat: canopyMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy
  );

  group.add(
    buildAnnularCanopyMesh(
      ring,
      doc.shape,
      innerOffset,
      outerOffsetFn,
      roofY - 0.4,
      roofY + 0.5,
      crossSectionClip,
      canopyMat,
      shadowDepthMat
    ),
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerOffset,
      roofY - 0.72,
      doc.lighting,
      crossSectionClip,
      hasRoofGantryLights(doc)
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
    const localOuter = outerOffsetFn(s0.nx, s0.nz);
    const wallPt = sampleRoundedBowlRing(ring, t, d0 - 0.2);
    const roofPt = sampleRoundedBowlRing(ring, t, localOuter - 0.6);
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
  const archHalfSpanX = innerHalfX + avgDepth + concourseWidth + 32;
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
    canopyOuterOffsetAt,
    standHeightAtNormal,
    standDepthAtNormal,
  } = computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);

  const roofY = maxStandH + Math.max(3.8, doc.roof.heightOffset);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const outerOffsetFn = (nx: number, nz: number) => canopyOuterOffsetAt(nx, nz, 3.4);

  const { surfaceMat: canopyMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy
  );

  group.add(
    buildAnnularCanopyMesh(
      ring,
      doc.shape,
      innerOffset,
      outerOffsetFn,
      roofY - 0.5,
      roofY + 0.5,
      crossSectionClip,
      canopyMat,
      shadowDepthMat
    ),
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerOffset,
      roofY - 0.78,
      doc.lighting,
      crossSectionClip,
      hasRoofGantryLights(doc)
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
    const localOuter = outerOffsetFn(s0.nx, s0.nz);
    const wallPt = sampleRoundedBowlRing(ring, t, d0 - 0.2);
    const roofPt = sampleRoundedBowlRing(ring, t, localOuter - 0.6);
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
  const {
    ring,
    maxStandH,
    avgDepth,
    canopyOuterOffsetAt,
    standHeightAtNormal,
    standDepthAtNormal,
  } = computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const roofY = maxStandH + Math.max(3.6, doc.roof.heightOffset);

  const innerDripOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const outerRingOffsetFn = (nx: number, nz: number) => canopyOuterOffsetAt(nx, nz, 3.2);

  const { surfaceMat: canopyMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy
  );

  group.add(
    buildAnnularCanopyMesh(
      ring,
      doc.shape,
      innerDripOffset,
      outerRingOffsetFn,
      roofY - 0.55,
      roofY + 0.35,
      crossSectionClip,
      canopyMat,
      shadowDepthMat
    ),
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerDripOffset,
      roofY - 0.85,
      doc.lighting,
      crossSectionClip,
      hasRoofGantryLights(doc)
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
    const inPt = sampleRoundedBowlRing(ring, t, innerDripOffset + 0.5);
    const outPt = sampleRoundedBowlRing(ring, t, outerRingOffsetFn(inPt.nx, inPt.nz));

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
    const sMid = sampleRoundedBowlRing(ring, tMid, 0);
    const dL = standDepthAtNormal(sL.nx, sL.nz);
    const dR = standDepthAtNormal(sR.nx, sR.nz);
    const hL = standHeightAtNormal(sL.nx, sL.nz);
    const hR = standHeightAtNormal(sR.nx, sR.nz);

    const wallFootL = sampleRoundedBowlRing(ring, tLeft, dL - 0.1);
    const wallFootR = sampleRoundedBowlRing(ring, tRight, dR - 0.1);
    const outApex = sampleRoundedBowlRing(
      ring,
      tMid,
      outerRingOffsetFn(sMid.nx, sMid.nz)
    );
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
  const { ring, maxStandH, avgDepth, canopyOuterOffsetAt, exteriorSupportMinOffsetAt } =
    computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const sunkenDepth = getEffectiveSunkenDepth(doc);
  const groundY = Math.min(sunkenDepth, maxStandH * 0.6);

  const baseRoofY = maxStandH + Math.max(3.5, doc.roof.heightOffset);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const outerOffsetFn = (nx: number, nz: number) => canopyOuterOffsetAt(nx, nz, 5.5);

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
    const n = sampleRoundedBowlRing(ring, t, 0);
    const localOuter = outerOffsetFn(n.nx, n.nz);
    const wavePhase = frac * activePeaks * Math.PI * 2;
    const peakWave = Math.pow(0.5 + 0.5 * Math.cos(wavePhase), 1.8); // 1 at mast peaks, 0 in valleys

    for (let v = 0; v <= vSegs; v++) {
      const vf = v / vSegs; // 0 = inner edge, 1 = outer edge
      const radOff = innerOffset + vf * (localOuter - innerOffset);
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
      uvs[uvBase + 1] = vf;
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

  const { surfaceMat: membraneMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy,
    14,
    3,
    1,
    0.92
  );
  const netMesh = new THREE.Mesh(netGeo, membraneMat);
  netMesh.name = 'RoofCanopySurface';
  netMesh.customDepthMaterial = shadowDepthMat;
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
    const n = sampleRoundedBowlRing(ring, t, 0);
    const localOuter = outerOffsetFn(n.nx, n.nz);
    const mastFootOff = Math.max(
      localOuter + 3.2,
      exteriorSupportMinOffsetAt(n.nx, n.nz) + 1.6
    );
    const mastFoot = sampleRoundedBowlRing(ring, t, mastFootOff);
    const mastHead = sampleRoundedBowlRing(
      ring,
      t,
      innerOffset + 0.65 * (localOuter - innerOffset)
    );
    const anchorOut = sampleRoundedBowlRing(ring, t, mastFootOff + 11.3);
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
      const nVal = sampleRoundedBowlRing(ring, tVal, 0);
      const valOuter = outerOffsetFn(nVal.nx, nVal.nz);
      const valGroundOff = Math.max(
        valOuter + 6.5,
        exteriorSupportMinOffsetAt(nVal.nx, nVal.nz) + 4.5
      );
      const valOut = sampleRoundedBowlRing(ring, tVal, valOuter);
      const valGround = sampleRoundedBowlRing(ring, tVal, valGroundOff);
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
  const { ring, maxStandH, canopyOuterOffsetAt, standHeightAtNormal, standDepthAtNormal } =
    computeStadiumRingBounds(doc);

  const springY = maxStandH + Math.max(2.8, doc.roof.heightOffset * 0.7);
  const domeRise = 23.5;

  // Dome surface point: the eave follows the bowl/concourse contour, and each higher course is that
  // contour scaled toward the centre, so the sides hug the stadium outline instead of an ellipse.
  const domePoint = (t: number, theta: number, yAdjust = 0): THREE.Vector3 => {
    const n = sampleRoundedBowlRing(ring, t, 0);
    const eave = sampleRoundedBowlRing(ring, t, canopyOuterOffsetAt(n.nx, n.nz, 3.2));
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
      uvs[uvIdx + 1] = 1 - v / vSegs;
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

  const { surfaceMat: domeMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy,
    14,
    4,
    1
  );
  const domeMesh = new THREE.Mesh(domeGeo, domeMat);
  domeMesh.name = 'RoofCanopySurface';
  domeMesh.customDepthMaterial = shadowDepthMat;
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
    canopyOuterOffsetAt,
    standHeightAtNormal,
    standDepthAtNormal,
  } = computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);

  const roofY = maxStandH + Math.max(2.6, doc.roof.heightOffset * 0.78);
  const innerOff = avgDepth * (1 - doc.roof.coverageRatio);
  const outerOffFn = (nx: number, nz: number) => canopyOuterOffsetAt(nx, nz, 3.2);

  const { surfaceMat: membraneMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy
  );
  const primaryStructMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);

  group.add(
    buildAnnularCanopyMesh(
      ring,
      doc.shape,
      innerOff,
      outerOffFn,
      roofY + (style === 'column_supported' ? -0.4 : 0.4),
      roofY + 0.3,
      crossSectionClip,
      membraneMat,
      shadowDepthMat
    ),
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerOff,
      roofY - 0.65,
      doc.lighting,
      crossSectionClip,
      hasRoofGantryLights(doc)
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
    const localOuter = outerOffFn(s0.nx, s0.nz);
    const pRear = sampleRoundedBowlRing(ring, t, d0 - 0.3);
    const pRoof = sampleRoundedBowlRing(ring, t, localOuter - 0.6);
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
  standBackZ: number,
  concourseWidth: number,
  standTopY: number,
  roofHeight: number,
  doc: StadiumDocument,
  membraneMat: THREE.Material,
  shadowDepthMat: THREE.MeshDepthMaterial,
  primaryStructMat: THREE.Material,
  secondarySteelMat: THREE.Material,
  openNegEnd: boolean = true,
  openPosEnd: boolean = true
): THREE.Group {
  const standRoofGroup = new THREE.Group();
  const midZ = (rearZ + frontZ) / 2;
  const gantryLights = hasRoofGantryLights(doc);
  const crestSupportZ = Math.min(rearZ - 0.8, standBackZ - 0.6);
  const groundSupportZ = Math.max(rearZ + 0.6, standBackZ + concourseWidth + 1.0);

  if (style === 'none') {
    return standRoofGroup;
  }

  if (style === 'column_supported') {
    // Classic British / historic roof resting on slender columns planted in the upper rows!
    const deck = new THREE.Mesh(
      createOrientedRoofBoxGeometry(roofSpan, 0.32, roofDepth),
      membraneMat
    );
    deck.name = 'RoofCanopySurface';
    deck.customDepthMaterial = shadowDepthMat;
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
      buildStraightCatwalkFloodlights(
        roofSpan,
        frontZ,
        roofHeight - 0.25,
        doc.lighting,
        gantryLights
      )
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
        // Rear support column on stand crest -> rear roof
        createStrutBetween(
          new THREE.Vector3(cx, Math.max(0, standTopY - 2.0), crestSupportZ),
          new THREE.Vector3(cx, roofHeight + 0.1, rearZ - 1.0),
          0.26,
          0.3,
          primaryStructMat,
          6
        )
      );
    }

    return standRoofGroup;
  }

  if (style === 'historic_gable') {
    // Pre-war pitched roof: two slopes on exposed king-post trusses and riveted columns,
    // with a pediment facing the pitch at mid-span.
    const rise = Math.max(2.5, roofDepth * 0.16);
    const eaveY = roofHeight - 0.4;
    const ridgeY = eaveY + rise;
    const slopeLen = Math.hypot(roofDepth / 2, rise);
    const tilt = Math.atan2(rise, roofDepth / 2);
    for (const side of [-1, 1] as const) {
      const slope = new THREE.Mesh(createOrientedRoofBoxGeometry(roofSpan, 0.18, slopeLen), membraneMat);
      slope.name = 'RoofCanopySurface';
      slope.customDepthMaterial = shadowDepthMat;
      slope.position.set(0, (eaveY + ridgeY) / 2, midZ + (side * roofDepth) / 4);
      slope.rotation.x = side * tilt;
      slope.castShadow = true;
      slope.receiveShadow = true;
      standRoofGroup.add(slope);
    }

    const parts: THREE.BufferGeometry[] = [];
    const bays = Math.max(4, Math.round(roofSpan / 6));
    for (let b = 0; b <= bays; b++) {
      const x = -roofSpan / 2 + (b * roofSpan) / bays;
      const front = new THREE.Vector3(x, eaveY - 0.2, frontZ);
      const back = new THREE.Vector3(x, eaveY - 0.2, rearZ);
      const ridge = new THREE.Vector3(x, ridgeY - 0.25, midZ);
      const foot = new THREE.Vector3(x, eaveY - 0.2, midZ);
      parts.push(
        beamGeometry(front, back, 0.22, 0.3),
        beamGeometry(front, ridge, 0.22, 0.3),
        beamGeometry(back, ridge, 0.22, 0.3),
        beamGeometry(foot, ridge, 0.16, 0.16)
      );
      if (b % 2 === 0) {
        // Riveted columns: one in the upper rows, one on the stand crest.
        const footY = Math.max(1.8, standTopY * 0.55);
        const colZ = frontZ + Math.min(3.4, roofDepth * 0.22);
        parts.push(beamGeometry(new THREE.Vector3(x, footY, colZ), new THREE.Vector3(x, eaveY - 0.2, colZ), 0.32, 0.32));
        parts.push(
          beamGeometry(
            new THREE.Vector3(x, Math.max(0, standTopY - 2), crestSupportZ),
            new THREE.Vector3(x, eaveY - 0.2, crestSupportZ),
            0.36,
            0.36
          )
        );
      }
    }
    const frame = mergedMesh(parts, primaryStructMat, 'HistoricGableTrusses');
    if (frame) standRoofGroup.add(frame);

    // Pediment over the centre of the front slope.
    const pedW = Math.min(22, roofSpan * 0.3);
    const pedH = rise + 3.2;
    const pediment = new THREE.Mesh(
      new THREE.ExtrudeGeometry(
        new THREE.Shape([
          new THREE.Vector2(-pedW / 2, 0),
          new THREE.Vector2(pedW / 2, 0),
          new THREE.Vector2(0, pedH),
        ]),
        { depth: 0.5, bevelEnabled: false }
      ),
      membraneMat
    );
    pediment.name = 'HistoricGablePediment';
    pediment.position.set(0, eaveY, frontZ - 0.25);
    pediment.castShadow = true;
    standRoofGroup.add(pediment);

    standRoofGroup.add(
      buildStraightCatwalkFloodlights(roofSpan, frontZ, eaveY - 0.25, doc.lighting, gantryLights)
    );
    return standRoofGroup;
  }

  if (style === 'goalpost_truss') {
    // Monumental "Poutre-portique" (Goalpost) box-girder resting on 2 corner mega-pylons!
    const deck = new THREE.Mesh(
      createOrientedRoofBoxGeometry(roofSpan, 0.38, roofDepth),
      membraneMat
    );
    deck.name = 'RoofCanopySurface';
    deck.customDepthMaterial = shadowDepthMat;
    deck.position.set(0, roofHeight, midZ);
    deck.castShadow = true;
    deck.receiveShadow = true;
    standRoofGroup.add(deck);

    standRoofGroup.add(
      buildStraightCatwalkFloodlights(roofSpan, frontZ, roofHeight, doc.lighting, gantryLights)
    );

    const pylonX = roofSpan / 2 + 1.8;
    const girderBotY = roofHeight + 3.6;
    const girderTopY = roofHeight + 7.6;
    const girderZ = frontZ + Math.min(4.2, roofDepth * 0.24);

    // 2 Corner Mega-Pylons: planted at front girder ONLY on open ends; shifted behind rear wall on closed corners!
    for (const sSign of [-1, 1] as const) {
      const isOpenEnd = sSign === -1 ? openNegEnd : openPosEnd;
      const px = sSign * (isOpenEnd ? pylonX : roofSpan * 0.5 - 0.6);
      const pylonZ = isOpenEnd ? girderZ : groundSupportZ + 0.6;
      const pylon = new THREE.Mesh(
        new THREE.BoxGeometry(3.0, girderTopY + 1.4, 3.2),
        primaryStructMat
      );
      pylon.position.set(px, (girderTopY + 1.4) / 2, pylonZ);
      pylon.castShadow = true;
      standRoofGroup.add(pylon);

      standRoofGroup.add(
        createStrutBetween(
          new THREE.Vector3(
            px,
            isOpenEnd ? 0 : standTopY,
            isOpenEnd ? groundSupportZ + 0.9 : crestSupportZ
          ),
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
        // Transverse roof rafter back to rear canopy edge
        createStrutBetween(
          new THREE.Vector3(xm, roofHeight + 0.2, frontZ + 0.5),
          new THREE.Vector3(xm, roofHeight + 0.2, rearZ - 0.5),
          0.18,
          0.18,
          secondarySteelMat,
          5
        ),
        createStrutBetween(
          new THREE.Vector3(xm, Math.max(0, standTopY - 1.8), crestSupportZ),
          new THREE.Vector3(xm, roofHeight + 0.2, rearZ - 1.0),
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
      createOrientedRoofBoxGeometry(roofSpan, 0.36, roofDepth),
      membraneMat
    );
    deck.name = 'RoofCanopySurface';
    deck.customDepthMaterial = shadowDepthMat;
    deck.position.set(0, roofHeight, midZ);
    deck.castShadow = true;
    deck.receiveShadow = true;
    standRoofGroup.add(deck);

    standRoofGroup.add(
      buildStraightCatwalkFloodlights(roofSpan, frontZ, roofHeight, doc.lighting, gantryLights)
    );

    const rearCols = Math.max(6, Math.floor(roofSpan / 13));
    for (let c = 0; c < rearCols; c++) {
      const cx = -roofSpan / 2 + 2 + (c * (roofSpan - 4)) / Math.max(1, rearCols - 1);
      standRoofGroup.add(
        createStrutBetween(
          new THREE.Vector3(cx, Math.max(0, standTopY - 2.2), crestSupportZ),
          new THREE.Vector3(cx, roofHeight + 0.2, rearZ - 1.0),
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
          new THREE.Vector3(gx, 0, groundSupportZ - 0.4),
          new THREE.Vector3(gx, roofHeight + 0.4, rearZ - 0.6),
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
    createOrientedRoofBoxGeometry(roofSpan, 0.42, roofDepth),
    membraneMat
  );
  deckSlab.name = 'RoofCanopySurface';
  deckSlab.customDepthMaterial = shadowDepthMat;
  deckSlab.position.set(0, roofHeight + 0.4, midZ);
  deckSlab.rotation.x = tiltAngle;
  deckSlab.castShadow = true;
  deckSlab.receiveShadow = true;
  standRoofGroup.add(deckSlab);

  standRoofGroup.add(
    buildStraightCatwalkFloodlights(roofSpan, frontZ, roofHeight + 0.4, doc.lighting, gantryLights)
  );

  const anchorOnStandCrest = concourseWidth > 0.5 && doc.roof.overConcourse === false;
  const frameCount = Math.max(7, Math.floor(roofSpan / 11));
  for (let i = 0; i < frameCount; i++) {
    const rx = -roofSpan / 2 + 2.5 + (i * (roofSpan - 5)) / Math.max(1, frameCount - 1);
    const rearPostFootY = anchorOnStandCrest ? Math.max(0, standTopY - 2.2) : 0;
    const rearPostFootZ = anchorOnStandCrest ? rearZ - 0.1 : groundSupportZ;

    standRoofGroup.add(
      createStrutBetween(
        new THREE.Vector3(rx, rearPostFootY, rearPostFootZ),
        new THREE.Vector3(rx, roofHeight + 3.4, rearZ - 0.2),
        0.34,
        0.46,
        primaryStructMat,
        6
      ),
      createStrutBetween(
        new THREE.Vector3(rx, standTopY - 1.2, crestSupportZ),
        new THREE.Vector3(rx, roofHeight + 0.3, crestSupportZ),
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

/**
 * Restricts a whole-bowl roof to some stands: each covered stand gets a copy of the roof (sharing
 * geometry) clipped to its sector, bounded by vertical planes through the stadium diagonals.
 * Needs `renderer.localClippingEnabled`.
 */
/** Cross-section of a ring loft at ring position `t`: points as (radial offset, height). */
type RingProfile = (t: number, nx: number, nz: number, s: number) => { r: number; y: number }[];

/**
 * Surface swept around the bowl through a cross-section that may vary with `t`. With
 * `flat`, every triangle keeps its own normal, which reads as folded or faceted panels.
 */
function buildRingLoft(
  ring: ReturnType<typeof buildShapeBowlRing>,
  shape: StadiumShape,
  crossSectionClip: boolean,
  segments: number,
  profile: RingProfile,
  mat: THREE.Material,
  name: string,
  flat: boolean = false
): THREE.Mesh {
  const { tStart, tEnd, closed } = getBowlArcRange(shape, crossSectionClip);
  const segs = Math.max(8, Math.round(segments * Math.max(0.25, tEnd - tStart)));
  const count = closed ? segs : segs + 1;
  const pos: number[] = [];
  const uv: number[] = [];
  let cols = 0;
  for (let s = 0; s < count; s++) {
    const t = tStart + (s / segs) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const pts = profile(t, n.nx, n.nz, s);
    cols = pts.length;
    pts.forEach((pt, k) => {
      const p = sampleRoundedBowlRing(ring, t, pt.r);
      pos.push(p.x, pt.y, p.z);
      uv.push((s / segs) * 24, k / Math.max(1, pts.length - 1));
    });
  }
  const idx: number[] = [];
  for (let s = 0; s < segs; s++) {
    const a0 = s * cols;
    const b0 = ((s + 1) % count) * cols;
    for (let k = 0; k < cols - 1; k++) {
      idx.push(a0 + k, b0 + k, a0 + k + 1, b0 + k, b0 + k + 1, a0 + k + 1);
    }
  }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  if (flat) geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Share of a ring normal pointing at a corner: 0 on the axes, 1 on the diagonals. */
const cornerWeight = (nx: number, nz: number) => Math.min(1, 2 * Math.abs(nx * nz));

/** Extra eave height (m) of a `saddle_vault` along the touchlines over the goal ends. */
const SADDLE_RISE = 9;

/**
 * SADDLE VAULT (`saddle_vault`): one translucent shell rising from the ground in a curved
 * facade and vaulting over the stands, higher along the touchlines than behind the goals, so
 * the roof line dips like a saddle (Panathinaikos project, Stade Vélodrome).
 */
function buildSaddleVaultRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const { ring, maxStandH, avgDepth, canopyOuterOffsetAt } = computeStadiumRingBounds(doc);
  const { surfaceMat, shadowDepthMat } = buildCanopyMaterialBundle(doc, maxAnisotropy, 24, 6, 1);
  const roofY = maxStandH + Math.max(4, doc.roof.heightOffset);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const shell: RingProfile = (_t, nx, nz) => {
    const outer = canopyOuterOffsetAt(nx, nz, 3.8) + 2;
    const eaveY = roofY + 2 + SADDLE_RISE * nz * nz;
    const pts: { r: number; y: number }[] = [];
    // Quarter-ellipse facade from the ground, leaning out, up to the eave.
    for (let k = 0; k <= 6; k++) {
      const a = (k / 6) * (Math.PI / 2);
      pts.push({ r: outer - 6 + 6 * Math.cos(a), y: eaveY * Math.sin(a) });
    }
    // Vault over the stands, falling gently to a thin lip at the front edge.
    for (let k = 1; k <= 8; k++) {
      const f = k / 8;
      pts.push({
        r: outer - 6 + (innerOffset - (outer - 6)) * f,
        y: eaveY + 3 * Math.sin(Math.PI * f * 0.8) - 2.5 * f * f,
      });
    }
    return pts;
  };
  const skin = buildRingLoft(ring, doc.shape, crossSectionClip, 192, shell, surfaceMat, 'RoofCanopySurface');
  skin.customDepthMaterial = shadowDepthMat;
  skin.renderOrder = 2;
  group.add(skin);

  // Meridian ribs following the shell, and a ring beam along the front lip.
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const ribs = Math.max(16, Math.round(72 * Math.max(0.25, tEnd - tStart)));
  const parts: THREE.BufferGeometry[] = [];
  const lip: THREE.Vector3[] = [];
  for (let i = 0; i < (closed ? ribs : ribs + 1); i++) {
    const t = tStart + (i / ribs) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const pts = shell(t, n.nx, n.nz, i).map((pt) => {
      const p = sampleRoundedBowlRing(ring, t, pt.r);
      return new THREE.Vector3(p.x, pt.y - 0.25, p.z);
    });
    for (let k = 0; k < pts.length - 1; k++) parts.push(beamGeometry(pts[k], pts[k + 1], 0.35, 0.5));
    lip.push(pts[pts.length - 1]);
  }
  for (let i = 0; i < lip.length - (closed ? 0 : 1); i++) {
    parts.push(beamGeometry(lip[i], lip[(i + 1) % lip.length], 0.9, 1.2));
  }
  const frame = mergedMesh(parts, createStructurePbrMaterial(mats.structure, maxAnisotropy), 'SaddleVaultRibs');
  if (frame) group.add(frame);
  return group;
}

/**
 * DISHED CANOPY (`dished_canopy`): a concave canopy, raised at both its front and rear edges and
 * sagging between them, whose eaves flare up at the corners, finished with a deep fascia (new
 * Romareda).
 */
function buildDishedCanopyRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { ring } = computeStadiumRingBounds(doc);
  const flareAt = (t: number) => {
    const n = sampleRoundedBowlRing(ring, t, 0);
    return 2 + 6 * cornerWeight(n.nx, n.nz) ** 2;
  };
  const { group, outerOffsetFn, primaryStructMat, surface } = buildPerimeterCanopyCrown(
    doc,
    crossSectionClip,
    maxAnisotropy,
    {
      segments: 192,
      surface:
        ({ roofY }) =>
        (t, f) =>
          roofY + 2.2 * (1 - f) - 2.4 * Math.sin(Math.PI * f) + flareAt(t) * f ** 3,
    }
  );
  // Deep fascia hanging from the eave.
  const fascia = buildRingLoft(
    ring,
    doc.shape,
    crossSectionClip,
    192,
    (t, nx, nz) => {
      const r = outerOffsetFn(nx, nz);
      const top = surface(t, 1) + 0.3;
      return [
        { r, y: top - 3.2 },
        { r: r + 0.4, y: top - 1.6 },
        { r: r + 0.4, y: top },
      ];
    },
    primaryStructMat,
    'DishedCanopyFascia'
  );
  group.add(fascia);
  return group;
}

/**
 * FACETED SHELL (`faceted_shell`): roof and facade wrapped in one angular metal shell of
 * triangular facets that alternately bulge and recede around the stadium (Aspmyra project).
 */
function buildFacetedShellRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const { ring, maxStandH, avgDepth, canopyOuterOffsetAt } = computeStadiumRingBounds(doc);
  const roofY = maxStandH + Math.max(4, doc.roof.heightOffset);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  // An even number of facets so the alternation closes around the bowl.
  const facets = 2 * Math.max(6, Math.round(ring.perimeter / 70));
  // Ring step between facet vertices, as `buildRingLoft` spaces them.
  const { tStart, tEnd } = getBowlArcRange(doc.shape, crossSectionClip);
  const span = tEnd - tStart;
  const dt = span / Math.max(8, Math.round(facets * Math.max(0.25, span)));
  const radialAt = (t: number, r: number) => {
    const n = sampleRoundedBowlRing(ring, t, 0);
    return { ...sampleRoundedBowlRing(ring, t, r), nx: n.nx, nz: n.nz };
  };
  // Long straight facets cut the corners: take the widest stand footprint between the facet
  // midpoints and push the vertex out by the chord sag, so the shell always clears the bowl.
  const shellOuterAt = (t: number) => {
    let outer = 0;
    for (let k = -4; k <= 4; k++) {
      const n = sampleRoundedBowlRing(ring, t + (k / 8) * dt, 0);
      outer = Math.max(outer, canopyOuterOffsetAt(n.nx, n.nz, 3.8));
    }
    let sag = 0;
    for (const side of [-1, 1]) {
      const a = radialAt(t, outer);
      const b = radialAt(t + side * dt, outer);
      const m = radialAt(t + side * dt * 0.5, outer);
      sag = Math.max(sag, (m.x - (a.x + b.x) / 2) * m.nx + (m.z - (a.z + b.z) / 2) * m.nz);
    }
    return outer + Math.max(0, sag) * 1.1;
  };
  const shell: RingProfile = (t, _nx, _nz, s) => {
    const odd = s % 2 === 1;
    const outer = shellOuterAt(t);
    return [
      { r: outer + (odd ? 8 : 4.5), y: 0 },
      { r: outer + (odd ? 4.5 : 9), y: roofY * 0.55 },
      { r: outer - 1, y: roofY + 2 + (odd ? 2.5 : 0) },
      { r: innerOffset, y: roofY + 1 + (odd ? 0 : 2) },
    ];
  };
  const metal = createFacadePbrMaterial('black_zinc_cladding', doc.lighting, false, maxAnisotropy);
  const mesh = buildRingLoft(ring, doc.shape, crossSectionClip, facets, shell, metal, 'RoofCanopySurface', true);
  group.add(mesh);

  // Seams along every facet edge.
  const pos = mesh.geometry.getAttribute('position');
  const parts: THREE.BufferGeometry[] = [];
  const v = (i: number) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
  for (let i = 0; i < pos.count; i += 3) {
    parts.push(beamGeometry(v(i), v(i + 1), 0.18, 0.18), beamGeometry(v(i + 1), v(i + 2), 0.18, 0.18));
  }
  const seams = mergedMesh(
    parts,
    createStructurePbrMaterial('galvanized_steel', maxAnisotropy),
    'FacetedShellSeams'
  );
  if (seams) group.add(seams);
  return group;
}

/** Radial depth (m) of a `pleated_crown` fold. */
const PLEAT_DEPTH = 2.6;

/**
 * PLEATED CROWN (`pleated_crown`): a glazed ring roof framed by a metal facade folded into tall
 * diamond pleats that run from the ground to the roof edge (Generali Stadium project).
 */
function buildPleatedCrownRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, outerOffsetFn, surface } = buildPerimeterCanopyCrown(
    doc,
    crossSectionClip,
    maxAnisotropy,
    { segments: 160, surface: ({ roofY }) => (_t, f) => roofY + 0.8 * (1 - f) },
    false
  );
  const pleats = 2 * Math.max(24, Math.round(bounds.ring.perimeter / 14));
  const pleat: RingProfile = (t, nx, nz, s) => {
    const base = outerOffsetFn(nx, nz) + 1;
    const out = s % 2 === 0 ? PLEAT_DEPTH : 0;
    const top = surface(t, 1) + 1.2;
    return [
      { r: base + out, y: 0 },
      { r: base + PLEAT_DEPTH - out, y: top / 2 },
      { r: base + out, y: top },
      { r: base - 1, y: top },
    ];
  };
  group.add(
    buildRingLoft(
      bounds.ring,
      doc.shape,
      crossSectionClip,
      pleats,
      pleat,
      createFacadePbrMaterial('brushed_steel_mesh', doc.lighting, false, maxAnisotropy),
      'PleatedCrownFacade',
      true
    )
  );
  return group;
}

/** Rise (m) of a `saucer_dome` from its rim to its front edge. */
const SAUCER_CROWN = 6;

/**
 * SAUCER DOME (`saucer_dome`): a thick convex roof, highest at its front edge and rolling over a
 * rounded rim, carried on a ring of inclined V-columns standing outside the facade (new Roma
 * stadium project).
 */
function buildSaucerDomeRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const { ring, maxStandH, avgDepth, canopyOuterOffsetAt } = computeStadiumRingBounds(doc);
  const { surfaceMat, shadowDepthMat } = buildCanopyMaterialBundle(doc, maxAnisotropy, 24, 4, 1);
  const roofY = maxStandH + Math.max(4, doc.roof.heightOffset);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const rimAt = (nx: number, nz: number) => canopyOuterOffsetAt(nx, nz, 3.8) + 3;
  const saucer: RingProfile = (_t, nx, nz) => {
    const rim = rimAt(nx, nz);
    const pts: { r: number; y: number }[] = [];
    for (let k = 0; k <= 8; k++) {
      const f = k / 8;
      pts.push({ r: innerOffset + (rim - innerOffset) * f, y: roofY + 1.5 + SAUCER_CROWN * (1 - f * f) });
    }
    // Rounded rim rolling under to the soffit.
    pts.push({ r: rim + 1.6, y: roofY + 0.4 }, { r: rim + 1.2, y: roofY - 1.6 }, { r: rim - 1, y: roofY - 2.4 });
    return pts;
  };
  const shell = buildRingLoft(ring, doc.shape, crossSectionClip, 192, saucer, surfaceMat, 'RoofCanopySurface');
  shell.customDepthMaterial = shadowDepthMat;
  shell.renderOrder = 2;
  group.add(shell);

  // Inclined V-columns: pairs springing from one foot outside the facade up to the soffit.
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const fullBays = Math.max(12, Math.round(ring.perimeter / 11));
  const bays = Math.max(4, Math.round(fullBays * Math.max(0.25, tEnd - tStart)));
  const dt = 0.5 / fullBays;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < bays; i++) {
    const t = tStart + ((closed ? i : i + 0.5) / bays) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const foot = sampleRoundedBowlRing(ring, t, rimAt(n.nx, n.nz) + 4);
    const base = new THREE.Vector3(foot.x, 0, foot.z);
    for (const side of [-1, 1]) {
      const tt = t + side * dt;
      const m = sampleRoundedBowlRing(ring, tt, 0);
      const head = sampleRoundedBowlRing(ring, tt, rimAt(m.nx, m.nz) - 0.5);
      parts.push(beamGeometry(base, new THREE.Vector3(head.x, roofY - 2.2, head.z), 0.8, 0.8));
    }
  }
  const columns = mergedMesh(parts, createStructurePbrMaterial(mats.structure, maxAnisotropy), 'SaucerVColumns');
  if (columns) group.add(columns);
  return group;
}

/** Height (m) the `rising_canopy` gains from its eave to its front edge. */
const RISING_CANOPY_RISE = 8;

/**
 * RISING CANOPY (`rising_canopy`): a canopy climbing steadily from the eave toward the pitch, its
 * high front edge stiffened by a lattice compression ring around the opening (new Jan Breydel
 * project).
 */
function buildRisingCanopyRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, innerOffset, primaryStructMat, surface } = buildPerimeterCanopyCrown(
    doc,
    crossSectionClip,
    maxAnisotropy,
    {
      segments: 160,
      surface:
        ({ roofY }) =>
        (_t, f) =>
          roofY + RISING_CANOPY_RISE * (1 - f) ** 1.3,
    }
  );
  const { ring } = bounds;
  const { tStart, tEnd } = getBowlArcRange(doc.shape, crossSectionClip);
  const nodes = Math.max(24, Math.round((ring.perimeter / 6) * Math.max(0.25, tEnd - tStart)));
  const at = (i: number, r: number, dy: number) => {
    const t = tStart + (i / nodes) * (tEnd - tStart);
    const p = sampleRoundedBowlRing(ring, t, innerOffset + r);
    return new THREE.Vector3(p.x, surface(t, 0) + dy, p.z);
  };
  // Triangular lattice ring: two bottom chords and a top chord, braced by diagonals.
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < nodes; i++) {
    const j = i + 1;
    parts.push(
      beamGeometry(at(i, 0.3, 0), at(j, 0.3, 0), 0.5, 0.5),
      beamGeometry(at(i, 3.5, -0.6), at(j, 3.5, -0.6), 0.5, 0.5),
      beamGeometry(at(i, 1.8, 3), at(j, 1.8, 3), 0.6, 0.6),
      beamGeometry(at(i, 0.3, 0), at(j, 1.8, 3), 0.25, 0.25),
      beamGeometry(at(i, 3.5, -0.6), at(j, 1.8, 3), 0.25, 0.25),
      beamGeometry(at(i, 0.3, 0), at(i, 3.5, -0.6), 0.25, 0.25)
    );
  }
  const truss = mergedMesh(parts, primaryStructMat, 'RisingCanopyCompressionRing');
  if (truss) group.add(truss);
  return group;
}

/**
 * GIRDER GRID (`girder_grid`): two primary trusses along the touchlines and two behind the goals
 * cross over the canopy's front edge in a « # », resting on cores beyond the corners; secondary
 * trusses run from them out to the eaves, so the roof is carried both ways (Emirates Stadium).
 */
function buildGirderGridRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, roofY, innerOffset, primaryStructMat } = buildPerimeterCanopyCrown(
    doc,
    crossSectionClip,
    maxAnisotropy
  );
  const { ring, innerHalfX, innerHalfZ, canopyOuterOffsetAt } = bounds;
  const eave = Array.from({ length: 128 }, (_, s) => {
    const n = sampleRoundedBowlRing(ring, s / 128, 0);
    const p = sampleRoundedBowlRing(ring, s / 128, canopyOuterOffsetAt(n.nx, n.nz, 3.8));
    return { x: p.x, z: p.z };
  });
  const lineX = innerHalfX + innerOffset + 1;
  const lineZ = innerHalfZ + innerOffset + 1;
  const springY = roofY + 2;
  const steel: THREE.BufferGeometry[] = [];
  const primary = (a: THREE.Vector3, b: THREE.Vector3) => {
    steel.push(...warrenTrussParts(a, b, 5, Math.max(8, Math.round(a.distanceTo(b) / 6)), 1.2, 0.5));
    for (const end of [a, b]) {
      if (crossSectionClip && end.z > 0) continue;
      steel.push(beamGeometry(new THREE.Vector3(end.x, 0, end.z), end, 3, 3));
    }
  };
  // Primary girders overshoot the eave to cores beyond the corners.
  const halfX = Math.max(...eave.map((p) => p.x)) + 4;
  const halfZ = Math.max(...eave.map((p) => p.z)) + 4;
  for (const z of crossSectionClip ? [-lineZ] : [-lineZ, lineZ]) {
    primary(new THREE.Vector3(-halfX, springY, z), new THREE.Vector3(halfX, springY, z));
  }
  for (const x of [-lineX, lineX]) {
    primary(new THREE.Vector3(x, springY, -halfZ), new THREE.Vector3(x, springY, crossSectionClip ? 0 : halfZ));
  }
  // Secondary trusses from the primaries out to the eaves, every 10 m.
  const secondary = (axis: 'x' | 'z', along: number, from: number, sign: number) => {
    const chord = chordAt(eave, axis, along);
    if (!chord) return;
    const to = sign > 0 ? chord[1] : chord[0];
    if ((to - from) * sign < 3) return;
    const a = axis === 'x' ? new THREE.Vector3(along, springY, from) : new THREE.Vector3(from, springY, along);
    const b = axis === 'x' ? new THREE.Vector3(along, springY - 1.2, to) : new THREE.Vector3(to, springY - 1.2, along);
    steel.push(...warrenTrussParts(a, b, 2.2, Math.max(3, Math.round(a.distanceTo(b) / 4)), 0.45, 0.22));
  };
  for (let x = -lineX + 8; x < lineX - 4; x += 10) {
    secondary('x', x, -lineZ, -1);
    if (!crossSectionClip) secondary('x', x, lineZ, 1);
  }
  for (let z = -lineZ + 8; z < (crossSectionClip ? 0 : lineZ - 4); z += 10) {
    secondary('z', z, -lineX, -1);
    secondary('z', z, lineX, 1);
  }
  const grid = mergedMesh(steel, primaryStructMat, 'GirderGridTrusses');
  if (grid) group.add(grid);
  return group;
}

/** Apex height (m) of the touchline arches of `crossed_arches` above the canopy. */
const CROSSED_ARCH_RISE = 20;

/**
 * CROSSED ARCHES (`crossed_arches`): four tubular arches over the canopy, two along the
 * touchlines and two behind the goals, crossing near the corners, with a zigzag of hangers down
 * to the roof (Estádio da Luz).
 */
function buildCrossedArchesRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, roofY, innerOffset } = buildPerimeterCanopyCrown(
    doc,
    crossSectionClip,
    maxAnisotropy
  );
  const mats = resolveStadiumMaterials(doc);
  const { innerHalfX, innerHalfZ, nominalOuterOffset } = bounds;
  const outer = nominalOuterOffset(3.8);
  const mid = (innerOffset + outer) / 2;
  const deckY = roofY + 1;
  const tubes: THREE.BufferGeometry[] = [];
  const hangers: THREE.BufferGeometry[] = [];
  // Parabolic arch along `axis` at `offset`, springing from the ground at `±foot`.
  const arch = (axis: 'x' | 'z', offset: number, foot: number, apexY: number) => {
    const end = axis === 'z' && crossSectionClip ? 0 : foot;
    const at = (u: number) => {
      const s = -foot + (foot + end) * u;
      const y = apexY * (1 - (s / foot) ** 2);
      return axis === 'x' ? new THREE.Vector3(s, y, offset) : new THREE.Vector3(offset, y, s);
    };
    const pts = Array.from({ length: 41 }, (_, k) => at(k / 40));
    tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 1.1, 10, false));
    // Zigzag hangers wherever the arch rides well above the deck.
    for (let k = 1; k < 40; k++) {
      const p = at(k / 40);
      if (p.y < deckY + 3) continue;
      const q = at((k + (k % 2 === 0 ? 1 : -1)) / 40);
      hangers.push(
        beamGeometry(p, new THREE.Vector3(p.x, deckY, p.z), 0.3, 0.3),
        beamGeometry(p, new THREE.Vector3(q.x, deckY, q.z), 0.3, 0.3)
      );
    }
  };
  for (const sign of crossSectionClip ? [-1] : [-1, 1]) {
    arch('x', sign * (innerHalfZ + mid), innerHalfX + outer + 8, roofY + CROSSED_ARCH_RISE);
  }
  for (const sign of [-1, 1]) {
    arch('z', sign * (innerHalfX + mid), innerHalfZ + outer + 8, roofY + CROSSED_ARCH_RISE * 0.7);
  }
  const steelMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const archMesh = mergedMesh(tubes, steelMat, 'CrossedArchTubes');
  if (archMesh) group.add(archMesh);
  const hangerMesh = mergedMesh(hangers, steelMat, 'CrossedArchHangers');
  if (hangerMesh) group.add(hangerMesh);
  return group;
}

/** Whole-arena roof systems built from the ring loft and perimeter crown helpers above. */
const SIGNATURE_ROOF_BUILDERS: Partial<
  Record<RoofStyle, (doc: StadiumDocument, crossSectionClip: boolean, maxAnisotropy: number) => THREE.Group>
> = {
  girder_grid: buildGirderGridRoof,
  saddle_vault: buildSaddleVaultRoof,
  dished_canopy: buildDishedCanopyRoof,
  faceted_shell: buildFacetedShellRoof,
  pleated_crown: buildPleatedCrownRoof,
  saucer_dome: buildSaucerDomeRoof,
  rising_canopy: buildRisingCanopyRoof,
  crossed_arches: buildCrossedArchesRoof,
};

function clipRoofToSides(doc: StadiumDocument, roof: THREE.Group, sides: StandSide[]): THREE.Group {
  const { innerHalfX, innerHalfZ } = computeStadiumRingBounds(doc);
  const ax = 1 / innerHalfX;
  const az = 1 / innerHalfZ;
  // Each sector keeps points where its axis coordinate dominates: e.g. south is z/hz ≥ |x|/hx.
  const sectorPlanes: Record<StandSide, THREE.Plane[]> = {
    south: [new THREE.Vector3(-ax, 0, az), new THREE.Vector3(ax, 0, az)].map(
      (n) => new THREE.Plane(n.normalize(), 0)
    ),
    north: [new THREE.Vector3(-ax, 0, -az), new THREE.Vector3(ax, 0, -az)].map(
      (n) => new THREE.Plane(n.normalize(), 0)
    ),
    east: [new THREE.Vector3(ax, 0, -az), new THREE.Vector3(ax, 0, az)].map(
      (n) => new THREE.Plane(n.normalize(), 0)
    ),
    west: [new THREE.Vector3(-ax, 0, -az), new THREE.Vector3(-ax, 0, az)].map(
      (n) => new THREE.Plane(n.normalize(), 0)
    ),
  };

  const result = new THREE.Group();
  result.name = roof.name;
  for (const side of sides) {
    const sector = roof.clone(true);
    const clones = new Map<THREE.Material, THREE.Material>();
    sector.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const clipped = mats.map((m) => {
        let c = clones.get(m);
        if (!c) {
          c = m.clone();
          c.clippingPlanes = sectorPlanes[side];
          c.clipShadows = true;
          clones.set(m, c);
        }
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? clipped : clipped[0];
      if (mesh.customDepthMaterial) {
        let cd = clones.get(mesh.customDepthMaterial);
        if (!cd) {
          cd = mesh.customDepthMaterial.clone();
          cd.clippingPlanes = sectorPlanes[side];
          cd.clipShadows = true;
          clones.set(mesh.customDepthMaterial, cd);
        }
        mesh.customDepthMaterial = cd;
      }
    });
    result.add(sector);
  }
  return result;
}

export function generateRoofGroup(
  doc: StadiumDocument,
  crossSectionClip: boolean = false,
  maxAnisotropy: number = 4
): THREE.Group {
  const roof = buildRoofAssembly(doc, crossSectionClip, maxAnisotropy);
  const covered = doc.roof.coveredSides;
  if (!isContinuousBowlShape(doc.shape) || !covered || covered.length >= 4) return roof;
  return clipRoofToSides(doc, roof, covered);
}

function buildRoofAssembly(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
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

    if (doc.roof.style === 'retractable' || doc.roof.style === 'petal_iris') {
      root.add(buildRetractableRoof(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    if (doc.roof.style === 'timber_lattice') {
      root.add(buildTimberLatticeRoof(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    const signatureBuilder = SIGNATURE_ROOF_BUILDERS[doc.roof.style];
    if (signatureBuilder) {
      root.add(signatureBuilder(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    if (doc.roof.style === 'wave_canopy') {
      root.add(buildWaveCanopyRoof(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    if (doc.roof.style === 'concrete_portals') {
      root.add(buildConcretePortalsRoof(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    if (doc.roof.style === 'spanning_girders') {
      root.add(buildSpanningGirdersRoof(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    if (doc.roof.style === 'counterweighted_cantilever') {
      root.add(buildCounterweightedCantileverRoof(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    if (doc.roof.style === 'corner_pylons') {
      root.add(buildCornerPylonsRoof(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    if (doc.roof.style === 'vaulted_ring') {
      root.add(buildVaultedRingRoof(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    if (doc.roof.style === 'folded_plate') {
      root.add(buildFoldedPlateRoof(doc, crossSectionClip, maxAnisotropy));
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
  const isContShape = isContinuousBowlShape(doc.shape);
  const { surfaceMat: membraneMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy,
    isContShape ? 10 : 4,
    2,
    isContShape ? 1 : 4
  );
  const primaryStructMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const secondarySteelMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.34,
    metalness: 0.82,
  });

  // Continuous Bowl / Octagon / Horseshoe External Spine Cantilever (or Truss fallback on continuous bowl)
  if (isContShape) {
    const {
      ring,
      maxStandH,
      avgDepth,
      hasConcourse,
      overConcourse,
      standHeightAtNormal,
      canopyOuterOffsetAt,
      exteriorSupportMinOffsetAt,
    } = computeStadiumRingBounds(doc);
    const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
    const arcFraction = Math.max(0.25, tEnd - tStart);
    const sunkenDepth = getEffectiveSunkenDepth(doc);
    const groundY = Math.min(sunkenDepth, maxStandH * 0.6);
    const roofY = maxStandH + Math.max(2.2, doc.roof.heightOffset * 0.75);
    const innerOff = avgDepth * (1 - doc.roof.coverageRatio);
    const outerOffFn = (nx: number, nz: number) => canopyOuterOffsetAt(nx, nz, 3.2);
    const crestAnchored = hasConcourse && !overConcourse;

    root.add(
      buildAnnularCanopyMesh(
        ring,
        doc.shape,
        innerOff,
        outerOffFn,
        roofY + 0.9,
        roofY - 0.2,
        crossSectionClip,
        membraneMat,
        shadowDepthMat
      ),
      buildAnnularCatwalkFloodlights(
        ring,
        doc.shape,
        innerOff,
        roofY + 0.55,
        doc.lighting,
        crossSectionClip,
        hasRoofGantryLights(doc)
      )
    );

    const frameCount = Math.max(12, Math.round(40 * arcFraction));
    for (let i = 0; i < frameCount; i++) {
      const frac = closed ? i / frameCount : i / Math.max(1, frameCount - 1);
      const t = tStart + frac * (tEnd - tStart);
      const s0 = sampleRoundedBowlRing(ring, t, 0);
      const localOuter = outerOffFn(s0.nx, s0.nz);
      const minExt = exteriorSupportMinOffsetAt(s0.nx, s0.nz);

      const footOff = crestAnchored
        ? localOuter + 0.35
        : Math.max(localOuter + 1.2, minExt);
      const kneeOff = crestAnchored
        ? localOuter + 0.2
        : Math.max(localOuter + 0.5, minExt - 0.4);
      const footY = crestAnchored
        ? Math.max(groundY, standHeightAtNormal(s0.nx, s0.nz) - 2.0)
        : groundY;

      const pGround = sampleRoundedBowlRing(ring, t, footOff);
      const pKnee = sampleRoundedBowlRing(ring, t, kneeOff);
      const pMid = sampleRoundedBowlRing(ring, t, (innerOff + localOuter) * 0.52);
      const pTip = sampleRoundedBowlRing(ring, t, innerOff + 1.2);

      const spineCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(pGround.x, footY, pGround.z),
        new THREE.Vector3(pKnee.x, footY + (roofY - footY) * 0.72, pKnee.z),
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
  const safePitch = clampPitchToTrack(doc.pitch);
  const concourseWidth = Math.max(0, doc.concourse?.width ?? 0);
  const hasConcourse = concourseWidth > 0.5;
  const overConcourse = doc.roof.overConcourse !== false;
  const trackOffsets = getTrackRadialOffset(doc);
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
  });

  const standRoofBounds: Partial<
    Record<
      StandSide,
      {
        style: RoofStyle;
        frontZ: number;
        rearZ: number;
        standBackZ: number;
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
    const standBackZ = metrics.totalDepth;
    const baseRearZ = standBackZ + 2.8;
    const frontZ =
      baseRearZ - Math.max(12, standBackZ * doc.roof.coverageRatio + 3.6);
    const rearZ = !hasConcourse
      ? baseRearZ
      : overConcourse
      ? standBackZ + concourseWidth + 0.45
      : standBackZ + 0.8;
    const roofDepth = Math.max(8, rearZ - frontZ);

    standRoofBounds[side] = {
      style: effectiveStyle,
      frontZ,
      rearZ,
      standBackZ,
      standTopY,
      roofHeight,
    };

    const standRoofGroup = buildSingleStandRoofGroup(
      effectiveStyle,
      roofSpan,
      roofDepth,
      frontZ,
      rearZ,
      standBackZ,
      concourseWidth,
      standTopY,
      roofHeight,
      doc,
      membraneMat,
      shadowDepthMat,
      primaryStructMat,
      secondarySteelMat,
      spanSpec.capNegLocalX,
      spanSpec.capPosLocalX
    );
    addSlabDeckDetail(standRoofGroup);

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

  // Seamless 3D Corner Roof Canopy Quadrants + Hip Cantilever Rafters on `filled` & `building` corners
  const cornerRoofShadowDepth = createRoofShadowDepthMaterial(
    mats.roof,
    doc.roof.opacity,
    doc.roof.skylightMode ?? 'none',
    doc.roof.skylightRatio ?? 0,
    1,
    1
  );
  const cornerOrder: CornerQuadrantId[] = ['se', 'sw', 'nw', 'ne'];
  for (const cId of cornerOrder) {
    const corner = rectLayout.corners[cId];
    if (!corner.active || (corner.mode !== 'filled' && corner.mode !== 'building')) {
      continue;
    }

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
        standBackD: number;
        frontY: number;
        rearY: number;
        standTopY: number;
      }[] = [];

      for (let s = 0; s <= segs; s++) {
        const u = s / segs;
        const w = u * u * (3 - 2 * u);

        const frontD = boundA.frontZ + (boundB.frontZ - boundA.frontZ) * w;
        const rearD = boundA.rearZ + (boundB.rearZ - boundA.rearZ) * w;
        const standBackD =
          boundA.standBackZ + (boundB.standBackZ - boundA.standBackZ) * w;
        const baseRoofH = boundA.roofHeight + (boundB.roofHeight - boundA.roofHeight) * w;
        const standTopY = boundA.standTopY + (boundB.standTopY - boundA.standTopY) * w;

        const frontY = baseRoofH + 0.65;
        const rearY = baseRoofH + 0.05;
        sliceBounds.push({ frontD, rearD, standBackD, frontY, rearY, standTopY });

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
      canopyMesh.name = 'RoofCanopySurface';
      canopyMesh.customDepthMaterial = cornerRoofShadowDepth;
      canopyMesh.castShadow = true;
      canopyMesh.receiveShadow = true;
      canopyMesh.renderOrder = 2;
      cornerRoofGroup.add(canopyMesh);

      // Radial Hip Cantilever Frames & Rear Structural Columns
      const cornerCrestAnchored = hasConcourse && !overConcourse;
      const hipCount = corner.facetedThreeBay ? 4 : 5;
      for (let h = 0; h < hipCount; h++) {
        const u = corner.facetedThreeBay ? h / 3 : (h + 0.5) / hipCount;
        const sIdx = Math.min(segs, Math.round(u * segs));
        const sb = sliceBounds[sIdx];
        const groundFootOff = cornerCrestAnchored
          ? sb.rearD - 0.1
          : Math.max(sb.rearD + 0.3, sb.standBackD + concourseWidth + 0.8);
        const rearFootY = cornerCrestAnchored ? Math.max(0, sb.standTopY - 2.2) : 0;
        const crestOff = Math.min(sb.rearD - 0.8, sb.standBackD - 0.6);
        const pRearFoot = sampleCornerQuadrantPoint(corner, u, groundFootOff);
        const pRearCrest = sampleCornerQuadrantPoint(corner, u, crestOff);
        const pMid = sampleCornerQuadrantPoint(corner, u, (sb.frontD + sb.rearD) * 0.5);
        const pFront = sampleCornerQuadrantPoint(corner, u, sb.frontD + 1.8);

        cornerRoofGroup.add(
          createStrutBetween(
            new THREE.Vector3(pRearFoot.x, rearFootY, pRearFoot.z),
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
      if (hasRoofGantryLights(doc) && catwalkPts.length >= 3) {
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

  return root;
}

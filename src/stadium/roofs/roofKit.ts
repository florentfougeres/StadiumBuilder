import * as THREE from 'three';
import { buildShapeBowlRing, getBowlArcRange, ringSamplesT, sampleRoundedBowlRing } from '../bowlRing';
import { calculateStandMetrics } from '../capacity';
import { createRoofPbrMaterial, createRoofShadowDepthMaterial, createStructurePbrMaterial, resolveStadiumMaterials } from '../materials';
import { LightingMode, resolveFloodlightRig, StadiumDocument, StadiumShape, StandSide } from '../schema';
import { standTreadHeightAt } from '../sightlines';
import { beamGeometry, gridSurfaceGeometry } from './roofBeams';
import { computeStadiumRingBounds } from './ringBounds';

export function hasRoofGantryLights(doc: StadiumDocument): boolean {
  const rig = resolveFloodlightRig(doc);
  return rig === 'roof_gantry' || rig === 'both';
}

export function buildCanopyMaterialBundle(
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

export function createOrientedRoofBoxGeometry(
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
export function createStrutBetween(
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

  // Box gutter (chéneau) behind the rear fascia: an open channel the deck drains into, whose
  // outlets feed the downpipes on the columns (see `addColumnDownpipes`).
  {
    const gutterMat = new THREE.MeshStandardMaterial({ color: 0x8b9298, roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide });
    const pos: number[] = [];
    const idx: number[] = [];
    const out = new THREE.Vector3();
    for (const spoke of spokes) {
      const p = spoke[spoke.length - 1];
      // Outward: from the previous point of the spoke to its rear end, level.
      out.subVectors(p, spoke[spoke.length - 2]).setY(0).normalize();
      const o = p.clone().addScaledVector(out, 0.55);
      const i = p.clone().addScaledVector(out, 0.05);
      // Profile: inner lip, inner bottom, outer bottom, outer lip.
      pos.push(i.x, p.y - 0.1, i.z, i.x, p.y - 0.55, i.z, o.x, p.y - 0.55, o.z, o.x, p.y - 0.05, o.z);
    }
    for (let k = 0; k < segs; k++) {
      const a = k * 4;
      const b = ((k + 1) % count) * 4;
      for (let f = 0; f < 3; f++) idx.push(a + f, b + f, a + f + 1, b + f, b + f + 1, a + f + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const gutter = new THREE.Mesh(geo, gutterMat);
    gutter.name = 'RoofGutter';
    gutter.castShadow = true;
    group.add(gutter);
  }

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
export function addSlabDeckDetail(roof: THREE.Object3D): void {
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
  // Purlins: light members straight under the deck, spoke to spoke, at every depth point and
  // halfway between them, carrying the sheeting onto the trusses.
  const purlinDrop = new THREE.Vector3(0, -0.14, 0);
  for (let i = 0; i < segs; i++) {
    const a = spokes[i];
    const b = spokes[(i + 1) % count];
    for (let k = 0; k < a.length; k++) {
      members.push([a[k].clone().add(purlinDrop), b[k].clone().add(purlinDrop), 0.05]);
      if (k + 1 < a.length) {
        members.push([
          a[k].clone().lerp(a[k + 1], 0.5).add(purlinDrop),
          b[k].clone().lerp(b[k + 1], 0.5).add(purlinDrop),
          0.04,
        ]);
      }
    }
  }
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

/**
 * Rainwater downpipes down every roof column: a slim pipe on the column's outer face (away from
 * the pitch), from its head to the ground, with a shoe at the foot. Columns are found by shape —
 * near-vertical cylinders at least 5 m tall and 14 cm thick — so every roof style that stands on
 * columns gets them, whichever builder made it.
 */
export function addColumnDownpipes(roof: THREE.Object3D): void {
  roof.updateMatrixWorld(true);
  const toRoot = roof.matrixWorld.clone().invert();
  const pipes: THREE.Matrix4[] = [];
  const shoes: THREE.Matrix4[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const m = new THREE.Matrix4();
  roof.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
    const geo = mesh.geometry as THREE.CylinderGeometry;
    if (geo.type !== 'CylinderGeometry') return;
    const { height, radiusTop, radiusBottom } = geo.parameters;
    if (height < 5 || Math.min(radiusTop, radiusBottom) < 0.14) return;
    m.multiplyMatrices(toRoot, mesh.matrixWorld);
    a.set(0, -height / 2, 0).applyMatrix4(m);
    b.set(0, height / 2, 0).applyMatrix4(m);
    const lo = a.y < b.y ? a.clone() : b.clone();
    const hi = a.y < b.y ? b.clone() : a.clone();
    const len = hi.distanceTo(lo);
    if (len < 5 || (hi.y - lo.y) / len < 0.95) return;
    const outward = new THREE.Vector3(lo.x, 0, lo.z);
    if (outward.lengthSq() < 1e-6) outward.set(1, 0, 0);
    outward.normalize();
    // Scale of the mesh widens the column: measure its radius in root space.
    const r = new THREE.Vector3(Math.max(radiusTop, radiusBottom), 0, 0).applyMatrix4(m).sub(new THREE.Vector3().applyMatrix4(m)).length();
    const off = outward.multiplyScalar(r + 0.1);
    const top = hi.clone().add(off);
    const foot = new THREE.Vector3(top.x, Math.min(lo.y, 0.3), top.z);
    const h = top.y - foot.y;
    if (h < 3) return;
    pipes.push(new THREE.Matrix4().compose(top.clone().lerp(foot, 0.5), new THREE.Quaternion(), new THREE.Vector3(1, h, 1)));
    shoes.push(new THREE.Matrix4().makeTranslation(foot.x, foot.y + 0.12, foot.z));
  });
  if (pipes.length === 0) return;
  const mat = new THREE.MeshStandardMaterial({ color: 0x6f767d, roughness: 0.45, metalness: 0.6 });
  const pipeMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 8), mat, pipes.length);
  pipes.forEach((p, i) => pipeMesh.setMatrixAt(i, p));
  const shoeMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.24, 0.2), mat, shoes.length);
  shoes.forEach((p, i) => shoeMesh.setMatrixAt(i, p));
  for (const [mesh, name] of [
    [pipeMesh, 'RoofDownpipes'],
    [shoeMesh, 'RoofDownpipeShoes'],
  ] as const) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.name = name;
    roof.add(mesh);
  }
}

export function buildAnnularCanopyMesh(
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

  const ringTs = ringSamplesT(ring, tStart, tEnd, closed, activeSegs);
  for (let s = 0; s < ringCount; s++) {
    const t = ringTs[s];
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

export function buildAnnularCatwalkFloodlights(
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

export function buildStraightCatwalkFloodlights(
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
  const ringTs = ringSamplesT(ring, tStart, tEnd, closed, activeSegs);
  for (let s = 0; s < ringCount; s++) {
    const t = ringTs[s];
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

export function buildPerimeterCanopyCrown(
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
export function buildCanopyRib(
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

/** Even-odd point-in-polygon test in the XZ plane. */
export function insideXZ(poly: { x: number; z: number }[], x: number, z: number): boolean {
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
export function warrenTrussParts(
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
 * Terrace surface height of a continuous bowl at a share `depthRatio` of the local stand depth,
 * blending the four stand sections with the same weights as the ring's height and depth.
 */
export function treadHeightAtNormal(doc: StadiumDocument, nx: number, nz: number, depthRatio: number): number {
  const weights: [StandSide, number][] = [
    ['east', Math.pow(Math.max(0, nx), 2.2)],
    ['west', Math.pow(Math.max(0, -nx), 2.2)],
    ['south', Math.pow(Math.max(0, nz), 2.2)],
    ['north', Math.pow(Math.max(0, -nz), 2.2)],
  ];
  let sum = 0;
  let acc = 0;
  for (const [side, w] of weights) {
    const stand = doc.stands[side];
    if (w <= 0 || !stand.enabled || stand.rows <= 0) continue;
    const depth = calculateStandMetrics(doc, side).totalDepth;
    acc += w * standTreadHeightAt(stand, depthRatio * depth);
    sum += w;
  }
  return sum > 0 ? acc / sum : 0;
}

/**
 * Restricts a whole-bowl roof to some stands: each covered stand gets a copy of the roof (sharing
 * geometry) clipped to its sector, bounded by vertical planes through the stadium diagonals.
 * Needs `renderer.localClippingEnabled`.
 */
/** Cross-section of a ring loft at ring position `t`: points as (radial offset, height). */
export type RingProfile = (t: number, nx: number, nz: number, s: number) => { r: number; y: number }[];

/**
 * Surface swept around the bowl through a cross-section that may vary with `t`. With
 * `flat`, every triangle keeps its own normal, which reads as folded or faceted panels.
 */
export function buildRingLoft(
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
  const ts = ringSamplesT(ring, tStart, tEnd, closed, segs);
  for (let s = 0; s < count; s++) {
    const t = ts[s];
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
export const cornerWeight = (nx: number, nz: number) => Math.min(1, 2 * Math.abs(nx * nz));

/** Whole-arena roof systems built from the ring loft and perimeter crown helpers above. */
/**
 * Closed dome over the stadium contour: each course is the eave contour scaled toward the centre
 * (`s` = 1 at the eave, 0 at the centre), at the height `heightAt` gives it.
 */
export function contourDome(doc: StadiumDocument, crossSectionClip: boolean) {
  const { ring, maxStandH, canopyOuterOffsetAt } = computeStadiumRingBounds(doc);
  const springY = maxStandH + Math.max(2.4, doc.roof.heightOffset * 0.7);
  const eaveAt = (t: number) => {
    const n = sampleRoundedBowlRing(ring, t, 0);
    return sampleRoundedBowlRing(ring, t, canopyOuterOffsetAt(n.nx, n.nz, 3.2));
  };
  // Plan radius of the eave by direction, for heights at arbitrary plan points (cables).
  const table = Array.from({ length: 360 }, (_, i) => {
    const e = eaveAt(i / 360);
    return { a: Math.atan2(e.z, e.x), r: Math.hypot(e.x, e.z) };
  }).sort((p, q) => p.a - q.a);
  const eaveRadius = (angle: number) => {
    let lo = table[table.length - 1];
    for (const p of table) {
      if (p.a >= angle) {
        const span = p.a - lo.a || 1;
        const f = lo.a > p.a ? 0 : (angle - lo.a) / span;
        return lo.r + (p.r - lo.r) * Math.max(0, Math.min(1, f));
      }
      lo = p;
    }
    return table[0].r;
  };
  /** Contour share `s` of a plan point (1 on the eave). */
  const planShare = (x: number, z: number) => Math.hypot(x, z) / Math.max(1, eaveRadius(Math.atan2(z, x)));
  const tStart = crossSectionClip ? 0.5 : 0;
  const tSpan = crossSectionClip ? 0.5 : 1;
  const shell = (uSegs: number, vSegs: number, heightAt: (s: number, u: number, x: number, z: number) => number) =>
    gridSurfaceGeometry(
      uSegs,
      vSegs,
      (u, v) => {
        const e = eaveAt(tStart + u * tSpan);
        const s = 1 - v;
        const x = e.x * s;
        const z = e.z * s;
        return new THREE.Vector3(x, heightAt(s, u, x, z), z);
      },
      [uSegs / 6, vSegs / 4]
    );
  return { springY, eaveAt, planShare, shell, tStart, tSpan };
}

export type RoofBuilder = (doc: StadiumDocument, crossSectionClip: boolean, maxAnisotropy: number) => THREE.Group;

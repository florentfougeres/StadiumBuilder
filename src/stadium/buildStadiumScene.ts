import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addDistanceLods } from './meshKit';
import {
  calculateStandMetrics,
  getTrackRadialOffset,
  resolveStandRoofStyle,
} from './capacity';
import {
  createRoundedBowlRing,
  CRICKET_OUTFIELD_HALF_X,
  CRICKET_OUTFIELD_HALF_Z,
  sampleRoundedBowlRing,
} from './bowlRing';
import { generateConcourseGroup } from './generateConcourse';
import { generateEnvelopeSkirt } from './generateEnvelopeSkirt';
import {
  buildLedLoopBand,
  SCREEN_TOP,
  SCREEN_W,
  generateFloodlightRigGroup,
  generatePlacedObjectGroup,
} from './generateLights';
import { ApronOutline, generatePitchGroup } from './generatePitch';
import { generateRoofGroup } from './generateRoof';
import { computeStadiumRingBounds } from './roofs/ringBounds';
import { createRoofReliefField } from './roofs/roofRelief';
import { generateSiteGroup, SiteFootprint } from './generateSite';
import { generateStandsGroup } from './generateStand';
import {
  clampPitchToTrack,
  isContinuousBowlShape,
  PlacedObject,
  resolveHaloSize,
  StadiumDocument,
  StandSide,
} from './schema';

/** Yaw that turns a screen's display (+z) toward the pitch from each stand. */
const FACE_PITCH: Record<StandSide, number> = {
  north: 0,
  south: Math.PI,
  east: -Math.PI / 2,
  west: Math.PI / 2,
};

/** Ring parameter of each stand's axis (east at t = 0, counter-clockwise through south). */
const SIDE_RING_T: Record<StandSide, number> = { east: 0, south: 0.25, west: 0.5, north: 0.75 };

/** Overlap under the front row so no gap shows between the apron and the stands (m). */
const APRON_UNDER_STANDS = 1.2;

/**
 * Front edge of the stands, where the pitch-side apron ends. Without it the apron is a fixed band
 * that shows as a dark slab wherever no stand covers it: an open end, open corners, a low stand.
 */
function pitchApronOutline(doc: StadiumDocument): ApronOutline {
  if (isContinuousBowlShape(doc.shape)) {
    const { ring } = computeStadiumRingBounds(doc);
    return Array.from({ length: 128 }, (_, i) => {
      const p = sampleRoundedBowlRing(ring, i / 128, APRON_UNDER_STANDS);
      return { x: p.x, z: p.z };
    });
  }
  const pitch = clampPitchToTrack(doc.pitch);
  const track = getTrackRadialOffset(doc);
  const front = (side: StandSide, half: number, offset: number) =>
    half + offset + doc.stands[side].distanceToPitch + APRON_UNDER_STANDS;
  const east = front('east', pitch.length / 2, track.endOffset);
  const west = -front('west', pitch.length / 2, track.endOffset);
  const south = front('south', pitch.width / 2, track.sideOffset);
  const north = -front('north', pitch.width / 2, track.sideOffset);
  return [
    { x: west, z: north },
    { x: east, z: north },
    { x: east, z: south },
    { x: west, z: south },
  ];
}

/**
 * Places a roof- or stand-mounted screen from the stand's real geometry, so it stays attached
 * whatever the rows, tiers or roof height. Only the offset along the stand comes from the object.
 */
function applyScreenMount(doc: StadiumDocument, obj: PlacedObject, group: THREE.Group): void {
  const mount = obj.mount ?? 'free';
  if (obj.type !== 'screen' || mount === 'free') return;

  const side = obj.mountSide ?? 'west';
  const isEnd = side === 'east' || side === 'west';
  const outward = side === 'south' || side === 'east' ? 1 : -1;
  const scale = obj.scale[0];
  const sideUncovered =
    isContinuousBowlShape(doc.shape) && doc.roof.coveredSides !== undefined && !doc.roof.coveredSides.includes(side);
  const hasRoof = resolveStandRoofStyle(doc, side) !== 'none' && !sideUncovered;
  const coverage = Math.min(1, doc.roof.coverageRatio);

  // Continuous bowls follow the same contour and roof edge as the whole-arena roofs;
  // separate stands use the stand's own geometry.
  let inner: number;
  let depth: number;
  let crest: number;
  let roofEdgeY: number;
  if (isContinuousBowlShape(doc.shape)) {
    const bounds = computeStadiumRingBounds(doc);
    const axis = sampleRoundedBowlRing(bounds.ring, SIDE_RING_T[side], 0);
    inner = Math.hypot(axis.x, axis.z);
    depth = bounds.standDepthAtNormal(axis.nx, axis.nz);
    crest = bounds.standHeightAtNormal(axis.nx, axis.nz);
    roofEdgeY =
      bounds.maxStandH +
      Math.max(4, doc.roof.heightOffset) +
      1.8 -
      (createRoofReliefField(doc)?.dropAt(axis.x, axis.z) ?? 0);
  } else {
    const safePitch = clampPitchToTrack(doc.pitch);
    const metrics = calculateStandMetrics(doc, side);
    const track = getTrackRadialOffset(doc);
    inner =
      (isEnd ? safePitch.length / 2 + track.endOffset : safePitch.width / 2 + track.sideOffset) +
      doc.stands[side].distanceToPitch;
    depth = metrics.enabled ? metrics.totalDepth : 0;
    crest = metrics.enabled ? metrics.maxHeight : 0;
    roofEdgeY = crest + doc.roof.heightOffset;
  }

  let radial: number;
  let y: number;
  let roofY = 0;
  if (mount === 'roof' && hasRoof) {
    roofY = roofEdgeY;
    radial = inner + Math.max(2, depth * (1 - coverage)) + 1.5;
    // Clear of the roof's edge truss, but never down into the rows raked up beneath it.
    const rowsBelow = crest * Math.min(1, Math.max(0, (radial - inner) / Math.max(1, depth)));
    const hang = roofY - SCREEN_TOP * scale;
    y = Math.min(hang - 1.2, Math.max(rowsBelow + 2.5, hang - 3.2));
  } else {
    radial = inner + depth - 1.2;
    y = crest;
  }

  const along = isEnd ? obj.position[2] : obj.position[0];
  if (isEnd) group.position.set(outward * radial, y, along);
  else group.position.set(along, y, outward * radial);
  group.rotation.set(0, FACE_PITCH[side], 0);

  if (roofY > 0) {
    const cableLen = (roofY - y) / scale - SCREEN_TOP;
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.35 });
    for (const x of [-SCREEN_W * 0.32, SCREEN_W * 0.32]) {
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, cableLen, 6), cableMat);
      cable.position.set(x, SCREEN_TOP + cableLen / 2, 0);
      group.add(cable);
    }
  }
}

/** Hanging height of a new halo: level with the upper rows, below every roof's front edge. */
export function defaultHaloHeight(doc: StadiumDocument): number {
  const bounds = computeStadiumRingBounds(doc);
  return Math.max(18, bounds.maxStandH * 0.8);
}

/** Points along the roof edge screen, and how far inside the roof's front edge it hangs (m). */
const ROOF_EDGE_SCREEN_POINTS = 96;
const ROOF_EDGE_SCREEN_INSET = 0.6;

/**
 * 360° LED band hung under the front edge of a ring roof, all around the bowl (Bernabéu): it
 * follows the canopy's inner edge, its top just under the canopy, found by casting rays up
 * through the roof. Nothing is drawn when no roof stands above that edge.
 */
function buildRoofEdgeScreen(doc: StadiumDocument, obj: PlacedObject, roofGroup: THREE.Group): THREE.Group | null {
  const { ring, avgDepth } = computeStadiumRingBounds(doc);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const { bandHeight } = resolveHaloSize(obj);
  const points: { x: number; z: number }[] = [];
  for (let i = 0; i < ROOF_EDGE_SCREEN_POINTS; i++) {
    const p = sampleRoundedBowlRing(ring, i / ROOF_EDGE_SCREEN_POINTS, innerOffset + ROOF_EDGE_SCREEN_INSET);
    points.push({ x: p.x, z: p.z });
  }
  roofGroup.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  raycaster.far = 300;
  const hits: number[] = [];
  for (const p of points) {
    raycaster.set(new THREE.Vector3(p.x, 1, p.z), UP);
    const hit = raycaster.intersectObject(roofGroup, true)[0];
    if (hit) hits.push(hit.point.y);
  }
  if (hits.length < ROOF_EDGE_SCREEN_POINTS / 2) return null;
  // The lowest underside along the edge, so the band never cuts through the canopy.
  const top = Math.min(...hits) - 0.25;
  const group = new THREE.Group();
  group.name = 'RoofEdgeScreen';
  const band = buildLedLoopBand(points, bandHeight, doc.lighting);
  band.position.y = top - bandHeight / 2;
  group.add(band);
  return group;
}

const HALO_CABLES = 12;
/**
 * Angles from vertical tried in turn when nothing is straight above an anchor; past 90° the
 * cable runs slightly down to a roof edge or stand crest lower than the halo.
 */
const HALO_CABLE_TILTS = [0, 0.3, 0.55, 0.8, 1.0, 1.2, 1.35, 1.48, 1.6, 1.72];
const HALO_CABLE_YAWS = [0, 0.3, -0.3, 0.6, -0.6];
const UP = new THREE.Vector3(0, 1, 0);
/**
 * Distance from a stand's origin past which its crowd and seats switch to far detail: beyond the
 * stadium's own radius, so a drone flight inside the bowl keeps every spectator in full.
 */
const FAR_DETAIL_DISTANCE_M = 170;

/**
 * Suspends a halo screen from whatever structure is above it: each of the anchors on its top
 * chord casts rays, first straight up (domes, closed or sliding roofs, girders, arches), then
 * tilting outward toward the canopy's front edge (ring roofs) and finally the stand crests when
 * there is no roof. The cable runs to the first solid surface hit, so it follows any roof type.
 */
function hangHaloFromStructure(obj: PlacedObject, group: THREE.Group, supports: THREE.Object3D[]): void {
  const { rx, rz, bandHeight } = resolveHaloSize(obj);
  group.updateMatrixWorld(true);
  for (const s of supports) s.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster();
  raycaster.far = 260;
  const solid = (obj: THREE.Object3D): boolean => {
    const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    const m = Array.isArray(mat) ? mat[0] : mat;
    // Light cones and glows are see-through decoration, not something a cable can hang from.
    return Boolean(m) && m!.depthWrite !== false && !(m as THREE.MeshBasicMaterial).isMeshBasicMaterial;
  };
  // Only solid meshes are worth a ray: up to 600 rays per halo, each testing every target.
  // Seats, spectators and rails ignore rays anyway (see ignoreRaycasts).
  const targets: THREE.Object3D[] = [];
  for (const s of supports) {
    s.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && solid(o)) targets.push(o);
    });
  }

  const center = new THREE.Vector3();
  group.getWorldPosition(center);
  const segments: [THREE.Vector3, THREE.Vector3][] = [];
  const topY = bandHeight * 0.5 + 0.18;
  for (let c = 0; c < HALO_CABLES; c++) {
    const th = ((c + 0.5) / HALO_CABLES) * Math.PI * 2;
    const local = new THREE.Vector3(Math.cos(th) * (rx - 0.55), topY, Math.sin(th) * (rz - 0.55));
    const anchor = group.localToWorld(local.clone());
    const outward = new THREE.Vector3(anchor.x - center.x, 0, anchor.z - center.z).normalize();
    let end: THREE.Vector3 | null = null;
    // Open corners leave nothing on the diagonal: swing the cable toward the nearest stand roof.
    search: for (const yaw of HALO_CABLE_YAWS) {
      const across = outward.clone().applyAxisAngle(UP, yaw);
      for (const tilt of HALO_CABLE_TILTS) {
        const dir = new THREE.Vector3(0, Math.cos(tilt), 0).addScaledVector(across, Math.sin(tilt)).normalize();
        raycaster.set(anchor, dir);
        const hit = raycaster.intersectObjects(targets, false)[0];
        if (hit) {
          end = hit.point;
          break search;
        }
      }
    }
    if (end) segments.push([local, group.worldToLocal(end.clone())]);
  }
  if (segments.length === 0) return;

  const parts = segments.map(([a, b]) => {
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(0.12, 0.12, len, 5, 1, true);
    geo.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      b.clone().sub(a).normalize()
    );
    geo.applyMatrix4(new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)));
    return geo;
  });
  const cables = new THREE.Mesh(
    mergeGeometries(parts),
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.25, metalness: 0.88 })
  );
  cables.name = 'HaloSuspensionCables';
  // The cables reach up to the roof; the selection box frames the screen alone.
  cables.userData.outsideSelection = true;
  group.add(cables);
}

export interface BuiltStadiumScene {
  rootGroup: THREE.Group;
  placedObjectMap: Map<string, THREE.Group>;
}

/**
 * Outer footprint of the built stadium (stands, concourse and envelope, not the roof's masts and
 * backstays), as the superellipse the surroundings are laid out around.
 */
function measureSiteFootprint(doc: StadiumDocument, built: THREE.Object3D[]): SiteFootprint {
  const box = new THREE.Box3();
  for (const obj of built) box.expandByObject(obj);
  const pitch = clampPitchToTrack(doc.pitch);
  const halfX = box.isEmpty() ? pitch.length / 2 + 20 : Math.max(-box.min.x, box.max.x);
  const halfZ = box.isEmpty() ? pitch.width / 2 + 20 : Math.max(-box.min.z, box.max.z);
  const exponent = doc.shape === 'circular_bowl' ? 2.2 : isContinuousBowlShape(doc.shape) ? 2.8 : 6;
  return { halfX, halfZ, exponent };
}

/**
 * Pure top-level 3D stadium builder: transforms a JSON StadiumDocument into a complete
 * hierarchical THREE.Group (Pitch, Stands, Roof, and Interactive Placed Objects).
 */
export function buildStadiumSceneGraph(
  doc: StadiumDocument,
  options: {
    crossSectionClip?: boolean;
    maxAnisotropy?: number;
    /**
     * Merge the stadium's static meshes per material (see mergeStaticMeshes) to cut draw calls.
     * Off by default so tests and exports keep the named part hierarchy.
     */
    mergeStatic?: boolean;
    /** Lighter crowd and seats when seen from afar (see addDistanceLods). Viewport only. */
    distanceLod?: boolean;
  } = {}
): BuiltStadiumScene {
  const rootGroup = new THREE.Group();
  rootGroup.name = `Stadium_${doc.id}`;
  const aniso = options.maxAnisotropy ?? 4;

  const pitchGroup = generatePitchGroup(
    doc.pitch,
    doc.colors,
    aniso,
    doc.lighting,
    doc.materials,
    pitchApronOutline(doc),
    doc.shape === 'cricket_oval'
      ? createRoundedBowlRing(CRICKET_OUTFIELD_HALF_X, CRICKET_OUTFIELD_HALF_Z, CRICKET_OUTFIELD_HALF_Z * 0.96)
      : undefined
  );
  const standsGroup = generateStandsGroup(
    doc,
    Boolean(options.crossSectionClip),
    aniso
  );
  const roofGroup = generateRoofGroup(
    doc,
    Boolean(options.crossSectionClip),
    aniso
  );

  const objectsContainer = new THREE.Group();
  objectsContainer.name = 'PlacedObjectsAssembly';

  const placedObjectMap = new Map<string, THREE.Group>();
  for (const obj of doc.objects) {
    const objGroup = generatePlacedObjectGroup(
      obj,
      doc.lighting,
      doc.materials,
      aniso
    );
    if (obj.type === 'halo_screen' && obj.haloShape === 'roof_edge') {
      objGroup.position.set(0, 0, 0);
      objGroup.rotation.set(0, 0, 0);
      objGroup.scale.set(1, 1, 1);
      const band = buildRoofEdgeScreen(doc, obj, roofGroup);
      if (band) objGroup.add(band);
    } else if (obj.type === 'halo_screen') {
      if (obj.position[1] <= 5) objGroup.position.y = defaultHaloHeight(doc);
      hangHaloFromStructure(obj, objGroup, [roofGroup, standsGroup]);
    }
    applyScreenMount(doc, obj, objGroup);
    objectsContainer.add(objGroup);
    placedObjectMap.set(obj.id, objGroup);
  }

  const concourseGroup = generateConcourseGroup(doc, Boolean(options.crossSectionClip), aniso);
  const floodlightRigGroup = generateFloodlightRigGroup(
    doc,
    Boolean(options.crossSectionClip),
    aniso
  );

  const skirtGroup = generateEnvelopeSkirt(doc, roofGroup, Boolean(options.crossSectionClip), aniso);
  const siteGroup = generateSiteGroup(
    doc,
    measureSiteFootprint(doc, [standsGroup, concourseGroup, skirtGroup]),
    aniso
  );

  rootGroup.add(
    siteGroup,
    pitchGroup,
    standsGroup,
    concourseGroup,
    skirtGroup,
    roofGroup,
    floodlightRigGroup,
    objectsContainer
  );

  if (options.mergeStatic) {
    // Placed objects stay separate: they are picked, highlighted and moved one by one.
    for (const group of rootGroup.children) {
      if (group !== objectsContainer) mergeStaticMeshes(group);
    }
  }
  if (options.distanceLod) addDistanceLods(rootGroup, FAR_DETAIL_DISTANCE_M);

  return {
    rootGroup,
    placedObjectMap,
  };
}

/** Mesh flags and vertex layout that must match for two meshes to share one draw call. */
function mergeKey(mesh: THREE.Mesh): string | null {
  const geo = mesh.geometry;
  const mat = mesh.material;
  if (
    (mesh as THREE.InstancedMesh).isInstancedMesh ||
    (mesh as THREE.SkinnedMesh).isSkinnedMesh ||
    (geo as THREE.InstancedBufferGeometry).isInstancedBufferGeometry ||
    Array.isArray(mat) ||
    (mat as THREE.ShaderMaterial).isShaderMaterial ||
    // One merged transparent mesh can no longer be depth-sorted part by part.
    mat.transparent ||
    Object.keys(geo.morphAttributes).length > 0 ||
    // Mirrored parts would come out with inverted winding.
    mesh.matrixWorld.determinant() <= 0
  ) {
    return null;
  }
  const attrs = Object.entries(geo.attributes)
    .map(([name, a]) => {
      const attr = a as THREE.BufferAttribute;
      return `${name}:${attr.itemSize}:${attr.normalized}:${attr.array?.constructor.name}`;
    })
    .sort()
    .join(',');
  return [
    mat.uuid,
    mesh.castShadow,
    mesh.receiveShadow,
    mesh.renderOrder,
    mesh.frustumCulled,
    geo.index ? 'i' : 'n',
    attrs,
  ].join('|');
}

/**
 * Bakes every visible, opaque, plain mesh under `root` into one mesh per material, in `root`'s
 * space. A stadium is ~700-2 000 small meshes but only ~60-220 materials, and per-draw overhead
 * (heavy on Windows' ANGLE/D3D) dominates on integrated GPUs; the colour, shadow and AO passes
 * each pay it. Meshes that cannot merge (instanced, transparent, multi-material, mirrored…) stay.
 */
export function mergeStaticMeshes(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const buckets = new Map<string, THREE.Mesh[]>();
  // Subtrees flagged `keepSeparate` (moving roof panels) are left whole so they can be swapped.
  const collect = (obj: THREE.Object3D) => {
    if (!obj.visible || obj.userData.keepSeparate) return;
    const mesh = obj as THREE.Mesh;
    const key = mesh.isMesh ? mergeKey(mesh) : null;
    if (key) {
      const bucket = buckets.get(key);
      if (bucket) bucket.push(mesh);
      else buckets.set(key, [mesh]);
    }
    for (const child of obj.children) collect(child);
  };
  collect(root);

  const local = new THREE.Matrix4();
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const parts = meshes.map((mesh) => {
      const g = mesh.geometry.clone();
      g.clearGroups();
      g.applyMatrix4(local.multiplyMatrices(toRoot, mesh.matrixWorld));
      return g;
    });
    const merged = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    if (!merged) continue;
    const first = meshes[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.name = `Merged_${(first.material as THREE.Material).name || first.name || 'static'}`;
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.frustumCulled = first.frustumCulled;
    root.add(mesh);
    // Originals were never drawn, so they hold no GPU buffers; geometries may be shared caches.
    for (const m of meshes) m.removeFromParent();
  }
}

/**
 * Frees everything a stadium holds on the GPU, so parametric edits never pile up WebGL memory:
 * geometries, the per-instance matrices and colours of instanced meshes (seats and crowd alone
 * weigh about 11 MB a build), materials, and every texture a material holds, whatever the slot.
 */
export function disposeObject3D(root: THREE.Object3D): void {
  const disposedTextures = new Set<THREE.Texture>();
  const disposeMaterial = (m: THREE.Material) => {
    for (const value of Object.values(m)) {
      const tex = value as THREE.Texture | null;
      if (tex?.isTexture && !disposedTextures.has(tex)) {
        disposedTextures.add(tex);
        tex.dispose();
      }
    }
    m.dispose();
  };
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    if (mesh.material) {
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) disposeMaterial(m);
    }
    if (mesh.customDepthMaterial) disposeMaterial(mesh.customDepthMaterial);
    if (mesh.customDistanceMaterial) disposeMaterial(mesh.customDistanceMaterial);
    // Geometry disposal leaves the instance buffers on the GPU; only the mesh's own dispose frees them.
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
  });
}

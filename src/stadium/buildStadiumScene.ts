import * as THREE from 'three';
import {
  calculateStandMetrics,
  getTrackRadialOffset,
  resolveStandRoofStyle,
} from './capacity';
import { sampleRoundedBowlRing } from './bowlRing';
import { generateConcourseGroup } from './generateConcourse';
import { generateEnvelopeSkirt } from './generateEnvelopeSkirt';
import {
  generateFloodlightRigGroup,
  generatePlacedObjectGroup,
} from './generateLights';
import { generatePitchGroup } from './generatePitch';
import { computeStadiumRingBounds, generateRoofGroup } from './generateRoof';
import { generateStandsGroup } from './generateStand';
import {
  clampPitchToTrack,
  isContinuousBowlShape,
  PlacedObject,
  StadiumDocument,
  StandSide,
} from './schema';

/** Screen casing size in metres at scale 1, matching the `screen` builder in generateLights. */
const SCREEN_W = 13.5;
const SCREEN_TOP = 7.65;

/** Yaw that turns a screen's display (+z) toward the pitch from each stand. */
const FACE_PITCH: Record<StandSide, number> = {
  north: 0,
  south: Math.PI,
  east: -Math.PI / 2,
  west: Math.PI / 2,
};

/** Ring parameter of each stand's axis (east at t = 0, counter-clockwise through south). */
const SIDE_RING_T: Record<StandSide, number> = { east: 0, south: 0.25, west: 0.5, north: 0.75 };

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
    roofEdgeY = bounds.maxStandH + Math.max(4, doc.roof.heightOffset) + 1.8;
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
    y = roofY - SCREEN_TOP * scale - 1.2;
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

export interface BuiltStadiumScene {
  rootGroup: THREE.Group;
  placedObjectMap: Map<string, THREE.Group>;
}

/**
 * Pure top-level 3D stadium builder: transforms a JSON StadiumDocument into a complete
 * hierarchical THREE.Group (Pitch, Stands, Roof, and Interactive Placed Objects).
 */
export function buildStadiumSceneGraph(
  doc: StadiumDocument,
  options: {
    selectedObjectId?: string | null;
    crossSectionClip?: boolean;
    maxAnisotropy?: number;
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
    doc.materials
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
    const isSelected = options.selectedObjectId === obj.id;
    const objGroup = generatePlacedObjectGroup(
      obj,
      doc.lighting,
      isSelected,
      doc.materials,
      aniso
    );
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

  rootGroup.add(
    pitchGroup,
    standsGroup,
    concourseGroup,
    skirtGroup,
    roofGroup,
    floodlightRigGroup,
    objectsContainer
  );

  return {
    rootGroup,
    placedObjectMap,
  };
}

/**
 * Recursively disposes geometries, materials, and all PBR texture channels inside a THREE.Object3D
 * to guarantee zero WebGL memory leaks across parametric edits.
 */
export function disposeObject3D(root: THREE.Object3D): void {
  const disposedTextures = new Set<THREE.Texture>();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const phys = m as THREE.MeshPhysicalMaterial;
        const texSlots = [
          phys.map,
          phys.normalMap,
          phys.roughnessMap,
          phys.metalnessMap,
          phys.bumpMap,
          phys.emissiveMap,
          phys.aoMap,
          phys.alphaMap,
          phys.clearcoatNormalMap,
          phys.clearcoatRoughnessMap,
        ];
        for (const tex of texSlots) {
          if (tex && !disposedTextures.has(tex)) {
            disposedTextures.add(tex);
            tex.dispose();
          }
        }
        m.dispose();
      }
    }
    if (mesh.customDepthMaterial) {
      const depthMat = mesh.customDepthMaterial as THREE.MeshDepthMaterial;
      if (depthMat.alphaMap && !disposedTextures.has(depthMat.alphaMap)) {
        disposedTextures.add(depthMat.alphaMap);
        depthMat.alphaMap.dispose();
      }
      depthMat.dispose();
    }
  });
}

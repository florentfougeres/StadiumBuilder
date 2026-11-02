import * as THREE from 'three';
import { generatePlacedObjectGroup } from './generateLights';
import { generatePitchGroup } from './generatePitch';
import { generateRoofGroup } from './generateRoof';
import { generateStandsGroup } from './generateStand';
import { StadiumDocument } from './schema';

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
    objectsContainer.add(objGroup);
    placedObjectMap.set(obj.id, objGroup);
  }

  rootGroup.add(pitchGroup, standsGroup, roofGroup, objectsContainer);

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
  });
}

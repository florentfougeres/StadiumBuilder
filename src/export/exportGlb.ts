import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildStadiumSceneGraph, disposeObject3D } from '../stadium/buildStadiumScene';
import { StadiumDocument } from '../stadium/schema';
import { sanitizeFilename, triggerDownloadBlob } from './exportPng';

const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'bumpMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
] as const;

/** Canvas copy of a DataTexture: the GLTF writer draws textures onto a canvas to encode them. */
function toCanvasTexture(texture: THREE.DataTexture): THREE.Texture {
  const { data, width, height } = texture.image as { data: ArrayLike<number>; width: number; height: number };
  const channels = Math.round(data.length / (width * height));
  const isFloat = data instanceof Float32Array;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 4; c++) {
      const v = c < channels ? data[i * channels + c] : c === 3 ? (isFloat ? 1 : 255) : data[i * channels];
      pixels.data[i * 4 + c] = isFloat ? Math.round(Math.min(1, Math.max(0, v)) * 255) : v;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const copy = new THREE.CanvasTexture(canvas);
  copy.colorSpace = texture.colorSpace;
  copy.wrapS = texture.wrapS;
  copy.wrapT = texture.wrapT;
  copy.repeat.copy(texture.repeat);
  copy.offset.copy(texture.offset);
  copy.flipY = texture.flipY;
  return copy;
}

/**
 * Gives every mesh export-safe material copies whose procedural DataTextures are replaced by
 * canvas textures; returns what was created so it can be disposed after the export.
 */
function prepareMaterialsForGltf(root: THREE.Object3D): (THREE.Material | THREE.Texture)[] {
  const created: (THREE.Material | THREE.Texture)[] = [];
  const materialCopies = new Map<THREE.Material, THREE.Material>();
  const textureCopies = new Map<THREE.Texture, THREE.Texture>();
  const convert = (material: THREE.Material) => {
    let copy = materialCopies.get(material);
    if (copy) return copy;
    copy = material.clone();
    const slots = copy as unknown as Record<string, THREE.Texture | null | undefined>;
    for (const slot of TEXTURE_SLOTS) {
      const tex = slots[slot];
      if (!tex || !(tex as THREE.DataTexture).isDataTexture) continue;
      let canvasTex = textureCopies.get(tex);
      if (!canvasTex) {
        canvasTex = toCanvasTexture(tex as THREE.DataTexture);
        textureCopies.set(tex, canvasTex);
        created.push(canvasTex);
      }
      slots[slot] = canvasTex;
    }
    materialCopies.set(material, copy);
    created.push(copy);
    return copy;
  };
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(convert)
      : convert(mesh.material);
  });
  return created;
}

/**
 * Exports the procedural 3D stadium scene to binary .glb format ready for Blender or Web viewers.
 */
export async function exportStadiumGlb(doc: StadiumDocument): Promise<void> {
  const { rootGroup } = buildStadiumSceneGraph(doc, {
    selectedObjectId: null,
    crossSectionClip: false,
    maxAnisotropy: 1,
  });

  const exportCopies = prepareMaterialsForGltf(rootGroup);
  const cleanUp = () => {
    exportCopies.forEach((item) => item.dispose());
    disposeObject3D(rootGroup);
  };
  const exporter = new GLTFExporter();

  return new Promise<void>((resolve, reject) => {
    exporter.parse(
      rootGroup,
      (result) => {
        cleanUp();
        if (result instanceof ArrayBuffer) {
          const blob = new Blob([result], { type: 'model/gltf-binary' });
          triggerDownloadBlob(blob, `${sanitizeFilename(doc.name)}.glb`);
          resolve();
        } else {
          const jsonText = JSON.stringify(result, null, 2);
          const blob = new Blob([jsonText], { type: 'model/gltf+json' });
          triggerDownloadBlob(blob, `${sanitizeFilename(doc.name)}.gltf`);
          resolve();
        }
      },
      (error) => {
        cleanUp();
        reject(error);
      },
      { binary: true }
    );
  });
}

/**
 * Exports the StadiumDocument conception JSON so it can be archived or reopened later.
 */
export function exportStadiumJson(doc: StadiumDocument): void {
  const payload = JSON.stringify(doc, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  triggerDownloadBlob(blob, `${sanitizeFilename(doc.name)}.stadium.json`);
}

/**
 * Validates and parses an imported JSON StadiumDocument file.
 */
export async function parseImportedStadiumJson(file: File): Promise<StadiumDocument> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Partial<StadiumDocument>;

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !parsed.pitch ||
    !parsed.stands ||
    !parsed.stands.north ||
    !parsed.stands.south
  ) {
    throw new Error('Fichier JSON de stade invalide ou incomplet.');
  }

  return parsed as StadiumDocument;
}

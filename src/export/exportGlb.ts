import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { getSunDirection } from '../editor/renderPipeline';
import { buildStadiumSceneGraph, disposeObject3D } from '../stadium/buildStadiumScene';
import { bakeWorldTriplanarUvs } from '../stadium/materials';
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

let viewCameraHandler: (() => THREE.PerspectiveCamera | null) | null = null;

/** The viewport hands over its camera, so the exported file opens on the view being edited. */
export function registerGlbCameraHandler(fn: (() => THREE.PerspectiveCamera | null) | null): void {
  viewCameraHandler = fn;
}

/** Name of the closest named ancestor, for the many generated meshes that carry none. */
function inheritedName(obj: THREE.Object3D): string {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) if (o.name) return o.name;
  return 'Stadium';
}

/**
 * Per-instance colours (seat palettes, crowd shirts, tree foliage) are dropped by DCC tools that
 * import EXT_mesh_gpu_instancing, which left every seat white in Blender. Splits an instanced
 * mesh into one instanced mesh per colour, each with its own tinted material copy; colours are
 * rounded to 16 levels per channel so a random crowd stays a few dozen groups.
 */
function splitInstancesByColor(inst: THREE.InstancedMesh, created: (THREE.Material | THREE.Texture)[]): void {
  const colors = inst.instanceColor;
  if (!colors || Array.isArray(inst.material) || !inst.parent) return;
  const byKey = new Map<string, number[]>();
  const c = new THREE.Color();
  for (let i = 0; i < inst.count; i++) {
    inst.getColorAt(i, c);
    const key = [c.r, c.g, c.b].map((v) => Math.round(Math.min(1, v) * 15)).join('-');
    const list = byKey.get(key);
    if (list) list.push(i);
    else byKey.set(key, [i]);
  }
  const m = new THREE.Matrix4();
  for (const [key, indices] of byKey) {
    const [r, g, b] = key.split('-').map((v) => Number(v) / 15);
    const material = inst.material.clone() as THREE.MeshStandardMaterial;
    material.color = (material.color ?? new THREE.Color(1, 1, 1)).clone().multiply(new THREE.Color(r, g, b));
    created.push(material);
    const part = new THREE.InstancedMesh(inst.geometry, material, indices.length);
    indices.forEach((src, i) => {
      inst.getMatrixAt(src, m);
      part.setMatrixAt(i, m);
    });
    part.name = `${inheritedName(inst)}_${new THREE.Color(r, g, b).getHexString()}`;
    part.position.copy(inst.position);
    part.quaternion.copy(inst.quaternion);
    part.scale.copy(inst.scale);
    part.castShadow = inst.castShadow;
    inst.parent.add(part);
  }
  inst.removeFromParent();
}

/**
 * Makes the generated scene usable in Blender, Twinmotion or Lumion: readable mesh and material
 * names, per-instance colours kept, and the concrete and facade maps given the world-scale UVs
 * the viewport computes in a shader (otherwise stretched once across a whole stand).
 */
function prepareSceneForDcc(root: THREE.Object3D, created: (THREE.Material | THREE.Texture)[]): void {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    if (!mesh.name) mesh.name = inheritedName(mesh);
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
      splitInstancesByColor(mesh as THREE.InstancedMesh, created);
      continue;
    }
    // Clone first: geometries are shared between meshes, and the UVs depend on each one's place.
    const copy = mesh.geometry.clone();
    const baked = bakeWorldTriplanarUvs(copy, mesh.material, mesh.matrixWorld);
    if (baked !== copy) mesh.geometry = baked;
    else copy.dispose();
  }
}

/** Material names from the first mesh wearing each one, so the material list reads like the stadium. */
function nameMaterials(root: THREE.Object3D): void {
  const used = new Map<string, number>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material.name) continue;
      const base = mesh.name || 'Material';
      const n = (used.get(base) ?? 0) + 1;
      used.set(base, n);
      material.name = n === 1 ? base : `${base} ${n}`;
    }
  });
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
    crossSectionClip: false,
    maxAnisotropy: 1,
  });

  const exportCopies: (THREE.Material | THREE.Texture)[] = [];
  prepareSceneForDcc(rootGroup, exportCopies);
  exportCopies.push(...prepareMaterialsForGltf(rootGroup));
  nameMaterials(rootGroup);

  // The sun of the chosen lighting (KHR_lights_punctual, in lux: a soft daylight once imported).
  const sun = new THREE.DirectionalLight(0xfff4e0, doc.lighting === 'night' ? 300 : 3000);
  sun.name = 'Sun';
  sun.position.copy(getSunDirection(doc.lighting)).multiplyScalar(200);
  rootGroup.add(sun);
  const viewCamera = viewCameraHandler?.();
  if (viewCamera) {
    const camera = viewCamera.clone();
    camera.name = 'ViewCamera';
    rootGroup.add(camera);
  }

  const cleanUp = () => {
    exportCopies.forEach((item) => item.dispose());
    disposeObject3D(rootGroup);
  };
  const exporter = new GLTFExporter();
  // three writes no mesh names, and Blender names instanced objects after their mesh, not their
  // node: without this, 40 000 seats arrive as Mesh_660.001, .002…
  exporter.register(() => ({
    writeMesh(mesh: THREE.Mesh, meshDef: { name?: string }) {
      if (mesh.name) meshDef.name = mesh.name;
    },
  }));

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

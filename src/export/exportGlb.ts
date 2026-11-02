import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildStadiumSceneGraph, disposeObject3D } from '../stadium/buildStadiumScene';
import { StadiumDocument } from '../stadium/schema';
import { sanitizeFilename, triggerDownloadBlob } from './exportPng';

/**
 * Exports the procedural 3D stadium scene to binary .glb format ready for Blender or Web viewers.
 */
export async function exportStadiumGlb(doc: StadiumDocument): Promise<void> {
  const { rootGroup } = buildStadiumSceneGraph(doc, {
    selectedObjectId: null,
    crossSectionClip: false,
    maxAnisotropy: 1,
  });

  const exporter = new GLTFExporter();

  return new Promise<void>((resolve, reject) => {
    exporter.parse(
      rootGroup,
      (result) => {
        disposeObject3D(rootGroup);
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
        disposeObject3D(rootGroup);
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

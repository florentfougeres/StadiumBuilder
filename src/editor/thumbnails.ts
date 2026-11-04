import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ENVELOPE_STYLE_CATALOG, resolveStadiumMaterials } from '../stadium/materials';
import { buildStadiumSceneGraph, disposeObject3D } from '../stadium/buildStadiumScene';
import { BLANK_PRESET_ID, createBlankDocument, createPresetDocument, STADIUM_PRESETS } from '../stadium/presets';
import { RoofStyle, StadiumDocument, StadiumShape } from '../stadium/schema';
import { applyShape } from '../state/useStadiumStore';

export const THUMB_W = 360;
export const THUMB_H = 220;

/** Families of pre-rendered images shipped in public/; each file is `<dir>/<id>.webp`. */
export type ThumbnailDir = 'presets' | 'shapes' | 'roofs' | 'envelopes';

export function thumbnailUrl(dir: ThumbnailDir, id: string): string {
  return `${import.meta.env.BASE_URL}${dir}/${id}.webp`;
}

export interface ThumbnailJob {
  id: string;
  doc: StadiumDocument;
  /** Camera height as a share of the framing radius; higher reads the footprint better. */
  elevation?: number;
}

/** Renders each document off-screen with one shared renderer, yielding between stadiums. */
export async function renderThumbnails(
  jobs: ThumbnailJob[],
  onThumb: (id: string, canvas: HTMLCanvasElement) => void | Promise<void>,
  isCancelled: () => boolean = () => false,
  pixelRatio = Math.min(window.devicePixelRatio, 2)
) {
  if (jobs.length === 0) return;

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(THUMB_W, THUMB_H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.localClippingEnabled = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envMap = pmrem.fromScene(room, 0.04).texture;
  room.dispose();
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(36, THUMB_W / THUMB_H, 1, 2000);

  try {
    for (const job of jobs) {
      if (isCancelled()) return;
      await new Promise((r) => window.setTimeout(r, 0));

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x2a3440);
      scene.environment = envMap;
      scene.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.9));
      const sun = new THREE.DirectionalLight(0xfffbeb, 2.3);
      sun.position.set(115, 152, 92);
      scene.add(sun);

      const { rootGroup } = buildStadiumSceneGraph(job.doc, { maxAnisotropy: 2, mergeStatic: true });
      scene.add(rootGroup);

      // Frame the bowl, not the surrounding plaza, which extends far beyond the stands.
      const bowl = new THREE.Box3().setFromObject(
        rootGroup.getObjectByName('StandsAssembly') ?? rootGroup.children[1] ?? rootGroup
      );
      const bowlSize = bowl.getSize(new THREE.Vector3());
      const radius = Math.max(bowlSize.x, bowlSize.z, 120) * 0.9;
      camera.position.set(radius * 0.95, radius * (job.elevation ?? 0.62), radius * 1.05);
      camera.lookAt(0, bowlSize.y * 0.15, 0);

      renderer.render(scene, camera);
      await onThumb(job.id, renderer.domElement);

      disposeObject3D(rootGroup);
    }
  } finally {
    envMap.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/** Neutral stadium the option thumbnails vary one choice of, with the surroundings cleared. */
function optionBase(shape: StadiumShape = 'modern_bowl'): StadiumDocument {
  const doc = createPresetDocument('traditional_four_stands_42k');
  applyShape(doc, shape);
  doc.objects = [];
  doc.site = { ...doc.site, setting: 'none', entrances: false, perimeterFence: false };
  return doc;
}

/** Every shipped thumbnail, by folder. */
export function thumbnailJobs(
  shapes: StadiumShape[],
  roofs: RoofStyle[]
): Record<ThumbnailDir, ThumbnailJob[]> {
  return {
    presets: [
      { id: BLANK_PRESET_ID, doc: createBlankDocument() },
      ...STADIUM_PRESETS.map((p) => ({ id: p.id, doc: createPresetDocument(p.id) })),
    ],
    // Uncovered and seen from higher up, so the footprint of the stands is what reads.
    shapes: shapes.map((shape) => {
      const doc = optionBase(shape);
      doc.roof = { ...doc.roof, style: 'none' };
      return { id: shape, doc, elevation: 1.05 };
    }),
    roofs: roofs.map((style) => {
      const doc = optionBase();
      doc.roof = { ...doc.roof, style };
      return { id: style, doc };
    }),
    envelopes: ENVELOPE_STYLE_CATALOG.map((e) => {
      const doc = optionBase();
      doc.materials = { ...resolveStadiumMaterials(doc), envelopeStyle: e.id };
      doc.concourse = { heightRatio: 0.5, ...doc.concourse, width: Math.max(doc.concourse?.width ?? 0, 8) };
      return { id: e.id, doc, elevation: 0.42 };
    }),
  };
}

/**
 * Dev only: re-renders the shipped thumbnails at 2x and writes public/<dir>/<id>.webp through the
 * dev server (see vite.config.ts). Run `__generateThumbnails()` in the browser console after adding
 * or changing a preset, shape, roof or envelope; pass folder names to limit it.
 */
export async function generateThumbnails(
  jobsByDir: Record<ThumbnailDir, ThumbnailJob[]>,
  only?: ThumbnailDir[]
): Promise<number> {
  let written = 0;
  for (const dir of Object.keys(jobsByDir) as ThumbnailDir[]) {
    if (only && !only.includes(dir)) continue;
    await renderThumbnails(
      jobsByDir[dir],
      async (id, canvas) => {
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.86));
        if (!blob) throw new Error(`Encodage WebP impossible pour ${dir}/${id}`);
        const res = await fetch(`/__thumbnails/${dir}/${id}`, { method: 'POST', body: blob });
        if (!res.ok) throw new Error(`Écriture refusée pour ${dir}/${id} (${res.status})`);
        written++;
      },
      () => false,
      2
    );
  }
  return written;
}

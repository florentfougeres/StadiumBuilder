import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { roofDefinition } from '../stadium/roofCatalog';
import { shapeDefinition } from '../stadium/shapeCatalog';
import { ENVELOPE_STYLE_CATALOG, FACADE_PATTERN_CATALOG, resolveStadiumMaterials } from '../stadium/materials';
import { buildStadiumSceneGraph, disposeObject3D } from '../stadium/buildStadiumScene';
import { BLANK_PRESET_ID, createBlankDocument, createNeutralBaseDocument, createPresetDocument, STADIUM_PRESETS } from '../stadium/presets';
import { RoofStyle, StadiumDocument, StadiumShape } from '../stadium/schema';
import { applyShape } from '../state/useStadiumStore';

export const THUMB_W = 360;
export const THUMB_H = 220;

/** Families of pre-rendered images shipped in public/; each file is `<dir>/<id>.webp`. */
export type ThumbnailDir = 'presets' | 'shapes' | 'roofs' | 'envelopes' | 'patterns';

export function thumbnailUrl(dir: ThumbnailDir, id: string): string {
  return `${import.meta.env.BASE_URL}${dir}/${id}.webp`;
}

export interface ThumbnailJob {
  id: string;
  doc: StadiumDocument;
  /** Camera height as a share of the framing radius; higher reads the footprint better. */
  elevation?: number;
  /** Camera distance as a share of the framing radius; below 1 closes in on the facade. */
  distance?: number;
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
      const reach = radius * (job.distance ?? 1);
      camera.position.set(reach * 0.95, radius * (job.elevation ?? 0.62), reach * 1.05);
      // Closer views aim at the near facade rather than the pitch centre.
      const aim = 1 - (job.distance ?? 1);
      camera.lookAt(radius * 0.5 * aim, bowlSize.y * (0.15 + aim * 0.35), radius * 0.5 * aim);

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
  const doc = createNeutralBaseDocument();
  applyShape(doc, shape);
  doc.objects = [];
  doc.site = { ...doc.site, setting: 'none', entrances: false, perimeterFence: false };
  return doc;
}

/** A shape on its characteristic stands, uncovered, so the footprint and section are what read. */
function shapeThumbnailDoc(shape: StadiumShape): StadiumDocument {
  const doc = optionBase();
  const source = createPresetDocument(shapeDefinition(shape).thumbnailStands ?? 'concrete_portals_48k');
  doc.stands = structuredClone(source.stands);
  applyShape(doc, shape);
  doc.roof = { ...doc.roof, style: 'none' };
  if (shape === 'english_rectangular') {
    // Modular: each corner set apart, open, filled or built over.
    doc.corners = { nw: 'filled', ne: 'building', sw: 'open', se: 'filled' };
  } else if (shape === 'rounded_rectangle') {
    // Tightest bends: wider ones are clamped to the bowl's own radius and look the same.
    doc.cornerRoundness = 0;
  }
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
    shapes: shapes.map((shape) => ({
      id: shape,
      doc: shapeThumbnailDoc(shape),
      // A lower view shows the rim's slope (tilted, saddle) or the steep rake (cauldron).
      elevation: shapeDefinition(shape).thumbnailLowView ? 0.6 : 1.05,
    })),
    roofs: roofs.map((style) => {
      const doc = optionBase(roofDefinition(style).placement === 'stand' ? 'four_stands' : 'modern_bowl');
      doc.roof = { ...doc.roof, style };
      return { id: style, doc };
    }),
    envelopes: ENVELOPE_STYLE_CATALOG.map((e) => {
      const doc = optionBase();
      doc.materials = { ...resolveStadiumMaterials(doc), envelopeStyle: e.id };
      doc.concourse = { heightRatio: 0.5, ...doc.concourse, width: Math.max(doc.concourse?.width ?? 0, 8) };
      return { id: e.id, doc, elevation: 0.42 };
    }),
    // Close on a plain skin, so the relief itself is what reads.
    patterns: FACADE_PATTERN_CATALOG.map((p) => {
      const doc = optionBase();
      doc.materials = {
        ...resolveStadiumMaterials(doc),
        envelopeStyle: 'enveloping_skin',
        facadePattern: p.id,
        // A deep relief, so the pattern reads at tile size.
        facadeDepth: 1.6,
      };
      doc.concourse = { heightRatio: 0.5, ...doc.concourse, width: Math.max(doc.concourse?.width ?? 0, 8) };
      return { id: p.id, doc, elevation: 0.24, distance: 0.72 };
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

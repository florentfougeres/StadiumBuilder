import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { X } from 'lucide-react';
import { buildStadiumSceneGraph, disposeObject3D } from '../stadium/buildStadiumScene';
import { calculateStadiumMetrics } from '../stadium/capacity';
import { createPresetDocument, STADIUM_PRESETS } from '../stadium/presets';
import { useStadiumStore } from '../state/useStadiumStore';
import { Button, IconButton } from './ui';

const SEEN_KEY = 'sf-onboarding-seen';
const THUMB_W = 360;
const THUMB_H = 220;

/** Live-rendered fallbacks, kept per page load for presets that have no shipped image. */
const thumbnailCache = new Map<string, string>();

/** Pre-rendered gallery image shipped in public/presets; regenerate with `generatePresetThumbnails`. */
function presetThumbnailUrl(id: string): string {
  return `${import.meta.env.BASE_URL}presets/${id}.webp`;
}

function hasSeenOnboarding(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markOnboardingSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Private mode or blocked storage: the dialog simply shows again next visit.
  }
}

/** Renders each preset off-screen with one shared renderer, yielding between stadiums. */
async function renderThumbnails(
  ids: string[],
  onThumb: (id: string, canvas: HTMLCanvasElement) => void | Promise<void>,
  isCancelled: () => boolean,
  pixelRatio = Math.min(window.devicePixelRatio, 2)
) {
  if (ids.length === 0) return;

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
    for (const id of ids) {
      if (isCancelled()) return;
      await new Promise((r) => window.setTimeout(r, 0));

      const doc = createPresetDocument(id);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x2a3440);
      scene.environment = envMap;
      scene.add(new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.9));
      const sun = new THREE.DirectionalLight(0xfffbeb, 2.3);
      sun.position.set(115, 152, 92);
      scene.add(sun);

      const { rootGroup } = buildStadiumSceneGraph(doc, { maxAnisotropy: 2 });
      scene.add(rootGroup);

      // Frame the bowl, not the surrounding plaza, which extends far beyond the stands.
      const bowl = new THREE.Box3().setFromObject(rootGroup.getObjectByName('StandsAssembly') ?? rootGroup.children[1] ?? rootGroup);
      const bowlSize = bowl.getSize(new THREE.Vector3());
      const radius = Math.max(bowlSize.x, bowlSize.z, 120) * 0.9;
      camera.position.set(radius * 0.95, radius * 0.62, radius * 1.05);
      camera.lookAt(0, bowlSize.y * 0.15, 0);

      renderer.render(scene, camera);
      await onThumb(id, renderer.domElement);

      disposeObject3D(rootGroup);
    }
  } finally {
    envMap.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

/**
 * Dev only: re-renders every preset at 2x and writes public/presets/<id>.webp through the dev
 * server (see vite.config.ts). Run `__generatePresetThumbnails()` in the browser console after
 * adding or changing a preset.
 */
async function generatePresetThumbnails(): Promise<string[]> {
  const written: string[] = [];
  await renderThumbnails(
    STADIUM_PRESETS.map((p) => p.id),
    async (id, canvas) => {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.86));
      if (!blob) throw new Error(`Encodage WebP impossible pour ${id}`);
      const res = await fetch(`/__preset-thumbnails/${id}`, { method: 'POST', body: blob });
      if (!res.ok) throw new Error(`Écriture refusée pour ${id} (${res.status})`);
      written.push(id);
    },
    () => false,
    2
  );
  return written;
}
if (import.meta.env.DEV) {
  (window as unknown as { __generatePresetThumbnails: typeof generatePresetThumbnails }).__generatePresetThumbnails =
    generatePresetThumbnails;
}

export const OnboardingDialog: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const loadPreset = useStadiumStore((s) => s.loadPreset);
  const currentPresetId = useStadiumStore((s) => s.doc.presetId);
  const [thumbs, setThumbs] = useState<Record<string, string>>(() =>
    Object.fromEntries(STADIUM_PRESETS.map((p) => [p.id, thumbnailCache.get(p.id) ?? presetThumbnailUrl(p.id)]))
  );
  // Presets whose shipped image failed to load; they get a live render instead.
  const [missing, setMissing] = useState<string[]>([]);

  const examples = useMemo(
    () =>
      STADIUM_PRESETS.map((p) => ({
        ...p,
        capacity: calculateStadiumMetrics(createPresetDocument(p.id)).totalCapacity,
      })),
    []
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open || missing.length === 0) return;
    let cancelled = false;
    // Debounced so the misses of one opening are rendered in a single batch.
    const timer = window.setTimeout(() => {
      renderThumbnails(
        missing.filter((id) => !thumbnailCache.has(id)),
        (id, canvas) => {
          const url = canvas.toDataURL('image/jpeg', 0.82);
          thumbnailCache.set(id, url);
          setThumbs((prev) => ({ ...prev, [id]: url }));
        },
        () => cancelled
      ).catch(() => {
        // No WebGL for thumbnails: cards keep their placeholder face.
      });
    }, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, missing]);

  const close = () => {
    markOnboardingSeen();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="onboarding-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) close();
      }}
      className="m-auto w-[min(1040px,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] p-0 rounded-lg bg-panel text-ink border border-line shadow-[0_24px_64px_rgb(0_0_0/0.55)] backdrop:bg-black/60"
    >
      <div className="flex flex-col max-h-[calc(100dvh-2rem)]">
        <header className="flex items-start gap-4 px-6 pt-5 pb-4 border-b border-line">
          <div className="flex-1">
            <h2 id="onboarding-title" className="text-base font-semibold text-ink">
              Choisis un stade pour commencer
            </h2>
            <p className="mt-1 text-xs text-ink-muted max-w-[60ch]">
              Chaque exemple est entièrement modifiable : forme, tribunes, toit, matériaux, équipements.
              Pars de celui qui ressemble le plus à ton idée.
            </p>
          </div>
          <IconButton label="Fermer" onClick={close}>
            <X className="w-4 h-4" />
          </IconButton>
        </header>

        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-6 overflow-y-auto">
          {examples.map((ex) => {
            const current = ex.id === currentPresetId;
            return (
              <li key={ex.id}>
                <button
                  type="button"
                  onClick={() => {
                    loadPreset(ex.id);
                    close();
                  }}
                  className={`group block w-full text-left rounded-md overflow-hidden border transition-colors duration-100 ${
                    current ? 'border-accent' : 'border-line hover:border-line-strong'
                  }`}
                >
                  <div className="relative aspect-[36/22] bg-canvas">
                    {thumbs[ex.id] ? (
                      <img
                        src={thumbs[ex.id]}
                        alt=""
                        width={THUMB_W}
                        height={THUMB_H}
                        loading="lazy"
                        decoding="async"
                        onError={() => {
                          setThumbs((prev) => ({ ...prev, [ex.id]: '' }));
                          setMissing((prev) => (prev.includes(ex.id) ? prev : [...prev, ex.id]));
                        }}
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="absolute inset-0 animate-pulse bg-raised/50" aria-hidden />
                    )}
                  </div>
                  <div className="px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-medium text-ink truncate">{ex.label}</span>
                      <span className="text-2xs text-ink-faint tabular-nums whitespace-nowrap">
                        {ex.capacity.toLocaleString('fr-FR')} pl.
                      </span>
                    </div>
                    <p className="mt-0.5 text-2xs text-ink-muted line-clamp-2">{ex.subtitle}</p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <footer className="flex items-center justify-between gap-3 px-6 py-3 border-t border-line">
          <span className="text-2xs text-ink-faint">Tu retrouves cette fenêtre via « Exemples » en haut.</span>
          <Button onClick={close}>Continuer avec le projet actuel</Button>
        </footer>
      </div>
    </dialog>
  );
};

export function shouldShowOnboardingOnStart(): boolean {
  return !hasSeenOnboarding();
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FilePlus2, X } from 'lucide-react';
import { calculateStadiumMetrics } from '../stadium/capacity';
import { BLANK_PRESET_ID, createBlankDocument, createPresetDocument, STADIUM_PRESETS } from '../stadium/presets';
import { useStadiumStore } from '../state/useStadiumStore';
import { renderThumbnails, THUMB_H, THUMB_W, thumbnailUrl } from './thumbnails';
import { Button, IconButton } from './ui';

const SEEN_KEY = 'sf-onboarding-seen';

/** Live-rendered fallbacks, kept per page load for presets that have no shipped image. */
const thumbnailCache = new Map<string, string>();

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

export const OnboardingDialog: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const loadPreset = useStadiumStore((s) => s.loadPreset);
  const newBlankProject = useStadiumStore((s) => s.newBlankProject);
  const [blankThumbFailed, setBlankThumbFailed] = useState(false);
  const blankCapacity = useMemo(() => calculateStadiumMetrics(createBlankDocument()).totalCapacity, []);
  const currentPresetId = useStadiumStore((s) => s.doc.presetId);
  const [thumbs, setThumbs] = useState<Record<string, string>>(() =>
    Object.fromEntries(STADIUM_PRESETS.map((p) => [p.id, thumbnailCache.get(p.id) ?? thumbnailUrl('presets', p.id)]))
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
        missing
          .filter((id) => !thumbnailCache.has(id))
          .map((id) => ({ id, doc: createPresetDocument(id) })),
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
              Comment veux-tu commencer ?
            </h2>
            <p className="mt-1 text-xs text-ink-muted max-w-[60ch]">
              Pars de rien et construis ton stade pièce par pièce, ou choisis l’exemple qui ressemble le plus
              à ton idée : tout reste modifiable (forme, tribunes, toit, matériaux, équipements).
            </p>
          </div>
          <IconButton label="Fermer" onClick={close}>
            <X className="w-4 h-4" />
          </IconButton>
        </header>

        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-6 overflow-y-auto">
          <li>
            <button
              type="button"
              onClick={() => {
                newBlankProject();
                close();
              }}
              className={`group block w-full h-full text-left rounded-md overflow-hidden border transition-colors duration-100 ${
                currentPresetId === BLANK_PRESET_ID ? 'border-accent' : 'border-line hover:border-line-strong'
              }`}
            >
              <div className="relative aspect-[36/22] bg-canvas">
                {blankThumbFailed ? (
                  <FilePlus2 aria-hidden className="absolute inset-0 m-auto w-8 h-8 text-ink-faint" />
                ) : (
                  <img
                    src={thumbnailUrl('presets', BLANK_PRESET_ID)}
                    alt=""
                    width={THUMB_W}
                    height={THUMB_H}
                    decoding="async"
                    onError={() => setBlankThumbFailed(true)}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                  />
                )}
              </div>
              <div className="px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-ink">Partir de rien</span>
                  <span className="text-2xs text-ink-faint tabular-nums whitespace-nowrap">
                    {blankCapacity.toLocaleString('fr-FR')} pl.
                  </span>
                </div>
                <p className="mt-0.5 text-2xs text-ink-muted">
                  Quatre petites tribunes autour du terrain, sans toit ni équipements : tu construis tout.
                </p>
              </div>
            </button>
          </li>
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

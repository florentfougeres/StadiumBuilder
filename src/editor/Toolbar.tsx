import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Camera,
  ChevronDown,
  Contrast,
  Eye,
  FileDown,
  Grid2x2,
  ImageDown,
  Layers,
  Moon,
  Move,
  PanelsTopLeft,
  Redo2,
  RotateCw,
  Scaling,
  Sparkles,
  Sun,
  Sunset,
  Undo2,
  Video,
} from 'lucide-react';
import { exportStadiumGlb } from '../export/exportGlb';
import { exportArchitecturalPlanPdf } from '../export/exportPlan';
import { exportPathTracedPng, exportViewportPng } from '../export/exportPng';
import { CameraPresetMode, LightingMode, TransformMode } from '../stadium/schema';
import { useStadiumStore } from '../state/useStadiumStore';
import { ProjectsMenu } from './ProjectsPanel';
import { useTheme } from './theme';
import { Button, IconButton, Segmented } from './ui';

const CAMERA_MODES: { id: CameraPresetMode; label: string; icon: React.ReactNode; hint?: string }[] = [
  {
    id: 'drone',
    label: 'Drone',
    icon: <Video className="w-3.5 h-3.5" />,
    hint: 'Drone · molette : zoom vers le curseur · double-clic : centrer sur un point · flèches : se déplacer (Maj plus vite, Page haut/bas : altitude)',
  },
  { id: 'touchline', label: 'Bord terrain', icon: <Camera className="w-3.5 h-3.5" /> },
  { id: 'spectator', label: 'Vue siège', icon: <Eye className="w-3.5 h-3.5" /> },
  { id: 'cross_section', label: 'Coupe', icon: <Layers className="w-3.5 h-3.5" /> },
  { id: 'plan2d', label: 'Plan', icon: <Grid2x2 className="w-3.5 h-3.5" /> },
];

const LIGHTING_MODES: { id: LightingMode; label: string; icon: React.ReactNode }[] = [
  { id: 'day', label: 'Jour', icon: <Sun className="w-3.5 h-3.5" /> },
  { id: 'dusk', label: 'Crépuscule', icon: <Sunset className="w-3.5 h-3.5" /> },
  { id: 'night', label: 'Nuit', icon: <Moon className="w-3.5 h-3.5" /> },
];

const TRANSFORM_MODES: { id: TransformMode; label: string; icon: React.ReactNode }[] = [
  { id: 'translate', label: 'Déplacer (G)', icon: <Move className="w-3.5 h-3.5" /> },
  { id: 'rotate', label: 'Tourner (R)', icon: <RotateCw className="w-3.5 h-3.5" /> },
  { id: 'scale', label: 'Échelle (S)', icon: <Scaling className="w-3.5 h-3.5" /> },
];

function formatSavedAt(ts: number | null): string {
  if (!ts) return 'Non enregistré';
  const time = new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `Enregistré à ${time}`;
}

const ExportMenu: React.FC<{ onStatus: (msg: string) => void }> = ({ onStatus }) => {
  const doc = useStadiumStore((s) => s.doc);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = async (action: () => void | Promise<void>, success: string, failure: string) => {
    setOpen(false);
    setBusy(true);
    try {
      await action();
      onStatus(success);
    } catch {
      onStatus(failure);
    } finally {
      setBusy(false);
    }
  };

  const items: { label: string; detail: string; icon: React.ReactNode; onSelect: () => void }[] = [
    {
      label: 'Image PNG',
      detail: 'Vue actuelle',
      icon: <ImageDown className="w-3.5 h-3.5" />,
      onSelect: () =>
        run(
          () => {
            if (!exportViewportPng(doc.name)) throw new Error('png');
          },
          'Image PNG téléchargée',
          'Capture impossible : la vue 3D n’est pas prête'
        ),
    },
    {
      label: 'Image photoréaliste',
      detail: 'Lancer de rayons, 1 à 2 min',
      icon: <Sparkles className="w-3.5 h-3.5" />,
      onSelect: () =>
        run(
          async () => {
            setProgress(0);
            try {
              if (!(await exportPathTracedPng(doc.name, setProgress))) throw new Error('trace');
            } finally {
              setProgress(null);
            }
          },
          'Image photoréaliste téléchargée',
          'Rendu photoréaliste interrompu par la carte graphique (WebGL 2 requis)'
        ),
    },
    {
      label: 'Plan PDF',
      detail: 'A4, cotes et capacité',
      icon: <FileDown className="w-3.5 h-3.5" />,
      onSelect: () => run(() => exportArchitecturalPlanPdf(doc), 'Plan PDF téléchargé', 'Échec du plan PDF'),
    },
    {
      label: 'Modèle 3D GLB',
      detail: 'Pour Blender, SketchUp…',
      icon: <Box className="w-3.5 h-3.5" />,
      onSelect: () => run(() => exportStadiumGlb(doc), 'Modèle GLB téléchargé', 'Échec de l’export GLB'),
    },
  ];

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="primary"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        {progress !== null
          ? `Rendu ${Math.round(progress * 100)} %`
          : busy
          ? 'Export…'
          : 'Exporter'}
        <ChevronDown aria-hidden className="w-3.5 h-3.5 -mr-0.5" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-80 p-1 rounded-md bg-panel border border-line shadow-[0_8px_24px_rgb(0_0_0/0.45)] z-50"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={item.onSelect}
              className="flex items-center gap-2.5 w-full h-9 px-2 rounded text-left hover:bg-accent-strong group"
            >
              <span className="text-ink-muted group-hover:text-white">{item.icon}</span>
              <span className="flex-1 text-xs text-ink whitespace-nowrap group-hover:text-white">{item.label}</span>
              <span className="text-2xs text-ink-faint whitespace-nowrap group-hover:text-white/80">{item.detail}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** Lighting switch; lives in the top bar from md up and in the side panel below. Named from xl. */
export const LightingControl: React.FC = () => {
  const lighting = useStadiumStore((s) => s.doc.lighting);
  const setLighting = useStadiumStore((s) => s.setLighting);
  return (
    <Segmented
      nowrap
      label="Éclairage"
      value={lighting}
      onChange={setLighting}
      options={LIGHTING_MODES.map((m) => ({
        id: m.id,
        title: m.label,
        label: (
          <>
            {m.icon}
            <span className="hidden xl:inline">{m.label}</span>
          </>
        ),
      }))}
    />
  );
};

export const Toolbar: React.FC = () => {
  const docName = useStadiumStore((s) => s.doc.name);
  const setProjectName = useStadiumStore((s) => s.setProjectName);
  const lastSavedAt = useStadiumStore((s) => s.lastSavedAt);
  const cameraMode = useStadiumStore((s) => s.cameraMode);
  const setCameraMode = useStadiumStore((s) => s.setCameraMode);
  const transformMode = useStadiumStore((s) => s.transformMode);
  const setTransformMode = useStadiumStore((s) => s.setTransformMode);
  const selectedObjectId = useStadiumStore((s) => s.selectedObjectId);
  const panelsHidden = useStadiumStore((s) => s.dockCollapsed);
  const togglePanels = useStadiumStore((s) => s.toggleDockCollapsed);
  const canUndo = useStadiumStore((s) => s.history.past.length > 0);
  const canRedo = useStadiumStore((s) => s.history.future.length > 0);
  const undo = useStadiumStore((s) => s.undo);
  const redo = useStadiumStore((s) => s.redo);
  const [theme, toggleTheme] = useTheme();

  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!status) return;
    const t = window.setTimeout(() => setStatus(null), 3200);
    return () => window.clearTimeout(t);
  }, [status]);

  return (
    <header className="flex justify-between lg:grid lg:grid-cols-[1fr_auto_1fr] items-center gap-2 lg:gap-3 h-11 px-2 bg-panel border-b border-line shrink-0 z-30">
      <div className="hidden sm:flex items-center gap-1 min-w-0">
        {/* The wordmark yields its room to the project name until the bar is wide enough for both. */}
        <span className="hidden 2xl:inline px-2 text-sm font-semibold text-ink whitespace-nowrap">StadiumForge</span>
        <span aria-hidden className="hidden 2xl:block w-px h-4 bg-line-strong" />
        <input
          aria-label="Nom du projet"
          value={docName}
          onChange={(e) => setProjectName(e.target.value)}
          className="min-w-0 w-48 2xl:w-56 h-7 px-2 text-xs text-ink bg-transparent rounded border border-transparent hover:border-edge-hover focus:border-accent focus:bg-field outline-none text-ellipsis"
        />
        <ProjectsMenu onStatus={setStatus} />
        <span className="hidden 2xl:inline text-2xs text-ink-faint whitespace-nowrap" aria-live="polite">
          {status ?? formatSavedAt(lastSavedAt)}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Segmented
          nowrap
          label="Caméra"
          value={cameraMode}
          onChange={setCameraMode}
          options={CAMERA_MODES.map((m) => ({
            id: m.id,
            title: m.hint ?? m.label,
            label: (
              <>
                {m.icon}
                <span className="hidden xl:inline">{m.label}</span>
              </>
            ),
          }))}
        />
        <div className="hidden md:block">
          <LightingControl />
        </div>
        {selectedObjectId && (
          <Segmented
            nowrap
            label="Outil de transformation"
            value={transformMode}
            onChange={setTransformMode}
            options={TRANSFORM_MODES.map((m) => ({ id: m.id, title: m.label, label: m.icon }))}
          />
        )}
      </div>

      <div className="flex items-center justify-end gap-1">
        <IconButton label="Annuler (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
          <Undo2 className="w-4 h-4" />
        </IconButton>
        <IconButton label="Rétablir (Ctrl+Y)" onClick={redo} disabled={!canRedo}>
          <Redo2 className="w-4 h-4" />
        </IconButton>
        <IconButton
          label={panelsHidden ? 'Afficher les panneaux (H)' : 'Masquer les panneaux (H)'}
          active={panelsHidden}
          onClick={togglePanels}
        >
          <PanelsTopLeft className="w-4 h-4" />
        </IconButton>
        <IconButton
          label={theme === 'light' ? 'Passer au thème sombre' : 'Passer au thème clair'}
          onClick={toggleTheme}
          className="max-sm:hidden"
        >
          <Contrast className="w-4 h-4" />
        </IconButton>
        <span aria-hidden className="max-sm:hidden w-px h-4 mx-1 bg-line-strong" />
        <ExportMenu onStatus={setStatus} />
      </div>
    </header>
  );
};

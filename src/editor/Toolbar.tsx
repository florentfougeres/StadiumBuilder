import React from 'react';
import {
  Camera,
  Eye,
  Grid2x2,
  Layers,
  Moon,
  Move,
  Redo2,
  RotateCw,
  Scaling,
  Sun,
  Sunset,
  Undo2,
  Video,
} from 'lucide-react';
import { CameraPresetMode, LightingMode, TransformMode } from '../stadium/schema';
import { useStadiumStore } from '../state/useStadiumStore';

const CAMERA_MODES: { id: CameraPresetMode; label: string; icon: React.ReactNode }[] = [
  { id: 'drone', label: 'Drone', icon: <Video className="w-3.5 h-3.5" /> },
  { id: 'touchline', label: 'Bord terrain', icon: <Camera className="w-3.5 h-3.5" /> },
  { id: 'spectator', label: 'Vue siège', icon: <Eye className="w-3.5 h-3.5" /> },
  { id: 'cross_section', label: 'Coupe 3D', icon: <Layers className="w-3.5 h-3.5" /> },
  { id: 'plan2d', label: 'Plan 2D', icon: <Grid2x2 className="w-3.5 h-3.5" /> },
];

const TRANSFORM_MODES: {
  id: TransformMode;
  label: string;
  shortcut: string;
  icon: React.ReactNode;
}[] = [
  { id: 'translate', label: 'Déplacer', shortcut: 'G', icon: <Move className="w-3.5 h-3.5" /> },
  { id: 'rotate', label: 'Tourner', shortcut: 'R', icon: <RotateCw className="w-3.5 h-3.5" /> },
  { id: 'scale', label: 'Échelle', shortcut: 'S', icon: <Scaling className="w-3.5 h-3.5" /> },
];

const LIGHTING_MODES: { id: LightingMode; label: string; icon: React.ReactNode }[] = [
  { id: 'day', label: 'Jour', icon: <Sun className="w-3.5 h-3.5" /> },
  { id: 'dusk', label: 'Crépuscule', icon: <Sunset className="w-3.5 h-3.5" /> },
  { id: 'night', label: 'Match Nuit', icon: <Moon className="w-3.5 h-3.5" /> },
];

export const Toolbar: React.FC = () => {
  const cameraMode = useStadiumStore((s) => s.cameraMode);
  const setCameraMode = useStadiumStore((s) => s.setCameraMode);
  const transformMode = useStadiumStore((s) => s.transformMode);
  const setTransformMode = useStadiumStore((s) => s.setTransformMode);
  const selectedObjectId = useStadiumStore((s) => s.selectedObjectId);
  const lighting = useStadiumStore((s) => s.doc.lighting);
  const setLighting = useStadiumStore((s) => s.setLighting);

  const canUndo = useStadiumStore((s) => s.history.past.length > 0);
  const canRedo = useStadiumStore((s) => s.history.future.length > 0);
  const undo = useStadiumStore((s) => s.undo);
  const redo = useStadiumStore((s) => s.redo);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-slate-800">
      {/* Camera Presets */}
      <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
        {CAMERA_MODES.map((m) => {
          const active = cameraMode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setCameraMode(m.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
              }`}
            >
              {m.icon}
              <span>{m.label}</span>
            </button>
          );
        })}
      </div>

      {/* Gizmo Transform Modes + Lighting + Undo/Redo */}
      <div className="flex items-center gap-2">
        <div
          className={`flex items-center gap-1 bg-slate-950 p-1 rounded-lg border ${
            selectedObjectId ? 'border-emerald-500/40' : 'border-slate-800'
          }`}
        >
          {TRANSFORM_MODES.map((tm) => {
            const active = transformMode === tm.id;
            return (
              <button
                key={tm.id}
                type="button"
                onClick={() => setTransformMode(tm.id)}
                title={`${tm.label} (${tm.shortcut})`}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-slate-800 text-emerald-400'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {tm.icon}
                <span className="hidden sm:inline">{tm.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          {LIGHTING_MODES.map((lm) => {
            const active = lighting === lm.id;
            return (
              <button
                key={lm.id}
                type="button"
                onClick={() => setLighting(lm.id)}
                title={lm.label}
                className={`flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-slate-800 text-amber-300'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {lm.icon}
                <span className="hidden md:inline">{lm.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            title="Annuler (Ctrl+Z)"
            className="p-1.5 text-xs rounded-md text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 disabled:pointer-events-none transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            title="Rétablir (Ctrl+Y)"
            className="p-1.5 text-xs rounded-md text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 disabled:pointer-events-none transition-colors"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

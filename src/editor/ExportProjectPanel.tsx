import React, { useRef, useState } from 'react';
import {
  Box,
  Check,
  FileCode2,
  FileDown,
  FolderOpen,
  ImageDown,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  exportStadiumGlb,
  exportStadiumJson,
  parseImportedStadiumJson,
} from '../export/exportGlb';
import { exportArchitecturalPlanPdf } from '../export/exportPlan';
import { exportViewportPng } from '../export/exportPng';
import { STADIUM_PRESETS } from '../stadium/presets';
import { useStadiumStore } from '../state/useStadiumStore';

interface ExportProjectPanelProps {
  layout?: 'sidebar' | 'dock';
}

export const ExportProjectPanel: React.FC<ExportProjectPanelProps> = ({
  layout = 'sidebar',
}) => {
  const doc = useStadiumStore((s) => s.doc);
  const savedProjects = useStadiumStore((s) => s.savedProjects);
  const loadPreset = useStadiumStore((s) => s.loadPreset);
  const loadDocument = useStadiumStore((s) => s.loadDocument);
  const setProjectName = useStadiumStore((s) => s.setProjectName);
  const saveCurrentNow = useStadiumStore((s) => s.saveCurrentNow);
  const deleteSavedProject = useStadiumStore((s) => s.deleteSavedProject);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [exportingGlb, setExportingGlb] = useState(false);

  const isSidebar = layout === 'sidebar';

  const notify = (msg: string) => {
    setStatusMsg(msg);
    window.setTimeout(() => setStatusMsg(null), 3200);
  };

  const handleGlbExport = async () => {
    setExportingGlb(true);
    try {
      await exportStadiumGlb(doc);
      notify('Modèle 3D .glb exporté avec succès');
    } catch {
      notify('Erreur lors de la génération GLB');
    } finally {
      setExportingGlb(false);
    }
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseImportedStadiumJson(file);
      loadDocument(parsed);
      notify(`Projet « ${parsed.name} » chargé`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Fichier JSON non reconnu');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div
      className={
        isSidebar
          ? 'space-y-5'
          : 'grid grid-cols-1 lg:grid-cols-12 gap-5 items-start'
      }
    >
      {/* Presets Selection */}
      <div className={isSidebar ? 'space-y-2' : 'lg:col-span-5 space-y-2'}>
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-200">Templates architecturaux</span>
          <span className="text-slate-400">{STADIUM_PRESETS.length} configurations</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto custom-scrollbar pr-0.5">
          {STADIUM_PRESETS.map((preset) => {
            const active = doc.presetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  loadPreset(preset.id);
                  notify(`Template « ${preset.label} » appliqué`);
                }}
                className={`p-2 rounded-lg border text-left transition-colors ${
                  active
                    ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-100'
                    : 'bg-slate-950 border-slate-800 text-slate-200 hover:bg-slate-800/80'
                }`}
              >
                <div className="text-[11px] font-semibold truncate">{preset.label}</div>
                <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">
                  {preset.subtitle}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Exports Suite: PNG, PDF Plan, GLB, JSON */}
      <div
        className={
          isSidebar
            ? 'space-y-2.5 pt-4 border-t border-slate-800'
            : 'lg:col-span-4 space-y-2'
        }
      >
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-200">Livrables & Exports CAO</span>
          {statusMsg && (
            <span className="flex items-center gap-1 text-emerald-400 font-medium">
              <Check className="w-3.5 h-3.5" />
              {statusMsg}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={doc.name}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Nom du stade"
            className="flex-1 px-2.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-emerald-500"
          />
          <button
            type="button"
            onClick={async () => {
              await saveCurrentNow();
              notify('Sauvegardé');
            }}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Sauver</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              const ok = exportViewportPng(doc.name);
              if (ok) notify('Capture PNG téléchargée');
            }}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            <ImageDown className="w-3.5 h-3.5 text-emerald-400" />
            <span>Image PNG</span>
          </button>

          <button
            type="button"
            onClick={() => {
              exportArchitecturalPlanPdf(doc);
              notify('Plan PDF A4 généré');
            }}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-100 transition-colors whitespace-nowrap shrink-0"
          >
            <FileDown className="w-3.5 h-3.5 text-sky-400" />
            <span>Plan 2D PDF</span>
          </button>

          <button
            type="button"
            disabled={exportingGlb}
            onClick={handleGlbExport}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-100 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Box className="w-3.5 h-3.5 text-amber-400" />
            <span>{exportingGlb ? 'Export GLB…' : 'Modèle .GLB'}</span>
          </button>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                exportStadiumJson(doc);
                notify('Projet JSON téléchargé');
              }}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-2.5 text-xs font-medium bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              <FileCode2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>JSON</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Ouvrir un projet JSON"
              className="px-2.5 py-2.5 text-xs font-medium bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-200 transition-colors shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImportJson}
              className="hidden"
            />
          </div>
        </div>
      </div>

      {/* Local IndexedDB Saved Projects */}
      <div
        className={
          isSidebar
            ? 'space-y-2 pt-4 border-t border-slate-800'
            : 'lg:col-span-3 space-y-2'
        }
      >
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="font-semibold text-slate-200">Projets locaux (IndexedDB)</span>
          <span>Autosave actif</span>
        </div>
        <div className={isSidebar ? 'space-y-1.5' : 'max-h-28 overflow-y-auto custom-scrollbar space-y-1 pr-1'}>
          {savedProjects.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">Aucun projet enregistré.</p>
          ) : (
            savedProjects.map((proj) => {
              const isCurrent = proj.id === doc.id;
              return (
                <div
                  key={proj.id}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs border ${
                    isCurrent
                      ? 'bg-slate-800/90 border-emerald-500/40 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => loadDocument(proj.document)}
                    className="flex items-center gap-2 truncate text-left flex-1"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="truncate">{proj.name}</span>
                  </button>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="font-mono tabular-nums text-[11px] text-slate-400">
                      {Math.round(proj.capacity / 1000)}k pl.
                    </span>
                    {!isCurrent && (
                      <button
                        type="button"
                        onClick={() => deleteSavedProject(proj.id)}
                        className="text-slate-500 hover:text-rose-400"
                        title="Supprimer la sauvegarde"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Copy, FileDown, FilePlus2, FolderOpen, LayoutGrid, Trash2, Upload } from 'lucide-react';
import { exportStadiumJson, parseImportedStadiumJson } from '../export/exportGlb';
import { STADIUM_PRESETS } from '../stadium/presets';
import { useStadiumStore } from '../state/useStadiumStore';
import { Button, IconButton } from './ui';

const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** "14:05" today, "3 nov." before. */
function formatUpdated(ts: number): string {
  const d = new Date(ts);
  return d.toDateString() === new Date().toDateString() ? timeFormat.format(d) : dayFormat.format(d);
}

const MenuItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  detail?: string;
  onSelect: () => void;
}> = ({ icon, label, detail, onSelect }) => (
  <button
    type="button"
    role="menuitem"
    onClick={onSelect}
    className="flex items-center gap-2.5 w-full min-h-9 px-2 py-1.5 rounded text-left hover:bg-accent-strong group"
  >
    <span className="text-ink-muted group-hover:text-white">{icon}</span>
    <span className="flex-1 text-xs text-ink group-hover:text-white">{label}</span>
    {detail && <span className="text-2xs text-ink-faint whitespace-nowrap group-hover:text-white/80">{detail}</span>}
  </button>
);

/**
 * Top-bar Projets menu: start a project (blank, from an example, from a file), copy or download
 * the open one, and switch between the projects kept in this browser.
 */
export const ProjectsMenu: React.FC<{ onStatus: (msg: string) => void }> = ({ onStatus }) => {
  const doc = useStadiumStore((s) => s.doc);
  const savedProjects = useStadiumStore((s) => s.savedProjects);
  const setExamplesOpen = useStadiumStore((s) => s.setExamplesOpen);
  const newBlankProject = useStadiumStore((s) => s.newBlankProject);
  const loadDocument = useStadiumStore((s) => s.loadDocument);
  const importDocument = useStadiumStore((s) => s.importDocument);
  const duplicateProject = useStadiumStore((s) => s.duplicateProject);
  const deleteSavedProject = useStadiumStore((s) => s.deleteSavedProject);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const act = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseImportedStadiumJson(file);
      importDocument(parsed);
      onStatus(`« ${parsed.name} » ouvert`);
    } catch (err) {
      onStatus(err instanceof Error ? err.message : 'Fichier projet non reconnu');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="max-lg:px-1.5"
      >
        <FolderOpen aria-hidden className="w-4 h-4" />
        <span className="max-lg:sr-only">Projets</span>
        <ChevronDown aria-hidden className="w-3.5 h-3.5 -mr-0.5 max-lg:hidden" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1.5 w-80 p-1 rounded-md bg-panel border border-line shadow-[0_8px_24px_rgb(0_0_0/0.45)] z-50"
        >
          <MenuItem
            icon={<FilePlus2 className="w-3.5 h-3.5" />}
            label="Nouveau stade vierge"
            detail="Petit, sans toit"
            onSelect={act(() => {
              newBlankProject();
              onStatus('Nouveau stade créé');
            })}
          />
          <MenuItem
            icon={<LayoutGrid className="w-3.5 h-3.5" />}
            label="Partir d’un exemple…"
            detail={`${STADIUM_PRESETS.length} modèles`}
            onSelect={act(() => setExamplesOpen(true))}
          />
          <MenuItem
            icon={<Upload className="w-3.5 h-3.5" />}
            label="Ouvrir un fichier projet…"
            detail=".json"
            onSelect={act(() => fileInputRef.current?.click())}
          />
          <div className="my-1 border-t border-line" />
          <MenuItem
            icon={<Copy className="w-3.5 h-3.5" />}
            label="Dupliquer ce projet"
            onSelect={act(() => {
              duplicateProject();
              onStatus('Copie créée');
            })}
          />
          <MenuItem
            icon={<FileDown className="w-3.5 h-3.5" />}
            label="Télécharger le fichier projet"
            detail=".json"
            onSelect={act(() => {
              exportStadiumJson(doc);
              onStatus('Fichier projet téléchargé');
            })}
          />
          <div className="my-1 border-t border-line" />
          <div className="px-2 pt-1.5 pb-1">
            <div className="text-2xs font-medium text-ink-faint">Mes projets ({savedProjects.length})</div>
            <div className="text-2xs text-ink-faint">Enregistrés automatiquement dans ce navigateur</div>
          </div>
          <ul className="grid gap-px max-h-72 overflow-y-auto">
            {savedProjects.map((proj) => {
              const current = proj.id === doc.id;
              return (
                <li
                  key={proj.id}
                  className={`group flex items-center gap-1 min-h-9 pl-2 pr-1 rounded ${
                    current ? 'bg-accent-soft' : 'hover:bg-hover'
                  }`}
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled={current}
                    onClick={act(() => loadDocument(proj.document))}
                    className="flex-1 min-w-0 py-1.5 text-left"
                  >
                    <span className={`block text-xs leading-snug text-ink ${current ? 'font-medium' : ''}`}>
                      {proj.name}
                    </span>
                    <span className="block text-2xs text-ink-faint tabular-nums">
                      {proj.capacity.toLocaleString('fr-FR')} places · {formatUpdated(proj.updatedAt)}
                    </span>
                  </button>
                  {current ? (
                    <span className="px-2 text-2xs text-accent-ink">Ouvert</span>
                  ) : (
                    <IconButton
                      label={`Supprimer « ${proj.name} »`}
                      onClick={() => {
                        if (window.confirm(`Supprimer définitivement « ${proj.name} » de ce navigateur ?`)) {
                          void deleteSavedProject(proj.id);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </IconButton>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleImport}
        className="hidden"
      />
    </div>
  );
};

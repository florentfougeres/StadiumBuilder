import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, FolderOpen, LayoutGrid, Trash2 } from 'lucide-react';
import { useStadiumStore } from '../state/useStadiumStore';
import { Button, IconButton } from './ui';

/** Top-bar menu for the projects saved in this browser and the example gallery. */
export const ProjectsMenu: React.FC = () => {
  const doc = useStadiumStore((s) => s.doc);
  const savedProjects = useStadiumStore((s) => s.savedProjects);
  const setExamplesOpen = useStadiumStore((s) => s.setExamplesOpen);
  const loadDocument = useStadiumStore((s) => s.loadDocument);
  const saveCurrentNow = useStadiumStore((s) => s.saveCurrentNow);
  const deleteSavedProject = useStadiumStore((s) => s.deleteSavedProject);
  const [open, setOpen] = useState(false);
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

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="Mes projets et exemples"
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
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setExamplesOpen(true);
            }}
            className="flex items-center gap-2.5 w-full h-9 px-2 rounded text-left hover:bg-accent-strong group"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-ink-muted group-hover:text-white" />
            <span className="flex-1 text-xs text-ink group-hover:text-white">Partir d’un exemple…</span>
            <span className="text-2xs text-ink-faint group-hover:text-white/80">Galerie</span>
          </button>
          <div className="my-1 border-t border-line" />
          <div className="flex items-center gap-2 h-9 pl-2 pr-1">
            <span className="flex-1 text-2xs font-medium text-ink-faint">
              Enregistrés dans ce navigateur ({savedProjects.length})
            </span>
            <Button onClick={() => saveCurrentNow()}>Enregistrer</Button>
          </div>
          {savedProjects.length === 0 ? (
            <p className="px-2 pb-2 text-xs text-ink-faint">
              Aucun projet enregistré. Ton travail est sauvegardé automatiquement.
            </p>
          ) : (
            <ul className="grid gap-px max-h-72 overflow-y-auto">
              {savedProjects.map((proj) => {
                const current = proj.id === doc.id;
                return (
                  <li
                    key={proj.id}
                    className={`group flex items-center gap-1 min-h-8 pl-2 pr-1 rounded ${
                      current ? 'bg-accent-soft' : 'hover:bg-hover'
                    }`}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        loadDocument(proj.document);
                        setOpen(false);
                      }}
                      className="flex-1 min-w-0 flex items-center gap-2 py-1.5 text-left"
                    >
                      <span className={`flex-1 min-w-0 text-xs leading-snug text-ink ${current ? 'font-medium' : ''}`}>
                        {proj.name}
                      </span>
                      <span className="text-2xs text-ink-faint tabular-nums whitespace-nowrap">
                        {proj.capacity.toLocaleString('fr-FR')} pl.
                      </span>
                    </button>
                    {current ? (
                      <span className="px-2 text-2xs text-accent-ink">Ouvert</span>
                    ) : (
                      <IconButton
                        label={`Supprimer « ${proj.name} »`}
                        onClick={() => deleteSavedProject(proj.id)}
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </IconButton>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

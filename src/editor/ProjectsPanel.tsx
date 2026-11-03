import React from 'react';
import { Trash2 } from 'lucide-react';
import { useStadiumStore } from '../state/useStadiumStore';
import { Button, IconButton, PanelSection } from './ui';

export const ProjectsPanel: React.FC = () => {
  const doc = useStadiumStore((s) => s.doc);
  const savedProjects = useStadiumStore((s) => s.savedProjects);
  const setExamplesOpen = useStadiumStore((s) => s.setExamplesOpen);
  const loadDocument = useStadiumStore((s) => s.loadDocument);
  const saveCurrentNow = useStadiumStore((s) => s.saveCurrentNow);
  const deleteSavedProject = useStadiumStore((s) => s.deleteSavedProject);

  return (
    <>
      <div className="flex items-center gap-3 h-12 px-4 border-b border-line">
        <h2 className="flex-1 text-sm font-semibold text-ink">Mes projets</h2>
        <Button onClick={() => saveCurrentNow()}>Enregistrer</Button>
      </div>

      <div className="px-4 py-3 border-b border-line">
        <Button className="w-full" onClick={() => setExamplesOpen(true)}>
          Partir d’un exemple…
        </Button>
      </div>

      <PanelSection title={`Enregistrés dans ce navigateur (${savedProjects.length})`}>
        {savedProjects.length === 0 ? (
          <p className="text-xs text-ink-faint">
            Aucun projet enregistré. Ton travail est sauvegardé automatiquement dans ce navigateur.
          </p>
        ) : (
          <ul className="grid gap-px -mx-2">
            {savedProjects.map((proj) => {
              const current = proj.id === doc.id;
              return (
                <li
                  key={proj.id}
                  className={`group flex items-center gap-1 h-8 pl-2 pr-1 rounded ${
                    current ? 'bg-accent-soft' : 'hover:bg-hover'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => loadDocument(proj.document)}
                    className="flex-1 min-w-0 flex items-center gap-2 h-full text-left"
                  >
                    <span className={`flex-1 truncate text-xs text-ink ${current ? 'font-medium' : ''}`}>
                      {proj.name}
                    </span>
                    <span className="text-2xs text-ink-faint tabular-nums">
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
      </PanelSection>
    </>
  );
};

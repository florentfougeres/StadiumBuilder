import React, { useMemo } from 'react';
import {
  Armchair,
  Box,
  CircleDashed,
  FolderOpen,
  Paintbrush,
  Tent,
} from 'lucide-react';
import { calculateStadiumMetrics } from '../stadium/capacity';
import { StandSide } from '../stadium/schema';
import { useStadiumStore } from '../state/useStadiumStore';
import { ROOF_OPTIONS, SHAPE_OPTIONS } from './Inspector';

export type EditorNode = 'bowl' | 'stand' | 'roof' | 'materials' | 'objects' | 'projects';

const STAND_ORDER: { id: StandSide; label: string }[] = [
  { id: 'north', label: 'Nord' },
  { id: 'south', label: 'Sud' },
  { id: 'east', label: 'Est' },
  { id: 'west', label: 'Ouest' },
];

const TreeRow: React.FC<{
  active: boolean;
  depth?: 0 | 1;
  icon?: React.ReactNode;
  label: string;
  meta?: string;
  muted?: boolean;
  onClick: () => void;
}> = ({ active, depth = 0, icon, label, meta, muted, onClick }) => (
  <button
    type="button"
    aria-current={active ? 'true' : undefined}
    onClick={onClick}
    className={`flex items-center gap-2 w-full h-7 pr-2 rounded text-left transition-colors duration-100 ${
      depth === 1 ? 'pl-8' : 'pl-2'
    } ${active ? 'bg-accent-soft text-ink' : 'text-ink hover:bg-hover'}`}
  >
    {icon && <span className={active ? 'text-accent-ink' : 'text-ink-faint'}>{icon}</span>}
    <span className={`flex-1 truncate text-xs ${muted ? 'text-ink-faint' : ''}`}>{label}</span>
    {meta && <span className="text-2xs text-ink-faint tabular-nums whitespace-nowrap">{meta}</span>}
  </button>
);

const GroupLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-2 pt-4 pb-1 text-2xs font-medium text-ink-faint">{children}</div>
);

export const StructureTree: React.FC<{
  node: EditorNode;
  onSelect: (node: EditorNode) => void;
}> = ({ node, onSelect }) => {
  const doc = useStadiumStore((s) => s.doc);
  const activeStand = useStadiumStore((s) => s.activeStandTab);
  const setActiveStand = useStadiumStore((s) => s.setActiveStandTab);
  const selectedObjectId = useStadiumStore((s) => s.selectedObjectId);
  const selectObject = useStadiumStore((s) => s.selectObject);
  const metrics = useMemo(() => calculateStadiumMetrics(doc), [doc]);

  const shapeLabel = SHAPE_OPTIONS.find((o) => o.id === doc.shape)?.label ?? '';
  const roofLabel = ROOF_OPTIONS.find((o) => o.id === doc.roof.style)?.label ?? '';

  return (
    <nav aria-label="Structure du stade" className="h-full overflow-y-auto px-2 pb-4">
      <GroupLabel>Stade</GroupLabel>
      <TreeRow
        active={node === 'bowl'}
        icon={<CircleDashed className="w-3.5 h-3.5" />}
        label="Enceinte et terrain"
        onClick={() => onSelect('bowl')}
      />
      <div className="pl-8 -mt-0.5 mb-1 text-2xs text-ink-faint truncate">{shapeLabel}</div>

      <TreeRow
        active={false}
        icon={<Armchair className="w-3.5 h-3.5" />}
        label="Tribunes"
        meta={metrics.totalCapacity.toLocaleString('fr-FR')}
        onClick={() => onSelect('stand')}
      />
      {STAND_ORDER.map((s) => {
        const sm = metrics.stands[s.id];
        return (
          <TreeRow
            key={s.id}
            depth={1}
            active={node === 'stand' && activeStand === s.id}
            label={s.label}
            muted={!sm.enabled}
            meta={sm.enabled ? sm.capacity.toLocaleString('fr-FR') : 'désactivée'}
            onClick={() => {
              setActiveStand(s.id);
              onSelect('stand');
            }}
          />
        );
      })}

      <TreeRow
        active={node === 'roof'}
        icon={<Tent className="w-3.5 h-3.5" />}
        label="Toiture"
        onClick={() => onSelect('roof')}
      />
      <div className="pl-8 -mt-0.5 mb-1 text-2xs text-ink-faint truncate">{roofLabel}</div>

      <TreeRow
        active={node === 'materials'}
        icon={<Paintbrush className="w-3.5 h-3.5" />}
        label="Façade et matériaux"
        onClick={() => onSelect('materials')}
      />

      <GroupLabel>Abords</GroupLabel>
      <TreeRow
        active={node === 'objects' && !selectedObjectId}
        icon={<Box className="w-3.5 h-3.5" />}
        label="Équipements"
        meta={String(doc.objects.length)}
        onClick={() => {
          selectObject(null);
          onSelect('objects');
        }}
      />
      {doc.objects.map((obj) => (
        <TreeRow
          key={obj.id}
          depth={1}
          active={obj.id === selectedObjectId}
          label={obj.name}
          onClick={() => {
            selectObject(obj.id);
            onSelect('objects');
          }}
        />
      ))}

      <GroupLabel>Fichier</GroupLabel>
      <TreeRow
        active={node === 'projects'}
        icon={<FolderOpen className="w-3.5 h-3.5" />}
        label="Mes projets"
        onClick={() => onSelect('projects')}
      />
    </nav>
  );
};

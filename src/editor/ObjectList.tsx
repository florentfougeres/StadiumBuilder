import React from 'react';
import {
  Building2,
  Car,
  Copy,
  Fence,
  Lightbulb,
  MonitorPlay,
  Plus,
  ShoppingBag,
  Tent,
  Trash2,
  Trees,
  Users,
} from 'lucide-react';
import { PlacedObjectType } from '../stadium/schema';
import { useStadiumStore } from '../state/useStadiumStore';
import { IconButton, NumberField, PanelSection } from './ui';

const ADDABLE_ASSETS: {
  type: PlacedObjectType;
  label: string;
  icon: React.ReactNode;
}[] = [
  { type: 'screen', label: 'Écran géant', icon: <MonitorPlay className="w-3.5 h-3.5" /> },
  { type: 'floodlight', label: 'Projecteur', icon: <Lightbulb className="w-3.5 h-3.5" /> },
  { type: 'dugout', label: 'Bancs de touche', icon: <Users className="w-3.5 h-3.5" /> },
  { type: 'locker_room', label: 'Vestiaires', icon: <Building2 className="w-3.5 h-3.5" /> },
  { type: 'shop', label: 'Boutique', icon: <ShoppingBag className="w-3.5 h-3.5" /> },
  { type: 'parking', label: 'Parking', icon: <Car className="w-3.5 h-3.5" /> },
  { type: 'esplanade', label: 'Esplanade', icon: <Trees className="w-3.5 h-3.5" /> },
  { type: 'fence', label: 'Clôture', icon: <Fence className="w-3.5 h-3.5" /> },
  { type: 'custom_roof', label: 'Toit libre', icon: <Tent className="w-3.5 h-3.5" /> },
];

const SelectedObjectInspector: React.FC = () => {
  const objects = useStadiumStore((s) => s.doc.objects);
  const selectedObjectId = useStadiumStore((s) => s.selectedObjectId);
  const updateObjectTransform = useStadiumStore((s) => s.updateObjectTransform);
  const duplicateSelectedObject = useStadiumStore((s) => s.duplicateSelectedObject);
  const removeObject = useStadiumStore((s) => s.removeObject);
  const obj = objects.find((o) => o.id === selectedObjectId);
  if (!obj) return null;

  return (
    <>
      <div className="flex items-center gap-1 h-12 pl-4 pr-2 border-b border-line">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-ink truncate">{obj.name}</h2>
          <div className="text-2xs text-ink-faint">G déplacer · R tourner · S échelle</div>
        </div>
        <IconButton label="Dupliquer" onClick={duplicateSelectedObject}>
          <Copy className="w-3.5 h-3.5" />
        </IconButton>
        <IconButton label="Supprimer (Suppr)" onClick={() => removeObject(obj.id)} className="hover:text-danger">
          <Trash2 className="w-3.5 h-3.5" />
        </IconButton>
      </div>
      <PanelSection title="Position">
        <div className="grid grid-cols-3 gap-2">
          {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
            <NumberField
              key={axis}
              label={axis}
              value={obj.position[idx]}
              onChange={(val) => {
                const next: [number, number, number] = [...obj.position];
                next[idx] = idx === 1 ? Math.max(0, val) : val;
                updateObjectTransform(obj.id, { position: next });
              }}
            />
          ))}
        </div>
        <p className="text-2xs text-ink-faint">En mètres depuis le centre du terrain.</p>
      </PanelSection>
      <PanelSection title="Orientation et taille">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Rotation °"
            step={15}
            value={Math.round((obj.rotation[1] * 180) / Math.PI)}
            onChange={(deg) => {
              const rad = Number(((deg * Math.PI) / 180).toFixed(3));
              updateObjectTransform(obj.id, { rotation: [obj.rotation[0], rad, obj.rotation[2]] });
            }}
          />
          <NumberField
            label="Échelle"
            step={0.1}
            min={0.3}
            max={3.5}
            value={obj.scale[0]}
            onChange={(v) => {
              const sc = Math.max(0.25, Math.min(4, v || 1));
              updateObjectTransform(obj.id, { scale: [sc, sc, sc] });
            }}
          />
        </div>
      </PanelSection>
    </>
  );
};

export const ObjectList: React.FC = () => {
  const objects = useStadiumStore((s) => s.doc.objects);
  const selectedObjectId = useStadiumStore((s) => s.selectedObjectId);
  const addObject = useStadiumStore((s) => s.addObject);

  if (selectedObjectId && objects.some((o) => o.id === selectedObjectId)) {
    return <SelectedObjectInspector />;
  }

  return (
    <>
      <div className="flex items-center h-12 px-4 border-b border-line">
        <div>
          <h2 className="text-sm font-semibold text-ink">Équipements</h2>
          <div className="text-2xs text-ink-faint tabular-nums">
            {objects.length === 0 ? 'Aucun placé' : `${objects.length} placé${objects.length > 1 ? 's' : ''}`}
          </div>
        </div>
      </div>
      <PanelSection title="Ajouter">
        <div className="grid grid-cols-2 gap-px -mx-2">
          {ADDABLE_ASSETS.map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => addObject(item.type)}
              className="group flex items-center gap-2 h-8 px-2 rounded text-left text-xs text-ink hover:bg-hover"
            >
              <span className="text-ink-faint group-hover:text-ink">{item.icon}</span>
              <span className="flex-1 truncate">{item.label}</span>
              <Plus aria-hidden className="w-3 h-3 text-ink-faint opacity-0 group-hover:opacity-100" />
            </button>
          ))}
        </div>
        <p className="text-2xs text-ink-faint">
          L’équipement apparaît près du terrain. Sélectionne-le dans la scène ou dans l’arborescence pour le
          placer.
        </p>
      </PanelSection>
    </>
  );
};

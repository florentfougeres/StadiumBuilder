import React from 'react';
import {
  Building2,
  ChevronLeft,
  Car,
  Copy,
  Fence,
  Lightbulb,
  CircleDot,
  DoorOpen,
  Landmark,
  MoveUpRight,
  MonitorPlay,
  Plus,
  ShoppingBag,
  Tent,
  Trash2,
  Trees,
  Users,
} from 'lucide-react';
import { ObjectMount, PlacedObjectType, StandSide } from '../stadium/schema';
import { useStadiumStore } from '../state/useStadiumStore';
import { IconButton, NumberField, PanelSection, Segmented, SelectField, SliderField, choiceClass } from './ui';

const ADDABLE_ASSETS: {
  type: PlacedObjectType;
  label: string;
  icon: React.ReactNode;
}[] = [
  { type: 'screen', label: 'Écran géant', icon: <MonitorPlay className="w-3.5 h-3.5" /> },
  { type: 'halo_screen', label: 'Écran halo central', icon: <CircleDot className="w-3.5 h-3.5" /> },
  { type: 'inclined_mast', label: 'Mât incliné', icon: <MoveUpRight className="w-3.5 h-3.5" /> },
  { type: 'monumental_arch', label: 'Arche d’entrée', icon: <Landmark className="w-3.5 h-3.5" /> },
  { type: 'monumental_gate', label: 'Porte monumentale', icon: <DoorOpen className="w-3.5 h-3.5" /> },
  { type: 'floodlight', label: 'Projecteur', icon: <Lightbulb className="w-3.5 h-3.5" /> },
  { type: 'dugout', label: 'Bancs de touche', icon: <Users className="w-3.5 h-3.5" /> },
  { type: 'locker_room', label: 'Vestiaires', icon: <Building2 className="w-3.5 h-3.5" /> },
  { type: 'shop', label: 'Boutique', icon: <ShoppingBag className="w-3.5 h-3.5" /> },
  { type: 'parking', label: 'Parking', icon: <Car className="w-3.5 h-3.5" /> },
  { type: 'esplanade', label: 'Esplanade', icon: <Trees className="w-3.5 h-3.5" /> },
  { type: 'fence', label: 'Clôture', icon: <Fence className="w-3.5 h-3.5" /> },
  { type: 'custom_roof', label: 'Toit libre', icon: <Tent className="w-3.5 h-3.5" /> },
];

const MOUNT_OPTIONS: { id: ObjectMount; label: string; title: string }[] = [
  { id: 'roof', label: 'Sous le toit', title: 'Suspendu au bord avant de la toiture' },
  { id: 'stand', label: 'Haut de tribune', title: 'Posé sur la crête arrière de la tribune' },
  { id: 'free', label: 'Libre', title: 'Position et orientation manuelles' },
];

const SIDE_OPTIONS: { id: StandSide; label: string }[] = [
  { id: 'west', label: 'Ouest' },
  { id: 'east', label: 'Est' },
  { id: 'north', label: 'Nord' },
  { id: 'south', label: 'Sud' },
];

const SelectedObjectInspector: React.FC = () => {
  const objects = useStadiumStore((s) => s.doc.objects);
  const selectedObjectId = useStadiumStore((s) => s.selectedObjectId);
  const updateObjectTransform = useStadiumStore((s) => s.updateObjectTransform);
  const duplicateSelectedObject = useStadiumStore((s) => s.duplicateSelectedObject);
  const removeObject = useStadiumStore((s) => s.removeObject);
  const selectObject = useStadiumStore((s) => s.selectObject);
  const roofStyle = useStadiumStore((s) => s.doc.roof.style);
  const obj = objects.find((o) => o.id === selectedObjectId);
  if (!obj) return null;

  const mount = obj.type === 'screen' ? (obj.mount ?? 'free') : 'free';
  const side = obj.mountSide ?? 'west';
  const isEnd = side === 'east' || side === 'west';
  const alongIdx = isEnd ? 2 : 0;

  return (
    <>
      <div className="flex items-center gap-1 min-h-12 py-2 pl-2 pr-2 border-b border-line">
        <IconButton label="Retour aux équipements" onClick={() => selectObject(null)}>
          <ChevronLeft className="w-4 h-4" />
        </IconButton>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold leading-snug text-ink">{obj.name}</h2>
          <div className="text-2xs text-ink-faint">G déplacer · R tourner · S échelle</div>
        </div>
        <IconButton label="Dupliquer" onClick={duplicateSelectedObject}>
          <Copy className="w-3.5 h-3.5" />
        </IconButton>
        <IconButton label="Supprimer (Suppr)" onClick={() => removeObject(obj.id)} className="hover:text-danger">
          <Trash2 className="w-3.5 h-3.5" />
        </IconButton>
      </div>
      {obj.type === 'screen' && (
        <PanelSection title="Fixation">
          <Segmented
            label="Fixation de l’écran"
            value={mount}
            onChange={(m) => updateObjectTransform(obj.id, { mount: m, mountSide: side })}
            options={MOUNT_OPTIONS}
          />
          {mount !== 'free' && (
            <>
              <SelectField
                label="Tribune"
                value={side}
                onChange={(v) => updateObjectTransform(obj.id, { mountSide: v })}
                options={SIDE_OPTIONS}
              />
              <SliderField
                label="Décalage le long de la tribune"
                min={-60}
                max={60}
                step={1}
                value={obj.position[alongIdx]}
                display={`${obj.position[alongIdx] > 0 ? '+' : ''}${Math.round(obj.position[alongIdx])} m`}
                onChange={(v) => {
                  const next: [number, number, number] = [...obj.position];
                  next[alongIdx] = v;
                  updateObjectTransform(obj.id, { position: next });
                }}
              />
              {mount === 'roof' && roofStyle === 'none' && (
                <p className="text-2xs text-ink-muted">
                  Sans toit, l’écran se pose en haut de la tribune.
                </p>
              )}
            </>
          )}
        </PanelSection>
      )}
      {mount === 'free' && (
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
      )}
      <PanelSection title={mount === 'free' ? 'Orientation et taille' : 'Taille'}>
        <div className="grid grid-cols-2 gap-2">
          {mount === 'free' && (
            <NumberField
              label="Rotation °"
              step={15}
              value={Math.round((obj.rotation[1] * 180) / Math.PI)}
              onChange={(deg) => {
                const rad = Number(((deg * Math.PI) / 180).toFixed(3));
                updateObjectTransform(obj.id, { rotation: [obj.rotation[0], rad, obj.rotation[2]] });
              }}
            />
          )}
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

/** Equipment tab: what is placed, what can be added, then `footer` (the pitch floodlights). */
export const ObjectList: React.FC<{ footer?: React.ReactNode }> = ({ footer }) => {
  const objects = useStadiumStore((s) => s.doc.objects);
  const selectedObjectId = useStadiumStore((s) => s.selectedObjectId);
  const addObject = useStadiumStore((s) => s.addObject);
  const selectObject = useStadiumStore((s) => s.selectObject);
  const removeObject = useStadiumStore((s) => s.removeObject);

  if (selectedObjectId && objects.some((o) => o.id === selectedObjectId)) {
    return <SelectedObjectInspector />;
  }

  return (
    <>
      <div className="flex items-center min-h-12 py-2 px-4 border-b border-line">
        <div>
          <h2 className="text-sm font-semibold text-ink">Équipements</h2>
          <div className="text-2xs text-ink-faint tabular-nums">
            {objects.length === 0 ? 'Aucun placé' : `${objects.length} placé${objects.length > 1 ? 's' : ''}`}
          </div>
        </div>
      </div>
      {objects.length > 0 && (
        <PanelSection title="Placés">
          <ul className="grid gap-px -mx-2">
            {objects.map((obj) => (
              <li key={obj.id} className="group flex items-center gap-1 min-h-8 pl-2 pr-1 rounded hover:bg-hover">
                <button
                  type="button"
                  onClick={() => selectObject(obj.id)}
                  className="flex-1 min-w-0 py-1.5 text-left text-xs leading-snug text-ink"
                >
                  {obj.name}
                </button>
                <IconButton
                  label={`Supprimer « ${obj.name} »`}
                  onClick={() => removeObject(obj.id)}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        </PanelSection>
      )}
      <PanelSection title="Ajouter">
        <div className="grid grid-cols-2 gap-1">
          {ADDABLE_ASSETS.map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => addObject(item.type)}
              className={`group flex items-center gap-2 min-h-8 px-2 py-1.5 text-left text-xs leading-snug ${choiceClass(false)}`}
            >
              <span className="text-ink-faint group-hover:text-ink">{item.icon}</span>
              <span className="flex-1 min-w-0">{item.label}</span>
              <Plus aria-hidden className="w-3 h-3 shrink-0 text-ink-faint group-hover:text-accent-ink" />
            </button>
          ))}
        </div>
        <p className="text-2xs text-ink-faint">
          L’équipement apparaît près du terrain. Clique-le dans la scène ou dans la liste pour le régler.
        </p>
      </PanelSection>
      {footer}
    </>
  );
};

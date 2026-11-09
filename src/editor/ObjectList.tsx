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
  Sailboat,
  Castle,
  Spline,
  TowerControl,
  ShoppingBag,
  Tent,
  Trash2,
  Trees,
  Users,
} from 'lucide-react';
import { HALO_LIMITS, ObjectMount, PlacedObjectType, resolveHaloSize, StandSide } from '../stadium/schema';
import { useStadiumStore } from '../state/useStadiumStore';
import { IconButton, NumberField, PanelSection, Segmented, SelectField, SliderField, choiceClass } from './ui';

const ADDABLE_ASSETS: {
  type: PlacedObjectType;
  label: string;
  icon: React.ReactNode;
}[] = [
  { type: 'screen', label: 'Écran géant', icon: <MonitorPlay className="w-3.5 h-3.5" /> },
  { type: 'halo_screen', label: 'Écran central suspendu', icon: <CircleDot className="w-3.5 h-3.5" /> },
  { type: 'inclined_mast', label: 'Mât incliné', icon: <MoveUpRight className="w-3.5 h-3.5" /> },
  { type: 'monumental_arch', label: 'Arche d’entrée', icon: <Landmark className="w-3.5 h-3.5" /> },
  { type: 'monumental_gate', label: 'Porte monumentale', icon: <DoorOpen className="w-3.5 h-3.5" /> },
  { type: 'lighthouse', label: 'Phare', icon: <TowerControl className="w-3.5 h-3.5" /> },
  { type: 'galleon', label: 'Galion', icon: <Sailboat className="w-3.5 h-3.5" /> },
  { type: 'tower', label: 'Tour', icon: <Castle className="w-3.5 h-3.5" /> },
  { type: 'footbridge', label: 'Passerelle', icon: <Spline className="w-3.5 h-3.5" /> },
  { type: 'floodlight', label: 'Projecteur', icon: <Lightbulb className="w-3.5 h-3.5" /> },
  { type: 'dugout', label: 'Bancs de touche', icon: <Users className="w-3.5 h-3.5" /> },
  { type: 'locker_room', label: 'Vestiaires', icon: <Building2 className="w-3.5 h-3.5" /> },
  { type: 'shop', label: 'Boutique', icon: <ShoppingBag className="w-3.5 h-3.5" /> },
  { type: 'parking', label: 'Parking', icon: <Car className="w-3.5 h-3.5" /> },
  { type: 'esplanade', label: 'Esplanade', icon: <Trees className="w-3.5 h-3.5" /> },
  { type: 'fence', label: 'Clôture', icon: <Fence className="w-3.5 h-3.5" /> },
  { type: 'custom_roof', label: 'Toit libre', icon: <Tent className="w-3.5 h-3.5" /> },
];

/** Equipment that sets itself up (centred halo, stand-mounted screen) instead of being dropped by click. */
const SELF_PLACED: PlacedObjectType[] = ['halo_screen', 'screen'];

/** Position fields in the order people read them: X and Y across the ground, Z up. */
const POSITION_AXES: { label: string; idx: 0 | 1 | 2 }[] = [
  { label: 'X', idx: 0 },
  { label: 'Y', idx: 2 },
  { label: 'Z ↑', idx: 1 },
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
      {obj.type === 'halo_screen' && <HaloControls />}
      {mount === 'free' && obj.type !== 'halo_screen' && (
        <PanelSection title="Position">
          <div className="grid grid-cols-3 gap-2">
            {POSITION_AXES.map(({ label, idx }) => (
              <NumberField
                key={label}
                label={label}
                value={obj.position[idx]}
                onChange={(val) => {
                  const next: [number, number, number] = [...obj.position];
                  next[idx] = idx === 1 ? Math.max(0, val) : val;
                  updateObjectTransform(obj.id, { position: next });
                }}
              />
            ))}
          </div>
          <p className="text-2xs text-ink-faint">
            En mètres depuis le centre du terrain ; Z est la hauteur. Tu peux aussi glisser l’objet dans la scène.
          </p>
        </PanelSection>
      )}
      {obj.type !== 'halo_screen' && (
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
      )}
    </>
  );
};

/** Halo screen: hangs centred over the pitch; only its height and size are set by hand. */
const HaloControls: React.FC = () => {
  const obj = useStadiumStore((s) => s.doc.objects.find((o) => o.id === s.selectedObjectId));
  const updateObjectTransform = useStadiumStore((s) => s.updateObjectTransform);
  if (!obj) return null;
  const { rx, bandHeight } = resolveHaloSize(obj);
  const box = obj.haloShape === 'box';
  const roofEdge = obj.haloShape === 'roof_edge';
  return (
    <PanelSection title="Écran central">
      <Segmented
        label="Forme de l’écran"
        value={obj.haloShape ?? 'ring'}
        onChange={(haloShape) => updateObjectTransform(obj.id, { haloShape })}
        options={[
          { id: 'ring', label: 'Anneau', title: 'Anneau elliptique à 360°' },
          { id: 'box', label: 'Caisson', title: 'Quatre écrans en caisson au-dessus du milieu de terrain' },
          { id: 'roof_edge', label: 'Bord du toit', title: 'Bandeau à 360° sous le bord intérieur du toit, tout autour du stade' },
        ]}
      />
      {!roofEdge && (
        <>
      <SliderField
        label="Hauteur au-dessus du terrain"
        min={10}
        max={70}
        step={0.5}
        value={obj.position[1]}
        display={`${obj.position[1].toFixed(1)} m`}
        onChange={(v) => updateObjectTransform(obj.id, { position: [obj.position[0], v, obj.position[2]] })}
      />
      <SliderField
        label={box ? 'Longueur' : 'Diamètre'}
        min={HALO_LIMITS.diameter.min}
        max={HALO_LIMITS.diameter.max}
        step={1}
        value={rx * 2}
        display={`${Math.round(rx * 2)} m`}
        onChange={(v) => updateObjectTransform(obj.id, { haloDiameter: v })}
      />
        </>
      )}
      <SliderField
        label="Hauteur de l’écran"
        min={HALO_LIMITS.bandHeight.min}
        max={HALO_LIMITS.bandHeight.max}
        step={0.1}
        value={bandHeight}
        display={`${bandHeight.toFixed(1)} m`}
        onChange={(v) => updateObjectTransform(obj.id, { haloBandHeight: v })}
      />
      <p className="text-2xs text-ink-faint">
        {roofEdge
          ? 'Il court sous le bord intérieur du toit, tout autour du stade ; sans toit au-dessus, il n’apparaît pas.'
          : 'Centré sur le terrain, il est suspendu par des câbles à la structure au-dessus : toit, arche ou crête des tribunes.'}
      </p>
    </PanelSection>
  );
};

/** Equipment tab: what is placed, what can be added, then `footer` (the pitch floodlights). */
export const ObjectList: React.FC<{ footer?: React.ReactNode }> = ({ footer }) => {
  const objects = useStadiumStore((s) => s.doc.objects);
  const selectedObjectId = useStadiumStore((s) => s.selectedObjectId);
  const addObject = useStadiumStore((s) => s.addObject);
  const placingType = useStadiumStore((s) => s.placingType);
  const setPlacingType = useStadiumStore((s) => s.setPlacingType);
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
              aria-pressed={placingType === item.type}
              onClick={() =>
                SELF_PLACED.includes(item.type)
                  ? addObject(item.type)
                  : setPlacingType(placingType === item.type ? null : item.type)
              }
              className={`group flex items-center gap-2 min-h-8 px-2 py-1.5 text-left text-xs leading-snug ${choiceClass(placingType === item.type)}`}
            >
              <span className="text-ink-faint group-hover:text-ink">{item.icon}</span>
              <span className="flex-1 min-w-0">{item.label}</span>
              <Plus aria-hidden className="w-3 h-3 shrink-0 text-ink-faint group-hover:text-accent-ink" />
            </button>
          ))}
        </div>
        <p className="text-2xs text-ink-faint">
          {placingType
            ? 'Clique dans la scène à l’endroit voulu pour le poser · Échap pour annuler.'
            : 'Choisis un équipement puis clique dans la scène pour le poser. Glisse ensuite un objet sélectionné pour le déplacer.'}
        </p>
      </PanelSection>
      {footer}
    </>
  );
};

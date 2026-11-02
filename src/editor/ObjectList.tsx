import React from 'react';
import {
  Building2,
  Car,
  Copy,
  Fence,
  Lightbulb,
  MonitorPlay,
  ShoppingBag,
  Tent,
  Trash2,
  Trees,
  Users,
} from 'lucide-react';
import { PlacedObjectType } from '../stadium/schema';
import { useStadiumStore } from '../state/useStadiumStore';

interface ObjectListProps {
  layout?: 'sidebar' | 'dock';
}

const ADDABLE_ASSETS: {
  type: PlacedObjectType;
  label: string;
  icon: React.ReactNode;
}[] = [
  { type: 'screen', label: 'Écran Géant', icon: <MonitorPlay className="w-3.5 h-3.5" /> },
  { type: 'floodlight', label: 'Projecteur', icon: <Lightbulb className="w-3.5 h-3.5" /> },
  { type: 'dugout', label: 'Bancs touche', icon: <Users className="w-3.5 h-3.5" /> },
  { type: 'locker_room', label: 'Vestiaires', icon: <Building2 className="w-3.5 h-3.5" /> },
  { type: 'shop', label: 'Boutique', icon: <ShoppingBag className="w-3.5 h-3.5" /> },
  { type: 'parking', label: 'Parking', icon: <Car className="w-3.5 h-3.5" /> },
  { type: 'esplanade', label: 'Esplanade', icon: <Trees className="w-3.5 h-3.5" /> },
  { type: 'fence', label: 'Clôture', icon: <Fence className="w-3.5 h-3.5" /> },
  { type: 'custom_roof', label: 'Toit libre', icon: <Tent className="w-3.5 h-3.5" /> },
];

export const ObjectList: React.FC<ObjectListProps> = ({ layout = 'sidebar' }) => {
  const objects = useStadiumStore((s) => s.doc.objects);
  const selectedObjectId = useStadiumStore((s) => s.selectedObjectId);
  const addObject = useStadiumStore((s) => s.addObject);
  const selectObject = useStadiumStore((s) => s.selectObject);
  const updateObjectTransform = useStadiumStore((s) => s.updateObjectTransform);
  const duplicateSelectedObject = useStadiumStore((s) => s.duplicateSelectedObject);
  const removeObject = useStadiumStore((s) => s.removeObject);

  const selectedObj = objects.find((o) => o.id === selectedObjectId) ?? null;
  const isSidebar = layout === 'sidebar';

  return (
    <div
      className={
        isSidebar
          ? 'space-y-5'
          : 'grid grid-cols-1 lg:grid-cols-12 gap-4 items-start'
      }
    >
      {/* Catalogue */}
      <div className={isSidebar ? 'space-y-2' : 'lg:col-span-5 space-y-2'}>
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="font-semibold text-slate-200">Ajouter un équipement 3D</span>
          <span>Placement libre</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {ADDABLE_ASSETS.map((item) => (
            <button
              key={item.type}
              type="button"
              onClick={() => addObject(item.type)}
              className="flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-slate-200 bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/40 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <span className="text-emerald-400 shrink-0">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Numeric Transform Inspector for Selected Object */}
      <div
        className={
          isSidebar
            ? 'space-y-2 pt-4 border-t border-slate-800'
            : 'lg:col-span-3 space-y-2'
        }
      >
        {selectedObj ? (
          <div className="p-3 rounded-lg bg-slate-950 border border-emerald-500/40 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-300 truncate max-w-[220px]">
                {selectedObj.name}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={duplicateSelectedObject}
                  title="Dupliquer"
                  className="p-1.5 text-slate-200 hover:text-white bg-slate-800 rounded"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeObject(selectedObj.id)}
                  title="Supprimer (Suppr)"
                  className="p-1.5 text-rose-300 hover:text-rose-200 bg-slate-800 rounded"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-[11px]">
              {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                <label key={axis} className="space-y-1">
                  <span className="text-slate-400 block">Pos {axis} (m)</span>
                  <input
                    type="number"
                    step={1}
                    value={selectedObj.position[idx]}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 0;
                      const next: [number, number, number] = [...selectedObj.position];
                      next[idx] = idx === 1 ? Math.max(0, val) : val;
                      updateObjectTransform(selectedObj.id, { position: next });
                    }}
                    className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded font-mono tabular-nums text-slate-100"
                  />
                </label>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <label className="space-y-1">
                <span className="text-slate-400 block">Rotation Y (°)</span>
                <input
                  type="number"
                  step={15}
                  value={Math.round((selectedObj.rotation[1] * 180) / Math.PI)}
                  onChange={(e) => {
                    const deg = Number(e.target.value) || 0;
                    const rad = Number(((deg * Math.PI) / 180).toFixed(3));
                    updateObjectTransform(selectedObj.id, {
                      rotation: [selectedObj.rotation[0], rad, selectedObj.rotation[2]],
                    });
                  }}
                  className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded font-mono tabular-nums text-slate-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-slate-400 block">Échelle uniforme</span>
                <input
                  type="number"
                  step={0.1}
                  min={0.3}
                  max={3.5}
                  value={selectedObj.scale[0]}
                  onChange={(e) => {
                    const sc = Math.max(0.25, Math.min(4, Number(e.target.value) || 1));
                    updateObjectTransform(selectedObj.id, { scale: [sc, sc, sc] });
                  }}
                  className="w-full px-2 py-1 bg-slate-900 border border-slate-700 rounded font-mono tabular-nums text-slate-100"
                />
              </label>
            </div>
          </div>
        ) : (
          <div className="py-3 px-3 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-400">
            Sélectionnez un objet ci-dessous ou dans la scène 3D pour afficher ses coordonnées
            et son gizmo (G / R / S).
          </div>
        )}
      </div>

      {/* Scene Outliner */}
      <div
        className={
          isSidebar
            ? 'space-y-2 pt-4 border-t border-slate-800'
            : 'lg:col-span-4 space-y-2'
        }
      >
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="font-semibold text-slate-200">
            Objets placés ({objects.length})
          </span>
          <span>Clic pour sélectionner</span>
        </div>
        <div className={isSidebar ? 'space-y-1.5' : 'max-h-32 overflow-y-auto custom-scrollbar space-y-1 pr-1'}>
          {objects.length === 0 ? (
            <p className="text-xs text-slate-500 py-3">
              Aucun équipement placé. Cliquez sur un bouton ci-dessus pour l’ajouter.
            </p>
          ) : (
            objects.map((obj) => {
              const active = obj.id === selectedObjectId;
              return (
                <div
                  key={obj.id}
                  onClick={() => selectObject(active ? null : obj.id)}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors border ${
                    active
                      ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-200'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800/60'
                  }`}
                >
                  <span className="truncate font-medium">{obj.name}</span>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className="font-mono tabular-nums text-[11px] text-slate-400">
                      {Math.round(obj.position[0])}, {Math.round(obj.position[2])} m
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeObject(obj.id);
                      }}
                      title="Supprimer cet objet"
                      className="text-slate-500 hover:text-rose-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
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

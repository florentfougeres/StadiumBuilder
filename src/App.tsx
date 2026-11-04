/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Armchair,
  Box,
  Building,
  CircleDashed,
  RectangleHorizontal,
  Tent,
  Trees,
} from 'lucide-react';
import { EditorTab, Inspector, ROOF_OPTIONS, SHAPE_OPTIONS } from './editor/Inspector';
import { OnboardingDialog, shouldShowOnboardingOnStart } from './editor/OnboardingDialog';
import { generateThumbnails, ThumbnailDir, thumbnailJobs } from './editor/thumbnails';
import { LightingControl, Toolbar } from './editor/Toolbar';
import { Viewport } from './editor/Viewport';
import { calculateStadiumMetrics } from './stadium/capacity';
import { StadiumMetrics } from './stadium/schema';
import { useStadiumStore } from './state/useStadiumStore';

const TABS: { id: EditorTab; label: string; icon: React.ReactNode }[] = [
  { id: 'shape', label: 'Forme', icon: <CircleDashed className="w-[18px] h-[18px]" /> },
  { id: 'pitch', label: 'Terrain', icon: <RectangleHorizontal className="w-[18px] h-[18px]" /> },
  { id: 'stands', label: 'Tribunes', icon: <Armchair className="w-[18px] h-[18px]" /> },
  { id: 'roof', label: 'Toit', icon: <Tent className="w-[18px] h-[18px]" /> },
  { id: 'facade', label: 'Façade', icon: <Building className="w-[18px] h-[18px]" /> },
  { id: 'site', label: 'Abords', icon: <Trees className="w-[18px] h-[18px]" /> },
  { id: 'objects', label: 'Équipements', icon: <Box className="w-[18px] h-[18px]" /> },
];

if (import.meta.env.DEV) {
  (window as unknown as { __generateThumbnails: (only?: ThumbnailDir[]) => Promise<number> }).__generateThumbnails = (
    only
  ) =>
    generateThumbnails(
      thumbnailJobs(
        SHAPE_OPTIONS.map((o) => o.id),
        ROOF_OPTIONS.map((o) => o.id)
      ),
      only
    );
}

/**
 * The editor's sections as labelled tabs: a column on the left from lg, a bar along the bottom
 * below. The active tab opens the side panel; clicking it again folds the panel away.
 */
const TabRail: React.FC<{ tab: EditorTab; panelOpen: boolean; onSelect: (tab: EditorTab) => void }> = ({
  tab,
  panelOpen,
  onSelect,
}) => (
  <nav
    aria-label="Sections du stade"
    className="order-last lg:order-first flex lg:flex-col shrink-0 gap-0.5 p-1 lg:py-2 bg-panel border-t lg:border-t-0 lg:border-r border-line max-lg:overflow-x-auto"
  >
    {TABS.map((t) => {
      const active = t.id === tab && panelOpen;
      return (
        <button
          key={t.id}
          type="button"
          aria-pressed={active}
          onClick={() => onSelect(t.id)}
          className={`flex flex-col items-center justify-center gap-1 shrink-0 w-[68px] lg:w-[72px] h-14 rounded transition-colors duration-100 ${
            active ? 'bg-accent-soft text-accent-ink' : 'text-ink-muted hover:text-ink hover:bg-hover'
          }`}
        >
          {t.icon}
          <span className={`text-2xs leading-none ${active ? 'font-medium text-ink' : ''}`}>{t.label}</span>
        </button>
      );
    })}
  </nav>
);

const fr = (n: number) => n.toLocaleString('fr-FR');

type MetricKey = 'capacity' | 'cvalue' | 'height' | 'footprint' | 'budget';

const METRICS: {
  key: MetricKey;
  label: string;
  read: (m: StadiumMetrics) => number;
  format: (v: number) => string;
  unit: string;
  /** Secondary figures drop off on phone widths so the strip never needs scrolling. */
  compact: boolean;
}[] = [
  { key: 'capacity', label: 'Places', read: (m) => m.totalCapacity, format: fr, unit: '', compact: true },
  { key: 'cvalue', label: 'C-value moy.', read: (m) => m.avgCValueMm, format: fr, unit: 'mm', compact: true },
  { key: 'height', label: 'Hauteur', read: (m) => m.maxRoofHeight, format: (v) => v.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }), unit: 'm', compact: false },
  { key: 'footprint', label: 'Emprise', read: (m) => m.builtFootprintM2, format: fr, unit: 'm²', compact: false },
  { key: 'budget', label: 'Budget estimé', read: (m) => m.estimatedBudgetMillionsEur, format: fr, unit: 'M€', compact: true },
];

/** Live metrics; each change shows its signed delta briefly so cause and effect stay readable. */
const MetricStrip: React.FC<{ metrics: StadiumMetrics; docId: string }> = ({ metrics, docId }) => {
  const prev = useRef({ metrics, docId });
  const [deltas, setDeltas] = useState<{ key: MetricKey; value: number; stamp: number }[]>([]);

  useEffect(() => {
    const { metrics: before, docId: beforeId } = prev.current;
    prev.current = { metrics, docId };
    // Opening another project or preset is not an edit: rebase silently.
    if (beforeId !== docId) {
      setDeltas([]);
      return;
    }
    const stamp = Date.now();
    const changed = METRICS.map((m) => ({ key: m.key, value: m.read(metrics) - m.read(before), stamp })).filter(
      (d) => Math.abs(d.value) >= 0.05
    );
    if (changed.length > 0) setDeltas(changed);
  }, [metrics, docId]);

  return (
    <dl className="pointer-events-none absolute left-3 bottom-3 z-10 flex rounded-md bg-panel/95 border border-line max-w-[calc(100%-1.5rem)]">
      {METRICS.map((m) => {
        const delta = deltas.find((d) => d.key === m.key);
        const value = m.read(metrics);
        const sign = delta && delta.value > 0 ? '+' : '−';
        return (
          <div key={m.key} className={`px-3 py-2 border-r border-line last:border-r-0 min-w-0 sm:min-w-28 ${m.compact ? '' : 'max-sm:hidden'}`}>
            <dt className="flex items-baseline justify-between gap-2 text-2xs text-ink-faint whitespace-nowrap">
              {m.label}
              {delta && (
                <span
                  key={delta.stamp}
                  className="sf-delta font-medium tabular-nums text-accent-ink"
                >
                  {sign}
                  {m.format(Math.abs(delta.value))}
                </span>
              )}
            </dt>
            <dd className="text-sm font-medium text-ink tabular-nums whitespace-nowrap">
              {m.key === 'budget' ? '~' : ''}
              {m.format(value)}
              {m.unit && <span className="ml-0.5 text-2xs font-normal text-ink-muted">{m.unit}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
};

export default function App() {
  const [tab, setTab] = useState<EditorTab>('shape');

  const doc = useStadiumStore((s) => s.doc);
  const panelsHidden = useStadiumStore((s) => s.dockCollapsed);
  const togglePanels = useStadiumStore((s) => s.toggleDockCollapsed);
  const initFromDb = useStadiumStore((s) => s.initFromDb);
  const setTransformMode = useStadiumStore((s) => s.setTransformMode);
  const selectedObjectId = useStadiumStore((s) => s.selectedObjectId);
  const removeObject = useStadiumStore((s) => s.removeObject);
  const selectObject = useStadiumStore((s) => s.selectObject);
  const undo = useStadiumStore((s) => s.undo);
  const redo = useStadiumStore((s) => s.redo);
  const examplesOpen = useStadiumStore((s) => s.examplesOpen);
  const setExamplesOpen = useStadiumStore((s) => s.setExamplesOpen);

  const metrics = useMemo(() => calculateStadiumMetrics(doc), [doc]);

  useEffect(() => {
    initFromDb();
    if (shouldShowOnboardingOnStart()) setExamplesOpen(true);
    // Small screens open on the stadium; panels come in as drawers on demand.
    if (window.innerWidth < 1024 && !useStadiumStore.getState().dockCollapsed) togglePanels();
  }, [initFromDb, togglePanels, setExamplesOpen]);

  // Picking an object in the 3D scene opens its settings.
  useEffect(() => {
    if (!selectedObjectId) return;
    setTab('objects');
    if (useStadiumStore.getState().dockCollapsed) togglePanels();
  }, [selectedObjectId, togglePanels]);

  const selectTab = (next: EditorTab) => {
    // A closed panel opens on any tab; the open tab clicked again folds it away.
    if (panelsHidden || next === tab) togglePanels();
    setTab(next);
  };

  // Keyboard shortcuts: G/R/S gizmo, H panels, Escape deselect, Delete object, Ctrl+Z / Ctrl+Y
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case 'g':
          setTransformMode('translate');
          break;
        case 'r':
          setTransformMode('rotate');
          break;
        case 's':
          setTransformMode('scale');
          break;
        case 'h':
          togglePanels();
          break;
        case 'escape':
          if (useStadiumStore.getState().placingType) useStadiumStore.getState().setPlacingType(null);
          else selectObject(null);
          break;
        case 'delete':
        case 'backspace':
          if (selectedObjectId) {
            removeObject(selectedObjectId);
          }
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, removeObject, selectObject, selectedObjectId, setTransformMode, togglePanels, undo]);

  return (
    <div className="flex flex-col w-full h-[100dvh] overflow-hidden bg-canvas text-ink">
      <Toolbar />

      <div className="flex flex-col lg:flex-row flex-1 min-h-0">
        <TabRail tab={tab} panelOpen={!panelsHidden} onSelect={selectTab} />
        <div className="relative flex flex-1 min-h-0 min-w-0">
          {!panelsHidden && (
            <aside
              data-side-panel
              aria-label={`Réglages : ${TABS.find((t) => t.id === tab)?.label}`}
              className="absolute lg:static inset-y-0 left-0 z-20 flex flex-col w-[min(380px,100%)] lg:w-[340px] shrink-0 bg-panel border-r border-line max-lg:shadow-[8px_0_24px_rgb(0_0_0/0.4)]"
            >
              <div className="md:hidden flex items-center px-3 py-2 border-b border-line">
                <LightingControl />
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <Inspector tab={tab} />
              </div>
            </aside>
          )}

          <main className="relative flex-1 min-w-0">
            <h1 className="sr-only">{doc.name}</h1>
            <Viewport />
            <MetricStrip metrics={metrics} docId={doc.id} />
          </main>
        </div>
      </div>

      <OnboardingDialog open={examplesOpen} onClose={() => setExamplesOpen(false)} />
    </div>
  );
}

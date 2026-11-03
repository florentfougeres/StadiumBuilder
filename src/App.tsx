/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Inspector } from './editor/Inspector';
import { OnboardingDialog, shouldShowOnboardingOnStart } from './editor/OnboardingDialog';
import { EditorNode, StructureTree } from './editor/StructureTree';
import { LightingControl, Toolbar } from './editor/Toolbar';
import { Viewport } from './editor/Viewport';
import { calculateStadiumMetrics } from './stadium/capacity';
import { StadiumMetrics } from './stadium/schema';
import { useStadiumStore } from './state/useStadiumStore';

const NODE_LABELS: Record<EditorNode, string> = {
  bowl: 'Enceinte et terrain',
  stand: 'Tribunes',
  roof: 'Toiture',
  materials: 'Façade et matériaux',
  site: 'Environnement',
  objects: 'Équipements',
  projects: 'Mes projets',
};

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
  const [node, setNode] = useState<EditorNode>('bowl');

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

  // Picking an object in the 3D scene opens its inspector.
  useEffect(() => {
    if (selectedObjectId) setNode('objects');
  }, [selectedObjectId]);

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
          selectObject(null);
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

      <div className="relative flex flex-1 min-h-0">
        {!panelsHidden && (
          <aside
            aria-label="Structure"
            className="hidden lg:block w-60 shrink-0 bg-panel border-r border-line"
          >
            <StructureTree node={node} onSelect={setNode} />
          </aside>
        )}

        <main className="relative flex-1 min-w-0">
          <h1 className="sr-only">{doc.name}</h1>
          <Viewport />
          <MetricStrip metrics={metrics} docId={doc.id} />
        </main>

        {!panelsHidden && (
          <aside
            aria-label={`Propriétés : ${NODE_LABELS[node]}`}
            className="absolute lg:static inset-y-0 right-0 z-20 flex flex-col w-[min(300px,100%)] lg:w-[300px] shrink-0 bg-panel border-l border-line max-lg:shadow-[-8px_0_24px_rgb(0_0_0/0.4)]"
          >
            <div className="lg:hidden flex items-center gap-2 px-3 py-2 border-b border-line">
              <div className="md:hidden">
                <LightingControl />
              </div>
              <select
                aria-label="Élément à modifier"
                value={node}
                onChange={(e) => setNode(e.target.value as EditorNode)}
                className="flex-1 min-w-0 h-8 px-2 text-xs text-ink bg-field rounded border border-edge hover:border-edge-hover"
              >
                {(Object.keys(NODE_LABELS) as EditorNode[]).map((n) => (
                  <option key={n} value={n}>
                    {NODE_LABELS[n]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <Inspector node={node} />
            </div>
          </aside>
        )}
      </div>

      <OnboardingDialog open={examplesOpen} onClose={() => setExamplesOpen(false)} />
    </div>
  );
}

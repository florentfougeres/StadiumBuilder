/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ImageDown,
  PanelBottom,
  PanelRight,
  SlidersHorizontal,
} from 'lucide-react';
import { ExportProjectPanel } from './editor/ExportProjectPanel';
import { DockSection, Inspector } from './editor/Inspector';
import { ObjectList } from './editor/ObjectList';
import { Toolbar } from './editor/Toolbar';
import { Viewport } from './editor/Viewport';
import { exportViewportPng } from './export/exportPng';
import { calculateStadiumMetrics } from './stadium/capacity';
import { useStadiumStore } from './state/useStadiumStore';

const NAV_SECTIONS: { id: DockSection; label: string }[] = [
  { id: 'architecture', label: 'Architecture' },
  { id: 'stands', label: 'Tribunes' },
  { id: 'roof_colors', label: 'Toiture & Matériaux' },
  { id: 'objects', label: 'Équipements 3D' },
  { id: 'exports', label: 'Presets & Exports' },
];

export default function App() {
  const [activeSection, setActiveSection] = useState<DockSection>('architecture');
  const [layoutMode, setLayoutMode] = useState<'sidebar' | 'dock'>('sidebar');

  const doc = useStadiumStore((s) => s.doc);
  const dockCollapsed = useStadiumStore((s) => s.dockCollapsed);
  const toggleDockCollapsed = useStadiumStore((s) => s.toggleDockCollapsed);
  const initFromDb = useStadiumStore((s) => s.initFromDb);
  const setTransformMode = useStadiumStore((s) => s.setTransformMode);
  const selectedObjectId = useStadiumStore((s) => s.selectedObjectId);
  const removeObject = useStadiumStore((s) => s.removeObject);
  const selectObject = useStadiumStore((s) => s.selectObject);
  const undo = useStadiumStore((s) => s.undo);
  const redo = useStadiumStore((s) => s.redo);

  const metrics = useMemo(() => calculateStadiumMetrics(doc), [doc]);

  useEffect(() => {
    initFromDb();
  }, [initFromDb]);

  // Global CAD Keyboard Shortcuts (G/R/S gizmo, H collapse panel, Delete object, Ctrl+Z / Ctrl+Y)
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
          toggleDockCollapsed();
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
  }, [
    redo,
    removeObject,
    selectObject,
    selectedObjectId,
    setTransformMode,
    toggleDockCollapsed,
    undo,
  ]);

  return (
    <div className="flex flex-col w-full h-[100dvh] overflow-hidden bg-slate-950 text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-6 px-5 py-2.5 bg-slate-950 border-b border-slate-800/90 z-30 shrink-0">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveSection('architecture');
            if (dockCollapsed) toggleDockCollapsed();
          }}
          className="text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 font-[var(--font-display)]"
        >
          StadiumForge
        </a>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-slate-400">
          {NAV_SECTIONS.map((nav) => {
            const isActive = activeSection === nav.id && !dockCollapsed;
            return (
              <button
                key={nav.id}
                type="button"
                onClick={() => {
                  setActiveSection(nav.id);
                  if (dockCollapsed) toggleDockCollapsed();
                }}
                className={`py-0.5 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  isActive
                    ? 'text-white border-emerald-500'
                    : 'border-transparent hover:text-slate-100 hover:border-slate-700'
                }`}
              >
                {nav.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => exportViewportPng(doc.name)}
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <ImageDown className="w-3.5 h-3.5" />
            <span>Exporter PNG</span>
          </button>
        </div>
      </header>

      {/* Main Split Workspace: Left 3D Viewport + Right Scrollable Builder Sidebar (or Bottom Dock) */}
      <div className="flex flex-col lg:flex-row flex-1 min-h-0 w-full overflow-hidden">
        {/* 3D Spatial Viewport Area */}
        <main className="relative flex-1 min-w-0 min-h-[260px] h-full overflow-hidden">
          <Viewport />

          {/* Top-Left Architectural KPI Readout */}
          <div className="pointer-events-none absolute top-3 left-4 z-10 bg-slate-950/90 border border-slate-800/90 rounded-lg px-3.5 py-2 max-w-[calc(100%-2rem)]">
            <h1 className="text-sm font-semibold text-white tracking-wide truncate font-[var(--font-display)]">
              {doc.name}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-xs text-slate-300 font-mono tabular-nums">
              <span className="text-emerald-400 font-semibold">
                {metrics.totalCapacity.toLocaleString('fr-FR')} places
              </span>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span>{metrics.totalRowsAvg} rg moy.</span>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span>{metrics.builtFootprintM2.toLocaleString('fr-FR')} m²</span>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span>C-Value {metrics.avgCValueMm} mm</span>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span className="text-amber-300 font-semibold">
                ~{metrics.estimatedBudgetMillionsEur} M€
              </span>
            </div>
          </div>

          {/* Floating Viewport Toolbar (Top-Right inside 3D Viewport so it never gets cut off) */}
          <div className="absolute top-3 right-4 z-10 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                setLayoutMode((prev) => (prev === 'sidebar' ? 'dock' : 'sidebar'))
              }
              title={
                layoutMode === 'sidebar'
                  ? 'Passer en panneau bas'
                  : 'Passer en panneau latéral complet'
              }
              className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:text-white bg-slate-950/92 hover:bg-slate-900 border border-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {layoutMode === 'sidebar' ? (
                <>
                  <PanelBottom className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Mode Dock Bas</span>
                </>
              ) : (
                <>
                  <PanelRight className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Panneau Latéral</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={toggleDockCollapsed}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:text-white bg-slate-950/92 hover:bg-slate-900 border border-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
              <span>{dockCollapsed ? 'Afficher constructeur (H)' : 'Plein écran 3D (H)'}</span>
            </button>
          </div>

          {/* Optional Compact Bottom Dock Mode (Fully Scrollable Within Viewport Height) */}
          {layoutMode === 'dock' && !dockCollapsed && (
            <section
              aria-label="Atelier paramétrique du stade"
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 w-[min(960px,96%)] max-h-[calc(100%-4.5rem)] flex flex-col bg-slate-900/96 border border-slate-800 rounded-xl shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-2 bg-slate-950 border-b border-slate-800 shrink-0">
                <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar">
                  {NAV_SECTIONS.map((nav) => (
                    <button
                      key={nav.id}
                      type="button"
                      onClick={() => setActiveSection(nav.id)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                        activeSection === nav.id
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      {nav.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={toggleDockCollapsed}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-white ml-2 shrink-0"
                >
                  <ChevronDown className="w-4 h-4" />
                  <span className="hidden sm:inline">Réduire</span>
                </button>
              </div>

              <div className="p-3.5 overflow-y-auto custom-scrollbar min-h-0">
                <Toolbar />
                {(activeSection === 'architecture' ||
                  activeSection === 'stands' ||
                  activeSection === 'roof_colors') && (
                  <Inspector section={activeSection} layout="dock" />
                )}
                {activeSection === 'objects' && <ObjectList layout="dock" />}
                {activeSection === 'exports' && <ExportProjectPanel layout="dock" />}
              </div>
            </section>
          )}
        </main>

        {/* Full-Height Scrollable Right Builder Sidebar (Default Mode: Never Clipped, Shows All Controls Comfortably) */}
        {layoutMode === 'sidebar' && !dockCollapsed && (
          <aside
            aria-label="Panneau de construction du stade"
            className="w-full lg:w-[430px] xl:w-[460px] h-[52dvh] lg:h-full bg-slate-900 border-t lg:border-t-0 lg:border-l border-slate-800 flex flex-col shrink-0 z-20"
          >
            {/* Sticky Section Tabs inside Builder Panel */}
            <div className="p-3 bg-slate-950 border-b border-slate-800 shrink-0 space-y-2.5">
              <Toolbar />

              <div className="grid grid-cols-5 gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
                {NAV_SECTIONS.map((nav) => {
                  const active = activeSection === nav.id;
                  return (
                    <button
                      key={nav.id}
                      type="button"
                      onClick={() => setActiveSection(nav.id)}
                      className={`px-1.5 py-1.5 text-[11px] font-medium rounded-md text-center truncate transition-colors ${
                        active
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/70'
                      }`}
                      title={nav.label}
                    >
                      {nav.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Scrollable Builder Body — guarantees 100% of parameters are reachable */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 pb-8">
              {(activeSection === 'architecture' ||
                activeSection === 'stands' ||
                activeSection === 'roof_colors') && (
                <Inspector section={activeSection} layout="sidebar" />
              )}
              {activeSection === 'objects' && <ObjectList layout="sidebar" />}
              {activeSection === 'exports' && <ExportProjectPanel layout="sidebar" />}
            </div>
          </aside>
        )}

        {/* Mobile / Collapsed quick restore bar at bottom if user hid the panel */}
        {dockCollapsed && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
            <button
              type="button"
              onClick={toggleDockCollapsed}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg shadow-lg transition-colors whitespace-nowrap"
            >
              <ChevronUp className="w-4 h-4" />
              <span>Ouvrir le panneau de construction (H)</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

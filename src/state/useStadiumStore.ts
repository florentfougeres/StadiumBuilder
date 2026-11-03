import { create } from 'zustand';
import {
  calculateStadiumMetrics,
  computeKopWallStandPatch,
} from '../stadium/capacity';
import {
  FACADE_MATERIAL_CATALOG,
  ROOF_MATERIAL_CATALOG,
  TRACK_MATERIAL_CATALOG,
  TURF_MATERIAL_CATALOG,
} from '../stadium/materials';
import { createPresetDocument } from '../stadium/presets';
import {
  CameraPresetMode,
  clampPitchToTrack,
  ConcourseConfig,
  CornerId,
  CornerMode,
  DEFAULT_STADIUM_MATERIALS,
  FloodlightRigMode,
  LightingMode,
  PitchConfig,
  PlacedObject,
  PlacedObjectType,
  resolveAllCorners,
  riserFromSlopeDeg,
  RoofConfig,
  SiteConfig,
  StadiumColors,
  StadiumDocument,
  StadiumMaterialsConfig,
  StadiumShape,
  StandConfig,
  StandSide,
  StandTierConfig,
  TransformMode,
} from '../stadium/schema';
import { resolveStandTiers } from '../stadium/sightlines';
import {
  deleteProjectFromDb,
  listProjectsFromDb,
  SavedStadiumRecord,
  saveProjectToDb,
} from './db';
import { cloneDocument, HistoryState, pushHistorySnapshot } from './history';

const OBJECT_TYPE_LABELS: Record<PlacedObjectType, string> = {
  screen: 'Écran Géant LED',
  halo_screen: 'Écran Halo Central',
  floodlight: 'Pylône d’Éclairage',
  dugout: 'Bancs de Touche',
  locker_room: 'Vestiaires & Médias',
  shop: 'Boutique Officielle',
  parking: 'Parking Spectateurs',
  esplanade: 'Esplanade & Parvis',
  fence: 'Clôture Périmétrique',
  custom_roof: 'Auvent Modulaire',
};

const OBJECT_DEFAULT_SPAWN: Record<PlacedObjectType, [number, number, number]> = {
  screen: [58, 16, -38],
  // Hung over the centre circle, high enough to clear the ball's flight.
  halo_screen: [0, 30, 0],
  floodlight: [68, 0, -48],
  dugout: [0, 0, 37.5],
  locker_room: [-52, 0, 88],
  shop: [46, 0, 88],
  parking: [118, 0, 42],
  esplanade: [0, 0, 96],
  fence: [0, 0, 74],
  custom_roof: [0, 0, -76],
};

export interface StadiumStoreState {
  doc: StadiumDocument;
  history: HistoryState;
  selectedObjectId: string | null;
  /** Stand shown in the inspector, or `all` to edit the four stands together. */
  activeStandTab: StandTarget;
  cameraMode: CameraPresetMode;
  cameraTriggerNonce: number;
  transformMode: TransformMode;
  dockCollapsed: boolean;
  examplesOpen: boolean;
  savedProjects: SavedStadiumRecord[];
  lastSavedAt: number | null;

  // Actions
  initFromDb: () => Promise<void>;
  loadPreset: (presetId: string) => void;
  loadDocument: (doc: StadiumDocument) => void;
  deleteSavedProject: (id: string) => Promise<void>;
  saveCurrentNow: () => Promise<void>;

  setProjectName: (name: string) => void;
  setShape: (shape: StadiumShape) => void;
  setSunkenDepth: (depth: number) => void;
  setCornerFill: (fill: boolean) => void;
  setCornerMode: (corner: CornerId, mode: CornerMode) => void;
  setAllCorners: (mode: CornerMode) => void;
  setFloodlightRig: (mode: FloodlightRigMode) => void;
  setLighting: (lighting: LightingMode) => void;
  updatePitch: (patch: Partial<PitchConfig>) => void;
  updateStand: (target: StandTarget, patch: Partial<StandConfig>) => void;
  updateStandTier: (
    target: StandTarget,
    tierIndex: number,
    patch: Partial<StandTierConfig>
  ) => void;
  resetStandTiersUniform: (target: StandTarget) => void;
  convertStandToKopWall: (target: StandTarget) => void;
  applyTargetCapacity: (targetCapacity: number) => void;
  updateRoof: (patch: Partial<RoofConfig>) => void;
  updateConcourse: (patch: Partial<ConcourseConfig>) => void;
  updateSite: (patch: Partial<SiteConfig>) => void;
  updateColors: (patch: Partial<StadiumColors>) => void;
  updateMaterials: (patch: Partial<StadiumMaterialsConfig>) => void;

  // Objects & Gizmos
  addObject: (type: PlacedObjectType) => void;
  selectObject: (id: string | null) => void;
  updateObjectTransform: (
    id: string,
    patch: Partial<
      Pick<PlacedObject, 'position' | 'rotation' | 'scale' | 'name' | 'color' | 'mount' | 'mountSide'>
    >,
    recordHistory?: boolean
  ) => void;
  recordSnapshotBeforeGizmoDrag: () => void;
  duplicateSelectedObject: () => void;
  removeObject: (id: string) => void;

  // View & UI
  setActiveStandTab: (target: StandTarget) => void;
  setCameraMode: (mode: CameraPresetMode) => void;
  setTransformMode: (mode: TransformMode) => void;
  toggleDockCollapsed: () => void;
  setExamplesOpen: (open: boolean) => void;

  // History
  undo: () => void;
  redo: () => void;
}

let autosaveTimer: number | null = null;
function scheduleAutosave(doc: StadiumDocument, onSaved: (ts: number) => void) {
  if (autosaveTimer !== null) {
    window.clearTimeout(autosaveTimer);
  }
  autosaveTimer = window.setTimeout(async () => {
    const metrics = calculateStadiumMetrics(doc);
    await saveProjectToDb(doc, metrics.totalCapacity);
    onSaved(Date.now());
  }, 550);
}

const LEGACY_NAME_RE =
  /emirates|stade de france|at&t|marvingt|roazhon|bernab|allianz|olimpico|rome|beşiktaş|besiktas|villa park|tottenham|havre|wembley|dortmund|südtribüne|sudtribune|bordeaux|matmut|munich|maracan|francfort|amsterdam|cardiff|gelsenkirchen|mauroy/i;

function sanitizeLegacyNames(doc: StadiumDocument): void {
  if (LEGACY_NAME_RE.test(doc.name)) {
    doc.name = 'Projet Stade Paramétrique';
  }
  const genericStandNames: Record<StandSide, string> = {
    north: 'Tribune Nord',
    south: 'Tribune Principale Sud',
    east: 'Virage Est',
    west: 'Virage Ouest',
  };
  (['north', 'south', 'east', 'west'] as StandSide[]).forEach((s) => {
    if (LEGACY_NAME_RE.test(doc.stands[s].name)) {
      doc.stands[s].name = genericStandNames[s];
    }
  });
}

/**
 * Upgrades documents saved by older versions:
 * - renames legacy roof styles
 * - fills missing PBR materials and `overConcourse = true` default
 * - clamps pitch dimensions inside the 400 m track kerb when `hasTrack` is enabled
 */
export function normalizeStadiumDocument(doc: StadiumDocument): StadiumDocument {
  const legacyRoofStyle = doc.roof.style as string;
  if (legacyRoofStyle === 'bowl_canopy') {
    doc.roof.style = 'bicycle_wheel';
  } else if (legacyRoofStyle === 'retractable_arch') {
    doc.roof.style = 'retractable';
  }
  if (doc.roof.overConcourse === undefined) {
    doc.roof.overConcourse = true;
  }
  doc.pitch = clampPitchToTrack(doc.pitch);
  doc.materials = {
    ...DEFAULT_STADIUM_MATERIALS,
    ...(doc.materials ?? {}),
  };
  sanitizeLegacyNames(doc);
  return doc;
}

/** A single stand, or all four edited together. */
export type StandTarget = StandSide | 'all';

const ALL_STANDS: StandSide[] = ['north', 'south', 'east', 'west'];
const standsOf = (target: StandTarget): StandSide[] => (target === 'all' ? ALL_STANDS : [target]);

/** Applies an inspector edit to one stand, keeping rows, tiers and rake consistent. */
function applyStandPatch(d: StadiumDocument, side: StandSide, patch: Partial<StandConfig>): void {
  const prev = d.stands[side];
  const next = { ...prev, ...patch };
  if (patch.tiers !== undefined && patch.rows === undefined && patch.tiers !== prev.tiers) {
    if (patch.tiers === 1 && prev.tiers > 1) {
      const kopPatch = computeKopWallStandPatch(
        d,
        side,
        next.seatingType ?? 'seated'
      );
      next.rows = kopPatch.rows ?? prev.rows;
      next.tierConfigs = undefined;
    } else {
      const deltaRows = (patch.tiers - prev.tiers) * 14;
      next.rows = Math.max(patch.tiers * 8, Math.min(108, prev.rows + deltaRows));
      if (prev.tierConfigs && prev.tierConfigs.length > 0) {
        const resized: StandTierConfig[] = prev.tierConfigs
          .slice(0, patch.tiers)
          .map((tc) => ({ ...tc }));
        while (resized.length < patch.tiers) {
          const idx = resized.length;
          resized.push({
            rows: 14,
            slopeAngleDeg: Math.min(40, (prev.slopeAngleDeg ?? 28) + idx * 1.8),
          });
        }
        next.tierConfigs = resized;
        next.rows = resized.reduce((sum, tc) => sum + tc.rows, 0);
      }
    }
  } else if (
    prev.tierConfigs &&
    prev.tierConfigs.length === next.tiers &&
    patch.tierConfigs === undefined
  ) {
    if (patch.rows !== undefined && patch.rows !== prev.rows) {
      const prevSum = Math.max(1, prev.tierConfigs.reduce((s, tc) => s + tc.rows, 0));
      const scale = patch.rows / prevSum;
      next.tierConfigs = prev.tierConfigs.map((tc) => ({
        ...tc,
        rows: Math.max(3, Math.round(tc.rows * scale)),
      }));
      next.rows = next.tierConfigs.reduce((s, tc) => s + tc.rows, 0);
    }
    if (patch.slopeAngleDeg !== undefined && prev.slopeAngleDeg !== undefined) {
      const deltaSlope = patch.slopeAngleDeg - prev.slopeAngleDeg;
      next.tierConfigs = (next.tierConfigs ?? prev.tierConfigs).map((tc) => ({
        ...tc,
        slopeAngleDeg: Number(
          Math.max(15, Math.min(42, tc.slopeAngleDeg + deltaSlope)).toFixed(1)
        ),
      }));
    }
  }
  if (patch.slopeAngleDeg !== undefined) {
    next.riserHeight = riserFromSlopeDeg(patch.slopeAngleDeg, next.rowDepth);
  } else if (patch.riserHeight !== undefined || patch.rowDepth !== undefined) {
    next.slopeAngleDeg = Number(
      ((Math.atan2(next.riserHeight, next.rowDepth) * 180) / Math.PI).toFixed(1)
    );
  }
  d.stands[side] = next;
}

/** Edits one tier of a stand, switching it to explicit per-tier settings. */
function applyStandTierPatch(
  d: StadiumDocument,
  side: StandSide,
  tierIndex: number,
  patch: Partial<StandTierConfig>
): void {
  const prev = d.stands[side];
  const resolved = resolveStandTiers(prev);
  const configs: StandTierConfig[] = resolved.map((spec, idx) => ({
    rows: spec.rows,
    slopeAngleDeg: spec.slopeAngleDeg,
    overhang: prev.tierConfigs?.[idx]?.overhang,
  }));
  if (tierIndex < 0 || tierIndex >= configs.length) return;

  const target = { ...configs[tierIndex], ...patch };
  target.rows = Math.max(3, Math.min(72, Math.round(target.rows)));
  target.slopeAngleDeg = Number(
    Math.max(15, Math.min(42, target.slopeAngleDeg)).toFixed(1)
  );
  if (target.overhang !== undefined) {
    target.overhang = Number(Math.max(0, Math.min(8, target.overhang)).toFixed(2));
  }
  configs[tierIndex] = target;

  const totalRows = configs.reduce((sum, tc) => sum + tc.rows, 0);
  const weightedSlope =
    configs.reduce((sum, tc) => sum + tc.slopeAngleDeg * tc.rows, 0) /
    Math.max(1, totalRows);
  const roundedSlope = Number(weightedSlope.toFixed(1));

  d.stands[side] = {
    ...prev,
    rows: totalRows,
    slopeAngleDeg: roundedSlope,
    riserHeight: riserFromSlopeDeg(roundedSlope, prev.rowDepth),
    tierConfigs: configs,
  };
}

export const useStadiumStore = create<StadiumStoreState>((set, get) => {
  const initialDoc = createPresetDocument('bowl_bowstring_60k');

  const commitChange = (mutator: (draft: StadiumDocument) => void) => {
    const { doc, history } = get();
    const nextHistory = pushHistorySnapshot(history, doc);
    const nextDoc = cloneDocument(doc);
    mutator(nextDoc);
    nextDoc.updatedAt = Date.now();

    set({ doc: nextDoc, history: nextHistory });
    scheduleAutosave(nextDoc, async (ts) => {
      const list = await listProjectsFromDb();
      set({ lastSavedAt: ts, savedProjects: list });
    });
  };

  return {
    doc: initialDoc,
    history: { past: [], future: [] },
    selectedObjectId: null,
    activeStandTab: 'south',
    cameraMode: 'drone',
    cameraTriggerNonce: 1,
    transformMode: 'translate',
    dockCollapsed: false,
    examplesOpen: false,
    savedProjects: [],
    lastSavedAt: null,

    initFromDb: async () => {
      const projects = await listProjectsFromDb();
      if (projects.length > 0) {
        const restored = normalizeStadiumDocument(cloneDocument(projects[0].document));
        set({
          doc: restored,
          savedProjects: projects,
          lastSavedAt: projects[0].updatedAt,
          history: { past: [], future: [] },
        });
      } else {
        const current = get().doc;
        const metrics = calculateStadiumMetrics(current);
        await saveProjectToDb(current, metrics.totalCapacity);
        const updatedList = await listProjectsFromDb();
        set({ savedProjects: updatedList, lastSavedAt: Date.now() });
      }
    },

    loadPreset: (presetId) => {
      const { doc, history } = get();
      const nextHistory = pushHistorySnapshot(history, doc);
      const nextDoc = createPresetDocument(presetId);
      set({
        doc: nextDoc,
        history: nextHistory,
        selectedObjectId: null,
        cameraMode: 'drone',
        cameraTriggerNonce: get().cameraTriggerNonce + 1,
      });
      scheduleAutosave(nextDoc, async (ts) => {
        const list = await listProjectsFromDb();
        set({ lastSavedAt: ts, savedProjects: list });
      });
    },

    loadDocument: (incoming) => {
      const { doc, history } = get();
      const nextHistory = pushHistorySnapshot(history, doc);
      const clean = normalizeStadiumDocument(cloneDocument(incoming));
      clean.updatedAt = Date.now();
      set({
        doc: clean,
        history: nextHistory,
        selectedObjectId: null,
        cameraTriggerNonce: get().cameraTriggerNonce + 1,
      });
      scheduleAutosave(clean, async (ts) => {
        const list = await listProjectsFromDb();
        set({ lastSavedAt: ts, savedProjects: list });
      });
    },

    deleteSavedProject: async (id) => {
      await deleteProjectFromDb(id);
      const list = await listProjectsFromDb();
      set({ savedProjects: list });
    },

    saveCurrentNow: async () => {
      const { doc } = get();
      const metrics = calculateStadiumMetrics(doc);
      await saveProjectToDb(doc, metrics.totalCapacity);
      const list = await listProjectsFromDb();
      set({ savedProjects: list, lastSavedAt: Date.now() });
    },

    setProjectName: (name) =>
      commitChange((d) => {
        d.name = name;
      }),

    setShape: (shape) =>
      commitChange((d) => {
        const prevShape = d.shape;
        d.shape = shape;
        d.corners = undefined;

        if (prevShape === 'horseshoe' && shape !== 'horseshoe') {
          d.stands.east.enabled = true;
        }
        if (prevShape === 'sunken_bowl' && shape !== 'sunken_bowl' && d.sunkenDepth === 9) {
          d.sunkenDepth = 0;
        }

        if (shape === 'sunken_bowl') {
          d.cornerFill = true;
          d.sunkenDepth = d.sunkenDepth && d.sunkenDepth >= 2 ? d.sunkenDepth : 9.0;
          if (d.roof.style === 'truss') d.roof.style = 'cantilever';
        } else if (shape === 'horseshoe') {
          d.cornerFill = true;
          d.stands.north.enabled = true;
          d.stands.south.enabled = true;
          d.stands.west.enabled = true;
          d.stands.east.enabled = false;
          if (
            d.roof.style === 'truss' ||
            d.roof.style === 'retractable' ||
            d.roof.style === 'petal_iris'
          ) {
            d.roof.style = 'cantilever';
          }
        } else if (shape === 'modern_bowl') {
          d.cornerFill = true;
          if (d.roof.style === 'truss') d.roof.style = 'bicycle_wheel';
        } else if (shape === 'steep_cauldron') {
          d.cornerFill = true;
          if (d.roof.style === 'truss') d.roof.style = 'bicycle_wheel';
          (['north', 'south', 'east', 'west'] as StandSide[]).forEach((s) => {
            d.stands[s].distanceToPitch = Math.min(d.stands[s].distanceToPitch, 6.2);
            if ((d.stands[s].slopeAngleDeg ?? 28) < 33.5) {
              d.stands[s].slopeAngleDeg = 34.5;
              d.stands[s].riserHeight = Number(
                (Math.tan((34.5 * Math.PI) / 180) * d.stands[s].rowDepth).toFixed(3)
              );
            }
          });
        } else if (shape === 'olympic_oval') {
          d.cornerFill = true;
          d.pitch.hasTrack = true;
          if (d.roof.style === 'truss') d.roof.style = 'suspended_masts';
          (['north', 'south', 'east', 'west'] as StandSide[]).forEach((s) => {
            if ((d.stands[s].slopeAngleDeg ?? 28) > 28.5) {
              d.stands[s].slopeAngleDeg = 26;
              d.stands[s].riserHeight = Number(
                (Math.tan((26 * Math.PI) / 180) * d.stands[s].rowDepth).toFixed(3)
              );
            }
          });
        } else if (shape === 'octagonal_arena') {
          d.cornerFill = true;
          if (d.roof.style === 'truss') d.roof.style = 'cantilever';
        } else if (shape === 'compact_urban') {
          d.cornerFill = true;
          if (d.roof.style === 'bicycle_wheel') d.roof.style = 'cantilever';
          (['north', 'south', 'east', 'west'] as StandSide[]).forEach((s) => {
            d.stands[s].distanceToPitch = Math.min(d.stands[s].distanceToPitch, 5.8);
            if ((d.stands[s].slopeAngleDeg ?? 28) < 32) {
              d.stands[s].slopeAngleDeg = 34;
              d.stands[s].riserHeight = Number(
                (Math.tan((34 * Math.PI) / 180) * d.stands[s].rowDepth).toFixed(3)
              );
            }
            if (
              d.stands[s].tiers < 2 &&
              d.stands[s].rows >= 20 &&
              d.stands[s].seatingType !== 'safe_standing'
            ) {
              d.stands[s].tiers = 3;
            }
          });
        } else if (shape === 'four_stands') {
          d.cornerFill = false;
          if (d.roof.style === 'bicycle_wheel') d.roof.style = 'truss';
        }
        d.pitch = clampPitchToTrack(d.pitch);
      }),

    setSunkenDepth: (depth) =>
      commitChange((d) => {
        d.sunkenDepth = Math.max(0, Math.min(16, Number(depth.toFixed(1))));
      }),

    setCornerFill: (fill) =>
      commitChange((d) => {
        d.cornerFill = fill;
        if (d.corners) {
          const mode: CornerMode = fill ? 'filled' : 'open';
          d.corners = { nw: mode, ne: mode, sw: mode, se: mode };
        }
      }),

    setCornerMode: (corner, mode) =>
      commitChange((d) => {
        const current = resolveAllCorners(d);
        const nextCorners: Record<CornerId, CornerMode> = {
          ...current,
          [corner]: mode,
        };
        d.corners = nextCorners;
        d.cornerFill = Object.values(nextCorners).some((m) => m !== 'open');
      }),

    setAllCorners: (mode) =>
      commitChange((d) => {
        d.corners = { nw: mode, ne: mode, sw: mode, se: mode };
        d.cornerFill = mode !== 'open';
      }),

    setFloodlightRig: (mode) =>
      commitChange((d) => {
        d.floodlightRig = mode;
      }),

    setLighting: (lighting) =>
      commitChange((d) => {
        d.lighting = lighting;
      }),

    updatePitch: (patch) =>
      commitChange((d) => {
        d.pitch = clampPitchToTrack({ ...d.pitch, ...patch });
      }),

    updateStand: (target, patch) =>
      commitChange((d) => {
        for (const side of standsOf(target)) applyStandPatch(d, side, patch);
      }),

    updateStandTier: (target, tierIndex, patch) =>
      commitChange((d) => {
        for (const side of standsOf(target)) applyStandTierPatch(d, side, tierIndex, patch);
      }),

    resetStandTiersUniform: (target) =>
      commitChange((d) => {
        for (const side of standsOf(target)) {
          d.stands[side] = { ...d.stands[side], tierConfigs: undefined };
        }
      }),

    convertStandToKopWall: (target) =>
      commitChange((d) => {
        for (const side of standsOf(target)) {
          const kopPatch = computeKopWallStandPatch(d, side, 'safe_standing');
          d.stands[side] = { ...d.stands[side], ...kopPatch, tierConfigs: undefined };
        }
      }),

    applyTargetCapacity: (targetCapacity) =>
      commitChange((d) => {
        const sides: StandSide[] = ['north', 'south', 'east', 'west'];
        const active = sides.filter((s) => d.stands[s].enabled);
        if (active.length === 0) return;

        const tiersForRows = (r: number): 1 | 2 | 3 | 4 | 5 =>
          r >= 70 ? 5 : r >= 54 ? 4 : r >= 38 ? 3 : r >= 24 ? 2 : 1;

        let bestRows = 24;
        let smallestError = Infinity;
        for (let candidateRows = 6; candidateRows <= 104; candidateRows++) {
          const testDoc = cloneDocument(d);
          for (const s of active) {
            const isEnd = s === 'east' || s === 'west';
            const rCount = isEnd
              ? Math.max(6, Math.round(candidateRows * 0.92))
              : candidateRows;
            testDoc.stands[s].rows = rCount;
            if (testDoc.stands[s].seatingType !== 'safe_standing' || testDoc.stands[s].tiers > 1) {
              testDoc.stands[s].tiers = tiersForRows(rCount);
            }
          }
          const cap = calculateStadiumMetrics(testDoc).totalCapacity;
          const err = Math.abs(cap - targetCapacity);
          if (err < smallestError) {
            smallestError = err;
            bestRows = candidateRows;
          }
        }

        for (const s of active) {
          const isEnd = s === 'east' || s === 'west';
          const rCount = isEnd ? Math.max(6, Math.round(bestRows * 0.92)) : bestRows;
          d.stands[s].rows = rCount;
          if (d.stands[s].seatingType !== 'safe_standing' || d.stands[s].tiers > 1) {
            d.stands[s].tiers = tiersForRows(rCount);
          }
        }
      }),

    updateRoof: (patch) =>
      commitChange((d) => {
        d.roof = { ...d.roof, ...patch };
      }),

    updateConcourse: (patch) =>
      commitChange((d) => {
        d.concourse = { width: 0, heightRatio: 0.5, ...d.concourse, ...patch };
      }),

    updateSite: (patch) =>
      commitChange((d) => {
        d.site = { ...d.site, ...patch };
      }),

    updateColors: (patch) =>
      commitChange((d) => {
        d.colors = { ...d.colors, ...patch };
      }),

    updateMaterials: (patch) =>
      commitChange((d) => {
        const nextMats: StadiumMaterialsConfig = {
          ...DEFAULT_STADIUM_MATERIALS,
          ...(d.materials ?? {}),
          ...patch,
        };
        d.materials = nextMats;

        // Keep 2D plan / PDF export fallback colors synchronized with chosen PBR materials
        if (patch.facade) {
          const found = FACADE_MATERIAL_CATALOG.find((m) => m.id === patch.facade);
          if (found) d.colors.facade = found.fallbackHex;
        }
        if (patch.roof) {
          const found = ROOF_MATERIAL_CATALOG.find((m) => m.id === patch.roof);
          if (found) d.colors.roof = found.fallbackHex;
        }
        if (patch.pitchTurf) {
          const found = TURF_MATERIAL_CATALOG.find((m) => m.id === patch.pitchTurf);
          if (found) d.colors.pitchPrimary = found.fallbackHex;
        }
        if (patch.trackSurface) {
          const found = TRACK_MATERIAL_CATALOG.find((m) => m.id === patch.trackSurface);
          if (found) d.colors.track = found.fallbackHex;
        }
      }),

    addObject: (type) => {
      const { doc, history } = get();
      const nextHistory = pushHistorySnapshot(history, doc);
      const nextDoc = cloneDocument(doc);

      const basePos = OBJECT_DEFAULT_SPAWN[type];
      const countOfType = nextDoc.objects.filter((o) => o.type === type).length;
      const jitterOffset = countOfType * 8;
      const newId = `obj-${type}-${Date.now().toString(36)}`;

      const created: PlacedObject = {
        id: newId,
        type,
        name: `${OBJECT_TYPE_LABELS[type]} ${countOfType + 1}`,
        position: [basePos[0] + jitterOffset, basePos[1], basePos[2]],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      };
      if (type === 'screen') {
        // New screens start fixed to an end stand rather than floating in mid-air.
        created.mount = nextDoc.roof.style === 'none' ? 'stand' : 'roof';
        created.mountSide = countOfType % 2 === 0 ? 'west' : 'east';
        created.position = [0, 0, 0];
      }

      nextDoc.objects.push(created);
      nextDoc.updatedAt = Date.now();
      set({
        doc: nextDoc,
        history: nextHistory,
        selectedObjectId: newId,
      });
      scheduleAutosave(nextDoc, async (ts) => {
        const list = await listProjectsFromDb();
        set({ lastSavedAt: ts, savedProjects: list });
      });
    },

    selectObject: (id) => set({ selectedObjectId: id }),

    recordSnapshotBeforeGizmoDrag: () => {
      const { doc, history } = get();
      set({ history: pushHistorySnapshot(history, doc) });
    },

    updateObjectTransform: (id, patch, recordHistory = true) => {
      const { doc, history } = get();
      const nextHistory = recordHistory ? pushHistorySnapshot(history, doc) : history;
      const nextDoc = cloneDocument(doc);
      const target = nextDoc.objects.find((o) => o.id === id);
      if (!target) return;

      if (patch.position) target.position = patch.position;
      if (patch.rotation) target.rotation = patch.rotation;
      if (patch.scale) target.scale = patch.scale;
      if (patch.name !== undefined) target.name = patch.name;
      if (patch.color !== undefined) target.color = patch.color;
      if (patch.mount !== undefined) target.mount = patch.mount;
      if (patch.mountSide !== undefined) target.mountSide = patch.mountSide;

      nextDoc.updatedAt = Date.now();
      set({ doc: nextDoc, history: nextHistory });
      scheduleAutosave(nextDoc, async (ts) => {
        const list = await listProjectsFromDb();
        set({ lastSavedAt: ts, savedProjects: list });
      });
    },

    duplicateSelectedObject: () => {
      const { selectedObjectId, doc, history } = get();
      if (!selectedObjectId) return;
      const source = doc.objects.find((o) => o.id === selectedObjectId);
      if (!source) return;

      const nextHistory = pushHistorySnapshot(history, doc);
      const nextDoc = cloneDocument(doc);
      const copyId = `obj-${source.type}-${Date.now().toString(36)}`;
      nextDoc.objects.push({
        ...cloneDocument(source as unknown as StadiumDocument) as unknown as PlacedObject,
        id: copyId,
        name: `${source.name} (Copie)`,
        position: [source.position[0] + 10, source.position[1], source.position[2] + 6],
      });
      nextDoc.updatedAt = Date.now();
      set({ doc: nextDoc, history: nextHistory, selectedObjectId: copyId });
    },

    removeObject: (id) => {
      const { doc, history, selectedObjectId } = get();
      const nextHistory = pushHistorySnapshot(history, doc);
      const nextDoc = cloneDocument(doc);
      nextDoc.objects = nextDoc.objects.filter((o) => o.id !== id);
      nextDoc.updatedAt = Date.now();
      set({
        doc: nextDoc,
        history: nextHistory,
        selectedObjectId: selectedObjectId === id ? null : selectedObjectId,
      });
      scheduleAutosave(nextDoc, async (ts) => {
        const list = await listProjectsFromDb();
        set({ lastSavedAt: ts, savedProjects: list });
      });
    },

    setActiveStandTab: (target) => set({ activeStandTab: target }),

    setCameraMode: (mode) =>
      set((state) => ({
        cameraMode: mode,
        cameraTriggerNonce: state.cameraTriggerNonce + 1,
      })),

    setTransformMode: (mode) => set({ transformMode: mode }),

    toggleDockCollapsed: () =>
      set((state) => ({ dockCollapsed: !state.dockCollapsed })),

    setExamplesOpen: (open) => set({ examplesOpen: open }),

    undo: () => {
      const { history, doc } = get();
      if (history.past.length === 0) return;
      const previous = history.past[history.past.length - 1];
      const nextPast = history.past.slice(0, -1);
      const nextFuture = [cloneDocument(doc), ...history.future];
      set({
        doc: cloneDocument(previous),
        history: { past: nextPast, future: nextFuture },
        selectedObjectId: null,
      });
    },

    redo: () => {
      const { history, doc } = get();
      if (history.future.length === 0) return;
      const next = history.future[0];
      const nextFuture = history.future.slice(1);
      const nextPast = [...history.past, cloneDocument(doc)];
      set({
        doc: cloneDocument(next),
        history: { past: nextPast, future: nextFuture },
        selectedObjectId: null,
      });
    },
  };
});

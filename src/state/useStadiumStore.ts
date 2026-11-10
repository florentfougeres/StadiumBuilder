import { create } from 'zustand';
import {
  calculateStadiumMetrics,
  fitStandRowsToCapacity,
  computeKopWallStandPatch,
} from '../stadium/capacity';
import {
  FACADE_MATERIAL_CATALOG,
  ROOF_MATERIAL_CATALOG,
  TRACK_MATERIAL_CATALOG,
  TURF_MATERIAL_CATALOG,
} from '../stadium/materials';
import { createBlankDocument, createPresetDocument } from '../stadium/presets';
import {
  CameraPresetMode,
  clampPitchToTrack,
  patchPitch,
  SUNKEN_MAX_DEPTH,
  ConcourseConfig,
  CornerId,
  CornerMode,
  DEFAULT_STADIUM_MATERIALS,
  EnvelopeStyle,
  FloodlightRigMode,
  LightingMode,
  PitchConfig,
  PlacedObject,
  PlacedObjectType,
  resolveAllCorners,
  riserFromSlopeDeg,
  RoofConfig,
  RoofStyle,
  SiteConfig,
  StadiumColors,
  StadiumDocument,
  StadiumMaterialsConfig,
  StadiumShape,
  StandConfig,
  StandSide,
  StandTierConfig,
  SeatTierStyle,
  CornerJoin,
  TransformMode,
} from '../stadium/schema';
import { isIntegralShell, isMovableRoof } from '../stadium/roofCatalog';
import { paintSeatStyle, SeatStyleScope, stripSeatStyles } from '../stadium/seatPattern';
import { resolveStandTiers } from '../stadium/sightlines';
import { defaultHaloHeight } from '../stadium/buildStadiumScene';
import {
  deleteProjectFromDb,
  listProjectsFromDb,
  SavedStadiumRecord,
  saveProjectToDb,
} from './db';
import { cloneDocument, HistoryState, pushHistorySnapshot } from './history';

const OBJECT_TYPE_LABELS: Record<PlacedObjectType, string> = {
  screen: 'Écran géant LED',
  halo_screen: 'Écran halo central',
  inclined_mast: 'Mât incliné',
  monumental_arch: 'Arche monumentale',
  monumental_gate: 'Porte monumentale',
  lighthouse: 'Phare',
  galleon: 'Galion',
  tower: 'Tour',
  footbridge: 'Passerelle',
  floodlight: 'Pylône d’éclairage',
  dugout: 'Bancs de touche',
  locker_room: 'Vestiaires & médias',
  shop: 'Boutique officielle',
  parking: 'Parking spectateurs',
  esplanade: 'Esplanade & parvis',
  fence: 'Clôture périmétrique',
  custom_roof: 'Auvent modulaire',
};

const OBJECT_DEFAULT_SPAWN: Record<PlacedObjectType, [number, number, number]> = {
  screen: [58, 16, -38],
  // Hung over the centre circle, high enough to clear the ball's flight.
  halo_screen: [0, 30, 0],
  // Beyond the west end, leaning toward the bowl (local +x points at the centre).
  inclined_mast: [-190, 0, 0],
  monumental_arch: [0, 0, 110],
  monumental_gate: [-40, 0, 110],
  // Beyond the north end, its bridge reaching toward the bowl.
  lighthouse: [-150, 0, -40],
  // Behind the north end stand, above the seats like a ship moored there.
  galleon: [0, 0, -120],
  // Off a corner of the forecourt, like a marathon tower.
  tower: [-150, 0, 90],
  // Beyond the west end, reaching toward the bowl over the old bank.
  footbridge: [-170, 0, 0],
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
  /** Starts a new project from the blank ground. */
  newBlankProject: () => void;
  /** Opens a saved project, keeping its id so edits update the same record. */
  loadDocument: (doc: StadiumDocument) => void;
  /** Opens a project file as a new project, never overwriting a saved one. */
  importDocument: (doc: StadiumDocument) => void;
  /** Copies the current project under a new id and opens the copy. */
  duplicateProject: () => void;
  deleteSavedProject: (id: string) => Promise<void>;
  saveCurrentNow: () => Promise<void>;

  setProjectName: (name: string) => void;
  setShape: (shape: StadiumShape) => void;
  setSunkenDepth: (depth: number) => void;
  setCornerRoundness: (roundness: number) => void;
  /** Breach through a continuous bowl's ring and petal gaps in its upper tiers (`undefined` removes). */
  setRingCuts: (patch: Pick<StadiumDocument, 'ringBreach' | 'upperRingGaps'>) => void;
  setCornerFill: (fill: boolean) => void;
  setCornerMode: (corner: CornerId, mode: CornerMode) => void;
  setAllCorners: (mode: CornerMode) => void;
  setCornerJoin: (join: CornerJoin) => void;
  setCornerAccess: (corner: CornerId, on: boolean) => void;
  setFrontFence: (patch: { frontFence?: 'glass' | 'mesh'; frontFenceHeight?: number }) => void;
  setFloodlightRig: (mode: FloodlightRigMode) => void;
  setLighting: (lighting: LightingMode) => void;
  updatePitch: (patch: Partial<PitchConfig>) => void;
  updateStand: (target: StandTarget, patch: Partial<StandConfig>) => void;
  updateStandTier: (
    target: StandTarget,
    tierIndex: number,
    patch: Partial<StandTierConfig>
  ) => void;
  /**
   * Paints the seat style at `scope` (`tierIndex` for the per-tier scopes; `target` for the
   * per-stand ones), clearing the same fields on the levels that would win over it there.
   * `null` removes that level and the narrower ones inside it.
   */
  updateSeatStyle: (
    scope: SeatStyleScope,
    target: StandTarget,
    tierIndex: number,
    patch: Partial<SeatTierStyle> | null
  ) => void;
  /** Sets the club colours and repaints every seat with them (seat colour overrides cleared). */
  setClubColors: (patch: Partial<Pick<StadiumColors, 'seatsPrimary' | 'seatsSecondary'>>) => void;
  resetStandTiersUniform: (target: StandTarget) => void;
  convertStandToKopWall: (target: StandTarget) => void;
  applyTargetCapacity: (targetCapacity: number) => void;
  updateRoof: (patch: Partial<RoofConfig>) => void;
  /** Movable roof travelling toward `to` (0 closed, 1 open); the viewport animates it, then commits. */
  roofMotion: { to: number; nonce: number } | null;
  animateRoof: (to: number) => void;
  finishRoofMotion: () => void;
  updateConcourse: (patch: Partial<ConcourseConfig>) => void;
  updateSite: (patch: Partial<SiteConfig>) => void;
  updateColors: (patch: Partial<StadiumColors>) => void;
  updateMaterials: (patch: Partial<StadiumMaterialsConfig>) => void;
  /**
   * Picks the outer envelope: a facade style keeps the current roof (an integral shell gives way
   * to the roof used before it), an integral shell replaces facade and roof at once.
   */
  setEnvelope: (id: EnvelopeStyle | RoofStyle) => void;

  // Objects & Gizmos
  /** Adds an equipment at its default spot, or at `at` (x, z on the ground) when placed by click. */
  addObject: (type: PlacedObjectType, at?: [number, number]) => void;
  /** Equipment waiting for a click in the viewport to be dropped there (`null` when not placing). */
  placingType: PlacedObjectType | null;
  setPlacingType: (type: PlacedObjectType | null) => void;
  selectObject: (id: string | null) => void;
  updateObjectTransform: (
    id: string,
    patch: Partial<
      Pick<
        PlacedObject,
        'position' | 'rotation' | 'scale' | 'name' | 'color' | 'mount' | 'mountSide' | 'haloDiameter' | 'haloBandHeight' | 'haloShape'
      >
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

/**
 * Switches the bowl shape and applies the stand, corner and roof defaults that make that shape
 * read correctly. Pure on the draft, so option thumbnails can show the same result.
 */
export function applyShape(d: StadiumDocument, shape: StadiumShape): void {
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
      isMovableRoof(d.roof.style)
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
  } else if (shape === 'cricket_oval') {
    // A bowl all round the oval outfield, no running track; the progressive rake keeps every row
    // seeing over the one in front, gentle at the front and steepening toward the back.
    d.cornerFill = true;
    d.pitch.hasTrack = false;
    if (d.roof.style === 'truss') d.roof.style = 'cantilever';
    (['north', 'south', 'east', 'west'] as StandSide[]).forEach((s) => {
      d.stands[s].enabled = true;
      d.stands[s].rakeProfile = 'progressive';
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
  } else if (shape === 'tilted_bowl' || shape === 'saddle_bowl') {
    // The rim's slope comes from the difference between stands: a tall north stand falling to a
    // low south one (tilted), or tall sides with low ends (saddle). Each end gets the rows its
    // blended section actually carries, so the capacity matches the geometry.
    d.cornerFill = true;
    if (d.roof.style === 'truss') d.roof.style = 'cantilever';
    const high = Math.max(32, d.stands.north.rows, d.stands.south.rows);
    const low = Math.max(10, Math.round(high * (shape === 'tilted_bowl' ? 0.35 : 0.55)));
    const ends = shape === 'tilted_bowl' ? Math.round((high + low) / 2) : low;
    const sides: [StandSide, number][] = [
      ['north', high],
      ['south', shape === 'tilted_bowl' ? low : high],
      ['east', ends],
      ['west', ends],
    ];
    for (const [side, rows] of sides) {
      d.stands[side].enabled = true;
      d.stands[side].rows = rows;
      d.stands[side].tierConfigs = undefined;
    }
  } else if (shape === 'rounded_rectangle') {
    d.cornerFill = true;
    d.cornerRoundness = d.cornerRoundness ?? 0.5;
    if (d.roof.style === 'truss') d.roof.style = 'cantilever';
  }
  d.pitch = clampPitchToTrack(d.pitch);
}

let autosaveTimer: number | null = null;
let pendingSave: StadiumDocument | null = null;
function scheduleAutosave(doc: StadiumDocument, onSaved: (ts: number) => void) {
  if (autosaveTimer !== null) {
    window.clearTimeout(autosaveTimer);
  }
  pendingSave = doc;
  autosaveTimer = window.setTimeout(async () => {
    autosaveTimer = null;
    pendingSave = null;
    const metrics = calculateStadiumMetrics(doc);
    await saveProjectToDb(doc, metrics.totalCapacity);
    onSaved(Date.now());
  }, 550);
}

/**
 * Writes the edit still waiting for its autosave. Called before switching projects, so the last
 * change to the project being left is not dropped when the next project's save replaces the timer.
 */
async function flushAutosave(): Promise<void> {
  if (autosaveTimer === null || !pendingSave) return;
  window.clearTimeout(autosaveTimer);
  const doc = pendingSave;
  autosaveTimer = null;
  pendingSave = null;
  await saveProjectToDb(doc, calculateStadiumMetrics(doc).totalCapacity);
}

const newProjectId = () => `stadium-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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
  // The 1930s cycling-track ground was dropped; its oval footprint is the olympic one's.
  if ((doc.shape as string) === 'heritage_bowl') doc.shape = 'olympic_oval';
  const legacyPitch = doc.pitch as PitchConfig & { cyclingTrack?: boolean; cyclingBanking?: number };
  delete legacyPitch.cyclingTrack;
  delete legacyPitch.cyclingBanking;
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

  // Roof to restore when an integral shell is swapped back for a classic facade (this session).
  let roofBeforeShell: RoofStyle = 'cantilever';
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

  /**
   * Switches to another project. Undo history belongs to one project, so it starts empty; the
   * project left behind gets its pending edit written first.
   *
   * `isNew` gives the project its own id. `saveNow` writes it at once so it shows in the project
   * list (imports, duplicates); an opened example or blank project is only written by the autosave
   * of its first edit, so browsing the examples does not fill the list with untouched copies.
   */
  const openProject = (next: StadiumDocument, isNew: boolean, saveNow = isNew) => {
    // A fresh id per new project: two created within the same millisecond must not share a record.
    if (isNew) next.id = newProjectId();
    next.updatedAt = Date.now();
    void flushAutosave().then(async () => {
      if (saveNow) await saveProjectToDb(next, calculateStadiumMetrics(next).totalCapacity);
      set({
        savedProjects: await listProjectsFromDb(),
        lastSavedAt: isNew && !saveNow ? null : Date.now(),
      });
    });
    set({
      doc: next,
      history: { past: [], future: [] },
      selectedObjectId: null,
      cameraMode: 'drone',
      cameraTriggerNonce: get().cameraTriggerNonce + 1,
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

    loadPreset: (presetId) => openProject(createPresetDocument(presetId), true, false),

    newBlankProject: () => openProject(createBlankDocument(), true, false),

    loadDocument: (incoming) => openProject(normalizeStadiumDocument(cloneDocument(incoming)), false),

    importDocument: (incoming) => {
      openProject(normalizeStadiumDocument(cloneDocument(incoming)), true);
    },

    duplicateProject: () => {
      const copy = cloneDocument(get().doc);
      copy.name = `${copy.name} (copie)`;
      openProject(copy, true);
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

    setShape: (shape) => commitChange((d) => applyShape(d, shape)),

    setCornerRoundness: (roundness) =>
      commitChange((d) => {
        d.cornerRoundness = Math.max(0, Math.min(1, roundness));
      }),
    setRingCuts: (patch) =>
      commitChange((d) => {
        if ('ringBreach' in patch) d.ringBreach = patch.ringBreach;
        if ('upperRingGaps' in patch) d.upperRingGaps = patch.upperRingGaps;
      }),
    setSunkenDepth: (depth) =>
      commitChange((d) => {
        d.sunkenDepth = Math.max(0, Math.min(SUNKEN_MAX_DEPTH, Number(depth.toFixed(1))));
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

    setCornerJoin: (join) =>
      commitChange((d) => {
        d.cornerJoin = join;
      }),

    setFrontFence: (patch) =>
      commitChange((d) => {
        if (patch.frontFence !== undefined) d.frontFence = patch.frontFence === 'glass' ? undefined : patch.frontFence;
        if (patch.frontFenceHeight !== undefined) d.frontFenceHeight = patch.frontFenceHeight;
      }),

    setCornerAccess: (corner, on) =>
      commitChange((d) => {
        const next = { ...(d.cornerAccess ?? {}) };
        if (on) next[corner] = true;
        else delete next[corner];
        d.cornerAccess = Object.keys(next).length > 0 ? next : undefined;
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
        d.pitch = patchPitch(d.pitch, patch);
      }),

    updateStand: (target, patch) =>
      commitChange((d) => {
        for (const side of standsOf(target)) applyStandPatch(d, side, patch);
        // One press box per ground, in the main stand: turning it on in a stand moves it there.
        if (patch.pressBox === true && target !== 'all') {
          for (const side of ALL_STANDS) {
            if (side !== target && d.stands[side].pressBox) d.stands[side] = { ...d.stands[side], pressBox: false };
          }
        }
      }),

    updateStandTier: (target, tierIndex, patch) =>
      commitChange((d) => {
        for (const side of standsOf(target)) applyStandTierPatch(d, side, tierIndex, patch);
      }),

    updateSeatStyle: (scope, target, tierIndex, patch) =>
      commitChange((d) => paintSeatStyle(d, scope, standsOf(target), tierIndex, patch)),

    setClubColors: (patch) =>
      commitChange((d) => {
        d.colors = { ...d.colors, ...patch };
        stripSeatStyles(d, ['color', 'accent']);
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
        fitStandRowsToCapacity(d, targetCapacity);
      }),

    updateRoof: (patch) =>
      commitChange((d) => {
        d.roof = { ...d.roof, ...patch };
      }),

    roofMotion: null,
    animateRoof: (to) => set({ roofMotion: { to, nonce: Date.now() } }),
    finishRoofMotion: () => {
      const motion = get().roofMotion;
      if (!motion) return;
      set({ roofMotion: null });
      const roof = get().doc.roof;
      get().updateRoof({ retractable: { ...roof.retractable, openRatio: motion.to } });
    },

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

    setEnvelope: (id) =>
      commitChange((d) => {
        if (isIntegralShell(id)) {
          if (!isIntegralShell(d.roof.style)) roofBeforeShell = d.roof.style;
          d.roof = { ...d.roof, style: id };
          return;
        }
        d.materials = { ...DEFAULT_STADIUM_MATERIALS, ...(d.materials ?? {}), envelopeStyle: id as EnvelopeStyle };
        if (isIntegralShell(d.roof.style)) d.roof = { ...d.roof, style: roofBeforeShell };
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

    placingType: null,
    setPlacingType: (type) => set({ placingType: type }),

    addObject: (type, at) => {
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
        position: at
          ? [at[0], basePos[1], at[1]]
          : [basePos[0] + jitterOffset, basePos[1], basePos[2]],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      };
      if (type === 'halo_screen') {
        created.position = [0, Number(defaultHaloHeight(nextDoc).toFixed(1)), 0];
      }
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
        placingType: null,
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
      if (patch.haloDiameter !== undefined) target.haloDiameter = patch.haloDiameter;
      if (patch.haloBandHeight !== undefined) target.haloBandHeight = patch.haloBandHeight;
      if (patch.haloShape !== undefined) target.haloShape = patch.haloShape;

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


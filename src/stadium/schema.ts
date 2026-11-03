export type StadiumShape =
  | 'modern_bowl'
  | 'steep_cauldron'
  | 'olympic_oval'
  | 'sunken_bowl'
  | 'octagonal_arena'
  | 'compact_urban'
  | 'english_rectangular'
  | 'four_stands'
  | 'horseshoe'
  | 'circular_bowl'
  | 'arc_stands';

export type StandSide = 'north' | 'south' | 'east' | 'west';

export type SeatingType = 'seated' | 'safe_standing' | 'telescopic';

export type RoofStyle =
  | 'none'
  | 'column_supported'
  | 'cantilever'
  | 'goalpost_truss'
  | 'truss'
  | 'suspended_masts'
  | 'giant_arch'
  | 'bowstring_arch'
  | 'bicycle_wheel'
  | 'tensile_net'
  | 'enveloping_shell'
  | 'twin_arch'
  | 'retractable'
  | 'vaulted_ring'
  | 'folded_plate'
  | 'fixed_dome';

export type EnvelopeStyle =
  | 'enveloping_skin'
  | 'exposed_structure'
  | 'colonnade_forest'
  | 'louver_curtain';

export type PlacedObjectType =
  | 'screen'
  | 'floodlight'
  | 'dugout'
  | 'locker_room'
  | 'shop'
  | 'parking'
  | 'esplanade'
  | 'fence'
  | 'custom_roof';

export type CameraPresetMode =
  | 'drone'
  | 'touchline'
  | 'spectator'
  | 'plan2d'
  | 'cross_section';

export type LightingMode = 'day' | 'dusk' | 'night';

export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface PitchConfig {
  length: number;
  width: number;
  marginSide: number;
  marginEnd: number;
  hasTrack: boolean;
  trackLanes: number;
  grassPattern: 'stripes' | 'checker' | 'solid';
  adBoards: boolean;
}

export type CornerId = 'nw' | 'ne' | 'sw' | 'se';

export type CornerMode = 'open' | 'filled' | 'building' | 'screen';

export type SkylightMode = 'none' | 'pitch_ring' | 'radial_slots' | 'grid_oculi';

export type FacadePatternId = 'none' | 'vertical_fins' | 'diagrid' | 'cassette_panels';

export type FloodlightRigMode = 'roof_gantry' | 'corner_masts' | 'both' | 'none';

export interface StandTierConfig {
  rows: number;
  slopeAngleDeg: number;
  /** Forward cantilever advance in metres over the tier below (applies to tier >= 2). */
  overhang?: number;
}

export interface StandConfig {
  id: StandSide;
  name: string;
  enabled: boolean;
  rows: number;
  tiers: 1 | 2 | 3 | 4 | 5;
  slopeAngleDeg?: number;
  rowDepth: number;
  riserHeight: number;
  seatWidth: number;
  distanceToPitch: number;
  aisleCount: number;
  aisleWidth: number;
  elevationStart: number;
  seatingType?: SeatingType;
  vipLoges?: boolean;
  roofStyleOverride?: RoofStyle | 'inherit';
  /** Default forward cantilever advance (m) for upper tiers on this stand (`0..8.5`). */
  tierOverhang?: number;
  /** Independent per-tier row counts, slopes, and cantilever overhangs. */
  tierConfigs?: StandTierConfig[];
  /** Number of carved physical vomitory openings per tier (`0..12`). */
  vomitoryCount?: number;
  /** Normalized vertical row position of vomitory openings inside each tier (`0.18..0.82`). */
  vomitoryRowRatio?: number;
  /** Normalized lateral shift of vomitories along the stand (`-0.25..0.25`). */
  vomitoryOffsetRatio?: number;
}

export interface RoofConfig {
  style: RoofStyle;
  heightOffset: number;
  coverageRatio: number;
  opacity: number;
  retractableClosed?: boolean;
  /** Continuous bowls only: stands under the roof; absent means the whole bowl is covered. */
  coveredSides?: StandSide[];
  /** Extends the outer edge of all roofs across the outer concourse up to the facade (enabled by default). */
  overConcourse?: boolean;
  /** Closes the band between the facade (or concourse) top and the roof with a fin screen (default on). */
  enclosed?: boolean;
  /** Skylight / daylight cutout pattern across the canopy. */
  skylightMode?: SkylightMode;
  /** Share of canopy area opened to direct sunlight (`0..0.75`). */
  skylightRatio?: number;
}

/**
 * Official World Athletics 400 m standard track dimensions (single source of truth):
 * - Two parallel straights of 84.39 m
 * - Semicircular raised kerb ("corde") of radius 36.50 m
 * - Lane width of 1.22 m
 * - Lane 1 measurement line 0.30 m outside the kerb => 2 * 84.39 + 2 * pi * 36.80 = 400.001 m
 */
export const TRACK_STRAIGHT_LENGTH_M = 84.39;
export const TRACK_KERB_RADIUS_M = 36.5;
export const TRACK_LANE_WIDTH_M = 1.22;
export const TRACK_LANE1_MEASUREMENT_OFFSET_M = 0.3;
export const TRACK_OUTER_SAFETY_MARGIN_M = 1.5;
export const TRACK_MAX_PITCH_WIDTH_M = 70;
export const TRACK_KERB_CLEARANCE_M = 0.6;

export interface OfficialTrackGeometry {
  straightLength: number;
  straightHalfLength: number;
  innerRadius: number;
  laneWidth: number;
  lanes: number;
  lanesWidth: number;
  outerMargin: number;
  outerRadius: number;
  outerHalfLengthX: number;
  outerHalfWidthZ: number;
  infieldHalfLengthX: number;
  infieldHalfWidthZ: number;
  lane1Length: number;
}

export function getTrackGeometry(
  pitchOrLanes: Pick<PitchConfig, 'trackLanes'> | number
): OfficialTrackGeometry {
  const rawLanes =
    typeof pitchOrLanes === 'number' ? pitchOrLanes : pitchOrLanes.trackLanes;
  const lanes = Math.max(4, Math.min(10, Math.round(rawLanes || 8)));
  const straightLength = TRACK_STRAIGHT_LENGTH_M;
  const straightHalfLength = straightLength * 0.5;
  const innerRadius = TRACK_KERB_RADIUS_M;
  const laneWidth = TRACK_LANE_WIDTH_M;
  const lanesWidth = lanes * laneWidth;
  const outerMargin = TRACK_OUTER_SAFETY_MARGIN_M;
  const outerRadius = innerRadius + lanesWidth + outerMargin;
  const lane1Length =
    2 * straightLength +
    2 * Math.PI * (innerRadius + TRACK_LANE1_MEASUREMENT_OFFSET_M);

  return {
    straightLength,
    straightHalfLength,
    innerRadius,
    laneWidth,
    lanes,
    lanesWidth,
    outerMargin,
    outerRadius,
    outerHalfLengthX: straightHalfLength + outerRadius,
    outerHalfWidthZ: outerRadius,
    infieldHalfLengthX: straightHalfLength + innerRadius,
    infieldHalfWidthZ: innerRadius,
    lane1Length,
  };
}

/**
 * Maximum playing-field length (in integer metres) that fits inside the 36.5 m kerb
 * without its corners touching the kerb for a given field width.
 * For 68 m width, max length is 107 m — so a FIFA 105 × 68 m pitch passes unchanged.
 */
export function getMaxPitchLengthForTrack(width: number): number {
  const clampedWidth = Math.min(width, TRACK_MAX_PITCH_WIDTH_M);
  const halfW = clampedWidth * 0.5;
  const maxCornerR = TRACK_KERB_RADIUS_M - TRACK_KERB_CLEARANCE_M;
  const maxDx = Math.sqrt(Math.max(0, maxCornerR * maxCornerR - halfW * halfW));
  return Math.floor(TRACK_STRAIGHT_LENGTH_M + 2 * maxDx);
}

/**
 * Keeps the football pitch strictly inside the 400 m track kerb when `hasTrack` is enabled:
 * width is capped at 70 m, and length is reduced if needed so corners clear the 36.5 m kerb.
 */
export function clampPitchToTrack(pitch: PitchConfig): PitchConfig {
  if (!pitch.hasTrack) return pitch;
  const width = Math.min(pitch.width, TRACK_MAX_PITCH_WIDTH_M);
  const maxLen = getMaxPitchLengthForTrack(width);
  const length = Math.min(pitch.length, maxLen);
  if (width === pitch.width && length === pitch.length) {
    return pitch;
  }
  return {
    ...pitch,
    width,
    length,
  };
}

export interface StadiumColors {
  seatsPrimary: string;
  seatsSecondary: string;
  facade: string;
  roof: string;
  pitchPrimary: string;
  pitchSecondary: string;
  track: string;
}

export type FacadeMaterialId =
  | 'etfe_cushions_facade'
  | 'glass_curtain'
  | 'brushed_steel_mesh'
  | 'architectural_concrete'
  | 'weathered_corten'
  | 'heritage_brick'
  | 'limestone_travertine'
  | 'timber_diagrid';

export type RoofMaterialId =
  | 'ptfe_membrane'
  | 'etfe_cushions'
  | 'polycarbonate_glass'
  | 'standing_seam_zinc'
  | 'titanium_scales'
  | 'glulam_acoustic_deck';

export type StructureMaterialId =
  | 'white_steel'
  | 'anthracite_steel'
  | 'galvanized_steel'
  | 'glulam_timber'
  | 'corten_structure';

export type SeatMaterialId =
  | 'molded_poly_mosaic'
  | 'ribbed_stadium_shell'
  | 'padded_club_velvet';

export type PitchTurfMaterialId =
  | 'hybrid_emerald'
  | 'natural_ryegrass'
  | 'winter_worn'
  | 'pro_synthetic';

export type TrackMaterialId =
  | 'mondo_red'
  | 'mondo_blue'
  | 'mondo_violet'
  | 'anthracite_apron';

export type PlazaMaterialId =
  | 'granite_pavers'
  | 'sandstone_esplanade'
  | 'urban_asphalt';

export interface StadiumMaterialsConfig {
  envelopeStyle?: EnvelopeStyle;
  facade: FacadeMaterialId;
  roof: RoofMaterialId;
  structure: StructureMaterialId;
  seatFinish: SeatMaterialId;
  pitchTurf: PitchTurfMaterialId;
  trackSurface: TrackMaterialId;
  plazaSurface: PlazaMaterialId;
  /** Individual 3D seats on every row; false falls back to the lighter painted terrace texture. */
  seats3d?: boolean;
  /** Parametric 3D geometric relief pattern overlaid on the exterior facade. */
  facadePattern?: FacadePatternId;
  /** Parametric pattern repetition density (`0.4..2.2`). */
  facadeDensity?: number;
  /** Outward 3D relief projection depth in metres (`0.15..2.4`). */
  facadeDepth?: number;
}

export const DEFAULT_STADIUM_MATERIALS: StadiumMaterialsConfig = {
  envelopeStyle: 'enveloping_skin',
  facade: 'glass_curtain',
  roof: 'ptfe_membrane',
  structure: 'white_steel',
  seatFinish: 'molded_poly_mosaic',
  seats3d: true,
  pitchTurf: 'hybrid_emerald',
  trackSurface: 'mondo_red',
  plazaSurface: 'granite_pavers',
  facadePattern: 'none',
  facadeDensity: 1.0,
  facadeDepth: 0.85,
};

/**
 * How a giant screen is held: `free` uses its own transform; `roof` hangs it under the front
 * edge of a stand's roof; `stand` sets it on the stand's rear crest. Mounted screens keep only
 * their offset along the stand from `position`; height, depth and facing come from the stand.
 */
export type ObjectMount = 'free' | 'roof' | 'stand';

export interface PlacedObject {
  id: string;
  type: PlacedObjectType;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color?: string;
  mount?: ObjectMount;
  mountSide?: StandSide;
}

/** Building mass wrapping the bowl behind the stands (see generateConcourse). */
export interface ConcourseConfig {
  /** Depth of the ring behind the stands in metres; 0 means no outer concourse. */
  width: number;
  /** Ring height as a share of the adjacent stand height (0.15–1). */
  heightRatio: number;
}

/** Character of the land around the stadium (see generateSite). */
export type SiteSetting = 'urban' | 'esplanade' | 'park' | 'parking';

export interface SiteConfig {
  setting: SiteSetting;
  /** Steel security fence ringing the forecourt, opened at each entrance. */
  perimeterFence: boolean;
  /** Turnstile entrance pavilions on the stadium axes. */
  entrances: boolean;
}

export const DEFAULT_SITE: SiteConfig = {
  setting: 'esplanade',
  perimeterFence: false,
  entrances: true,
};

export function resolveSite(doc: StadiumDocument): SiteConfig {
  return { ...DEFAULT_SITE, ...(doc.site ?? {}) };
}

export interface StadiumDocument {
  id: string;
  name: string;
  updatedAt: number;
  presetId: string;
  shape: StadiumShape;
  cornerFill: boolean;
  /** Per-corner architectural mode (`nw`, `ne`, `sw`, `se`). */
  corners?: Partial<Record<CornerId, CornerMode>>;
  sunkenDepth?: number;
  pitch: PitchConfig;
  stands: Record<StandSide, StandConfig>;
  roof: RoofConfig;
  /** Architectural floodlighting system (`roof_gantry`, `corner_masts`, `both`, `none`). */
  floodlightRig?: FloodlightRigMode;
  colors: StadiumColors;
  materials?: StadiumMaterialsConfig;
  concourse?: ConcourseConfig;
  /** Surroundings outside the facade; absent means DEFAULT_SITE. */
  site?: Partial<SiteConfig>;
  objects: PlacedObject[];
  lighting: LightingMode;
}

export interface StandMetrics {
  side: StandSide;
  name: string;
  enabled: boolean;
  effectiveLength: number;
  totalDepth: number;
  maxHeight: number;
  slopeDegrees: number;
  tiers: number;
  seatingType: SeatingType;
  vipLoges: boolean;
  seatsPerRow: number;
  totalRows: number;
  capacity: number;
  minCValueMm: number;
  avgCValueMm: number;
  sightlineGrade: 'Optimal' | 'Conforme' | 'Acceptable' | 'Critique';
  /** Time for the slowest tier to clear through its vomitories (Green Guide flow rate). */
  evacuationMinutes: number;
}

export interface StadiumMetrics {
  totalCapacity: number;
  totalRowsAvg: number;
  maxRoofHeight: number;
  builtFootprintM2: number;
  totalGrossFloorAreaM2: number;
  estimatedBudgetMillionsEur: number;
  costPerSeatEur: number;
  avgCValueMm: number;
  minCValueMm: number;
  /** Slowest stand's evacuation time in minutes. */
  evacuationMinutes: number;
  stands: Record<StandSide, StandMetrics>;
}

/**
 * Returns true if the morphology uses the continuous/swept perimeter generator
 * (elliptical bowl, steep cauldron, olympic oval, sunken amphitheatre, faceted octagon, or U-shaped horseshoe).
 */
export function isContinuousBowlShape(shape: StadiumShape): boolean {
  return (
    shape === 'modern_bowl' ||
    shape === 'steep_cauldron' ||
    shape === 'olympic_oval' ||
    shape === 'sunken_bowl' ||
    shape === 'octagonal_arena' ||
    shape === 'horseshoe' ||
    shape === 'circular_bowl' ||
    shape === 'arc_stands'
  );
}

/**
 * Resolves the effective architectural mode of one stadium corner (`nw`, `ne`, `sw`, `se`),
 * preserving backward compatibility with `shape` and `cornerFill` when `doc.corners` is unset.
 */
export function resolveCornerMode(doc: StadiumDocument, cornerId: CornerId): CornerMode {
  const explicit = doc.corners?.[cornerId];
  if (explicit) return explicit;
  if (doc.shape === 'four_stands') return 'open';
  if (doc.shape === 'english_rectangular') return doc.cornerFill ? 'filled' : 'open';
  if (doc.shape === 'horseshoe' && (cornerId === 'ne' || cornerId === 'se')) return 'open';
  if (doc.shape === 'arc_stands') return 'open';
  return 'filled';
}

/**
 * Whether a continuous bowl must treat this corner apart from the swept ring: the user chose a
 * mode for it, or the shape itself leaves its corners open (`arc_stands`).
 */
export function isCornerConfigured(doc: StadiumDocument, cornerId: CornerId): boolean {
  return doc.corners?.[cornerId] !== undefined || doc.shape === 'arc_stands';
}

export function resolveAllCorners(doc: StadiumDocument): Record<CornerId, CornerMode> {
  return {
    nw: resolveCornerMode(doc, 'nw'),
    ne: resolveCornerMode(doc, 'ne'),
    sw: resolveCornerMode(doc, 'sw'),
    se: resolveCornerMode(doc, 'se'),
  };
}

/**
 * Resolves the active floodlight rig mode (`roof_gantry`, `corner_masts`, `both`, `none`).
 */
export function resolveFloodlightRig(doc: StadiumDocument): FloodlightRigMode {
  if (doc.floodlightRig) return doc.floodlightRig;
  const anyStandRoof = (['north', 'south', 'east', 'west'] as StandSide[]).some(
    (s) =>
      doc.stands[s].enabled &&
      doc.stands[s].roofStyleOverride &&
      doc.stands[s].roofStyleOverride !== 'inherit' &&
      doc.stands[s].roofStyleOverride !== 'none'
  );
  if (doc.roof.style === 'none' && !anyStandRoof) {
    const hasManualMasts = doc.objects.some((o) => o.type === 'floodlight');
    return hasManualMasts ? 'none' : 'corner_masts';
  }
  return 'roof_gantry';
}

/**
 * Resolves vomitory count and normalized positions in `(0.10 .. 0.90)` along a stand.
 */
export function resolveStandVomitories(stand: StandConfig): {
  count: number;
  rowRatio: number;
  offsetRatio: number;
  positions: number[];
} {
  const defaultCount = Math.max(2, Math.min(8, Math.round(stand.aisleCount * 0.5)));
  const count =
    stand.vomitoryCount !== undefined
      ? Math.max(0, Math.min(12, Math.round(stand.vomitoryCount)))
      : defaultCount;
  const rowRatio = Math.max(0.18, Math.min(0.82, stand.vomitoryRowRatio ?? 0.44));
  const offsetRatio = Math.max(-0.25, Math.min(0.25, stand.vomitoryOffsetRatio ?? 0));

  const positions: number[] = [];
  if (count > 0) {
    for (let i = 0; i < count; i++) {
      const base = (i + 0.5) / count;
      // Shift smoothly while keeping vomitories safely inside [0.08, 0.92] away from end walls
      const shifted = Math.max(0.08, Math.min(0.92, base + offsetRatio * (1 - 1 / Math.max(2, count))));
      positions.push(shifted);
    }
  }
  return { count, rowRatio, offsetRatio, positions };
}

/**
 * Returns the effective excavation/sunken depth in meters (`0` for above-ground stadiums).
 */
export function getEffectiveSunkenDepth(doc: StadiumDocument): number {
  if (typeof doc.sunkenDepth === 'number') {
    return Math.max(0, Math.min(16, doc.sunkenDepth));
  }
  return doc.shape === 'sunken_bowl' ? 9.0 : 0;
}

export const STADIUM_SHAPE_LABELS: Record<StadiumShape, string> = {
  four_stands: 'Stade « à l’anglaise » (4 tribunes)',
  compact_urban: 'Rectangulaire à coins fermés',
  english_rectangular: 'Rectangulaire modulable',
  modern_bowl: 'Bowl (cuvette) continu',
  steep_cauldron: 'Chaudron parabolique raide',
  olympic_oval: 'Stade avec piste d’athlétisme',
  horseshoe: 'Fer à cheval (en U)',
  sunken_bowl: 'Amphithéâtre semi-enterré',
  octagonal_arena: 'Arène octogonale facettée',
  circular_bowl: 'Bol circulaire',
  arc_stands: 'Tribunes en arc de cercle',
};

export function riserFromSlopeDeg(slopeDeg: number, rowDepth: number): number {
  const clamped = Math.max(15, Math.min(42, slopeDeg));
  return Number((Math.tan((clamped * Math.PI) / 180) * rowDepth).toFixed(3));
}

export function slopeDegFromRiser(riserHeight: number, rowDepth: number): number {
  if (rowDepth <= 0) return 26;
  return Number(((Math.atan2(riserHeight, rowDepth) * 180) / Math.PI).toFixed(1));
}


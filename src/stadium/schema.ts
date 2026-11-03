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
  | 'circular_bowl';

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
}

export interface RoofConfig {
  style: RoofStyle;
  heightOffset: number;
  coverageRatio: number;
  opacity: number;
  retractableClosed?: boolean;
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

export interface StadiumDocument {
  id: string;
  name: string;
  updatedAt: number;
  presetId: string;
  shape: StadiumShape;
  cornerFill: boolean;
  sunkenDepth?: number;
  pitch: PitchConfig;
  stands: Record<StandSide, StandConfig>;
  roof: RoofConfig;
  colors: StadiumColors;
  materials?: StadiumMaterialsConfig;
  concourse?: ConcourseConfig;
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
    shape === 'circular_bowl'
  );
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
};

export function riserFromSlopeDeg(slopeDeg: number, rowDepth: number): number {
  const clamped = Math.max(15, Math.min(40, slopeDeg));
  return Number((Math.tan((clamped * Math.PI) / 180) * rowDepth).toFixed(3));
}

export function slopeDegFromRiser(riserHeight: number, rowDepth: number): number {
  if (rowDepth <= 0) return 26;
  return Number(((Math.atan2(riserHeight, rowDepth) * 180) / Math.PI).toFixed(1));
}

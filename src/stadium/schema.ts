import { shapeDefinition, type StadiumShape } from './shapeCatalog';
export type { StadiumShape };

export type StandSide = 'north' | 'south' | 'east' | 'west';

export type SeatingType = 'seated' | 'safe_standing' | 'telescopic';

import type { RoofStyle } from './roofCatalog';
export type { RoofStyle };

/**
 * Silhouette of a continuous bowl's outer skin: upright, bulging out at mid-height (a calabash),
 * a tent leaning in from a wide foot up to the roof, or a saucer flaring out from a recessed foot.
 */
export type EnvelopeProfile = 'straight' | 'bulging' | 'tent' | 'saucer';

export type EnvelopeStyle =
  | 'enveloping_skin'
  | 'exposed_structure'
  | 'colonnade_forest'
  | 'louver_curtain'
  | 'stacked_arcades'
  | 'media_mesh'
  | 'helical_ramps'
  | 'horizontal_strata'
  | 'external_stairs';

export type PlacedObjectType =
  | 'screen'
  | 'halo_screen'
  | 'inclined_mast'
  | 'monumental_arch'
  | 'monumental_gate'
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

export type AdBoardTheme =
  | 'champions_league'
  | 'world_cup'
  | 'premier_league'
  | 'ligue_1'
  | 'europa_league'
  | 'equipe_de_france'
  | 'mls_usa';

export interface PitchConfig {
  length: number;
  width: number;
  marginSide: number;
  marginEnd: number;
  hasTrack: boolean;
  trackLanes: number;
  grassPattern: 'stripes' | 'checker' | 'solid';
  adBoards: boolean;
  /** Sponsor & competition visual theme for pitch LED boards and balcony ribbons. */
  adBoardTheme?: AdBoardTheme;
  /** Sunken concrete/water safety moat between the pitch apron and front parapets. */
  hasMoat?: boolean;
  /** Movable pitch: east half lifts over the west half, or the whole pitch rolls out east. */
  movablePitch?: 'none' | 'half_lift' | 'slide_out';
  /** Progress of the movable pitch (`0` = in play, `1` = arena floor cleared). */
  movablePitchState?: number;
}

export type CornerId = 'nw' | 'ne' | 'sw' | 'se';

export type CornerMode =
  | 'open'
  | 'filled'
  | 'building'
  | 'screen'
  | 'spiral_tower'
  | 'pavilion';

export type CornerJoin = 'blend' | 'end' | 'side';

export type StandCrestProfile = 'flat' | 'arch_crest' | 'saddle_dip';

export type StandFasciaStyle = 'concrete' | 'led_ribbon' | 'criss_cross';

export type StandTunnelStyle = 'center' | 'corner_twin' | 'none';

export type SkylightMode = 'none' | 'pitch_ring' | 'radial_slots' | 'grid_oculi';

export type FacadePatternId =
  | 'none'
  | 'vertical_fins'
  | 'diagrid'
  | 'cassette_panels'
  | 'triangulated_lace'
  | 'scales'
  | 'honeycomb'
  | 'voronoi'
  | 'pixel_mosaic'
  | 'woven_basket';

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
  /** Height of the first row's tread above the pitch (m); a tall front wall below it. */
  elevationStart: number;
  seatingType?: SeatingType;
  vipLoges?: boolean;
  roofStyleOverride?: RoofStyle | 'inherit';
  /** Retractable stand: how far it is currently rolled back from its forward position (m, `0..15`). */
  retractShift?: number;
  /** Structure of this stand only (rectangular grounds); steel or timber leaves the underside open. */
  structureMaterialOverride?: StructureMaterialId | 'inherit';
  /** Envelope style of this stand's facade, for stands built in different eras or styles. */
  envelopeStyleOverride?: EnvelopeStyle | 'inherit';
  /** Facade cladding of this stand. */
  facadeMaterialOverride?: FacadeMaterialId | 'inherit';
  /** Default forward cantilever advance (m) for upper tiers on this stand (`0..8.5`). */
  tierOverhang?: number;
  /** Independent per-tier row counts, slopes, and cantilever overhangs. */
  tierConfigs?: StandTierConfig[];
  /** Number of carved physical vomitory openings per tier/level (`0..12`). */
  vomitoryCount?: number;
  /**
   * Rows of vomitories stacked up each tier (`1..4`), for tall tiers such as a Kop wall; a tier
   * keeps only as many as its rows allow (see `vomitoryLevelsOfTier`).
   */
  vomitoryLevels?: 1 | 2 | 3 | 4;
  /** Staggered ("quinconce") vomitories: each row of them shifted half a bay from the one below. */
  vomitoryStaggered?: boolean;
  /** Normalized vertical row position of vomitory openings inside each tier (`0.18..0.82`). */
  vomitoryRowRatio?: number;
  /** Normalized lateral shift of vomitories along the stand (`-0.25..0.25`). */
  vomitoryOffsetRatio?: number;
  /** Upper crest silhouette along the stand (`flat`, parabolic `arch_crest`, or concave `saddle_dip`). */
  crestProfile?: StandCrestProfile;
  /** Balcony fascia finish (`concrete`, broadcast `led_ribbon`, or heritage `criss_cross` steel lattice). */
  fasciaStyle?: StandFasciaStyle;
  /** Suspended glazed press & TV camera commentary gantry centered at the upper crest. */
  pressGantry?: boolean;
  /** Players' & service tunnel layout at pitch level (`center`, `corner_twin`, or `none`). */
  tunnelStyle?: StandTunnelStyle;
  /** Terraces laid on a grassed earth bank instead of a built stand (small and athletics grounds). */
  embankment?: boolean;
  /** Supporters dressed as a diagonal club-colour tifo across the whole stand. */
  tifo?: boolean;
  /** Supporters' banners hung over the pitch wall and balcony fronts. */
  banners?: boolean;
  /** Seat colour and pattern of each tier, front tier first; unset tiers keep the club colours. */
  /** Seat style of the whole stand, over the stadium-wide tier styles (see `resolveSeatTierStyle`). */
  seatStyle?: SeatTierStyle;
  /** Seat style of one tier of this stand, the most specific level. */
  seatTiers?: (SeatTierStyle | undefined)[];
  /**
   * Rake of each tier: `constant` risers, or `progressive` ones, flatter at the front and steeper
   * at the back (the parabolic rake that keeps every row's view), for the same overall height.
   */
  rakeProfile?: 'constant' | 'progressive';
  /**
   * Cross aisles: horizontal walkways splitting a tier, the rows behind each one raised over a
   * low wall. Any number per tier (see `resolveCrossAisles`).
   */
  crossAisles?: CrossAisleConfig[];
  /** @deprecated Single cross aisle in the lowest tier, read when `crossAisles` is unset. */
  crossAisle?: boolean;
  /** @deprecated Position of the legacy `crossAisle`. */
  crossAisleRatio?: number;
  /** @deprecated Width of the legacy `crossAisle`. */
  crossAisleWidth?: number;
  /** Team dugouts set into the front wall, either side of the halfway line. */
  dugouts?: boolean;
  /** Press seats with desks and screens in the centre of the stand. */
  pressBox?: boolean;
}

/** Height of the wall at the back of a cross aisle, raising the rows behind it (m). */
export const CROSS_AISLE_WALL_M = 1.0;

/** One cross aisle of a stand. */
export interface CrossAisleConfig {
  /** Tier it splits, from 0 (the lowest). */
  tier: number;
  /** Where it runs, as a share of that tier's rows (`0.1..0.9`). */
  ratio: number;
  /** Width of the walkway (m, `1.2..3`). */
  width: number;
}

/** Fewest rows kept between a cross aisle and the tier's ends or another cross aisle. */
export const CROSS_AISLE_MIN_ROWS = 3;

/** Cross aisles of a stand as configured, the legacy single aisle included, values clamped. */
export function resolveCrossAisles(stand: StandConfig): CrossAisleConfig[] {
  const list =
    stand.crossAisles ??
    (stand.crossAisle
      ? [{ tier: 0, ratio: stand.crossAisleRatio ?? 0.5, width: stand.crossAisleWidth ?? 1.8 }]
      : []);
  return list.map((a) => ({
    tier: Math.max(0, Math.floor(a.tier ?? 0)),
    ratio: Math.max(0.1, Math.min(0.9, a.ratio ?? 0.5)),
    width: Math.max(1.2, Math.min(3, a.width ?? 1.8)),
  }));
}

/**
 * Rows of a tier of `rows` rows that a cross aisle runs in front of, with its width. Each sits at
 * least CROSS_AISLE_MIN_ROWS rows from the tier's ends and from the previous one; an aisle that
 * does not fit is dropped.
 */
export function crossAisleRowsOfTier(
  stand: StandConfig,
  tierIndex: number,
  rows: number
): Map<number, number> {
  const out = new Map<number, number>();
  const min = CROSS_AISLE_MIN_ROWS;
  if (rows < min * 2) return out;
  const aisles = resolveCrossAisles(stand)
    .filter((a) => a.tier === tierIndex)
    .sort((a, b) => a.ratio - b.ratio);
  let last = -Infinity;
  for (const a of aisles) {
    const row = Math.max(min, Math.min(rows - min, Math.round(rows * a.ratio)));
    if (row - last < min) continue;
    out.set(row, a.width);
    last = row;
  }
  return out;
}

/**
 * How the seats of one tier are coloured: `solid` one colour, `mosaic` seats of the accent colour
 * scattered at random through the main one, `gradient` the accent thickening from the front rows
 * to the back, `stripes` bands of rows alternating both colours, `lettering` a word written in
 * the accent colour across the stand.
 */
export type SeatPattern = 'solid' | 'mosaic' | 'gradient' | 'stripes' | 'lettering';

export interface SeatTierStyle {
  pattern?: SeatPattern;
  /** Main seat colour (hex). */
  color?: string;
  /** Second colour of the pattern (hex). */
  accent?: string;
  /** `mosaic`: share of accent seats (`0..1`). */
  share?: number;
  /** `lettering`: the word written across the stand. */
  text?: string;
}

/** How the movable roof panels travel (typology of Mahovič, 2015). */
export type RetractableMotion =
  | 'slide_longitudinal'
  | 'slide_transverse'
  | 'slide_off'
  | 'rotate_vertical'
  | 'rotate_horizontal'
  | 'iris'
  | 'fold_central'
  | 'fold_edge'
  | 'combined_stack';

export type RetractablePanelKind = 'rigid' | 'membrane' | 'mixed';

export interface RetractableConfig {
  motion: RetractableMotion;
  /** 0 = fully closed, 1 = fully open. */
  openRatio: number;
  /** Movable panels, segments, petals, cables (`fold_central`) or folding trusses (`fold_edge`). */
  panelCount: number;
  panelKind: RetractablePanelKind;
  panelMaterial: RoofMaterialId;
  /** Sliding motions: end(s) of the long axis where open panels park. */
  parkEnd: 'east' | 'west' | 'both';
  /** `fold_central`: the central ring hangs from a mast. */
  suspensionMast: boolean;
  /** `fold_central` with `suspensionMast`: an inclined tower outside the bowl, or a needle over the centre. */
  mastPosition: 'outside' | 'central';
  /** Inclined pylons standing around the bowl and holding the fixed canopy by stays (`0` = none). */
  pylonCount: number;
}

/** Most pylons a retractable roof can stand on. */
export const RETRACTABLE_MAX_PYLONS = 12;

/** Allowed `panelCount` range and default per motion. */
export const RETRACTABLE_PANEL_LIMITS: Record<
  RetractableMotion,
  { min: number; max: number; def: number }
> = {
  slide_longitudinal: { min: 2, max: 6, def: 4 },
  slide_transverse: { min: 2, max: 6, def: 4 },
  slide_off: { min: 1, max: 2, def: 2 },
  rotate_vertical: { min: 4, max: 12, def: 8 },
  rotate_horizontal: { min: 4, max: 16, def: 8 },
  iris: { min: 6, max: 16, def: 8 },
  fold_central: { min: 16, max: 32, def: 24 },
  fold_edge: { min: 6, max: 12, def: 8 },
  combined_stack: { min: 4, max: 4, def: 4 },
};

/**
 * Fills retractable roof defaults. `petal_iris` always uses the iris motion, and the legacy
 * `retractableClosed` flag maps to a fully closed (0) or fully open (1) `openRatio`.
 */
export function resolveRetractable(roof: RoofConfig): RetractableConfig {
  const r = roof.retractable ?? {};
  const motion: RetractableMotion =
    roof.style === 'petal_iris' ? 'iris' : r.motion ?? 'slide_longitudinal';
  const limits = RETRACTABLE_PANEL_LIMITS[motion];
  const panelKind = r.panelKind ?? (motion.startsWith('fold') ? 'membrane' : 'rigid');
  return {
    motion,
    openRatio: Math.max(0, Math.min(1, r.openRatio ?? (roof.retractableClosed ? 0 : 1))),
    panelCount: Math.max(limits.min, Math.min(limits.max, Math.round(r.panelCount ?? limits.def))),
    panelKind,
    panelMaterial:
      r.panelMaterial ?? (panelKind === 'membrane' ? 'ptfe_membrane' : 'polycarbonate_glass'),
    parkEnd: r.parkEnd ?? 'both',
    suspensionMast: r.suspensionMast ?? false,
    mastPosition: r.mastPosition ?? 'outside',
    pylonCount: Math.max(0, Math.min(RETRACTABLE_MAX_PYLONS, Math.round(r.pylonCount ?? 0))),
  };
}

/** Mega-girder depth of `corner_pylons` roofs (m). */
const CORNER_GIRDER_DEPTH = 8;
export const CORNER_PYLON_MAX_HEIGHT = 90;

/**
 * Vertical frame of a `corner_pylons` roof (Lens, Marseille): the four mega-girders clear the
 * canopy front edge, and the pylons rise at least 2 m above them (default 6 m).
 */
export function resolveCornerPylonFrame(
  roof: RoofConfig,
  maxStandH: number
): { canopyY: number; crownRise: number; girderBotY: number; girderTopY: number; pylonTopY: number } {
  const canopyY = maxStandH + Math.max(4.0, roof.heightOffset);
  const crownRise = Math.max(0, Math.min(25, roof.crownRise ?? 0));
  const girderBotY = canopyY + 1.8 + crownRise + 2;
  const girderTopY = girderBotY + CORNER_GIRDER_DEPTH;
  const minTop = girderTopY + 2;
  const pylonTopY = Math.max(
    minTop,
    Math.min(CORNER_PYLON_MAX_HEIGHT, roof.pylonHeight ?? girderTopY + 6)
  );
  return { canopyY, crownRise, girderBotY, girderTopY, pylonTopY };
}

/**
 * Radial truss layout of a `counterweighted_cantilever` roof (Groupama Stadium: 32 trusses,
 * 60 m front arm, 32 m back-span tied down behind the stands).
 */
export function resolveCounterweightTrusses(roof: RoofConfig): { trussCount: number; backspanRatio: number } {
  return {
    trussCount: Math.max(12, Math.min(48, Math.round(roof.trussCount ?? 32))),
    backspanRatio: Math.max(0.3, Math.min(0.7, roof.backspanRatio ?? 0.53)),
  };
}

/** Transverse mega-girders of a `spanning_girders` roof (Paris La Défense Arena: 4). */
export function resolveSpanningGirderCount(roof: RoofConfig): number {
  return Math.max(2, Math.min(6, Math.round(roof.girderCount ?? 4)));
}

/** Concrete portal ribs of a `concrete_portals` roof (Parc des Princes: 50). */
export function resolvePortalCount(roof: RoofConfig): number {
  return Math.max(24, Math.min(72, Math.round(roof.portalCount ?? 50)));
}

/** `prow_shell`: lift (m) and outward reach (m) of the prow at the north-west end of the ridge. */
export const PROW_LIFT = 10;
export const PROW_REACH = 16;

/** Rise (m) of a `prow_shell` roof slope from its low south eave to its north ridge. */
export function resolveProwRise(roofY: number): number {
  return Math.max(12, Math.min(28, roofY * 0.6));
}

/** Peak rise (m) of a `wave_canopy` roof line above its lowest point. */
export function resolveWaveAmplitude(roof: RoofConfig): number {
  return Math.max(0, Math.min(14, roof.waveAmplitude ?? 9));
}

/** Masts of a `suspended_masts` roof: count around the full bowl and tip height above the canopy. */
export function resolveSuspendedMasts(roof: RoofConfig): { mastCount: number; mastHeight: number } {
  return {
    mastCount: Math.max(6, Math.min(36, Math.round(roof.mastCount ?? 18))),
    mastHeight: Math.max(8, Math.min(45, roof.mastHeight ?? 19.5)),
  };
}

export interface RoofConfig {
  style: RoofStyle;
  heightOffset: number;
  coverageRatio: number;
  opacity: number;
  /** Legacy open/closed flag, superseded by `retractable.openRatio` when that is set. */
  retractableClosed?: boolean;
  /** Movable roof settings for `retractable` and `petal_iris`; missing fields use defaults. */
  retractable?: Partial<RetractableConfig>;
  /** `corner_pylons`: height (m) of the four corner mega-pylons; stays reach the girders below. */
  pylonHeight?: number;
  /** `corner_pylons`: 3D lattice of trusses over the canopy, between girders and stand crests. */
  spaceFrame?: boolean;
  /** `corner_pylons`: rise (m) of the canopy toward its front edge, for a domed crown. */
  crownRise?: number;
  /** `counterweighted_cantilever`: number of radial trusses around the bowl. */
  trussCount?: number;
  /** `counterweighted_cantilever`: back-span length as a share of the front arm. */
  backspanRatio?: number;
  /** `spanning_girders`: transverse mega-girders carrying the closed roof (`2..6`). */
  girderCount?: number;
  /** `concrete_portals`: prestressed concrete portal ribs around the bowl (`24..72`). */
  portalCount?: number;
  /** `wave_canopy`: peak rise (m) of the undulating roof line (`0..14`). */
  waveAmplitude?: number;
  /** `suspended_masts`: masts around the full bowl (`6..36`, default 18). */
  mastCount?: number;
  /** `suspended_masts`: mast tip height above the canopy (m, `8..45`, default 19.5). */
  mastHeight?: number;
  /** Continuous bowls only: stands under the roof; absent means the whole bowl is covered. */
  coveredSides?: StandSide[];
  /** Extends the outer edge of all roofs across the outer concourse up to the facade (enabled by default). */
  overConcourse?: boolean;
  /** Closes the band between the facade (or concourse) top and the roof with a fin screen (default on). */
  enclosed?: boolean;
  /** Clear glass windbreak instead of facade cladding in that band, keeping the bowl visible. */
  enclosureGlazed?: boolean;
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
  | 'timber_diagrid'
  | 'terracotta_baguettes'
  | 'gold_anodized_panels'
  | 'white_composite_panels'
  | 'perforated_red_metal'
  | 'black_zinc_cladding'
  | 'living_green_wall'
  | 'ceramic_tile_mosaic'
  | 'corrugated_steel_sheet'
  | 'sadu_textile'
  | 'uhpc_lace_panels'
  | 'precast_concrete_scales'
  | 'polycarbonate_facade'
  | 'glulam_lattice'
  | 'calabash_mosaic'
  | 'woven_glassfibre_mesh';

export type RoofMaterialId =
  | 'ptfe_membrane'
  | 'etfe_cushions'
  | 'polycarbonate_glass'
  | 'standing_seam_zinc'
  | 'titanium_scales'
  | 'glulam_acoustic_deck'
  | 'anthracite_pvc_membrane'
  | 'copper_verdigris'
  | 'red_steel_deck'
  | 'blue_steel_deck'
  | 'solar_pv_panels'
  | 'perforated_aluminium';

export type StructureMaterialId =
  | 'white_steel'
  | 'anthracite_steel'
  | 'galvanized_steel'
  | 'glulam_timber'
  | 'corten_structure'
  | 'stainless_steel'
  | 'bronze_steel'
  | 'red_lacquer_steel'
  | 'navy_lacquer_steel'
  | 'forest_green_steel'
  | 'yellow_lacquer_steel'
  | 'sky_blue_lacquer_steel'
  | 'reinforced_concrete';

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
  /** Outer skin silhouette of continuous bowls (`straight` when absent). */
  envelopeProfile?: EnvelopeProfile;
  facade: FacadeMaterialId;
  roof: RoofMaterialId;
  structure: StructureMaterialId;
  seatFinish: SeatMaterialId;
  pitchTurf: PitchTurfMaterialId;
  trackSurface: TrackMaterialId;
  plazaSurface: PlazaMaterialId;
  /** Individual 3D seats on every row; false falls back to the lighter painted terrace texture. */
  seats3d?: boolean;
  /** Spectators in the stands (3D seats only); off shows the empty ground. */
  crowd?: boolean;
  /** Share of places occupied when `crowd` is on (`0..1`). */
  crowdAttendance?: number;
  /** Night glow colour of a backlit ETFE facade; absent glows white. */
  facadeGlowHex?: string;
  /** Parametric 3D geometric relief pattern overlaid on the exterior facade. */
  facadePattern?: FacadePatternId;
  /** Colours of the `pixel_mosaic` panels and `woven_basket` strips; absent uses the club colours. */
  facadePalette?: string[];
  /** Parametric pattern repetition density (`0.4..2.2`). */
  facadeDensity?: number;
  /** Outward 3D relief projection depth in metres (`0.15..2.4`). */
  facadeDepth?: number;
  /** Outward bow of lace and scale skins at mid-height (`0..1`, up to 6 m). */
  facadeBulge?: number;
  /** `colonnade_forest`: column density multiplier (`0.5..4`, default 1). */
  colonnadeDensity?: number;
  /** `colonnade_forest`: slender straight columns, or date palms fanning out under the cornice. */
  colonnadeShape?: 'straight' | 'palm';
}

export const DEFAULT_STADIUM_MATERIALS: StadiumMaterialsConfig = {
  envelopeStyle: 'enveloping_skin',
  facade: 'glass_curtain',
  roof: 'ptfe_membrane',
  structure: 'white_steel',
  seatFinish: 'molded_poly_mosaic',
  seats3d: true,
  crowd: false,
  crowdAttendance: 0.9,
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
  /** `halo_screen`: long-axis diameter of the elliptical ring (m). */
  haloDiameter?: number;
  /** `halo_screen`: height of the LED band (m). */
  haloBandHeight?: number;
}

export const HALO_LIMITS = {
  diameter: { min: 16, max: 80, def: 45 },
  bandHeight: { min: 2, max: 14, def: 4.6 },
} as const;

/** Short axis of the halo ellipse as a share of its diameter (Atlanta-style oval). */
export const HALO_MINOR_RATIO = 0.7;

export function resolveHaloSize(obj: PlacedObject): { rx: number; rz: number; bandHeight: number } {
  const d = Math.max(HALO_LIMITS.diameter.min, Math.min(HALO_LIMITS.diameter.max, obj.haloDiameter ?? HALO_LIMITS.diameter.def));
  const h = Math.max(
    HALO_LIMITS.bandHeight.min,
    Math.min(HALO_LIMITS.bandHeight.max, obj.haloBandHeight ?? HALO_LIMITS.bandHeight.def)
  );
  return { rx: d / 2, rz: (d / 2) * HALO_MINOR_RATIO, bandHeight: h };
}

/** Building mass wrapping the bowl behind the stands (see generateConcourse). */
export interface ConcourseConfig {
  /** Depth of the ring behind the stands in metres; 0 means no outer concourse. */
  width: number;
  /** Ring height as a share of the adjacent stand height (0.15–1). */
  heightRatio: number;
}

/** Character of the land around the stadium (see generateSite). */
export type SiteSetting = 'none' | 'urban' | 'esplanade' | 'park' | 'parking';

export interface SiteConfig {
  setting: SiteSetting;
  /** Steel security fence ringing the forecourt, opened at each entrance. */
  perimeterFence: boolean;
  /** Turnstile entrance pavilions on the stadium axes. */
  entrances: boolean;
  /**
   * Height (m) of the podium the stadium stands on: shops and car parks behind its outer wall,
   * its roof a raised forecourt, a grand stair down to the ground on the south axis. `0` = none.
   */
  podiumHeight: number;
}

export const DEFAULT_SITE: SiteConfig = {
  setting: 'esplanade',
  perimeterFence: false,
  entrances: true,
  podiumHeight: 0,
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
  /**
   * How a corner joins two stands whose sections differ. `blend` morphs one section into the
   * other between separate stands; on a continuous bowl (see bowlSection) rows keep their level
   * and the extra ones end one by one across the corner, upper tier first. `end` keeps the corner
   * at the level of the stand behind the goal, `side` at the level of the side stand, with a gable
   * wall where the other is taller.
   */
  cornerJoin?: CornerJoin;
  /**
   * Seated corners crossed by a vehicle access (emergency services, event trucks): a tunnel
   * opening under the corner terraces.
   */
  cornerAccess?: Partial<Record<CornerId, boolean>>;
  /**
   * Barrier on top of the pitch-side front wall: `glass` the low glazed balustrade, `mesh` a tall
   * anti-intrusion wire fence. Absent means `glass`.
   */
  frontFence?: 'glass' | 'mesh';
  /** Height of the `mesh` front fence above the parapet (m, `1.5..4`). */
  frontFenceHeight?: number;
  sunkenDepth?: number;
  /** `rounded_rectangle`: corner rounding, `0` tight to `1` a full bend (default `0.5`). */
  cornerRoundness?: number;
  pitch: PitchConfig;
  stands: Record<StandSide, StandConfig>;
  roof: RoofConfig;
  /** Architectural floodlighting system (`roof_gantry`, `corner_masts`, `both`, `none`). */
  floodlightRig?: FloodlightRigMode;
  colors: StadiumColors;
  /** Seat style of every tier of every stand, over the club colours. */
  seatStyle?: SeatTierStyle;
  /** Seat style of tier `t` on every stand, over `seatStyle`. */
  seatTierStyles?: (SeatTierStyle | undefined)[];
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
  return shapeDefinition(shape).continuous;
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
 * Resolves vomitory count, rows of them per tier (`levels`, `1..4`), optional staggered
 * ("quinconce") positions, and normalized positions along the stand in `[0.08, 0.92]`.
 */
export function resolveStandVomitories(stand: StandConfig): {
  count: number;
  levels: 1 | 2 | 3 | 4;
  staggered: boolean;
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
  const levels = Math.max(1, Math.min(4, Math.round(stand.vomitoryLevels ?? 1))) as 1 | 2 | 3 | 4;
  const staggered = levels > 1 && Boolean(stand.vomitoryStaggered);
  return { count, levels, staggered, rowRatio, offsetRatio, positions: vomitoryPositions(count, offsetRatio, 0.5) };
}

function vomitoryPositions(count: number, offsetRatio: number, phase: number): number[] {
  const arr: number[] = [];
  for (let i = 0; i < count; i++) {
    const base = (i + phase) / count;
    arr.push(Math.max(0.08, Math.min(0.92, base + offsetRatio * (1 - 1 / Math.max(2, count)))));
  }
  return arr;
}

/** Fewest rows of a tier per row of vomitories (an opening takes 3 to 5 rows, plus seats around). */
export const VOMITORY_ROWS_PER_LEVEL = 8;

/** Rows of vomitories a tier of `tierRows` rows takes: as many as asked, while each has room. */
export function vomitoryLevelsOfTier(stand: StandConfig, tierRows: number): number {
  const { levels } = resolveStandVomitories(stand);
  return Math.max(1, Math.min(levels, Math.floor(tierRows / VOMITORY_ROWS_PER_LEVEL)));
}

/**
 * Each row of vomitories of a tier of `tierRows` rows: where it sits up the tier (share of its
 * rows; the levels share the tier evenly, the vertical position shifting them all within their
 * share) and its positions along the stand, offset half a bay on every other row when staggered.
 */
export function vomitoryLevelLayout(
  stand: StandConfig,
  tierRows: number
): { ratio: number; positions: number[] }[] {
  const spec = resolveStandVomitories(stand);
  const levels = vomitoryLevelsOfTier(stand, tierRows);
  return Array.from({ length: levels }, (_, k) => ({
    ratio: (k + spec.rowRatio) / levels,
    positions:
      spec.staggered && levels > 1
        ? vomitoryPositions(spec.count, spec.offsetRatio, k % 2 === 0 ? 0.34 : 0.66)
        : spec.positions,
  }));
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
  d_shape_vertical: 'Cuvette en D & loges verticales',
  olympic_oval: 'Stade avec piste d’athlétisme',
  cricket_oval: 'Ovale de cricket',
  horseshoe: 'Fer à cheval (en U)',
  sunken_bowl: 'Amphithéâtre semi-enterré',
  octagonal_arena: 'Arène octogonale facettée',
  circular_bowl: 'Bol circulaire',
  arc_stands: 'Tribunes en arc de cercle',
  tilted_bowl: 'Bol incliné',
  saddle_bowl: 'Bol en selle',
  rounded_rectangle: 'Rectangle aux angles arrondis',
};

export function riserFromSlopeDeg(slopeDeg: number, rowDepth: number): number {
  const clamped = Math.max(15, Math.min(42, slopeDeg));
  return Number((Math.tan((clamped * Math.PI) / 180) * rowDepth).toFixed(3));
}

export function slopeDegFromRiser(riserHeight: number, rowDepth: number): number {
  if (rowDepth <= 0) return 26;
  return Number(((Math.atan2(riserHeight, rowDepth) * 180) / Math.PI).toFixed(1));
}

/** Share of places filled with spectators: none unless the crowd is switched on. */
export function resolveCrowdAttendance(materials: StadiumMaterialsConfig): number {
  return materials.crowd === true ? materials.crowdAttendance ?? 0.9 : 0;
}

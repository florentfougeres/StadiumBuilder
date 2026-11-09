/**
 * Every stadium shape, in the order the editor offers them. Adding a shape is one entry here,
 * its ring in `bowlRing.ts` (continuous bowls) or its stand layout (separate stands), and any
 * stand defaults it needs in `applyShape`.
 */
export interface ShapeDefinition {
  label: string;
  desc: string;
  /**
   * Stands swept as one continuous bowl around a ring; otherwise separate straight stands with
   * corners that are open, seated or built over.
   */
  continuous: boolean;
  /** Extra building cost per seat (€). */
  costPerSeat: number;
  /** Preset whose stands the editor thumbnail borrows (default: a plain bowl). */
  thumbnailStands?: string;
  /** Thumbnail seen from lower down, to show a sloping rim or a steep rake. */
  thumbnailLowView?: boolean;
  /** Kept for older projects but no longer offered in the editor. */
  retired?: boolean;
}

/** Cost per seat of sweeping a continuous bowl rather than building separate stands (€). */
const BOWL = 520;

export const SHAPE_CATALOG = {
  four_stands: {
    label: 'Stade « à l’anglaise » (4 tribunes)',
    desc: '4 tribunes indépendantes collées au terrain & coins ouverts',
    continuous: false,
    costPerSeat: 0,
    thumbnailStands: 'traditional_four_stands_42k',
  },
  compact_urban: {
    label: 'Rectangulaire à coins fermés',
    desc: 'Angles remplis en enceinte continue UEFA & tours d’accès',
    continuous: false,
    costPerSeat: 420,
    thumbnailStands: 'urban_cathedral_84k',
  },
  english_rectangular: {
    label: 'Rectangulaire modulable',
    desc: 'Tribunes hétérogènes à coins ouverts ou fermés au choix',
    continuous: false,
    costPerSeat: 0,
    thumbnailStands: 'asymmetric_modular_30k',
  },
  modern_bowl: {
    label: 'Bowl (cuvette) continu',
    desc: 'Gradins elliptiques continus 360° sans rupture',
    continuous: true,
    costPerSeat: BOWL,
  },
  steep_cauldron: {
    label: 'Chaudron parabolique raide',
    desc: 'Pente forte (34–37°), proximité immédiate & fort surplomb',
    continuous: true,
    costPerSeat: BOWL + 180,
    thumbnailStands: 'cauldron_cable_42k',
    thumbnailLowView: true,
  },
  olympic_oval: {
    label: 'Bowl avec piste d’athlétisme',
    desc: 'Cuvette évasée autour d’une piste 8 couloirs',
    continuous: true,
    costPerSeat: BOWL,
    thumbnailStands: 'olympic_masts_80k',
  },
  horseshoe: {
    label: 'Fer à cheval (en U ouvert)',
    desc: '3 côtés continus & extrémité ouverte sur parvis panoramique',
    continuous: true,
    costPerSeat: BOWL,
    thumbnailStands: 'horseshoe_amphitheatre_38k',
  },
  sunken_bowl: {
    label: 'Amphithéâtre semi-enterré',
    desc: 'Anneaux bas creusés dans le sol, seuls le haut et le toit émergent',
    continuous: true,
    costPerSeat: BOWL,
  },
  octagonal_arena: {
    label: 'Arène octogonale facettée',
    desc: '8 pans coupés géométriques & virages à 45°',
    continuous: true,
    costPerSeat: BOWL,
  },
  circular_bowl: {
    label: 'Bol circulaire',
    desc: 'Enceinte ronde : virages près des buts, tribunes latérales éloignées',
    continuous: true,
    costPerSeat: BOWL,
  },
  arc_stands: {
    label: 'Tribunes en arc de cercle',
    desc: '4 tribunes cintrées tournées vers le centre, virages très arrondis, coins ouverts',
    continuous: true,
    costPerSeat: BOWL,
  },
  rounded_rectangle: {
    label: 'Rectangle aux angles arrondis',
    desc: 'Entre le rectangle anglais et le bowl : arrondi des angles réglable',
    continuous: true,
    costPerSeat: BOWL,
  },
  tilted_bowl: {
    label: 'Bol incliné',
    desc: 'Le bord des gradins suit une pente continue, de la tribune nord haute à la sud basse',
    continuous: true,
    costPerSeat: BOWL,
    thumbnailLowView: true,
  },
  saddle_bowl: {
    label: 'Bol en selle',
    desc: 'Côtés hauts et virages bas, le bord ondule sans rupture autour du bol',
    continuous: true,
    costPerSeat: BOWL,
    thumbnailLowView: true,
  },
  cricket_oval: {
    label: 'Ovale de cricket',
    desc: 'Bol bas autour d’un grand terrain ovale engazonné, pour le cricket et le rugby',
    continuous: true,
    costPerSeat: BOWL,
    thumbnailStands: 'olympic_masts_80k',
    thumbnailLowView: true,
  },
  d_shape_vertical: {
    label: 'Chaudron en D',
    desc: 'Trois côtés en cuvette face à une tribune d’honneur verticale',
    continuous: true,
    costPerSeat: BOWL,
    retired: true,
  },
} satisfies Record<string, ShapeDefinition>;

export type StadiumShape = keyof typeof SHAPE_CATALOG;

export function shapeDefinition(shape: StadiumShape): ShapeDefinition {
  return SHAPE_CATALOG[shape];
}

/** Shapes the editor offers, in order. */
export const OFFERED_SHAPES = (Object.keys(SHAPE_CATALOG) as StadiumShape[]).filter(
  (s) => !shapeDefinition(s).retired
);

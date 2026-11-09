import {
  PROW_LIFT,
  resolveCornerPylonFrame,
  resolveProwRise,
  resolveWaveAmplitude,
  type RoofConfig,
} from './schema';

/**
 * Where a roof can be built: `arena` is one roof over the whole stadium, `stand` is built stand by
 * stand (separate stands only), `both` works either way.
 */
export type RoofPlacement = 'arena' | 'stand' | 'both';

export interface RoofDefinition {
  label: string;
  desc: string;
  placement: RoofPlacement;
  /** Roof and facade as one skin: offered with the envelopes and replaces the facade. */
  integralShell?: boolean;
  /** Movable panels: open/close settings and animation. */
  movable?: boolean;
  /** Short name when the style can be chosen for a single stand. */
  standLabel?: string;
  /** Extra building cost per seat (€) for a full-coverage roof. */
  costPerSeat: number | ((roof: RoofConfig) => number);
  /** The cost does not scale with coverage (closed roofs). */
  fixedCost?: boolean;
  /** Height (m) of the highest point of the roof structure, given the tallest stand. */
  peak?: (roof: RoofConfig, maxStandH: number) => number;
}

/** Canopy level (m) of the whole-arena roofs above the tallest stand. */
export function arenaRoofY(roof: RoofConfig, maxStandH: number): number {
  return maxStandH + Math.max(4, roof.heightOffset);
}

const above =
  (extra: number) =>
  (roof: RoofConfig, h: number): number =>
    arenaRoofY(roof, h) + extra;

/** Low closed membranes sit closer to the stands than the open canopies. */
const lowDome =
  (extra: number) =>
  (roof: RoofConfig, h: number): number =>
    h + Math.max(2.4, roof.heightOffset * 0.7) + extra;

/**
 * Every roof style, in the order the editor offers them. Adding a style is one entry here plus
 * its builder in the family table of `roofs/` (shells, canopies, structures, closed roofs) or, for
 * a stand-by-stand roof, in `roofs/standRoofs.ts`; the editor, costs, heights and thumbnails follow.
 */
export const ROOF_CATALOG = {
  cantilever: {
    label: 'Porte-à-faux (cantilever)',
    desc: 'Fléaux encastrés à l’arrière sans poteaux gênants',
    placement: 'both',
    standLabel: 'Porte-à-faux',
    costPerSeat: 520,
  },
  column_supported: {
    label: 'Sur poteaux dans les gradins',
    desc: 'Poteaux fins plantés dans les gradins (économique, vue gênée)',
    placement: 'both',
    standLabel: 'Sur poteaux',
    costPerSeat: 310,
  },
  goalpost_truss: {
    label: 'Poutre-portique (goalpost)',
    desc: 'Mégapoutre franchissant la tribune sur 2 pylônes latéraux',
    placement: 'both',
    standLabel: 'Poutre-portique',
    costPerSeat: 720,
  },
  truss: {
    label: 'Charpente treillis & frontons',
    desc: 'Toitures indépendantes à frontons vitrés d’angles',
    placement: 'both',
    standLabel: 'Charpente treillis',
    costPerSeat: 560,
  },
  suspended_masts: {
    label: 'Haubané / suspendu sur mâts',
    desc: 'Mâts extérieurs et nappes de câbles portant le toit par le dessus',
    placement: 'arena',
    costPerSeat: 980,
  },
  giant_arch: {
    label: 'Arche géante porteuse',
    desc: 'Grand arc métallique franchissant le stade & câbles suspente',
    placement: 'arena',
    costPerSeat: 1180,
    peak: (roof, h) => h + roof.heightOffset + 38,
  },
  timber_lattice: {
    label: 'Résille en bois',
    desc: 'Losanges de bois lamellé-collé qui enveloppent la façade et couvrent les tribunes',
    placement: 'arena',
    integralShell: true,
    costPerSeat: 1260,
    peak: above(9),
  },
  wave_canopy: {
    label: 'Dentelle ondulante',
    desc: 'Peau ajourée en béton fibré dont la hauteur ondule autour du stade',
    placement: 'arena',
    integralShell: true,
    costPerSeat: 1320,
    peak: (roof, h) => arenaRoofY(roof, h) + 1.8 + resolveWaveAmplitude(roof),
  },
  girder_grid: {
    label: 'Grille de méga-poutres',
    desc: '4 poutres en « # » au bord du toit, poutres secondaires jusqu’aux rives',
    placement: 'arena',
    costPerSeat: 1300,
    peak: above(7.5),
  },
  crossed_arches: {
    label: 'Arches entrecroisées',
    desc: '4 arcs tubulaires qui se croisent aux angles, suspentes en zigzag',
    placement: 'arena',
    costPerSeat: 1300,
    peak: above(21),
  },
  saddle_vault: {
    label: 'Voûte en selle',
    desc: 'Coque translucide d’un seul tenant, plus haute le long des touches',
    placement: 'arena',
    integralShell: true,
    costPerSeat: 1380,
    peak: above(14),
  },
  saucer_dome: {
    label: 'Coupole soucoupe',
    desc: 'Toit bombé à rive arrondie sur couronne de poteaux en V',
    placement: 'arena',
    costPerSeat: 1380,
    peak: above(7.5),
  },
  rising_canopy: {
    label: 'Toit montant vers le centre',
    desc: 'Toit qui s’élève vers le terrain, anneau treillis autour de l’ouverture',
    placement: 'arena',
    costPerSeat: 980,
    peak: above(8),
  },
  dished_canopy: {
    label: 'Toit creusé',
    desc: 'Toit concave relevé aux deux rives, coins retroussés et rive épaisse',
    placement: 'arena',
    costPerSeat: 980,
    peak: above(8),
  },
  faceted_shell: {
    label: 'Coque à facettes',
    desc: 'Toit et façade d’un seul tenant en facettes triangulaires de métal',
    placement: 'arena',
    integralShell: true,
    costPerSeat: 1240,
    peak: above(4.5),
  },
  serrated_canopy: {
    label: 'Auvent plissé dentelé',
    desc: 'Membrane translucide plissée vers l’extérieur, rive en dents de scie sur béquilles en V',
    placement: 'arena',
    costPerSeat: 980,
    peak: above(5.3),
  },
  prow_shell: {
    label: 'Coque en proue',
    desc: 'Toit à un seul pan avec champ ETFE, façade sombre à facettes et proue en surplomb',
    placement: 'arena',
    integralShell: true,
    costPerSeat: 1450,
    fixedCost: true,
    peak: (roof, h) => {
      const roofY = arenaRoofY(roof, h);
      return roofY + 2 + resolveProwRise(roofY) + PROW_LIFT;
    },
  },
  pleated_crown: {
    label: 'Couronne plissée',
    desc: 'Façade métallique plissée en losanges intégrée au toit vitré',
    placement: 'arena',
    integralShell: true,
    costPerSeat: 1240,
  },
  historic_gable: {
    label: 'Toit à pignon historique',
    desc: 'Toit à deux pans sur fermes rivetées, fronton au centre (stades d’avant-guerre)',
    placement: 'stand',
    standLabel: 'Pignon historique',
    costPerSeat: 520,
  },
  sawtooth: {
    label: 'Toit en dents de scie',
    desc: 'Sheds à un pan et faces vitrées, en zigzag face au terrain (tribunes séparées)',
    placement: 'stand',
    standLabel: 'Dents de scie',
    costPerSeat: 520,
  },
  butterfly: {
    label: 'Toit papillon',
    desc: 'Deux pans en V vers un chéneau central : le bord se relève côté terrain (tribunes séparées)',
    placement: 'stand',
    standLabel: 'Papillon',
    costPerSeat: 520,
  },
  barrel_vault: {
    label: 'Voûte en berceau',
    desc: 'Voûte cintrée dans la longueur de chaque tribune, nervures en arc et tirants (tribunes séparées)',
    placement: 'stand',
    standLabel: 'Voûte en berceau',
    costPerSeat: 760,
  },
  hypar_shells: {
    label: 'Coques paraboloïdes',
    desc: 'Voiles minces en béton en selle, porte-à-faux festonné sur la tribune (tribunes séparées)',
    placement: 'stand',
    standLabel: 'Coques paraboloïdes',
    costPerSeat: 880,
  },
  stand_arch: {
    label: 'Arche par tribune',
    desc: 'Une arche tubulaire au-dessus de chaque tribune, toit suspendu en croissant (tribunes séparées)',
    placement: 'stand',
    standLabel: 'Arche porteuse',
    costPerSeat: 820,
  },
  tree_columns: {
    label: 'Colonnes arborescentes',
    desc: 'Auvent plat porté par des poteaux qui se ramifient en branches (tribunes séparées)',
    placement: 'stand',
    standLabel: 'Colonnes arborescentes',
    costPerSeat: 760,
  },
  air_dome: {
    label: 'Dôme gonflable',
    desc: 'Membrane très plate tenue par la pression de l’air, filet de câbles en losanges',
    placement: 'arena',
    costPerSeat: 1050,
    fixedCost: true,
    peak: lowDome(11),
  },
  cable_dome: {
    label: 'Dôme à câbles',
    desc: 'Dôme surbaissé en tenségrité : câbles radiaux, anneaux et mâts volants sous toile',
    placement: 'arena',
    costPerSeat: 1500,
    fixedCost: true,
    peak: lowDome(14),
  },
  concrete_portals: {
    label: 'Portiques en béton',
    desc: 'Nervures en béton précontraint hors façade, en porte-à-faux sans poteau',
    placement: 'arena',
    costPerSeat: 1180,
    peak: above(10.6),
  },
  counterweighted_cantilever: {
    label: 'Fermes à contre-poids',
    desc: 'Fermes rayonnantes en porte-à-faux, ancrées par tirants derrière les tribunes',
    placement: 'arena',
    costPerSeat: 1020,
    peak: above(10),
  },
  corner_pylons: {
    label: 'Méga-pylônes d’angle',
    desc: '4 pylônes portant des méga-poutres au-dessus du bord de toit',
    placement: 'arena',
    costPerSeat: (roof) => (roof.spaceFrame ? 1280 : 1150),
    peak: (roof, h) => resolveCornerPylonFrame(roof, h).pylonTopY,
  },
  bowstring_arch: {
    label: 'Bi-poutres lenticulaires',
    desc: '2 mégapoutres tubulaires sur 4 tours d’angles',
    placement: 'arena',
    costPerSeat: 780,
  },
  bicycle_wheel: {
    label: 'Roue de vélo (anneau tendu)',
    desc: 'Anneau extérieur comprimé, anneau intérieur tendu & câbles radiaux',
    placement: 'arena',
    costPerSeat: 840,
  },
  tensile_net: {
    label: 'Résille & membranes tendues',
    desc: 'Voile anticlastic PTFE/ETFE sur mâts inclinés & haubans',
    placement: 'arena',
    costPerSeat: 910,
  },
  enveloping_shell: {
    label: 'Coque intégrale enveloppante',
    desc: 'Continuité fluide entre façade et couverture',
    placement: 'arena',
    integralShell: true,
    costPerSeat: 940,
  },
  vaulted_ring: {
    label: 'Couronne voûtée',
    desc: 'Anneau de toiture en arc sur toute sa profondeur, nervures cintrées',
    placement: 'arena',
    costPerSeat: 960,
  },
  folded_plate: {
    label: 'Toiture plissée',
    desc: 'Plis en dents de scie tout autour du stade, poutre sur chaque faîtage',
    placement: 'arena',
    costPerSeat: 900,
  },
  twin_arch: {
    label: 'Arches jumelles',
    desc: '2 arcs treillis parallèles portant l’anneau de couverture',
    placement: 'arena',
    costPerSeat: 1100,
    peak: above(29),
  },
  retractable: {
    label: 'Toit rétractable motorisé',
    desc: 'Panneaux mobiles : coulissants, pivotants, à volets ou membrane repliable',
    placement: 'arena',
    movable: true,
    costPerSeat: 1350,
  },
  arched_retractable: {
    label: 'Arches sur tours & toit coulissant',
    desc: 'Deux arches treillis longitudinales sur tours d’angle, panneaux coulissant entre elles',
    placement: 'arena',
    movable: true,
    costPerSeat: 1350,
    peak: above(32),
  },
  petal_iris: {
    label: 'Toit iris à pétales',
    desc: 'Pétales qui pivotent sur la couronne comme un diaphragme d’appareil photo',
    placement: 'arena',
    movable: true,
    costPerSeat: 1350,
  },
  spanning_girders: {
    label: 'Toit fermé sur méga-poutres',
    desc: 'Toit plat fermé porté par des poutres de grande portée, comme une arène',
    placement: 'arena',
    costPerSeat: 1450,
    peak: (roof, h) => h + Math.max(2.8, roof.heightOffset * 0.7) + 10,
  },
  fixed_dome: {
    label: 'Dôme fixe intégral',
    desc: 'Coupole fermée à résille géodésique & oculus zénithal',
    placement: 'arena',
    costPerSeat: 1520,
    peak: (roof, h) => h + roof.heightOffset + 22,
  },
  none: {
    label: 'Découvert (ciel ouvert)',
    desc: 'Gradins à l’air libre sans couverture',
    placement: 'both',
    standLabel: 'Découverte',
    costPerSeat: 0,
    peak: (_roof, h) => h,
  },
} satisfies Record<string, RoofDefinition>;

export type RoofStyle = keyof typeof ROOF_CATALOG;

export const ROOF_STYLES = Object.keys(ROOF_CATALOG) as RoofStyle[];

export function roofDefinition(style: RoofStyle): RoofDefinition {
  return ROOF_CATALOG[style];
}

/** Whether `id` names a roof built as one shell with the facade (ids may also be envelope styles). */
export function isIntegralShell(id: string): id is RoofStyle {
  return (ROOF_CATALOG as Record<string, RoofDefinition>)[id]?.integralShell === true;
}

export function isMovableRoof(style: RoofStyle): boolean {
  return roofDefinition(style).movable === true;
}

/** Extra building cost per seat (€) of the stadium roof. */
export function roofCostPerSeat(roof: RoofConfig): number {
  const def = roofDefinition(roof.style);
  const cost = typeof def.costPerSeat === 'function' ? def.costPerSeat(roof) : def.costPerSeat;
  return def.fixedCost ? cost : cost * roof.coverageRatio;
}

/** Height (m) of the roof's highest point given the tallest stand. */
export function roofPeakHeight(roof: RoofConfig, maxStandH: number): number {
  const def = roofDefinition(roof.style);
  return def.peak ? def.peak(roof, maxStandH) : maxStandH + roof.heightOffset;
}

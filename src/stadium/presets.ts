import { calculateStandMetrics, computeKopWallStandPatch, fitStandRowsToCapacity, stadiumCornerLayout } from './capacity';
import { FACADE_WALL_OFFSET } from './envelopes/rail';
import {
  clampPitchToTrack,
  isContinuousBowlShape,
  riserFromSlopeDeg,
  StadiumDocument,
  StandConfig,
  StandSide,
} from './schema';

/** Turns `side` into a full-height single-tier standing kop matching the tallest other stand. */
function alignKopWall(doc: StadiumDocument, side: StandSide): StadiumDocument {
  doc.stands[side] = { ...doc.stands[side], ...computeKopWallStandPatch(doc, side, 'safe_standing') };
  return doc;
}

function makeStand(
  id: StandSide,
  name: string,
  overrides: Partial<StandConfig> = {}
): StandConfig {
  const rowDepth = overrides.rowDepth ?? 0.8;
  const slopeAngleDeg = overrides.slopeAngleDeg ?? 28;
  const riserHeight =
    overrides.riserHeight ?? riserFromSlopeDeg(slopeAngleDeg, rowDepth);
  return {
    id,
    name,
    enabled: true,
    rows: 24,
    tiers: 1,
    slopeAngleDeg,
    rowDepth,
    riserHeight,
    seatWidth: 0.49,
    distanceToPitch: 7.2,
    aisleCount: 7,
    aisleWidth: 1.2,
    elevationStart: 0.9,
    ...overrides,
  };
}

export interface PresetDefinition {
  id: string;
  label: string;
  subtitle: string;
  createDocument: () => StadiumDocument;
}

/**
 * Generic architectural templates (no real-world stadium, club, or city names)
 * covering all 8 morphologies and all 7 structural roof typologies.
 */
const BASE_PRESETS: PresetDefinition[] = [
  {
    id: 'bowl_bowstring_60k',
    label: 'Bol Continu à Bi-Poutres',
    subtitle: 'Bol elliptique 3 étages · Bi-poutres lenticulaires sur 4 tours',
    createDocument: () => ({
      id: 'proj-bowl-60k',
      name: 'Stade Bol 3 Étages',
      updatedAt: Date.now(),
      presetId: 'bowl_bowstring_60k',
      shape: 'modern_bowl',
      cornerFill: true,
      pitch: {
        length: 105,
        width: 68,
        marginSide: 5.5,
        marginEnd: 6.5,
        hasTrack: false,
        trackLanes: 8,
        grassPattern: 'stripes',
        adBoards: true,
      },
      stands: {
        north: makeStand('north', 'Tribune Latérale Nord (3 étages)', {
          rows: 54,
          tiers: 3,
          slopeAngleDeg: 31,
          distanceToPitch: 7.5,
          aisleCount: 9,
        }),
        south: makeStand('south', 'Tribune Présidentielle Sud (3 étages)', {
          rows: 54,
          tiers: 3,
          slopeAngleDeg: 31,
          distanceToPitch: 7.5,
          aisleCount: 9,
        }),
        east: makeStand('east', 'Virage Est (3 étages)', {
          rows: 51,
          tiers: 3,
          slopeAngleDeg: 30.5,
          distanceToPitch: 7.8,
          aisleCount: 7,
        }),
        west: makeStand('west', 'Virage Ouest (3 étages)', {
          rows: 51,
          tiers: 3,
          slopeAngleDeg: 30.5,
          distanceToPitch: 7.8,
          aisleCount: 7,
        }),
      },
      roof: {
        style: 'bowstring_arch',
        heightOffset: 4.5,
        coverageRatio: 1.04,
        opacity: 0.92,
      },
      colors: {
        seatsPrimary: '#c81e1e',
        seatsSecondary: '#f8fafc',
        facade: '#334155',
        roof: '#f1f5f9',
        pitchPrimary: '#1d6832',
        pitchSecondary: '#257c3e',
        track: '#9a2b20',
      },
      materials: {
        facade: 'glass_curtain',
        roof: 'ptfe_membrane',
        structure: 'white_steel',
        seatFinish: 'molded_poly_mosaic',
        pitchTurf: 'hybrid_emerald',
        trackSurface: 'mondo_red',
        plazaSurface: 'granite_pavers',
      },
      lighting: 'day',
      objects: [
        {
          id: 'obj-dugout-1',
          type: 'dugout',
          name: 'Bancs de touche Officiels',
          position: [0, 0, 38],
          rotation: [0, Math.PI, 0],
          scale: [1, 1, 1],
        },
        {
          id: 'obj-screen-1',
          type: 'screen',
          name: 'Écran Géant Ouest',
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1.15, 1.15, 1],
          mount: 'roof',
          mountSide: 'west',
        },
        {
          id: 'obj-screen-2',
          type: 'screen',
          name: 'Écran Géant Est',
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1.15, 1.15, 1],
          mount: 'roof',
          mountSide: 'east',
        },
      ],
    }),
  },
  {
    id: 'cauldron_cable_42k',
    label: 'Chaudron Raide & Verrière Câblée',
    subtitle: 'Chaudron parabolique 2–3 étages + Kop · Câbles sur colonnade V',
    createDocument: () => ({
      id: 'proj-cauldron-42k',
      name: 'Chaudron Parabolique',
      updatedAt: Date.now(),
      presetId: 'cauldron_cable_42k',
      shape: 'steep_cauldron',
      cornerFill: true,
      pitch: {
        length: 105,
        width: 68,
        marginSide: 5.0,
        marginEnd: 6.0,
        hasTrack: false,
        trackLanes: 8,
        grassPattern: 'stripes',
        adBoards: true,
      },
      stands: {
        north: makeStand('north', 'Tribune Nord (2 étages)', {
          rows: 40,
          tiers: 2,
          slopeAngleDeg: 34,
          distanceToPitch: 6.2,
          aisleCount: 8,
        }),
        south: makeStand('south', 'Tribune Principale Sud (3 étages + Loges)', {
          rows: 41,
          tiers: 3,
          slopeAngleDeg: 34.5,
          distanceToPitch: 6.2,
          aisleCount: 8,
        }),
        east: makeStand('east', 'Tribune Kop Est (Mur 1 étage 36°)', {
          rows: 38,
          tiers: 1,
          slopeAngleDeg: 36,
          distanceToPitch: 5.8,
          aisleCount: 7,
        }),
        west: makeStand('west', 'Virage Ouest (2 étages)', {
          rows: 38,
          tiers: 2,
          slopeAngleDeg: 33.5,
          distanceToPitch: 6.2,
          aisleCount: 7,
        }),
      },
      roof: {
        style: 'bicycle_wheel',
        heightOffset: 4.5,
        coverageRatio: 1.05,
        opacity: 0.9,
      },
      colors: {
        seatsPrimary: '#1e293b',
        seatsSecondary: '#f8fafc',
        facade: '#e7e5e4',
        roof: '#bae6fd',
        pitchPrimary: '#1d6832',
        pitchSecondary: '#257c3e',
        track: '#334155',
      },
      materials: {
        facade: 'limestone_travertine',
        roof: 'polycarbonate_glass',
        structure: 'anthracite_steel',
        seatFinish: 'padded_club_velvet',
        pitchTurf: 'hybrid_emerald',
        trackSurface: 'anthracite_apron',
        plazaSurface: 'sandstone_esplanade',
      },
      lighting: 'dusk',
      objects: [
        {
          id: 'obj-dugout-caul',
          type: 'dugout',
          name: 'Bancs de touche',
          position: [0, 0, 37.5],
          rotation: [0, Math.PI, 0],
          scale: [1, 1, 1],
        },
        {
          id: 'obj-screen-caul',
          type: 'screen',
          name: 'Écran Suspendu Est',
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1.1, 1.1, 1],
          mount: 'roof',
          mountSide: 'east',
        },
      ],
    }),
  },
  {
    id: 'olympic_masts_80k',
    label: 'Grand Stade Haubané Multi-Sports',
    subtitle: 'Amphithéâtre olympique 3 étages + piste · 18 mâts aiguilles',
    createDocument: () => ({
      id: 'proj-olympic-80k',
      name: 'Grand Stade Haubané',
      updatedAt: Date.now(),
      presetId: 'olympic_masts_80k',
      shape: 'olympic_oval',
      cornerFill: true,
      pitch: {
        length: 105,
        width: 68,
        marginSide: 5.0,
        marginEnd: 6.0,
        hasTrack: true,
        trackLanes: 8,
        grassPattern: 'stripes',
        adBoards: true,
      },
      stands: {
        north: makeStand('north', 'Tribune Nord (3 étages)', {
          rows: 58,
          tiers: 3,
          slopeAngleDeg: 28,
          distanceToPitch: 6.5,
          aisleCount: 10,
        }),
        south: makeStand('south', 'Tribune Présidentielle Sud (3 étages)', {
          rows: 59,
          tiers: 3,
          slopeAngleDeg: 28.5,
          distanceToPitch: 6.5,
          aisleCount: 10,
        }),
        east: makeStand('east', 'Courbe Est (3 étages)', {
          rows: 55,
          tiers: 3,
          slopeAngleDeg: 27.5,
          distanceToPitch: 7.0,
          aisleCount: 8,
        }),
        west: makeStand('west', 'Courbe Ouest (3 étages)', {
          rows: 55,
          tiers: 3,
          slopeAngleDeg: 27.5,
          distanceToPitch: 7.0,
          aisleCount: 8,
        }),
      },
      roof: {
        style: 'suspended_masts',
        heightOffset: 5.5,
        coverageRatio: 1.06,
        opacity: 0.9,
      },
      colors: {
        seatsPrimary: '#1e3a8a',
        seatsSecondary: '#f8fafc',
        facade: '#94a3b8',
        roof: '#f1f5f9',
        pitchPrimary: '#227334',
        pitchSecondary: '#2f8f44',
        track: '#5b21b6',
      },
      materials: {
        facade: 'architectural_concrete',
        roof: 'ptfe_membrane',
        structure: 'white_steel',
        seatFinish: 'molded_poly_mosaic',
        pitchTurf: 'natural_ryegrass',
        trackSurface: 'mondo_violet',
        plazaSurface: 'granite_pavers',
      },
      lighting: 'dusk',
      objects: [
        {
          id: 'obj-dugout-oly',
          type: 'dugout',
          name: 'Bancs Officiels',
          position: [0, 0, 49.2],
          rotation: [0, Math.PI, 0],
          scale: [1.1, 1, 1],
        },
        {
          id: 'obj-esp-oly',
          type: 'esplanade',
          name: 'Parvis Principal Sud',
          position: [0, 0, 138],
          rotation: [0, 0, 0],
          scale: [1.8, 1, 1.2],
        },
      ],
    }),
  },
  {
    id: 'octagonal_cantilever_26k',
    label: 'Arène Octogonale à Fléaux',
    subtitle: 'Arène 8 pans coupés 2 étages · Portiques fléaux externes',
    createDocument: () => ({
      id: 'proj-octagonal-26k',
      name: 'Arène Octogonale 2 Étages',
      updatedAt: Date.now(),
      presetId: 'octagonal_cantilever_26k',
      shape: 'octagonal_arena',
      cornerFill: true,
      pitch: {
        length: 105,
        width: 68,
        marginSide: 5.0,
        marginEnd: 6.0,
        hasTrack: false,
        trackLanes: 8,
        grassPattern: 'stripes',
        adBoards: true,
      },
      stands: {
        north: makeStand('north', 'Tribune Nord (2 étages)', {
          rows: 28,
          tiers: 2,
          slopeAngleDeg: 30,
          distanceToPitch: 6.5,
          aisleCount: 7,
        }),
        south: makeStand('south', 'Tribune Principale Sud (2 étages)', {
          rows: 28,
          tiers: 2,
          slopeAngleDeg: 30,
          distanceToPitch: 6.5,
          aisleCount: 7,
        }),
        east: makeStand('east', 'Virage Est (2 étages)', {
          rows: 26,
          tiers: 2,
          slopeAngleDeg: 29,
          distanceToPitch: 6.8,
          aisleCount: 6,
        }),
        west: makeStand('west', 'Virage Ouest (2 étages)', {
          rows: 26,
          tiers: 2,
          slopeAngleDeg: 29,
          distanceToPitch: 6.8,
          aisleCount: 6,
        }),
      },
      roof: {
        style: 'cantilever',
        heightOffset: 3.4,
        coverageRatio: 1.04,
        opacity: 0.92,
      },
      colors: {
        seatsPrimary: '#c81e1e',
        seatsSecondary: '#facc15',
        facade: '#a16207',
        roof: '#b45309',
        pitchPrimary: '#227334',
        pitchSecondary: '#2f8f44',
        track: '#9a2b20',
      },
      materials: {
        facade: 'timber_diagrid',
        roof: 'glulam_acoustic_deck',
        structure: 'glulam_timber',
        seatFinish: 'molded_poly_mosaic',
        pitchTurf: 'natural_ryegrass',
        trackSurface: 'mondo_red',
        plazaSurface: 'sandstone_esplanade',
      },
      lighting: 'day',
      objects: [
        {
          id: 'obj-dugout-oct',
          type: 'dugout',
          name: 'Bancs de touche',
          position: [0, 0, 37.5],
          rotation: [0, Math.PI, 0],
          scale: [1, 1, 1],
        },
      ],
    }),
  },
  {
    id: 'urban_cathedral_84k',
    label: 'Cathédrale Urbaine 5 Étages',
    subtitle: 'Enceinte urbaine fermée 5 étages (36°) · Tours d’angles & coque',
    createDocument: () => ({
      id: 'proj-urban-84k',
      name: 'Enceinte Urbaine 5 Étages',
      updatedAt: Date.now(),
      presetId: 'urban_cathedral_84k',
      shape: 'compact_urban',
      cornerFill: true,
      pitch: {
        length: 105,
        width: 68,
        marginSide: 5.0,
        marginEnd: 6.0,
        hasTrack: false,
        trackLanes: 8,
        grassPattern: 'stripes',
        adBoards: true,
      },
      stands: {
        north: makeStand('north', 'Tribune Nord (5 étages en surplomb)', {
          rows: 69,
          tiers: 5,
          rowDepth: 0.78,
          slopeAngleDeg: 35.5,
          distanceToPitch: 5.6,
          aisleCount: 10,
        }),
        south: makeStand('south', 'Tribune Présidentielle Sud (5 étages)', {
          rows: 70,
          tiers: 5,
          rowDepth: 0.78,
          slopeAngleDeg: 36,
          distanceToPitch: 5.6,
          aisleCount: 10,
        }),
        east: makeStand('east', 'Virage Est (5 étages)', {
          rows: 65,
          tiers: 5,
          rowDepth: 0.77,
          slopeAngleDeg: 35,
          distanceToPitch: 5.8,
          aisleCount: 8,
        }),
        west: makeStand('west', 'Virage Ouest (5 étages)', {
          rows: 65,
          tiers: 5,
          rowDepth: 0.77,
          slopeAngleDeg: 35,
          distanceToPitch: 5.8,
          aisleCount: 8,
        }),
      },
      roof: {
        style: 'enveloping_shell',
        heightOffset: 5.2,
        coverageRatio: 1.08,
        opacity: 0.96,
      },
      colors: {
        seatsPrimary: '#172554',
        seatsSecondary: '#e2e8f0',
        facade: '#cbd5e1',
        roof: '#cbd5e1',
        pitchPrimary: '#1d6832',
        pitchSecondary: '#257c3e',
        track: '#1d4ed8',
      },
      materials: {
        facade: 'brushed_steel_mesh',
        roof: 'titanium_scales',
        structure: 'anthracite_steel',
        seatFinish: 'ribbed_stadium_shell',
        pitchTurf: 'hybrid_emerald',
        trackSurface: 'mondo_blue',
        plazaSurface: 'urban_asphalt',
      },
      lighting: 'night',
      objects: [
        {
          id: 'obj-dugout-urb',
          type: 'dugout',
          name: 'Bancs Officiels',
          position: [0, 0, 37.5],
          rotation: [0, Math.PI, 0],
          scale: [1.1, 1, 1],
        },
        {
          id: 'obj-esp-urb',
          type: 'esplanade',
          name: 'Parvis Urbain Principal',
          position: [0, 0, 114],
          rotation: [0, 0, 0],
          scale: [1.7, 1, 1.15],
        },
      ],
    }),
  },
  {
    id: 'mega_retractable_88k',
    label: 'Méga-Arène à Toit Rétractable',
    subtitle: 'Bol 5 étages · Toit à panneaux coulissants épousant l’ouverture',
    createDocument: () => ({
      id: 'proj-retractable-88k',
      name: 'Méga-Arène Rétractable',
      updatedAt: Date.now(),
      presetId: 'mega_retractable_88k',
      shape: 'modern_bowl',
      cornerFill: true,
      pitch: {
        length: 105,
        width: 68,
        marginSide: 5.5,
        marginEnd: 6.5,
        hasTrack: false,
        trackLanes: 8,
        grassPattern: 'checker',
        adBoards: true,
      },
      stands: {
        north: makeStand('north', 'Tribune Nord (5 étages + Suites)', {
          rows: 74,
          tiers: 5,
          rowDepth: 0.79,
          slopeAngleDeg: 34,
          distanceToPitch: 8.0,
          aisleCount: 11,
        }),
        south: makeStand('south', 'Tribune Sud (5 étages + Suites)', {
          rows: 74,
          tiers: 5,
          rowDepth: 0.79,
          slopeAngleDeg: 34,
          distanceToPitch: 8.0,
          aisleCount: 11,
        }),
        east: makeStand('east', 'Tribune Est (4 étages)', {
          rows: 68,
          tiers: 4,
          rowDepth: 0.78,
          slopeAngleDeg: 33,
          distanceToPitch: 8.5,
          aisleCount: 8,
        }),
        west: makeStand('west', 'Tribune Ouest (4 étages)', {
          rows: 68,
          tiers: 4,
          rowDepth: 0.78,
          slopeAngleDeg: 33,
          distanceToPitch: 8.5,
          aisleCount: 8,
        }),
      },
      roof: {
        style: 'retractable',
        heightOffset: 5.5,
        coverageRatio: 1.08,
        opacity: 0.92,
      },
      colors: {
        seatsPrimary: '#172554',
        seatsSecondary: '#cbd5e1',
        facade: '#334155',
        roof: '#64748b',
        pitchPrimary: '#166534',
        pitchSecondary: '#1a743c',
        track: '#1d4ed8',
      },
      materials: {
        facade: 'glass_curtain',
        roof: 'standing_seam_zinc',
        structure: 'white_steel',
        seatFinish: 'padded_club_velvet',
        pitchTurf: 'pro_synthetic',
        trackSurface: 'mondo_blue',
        plazaSurface: 'urban_asphalt',
      },
      lighting: 'night',
      objects: [
        {
          id: 'obj-dugout-mega',
          type: 'dugout',
          name: 'Bancs de touche',
          position: [0, 0, 38],
          rotation: [0, Math.PI, 0],
          scale: [1.1, 1, 1],
        },
        {
          id: 'obj-park-mega',
          type: 'parking',
          name: 'Parking Spectateurs Est',
          position: [128, 0, 46],
          rotation: [0, -Math.PI / 2, 0],
          scale: [1.3, 1, 1.2],
        },
      ],
    }),
  },
  {
    id: 'luminous_shell_75k',
    label: 'Arène à Coque Lumineuse ETFE',
    subtitle: 'Bol 3 étages raides · Coque intégrale translucide illuminée',
    createDocument: () => ({
      id: 'proj-shell-75k',
      name: 'Arène Coque Lumineuse',
      updatedAt: Date.now(),
      presetId: 'luminous_shell_75k',
      shape: 'modern_bowl',
      cornerFill: true,
      pitch: {
        length: 105,
        width: 68,
        marginSide: 5.2,
        marginEnd: 6.2,
        hasTrack: false,
        trackLanes: 8,
        grassPattern: 'stripes',
        adBoards: true,
      },
      stands: {
        north: makeStand('north', 'Tribune Nord (3 étages)', {
          rows: 63,
          tiers: 3,
          slopeAngleDeg: 34,
          distanceToPitch: 7.2,
          aisleCount: 9,
        }),
        south: makeStand('south', 'Tribune Principale Sud (3 étages)', {
          rows: 63,
          tiers: 3,
          slopeAngleDeg: 34,
          distanceToPitch: 7.2,
          aisleCount: 9,
        }),
        east: makeStand('east', 'Virage Est (3 étages)', {
          rows: 60,
          tiers: 3,
          slopeAngleDeg: 33.5,
          distanceToPitch: 7.5,
          aisleCount: 8,
        }),
        west: makeStand('west', 'Virage Ouest (3 étages)', {
          rows: 60,
          tiers: 3,
          slopeAngleDeg: 33.5,
          distanceToPitch: 7.5,
          aisleCount: 8,
        }),
      },
      roof: {
        style: 'enveloping_shell',
        heightOffset: 4.8,
        coverageRatio: 1.05,
        opacity: 0.86,
      },
      colors: {
        seatsPrimary: '#c81e1e',
        seatsSecondary: '#f8fafc',
        facade: '#e0f2fe',
        roof: '#e0f2fe',
        pitchPrimary: '#1d6832',
        pitchSecondary: '#257c3e',
        track: '#9a2b20',
      },
      materials: {
        facade: 'brushed_steel_mesh',
        roof: 'etfe_cushions',
        structure: 'white_steel',
        seatFinish: 'molded_poly_mosaic',
        pitchTurf: 'hybrid_emerald',
        trackSurface: 'mondo_red',
        plazaSurface: 'granite_pavers',
      },
      lighting: 'night',
      objects: [
        {
          id: 'obj-dugout-shl',
          type: 'dugout',
          name: 'Bancs de touche',
          position: [0, 0, 38],
          rotation: [0, Math.PI, 0],
          scale: [1, 1, 1],
        },
        {
          id: 'obj-esp-shl',
          type: 'esplanade',
          name: 'Esplanade Sud',
          position: [0, 0, 118],
          rotation: [0, 0, 0],
          scale: [1.8, 1, 1.3],
        },
      ],
    }),
  },
  {
    id: 'asymmetric_modular_30k',
    label: 'Enceinte Modulable Asymétrique',
    subtitle: 'Rectangulaire 2 & 3 étages différenciés · Fléaux par tribune',
    createDocument: () => ({
      id: 'proj-modular-30k',
      name: 'Enceinte Modulable Asymétrique',
      updatedAt: Date.now(),
      presetId: 'asymmetric_modular_30k',
      shape: 'english_rectangular',
      cornerFill: true,
      pitch: {
        length: 105,
        width: 68,
        marginSide: 4.8,
        marginEnd: 5.8,
        hasTrack: false,
        trackLanes: 8,
        grassPattern: 'stripes',
        adBoards: true,
      },
      stands: {
        north: makeStand('north', 'Tribune Haute Nord (3 étages)', {
          rows: 36,
          tiers: 3,
          slopeAngleDeg: 33,
          distanceToPitch: 5.8,
          aisleCount: 8,
        }),
        south: makeStand('south', 'Tribune Présidentielle Sud (3 étages)', {
          rows: 34,
          tiers: 3,
          slopeAngleDeg: 32,
          distanceToPitch: 6.0,
          aisleCount: 8,
        }),
        east: makeStand('east', 'Tribune Kop Est (2 étages)', {
          rows: 28,
          tiers: 2,
          slopeAngleDeg: 31,
          distanceToPitch: 6.0,
          aisleCount: 6,
        }),
        west: makeStand('west', 'Tribune Basse Ouest (2 étages)', {
          rows: 24,
          tiers: 2,
          slopeAngleDeg: 29,
          distanceToPitch: 6.2,
          aisleCount: 6,
        }),
      },
      roof: {
        style: 'cantilever',
        heightOffset: 3.2,
        coverageRatio: 1.0,
        opacity: 0.9,
      },
      colors: {
        seatsPrimary: '#b91c1c',
        seatsSecondary: '#18181b',
        facade: '#9a3412',
        roof: '#64748b',
        pitchPrimary: '#245830',
        pitchSecondary: '#296637',
        track: '#9a2b20',
      },
      materials: {
        facade: 'weathered_corten',
        roof: 'standing_seam_zinc',
        structure: 'corten_structure',
        seatFinish: 'molded_poly_mosaic',
        pitchTurf: 'winter_worn',
        trackSurface: 'mondo_red',
        plazaSurface: 'urban_asphalt',
      },
      lighting: 'dusk',
      objects: [
        {
          id: 'obj-dugout-mod',
          type: 'dugout',
          name: 'Bancs de touche',
          position: [0, 0, 37.2],
          rotation: [0, Math.PI, 0],
          scale: [1, 1, 1],
        },
        {
          id: 'obj-shop-mod',
          type: 'shop',
          name: 'Boutique Officielle',
          position: [-46, 0, 78],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ],
    }),
  },
  {
    id: 'traditional_four_stands_42k',
    label: '4 Tribunes Séparées Traditionnelles',
    subtitle: 'Maçonnerie brique & coins ouverts · Treillis à frontons vitrés',
    createDocument: () => ({
      id: 'proj-four-stands-42k',
      name: 'Stade 4 Tribunes Séparées',
      updatedAt: Date.now(),
      presetId: 'traditional_four_stands_42k',
      shape: 'four_stands',
      cornerFill: false,
      pitch: {
        length: 105,
        width: 68,
        marginSide: 4.8,
        marginEnd: 5.8,
        hasTrack: false,
        trackLanes: 8,
        grassPattern: 'stripes',
        adBoards: true,
      },
      stands: {
        north: makeStand('north', 'Tribune Latérale Nord (2 étages)', {
          rows: 42,
          tiers: 2,
          slopeAngleDeg: 30,
          distanceToPitch: 5.8,
          aisleCount: 8,
        }),
        south: makeStand('south', 'Tribune d’Honneur Sud (3 étages)', {
          rows: 52,
          tiers: 3,
          slopeAngleDeg: 33,
          distanceToPitch: 5.8,
          aisleCount: 8,
        }),
        east: makeStand('east', 'Grand Kop Est (2 étages)', {
          rows: 52,
          tiers: 2,
          slopeAngleDeg: 33.5,
          distanceToPitch: 5.6,
          aisleCount: 6,
        }),
        west: makeStand('west', 'Tribune Ouest (2 étages)', {
          rows: 38,
          tiers: 2,
          slopeAngleDeg: 29,
          distanceToPitch: 6.2,
          aisleCount: 6,
        }),
      },
      roof: {
        style: 'truss',
        heightOffset: 3.8,
        coverageRatio: 0.98,
        opacity: 0.96,
      },
      colors: {
        seatsPrimary: '#7f1d1d',
        seatsSecondary: '#38bdf8',
        facade: '#88291a',
        roof: '#64748b',
        pitchPrimary: '#245830',
        pitchSecondary: '#296637',
        track: '#9a2b20',
      },
      materials: {
        facade: 'heritage_brick',
        roof: 'standing_seam_zinc',
        structure: 'galvanized_steel',
        seatFinish: 'molded_poly_mosaic',
        pitchTurf: 'winter_worn',
        trackSurface: 'mondo_red',
        plazaSurface: 'granite_pavers',
      },
      lighting: 'day',
      objects: [
        {
          id: 'obj-dugout-trd',
          type: 'dugout',
          name: 'Bancs de touche',
          position: [0, 0, 37.2],
          rotation: [0, Math.PI, 0],
          scale: [1, 1, 1],
        },
        {
          id: 'obj-flood-trd-1',
          type: 'floodlight',
          name: 'Pylône Angle Nord-Ouest',
          position: [-65, 0, -45],
          rotation: [0, Math.PI * 0.25, 0],
          scale: [1, 1.05, 1],
        },
        {
          id: 'obj-flood-trd-2',
          type: 'floodlight',
          name: 'Pylône Angle Nord-Est',
          position: [65, 0, -45],
          rotation: [0, -Math.PI * 0.25, 0],
          scale: [1, 1.05, 1],
        },
        {
          id: 'obj-shop-trd',
          type: 'shop',
          name: 'Boutique du Stade',
          position: [-46, 0, 82],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ],
    }),
  },
  {
    id: 'horseshoe_amphitheatre_38k',
    label: 'Amphithéâtre Fer à Cheval (U Ouvert)',
    subtitle: 'Enceinte en U à 3 côtés ouverte sur terrasse panoramique',
    createDocument: () => ({
      id: 'proj-horseshoe-38k',
      name: 'Stade en Fer à Cheval',
      updatedAt: Date.now(),
      presetId: 'horseshoe_amphitheatre_38k',
      shape: 'horseshoe',
      cornerFill: true,
      pitch: {
        length: 105,
        width: 68,
        marginSide: 5.0,
        marginEnd: 6.0,
        hasTrack: false,
        trackLanes: 8,
        grassPattern: 'stripes',
        adBoards: true,
      },
      stands: {
        north: makeStand('north', 'Aile Nord du U (3 étages)', {
          rows: 46,
          tiers: 3,
          slopeAngleDeg: 31,
          distanceToPitch: 6.8,
          aisleCount: 8,
        }),
        south: makeStand('south', 'Aile Sud du U (3 étages)', {
          rows: 46,
          tiers: 3,
          slopeAngleDeg: 31,
          distanceToPitch: 6.8,
          aisleCount: 8,
        }),
        east: makeStand('east', 'Pignon Est Ouvert (Terrasse)', {
          enabled: false,
          rows: 20,
          tiers: 1,
          slopeAngleDeg: 28,
          distanceToPitch: 7.0,
          aisleCount: 4,
        }),
        west: makeStand('west', 'Courbe Principale Ouest (3 étages)', {
          rows: 48,
          tiers: 3,
          slopeAngleDeg: 31.5,
          distanceToPitch: 6.8,
          aisleCount: 8,
        }),
      },
      roof: {
        style: 'cantilever',
        heightOffset: 3.8,
        coverageRatio: 1.02,
        opacity: 0.92,
      },
      colors: {
        seatsPrimary: '#0284c7',
        seatsSecondary: '#f8fafc',
        facade: '#e7e5e4',
        roof: '#bae6fd',
        pitchPrimary: '#227334',
        pitchSecondary: '#2f8f44',
        track: '#1d4ed8',
      },
      materials: {
        facade: 'limestone_travertine',
        roof: 'polycarbonate_glass',
        structure: 'white_steel',
        seatFinish: 'ribbed_stadium_shell',
        pitchTurf: 'natural_ryegrass',
        trackSurface: 'mondo_blue',
        plazaSurface: 'sandstone_esplanade',
      },
      lighting: 'day',
      objects: [
        {
          id: 'obj-dugout-hs',
          type: 'dugout',
          name: 'Bancs de touche',
          position: [0, 0, 37.5],
          rotation: [0, Math.PI, 0],
          scale: [1, 1, 1],
        },
        {
          id: 'obj-screen-hs',
          type: 'screen',
          name: 'Écran Monumental Pignon Est',
          position: [69, 14, 0],
          rotation: [0, -Math.PI / 2, 0],
          scale: [1.35, 1.35, 1],
        },
        {
          id: 'obj-esp-hs',
          type: 'esplanade',
          name: 'Parvis Ouvert Est',
          position: [92, 0, 0],
          rotation: [0, Math.PI / 2, 0],
          scale: [1.3, 1, 1.15],
        },
      ],
    }),
  },
  {
    id: 'english_kop_wall_48k',
    label: 'Stade à l’Anglaise & Mur Kop Pleine Hauteur',
    subtitle: '4 tribunes hétérogènes à coins ouverts · Mur Kop debout 1 niveau pleine hauteur',
    createDocument: () =>
      // The kop is a single standing tier sized to reach the tallest stand's crest.
      alignKopWall(
    {
          id: 'proj-english-kop-48k',
          name: 'Stade 4 Tribunes & Mur Kop',
          updatedAt: Date.now(),
          presetId: 'english_kop_wall_48k',
          shape: 'four_stands',
          cornerFill: false,
          pitch: {
            length: 105,
            width: 68,
            marginSide: 4.6,
            marginEnd: 5.4,
            hasTrack: false,
            trackLanes: 8,
            grassPattern: 'stripes',
            adBoards: true,
          },
          stands: {
            north: makeStand('north', 'Tribune Latérale Nord (2 anneaux)', {
              rows: 42,
              tiers: 2,
              slopeAngleDeg: 31,
              distanceToPitch: 5.6,
              aisleCount: 8,
              vipLoges: false,
              roofStyleOverride: 'cantilever',
            }),
            south: makeStand('south', 'Tribune Principale Sud (3 anneaux + Loges)', {
              rows: 51,
              tiers: 3,
              rowDepth: 0.79,
              slopeAngleDeg: 33,
              distanceToPitch: 5.8,
              aisleCount: 9,
              vipLoges: true,
              roofStyleOverride: 'cantilever',
            }),
            east: makeStand('east', 'Mur Kop Est (1 seul niveau debout 36°)', {
              rows: 62,
              tiers: 1,
              rowDepth: 0.75,
              slopeAngleDeg: 36,
              distanceToPitch: 5.4,
              aisleCount: 8,
              seatingType: 'safe_standing',
              roofStyleOverride: 'goalpost_truss',
            }),
            west: makeStand('west', 'Tribune Historique Ouest (toit sur poteaux)', {
              rows: 36,
              tiers: 2,
              slopeAngleDeg: 29,
              distanceToPitch: 5.8,
              aisleCount: 6,
              vipLoges: false,
              roofStyleOverride: 'column_supported',
            }),
          },
          roof: {
            style: 'cantilever',
            heightOffset: 3.8,
            coverageRatio: 1.02,
            opacity: 0.94,
          },
          colors: {
            seatsPrimary: '#eab308',
            seatsSecondary: '#18181b',
            facade: '#88291a',
            roof: '#64748b',
            pitchPrimary: '#1d6832',
            pitchSecondary: '#257c3e',
            track: '#9a2b20',
          },
          materials: {
            envelopeStyle: 'exposed_structure',
            facade: 'heritage_brick',
            roof: 'standing_seam_zinc',
            structure: 'anthracite_steel',
            seatFinish: 'ribbed_stadium_shell',
            pitchTurf: 'hybrid_emerald',
            trackSurface: 'mondo_red',
            plazaSurface: 'granite_pavers',
          },
          lighting: 'dusk',
          objects: [
            {
              id: 'obj-dugout-kop',
              type: 'dugout',
              name: 'Bancs de touche',
              position: [0, 0, 37.2],
              rotation: [0, Math.PI, 0],
              scale: [1, 1, 1],
            },
            {
              id: 'obj-flood-kop-1',
              type: 'floodlight',
              name: 'Mât d’Éclairage Nord-Ouest',
              position: [-66, 0, -46],
              rotation: [0, Math.PI * 0.25, 0],
              scale: [1, 1.05, 1],
            },
            {
              id: 'obj-flood-kop-2',
              type: 'floodlight',
              name: 'Mât d’Éclairage Sud-Ouest',
              position: [-66, 0, 46],
              rotation: [0, Math.PI * 0.75, 0],
              scale: [1, 1.05, 1],
            },
          ],
        },
        'east'
      ),
  },
  {
    id: 'sunken_colonnade_44k',
    label: 'Amphithéâtre Semi-Enterré à Colonnade',
    subtitle: 'Cuvette excavée (-9,5 m) · Forêt de poteaux élancés & corniche',
    createDocument: () => ({
      id: 'proj-sunken-44k',
      name: 'Amphithéâtre Semi-Enterré',
      updatedAt: Date.now(),
      presetId: 'sunken_colonnade_44k',
      shape: 'sunken_bowl',
      sunkenDepth: 9.5,
      cornerFill: true,
      pitch: {
        length: 105,
        width: 68,
        marginSide: 5.0,
        marginEnd: 6.0,
        hasTrack: false,
        trackLanes: 8,
        grassPattern: 'stripes',
        adBoards: true,
      },
      stands: {
        north: makeStand('north', 'Tribune Nord (anneau bas enterré)', {
          rows: 42,
          tiers: 2,
          slopeAngleDeg: 32.5,
          distanceToPitch: 6.4,
          aisleCount: 8,
          vipLoges: true,
        }),
        south: makeStand('south', 'Tribune Principale Sud (anneau bas enterré)', {
          rows: 42,
          tiers: 2,
          slopeAngleDeg: 32.5,
          distanceToPitch: 6.4,
          aisleCount: 8,
          vipLoges: true,
        }),
        east: makeStand('east', 'Virage Est (2 anneaux)', {
          rows: 40,
          tiers: 2,
          slopeAngleDeg: 32,
          distanceToPitch: 6.6,
          aisleCount: 7,
          vipLoges: false,
        }),
        west: makeStand('west', 'Virage Ouest (2 anneaux)', {
          rows: 40,
          tiers: 2,
          slopeAngleDeg: 32,
          distanceToPitch: 6.6,
          aisleCount: 7,
          vipLoges: false,
        }),
      },
      roof: {
        style: 'cantilever',
        heightOffset: 3.6,
        coverageRatio: 1.05,
        opacity: 0.94,
      },
      colors: {
        seatsPrimary: '#1e3a8a',
        seatsSecondary: '#f8fafc',
        facade: '#f1f5f9',
        roof: '#f8fafc',
        pitchPrimary: '#1d6832',
        pitchSecondary: '#257c3e',
        track: '#334155',
      },
      materials: {
        envelopeStyle: 'colonnade_forest',
        facade: 'architectural_concrete',
        roof: 'ptfe_membrane',
        structure: 'white_steel',
        seatFinish: 'ribbed_stadium_shell',
        pitchTurf: 'hybrid_emerald',
        trackSurface: 'anthracite_apron',
        plazaSurface: 'sandstone_esplanade',
      },
      lighting: 'day',
      objects: [
        {
          id: 'obj-dugout-snk',
          type: 'dugout',
          name: 'Bancs de touche',
          position: [0, 0, 37.5],
          rotation: [0, Math.PI, 0],
          scale: [1, 1, 1],
        },
      ],
    }),
  },
  {
    id: 'tensile_exposed_56k',
    label: 'Arène à Résille Tendue & Béton Apparent',
    subtitle: 'Sous-face de gradins à nu & portiques · Voile tendu sur mâts inclinés',
    createDocument: () => ({
      id: 'proj-tensile-56k',
      name: 'Arène Résille & Béton Brut',
      updatedAt: Date.now(),
      presetId: 'tensile_exposed_56k',
      shape: 'modern_bowl',
      cornerFill: true,
      pitch: {
        length: 105,
        width: 68,
        marginSide: 5.2,
        marginEnd: 6.2,
        hasTrack: false,
        trackLanes: 8,
        grassPattern: 'stripes',
        adBoards: true,
      },
      stands: {
        north: makeStand('north', 'Tribune Nord (3 anneaux)', {
          rows: 50,
          tiers: 3,
          slopeAngleDeg: 31.5,
          distanceToPitch: 7.2,
          aisleCount: 9,
          vipLoges: true,
        }),
        south: makeStand('south', 'Tribune Principale Sud (3 anneaux)', {
          rows: 50,
          tiers: 3,
          slopeAngleDeg: 31.5,
          distanceToPitch: 7.2,
          aisleCount: 9,
          vipLoges: true,
        }),
        east: makeStand('east', 'Virage Est (2 anneaux)', {
          rows: 46,
          tiers: 2,
          slopeAngleDeg: 31,
          distanceToPitch: 7.5,
          aisleCount: 8,
          vipLoges: false,
        }),
        west: makeStand('west', 'Virage Ouest (2 anneaux)', {
          rows: 46,
          tiers: 2,
          slopeAngleDeg: 31,
          distanceToPitch: 7.5,
          aisleCount: 8,
          vipLoges: false,
        }),
      },
      roof: {
        style: 'tensile_net',
        heightOffset: 4.8,
        coverageRatio: 1.04,
        opacity: 0.88,
      },
      colors: {
        seatsPrimary: '#0284c7',
        seatsSecondary: '#e2e8f0',
        facade: '#94a3b8',
        roof: '#f1f5f9',
        pitchPrimary: '#227334',
        pitchSecondary: '#2f8f44',
        track: '#1d4ed8',
      },
      materials: {
        envelopeStyle: 'exposed_structure',
        facade: 'architectural_concrete',
        roof: 'ptfe_membrane',
        structure: 'galvanized_steel',
        seatFinish: 'molded_poly_mosaic',
        pitchTurf: 'natural_ryegrass',
        trackSurface: 'mondo_blue',
        plazaSurface: 'granite_pavers',
      },
      lighting: 'dusk',
      objects: [
        {
          id: 'obj-dugout-tns',
          type: 'dugout',
          name: 'Bancs de touche',
          position: [0, 0, 38],
          rotation: [0, Math.PI, 0],
          scale: [1, 1, 1],
        },
      ],
    }),
  },
  {
    id: 'climatic_dome_72k',
    label: 'Dôme Intégral & Gradins Télescopiques',
    subtitle: 'Coupole fixe à oculus · Peau coussins ETFE & gradins bas rétractables',
    createDocument: () => ({
      id: 'proj-dome-72k',
      name: 'Dôme Multisports Modulable',
      updatedAt: Date.now(),
      presetId: 'climatic_dome_72k',
      shape: 'modern_bowl',
      cornerFill: true,
      pitch: {
        length: 105,
        width: 68,
        marginSide: 5.5,
        marginEnd: 6.5,
        hasTrack: false,
        trackLanes: 8,
        grassPattern: 'checker',
        adBoards: true,
      },
      stands: {
        north: makeStand('north', 'Tribune Nord (gradins bas télescopiques)', {
          rows: 54,
          tiers: 3,
          slopeAngleDeg: 32,
          distanceToPitch: 11.5,
          aisleCount: 10,
          seatingType: 'telescopic',
          vipLoges: true,
        }),
        south: makeStand('south', 'Tribune Sud (gradins bas télescopiques)', {
          rows: 54,
          tiers: 3,
          slopeAngleDeg: 32,
          distanceToPitch: 11.5,
          aisleCount: 10,
          seatingType: 'telescopic',
          vipLoges: true,
        }),
        east: makeStand('east', 'Virage Est (gradins bas télescopiques)', {
          rows: 50,
          tiers: 3,
          slopeAngleDeg: 31.5,
          distanceToPitch: 11.0,
          aisleCount: 8,
          seatingType: 'telescopic',
          vipLoges: true,
        }),
        west: makeStand('west', 'Virage Ouest (gradins bas télescopiques)', {
          rows: 50,
          tiers: 3,
          slopeAngleDeg: 31.5,
          distanceToPitch: 11.0,
          aisleCount: 8,
          seatingType: 'telescopic',
          vipLoges: true,
        }),
      },
      roof: {
        style: 'fixed_dome',
        heightOffset: 5.5,
        coverageRatio: 1.08,
        opacity: 0.88,
      },
      colors: {
        seatsPrimary: '#be123c',
        seatsSecondary: '#f8fafc',
        facade: '#e0f2fe',
        roof: '#e0f2fe',
        pitchPrimary: '#166534',
        pitchSecondary: '#1a743c',
        track: '#334155',
      },
      materials: {
        envelopeStyle: 'enveloping_skin',
        facade: 'etfe_cushions_facade',
        roof: 'etfe_cushions',
        structure: 'white_steel',
        seatFinish: 'padded_club_velvet',
        pitchTurf: 'pro_synthetic',
        trackSurface: 'anthracite_apron',
        plazaSurface: 'granite_pavers',
      },
      lighting: 'night',
      objects: [
        {
          id: 'obj-dugout-dom',
          type: 'dugout',
          name: 'Bancs de touche',
          position: [0, 0, 38],
          rotation: [0, Math.PI, 0],
          scale: [1, 1, 1],
        },
      ],
    }),
  },
  {
    id: 'circular_folded_52k',
    label: 'Bol Circulaire à Toiture Plissée',
    subtitle: 'Enceinte ronde 3 étages · Plis en dents de scie · Coursive pleine hauteur',
    createDocument: () => ({
      id: 'proj-circular-52k',
      name: 'Stade Circulaire Plissé',
      updatedAt: Date.now(),
      presetId: 'circular_folded_52k',
      shape: 'circular_bowl',
      cornerFill: true,
      pitch: {
        length: 105,
        width: 68,
        marginSide: 5.5,
        marginEnd: 6.5,
        hasTrack: false,
        trackLanes: 8,
        grassPattern: 'checker',
        adBoards: true,
      },
      stands: {
        north: makeStand('north', 'Tribune Nord', { rows: 46, tiers: 3, slopeAngleDeg: 30, distanceToPitch: 7, aisleCount: 8 }),
        south: makeStand('south', 'Tribune Sud', { rows: 46, tiers: 3, slopeAngleDeg: 30, distanceToPitch: 7, aisleCount: 8 }),
        east: makeStand('east', 'Virage Est', { rows: 42, tiers: 3, slopeAngleDeg: 30, distanceToPitch: 7, aisleCount: 7 }),
        west: makeStand('west', 'Virage Ouest', { rows: 42, tiers: 3, slopeAngleDeg: 30, distanceToPitch: 7, aisleCount: 7 }),
      },
      roof: {
        style: 'folded_plate',
        heightOffset: 4.5,
        coverageRatio: 1.0,
        opacity: 0.95,
      },
      concourse: { width: 10, heightRatio: 1 },
      colors: {
        seatsPrimary: '#1d4ed8',
        seatsSecondary: '#e2e8f0',
        facade: '#cbd5e1',
        roof: '#f8fafc',
        pitchPrimary: '#1d6832',
        pitchSecondary: '#257c3e',
        track: '#9a2b20',
      },
      materials: {
        envelopeStyle: 'louver_curtain',
        facade: 'glass_curtain',
        roof: 'ptfe_membrane',
        structure: 'white_steel',
        seatFinish: 'molded_poly_mosaic',
        pitchTurf: 'hybrid_emerald',
        trackSurface: 'mondo_red',
        plazaSurface: 'granite_pavers',
      },
      lighting: 'dusk',
      objects: [
        {
          id: 'obj-screen-circ-w',
          type: 'screen',
          name: 'Écran Ouest',
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1.1, 1.1, 1],
          mount: 'roof',
          mountSide: 'west',
        },
        {
          id: 'obj-screen-circ-e',
          type: 'screen',
          name: 'Écran Est',
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1.1, 1.1, 1],
          mount: 'roof',
          mountSide: 'east',
        },
      ],
    }),
  },
  {
    id: 'open_ends_vault_46k',
    label: 'Bol à Virages Ouverts & Couronne Voûtée',
    subtitle: 'Toit voûté sur les seules tribunes latérales · Écrans en haut des virages',
    createDocument: () => ({
      id: 'proj-open-ends-46k',
      name: 'Stade aux Virages à Ciel Ouvert',
      updatedAt: Date.now(),
      presetId: 'open_ends_vault_46k',
      shape: 'modern_bowl',
      cornerFill: true,
      pitch: {
        length: 105,
        width: 68,
        marginSide: 5.5,
        marginEnd: 6.5,
        hasTrack: false,
        trackLanes: 8,
        grassPattern: 'stripes',
        adBoards: true,
      },
      stands: {
        north: makeStand('north', 'Tribune Latérale Nord', { rows: 48, tiers: 2, slopeAngleDeg: 31, distanceToPitch: 7.5, aisleCount: 9 }),
        south: makeStand('south', 'Tribune d’Honneur Sud', { rows: 48, tiers: 2, slopeAngleDeg: 31, distanceToPitch: 7.5, aisleCount: 9 }),
        east: makeStand('east', 'Virage Est', { rows: 34, tiers: 1, slopeAngleDeg: 32, distanceToPitch: 7.5, aisleCount: 6 }),
        west: makeStand('west', 'Virage Ouest', { rows: 34, tiers: 1, slopeAngleDeg: 32, distanceToPitch: 7.5, aisleCount: 6 }),
      },
      roof: {
        style: 'vaulted_ring',
        heightOffset: 4,
        coverageRatio: 1.0,
        opacity: 0.94,
        overConcourse: true,
        coveredSides: ['north', 'south'],
      },
      concourse: { width: 8, heightRatio: 0.5 },
      colors: {
        seatsPrimary: '#15803d',
        seatsSecondary: '#fafafa',
        facade: '#78716c',
        roof: '#f1f5f9',
        pitchPrimary: '#1d6832',
        pitchSecondary: '#257c3e',
        track: '#9a2b20',
      },
      materials: {
        envelopeStyle: 'exposed_structure',
        facade: 'heritage_brick',
        roof: 'standing_seam_zinc',
        structure: 'anthracite_steel',
        seatFinish: 'ribbed_stadium_shell',
        pitchTurf: 'hybrid_emerald',
        trackSurface: 'mondo_red',
        plazaSurface: 'granite_pavers',
      },
      lighting: 'day',
      objects: [
        {
          id: 'obj-screen-open-w',
          type: 'screen',
          name: 'Écran Virage Ouest',
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          mount: 'stand',
          mountSide: 'west',
        },
        {
          id: 'obj-screen-open-e',
          type: 'screen',
          name: 'Écran Virage Est',
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          mount: 'stand',
          mountSide: 'east',
        },
      ],
    }),
  },
];

/**
 * Builds a preset from a base template plus a patch, for the reference typologies (sliding,
 * stayed, portal, lattice and closed roofs) without repeating whole documents.
 */
function derivedPreset(
  baseId: string,
  id: string,
  label: string,
  subtitle: string,
  name: string,
  targetCapacity: number | null,
  patch: (doc: StadiumDocument) => void
): PresetDefinition {
  return {
    id,
    label,
    subtitle,
    createDocument: () => {
      const base = BASE_PRESETS.find((p) => p.id === baseId) ?? BASE_PRESETS[0];
      const doc = base.createDocument();
      doc.id = `proj-${id}`;
      doc.name = name;
      doc.presetId = id;
      patch(doc);
      if (targetCapacity !== null) fitStandRowsToCapacity(doc, targetCapacity);
      return doc;
    },
  };
}

function withMaterials(doc: StadiumDocument, patch: Partial<NonNullable<StadiumDocument['materials']>>) {
  doc.materials = { ...doc.materials!, ...patch };
}

const REFERENCE_PRESETS: PresetDefinition[] = [
  derivedPreset(
    'bowl_bowstring_60k',
    'sliding_roof_arena_50k',
    'Arène à Toit Coulissant',
    'Quatre panneaux sur méga-poutres · pelouse relevable en mode arène',
    'Arène Toit Coulissant',
    50000,
    (doc) => {
      doc.roof = {
        ...doc.roof,
        style: 'retractable',
        retractable: { motion: 'slide_longitudinal', panelCount: 4, parkEnd: 'both', openRatio: 0.6 },
      };
      doc.pitch.movablePitch = 'half_lift';
      doc.pitch.movablePitchState = 0;
      withMaterials(doc, { facade: 'polycarbonate_facade' });
    }
  ),
  derivedPreset(
    'olympic_masts_80k',
    'stayed_masts_80k',
    'Grand Stade Haubané à 18 Mâts',
    'Toit suspendu à 18 mâts par groupes de haubans · tribune basse mobile',
    'Stade Haubané 18 Mâts',
    80000,
    (doc) => {
      doc.roof = { ...doc.roof, style: 'suspended_masts', mastCount: 18, mastHeight: 14 };
    }
  ),
  derivedPreset(
    'bowl_bowstring_60k',
    'concrete_portals_48k',
    'Ovale à Portiques en Béton',
    '50 portiques précontraints hors façade, crête ondulée, aucun poteau',
    'Ovale Portiques Béton',
    48000,
    (doc) => {
      doc.roof = { ...doc.roof, style: 'concrete_portals', portalCount: 50 };
      withMaterials(doc, { facade: 'architectural_concrete', envelopeStyle: 'exposed_structure' });
    }
  ),
  derivedPreset(
    'bowl_bowstring_60k',
    'timber_lattice_36k',
    'Stade en Résille de Bois',
    'Losanges de bois lamellé-collé de la façade au toit · membrane ETFE',
    'Stade Résille Bois',
    36000,
    (doc) => {
      doc.roof = { ...doc.roof, style: 'timber_lattice', opacity: 0.55 };
      withMaterials(doc, { facade: 'glulam_lattice', roof: 'etfe_cushions', structure: 'glulam_timber' });
    }
  ),
  derivedPreset(
    'bowl_bowstring_60k',
    'lace_canopy_20k',
    'Stade en Dentelle de Béton',
    'Peau ajourée en béton fibré à hauteur ondulante, triangles vitrés',
    'Stade Dentelle',
    20000,
    (doc) => {
      doc.roof = { ...doc.roof, style: 'wave_canopy', waveAmplitude: 10 };
      withMaterials(doc, {
        facade: 'uhpc_lace_panels',
        facadePattern: 'triangulated_lace',
        facadeDensity: 1.2,
        facadeDepth: 0.6,
      });
    }
  ),
  derivedPreset(
    'traditional_four_stands_42k',
    'corner_girders_38k',
    'Quatre Tribunes et Méga-Poutres',
    'Tribunes indépendantes coiffées de 4 méga-poutres sur pylônes d’angle de 72 m',
    'Quatre Tribunes Méga-Poutres',
    38000,
    (doc) => {
      doc.roof = { ...doc.roof, style: 'corner_pylons', pylonHeight: 72, spaceFrame: false };
    }
  ),
  derivedPreset(
    'bowl_bowstring_60k',
    'space_frame_crown_67k',
    'Couronne en Treillis 3D',
    'Résille de poutres treillis sur 4 appuis d’angle, couverture bombée en PTFE',
    'Couronne Treillis 3D',
    67000,
    (doc) => {
      doc.roof = { ...doc.roof, style: 'corner_pylons', spaceFrame: true, crownRise: 12, opacity: 0.7 };
      withMaterials(doc, { roof: 'ptfe_membrane', structure: 'galvanized_steel' });
    }
  ),
  derivedPreset(
    'bowl_bowstring_60k',
    'counterweight_trusses_59k',
    'Fermes Rayonnantes à Contre-Poids',
    '32 fermes en porte-à-faux ancrées par tirants derrière les tribunes',
    'Fermes à Contre-Poids',
    59000,
    (doc) => {
      doc.roof = { ...doc.roof, style: 'counterweighted_cantilever', trussCount: 32, backspanRatio: 0.53 };
    }
  ),
  derivedPreset(
    'traditional_four_stands_42k',
    'column_forest_42k',
    'Forêt de Poteaux et Tribunes Mixtes',
    'Péristyle de ~600 poteaux fins · deux tribunes béton, deux tribunes acier',
    'Forêt de Poteaux',
    42000,
    (doc) => {
      withMaterials(doc, { envelopeStyle: 'colonnade_forest', colonnadeDensity: 3.7, facade: 'white_composite_panels' });
      doc.stands.east.structureMaterialOverride = 'white_steel';
      doc.stands.west.structureMaterialOverride = 'white_steel';
    }
  ),
  derivedPreset(
    'bowl_bowstring_60k',
    'closed_scales_arena_30k',
    'Arène Fermée à Écailles',
    'Toit fermé sur 4 méga-poutres de 80 m · façade bombée en écailles de béton',
    'Arène Écailles',
    30000,
    (doc) => {
      doc.roof = { ...doc.roof, style: 'spanning_girders', girderCount: 4 };
      withMaterials(doc, {
        facade: 'precast_concrete_scales',
        facadePattern: 'scales',
        facadeDensity: 1.25,
        facadeBulge: 0.6,
      });
    }
  ),
  derivedPreset(
    'olympic_masts_80k',
    'inclined_mast_56k',
    'Mât Incliné et Membrane Repliable',
    'Membrane suspendue à un mât incliné, repliée vers un anneau central',
    'Mât Incliné',
    56000,
    (doc) => {
      doc.roof = {
        ...doc.roof,
        style: 'retractable',
        retractable: { motion: 'fold_central', suspensionMast: true, openRatio: 0.4, panelCount: 24 },
      };
    }
  ),
  derivedPreset(
    'bowl_bowstring_60k',
    'stacking_roof_50k',
    'Toit Empilable Coulissant et Pivotant',
    'Quatre panneaux : un fixe, deux coulissants, un pivotant qui vient s’empiler',
    'Toit Empilable',
    50000,
    (doc) => {
      doc.roof = { ...doc.roof, style: 'retractable', retractable: { motion: 'combined_stack', openRatio: 0.5 } };
    }
  ),
  derivedPreset(
    'bowl_bowstring_60k',
    'gridiron_arches_70k',
    'Stade de Football Américain à Arches',
    'Terrain NFL · toit coulissant sous deux arches · écran caisson · mur vitré pivotant',
    'Stade Football Américain',
    70000,
    (doc) => {
      doc.pitch = clampPitchToTrack({
        ...doc.pitch,
        sport: 'american_football',
        endZoneColor: '#1d3c78',
        endZoneText: 'HOME',
        marginSide: 12,
        marginEnd: 6,
        grassPattern: 'stripes',
        adBoards: false,
      });
      for (const side of ['north', 'south'] as const) doc.stands[side].distanceToPitch = 12.5;
      for (const side of ['east', 'west'] as const) doc.stands[side].distanceToPitch = 7;
      // A low west end stand leaves a tall band under the roof for the glass wall.
      doc.stands.west = { ...doc.stands.west, tiers: 1, rows: 22 };
      doc.roof = {
        ...doc.roof,
        style: 'arched_retractable',
        retractable: { motion: 'slide_transverse', panelCount: 2, openRatio: 0.35, pitchDeg: 8 },
        glassWall: { side: 'west', motion: 'pivot', openRatio: 0.4 },
      };
      doc.objects = [
        {
          id: 'obj-board-nfl',
          type: 'halo_screen',
          name: 'Écran caisson central',
          position: [0, 32, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
          haloShape: 'box',
          haloDiameter: 50,
          haloBandHeight: 16,
        },
      ];
      withMaterials(doc, { pitchTurf: 'pro_synthetic', facade: 'glass_curtain' });
    }
  ),
];

export const STADIUM_PRESETS: PresetDefinition[] = [...BASE_PRESETS, ...REFERENCE_PRESETS];

const LEGACY_TEMPLATE_ALIASES: Record<string, string> = {
  modern_bowl: 'bowl_bowstring_60k',
  emirates_stadium: 'bowl_bowstring_60k',
  tottenham_bowl: 'cauldron_cable_42k',
  besiktas_park: 'cauldron_cable_42k',
  stade_de_france: 'olympic_masts_80k',
  olimpico_roma: 'olympic_masts_80k',
  marie_marvingt: 'octagonal_cantilever_26k',
  santiago_bernabeu: 'urban_cathedral_84k',
  international_grand: 'urban_cathedral_84k',
  att_stadium: 'mega_retractable_88k',
  allianz_arena: 'luminous_shell_75k',
  lehavre_shell: 'luminous_shell_75k',
  roazhon_park: 'asymmetric_modular_30k',
  urban_arena: 'asymmetric_modular_30k',
  villa_park: 'traditional_four_stands_42k',
  english_ground: 'traditional_four_stands_42k',
};

/** Plan size (m) of a shop: along its front, and from its back to its storefront. */
const SHOP_SIZE = { width: 20, depth: 15 };
/** Clearance (m) behind a stand's facade: the entrance canopy, then a walkway. */
const BEHIND_FACADE = FACADE_WALL_OFFSET + 3.4 + 2;

/**
 * Presets place their shops by eye behind a stand; this sets each one just clear of the facade and
 * entrance canopy of the stand it stands behind, whatever depth that stand has in this preset or
 * in one derived from it.
 */
function placeShopsBehindStands(doc: StadiumDocument): void {
  if (isContinuousBowlShape(doc.shape)) return;
  const layout = stadiumCornerLayout(doc);
  const back = (side: StandSide) => (doc.stands[side].enabled ? calculateStandMetrics(doc, side).totalDepth : 0);
  const lines = {
    south: layout.southZ + back('south'),
    north: -layout.northZ + back('north'),
    east: layout.eastX + back('east'),
    west: -layout.westX + back('west'),
  };
  for (const obj of doc.objects) {
    if (obj.type !== 'shop') continue;
    const [x, y, z] = obj.position;
    // Across the stand is the shop's depth, unless it is turned a quarter.
    const quarter = Math.abs(Math.sin(obj.rotation[1])) > 0.7;
    const alongZ = Math.abs(z) / lines.south > Math.abs(x) / lines.east;
    const half = (alongZ !== quarter ? SHOP_SIZE.depth : SHOP_SIZE.width) / 2;
    if (alongZ) {
      const line = z >= 0 ? lines.south : lines.north;
      obj.position = [x, y, Math.sign(z || 1) * Math.max(Math.abs(z), line + BEHIND_FACADE + half)];
    } else {
      const line = x >= 0 ? lines.east : lines.west;
      obj.position = [Math.sign(x || 1) * Math.max(Math.abs(x), line + BEHIND_FACADE + half), y, z];
    }
  }
}

export function createPresetDocument(presetId: string): StadiumDocument {
  const normalizedId = LEGACY_TEMPLATE_ALIASES[presetId] ?? presetId;
  const found =
    STADIUM_PRESETS.find((p) => p.id === normalizedId) ?? STADIUM_PRESETS[0];
  const doc = found.createDocument();
  placeShopsBehindStands(doc);
  if (doc.roof.overConcourse === undefined) {
    doc.roof.overConcourse = true;
  }
  doc.id = `stadium-${Date.now().toString(36)}`;
  doc.updatedAt = Date.now();
  return doc;
}

/** Preset id carried by stadiums started from nothing (not one of STADIUM_PRESETS). */
export const BLANK_PRESET_ID = 'blank';

/**
 * The smallest sensible ground to build up from: four single-tier stands of ten rows around the
 * pitch, with no roof, floodlights, concourse, surroundings or equipment.
 */
export function createBlankDocument(): StadiumDocument {
  const doc = createPresetDocument('traditional_four_stands_42k');
  const stand = (side: StandSide, name: string) =>
    makeStand(side, name, { rows: 10, tiers: 1, slopeAngleDeg: 24, distanceToPitch: 6, aisleCount: 4 });
  doc.name = 'Nouveau stade';
  doc.presetId = BLANK_PRESET_ID;
  doc.shape = 'four_stands';
  doc.cornerFill = false;
  doc.corners = undefined;
  doc.sunkenDepth = 0;
  doc.stands = {
    north: stand('north', 'Tribune Nord'),
    south: stand('south', 'Tribune Sud'),
    east: stand('east', 'Tribune Est'),
    west: stand('west', 'Tribune Ouest'),
  };
  doc.roof = { ...doc.roof, style: 'none', coveredSides: undefined };
  doc.concourse = { width: 0, heightRatio: 0.5 };
  doc.floodlightRig = 'none';
  doc.pitch = { ...doc.pitch, adBoards: false, hasTrack: false, movablePitch: 'none' };
  doc.site = { setting: 'none', entrances: false, perimeterFence: false };
  doc.objects = [];
  return doc;
}

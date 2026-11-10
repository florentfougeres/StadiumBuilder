import * as THREE from 'three';
import {
  AdBoardTheme,
  CornerMode,
  DEFAULT_STADIUM_MATERIALS,
  EnvelopeStyle,
  FacadeMaterialId,
  FacadePatternId,
  FloodlightRigMode,
  LightingMode,
  PitchTurfMaterialId,
  PlazaMaterialId,
  RoofMaterialId,
  SeatMaterialId,
  SkylightMode,
  StadiumDocument,
  StadiumMaterialsConfig,
  StandCrestProfile,
  StandFasciaStyle,
  StandTunnelStyle,
  StructureMaterialId,
  TrackMaterialId,
} from './schema';

/** World-space metric tile size (m) for exterior facade UVs (512 px / 8 m = 64 px/m). */
export const FACADE_UV_TILE_M = 8;
/** World-space metric tile size (m) for structural concrete bowl UVs (512 px / 6 m = 85 px/m). */
export const CONCRETE_UV_TILE_M = 6;

export interface MaterialCatalogEntry<T extends string> {
  id: T;
  label: string;
  subtitle: string;
  fallbackHex: string;
  swatchBackground: string;
}

export interface EnvelopeCatalogEntry {
  id: EnvelopeStyle;
  label: string;
  subtitle: string;
  /** Building cost per seat (€) relative to the plain enveloping skin. */
  costPerSeat: number;
  /** The underside of the stands stays open to view, so stands are built as hollow raked slabs. */
  hollowStands?: boolean;
}

export const ENVELOPE_STYLE_CATALOG: EnvelopeCatalogEntry[] = [
  {
    id: 'enveloping_skin',
    label: 'Peau enveloppante continue',
    subtitle: 'Façade unifiée (coussins ETFE, mur-rideau, brique ou résille)',
    costPerSeat: 0,
  },
  {
    id: 'exposed_structure',
    label: 'Structure apparente',
    subtitle: 'Dessous des gradins, poutres crémaillères & escaliers visibles',
    costPerSeat: -210,
    hollowStands: true,
  },
  {
    id: 'colonnade_forest',
    label: 'Colonnade / forêt de poteaux',
    subtitle: 'Péristyle dense de colonnes élancées filtrant les coursives',
    costPerSeat: 190,
    hollowStands: true,
  },
  {
    id: 'louver_curtain',
    label: 'Brise-soleil à lames ajourées',
    subtitle: 'Double peau en lames horizontales devant noyau vitré',
    costPerSeat: 150,
  },
  {
    id: 'stacked_arcades',
    label: 'Arcades superposées',
    subtitle: 'Étages d’arches en plein cintre sur piliers, corniche à chaque niveau',
    costPerSeat: 230,
  },
  {
    id: 'media_mesh',
    label: 'Façade média LED',
    subtitle: 'Peau de pixels lumineux aux couleurs du club, éclatante la nuit',
    costPerSeat: 320,
  },
  {
    id: 'helical_ramps',
    label: 'Rampes hélicoïdales',
    subtitle: 'Rampes d’accès enroulées autour du stade en bandes diagonales',
    costPerSeat: 260,
  },
  {
    id: 'horizontal_strata',
    label: 'Strates horizontales',
    subtitle: 'Coursives et balcons empilés, plus ou moins ajourés, au relief ondulant',
    costPerSeat: 210,
  },
  {
    id: 'external_stairs',
    label: 'Escaliers extérieurs',
    subtitle: 'Ossature acier apparente et volées d’escaliers en zigzag sur la façade',
    costPerSeat: 140,
  },
];

export const FACADE_MATERIAL_CATALOG: MaterialCatalogEntry<FacadeMaterialId>[] = [
  {
    id: 'etfe_cushions_facade',
    label: 'Coussins ETFE rétroéclairés',
    subtitle: 'Losanges pneumatiques translucides illuminés la nuit',
    fallbackHex: '#bae6fd',
    swatchBackground:
      'repeating-linear-gradient(45deg, rgba(15,23,42,0.38) 0 2px, transparent 2px 13px), repeating-linear-gradient(-45deg, rgba(15,23,42,0.38) 0 2px, transparent 2px 13px), radial-gradient(circle, #f8fafc 0%, #38bdf8 65%, #0284c7 100%)',
  },
  {
    id: 'glass_curtain',
    label: 'Mur-rideau verre & alu',
    subtitle: 'Vitrage structurel réfléchissant & meneaux anodisés',
    fallbackHex: '#334155',
    swatchBackground:
      'repeating-linear-gradient(90deg, rgba(15,23,42,0.85) 0 3px, transparent 3px 18px), linear-gradient(155deg, #0ea5e9 0%, #1e3a5f 48%, #0f172a 100%)',
  },
  {
    id: 'brushed_steel_mesh',
    label: 'Résille inox brossé',
    subtitle: 'Lames métalliques ajourées haute réflectance',
    fallbackHex: '#cbd5e1',
    swatchBackground:
      'repeating-linear-gradient(0deg, rgba(15,23,42,0.35) 0 2px, rgba(241,245,249,0.22) 2px 5px), linear-gradient(135deg, #e2e8f0 0%, #94a3b8 50%, #cbd5e1 100%)',
  },
  {
    id: 'architectural_concrete',
    label: 'Béton brut banché',
    subtitle: 'Voiles coffrés minéraux, joints creux & banches',
    fallbackHex: '#94a3b8',
    swatchBackground:
      'radial-gradient(circle at 25% 50%, rgba(15,23,42,0.45) 0 2px, transparent 2.5px), radial-gradient(circle at 75% 50%, rgba(15,23,42,0.45) 0 2px, transparent 2.5px), linear-gradient(180deg, #94a3b8 0%, #64748b 100%)',
  },
  {
    id: 'weathered_corten',
    label: 'Acier Corten autopatiné',
    subtitle: 'Cassettes d’acier oxydé brun-rouille texturé',
    fallbackHex: '#9a3412',
    swatchBackground:
      'repeating-linear-gradient(90deg, rgba(28,25,23,0.45) 0 2px, transparent 2px 16px), radial-gradient(circle at 30% 40%, #c2410c 0%, #7c2d12 58%, #431407 100%)',
  },
  {
    id: 'heritage_brick',
    label: 'Maçonnerie brique & pierre',
    subtitle: 'Appareillage terre cuite & joints mortier creux',
    fallbackHex: '#88291a',
    swatchBackground:
      'repeating-linear-gradient(0deg, rgba(226,232,240,0.45) 0 1.5px, transparent 1.5px 8px), repeating-linear-gradient(90deg, rgba(226,232,240,0.35) 0 1.5px, transparent 1.5px 16px), linear-gradient(135deg, #991b1b 0%, #7f1d1d 100%)',
  },
  {
    id: 'limestone_travertine',
    label: 'Pierre calcaire & travertin',
    subtitle: 'Pierre de taille claire à pores minéraux',
    fallbackHex: '#e7e5e4',
    swatchBackground:
      'repeating-linear-gradient(0deg, rgba(120,113,108,0.32) 0 1.5px, transparent 1.5px 10px), linear-gradient(135deg, #f5f5f4 0%, #d6d3d1 65%, #c7c2bc 100%)',
  },
  {
    id: 'timber_diagrid',
    label: 'Claire-voie bois & acier',
    subtitle: 'Brise-soleil mélèze thermotraité & cadre noir',
    fallbackHex: '#a16207',
    swatchBackground:
      'repeating-linear-gradient(90deg, #b45309 0 5px, #1c1917 5px 8px), linear-gradient(180deg, #d97706 0%, #78350f 100%)',
  },
  {
    id: 'terracotta_baguettes',
    label: 'Baguettes terre cuite',
    subtitle: 'Tubes céramiques ocre-rouge en claire-voie verticale',
    fallbackHex: '#b45f3c',
    swatchBackground:
      'repeating-linear-gradient(90deg, #c2693f 0 5px, #3b2a22 5px 7px), linear-gradient(180deg, #d4774a 0%, #8f4328 100%)',
  },
  {
    id: 'gold_anodized_panels',
    label: 'Bardage alu anodisé or',
    subtitle: 'Cassettes métalliques champagne-or satinées',
    fallbackHex: '#c9a24a',
    swatchBackground:
      'repeating-linear-gradient(90deg, rgba(60,40,10,0.35) 0 2px, transparent 2px 16px), linear-gradient(135deg, #f1d58a 0%, #c9a24a 55%, #8a6a24 100%)',
  },
  {
    id: 'white_composite_panels',
    label: 'Panneaux composite blancs',
    subtitle: 'Grands panneaux lisses blanc pur à joints creux',
    fallbackHex: '#f4f4f2',
    swatchBackground:
      'repeating-linear-gradient(90deg, rgba(15,23,42,0.25) 0 1.5px, transparent 1.5px 20px), repeating-linear-gradient(0deg, rgba(15,23,42,0.18) 0 1.5px, transparent 1.5px 14px), linear-gradient(135deg, #ffffff 0%, #e7e5e4 100%)',
  },
  {
    id: 'perforated_red_metal',
    label: 'Tôle perforée rouge',
    subtitle: 'Résille métallique laquée rouge, micro-perforée',
    fallbackHex: '#b91c1c',
    swatchBackground:
      'radial-gradient(circle, rgba(15,23,42,0.55) 0 1.4px, transparent 1.6px) 0 0 / 6px 6px, linear-gradient(135deg, #dc2626 0%, #991b1b 100%)',
  },
  {
    id: 'black_zinc_cladding',
    label: 'Zinc anthracite à tasseaux',
    subtitle: 'Bardage zinc prépatiné noir à joints verticaux',
    fallbackHex: '#2b2f35',
    swatchBackground:
      'repeating-linear-gradient(90deg, #1f2328 0 2px, #3a3f46 2px 4px, #2b2f35 4px 14px)',
  },
  {
    id: 'living_green_wall',
    label: 'Mur végétal',
    subtitle: 'Façade plantée de grimpantes et jardinières',
    fallbackHex: '#4d7c3a',
    swatchBackground:
      'radial-gradient(circle at 30% 30%, #6aa84f 0 3px, transparent 3.5px) 0 0 / 9px 9px, linear-gradient(135deg, #5b8c3e 0%, #2f5226 100%)',
  },
  {
    id: 'ceramic_tile_mosaic',
    label: 'Céramique émaillée',
    subtitle: 'Mosaïque de carreaux vernissés jaunes aux tons nuancés',
    fallbackHex: '#f2c21b',
    swatchBackground:
      'repeating-linear-gradient(90deg, rgba(120,90,20,0.5) 0 1px, transparent 1px 7px), repeating-linear-gradient(0deg, rgba(120,90,20,0.5) 0 1px, transparent 1px 7px), linear-gradient(135deg, #fbd34d 0%, #e9a90b 100%)',
  },
  {
    id: 'corrugated_steel_sheet',
    label: 'Tôle ondulée',
    subtitle: 'Bardage acier ondulé galvanisé des petites tribunes',
    fallbackHex: '#9aa3ad',
    swatchBackground:
      'repeating-linear-gradient(90deg, #6b7480 0 2px, #c7cdd4 2px 4px, #9aa3ad 4px 6px)',
  },
  {
    id: 'uhpc_lace_panels',
    label: 'Dentelle en BFUP',
    subtitle: 'Triangles de béton fibré blanc ajourés de motifs organiques',
    fallbackHex: '#e8e4da',
    swatchBackground:
      'radial-gradient(circle at 30% 40%, #3b4048 0 2px, transparent 2.5px) 0 0 / 8px 8px, linear-gradient(135deg, transparent 48%, #b9b4a8 49% 51%, transparent 52%) 0 0 / 12px 12px, #ebe7dd',
  },
  {
    id: 'precast_concrete_scales',
    label: 'Écailles de béton blanc',
    subtitle: 'Écailles préfabriquées qui se recouvrent en rangées décalées',
    fallbackHex: '#efede7',
    swatchBackground:
      'radial-gradient(ellipse at 50% 0%, #f7f6f2 0 60%, #c9c6bd 61% 70%, transparent 71%) 0 0 / 12px 9px, #e6e3dc',
  },
  {
    id: 'polycarbonate_facade',
    label: 'Polycarbonate alvéolaire',
    subtitle: 'Plaques translucides rainurées, rétroéclairées la nuit',
    fallbackHex: '#d6e2e8',
    swatchBackground:
      'repeating-linear-gradient(90deg, rgba(255,255,255,0.7) 0 1px, transparent 1px 3px), linear-gradient(180deg, #e3edf2 0%, #bfd0d8 100%)',
  },
  {
    id: 'glulam_lattice',
    label: 'Résille en bois lamellé-collé',
    subtitle: 'Losanges de poutres en bois devant un vitrage sombre',
    fallbackHex: '#c4965f',
    swatchBackground:
      'repeating-linear-gradient(45deg, #c4965f 0 3px, transparent 3px 11px), repeating-linear-gradient(-45deg, #b5874f 0 3px, transparent 3px 11px), #2b323b',
  },
  {
    id: 'sadu_textile',
    label: 'Toile tissée sadu',
    subtitle: 'Bandes tissées noir, blanc et rouge à motifs géométriques, façon tente bédouine',
    fallbackHex: '#2a2422',
    swatchBackground:
      'repeating-linear-gradient(0deg, #1c1917 0 6px, #f5f0e6 6px 8px, #9b1c1c 8px 11px, #f5f0e6 11px 13px)',
  },
  {
    id: 'calabash_mosaic',
    label: 'Mosaïque calebasse',
    subtitle: 'Panneaux de béton fibré aux tons de terre cuite, ocre et brun',
    fallbackHex: '#a8643a',
    swatchBackground:
      'repeating-linear-gradient(90deg, rgba(40,20,10,0.4) 0 1px, transparent 1px 8px), linear-gradient(135deg, #c98a52 0%, #8a4a2a 60%, #5c3320 100%)',
  },
  {
    id: 'woven_glassfibre_mesh',
    label: 'Maille de fibre de verre tissée',
    subtitle: 'Peau translucide tressée en losanges qui capte la lumière',
    fallbackHex: '#e8ecef',
    swatchBackground:
      'repeating-linear-gradient(45deg, rgba(100,116,139,0.45) 0 1px, transparent 1px 6px), repeating-linear-gradient(-45deg, rgba(100,116,139,0.45) 0 1px, transparent 1px 6px), #eef2f5',
  },
];

export const ROOF_MATERIAL_CATALOG: MaterialCatalogEntry<RoofMaterialId>[] = [
  {
    id: 'ptfe_membrane',
    label: 'Membrane PTFE tissée',
    subtitle: 'Toile fibre de verre téflonnée translucide',
    fallbackHex: '#f1f5f9',
    swatchBackground:
      'repeating-linear-gradient(45deg, rgba(148,163,184,0.18) 0 1px, transparent 1px 6px), linear-gradient(145deg, #ffffff 0%, #e2e8f0 70%, #cbd5e1 100%)',
  },
  {
    id: 'etfe_cushions',
    label: 'Coussins ETFE gonflables',
    subtitle: 'Losanges pneumatiques 3D translucides rétroéclairés',
    fallbackHex: '#e0f2fe',
    swatchBackground:
      'repeating-linear-gradient(45deg, rgba(15,23,42,0.32) 0 2px, transparent 2px 14px), repeating-linear-gradient(-45deg, rgba(15,23,42,0.32) 0 2px, transparent 2px 14px), radial-gradient(circle, #f8fafc 0%, #bae6fd 65%, #7dd3fc 100%)',
  },
  {
    id: 'polycarbonate_glass',
    label: 'Verrière verre feuilleté',
    subtitle: 'Panneaux vitrés haute clarté sur chevrons alu',
    fallbackHex: '#bae6fd',
    swatchBackground:
      'repeating-linear-gradient(90deg, rgba(30,41,59,0.55) 0 2px, transparent 2px 14px), linear-gradient(160deg, rgba(224,242,254,0.95) 0%, rgba(56,189,248,0.65) 55%, rgba(15,23,42,0.85) 100%)',
  },
  {
    id: 'standing_seam_zinc',
    label: 'Zinc à joint debout',
    subtitle: 'Bacs métalliques nervurés gris-ardoise',
    fallbackHex: '#64748b',
    swatchBackground:
      'repeating-linear-gradient(90deg, #334155 0 2px, #94a3b8 2px 4px, #64748b 4px 12px)',
  },
  {
    id: 'titanium_scales',
    label: 'Écailles titane anodisé',
    subtitle: 'Cassettes métalliques satinées reflets champagne',
    fallbackHex: '#cbd5e1',
    swatchBackground:
      'repeating-linear-gradient(60deg, rgba(30,41,59,0.28) 0 1.5px, transparent 1.5px 11px), linear-gradient(135deg, #f1f5f9 0%, #cbd5e1 48%, #94a3b8 100%)',
  },
  {
    id: 'glulam_acoustic_deck',
    label: 'Caissons bois acoustiques',
    subtitle: 'Sous-face bois lamellé-collé & rives acier noir',
    fallbackHex: '#b45309',
    swatchBackground:
      'repeating-linear-gradient(0deg, rgba(28,25,23,0.4) 0 1.5px, transparent 1.5px 7px), linear-gradient(135deg, #d97706 0%, #92400e 100%)',
  },
  {
    id: 'anthracite_pvc_membrane',
    label: 'Membrane PVC anthracite',
    subtitle: 'Toile tendue gris graphite mate',
    fallbackHex: '#3a3f46',
    swatchBackground:
      'repeating-linear-gradient(45deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 6px), linear-gradient(145deg, #4b5563 0%, #2b2f35 100%)',
  },
  {
    id: 'copper_verdigris',
    label: 'Cuivre vert-de-gris',
    subtitle: 'Bacs cuivre patinés vert d’eau',
    fallbackHex: '#5fa58f',
    swatchBackground:
      'repeating-linear-gradient(90deg, rgba(20,60,50,0.4) 0 2px, transparent 2px 12px), linear-gradient(135deg, #8cc7b2 0%, #4f9580 60%, #2f6b5a 100%)',
  },
  {
    id: 'red_steel_deck',
    label: 'Bac acier rouge',
    subtitle: 'Tôle nervurée laquée rouge brique',
    fallbackHex: '#a3302a',
    swatchBackground:
      'repeating-linear-gradient(90deg, #7f1d1d 0 2px, #c2412f 2px 5px, #a3302a 5px 12px)',
  },
  {
    id: 'blue_steel_deck',
    label: 'Bac acier bleu',
    subtitle: 'Tôle nervurée laquée bleu nuit',
    fallbackHex: '#1e3a8a',
    swatchBackground:
      'repeating-linear-gradient(90deg, #172554 0 2px, #2c4fa8 2px 5px, #1e3a8a 5px 12px)',
  },
  {
    id: 'solar_pv_panels',
    label: 'Panneaux photovoltaïques',
    subtitle: 'Modules solaires bleu nuit sur cadres alu',
    fallbackHex: '#1e2a4a',
    swatchBackground:
      'repeating-linear-gradient(90deg, #cbd5e1 0 1.5px, transparent 1.5px 14px), repeating-linear-gradient(0deg, #cbd5e1 0 1.5px, transparent 1.5px 9px), linear-gradient(135deg, #24345e 0%, #121a33 100%)',
  },
  {
    id: 'perforated_aluminium',
    label: 'Tôle alu perforée',
    subtitle: 'Résille aluminium naturel micro-perforée',
    fallbackHex: '#c7ccd2',
    swatchBackground:
      'radial-gradient(circle, rgba(15,23,42,0.45) 0 1.2px, transparent 1.4px) 0 0 / 5px 5px, linear-gradient(135deg, #e5e7eb 0%, #a8adb4 100%)',
  },
  {
    id: 'green_roof',
    label: 'Toiture végétalisée',
    subtitle: 'Tapis de sedum en bacs, allées de gravier',
    fallbackHex: '#5f7d3a',
    swatchBackground:
      'repeating-linear-gradient(90deg, #b8b2a2 0 2px, transparent 2px 22px), radial-gradient(circle at 30% 40%, #8a9a3c 0 3px, transparent 4px) 0 0 / 9px 9px, radial-gradient(circle at 70% 60%, #8f4a3a 0 2px, transparent 3px) 0 0 / 11px 11px, linear-gradient(135deg, #6b8a3e 0%, #3f5a2a 100%)',
  },
];

export const STRUCTURE_MATERIAL_CATALOG: MaterialCatalogEntry<StructureMaterialId>[] = [
  {
    id: 'white_steel',
    label: 'Acier thermolaqué blanc',
    subtitle: 'Finition architecturale satinée haute pureté',
    fallbackHex: '#f1f5f9',
    swatchBackground: 'linear-gradient(135deg, #ffffff 0%, #e2e8f0 55%, #94a3b8 100%)',
  },
  {
    id: 'anthracite_steel',
    label: 'Acier forgé anthracite',
    subtitle: 'Acier structurel grenaillé gris graphite',
    fallbackHex: '#334155',
    swatchBackground: 'linear-gradient(135deg, #475569 0%, #1e293b 60%, #0f172a 100%)',
  },
  {
    id: 'galvanized_steel',
    label: 'Acier galvanisé brossé',
    subtitle: 'Métal brut zingué à cristallisation fine',
    fallbackHex: '#94a3b8',
    swatchBackground:
      'repeating-linear-gradient(45deg, rgba(255,255,255,0.16) 0 2px, transparent 2px 5px), linear-gradient(135deg, #cbd5e1 0%, #64748b 100%)',
  },
  {
    id: 'glulam_timber',
    label: 'Charpente lamellé-collé',
    subtitle: 'Poutres d’épicéa/mélèze & ferrures acier noir',
    fallbackHex: '#b45309',
    swatchBackground:
      'repeating-linear-gradient(0deg, rgba(120,53,15,0.35) 0 2px, transparent 2px 5px), linear-gradient(135deg, #f59e0b 0%, #b45309 70%, #78350f 100%)',
  },
  {
    id: 'corten_structure',
    label: 'Charpente Corten patiné',
    subtitle: 'Portiques acier autopatinable rouille mat',
    fallbackHex: '#7c2d12',
    swatchBackground: 'linear-gradient(135deg, #c2410c 0%, #7c2d12 65%, #431407 100%)',
  },
  {
    id: 'stainless_steel',
    label: 'Inox poli',
    subtitle: 'Acier inoxydable brillant à reflets miroir',
    fallbackHex: '#d4d8dd',
    swatchBackground:
      'linear-gradient(135deg, #ffffff 0%, #b6bcc4 45%, #eef0f2 70%, #8f969e 100%)',
  },
  {
    id: 'bronze_steel',
    label: 'Acier bronze anodisé',
    subtitle: 'Métal mordoré brun-doré satiné',
    fallbackHex: '#8a6236',
    swatchBackground:
      'linear-gradient(135deg, #c39a5f 0%, #8a6236 60%, #4f371d 100%)',
  },
  {
    id: 'red_lacquer_steel',
    label: 'Acier laqué rouge',
    subtitle: 'Charpente peinte rouge signal',
    fallbackHex: '#c0262d',
    swatchBackground:
      'linear-gradient(135deg, #ef4444 0%, #c0262d 60%, #7f1d1d 100%)',
  },
  {
    id: 'navy_lacquer_steel',
    label: 'Acier laqué bleu marine',
    subtitle: 'Charpente peinte bleu nuit profond',
    fallbackHex: '#1f3366',
    swatchBackground:
      'linear-gradient(135deg, #3b5bab 0%, #1f3366 60%, #0f1a36 100%)',
  },
  {
    id: 'forest_green_steel',
    label: 'Acier laqué vert sapin',
    subtitle: 'Charpente peinte vert profond',
    fallbackHex: '#1f5136',
    swatchBackground:
      'linear-gradient(135deg, #3f8a5c 0%, #1f5136 60%, #0f2a1c 100%)',
  },
  {
    id: 'yellow_lacquer_steel',
    label: 'Acier laqué jaune',
    subtitle: 'Pylônes et charpente jaune signal',
    fallbackHex: '#ecba16',
    swatchBackground:
      'linear-gradient(135deg, #fcd34d 0%, #ecba16 60%, #a16207 100%)',
  },
  {
    id: 'sky_blue_lacquer_steel',
    label: 'Acier laqué bleu ciel',
    subtitle: 'Charpente peinte bleu ciel',
    fallbackHex: '#64aadc',
    swatchBackground:
      'linear-gradient(135deg, #93c5fd 0%, #64aadc 60%, #2c6c9c 100%)',
  },
  {
    id: 'reinforced_concrete',
    label: 'Béton armé',
    subtitle: 'Poteaux et poutres en béton coulé',
    fallbackHex: '#a8a59f',
    swatchBackground:
      'radial-gradient(circle at 30% 40%, rgba(15,23,42,0.25) 0 1.5px, transparent 2px) 0 0 / 8px 8px, linear-gradient(180deg, #b8b5ae 0%, #8f8c86 100%)',
  },
];

export const SEAT_MATERIAL_CATALOG: MaterialCatalogEntry<SeatMaterialId>[] = [
  {
    id: 'molded_poly_mosaic',
    label: 'Mosaïque panachée réaliste',
    subtitle: 'Coques polypropylène nuancées (effet stade habité)',
    fallbackHex: '#dc2626',
    swatchBackground:
      'radial-gradient(circle at 20% 30%, #f8fafc 0 2px, transparent 2.5px), radial-gradient(circle at 70% 65%, #fca5a5 0 2px, transparent 2.5px), linear-gradient(135deg, #dc2626 0%, #991b1b 100%)',
  },
  {
    id: 'ribbed_stadium_shell',
    label: 'Coques nervurées satinées',
    subtitle: 'Assises moulées brillantes & bandeau graphique net',
    fallbackHex: '#1d4ed8',
    swatchBackground:
      'repeating-linear-gradient(0deg, rgba(255,255,255,0.28) 0 2px, transparent 2px 7px), linear-gradient(135deg, #2563eb 0%, #1e3a8a 100%)',
  },
  {
    id: 'stone_bench',
    label: 'Gradins de marbre (sans sièges)',
    subtitle: 'Bancs de pierre blanche, ni coques ni fauteuils',
    fallbackHex: '#e7e2d6',
    swatchBackground:
      'repeating-linear-gradient(0deg, #a8a296 0 3px, #ece7dc 3px 9px)',
  },
  {
    id: 'padded_club_velvet',
    label: 'Sellerie textile rembourrée',
    subtitle: 'Fauteuils club mats à grain velours haute densité',
    fallbackHex: '#1e293b',
    swatchBackground:
      'repeating-linear-gradient(90deg, rgba(15,23,42,0.4) 0 2px, transparent 2px 8px), linear-gradient(180deg, #334155 0%, #0f172a 100%)',
  },
];

export interface SeatClubPalette {
  id: string;
  label: string;
  primary: string;
  secondary: string;
}

export const SEAT_CLUB_PALETTES: SeatClubPalette[] = [
  { id: 'crimson_chalk', label: 'Carmin & Craie', primary: '#c81e1e', secondary: '#f8fafc' },
  { id: 'navy_silver', label: 'Marine & Argent', primary: '#172554', secondary: '#e2e8f0' },
  { id: 'basalt_white', label: 'Basalte & Ivoire', primary: '#1e293b', secondary: '#f8fafc' },
  { id: 'royal_gold', label: 'Bleu Roi & Or', primary: '#1d4ed8', secondary: '#facc15' },
  { id: 'claret_sky', label: 'Bordeaux & Azur', primary: '#7f1d1d', secondary: '#38bdf8' },
  { id: 'emerald_white', label: 'Émeraude & Craie', primary: '#15803d', secondary: '#f8fafc' },
  { id: 'amber_obsidian', label: 'Anthracite & Ambre', primary: '#18181b', secondary: '#f59e0b' },
  { id: 'sky_white', label: 'Bleu Ciel & Blanc', primary: '#0284c7', secondary: '#f8fafc' },
];

export const TURF_MATERIAL_CATALOG: MaterialCatalogEntry<PitchTurfMaterialId>[] = [
  {
    id: 'hybrid_emerald',
    label: 'Gazon hybride arrosé',
    subtitle: 'Fibres cousues émeraude dense & brillance rosée',
    fallbackHex: '#1d6832',
    swatchBackground:
      'repeating-linear-gradient(90deg, #1d6832 0 10px, #257c3e 10px 20px)',
  },
  {
    id: 'natural_ryegrass',
    label: 'Ray-grass naturel printemps',
    subtitle: 'Pelouse naturelle vert tendre à fort contraste',
    fallbackHex: '#257a37',
    swatchBackground:
      'repeating-linear-gradient(90deg, #227334 0 10px, #2f8f44 10px 20px)',
  },
  {
    id: 'winter_worn',
    label: 'Pelouse d’hiver sollicitée',
    subtitle: 'Vert olive profond & zones d’appui marquées',
    fallbackHex: '#245830',
    swatchBackground:
      'radial-gradient(circle at 50% 50%, rgba(120,88,48,0.45) 0%, transparent 55%), repeating-linear-gradient(90deg, #21542c 0 10px, #296637 10px 20px)',
  },
  {
    id: 'pro_synthetic',
    label: 'Synthétique haute densité',
    subtitle: 'Tapis fibrillé régulier vert profond sans usure',
    fallbackHex: '#166534',
    swatchBackground:
      'repeating-linear-gradient(90deg, #166534 0 10px, #1a743c 10px 20px)',
  },
];

export const TRACK_MATERIAL_CATALOG: MaterialCatalogEntry<TrackMaterialId>[] = [
  {
    id: 'mondo_red',
    label: 'Tartan EPDM terre battue',
    subtitle: 'Granulés élastomères rouge brique olympique',
    fallbackHex: '#9a2b20',
    swatchBackground: 'linear-gradient(135deg, #b93829 0%, #822017 100%)',
  },
  {
    id: 'mondo_blue',
    label: 'Tartan EPDM bleu cobalt',
    subtitle: 'Granulés synthétiques bleu championnat',
    fallbackHex: '#1d4ed8',
    swatchBackground: 'linear-gradient(135deg, #2563eb 0%, #1e3a8a 100%)',
  },
  {
    id: 'mondo_violet',
    label: 'Tartan EPDM violet élite',
    subtitle: 'Revêtement vulcanisé violet haute performance',
    fallbackHex: '#5b21b6',
    swatchBackground: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)',
  },
  {
    id: 'anthracite_apron',
    label: 'Élastomère gris schiste',
    subtitle: 'Abords techniques minéraux gris anthracite',
    fallbackHex: '#334155',
    swatchBackground: 'linear-gradient(135deg, #475569 0%, #1e293b 100%)',
  },
];

export const PLAZA_MATERIAL_CATALOG: MaterialCatalogEntry<PlazaMaterialId>[] = [
  {
    id: 'granite_pavers',
    label: 'Dalles de granit gris',
    subtitle: 'Parvis minéral bouchardé & joints sciés',
    fallbackHex: '#475569',
    swatchBackground:
      'repeating-linear-gradient(90deg, rgba(255,255,255,0.12) 0 1px, transparent 1px 12px), linear-gradient(135deg, #64748b 0%, #334155 100%)',
  },
  {
    id: 'sandstone_esplanade',
    label: 'Pierre calcaire blonde',
    subtitle: 'Esplanade minérale claire méditerranéenne',
    fallbackHex: '#a8a29e',
    swatchBackground:
      'repeating-linear-gradient(90deg, rgba(68,64,60,0.22) 0 1px, transparent 1px 12px), linear-gradient(135deg, #d6d3d1 0%, #a8a29e 100%)',
  },
  {
    id: 'urban_asphalt',
    label: 'Enrobé drainant urbain',
    subtitle: 'Asphalte grenaillé sombre & marquages voirie',
    fallbackHex: '#1e293b',
    swatchBackground: 'linear-gradient(135deg, #334155 0%, #0f172a 100%)',
  },
];

export interface SimpleCatalogEntry<T extends string> {
  id: T;
  label: string;
  subtitle: string;
}

export const FACADE_PATTERN_CATALOG: SimpleCatalogEntry<FacadePatternId>[] = [
  {
    id: 'none',
    label: 'Surface standard',
    subtitle: 'Parement continu défini par l’enveloppe et le matériau',
  },
  {
    id: 'vertical_fins',
    label: 'Lamelles verticales',
    subtitle: 'Ailettes brise-soleil en relief à pas et profondeur réglables',
  },
  {
    id: 'diagrid',
    label: 'Losanges (diagrid)',
    subtitle: 'Exosquelette croisé en maille losangée tridimensionnelle',
  },
  {
    id: 'cassette_panels',
    label: 'Panneaux à facettes',
    subtitle: 'Cassettes modulaires en quinconce à relief architectural',
  },
  {
    id: 'triangulated_lace',
    label: 'Dentelle triangulée',
    subtitle: 'Triangles alternés de taille variable, ajourés',
  },
  {
    id: 'scales',
    label: 'Écailles',
    subtitle: 'Rangées d’écailles décalées qui se recouvrent',
  },
  {
    id: 'honeycomb',
    label: 'Nid d’abeille',
    subtitle: 'Alvéoles hexagonales en quinconce, joints ouverts',
  },
  {
    id: 'voronoi',
    label: 'Voronoï',
    subtitle: 'Cellules organiques irrégulières, plus fines vers le haut',
  },
  {
    id: 'pixel_mosaic',
    label: 'Mosaïque de pixels',
    subtitle: 'Panneaux plats de plusieurs couleurs tirées au hasard',
  },
  {
    id: 'woven_basket',
    label: 'Tressage',
    subtitle: 'Bandes diagonales de deux couleurs qui passent dessus-dessous',
  },
  {
    id: 'mashrabiya',
    label: 'Moucharabieh',
    subtitle: 'Résille géométrique d’étoiles à huit branches, comme un écran de bois ou de métal ajouré',
  },
];

/**
 * The four colours of the multicolour facade patterns: each chosen one, else the club colours
 * followed by a lighter and a darker shade of the main one.
 */
export function resolveFacadePalette(doc: StadiumDocument): string[] {
  const own = resolveStadiumMaterials(doc).facadePalette ?? [];
  const { seatsPrimary, seatsSecondary } = doc.colors;
  const shade = (hex: string, toward: number, t: number) =>
    `#${new THREE.Color(hex).lerp(new THREE.Color(toward), t).getHexString()}`;
  const club = [seatsPrimary, seatsSecondary, shade(seatsPrimary, 0xffffff, 0.45), shade(seatsPrimary, 0x000000, 0.35)];
  return club.map((hex, i) => own[i] ?? hex);
}

export const SKYLIGHT_MODE_CATALOG: SimpleCatalogEntry<SkylightMode>[] = [
  {
    id: 'none',
    label: 'Sans percée dédiée',
    subtitle: 'Couverture homogène selon l’opacité du matériau choisi',
  },
  {
    id: 'pitch_ring',
    label: 'Bandeau côté pelouse',
    subtitle: 'Anneau périphérique vitré favorisant l’ensoleillement du gazon',
  },
  {
    id: 'radial_slots',
    label: 'Travées radiales',
    subtitle: 'Percées lumineuses alternées entre les fermes porteuses',
  },
  {
    id: 'grid_oculi',
    label: 'Verrières & oculus',
    subtitle: 'Trame d’ouvertures zénithales projetant des puits de lumière',
  },
];

export const CORNER_MODE_CATALOG: SimpleCatalogEntry<CornerMode>[] = [
  {
    id: 'open',
    label: 'Ouvert',
    subtitle: 'Dégagement visuel et ventilation naturelle de la pelouse',
  },
  {
    id: 'filled',
    label: 'Gradins',
    subtitle: 'Continuité des rangs en quart de cercle ou à pans coupés',
  },
  {
    id: 'building',
    label: 'Bâtiment vitré',
    subtitle: 'Pavillon contemporain vitré pour salons, loges et bureaux',
  },
  {
    id: 'pavilion',
    label: 'Pavillon brique',
    subtitle: 'Clubhouse historique à toit d’ardoise, véranda et balcon',
  },
  {
    id: 'spiral_tower',
    label: 'Tour hélicoïdale',
    subtitle: 'Tour cylindrique nervurée à rampe piétonne hélicoïdale',
  },
  {
    id: 'screen',
    label: 'Écran géant',
    subtitle: 'Portique d’angle portant un écran LED haute visibilité',
  },
];

export const CREST_PROFILE_CATALOG: SimpleCatalogEntry<StandCrestProfile>[] = [
  {
    id: 'flat',
    label: 'Crête horizontale',
    subtitle: 'Ligne de couronnement droite classique sur toute la longueur',
  },
  {
    id: 'arch_crest',
    label: 'Crête bombée en arc',
    subtitle: 'Courbe parabolique plus haute au centre et effilée vers les coins',
  },
  {
    id: 'saddle_dip',
    label: 'Crête en selle',
    subtitle: 'Profil incurvé plongeant au centre et relevé vers les angles',
  },
];

export const FASCIA_STYLE_CATALOG: SimpleCatalogEntry<StandFasciaStyle>[] = [
  {
    id: 'led_ribbon',
    label: 'Bandeau LED 360°',
    subtitle: 'Ruban lumineux dynamique sur le nez des balcons',
  },
  {
    id: 'concrete',
    label: 'Béton architectural',
    subtitle: 'Nez de dalle minéral épuré sans écran lumineux',
  },
  {
    id: 'criss_cross',
    label: 'Croisillons métalliques',
    subtitle: 'Treillis en losanges historiques rivetés sur les balcons',
  },
];

export const TUNNEL_STYLE_CATALOG: SimpleCatalogEntry<StandTunnelStyle>[] = [
  {
    id: 'center',
    label: 'Tunnel central',
    subtitle: 'Sortie des joueurs axiale au droit de la ligne médiane',
  },
  {
    id: 'corner_twin',
    label: 'Double tunnel latéral',
    subtitle: 'Deux bouches d’accès symétriques vers les extrémités de tribune',
  },
  {
    id: 'none',
    label: 'Sans tunnel',
    subtitle: 'Parapet continu sans bouche d’accès sur cette tribune',
  },
];

export const FLOODLIGHT_RIG_CATALOG: SimpleCatalogEntry<FloodlightRigMode>[] = [
  {
    id: 'roof_gantry',
    label: 'Rampe intégrée au toit',
    subtitle: 'Passerelle linéaire de projecteurs LED en rive intérieure',
  },
  {
    id: 'corner_masts',
    label: 'Quatre mâts d’angle',
    subtitle: 'Pylônes treillis monumentaux implantés aux quatre coins',
  },
  {
    id: 'both',
    label: 'Mâts + rampe de toit',
    subtitle: 'Double dispositif combinant pylônes d’angle et rampe rive',
  },
  {
    id: 'none',
    label: 'Aucun éclairage',
    subtitle: 'Stade de jour sans mâts ni passerelle lumineuse',
  },
];

export const AD_BOARD_THEME_CATALOG: SimpleCatalogEntry<AdBoardTheme>[] = [
  {
    id: 'champions_league',
    label: 'Bandeau LDC (Coupes d’Europe)',
    subtitle: 'Bleu nuit étoilé · Heineken, PS5, Mastercard, FedEx, Qatar Airways, Lay’s',
  },
  {
    id: 'world_cup',
    label: 'Sponsors Coupe du Monde',
    subtitle: 'FIFA · adidas, Coca-Cola, Visa, Hyundai, Qatar Airways, McDonald’s',
  },
  {
    id: 'ligue_1',
    label: 'Sponsors Ligue 1',
    subtitle: 'McDonald’s, Uber Eats, Kipsta, beIN SPORTS, Betclic, Orange, Point.P',
  },
  {
    id: 'premier_league',
    label: 'Bandeau Premier League',
    subtitle: 'EA SPORTS FC, Barclays, Guinness, Nike, Hublot, Castrol, Oracle',
  },
  {
    id: 'europa_league',
    label: 'Bandeau Ligue Europa',
    subtitle: 'Noir & ambre · Hankook, Swissquote, Just Eat, Enterprise, Strauss',
  },
  {
    id: 'equipe_de_france',
    label: 'Sponsors Équipe de France',
    subtitle: 'Tricolore FFF · Nike, Crédit Agricole, EDF, Orange, Volkswagen, Uber Eats',
  },
  {
    id: 'mls_usa',
    label: 'MLS & Marques américaines',
    subtitle: 'Apple TV, Coca-Cola, adidas, Target, Continental, Audi, AT&T',
  },
];

export function resolveStadiumMaterials(doc: StadiumDocument): StadiumMaterialsConfig {
  return {
    ...DEFAULT_STADIUM_MATERIALS,
    ...(doc.materials ?? {}),
  };
}

// ============================================================================
// DETERMINISTIC PERIODIC NOISE & PBR BUFFER CACHE (0 MS REUSE ON SLIDER DRAG)
// ============================================================================

interface CachedPbrBuffers {
  sizeW: number;
  sizeH: number;
  albedo: Uint8Array;
  normal: Uint8Array;
  roughness: Uint8Array;
  emissive?: Uint8Array;
}

const pbrBufferCache = new Map<string, CachedPbrBuffers>();

function hash2Periodic(ix: number, iy: number, periodX: number, periodY: number, seed: number): number {
  const wx = ((ix % periodX) + periodX) % periodX;
  const wy = ((iy % periodY) + periodY) % periodY;
  let n = (wx * 374761393 + wy * 668265263 + seed * 1442695041) | 0;
  n = ((n ^ (n >>> 13)) * 1274126177) | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function periodicNoise2D(u: number, v: number, freqX: number, freqY: number, seed: number): number {
  const x = u * freqX;
  const y = v * freqY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const n00 = hash2Periodic(x0, y0, freqX, freqY, seed);
  const n10 = hash2Periodic(x0 + 1, y0, freqX, freqY, seed);
  const n01 = hash2Periodic(x0, y0 + 1, freqX, freqY, seed);
  const n11 = hash2Periodic(x0 + 1, y0 + 1, freqX, freqY, seed);

  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function periodicFbm2D(u: number, v: number, baseFreq: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise2D(u, v, freq, freq, seed + o * 31);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / (norm || 1);
}

function clampByte(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
}

function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

interface PbrPixelSample {
  r: number; // 0..255 sRGB
  g: number; // 0..255 sRGB
  b: number; // 0..255 sRGB
  a?: number; // 0..255
  height: number; // 0..1 surface height for Sobel/central-difference normal map
  roughness: number; // 0..1 physical roughness
  emissiveR?: number;
  emissiveG?: number;
  emissiveB?: number;
}

function synthesizeCachedPbrBuffers(
  cacheKey: string,
  sizeW: number,
  sizeH: number,
  normalStrength: number,
  hasEmissive: boolean,
  sampler: (u: number, v: number, px: number, py: number) => PbrPixelSample
): CachedPbrBuffers {
  const existing = pbrBufferCache.get(cacheKey);
  if (existing) return existing;

  const total = sizeW * sizeH;
  const albedo = new Uint8Array(total * 4);
  const normal = new Uint8Array(total * 4);
  const roughness = new Uint8Array(total * 4);
  const emissive = hasEmissive ? new Uint8Array(total * 4) : undefined;
  const heights = new Float32Array(total);

  for (let py = 0; py < sizeH; py++) {
    const v = py / sizeH;
    for (let px = 0; px < sizeW; px++) {
      const u = px / sizeW;
      const idx = py * sizeW + px;
      const s = sampler(u, v, px, py);

      heights[idx] = s.height;
      const i4 = idx * 4;
      albedo[i4] = clampByte(s.r);
      albedo[i4 + 1] = clampByte(s.g);
      albedo[i4 + 2] = clampByte(s.b);
      albedo[i4 + 3] = s.a !== undefined ? clampByte(s.a) : 255;

      const rByte = clampByte(clamp01(s.roughness) * 255);
      roughness[i4] = rByte;
      roughness[i4 + 1] = rByte;
      roughness[i4 + 2] = rByte;
      roughness[i4 + 3] = 255;

      if (emissive) {
        emissive[i4] = clampByte(s.emissiveR ?? 0);
        emissive[i4 + 1] = clampByte(s.emissiveG ?? 0);
        emissive[i4 + 2] = clampByte(s.emissiveB ?? 0);
        emissive[i4 + 3] = 255;
      }
    }
  }

  // Central-difference tangent-space OpenGL normal map from heightfield
  for (let py = 0; py < sizeH; py++) {
    const pyPrev = (py - 1 + sizeH) % sizeH;
    const pyNext = (py + 1) % sizeH;
    for (let px = 0; px < sizeW; px++) {
      const pxPrev = (px - 1 + sizeW) % sizeW;
      const pxNext = (px + 1) % sizeW;

      const hL = heights[py * sizeW + pxPrev];
      const hR = heights[py * sizeW + pxNext];
      const hD = heights[pyPrev * sizeW + px];
      const hU = heights[pyNext * sizeW + px];

      const dx = (hR - hL) * normalStrength;
      const dy = (hU - hD) * normalStrength;

      let nx = -dx;
      let ny = -dy;
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;

      const i4 = (py * sizeW + px) * 4;
      normal[i4] = clampByte((nx * 0.5 + 0.5) * 255);
      normal[i4 + 1] = clampByte((ny * 0.5 + 0.5) * 255);
      normal[i4 + 2] = clampByte((nz * 0.5 + 0.5) * 255);
      normal[i4 + 3] = 255;
    }
  }

  const built: CachedPbrBuffers = { sizeW, sizeH, albedo, normal, roughness, emissive };
  pbrBufferCache.set(cacheKey, built);
  return built;
}

function wrapDataTextures(
  buffers: CachedPbrBuffers,
  repeatX: number,
  repeatY: number,
  maxAnisotropy: number,
  clampV: boolean = false
): {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
  emissiveMap?: THREE.DataTexture;
} {
  const setupTex = (data: Uint8Array, isColor: boolean) => {
    const tex = new THREE.DataTexture(
      data,
      buffers.sizeW,
      buffers.sizeH,
      THREE.RGBAFormat
    );
    if (isColor) {
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = clampV ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = maxAnisotropy;
    tex.needsUpdate = true;
    return tex;
  };

  return {
    map: setupTex(buffers.albedo, true),
    normalMap: setupTex(buffers.normal, false),
    roughnessMap: setupTex(buffers.roughness, false),
    emissiveMap: buffers.emissive ? setupTex(buffers.emissive, true) : undefined,
  };
}

const TRIPLANAR_COMMON = /* glsl */ `
uniform float triplanarScale;
vec3 triW;
vec3 triSign;
vec3 triPos;
void triplanarSetup() {
  #ifdef FLAT_SHADED
    vec3 nV = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
  #else
    vec3 nV = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  #endif
  vec3 nW = inverseTransformDirection(nV, viewMatrix);
  triPos = (cameraPosition + inverseTransformDirection(-vViewPosition, viewMatrix) * length(vViewPosition)) * triplanarScale;
  triSign = vec3(nW.x < 0.0 ? -1.0 : 1.0, nW.y < 0.0 ? -1.0 : 1.0, nW.z < 0.0 ? -1.0 : 1.0);
  // Sharp blend: faces read as one clean projection, rounded corners cross-fade over a narrow band
  vec3 w = pow(abs(nW), vec3(6.0));
  triW = w / (w.x + w.y + w.z);
}
// Walls keep world-up as texture V so formwork rows stay level; X/Z faces un-mirror by facing sign
vec2 triUvX() { return vec2(-triPos.z * triSign.x, triPos.y); }
vec2 triUvY() { return vec2(triPos.x, -triPos.z * triSign.y); }
vec2 triUvZ() { return vec2(triPos.x * triSign.z, triPos.y); }
vec4 triplanarSample(sampler2D tex) {
  return texture2D(tex, triUvX()) * triW.x + texture2D(tex, triUvY()) * triW.y + texture2D(tex, triUvZ()) * triW.z;
}
`;

/**
 * Samples a tiled material's maps by world-space triplanar projection at `tileM` metres per tile
 * instead of the geometry's UVs. Bowl, concourse and facade meshes come from boxes, extrusions and
 * swept corner strips whose UVs have no common scale, so UV mapping stretched the texture on every
 * piece and broke it at each corner; world projection keeps one metric scale across all of them.
 * Re-applied on `clone()`, since three does not copy `onBeforeCompile`.
 */
function applyWorldTriplanarMapping<M extends THREE.MeshStandardMaterial>(material: M, tileM: number): M {
  const scale = 1 / tileM;
  // Read by renderers that cannot run the injected shader (the path-traced export bakes UVs from it).
  material.userData.worldTriplanarTileM = tileM;
  material.customProgramCacheKey = () => `world-triplanar-v1-${tileM}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.triplanarScale = { value: scale };
    const chunk = (name: keyof typeof THREE.ShaderChunk, from: string, to: string) => {
      const src = THREE.ShaderChunk[name];
      if (!src.includes(from)) throw new Error(`triplanar: ${name} chunk changed`);
      return src.replace(from, to);
    };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normal_pars_fragment>', `#include <normal_pars_fragment>\n${TRIPLANAR_COMMON}`)
      .replace(
        '#include <map_fragment>',
        'triplanarSetup();\n' + chunk('map_fragment', 'texture2D( map, vMapUv )', 'triplanarSample( map )')
      )
      .replace(
        '#include <roughnessmap_fragment>',
        chunk('roughnessmap_fragment', 'texture2D( roughnessMap, vRoughnessMapUv )', 'triplanarSample( roughnessMap )')
      )
      .replace(
        '#include <emissivemap_fragment>',
        chunk('emissivemap_fragment', 'texture2D( emissiveMap, vEmissiveMapUv )', 'triplanarSample( emissiveMap )')
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 triNW = inverseTransformDirection(normal, viewMatrix);
  vec3 tnX = texture2D(normalMap, triUvX()).xyz * 2.0 - 1.0;
  vec3 tnY = texture2D(normalMap, triUvY()).xyz * 2.0 - 1.0;
  vec3 tnZ = texture2D(normalMap, triUvZ()).xyz * 2.0 - 1.0;
  // Each projection's tangent-space bump expressed along its world (U, V) axes, then blended
  vec3 triBump =
    (vec3(0.0, 0.0, -triSign.x) * tnX.x + vec3(0.0, 1.0, 0.0) * tnX.y) * triW.x +
    (vec3(1.0, 0.0, 0.0) * tnY.x + vec3(0.0, 0.0, -triSign.y) * tnY.y) * triW.y +
    (vec3(triSign.z, 0.0, 0.0) * tnZ.x + vec3(0.0, 1.0, 0.0) * tnZ.y) * triW.z;
  normal = normalize(transformDirection(triNW + triBump * normalScale.x, viewMatrix));
#else
  #include <normal_fragment_maps>
#endif`
      );
  };
  const baseClone = material.clone.bind(material);
  material.clone = () => applyWorldTriplanarMapping(baseClone() as M, tileM);
  return material;
}

function triplanarTileM(material: THREE.Material | undefined): number | undefined {
  return material?.userData.worldTriplanarTileM as number | undefined;
}

/**
 * Bakes the world triplanar projection of `applyWorldTriplanarMapping` into a geometry's UVs, for
 * renderers that cannot run its injected shader (the path-traced still, the GLB export): they would
 * sample concrete and facade maps with the geometry's own UVs, which have no common scale. Each
 * triangle takes the axis of its world face normal. Returns a non-indexed copy when any of the
 * mesh's materials is triplanar (disposing `geo`), else `geo` itself.
 */
export function bakeWorldTriplanarUvs(
  geo: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  matrixWorld: THREE.Matrix4
): THREE.BufferGeometry {
  const mats = Array.isArray(material) ? material : [material];
  if (!mats.some((mt) => triplanarTileM(mt) !== undefined)) return geo;
  const flat = geo.index ? geo.toNonIndexed() : geo;
  if (flat !== geo) geo.dispose();
  const pos = flat.attributes.position;
  const uvAttr = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  if (flat.attributes.uv) uvAttr.copy(flat.attributes.uv as THREE.BufferAttribute);
  const groups =
    Array.isArray(material) && flat.groups.length
      ? flat.groups
      : [{ start: 0, count: pos.count, materialIndex: 0 }];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const e = new THREE.Vector3();
  for (const group of groups) {
    const tile = triplanarTileM(mats[group.materialIndex ?? 0]);
    if (tile === undefined) continue;
    const scale = 1 / tile;
    const end = Math.min(pos.count, group.start + group.count);
    for (let t = group.start; t + 2 < end; t += 3) {
      a.fromBufferAttribute(pos, t).applyMatrix4(matrixWorld);
      b.fromBufferAttribute(pos, t + 1).applyMatrix4(matrixWorld);
      c.fromBufferAttribute(pos, t + 2).applyMatrix4(matrixWorld);
      n.subVectors(c, b).cross(e.subVectors(a, b));
      const ax = Math.abs(n.x);
      const ay = Math.abs(n.y);
      const az = Math.abs(n.z);
      for (let k = 0; k < 3; k++) {
        const v = k === 0 ? a : k === 1 ? b : c;
        // Same projections as the viewport shader's triUvX / triUvY / triUvZ.
        if (ax >= ay && ax >= az) uvAttr.setXY(t + k, -v.z * Math.sign(n.x) * scale, v.y * scale);
        else if (ay >= az) uvAttr.setXY(t + k, v.x * scale, -v.z * Math.sign(n.y) * scale);
        else uvAttr.setXY(t + k, v.x * Math.sign(n.z) * scale, v.y * scale);
      }
    }
  }
  flat.setAttribute('uv', uvAttr);
  return flat;
}

// ============================================================================
// 1. ARCHITECTURAL PRECAST / BOARD-FORMED CONCRETE BOWL MATERIAL (512x512, 6m TILE)
// ============================================================================

export function createConcreteBowlMaterial(
  maxAnisotropy: number = 8
): THREE.MeshStandardMaterial {
  const buffers = synthesizeCachedPbrBuffers(
    'concrete_bowl_v5',
    512,
    512,
    2.4,
    false,
    (u, v) => {
      // 1 UV tile = 6.0 m x 6.0 m -> 3 x 6 architectural shuttering panels (2.0 m wide x 1.0 m tall)
      const macro = periodicFbm2D(u, v, 6, 4, 101);
      const med = periodicFbm2D(u, v, 24, 3, 107);
      const fine = periodicNoise2D(u, v, 128, 128, 202);
      const pourGrain = periodicNoise2D(u, v, 96, 16, 209);

      const cols = 3;
      const rows = 6;
      const colIdx = Math.floor(u * cols);
      const rowIdx = Math.floor(v * rows);
      const panelU = (u * cols) % 1;
      const panelV = (v * rows) % 1;

      // Hairline 1.4 cm recessed formwork shutter joint (never a coarse dark grid)
      const seamU = panelU < 0.007 || panelU > 0.993;
      const seamV = panelV < 0.011 || panelV > 0.989;
      const isSeam = seamU || seamV;

      // Exact metric circular 2.2 cm tie-rod cone plugs (2 per 2.0m x 1.0m panel)
      const dx1 = (panelU - 0.22) * 2.0;
      const dx2 = (panelU - 0.78) * 2.0;
      const dy = (panelV - 0.5) * 1.0;
      const d1 = Math.hypot(dx1, dy);
      const d2 = Math.hypot(dx2, dy);
      const isTieHole = d1 < 0.024 || d2 < 0.024;
      const isTieRim = !isTieHole && (d1 < 0.036 || d2 < 0.036);

      const panelTone = hash2Periodic(colIdx, rowIdx, cols, rows, 303);
      let base =
        166 +
        (macro - 0.5) * 15 +
        (med - 0.5) * 10 +
        (pourGrain - 0.5) * 7 +
        (fine - 0.5) * 11 +
        (panelTone - 0.5) * 7;
      let height = 0.56 + macro * 0.14 + med * 0.1 + fine * 0.08;
      let rough = 0.85 + (med - 0.5) * 0.1;

      if (isSeam) {
        base -= 16;
        height = 0.28;
        rough = 0.94;
      } else if (isTieHole) {
        base -= 20;
        height = 0.18;
        rough = 0.95;
      } else if (isTieRim) {
        base += 4;
        height = 0.62;
      }

      return {
        r: base * 1.0,
        g: base * 0.995,
        b: base * 0.975,
        height,
        roughness: rough,
      };
    }
  );

  // Sampled by world-space triplanar projection, one tile per `CONCRETE_UV_TILE_M` metres
  const maps = wrapDataTextures(buffers, 1, 1, maxAnisotropy);
  const material = new THREE.MeshStandardMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: maps.roughnessMap,
    roughness: 0.92,
    metalness: 0.03,
  });
  return applyWorldTriplanarMapping(material, CONCRETE_UV_TILE_M);
}

// ============================================================================
// 2. EXTERIOR FACADE PBR MATERIALS (14 ARCHITECTURAL MATERIALS @ 512x512, 8m TILE)
// ============================================================================

export function createFacadePbrMaterial(
  facadeId: FacadeMaterialId,
  lighting: LightingMode,
  flatShading: boolean = false,
  maxAnisotropy: number = 8,
  glowHex?: string
): THREE.MeshPhysicalMaterial {
  const isNight = lighting !== 'day';
  const key = `facade_${facadeId}_${isNight ? 'lit' : 'day'}_v6`;

  const buffers = synthesizeCachedPbrBuffers(key, 512, 512, 3.2, true, (u, v) => {
    // 1 UV tile = 8.0 m x 8.0 m (64 pixels per meter -> 1.56 cm/px)
    const fbm = periodicFbm2D(u, v, 8, 4, 401);
    const med = periodicFbm2D(u, v, 24, 3, 409);
    const fine = periodicNoise2D(u, v, 128, 128, 505);

    if (facadeId === 'etfe_cushions_facade') {
      // 4x4 diamond pneumatic pillows per 8 m tile (~2.0 m cushions)
      const du = (u * 4 + v * 4) % 1;
      const dv = (u * 4 - v * 4 + 8) % 1;
      const seam = du < 0.038 || du > 0.962 || dv < 0.038 || dv > 0.962;
      if (seam) {
        return {
          r: 44,
          g: 56,
          b: 72,
          height: 0.1,
          roughness: 0.38,
        };
      }
      const pillowDome = Math.sin(du * Math.PI) * Math.sin(dv * Math.PI);
      const cellTint = hash2Periodic(
        Math.floor(u * 4 + v * 4),
        Math.floor(u * 4 - v * 4 + 8),
        8,
        8,
        603
      );
      const glowStrength = isNight ? 0.65 + pillowDome * 0.35 : 0;
      const warmRedAccent = cellTint > 0.72;
      return {
        r: isNight
          ? (warmRedAccent ? 235 : 152) + pillowDome * 38
          : 218 + pillowDome * 32,
        g: isNight
          ? (warmRedAccent ? 98 : 212) + pillowDome * 36
          : 235 + pillowDome * 18,
        b: isNight ? 248 : 249 + pillowDome * 6,
        height: 0.2 + pillowDome * 0.78,
        roughness: 0.14 + (1 - pillowDome) * 0.14,
        emissiveR: isNight ? (warmRedAccent ? 239 : 56) * glowStrength : 0,
        emissiveG: isNight ? (warmRedAccent ? 68 : 189) * glowStrength : 0,
        emissiveB: isNight ? (warmRedAccent ? 68 : 248) * glowStrength : 0,
      };
    }

    if (facadeId === 'glass_curtain') {
      // 6x4 structural curtain-wall bays per 8 m tile (1.33 m wide x 2.0 m tall modules)
      const bayU = (u * 6) % 1;
      const bayV = (v * 4) % 1;
      const mullionX = bayU < 0.032 || bayU > 0.968;
      const transomY = bayV < 0.035 || bayV > 0.965;
      const slabSpandrel = ((v * 2) % 1) < 0.18;
      const roomLitHash = hash2Periodic(Math.floor(u * 6), Math.floor(v * 2), 6, 2, 707);
      if (mullionX || transomY) {
        return {
          r: 68,
          g: 78,
          b: 92,
          height: 0.88,
          roughness: 0.28,
        };
      }
      if (slabSpandrel) {
        return {
          r: 32,
          g: 46,
          b: 66,
          height: 0.48,
          roughness: 0.18,
        };
      }
      const lit = isNight && roomLitHash > 0.26;
      const skyGrad = 0.86 + bayV * 0.24;
      return {
        r: lit ? 222 : (64 + fbm * 22) * skyGrad,
        g: lit ? 188 : (104 + fbm * 24) * skyGrad,
        b: lit ? 126 : (142 + fbm * 26) * skyGrad,
        height: 0.5,
        roughness: 0.06 + fine * 0.03,
        emissiveR: lit ? 245 : 0,
        emissiveG: lit ? 195 : 0,
        emissiveB: lit ? 115 : 0,
      };
    }

    if (facadeId === 'brushed_steel_mesh') {
      // 64 horizontal stainless louvers per 8 m (12.5 cm pitch) + tension rods every 1.33 m
      const louver = Math.sin(v * Math.PI * 64) * 0.5 + 0.5;
      const hangerU = ((u * 6) % 1) < 0.022;
      const concourseGlow =
        !hangerU &&
        louver < 0.32 &&
        ((v * 2) % 1) > 0.24 &&
        ((v * 2) % 1) < 0.82 &&
        periodicNoise2D(u, v, 6, 6, 619) > 0.36;
      if (concourseGlow && isNight) {
        return {
          r: 236,
          g: 198,
          b: 128,
          height: 0.15,
          roughness: 0.42,
          emissiveR: 225,
          emissiveG: 178,
          emissiveB: 98,
        };
      }
      const brush = periodicNoise2D(u, v, 12, 160, 612);
      const val = hangerU ? 142 : 186 + louver * 38 + (brush - 0.5) * 14 + (fbm - 0.5) * 8;
      return {
        r: val * 0.97,
        g: val * 0.99,
        b: val * 1.04,
        height: hangerU ? 0.92 : 0.34 + louver * 0.46,
        roughness: hangerU ? 0.26 : 0.2 + (1 - louver) * 0.18,
      };
    }

    if (facadeId === 'weathered_corten') {
      // 4x10 staggered Corten cassettes per 8 m tile (2.0 m x 0.8 m cassettes)
      const rowIdx = Math.floor(v * 10);
      const rowFrac = (v * 10) % 1;
      const stagger = (rowIdx % 2) * 0.5;
      const colIdx = Math.floor(u * 4 + stagger);
      const colFrac = (u * 4 + stagger) % 1;
      const joint = rowFrac < 0.032 || colFrac < 0.018;
      if (joint) {
        const slitGlow = isNight && colFrac < 0.018 && rowIdx % 3 === 1;
        return {
          r: slitGlow ? 238 : 44,
          g: slitGlow ? 166 : 22,
          b: slitGlow ? 82 : 14,
          height: 0.12,
          roughness: 0.88,
          emissiveR: slitGlow ? 224 : 0,
          emissiveG: slitGlow ? 142 : 0,
          emissiveB: slitGlow ? 58 : 0,
        };
      }
      const patina = periodicFbm2D(u, v, 10, 4, 811);
      const streak = periodicNoise2D(u, v, 48, 6, 812);
      const panelBias = hash2Periodic(colIdx, rowIdx, 8, 10, 815);
      const rustMix = clamp01(patina * 0.52 + streak * 0.26 + panelBias * 0.24);
      return {
        r: 124 + rustMix * 84 + (fine - 0.5) * 10,
        g: 48 + rustMix * 44 + (fine - 0.5) * 6,
        b: 22 + rustMix * 16,
        height: 0.48 + patina * 0.3 + fine * 0.12,
        roughness: 0.62 + (1 - rustMix) * 0.24,
      };
    }

    if (facadeId === 'heritage_brick') {
      // True metric clay brickwork: 32 x 96 bricks per 8 m tile (25 cm x 8.3 cm bricks) + limestone stringcourse
      const beltCourse = Math.abs(v - 0.5) < 0.018 || v > 0.968;
      if (beltCourse) {
        return {
          r: 220 + (med - 0.5) * 14,
          g: 214 + (med - 0.5) * 14,
          b: 200 + (med - 0.5) * 14,
          height: 0.86,
          roughness: 0.72,
        };
      }
      const bayFrac = (u * 2) % 1;
      const pierRaised = bayFrac < 0.14 || bayFrac > 0.86 ? 0.14 : 0;
      const rowIdx = Math.floor(v * 96);
      const rowFrac = (v * 96) % 1;
      const stagger = (rowIdx % 2) * 0.5;
      const colIdx = Math.floor(u * 32 + stagger);
      const colFrac = (u * 32 + stagger) % 1;
      const isMortar = rowFrac < 0.14 || colFrac < 0.055;
      if (isMortar) {
        return {
          r: 196 + (fine - 0.5) * 14,
          g: 189 + (fine - 0.5) * 14,
          b: 178 + (fine - 0.5) * 14,
          height: 0.2 + pierRaised,
          roughness: 0.93,
        };
      }
      const brickTint = hash2Periodic(colIdx, rowIdx, 32, 96, 909);
      const clinkerDark = brickTint < 0.1 ? -24 : 0;
      return {
        r: 144 + brickTint * 48 + clinkerDark + (fine - 0.5) * 12,
        g: 50 + brickTint * 24 + clinkerDark * 0.4 + (fine - 0.5) * 8,
        b: 36 + brickTint * 16,
        height: 0.64 + pierRaised + fine * 0.14,
        roughness: 0.74 + (1 - brickTint) * 0.15,
      };
    }

    if (facadeId === 'limestone_travertine') {
      // 8x16 cut ashlar Roman travertine blocks per 8 m tile (1.0 m x 0.5 m blocks)
      const rowIdx = Math.floor(v * 16);
      const rowFrac = (v * 16) % 1;
      const colIdx = Math.floor(u * 8 + (rowIdx % 2) * 0.5);
      const colFrac = (u * 8 + (rowIdx % 2) * 0.5) % 1;
      const joint = rowFrac < 0.032 || colFrac < 0.018;
      const vein = periodicNoise2D(u, v, 8, 64, 933);
      const blockTone = hash2Periodic(colIdx, rowIdx, 16, 16, 934);
      if (joint) {
        return { r: 168, g: 160, b: 148, height: 0.22, roughness: 0.9 };
      }
      const base = 218 + (blockTone - 0.5) * 14 + (vein - 0.5) * 16 + (fine - 0.5) * 6;
      return {
        r: base * 1.02,
        g: base * 0.985,
        b: base * 0.9,
        height: 0.66 + vein * 0.18 - (fine > 0.88 ? 0.14 : 0),
        roughness: 0.54 + (fine > 0.88 ? 0.24 : 0.08),
      };
    }

    if (facadeId === 'timber_diagrid') {
      // 40 vertical larch slats per 8 m (20 cm pitch) + 4 m glulam diagrid members
      const slat = (u * 40) % 1;
      const isGap = slat < 0.26;
      const diagA = Math.abs(((u * 2 + v * 2) % 1) - 0.5) < 0.038;
      const diagB = Math.abs(((u * 2 - v * 2 + 4) % 1) - 0.5) < 0.038;
      if (diagA || diagB) {
        return {
          r: 198,
          g: 128,
          b: 58,
          height: 0.94,
          roughness: 0.46,
        };
      }
      if (isGap) {
        const warmGlow =
          isNight && ((v * 2) % 1) > 0.2 && ((v * 2) % 1) < 0.84 && periodicNoise2D(u, v, 6, 6, 956) > 0.4;
        return {
          r: warmGlow ? 240 : 36,
          g: warmGlow ? 190 : 30,
          b: warmGlow ? 108 : 28,
          height: 0.18,
          roughness: 0.24,
          emissiveR: warmGlow ? 228 : 0,
          emissiveG: warmGlow ? 176 : 0,
          emissiveB: warmGlow ? 92 : 0,
        };
      }
      const grain = periodicNoise2D(u, v, 80, 10, 955);
      return {
        r: 168 + grain * 42,
        g: 104 + grain * 28,
        b: 48 + grain * 14,
        height: 0.68 + grain * 0.16,
        roughness: 0.52 + (1 - grain) * 0.18,
      };
    }

    if (facadeId === 'terracotta_baguettes') {
      // 48 vertical ceramic baguettes per 8 m (16.6 cm spacing) + horizontal aluminum carriers every 2 m
      const carrierV = ((v * 4) % 1) < 0.024;
      if (carrierV) {
        return { r: 72, g: 76, b: 84, height: 0.82, roughness: 0.34 };
      }
      const rod = (u * 48) % 1;
      if (rod < 0.25) {
        const warmGlow =
          isNight && ((v * 2) % 1) > 0.22 && ((v * 2) % 1) < 0.8 && periodicNoise2D(u, v, 6, 6, 1500) > 0.42;
        return {
          r: warmGlow ? 238 : 42,
          g: warmGlow ? 186 : 32,
          b: warmGlow ? 104 : 28,
          height: 0.16,
          roughness: 0.28,
          emissiveR: warmGlow ? 220 : 0,
          emissiveG: warmGlow ? 168 : 0,
          emissiveB: warmGlow ? 88 : 0,
        };
      }
      const profile = Math.sin(((rod - 0.25) / 0.75) * Math.PI);
      const tone = hash2Periodic(Math.floor(u * 48), Math.floor(v * 4), 48, 4, 1501);
      return {
        r: 164 + tone * 36 + profile * 28,
        g: 78 + tone * 20 + profile * 16,
        b: 48 + tone * 10 + profile * 10,
        height: 0.36 + profile * 0.58,
        roughness: 0.64 + (1 - profile) * 0.16,
      };
    }

    if (facadeId === 'black_zinc_cladding') {
      // 16 standing-seam pre-weathered anthracite zinc bays per 8 m (50 cm standing-seam pitch)
      const batten = (u * 16) % 1;
      const crossWelt = ((v * 4) % 1) < 0.016;
      if (batten < 0.065) {
        return { r: 92, g: 98, b: 108, height: 0.95, roughness: 0.3 };
      }
      if (batten < 0.105 || crossWelt) {
        return { r: 34, g: 38, b: 44, height: 0.28, roughness: 0.56 };
      }
      const stripTone = hash2Periodic(Math.floor(u * 16), Math.floor(v * 4), 16, 4, 1508);
      const val = 54 + stripTone * 11 + (fbm - 0.5) * 8 + (fine - 0.5) * 5;
      return {
        r: val * 0.96,
        g: val,
        b: val * 1.06,
        height: 0.55 + fine * 0.05,
        roughness: 0.38 + (fbm - 0.5) * 0.09,
      };
    }

    if (facadeId === 'ceramic_tile_mosaic') {
      // 40 x 40 glazed 20 cm tiles per 8 m, each fired a slightly different yellow
      const tu = (u * 40) % 1;
      const tv = (v * 40) % 1;
      if (tu < 0.07 || tv < 0.07) {
        return { r: 150, g: 128, b: 92, height: 0.2, roughness: 0.9 };
      }
      const tone = hash2Periodic(Math.floor(u * 40), Math.floor(v * 40), 40, 40, 1521);
      const dome = Math.sin(tu * Math.PI) * Math.sin(tv * Math.PI);
      const deep = tone > 0.86 ? -38 : 0; // a scatter of ochre tiles
      return {
        r: 238 + (tone - 0.5) * 20 + deep * 0.4,
        g: 188 + (tone - 0.5) * 40 + deep,
        b: 30 + (tone - 0.5) * 30,
        height: 0.6 + dome * 0.08,
        roughness: 0.12 + (fine - 0.5) * 0.06,
      };
    }

    if (facadeId === 'corrugated_steel_sheet') {
      // 76 mm-pitch sinusoidal corrugation (105 waves per 8 m), sheets lapped every 2.5 m
      const wave = Math.sin(u * 105 * Math.PI * 2);
      const lap = ((v * 3.2) % 1) < 0.012;
      const sheet = hash2Periodic(Math.floor(u * 8), Math.floor(v * 3.2), 8, 4, 1531);
      const val = 150 + wave * 22 + (sheet - 0.5) * 18 + (fbm - 0.5) * 16;
      const rust = Math.max(0, med - 0.74) * 160; // streaks of weathering
      return {
        r: (lap ? val - 30 : val) + rust * 0.5,
        g: (lap ? val - 28 : val + 4) - rust * 0.1,
        b: (lap ? val - 24 : val + 10) - rust * 0.4,
        height: lap ? 0.2 : 0.5 + wave * 0.32,
        roughness: 0.36 + (fbm - 0.5) * 0.12 + rust * 0.003,
      };
    }

    if (facadeId === 'uhpc_lace_panels') {
      // 3 x 3 cells of two 2.7 m triangles per 8 m, pierced by organic lace openings
      const su = (u * 3) % 1;
      const sv = (v * 3) % 1;
      const joint = su < 0.012 || sv < 0.012 || Math.abs(su + sv - 1) < 0.012;
      if (joint) return { r: 150, g: 146, b: 138, height: 0.2, roughness: 0.9 };
      const lace = periodicNoise2D(u, v, 36, 36, 1551) * 0.7 + periodicNoise2D(u, v, 72, 72, 1552) * 0.3;
      if (lace > 0.6) {
        const glow = isNight && periodicNoise2D(u, v, 6, 6, 1553) > 0.35;
        return {
          r: glow ? 236 : 40,
          g: glow ? 196 : 44,
          b: glow ? 132 : 50,
          height: 0.05,
          roughness: 0.3,
          emissiveR: glow ? 220 : 0,
          emissiveG: glow ? 178 : 0,
          emissiveB: glow ? 112 : 0,
        };
      }
      const rim = Math.max(0, lace - 0.52) * 4;
      const val = 230 + (fbm - 0.5) * 10 + (fine - 0.5) * 6 - rim * 30;
      return { r: val, g: val * 0.985, b: val * 0.95, height: 0.7 - rim * 0.3, roughness: 0.72 };
    }

    if (facadeId === 'precast_concrete_scales') {
      // 4 scales per 8 m across, 2 rows per tile, alternate rows offset by half a scale
      const row = Math.floor(v * 2);
      const su = (u * 4 + (row % 2) * 0.5) % 1;
      const sv = (v * 2) % 1;
      // Rounded lower edge: each scale overlaps the one below it.
      const edge = 0.82 + 0.16 * Math.sin(su * Math.PI);
      if (sv > edge) return { r: 118, g: 116, b: 110, height: 0.08, roughness: 0.9 };
      if (su < 0.015 || su > 0.985) return { r: 170, g: 168, b: 162, height: 0.25, roughness: 0.85 };
      const swell = sv / edge;
      const tone = hash2Periodic(Math.floor(u * 4 + (row % 2) * 0.5), row, 4, 2, 1561);
      const val = 226 + swell * 16 + (tone - 0.5) * 8 + (fbm - 0.5) * 8;
      return { r: val, g: val * 0.992, b: val * 0.97, height: 0.3 + swell * 0.6, roughness: 0.66 };
    }

    if (facadeId === 'polycarbonate_facade') {
      // 1 m multiwall sheets (8 per tile) with 16 mm cell walls and aluminium cover joints
      const sheet = (u * 8) % 1;
      if (sheet < 0.03) return { r: 150, g: 156, b: 162, height: 0.9, roughness: 0.3 };
      const cell = Math.sin(u * 500 * Math.PI) * 0.5 + 0.5;
      const glow = isNight ? 0.7 + (fbm - 0.5) * 0.3 : 0;
      const val = 206 + cell * 18 + (fbm - 0.5) * 10;
      return {
        r: val * 0.97,
        g: val * 1.0,
        b: val * 1.04,
        height: 0.5 + cell * 0.12,
        roughness: 0.28,
        emissiveR: 230 * glow,
        emissiveG: 238 * glow,
        emissiveB: 244 * glow,
      };
    }

    if (facadeId === 'glulam_lattice') {
      // Diamond lattice of 30 cm glulam members, 4 diamonds per 8 m, dark glazing behind
      const du = (u * 4 + v * 4) % 1;
      const dv = (u * 4 - v * 4 + 8) % 1;
      const beamA = du < 0.09;
      const beamB = dv < 0.09;
      if (beamA || beamB) {
        const along = beamA ? dv : du;
        const grain = periodicNoise2D(along, beamA ? du : dv, 64, 4, 1571);
        const lam = Math.sin((beamA ? du : dv) * 140) * 0.5 + 0.5;
        return {
          r: 196 + grain * 22 - lam * 14,
          g: 148 + grain * 16 - lam * 10,
          b: 94 + grain * 10 - lam * 6,
          height: 0.85 + lam * 0.05,
          roughness: 0.6,
        };
      }
      const glow = isNight && periodicNoise2D(u, v, 8, 8, 1572) > 0.4;
      return {
        r: glow ? 236 : 34,
        g: glow ? 190 : 42,
        b: glow ? 120 : 52,
        height: 0.1,
        roughness: 0.12,
        emissiveR: glow ? 210 : 0,
        emissiveG: glow ? 164 : 0,
        emissiveB: glow ? 98 : 0,
      };
    }

    if (facadeId === 'sadu_textile') {
      // Horizontal woven bands (4 m repeat, read from across the forecourt): wide black ground,
      // cream pinstripes and a red band carrying a row of cream diamonds, as on a Bedouin tent
      const band = (v * 2) % 1;
      const weave = periodicNoise2D(u, v, 256, 256, 1541);
      const cream = [238, 228, 208];
      const red = [150, 30, 32];
      let c = [30, 26, 24];
      if (band > 0.62 && band < 0.66) c = cream;
      else if (band >= 0.68 && band < 0.88) {
        // Diamonds 0.5 m wide along the red band
        const du = Math.abs(((u * 4) % 1) - 0.5) * 2;
        const dv = Math.abs((band - 0.78) / 0.1);
        c = du + dv < 0.62 ? cream : red;
      } else if (band >= 0.9 && band < 0.94) c = cream;
      const thread = 0.9 + weave * 0.2;
      return { r: c[0] * thread, g: c[1] * thread, b: c[2] * thread, height: 0.5 + weave * 0.15, roughness: 0.92 };
    }

    if (facadeId === 'calabash_mosaic') {
      // Staggered fibre-concrete panels 1.0 x 0.5 m, each fired an earth tone
      const rowIdx = Math.floor(v * 16);
      const stagger = (rowIdx % 2) * 0.5;
      const colIdx = Math.floor(u * 8 + stagger);
      const fu = (u * 8 + stagger) % 1;
      const fv = (v * 16) % 1;
      if (fu < 0.03 || fv < 0.05) {
        return { r: 52, g: 34, b: 24, height: 0.15, roughness: 0.9 };
      }
      const tones = [
        [196, 126, 74],
        [168, 96, 56],
        [128, 70, 42],
        [214, 160, 96],
        [96, 56, 36],
        [180, 112, 64],
      ];
      const t = tones[Math.floor(hash2Periodic(colIdx, rowIdx, 8, 16, 1551) * tones.length)];
      const grain = (fine - 0.5) * 14 + (med - 0.5) * 10;
      return { r: t[0] + grain, g: t[1] + grain * 0.8, b: t[2] + grain * 0.6, height: 0.6 + fine * 0.08, roughness: 0.78 };
    }

    if (facadeId === 'woven_glassfibre_mesh') {
      // Diamond weave of 25 cm strands over a light, partly open skin
      const a = (u * 32 + v * 32) % 1;
      const b = (u * 32 - v * 32 + 64) % 1;
      const strandA = Math.abs(a - 0.5) > 0.34;
      const strandB = Math.abs(b - 0.5) > 0.34;
      if (strandA || strandB) {
        const over = strandA && strandB ? 1.06 : 1;
        return { r: 236 * over, g: 240 * over, b: 243 * over, height: strandA && strandB ? 0.9 : 0.7, roughness: 0.55 };
      }
      return { r: 150, g: 160, b: 170, height: 0.25, roughness: 0.7 };
    }

    if (facadeId === 'gold_anodized_panels') {
      // 4x8 staggered champagne-gold anodized aluminum cassettes per 8 m (2.0 m x 1.0 m)
      const rowIdx = Math.floor(v * 8);
      const rowFrac = (v * 8) % 1;
      const stagger = (rowIdx % 2) * 0.5;
      const colIdx = Math.floor(u * 4 + stagger);
      const colFrac = (u * 4 + stagger) % 1;
      if (rowFrac < 0.024 || colFrac < 0.016) {
        return { r: 68, g: 52, b: 24, height: 0.16, roughness: 0.68 };
      }
      const tone = hash2Periodic(colIdx, rowIdx, 8, 8, 1502);
      const brush = periodicNoise2D(u, v, 96, 12, 1509);
      return {
        r: 206 + tone * 28 + (brush - 0.5) * 12,
        g: 170 + tone * 24 + (brush - 0.5) * 10,
        b: 92 + tone * 16 + (brush - 0.5) * 8,
        height: 0.64 + brush * 0.08,
        roughness: 0.22 + tone * 0.09,
      };
    }

    if (facadeId === 'white_composite_panels') {
      // 4x4 monumental satin white Alucobond composite panels per 8 m (2.0 m x 2.0 m)
      const jointU = ((u * 4) % 1) < 0.014;
      const jointV = ((v * 4) % 1) < 0.014;
      if (jointU || jointV) {
        return { r: 158, g: 164, b: 172, height: 0.22, roughness: 0.62 };
      }
      const tone = hash2Periodic(Math.floor(u * 4), Math.floor(v * 4), 4, 4, 1512);
      const base = 240 + tone * 8 + (fine - 0.5) * 4;
      return {
        r: base,
        g: base,
        b: base * 0.99,
        height: 0.68 + fine * 0.04,
        roughness: 0.24 + fine * 0.05,
      };
    }

    if (facadeId === 'perforated_red_metal') {
      // 4x8 crimson lacquered perforated aluminum cassettes per 8 m
      const seam = ((u * 4) % 1) < 0.016 || ((v * 8) % 1) < 0.02;
      if (seam) {
        return { r: 108, g: 20, b: 22, height: 0.88, roughness: 0.34 };
      }
      const hu = (u * 64) % 1;
      const hv = (v * 64) % 1;
      const hole = (hu - 0.5) ** 2 + (hv - 0.5) ** 2 < 0.075;
      if (hole) {
        const backLit =
          isNight && ((v * 2) % 1) > 0.2 && ((v * 2) % 1) < 0.82 && periodicNoise2D(u, v, 6, 6, 1520) > 0.35;
        return {
          r: backLit ? 245 : 42,
          g: backLit ? 190 : 16,
          b: backLit ? 105 : 18,
          height: 0.14,
          roughness: 0.32,
          emissiveR: backLit ? 235 : 0,
          emissiveG: backLit ? 168 : 0,
          emissiveB: backLit ? 82 : 0,
        };
      }
      return {
        r: 192 + fbm * 24,
        g: 32 + fbm * 8,
        b: 36 + fbm * 8,
        height: 0.64,
        roughness: 0.32 + fine * 0.08,
      };
    }

    if (facadeId === 'living_green_wall') {
      // Botanical vertical garden with irrigation planter channels every 2.0 m
      const planterRail = ((v * 4) % 1) < 0.022;
      if (planterRail) {
        return { r: 58, g: 64, b: 56, height: 0.78, roughness: 0.52 };
      }
      const leaf = periodicFbm2D(u, v, 24, 4, 1503);
      const macro = periodicFbm2D(u, v, 6, 3, 1525);
      const clump = periodicNoise2D(u, v, 96, 96, 1504);
      const flower = clump > 0.945 && macro > 0.48;
      const fernTint = macro > 0.55 ? 20 : -8;
      return {
        r: flower ? 224 : 46 + leaf * 48 + fernTint * 0.4,
        g: flower ? 202 : 94 + leaf * 78 + fernTint,
        b: flower ? 128 : 38 + leaf * 28,
        height: 0.25 + leaf * 0.52 + clump * 0.22,
        roughness: 0.84,
      };
    }

    // Default: `architectural_concrete` — fine architectural board-formed concrete (4 x 8 panels = 2.0m x 1.0m)
    const cols = 4;
    const rows = 8;
    const colIdx = Math.floor(u * cols);
    const rowIdx = Math.floor(v * rows);
    const panelU = (u * cols) % 1;
    const panelV = (v * rows) % 1;

    // Hairline 1.3 cm V-groove shutter joint
    const seamU = panelU < 0.0065 || panelU > 0.9935;
    const seamV = panelV < 0.011 || panelV > 0.989;
    const isSeam = seamU || seamV;

    // Exact metric circular 2.2 cm tie-rod cone plugs (never stretched into coarse ovals)
    const dxA = (panelU - 0.22) * 2.0;
    const dxB = (panelU - 0.78) * 2.0;
    const dyP = (panelV - 0.5) * 1.0;
    const coneA = Math.hypot(dxA, dyP) < 0.023;
    const coneB = Math.hypot(dxB, dyP) < 0.023;

    const boardGrain = periodicNoise2D(u, v, 16, 128, 1530);
    const panelTone = hash2Periodic(colIdx, rowIdx, cols, rows, 1531);
    const base =
      (isSeam ? 150 : coneA || coneB ? 142 : 172) +
      (fbm - 0.5) * 15 +
      (med - 0.5) * 10 +
      (boardGrain - 0.5) * 9 +
      (fine - 0.5) * 9 +
      (panelTone - 0.5) * 7;

    return {
      r: base * 1.0,
      g: base * 0.995,
      b: base * 0.975,
      height: isSeam
        ? 0.28
        : coneA || coneB
        ? 0.18
        : 0.6 + fbm * 0.14 + boardGrain * 0.08 + fine * 0.06,
      roughness: isSeam ? 0.94 : 0.82 + (med - 0.5) * 0.1,
    };
  });

  // Sampled by world-space triplanar projection, one tile per `FACADE_UV_TILE_M` metres
  const maps = wrapDataTextures(buffers, 1, 1, maxAnisotropy);

  const isMetallic = facadeId === 'brushed_steel_mesh' || facadeId === 'gold_anodized_panels';
  const isPaintedMetal =
    facadeId === 'perforated_red_metal' ||
    facadeId === 'black_zinc_cladding' ||
    facadeId === 'corrugated_steel_sheet';
  const isCeramic = facadeId === 'ceramic_tile_mosaic';
  const isGlass = facadeId === 'glass_curtain' || facadeId === 'polycarbonate_facade';
  const isEtfe = facadeId === 'etfe_cushions_facade';
  const isCorten = facadeId === 'weathered_corten';

  const material = new THREE.MeshPhysicalMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(isEtfe ? 1.25 : 0.72, isEtfe ? 1.25 : 0.72),
    roughnessMap: maps.roughnessMap,
    roughness: 1.0,
    metalness: isMetallic ? 0.78 : isPaintedMetal ? 0.5 : isGlass ? 0.32 : isCorten ? 0.38 : 0.04,
    clearcoat:
      isGlass || isEtfe || isCeramic ? 0.9 : isMetallic ? 0.32 : facadeId === 'white_composite_panels' ? 0.36 : 0.0,
    clearcoatRoughness: isGlass ? 0.08 : isEtfe ? 0.14 : 0.25,
    envMapIntensity: isGlass ? 1.4 : isMetallic ? 1.2 : isEtfe ? 1.15 : 0.85,
    emissive: new THREE.Color(isNight ? (isEtfe && glowHex ? glowHex : 0xffffff) : 0x000000),
    emissiveMap: maps.emissiveMap,
    emissiveIntensity: isNight ? (isEtfe ? 1.15 : 0.82) : 0,
    flatShading,
    side: THREE.DoubleSide,
  });
  return applyWorldTriplanarMapping(material, FACADE_UV_TILE_M);
}

// ============================================================================
// 3. ROOF CLADDING PBR MATERIALS (6 ARCHITECTURAL MATERIALS)
// ============================================================================

export function isRoofTexelInSkylight(
  u: number,
  v: number,
  skylightMode: SkylightMode = 'none',
  skylightRatio: number = 0
): { inSkylight: boolean; isFrame: boolean } {
  const ratio = Math.max(0, Math.min(0.75, skylightRatio));
  if (skylightMode === 'none' || ratio <= 0.01) {
    return { inSkylight: false, isFrame: false };
  }

  if (skylightMode === 'pitch_ring') {
    const bandLimit = Math.max(0.08, Math.min(0.72, ratio * 0.92));
    if (v <= bandLimit) {
      const mullionU = ((u * 6) % 1) < 0.032;
      const borderV = v > bandLimit - 0.018 || v < 0.012;
      return {
        inSkylight: !mullionU && !borderV,
        isFrame: mullionU || borderV,
      };
    }
    return { inSkylight: false, isFrame: false };
  }

  if (skylightMode === 'radial_slots') {
    if (v < 0.06 || v > 0.92) return { inSkylight: false, isFrame: false };
    const uf = (u * 3) % 1;
    const halfSlot = Math.max(0.07, Math.min(0.42, ratio * 0.48));
    const distU = Math.abs(uf - 0.5);
    if (distU <= halfSlot) {
      const border =
        distU > halfSlot - 0.018 || v < 0.075 || v > 0.905 || ((v * 4) % 1) < 0.022;
      return {
        inSkylight: !border,
        isFrame: border,
      };
    }
    return { inSkylight: false, isFrame: false };
  }

  // `grid_oculi`
  const cols = 3;
  const rows = 3;
  const cu = ((u * cols) % 1) - 0.5;
  const cv = ((v * rows) % 1) - 0.5;
  const rMax = Math.max(0.12, Math.min(0.43, 0.14 + ratio * 0.38));
  const dist = Math.hypot(cu * 1.05, cv);
  if (dist <= rMax) {
    const isRing = dist > rMax - 0.028;
    return {
      inSkylight: !isRing,
      isFrame: isRing,
    };
  }
  return { inSkylight: false, isFrame: false };
}

export function computeRoofShadowDensity(
  roofId: RoofMaterialId,
  opacity: number
): number {
  const clampedOpacity = Math.max(0.12, Math.min(1.0, opacity));
  const intrinsicFactor =
    roofId === 'polycarbonate_glass'
      ? 0.52
      : roofId === 'etfe_cushions'
      ? 0.64
      : roofId === 'ptfe_membrane'
      ? 0.82
      : 0.98;
  return Math.max(0.05, Math.min(1.0, clampedOpacity * intrinsicFactor));
}

const BAYER_8X8: number[][] = [
  [0, 48, 12, 60, 3, 51, 15, 63],
  [32, 16, 44, 28, 35, 19, 47, 31],
  [8, 56, 4, 52, 11, 59, 7, 55],
  [40, 24, 36, 20, 43, 27, 39, 23],
  [2, 50, 14, 62, 1, 49, 13, 61],
  [34, 18, 46, 30, 33, 17, 45, 29],
  [10, 58, 6, 54, 9, 57, 5, 53],
  [42, 26, 38, 22, 41, 25, 37, 21],
];

const shadowAlphaCache = new Map<string, Uint8Array>();

/**
 * Builds a custom `MeshDepthMaterial` for roof shadow casting so that:
 * 1. Translucent ETFE / glass roofs with lower `opacity` cast proportionally lighter shadows on `PitchTurf`.
 * 2. Skylight openings (`pitch_ring`, `radial_slots`, `grid_oculi`) punch direct sunlight beams onto the grass.
 */
export function createRoofShadowDepthMaterial(
  roofId: RoofMaterialId,
  opacity: number,
  skylightMode: SkylightMode = 'none',
  skylightRatio: number = 0,
  repeatU: number = 1,
  repeatV: number = 1
): THREE.MeshDepthMaterial {
  const density = computeRoofShadowDensity(roofId, opacity);
  const qDensity = Math.round(density * 64);
  const qRatio = Math.round(Math.max(0, Math.min(0.75, skylightRatio)) * 40);
  const key = `roof_shadow_${qDensity}_${skylightMode}_${qRatio}`;

  const size = 256;
  let data = shadowAlphaCache.get(key);
  if (!data) {
    data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      const v = (y + 0.5) / size;
      const bayerRow = BAYER_8X8[y & 7];
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size;
        const sky = isRoofTexelInSkylight(u, v, skylightMode, skylightRatio);
        let castShadowSample = false;
        const threshold = (bayerRow[x & 7] + 0.5) / 64;
        if (sky.isFrame) {
          castShadowSample = Math.min(1.0, density + 0.22) >= threshold;
        } else if (sky.inSkylight) {
          castShadowSample = false;
        } else {
          castShadowSample = density >= threshold;
        }
        const val = castShadowSample ? 255 : 0;
        const idx = (y * size + x) * 4;
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
        data[idx + 3] = 255;
      }
    }
    shadowAlphaCache.set(key, data);
  }

  const alphaTex = new THREE.DataTexture(
    data.slice(0),
    size,
    size,
    THREE.RGBAFormat
  );
  alphaTex.wrapS = THREE.RepeatWrapping;
  alphaTex.wrapT = repeatV > 1 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  alphaTex.repeat.set(repeatU, repeatV);
  alphaTex.magFilter = THREE.NearestFilter;
  alphaTex.minFilter = THREE.NearestFilter;
  alphaTex.generateMipmaps = false;
  alphaTex.needsUpdate = true;

  return new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    alphaMap: alphaTex,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
}

export function createRoofPbrMaterial(
  roofId: RoofMaterialId,
  opacity: number,
  lighting: LightingMode,
  flatShading: boolean = false,
  maxAnisotropy: number = 4,
  repeatU: number = 12,
  repeatV: number = 2,
  skylightMode: SkylightMode = 'none',
  skylightRatio: number = 0
): THREE.MeshPhysicalMaterial {
  const isNight = lighting !== 'day';
  const qRatio = Math.round(Math.max(0, Math.min(0.75, skylightRatio)) * 20);
  const hasSkylight = skylightMode !== 'none' && qRatio > 0;
  const key = hasSkylight
    ? `roof_${roofId}_${skylightMode}_${qRatio}_v4`
    : `roof_${roofId}_v2`;

  const buffers = synthesizeCachedPbrBuffers(key, 256, 256, 4.6, false, (u, v) => {
    const fine = periodicNoise2D(u, v, 64, 64, 1101);
    const fbm = periodicFbm2D(u, v, 12, 3, 1102);

    if (hasSkylight) {
      const sky = isRoofTexelInSkylight(u, v, skylightMode, skylightRatio);
      if (sky.isFrame) {
        return { r: 44, g: 56, b: 72, a: 255, height: 0.94, roughness: 0.32 };
      }
      if (sky.inSkylight) {
        return {
          r: 206,
          g: 238,
          b: 254,
          a: 34,
          height: 0.45,
          roughness: 0.05,
        };
      }
    }

    // Inner pitch-side glass daylight strip (`v < 0.24`) on non-cushion roofs when no custom skylight is active
    if (
      !hasSkylight &&
      roofId !== 'etfe_cushions' &&
      roofId !== 'polycarbonate_glass' &&
      v < 0.24
    ) {
      const rafter = ((u * 24) % 1) < 0.07;
      if (rafter) {
        return { r: 71, g: 85, b: 105, height: 0.9, roughness: 0.35 };
      }
      return {
        r: 182,
        g: 224,
        b: 248,
        a: 185,
        height: 0.5,
        roughness: 0.09,
      };
    }

    if (roofId === 'etfe_cushions') {
      // 3D Quilted Diamond Pillow Cushions!
      const du = (u * 6 + v * 6) % 1;
      const dv = (u * 6 - v * 6 + 6) % 1;
      const seam = du < 0.055 || du > 0.945 || dv < 0.055 || dv > 0.945;
      if (seam) {
        return { r: 51, g: 65, b: 85, a: 255, height: 0.08, roughness: 0.45 };
      }
      const dome = Math.sin(du * Math.PI) * Math.sin(dv * Math.PI);
      return {
        r: 226 + dome * 26,
        g: 238 + dome * 16,
        b: 250 + dome * 5,
        a: 228,
        height: 0.2 + dome * 0.78,
        roughness: 0.14 + (1 - dome) * 0.12,
      };
    }

    if (roofId === 'polycarbonate_glass') {
      const rafterU = ((u * 20) % 1) < 0.065;
      const purlinV = ((v * 6) % 1) < 0.055;
      if (rafterU || purlinV) {
        return { r: 51, g: 65, b: 85, a: 255, height: 0.92, roughness: 0.34 };
      }
      const rib = Math.sin(u * Math.PI * 120) * 0.5 + 0.5;
      return {
        r: 192 + rib * 18,
        g: 228 + rib * 14,
        b: 248 + rib * 6,
        a: 182,
        height: 0.46 + rib * 0.1,
        roughness: 0.08 + rib * 0.05,
      };
    }

    if (roofId === 'standing_seam_zinc') {
      const seamFrac = (u * 32) % 1;
      const isRib = seamFrac < 0.12;
      const crossSeam = ((v * 4) % 1) < 0.03;
      const val = (isRib ? 148 : crossSeam ? 78 : 112) + (fbm - 0.5) * 16 + (fine - 0.5) * 8;
      return {
        r: val * 0.92,
        g: val * 0.98,
        b: val * 1.06,
        a: 255,
        height: isRib ? 0.92 : crossSeam ? 0.32 : 0.48 + fbm * 0.08,
        roughness: isRib ? 0.28 : 0.38 + (fbm - 0.5) * 0.12,
      };
    }

    if (roofId === 'titanium_scales') {
      const row = Math.floor(v * 14);
      const vf = (v * 14) % 1;
      const uf = (u * 16 + (row % 2) * 0.5) % 1;
      const edge = vf < 0.08 || uf < 0.05;
      const shingleTone = hash2Periodic(Math.floor(u * 16), row, 16, 14, 1212);
      const val = (edge ? 110 : 196 + (shingleTone - 0.5) * 22) + (fine - 0.5) * 10;
      return {
        r: val * 1.01,
        g: val * 1.0,
        b: val * 0.97,
        a: 255,
        height: edge ? 0.2 : 0.55 + vf * 0.32,
        roughness: 0.24 + (1 - shingleTone) * 0.12,
      };
    }

    if (roofId === 'glulam_acoustic_deck') {
      const beamU = ((u * 16) % 1) < 0.08;
      if (beamU) {
        return { r: 44, g: 48, b: 56, a: 255, height: 0.92, roughness: 0.42 };
      }
      const grain = periodicNoise2D(u, v, 16, 64, 1313);
      const plank = ((u * 64) % 1) < 0.08;
      return {
        r: (plank ? 132 : 184) + grain * 36,
        g: (plank ? 78 : 116) + grain * 24,
        b: (plank ? 34 : 54) + grain * 12,
        a: 255,
        height: plank ? 0.28 : 0.62 + grain * 0.15,
        roughness: 0.58 + (1 - grain) * 0.18,
      };
    }

    if (roofId === 'anthracite_pvc_membrane') {
      const weave = (Math.sin(u * Math.PI * 128) + Math.sin(v * Math.PI * 128)) * 0.25 + 0.5;
      const panelJoint = ((u * 12) % 1) < 0.035;
      const val = (panelJoint ? 46 : 64) + weave * 10 + (fbm - 0.5) * 8;
      return {
        r: val,
        g: val * 1.03,
        b: val * 1.1,
        a: 255,
        height: panelJoint ? 0.82 : 0.45 + weave * 0.2,
        roughness: 0.62 + (1 - weave) * 0.16,
      };
    }

    if (roofId === 'copper_verdigris') {
      const isRib = ((u * 28) % 1) < 0.1;
      const patina = clamp01(fbm * 0.8 + fine * 0.3);
      const copper = patina < 0.28;
      return {
        r: copper ? 150 + fine * 30 : 88 + patina * 40,
        g: copper ? 92 + fine * 20 : 158 + patina * 30,
        b: copper ? 58 : 132 + patina * 26,
        a: 255,
        height: isRib ? 0.92 : 0.48 + patina * 0.1,
        roughness: isRib ? 0.4 : 0.55 + patina * 0.2,
      };
    }

    if (roofId === 'red_steel_deck' || roofId === 'blue_steel_deck') {
      const rib = (u * 40) % 1;
      const crest = rib < 0.3;
      const flank = rib < 0.38 || (rib > 0.92);
      const base = roofId === 'red_steel_deck' ? [164, 46, 40] : [36, 62, 140];
      const k = crest ? 1.12 : flank ? 0.72 : 0.92;
      return {
        r: base[0] * k + (fbm - 0.5) * 10,
        g: base[1] * k + (fbm - 0.5) * 6,
        b: base[2] * k + (fbm - 0.5) * 8,
        a: 255,
        height: crest ? 0.9 : flank ? 0.6 : 0.3,
        roughness: 0.38 + (fbm - 0.5) * 0.1,
      };
    }

    if (roofId === 'solar_pv_panels') {
      const frame = ((u * 10) % 1) < 0.03 || ((v * 6) % 1) < 0.04;
      if (frame) return { r: 196, g: 202, b: 210, a: 255, height: 0.9, roughness: 0.3 };
      const cellLine = ((u * 60) % 1) < 0.04 || ((v * 36) % 1) < 0.05;
      return {
        r: cellLine ? 70 : 24 + fine * 10,
        g: cellLine ? 80 : 36 + fine * 12,
        b: cellLine ? 110 : 78 + fine * 20,
        a: 255,
        height: 0.5,
        roughness: cellLine ? 0.4 : 0.1,
      };
    }

    if (roofId === 'green_roof') {
      // Sedum trays: mottled greens with reddish patches, gravel walkways every few trays.
      const walkway = ((u * 8) % 1) < 0.07;
      if (walkway) {
        const g = 178 + (fine - 0.5) * 30;
        return { r: g, g: g * 0.97, b: g * 0.88, a: 255, height: 0.3, roughness: 0.92 };
      }
      const tray = ((v * 16) % 1) < 0.03;
      const clump = periodicNoise2D(u, v, 48, 48, 1777);
      const red = clump > 0.72;
      const k = 0.75 + clump * 0.45 + (fbm - 0.5) * 0.2;
      return {
        r: (red ? 140 : 92) * k * (tray ? 0.7 : 1),
        g: (red ? 82 : 128) * k * (tray ? 0.7 : 1),
        b: (red ? 58 : 52) * k * (tray ? 0.7 : 1),
        a: 255,
        height: 0.4 + clump * 0.5,
        roughness: 0.9,
      };
    }

    if (roofId === 'perforated_aluminium') {
      const hu = (u * 96) % 1;
      const hv = (v * 48) % 1;
      const hole = (hu - 0.5) ** 2 + (hv - 0.5) ** 2 < 0.05;
      const val = 198 + (fbm - 0.5) * 14;
      return {
        r: val * 0.98,
        g: val,
        b: val * 1.03,
        a: hole ? 90 : 255,
        height: hole ? 0.1 : 0.6,
        roughness: 0.32 + fine * 0.08,
      };
    }

    // Default: `ptfe_membrane` woven architectural fiberglass fabric
    const weaveU = Math.sin(u * Math.PI * 128) * 0.5 + 0.5;
    const weaveV = Math.sin(v * Math.PI * 128) * 0.5 + 0.5;
    const panelJoint = ((u * 12) % 1) < 0.035;
    const weave = (weaveU + weaveV) * 0.5;
    const val = (panelJoint ? 202 : 236) + weave * 14 + (fbm - 0.5) * 8;
    return {
      r: val,
      g: val * 1.005,
      b: val * 1.015,
      a: 242,
      height: panelJoint ? 0.82 : 0.45 + weave * 0.22,
      roughness: 0.42 + (1 - weave) * 0.18,
    };
  });

  const effU = hasSkylight ? (repeatU > 6 ? 1 : repeatU) : repeatU;
  const effV = hasSkylight ? 1 : repeatV;
  const maps = wrapDataTextures(buffers, effU, effV, maxAnisotropy, true);
  if (hasSkylight) {
    for (const tex of [maps.map, maps.normalMap, maps.roughnessMap]) {
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
    }
  }

  const isGlassRoof = roofId === 'polycarbonate_glass';
  const isEtfe = roofId === 'etfe_cushions';
  const isMetalRoof =
    roofId === 'standing_seam_zinc' ||
    roofId === 'titanium_scales' ||
    roofId === 'copper_verdigris' ||
    roofId === 'perforated_aluminium';
  const isPaintedDeck = roofId === 'red_steel_deck' || roofId === 'blue_steel_deck';
  const isSolar = roofId === 'solar_pv_panels';
  const clampedOp = Math.max(0.14, Math.min(1.0, opacity));
  const effectiveOpacity = isGlassRoof
    ? Math.min(clampedOp, 0.82)
    : isEtfe
    ? Math.min(clampedOp, 0.92)
    : clampedOp;
  const isTranslucent =
    effectiveOpacity < 0.98 || isGlassRoof || isEtfe || hasSkylight;

  return new THREE.MeshPhysicalMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(isEtfe ? 1.35 : 0.95, isEtfe ? 1.35 : 0.95),
    roughnessMap: maps.roughnessMap,
    roughness: 1.0,
    metalness: isMetalRoof ? 0.78 : isPaintedDeck ? 0.5 : isSolar ? 0.3 : isGlassRoof ? 0.18 : 0.06,
    clearcoat: isGlassRoof || isSolar ? 0.95 : isEtfe ? 0.75 : roofId === 'titanium_scales' || isPaintedDeck ? 0.35 : 0.0,
    clearcoatRoughness: 0.12,
    sheen: roofId === 'ptfe_membrane' ? 0.45 : 0,
    sheenColor: new THREE.Color(0xffffff),
    envMapIntensity: isGlassRoof || isMetalRoof ? 1.35 : 0.95,
    emissive: new THREE.Color(
      isEtfe && isNight ? 0xe0f2fe : roofId === 'ptfe_membrane' && isNight ? 0xfefce8 : 0x000000
    ),
    emissiveIntensity:
      isEtfe && lighting === 'night'
        ? 0.32
        : isEtfe && lighting === 'dusk'
        ? 0.16
        : roofId === 'ptfe_membrane' && isNight
        ? 0.12
        : 0,
    flatShading,
    transparent: isTranslucent,
    opacity: effectiveOpacity,
    side: THREE.DoubleSide,
    depthWrite: !isTranslucent,
  });
}

// ============================================================================
// 4. STRUCTURAL FRAME PBR MATERIALS (5 ARCHITECTURAL MATERIALS)
// ============================================================================

export function createStructurePbrMaterial(
  structureId: StructureMaterialId,
  maxAnisotropy: number = 4
): THREE.MeshPhysicalMaterial {
  const key = `struct_${structureId}_v2`;

  const buffers = synthesizeCachedPbrBuffers(key, 128, 128, 3.0, false, (u, v) => {
    const fbm = periodicFbm2D(u, v, 8, 3, 1401);
    const fine = periodicNoise2D(u, v, 32, 32, 1402);

    if (structureId === 'glulam_timber') {
      // Laminated wood grain + dark steel connector collar at ends
      const steelCollar = v < 0.06 || v > 0.94;
      if (steelCollar) {
        return { r: 38, g: 44, b: 54, height: 0.85, roughness: 0.38 };
      }
      const lamella = ((u * 12) % 1) < 0.06;
      const grain = periodicNoise2D(u, v, 24, 6, 1410);
      return {
        r: (lamella ? 148 : 192) + grain * 34,
        g: (lamella ? 88 : 122) + grain * 22,
        b: (lamella ? 38 : 56) + grain * 10,
        height: lamella ? 0.38 : 0.58 + grain * 0.16,
        roughness: 0.54 + (1 - grain) * 0.18,
      };
    }

    if (structureId === 'corten_structure') {
      const rust = clamp01(fbm * 0.75 + fine * 0.25);
      return {
        r: 108 + rust * 74,
        g: 42 + rust * 34,
        b: 22 + rust * 14,
        height: 0.45 + rust * 0.35,
        roughness: 0.64 + (1 - rust) * 0.22,
      };
    }

    if (structureId === 'galvanized_steel') {
      // Zinc spangle crystallization pattern
      const spangle = hash2Periodic(Math.floor(u * 24), Math.floor(v * 24), 24, 24, 1420);
      const val = 162 + (spangle - 0.5) * 34 + (fine - 0.5) * 14;
      return {
        r: val * 0.96,
        g: val * 0.99,
        b: val * 1.04,
        height: 0.48 + spangle * 0.18,
        roughness: 0.28 + (1 - spangle) * 0.18,
      };
    }

    if (structureId === 'anthracite_steel') {
      const val = 46 + (fbm - 0.5) * 12 + (fine - 0.5) * 6;
      return {
        r: val * 0.96,
        g: val,
        b: val * 1.08,
        height: 0.5 + fine * 0.12,
        roughness: 0.32 + (fbm - 0.5) * 0.08,
      };
    }

    if (structureId === 'stainless_steel') {
      const brush = periodicNoise2D(u, v, 4, 96, 1430);
      const val = 214 + (brush - 0.5) * 26;
      return { r: val * 0.98, g: val, b: val * 1.02, height: 0.5 + brush * 0.06, roughness: 0.1 + brush * 0.08 };
    }

    if (structureId === 'bronze_steel') {
      const val = (fbm - 0.5) * 16 + (fine - 0.5) * 8;
      return { r: 152 + val, g: 108 + val * 0.8, b: 62 + val * 0.5, height: 0.5 + fine * 0.1, roughness: 0.3 + fbm * 0.1 };
    }

    const lacquer: Partial<Record<StructureMaterialId, [number, number, number]>> = {
      red_lacquer_steel: [190, 34, 40],
      navy_lacquer_steel: [30, 50, 102],
      forest_green_steel: [30, 82, 54],
      yellow_lacquer_steel: [236, 186, 22],
      sky_blue_lacquer_steel: [100, 170, 220],
    };
    const paint = lacquer[structureId];
    if (paint) {
      const val = (fbm - 0.5) * 10 + (fine - 0.5) * 4;
      return { r: paint[0] + val, g: paint[1] + val, b: paint[2] + val, height: 0.5 + fine * 0.06, roughness: 0.32 + fbm * 0.08 };
    }

    if (structureId === 'reinforced_concrete') {
      const formwork = ((v * 6) % 1) < 0.03;
      const val = (formwork ? 140 : 172) + (fbm - 0.5) * 22 + (fine - 0.5) * 14;
      return { r: val, g: val * 0.99, b: val * 0.95, height: formwork ? 0.3 : 0.55 + fbm * 0.2, roughness: 0.82 + fine * 0.1 };
    }

    // Default: `white_steel` satin architectural steel
    const val = 236 + (fbm - 0.5) * 12;
    return {
      r: val,
      g: val * 1.005,
      b: val * 1.015,
      height: 0.5 + fine * 0.08,
      roughness: 0.25 + (fbm - 0.5) * 0.06,
    };
  });

  const maps = wrapDataTextures(buffers, 3, 3, maxAnisotropy);
  const isWood = structureId === 'glulam_timber';
  const isCorten = structureId === 'corten_structure';
  const isConcrete = structureId === 'reinforced_concrete';
  const isLacquer =
    structureId === 'red_lacquer_steel' ||
    structureId === 'navy_lacquer_steel' ||
    structureId === 'forest_green_steel' ||
    structureId === 'yellow_lacquer_steel' ||
    structureId === 'sky_blue_lacquer_steel';

  return new THREE.MeshPhysicalMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughnessMap: maps.roughnessMap,
    roughness: 1.0,
    metalness: isWood || isConcrete ? 0.04 : isLacquer ? 0.45 : isCorten ? 0.48 : structureId === 'stainless_steel' ? 0.95 : 0.82,
    clearcoat: structureId === 'white_steel' || isLacquer ? 0.4 : 0,
    clearcoatRoughness: 0.22,
    envMapIntensity: isWood || isConcrete ? 0.75 : 1.15,
  });
}

// ============================================================================
// 5. 3D MOLDED BUCKET SEATING + RADIAL STAIRS + VOMITORIES PBR MATERIAL
// ============================================================================

/**
 * `stone_bench`: rows of white marble blocks with no seat on them (ancient and early stadiums),
 * a shadowed riser under each tread, joints between blocks and faint grey veins.
 */
function stoneBenchTexel(u: number, v: number): { r: number; g: number; b: number; height: number; roughness: number } {
  const rows = 24;
  const sv = (v * rows) % 1;
  const row = Math.floor(v * rows);
  if (sv < 0.16) {
    const ao = 0.62 + (sv / 0.16) * 0.3;
    return { r: 196 * ao, g: 190 * ao, b: 178 * ao, height: 0.15, roughness: 0.9 };
  }
  const blocks = 14;
  const shifted = u * blocks + (row % 2) * 0.5;
  const bu = shifted % 1;
  if (bu < 0.025) return { r: 150, g: 146, b: 138, height: 0.4, roughness: 0.9 };
  const block = Math.floor(shifted);
  const tone = 0.9 + (((block * 37 + row * 91) % 17) / 17) * 0.1;
  const vein = Math.abs(Math.sin(u * 61 + v * 23 + block)) < 0.035 ? 0.86 : 1;
  const k = tone * vein;
  return { r: 236 * k, g: 231 * k, b: 220 * k, height: 0.55, roughness: 0.62 };
}

export function createSeatTerracePbrMaterial(
  seatFinish: SeatMaterialId,
  primaryHex: string,
  secondaryHex: string,
  aisleCount: number,
  maxAnisotropy: number = 8,
  doubleSided: boolean = false
): THREE.MeshPhysicalMaterial {
  const safeAisles = Math.max(4, Math.min(16, Math.round(aisleCount)));
  const key = `seats_${seatFinish}_${primaryHex}_${secondaryHex}_${safeAisles}_v3`;

  const pri = new THREE.Color(primaryHex);
  const sec = new THREE.Color(secondaryHex);
  const priR = pri.r * 255;
  const priG = pri.g * 255;
  const priB = pri.b * 255;
  const secR = sec.r * 255;
  const secG = sec.g * 255;
  const secB = sec.b * 255;

  const buffers = synthesizeCachedPbrBuffers(key, 512, 512, 4.6, false, (u, v) => {
    if (seatFinish === 'stone_bench') return stoneBenchTexel(u, v);
    // Radial concrete stairways & dark recessed vomitory portals
    const aislePhase = (u * safeAisles) % 1;
    const aisleIdx = Math.floor(u * safeAisles);
    const halfAisleWidth = 0.035;
    const distFromAisleCenter = Math.abs(aislePhase - 0.5);

    // Vomitory portal mouth
    const vomCenterV = aisleIdx % 2 === 0 ? 0.62 : 0.48;
    const inVomU = distFromAisleCenter < halfAisleWidth * 1.65;
    const inVomV = Math.abs(v - vomCenterV) < 0.082;

    if (inVomU && inVomV) {
      const border =
        distFromAisleCenter > halfAisleWidth * 1.36 || Math.abs(v - vomCenterV) > 0.068;
      if (border) {
        return { r: 214, g: 220, b: 228, height: 0.9, roughness: 0.72 };
      }
      const depthGrad = clamp01((v - (vomCenterV - 0.068)) / 0.136);
      return {
        r: 7 + depthGrad * 16,
        g: 10 + depthGrad * 20,
        b: 18 + depthGrad * 28,
        height: 0.03,
        roughness: 0.97,
      };
    }

    // Concrete radial stairway with cheek shadow, yellow step nosings + central handrail
    if (distFromAisleCenter < halfAisleWidth) {
      const handrail = distFromAisleCenter < 0.0042;
      if (handrail) {
        return { r: 230, g: 236, b: 242, height: 0.96, roughness: 0.25 };
      }
      const cheekShadow = distFromAisleCenter > halfAisleWidth - 0.0045 ? 0.72 : 1.0;
      const stepV = (v * 32) % 1;
      if (stepV < 0.14) {
        return {
          r: 36 * cheekShadow,
          g: 44 * cheekShadow,
          b: 56 * cheekShadow,
          height: 0.18,
          roughness: 0.94,
        };
      }
      if (stepV < 0.25) {
        // Yellow safety anti-slip nosing
        return {
          r: 245 * cheekShadow,
          g: 196 * cheekShadow,
          b: 28 * cheekShadow,
          height: 0.68,
          roughness: 0.58,
        };
      }
      return {
        r: 182 * cheekShadow,
        g: 190 * cheekShadow,
        b: 200 * cheekShadow,
        height: 0.55,
        roughness: 0.86,
      };
    }

    // Individual 3D Molded Bucket Seats (96 columns x 24 rows per tile)
    const seatCols = 96;
    const seatRows = 24;
    const colIdx = Math.floor(u * seatCols);
    const rowIdx = Math.floor(v * seatRows);
    const su = (u * seatCols) % 1;
    const sv = (v * seatRows) % 1;

    // Deep ambient occlusionconcrete footwell & riser shadow channel
    if (sv < 0.17) {
      // Galvanized aluminum seat-mounting rail bar running across the riser
      if (sv > 0.115 && sv < 0.155) {
        return { r: 148, g: 158, b: 170, height: 0.34, roughness: 0.42 };
      }
      const ao = 0.65 + (sv / 0.17) * 0.35;
      return {
        r: 58 * ao,
        g: 66 * ao,
        b: 78 * ao,
        height: 0.12,
        roughness: 0.92,
      };
    }

    // Inter-seat side shadow gap (8cm separation between ergonomic shells)
    if (su < 0.11 || su > 0.91) {
      return {
        r: 48,
        g: 56,
        b: 68,
        height: 0.16,
        roughness: 0.92,
      };
    }

    // 3D curved bucket seat ergonomics: raised top backrest + hinge crease + concave pan!
    const normU = (su - 0.51) / 0.4; // -1..1
    const normV = (sv - 0.17) / 0.83; // 0..1
    const hingeCrease = Math.abs(normV - 0.52) < 0.045 ? -0.14 : 0;
    const backrestRim = normV > 0.76 ? 0.28 : normV > 0.54 ? 0.14 : 0;
    const sideBolster = normU * normU * 0.18;
    const seatHeight = 0.54 + backrestRim + sideBolster + hingeCrease - (1 - normV) * 0.08;

    const seatHash = hash2Periodic(colIdx, rowIdx, seatCols, seatRows, 1515);
    const rowBand = rowIdx >= 9 && rowIdx <= 13;

    let useSecondary = false;
    let toneMult = 1.0;

    if (seatFinish === 'molded_poly_mosaic') {
      // Realistic modern pixelated/speckled mosaic gradient!
      const bandProb = rowBand ? 0.78 : rowIdx < 4 || rowIdx > 20 ? 0.34 : 0.16;
      useSecondary = seatHash < bandProb;
      toneMult = 0.78 + ((seatHash * 17.3) % 1) * 0.36;
    } else if (seatFinish === 'ribbed_stadium_shell') {
      useSecondary = (rowBand && seatHash > 0.1) || (!rowBand && seatHash > 0.95);
      const rib = Math.sin(normU * Math.PI * 3) * 0.05;
      toneMult = 0.94 + rib + (seatHash - 0.5) * 0.08;
    } else {
      // `padded_club_velvet`
      useSecondary = rowBand && seatHash > 0.2;
      toneMult = 0.88 + (1 - Math.abs(normU) * 0.18) * 0.14;
    }

    // Subtle self-shadowing in the seat fold crease
    const foldAo = Math.abs(normV - 0.52) < 0.05 ? 0.8 : 1.0;
    const baseR = (useSecondary ? secR : priR) * toneMult * foldAo;
    const baseG = (useSecondary ? secG : priG) * toneMult * foldAo;
    const baseB = (useSecondary ? secB : priB) * toneMult * foldAo;

    // Backrest top sunlight catch highlight
    const rimBoost = normV > 0.82 ? 26 : 0;

    return {
      r: baseR + rimBoost,
      g: baseG + rimBoost,
      b: baseB + rimBoost,
      height: seatHeight,
      roughness:
        seatFinish === 'padded_club_velvet'
          ? 0.76
          : seatFinish === 'ribbed_stadium_shell'
          ? 0.26
          : 0.35,
    };
  });

  const maps = wrapDataTextures(buffers, 1, 1, maxAnisotropy);

  return new THREE.MeshPhysicalMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(1.3, 1.3),
    roughnessMap: maps.roughnessMap,
    roughness: 1.0,
    metalness: 0.04,
    clearcoat: seatFinish === 'padded_club_velvet' ? 0.0 : 0.34,
    clearcoatRoughness: 0.32,
    sheen: seatFinish === 'padded_club_velvet' ? 0.58 : 0.0,
    sheenColor: new THREE.Color(secondaryHex),
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
}

// ============================================================================
// 6. ATHLETICS TRACK EPDM RUBBER GRANULE PBR MATERIAL
// ============================================================================

export function createTrackPbrMaterial(
  trackId: TrackMaterialId,
  maxAnisotropy: number = 4
): THREE.MeshStandardMaterial {
  const palette: Record<TrackMaterialId, [number, number, number]> = {
    mondo_red: [164, 48, 36],
    mondo_blue: [29, 78, 206],
    mondo_violet: [94, 42, 168],
    anthracite_apron: [54, 65, 82],
  };
  const [br, bg, bb] = palette[trackId] ?? palette.mondo_red;

  const buffers = synthesizeCachedPbrBuffers(
    `track_${trackId}_v2`,
    128,
    128,
    3.5,
    false,
    (u, v) => {
      const gran = periodicNoise2D(u, v, 64, 64, 1601);
      const macro = periodicFbm2D(u, v, 8, 2, 1602);
      const mult = 0.86 + gran * 0.24 + (macro - 0.5) * 0.1;
      return {
        r: br * mult,
        g: bg * mult,
        b: bb * mult,
        height: 0.35 + gran * 0.55,
        roughness: 0.72 + (1 - gran) * 0.2,
      };
    }
  );

  const maps = wrapDataTextures(buffers, 24, 24, maxAnisotropy);
  return new THREE.MeshStandardMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: maps.roughnessMap,
    roughness: 0.95,
    metalness: 0.03,
  });
}

// ============================================================================
// 7. MINERAL ESPLANADE / URBAN PLAZA PBR DETAIL MAPS
// ============================================================================

export function createPlazaDetailNormalAndRoughness(
  plazaId: PlazaMaterialId,
  maxAnisotropy: number = 4
): { normalMap: THREE.DataTexture; roughnessMap: THREE.DataTexture } {
  const buffers = synthesizeCachedPbrBuffers(
    `plaza_detail_${plazaId}_v2`,
    128,
    128,
    3.2,
    false,
    (u, v) => {
      const fine = periodicNoise2D(u, v, 48, 48, 1701);
      const fbm = periodicFbm2D(u, v, 10, 3, 1702);

      if (plazaId === 'urban_asphalt') {
        return {
          r: 40,
          g: 45,
          b: 54,
          height: 0.3 + fine * 0.5,
          roughness: 0.76 + (1 - fbm) * 0.18,
        };
      }

      // Stone slabs (staggered granite or sandstone pavers)
      const row = Math.floor(v * 8);
      const vf = (v * 8) % 1;
      const uf = (u * 6 + (row % 2) * 0.5) % 1;
      const joint = vf < 0.055 || uf < 0.045;
      const slabHash = hash2Periodic(Math.floor(u * 6), row, 6, 8, 1705);
      return {
        r: 128,
        g: 128,
        b: 128,
        height: joint ? 0.12 : 0.62 + slabHash * 0.16 + fine * 0.12,
        roughness: joint
          ? 0.95
          : plazaId === 'granite_pavers'
          ? 0.52 + (1 - slabHash) * 0.24
          : 0.66 + (1 - slabHash) * 0.2,
      };
    }
  );

  const maps = wrapDataTextures(buffers, 42, 38, maxAnisotropy);
  maps.map.dispose(); // Only normal & roughness needed as detail overlay on site ground
  return {
    normalMap: maps.normalMap,
    roughnessMap: maps.roughnessMap,
  };
}

// ============================================================================
// 8. GRASS TURF BLADE NORMAL & DIRECTIONAL MOWING SHEEN PRESETS
// ============================================================================

export function getTurfPresetColors(turfId: PitchTurfMaterialId): {
  primary: string;
  secondary: string;
  surround: string;
  wearOpacity: number;
} {
  switch (turfId) {
    case 'natural_ryegrass':
      return {
        primary: '#2b8a3e',
        secondary: '#37a14c',
        surround: '#236e33',
        wearOpacity: 0.12,
      };
    case 'winter_worn':
      return {
        primary: '#2b6a38',
        secondary: '#347d43',
        surround: '#21542c',
        wearOpacity: 0.3,
      };
    case 'pro_synthetic':
      return {
        primary: '#1f7a3f',
        secondary: '#268e4b',
        surround: '#196434',
        wearOpacity: 0.02,
      };
    case 'hybrid_emerald':
    default:
      return {
        primary: '#237d3b',
        secondary: '#2e9448',
        surround: '#1d6631',
        wearOpacity: 0.1,
      };
  }
}

export function createGrassBladeNormalMap(maxAnisotropy: number = 4): THREE.DataTexture {
  const buffers = synthesizeCachedPbrBuffers(
    'grass_blade_normal_v2',
    128,
    128,
    3.6,
    false,
    (u, v) => {
      const bladeA = periodicNoise2D(u, v, 64, 32, 1801);
      const bladeB = periodicNoise2D(u, v, 32, 64, 1802);
      const tuft = periodicFbm2D(u, v, 16, 2, 1803);
      return {
        r: 40,
        g: 120,
        b: 50,
        height: 0.25 + bladeA * 0.4 + bladeB * 0.25 + tuft * 0.1,
        roughness: 0.72,
      };
    }
  );
  const maps = wrapDataTextures(buffers, 36, 24, maxAnisotropy);
  maps.map.dispose();
  maps.roughnessMap.dispose();
  return maps.normalMap;
}

const TURF_DETAIL_SIZE = 512;
const TURF_DETAIL_CACHE_KEY = 'turf_close_detail_v1';

/**
 * Rasterises a tileable field of individual grass blades (bright tips, dark gaps,
 * mixed green/straw tones). RGB is a linear colour multiplier encoded so that
 * 128 = ×1 (mean-normalised), alpha carries a slow macro-patch noise.
 */
function createTurfDetailBuffers(): CachedPbrBuffers {
  // The blade field below is costly; skip it when the buffers are already cached.
  const cached = pbrBufferCache.get(TURF_DETAIL_CACHE_KEY);
  if (cached) return cached;
  const n = TURF_DETAIL_SIZE;
  const height = new Float32Array(n * n);
  const tone = new Float32Array(n * n);
  let seed = 90173;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let b = 0; b < 21000; b++) {
    const x0 = rand() * n;
    const y0 = rand() * n;
    // Blades lie mostly along the mowing direction, with plenty of scatter.
    const angle = (rand() - 0.5) * Math.PI * 1.3;
    const len = 5 + rand() * 12;
    const width = 0.7 + rand() * 1.1;
    const bladeTone = rand() < 0.12 ? 1 : rand() < 0.2 ? -1 : 0;
    const base = 0.25 + rand() * 0.35;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    for (let s = 0; s <= len; s += 0.5) {
      const t = s / len;
      const h = base + t * 0.6;
      const w = width * (1 - t * 0.75);
      for (let o = -w; o <= w; o += 0.5) {
        const px = Math.floor(x0 + dx * s - dy * o);
        const py = Math.floor(y0 + dy * s + dx * o);
        const idx = (((py % n) + n) % n) * n + (((px % n) + n) % n);
        if (h > height[idx]) {
          height[idx] = h;
          tone[idx] = bladeTone;
        }
      }
    }
  }

  // Colour multiplier per pixel, then normalise to a mean of 1.
  const mult = new Float32Array(n * n * 3);
  const sum = [0, 0, 0];
  for (let i = 0; i < n * n; i++) {
    const h = height[i];
    const lum = h === 0 ? 0.32 : 0.55 + h * 0.75;
    const t = tone[i];
    const r = lum * (t > 0 ? 1.35 : t < 0 ? 0.8 : 1);
    const g = lum * (t > 0 ? 1.1 : t < 0 ? 0.88 : 1);
    const bl = lum * (t > 0 ? 0.75 : t < 0 ? 0.9 : 1);
    mult[i * 3] = r;
    mult[i * 3 + 1] = g;
    mult[i * 3 + 2] = bl;
    sum[0] += r;
    sum[1] += g;
    sum[2] += bl;
  }
  const mean = sum.map((s) => s / (n * n));

  return synthesizeCachedPbrBuffers(TURF_DETAIL_CACHE_KEY, n, n, 2.2, false, (u, v, px, py) => {
    const i = py * n + px;
    return {
      r: (mult[i * 3] / mean[0]) * 128,
      g: (mult[i * 3 + 1] / mean[1]) * 128,
      b: (mult[i * 3 + 2] / mean[2]) * 128,
      a: periodicFbm2D(u, v, 4, 3, 1907) * 255,
      height: height[i],
      roughness: 1,
    };
  });
}

/**
 * Adds world-space close-range grass detail to the pitch turf material: blade-level
 * colour and relief sampled at two rotated scales (fading out beyond ~80 m so the
 * broadcast mowing pattern stays clean from afar) and slow patchy tone variation at
 * every distance. The base canvas map only carries ~30 px/m, which reads as a flat
 * model surface when the camera gets close.
 */
export function applyTurfCloseUpDetail(material: THREE.MeshStandardMaterial, maxAnisotropy: number): void {
  const buffers = createTurfDetailBuffers();
  const makeTex = (data: Uint8Array) => {
    const tex = new THREE.DataTexture(data, buffers.sizeW, buffers.sizeH, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = maxAnisotropy;
    tex.needsUpdate = true;
    return tex;
  };
  const detailMap = makeTex(buffers.albedo);
  const detailNormal = makeTex(buffers.normal);

  material.customProgramCacheKey = () => 'turf-close-detail-v1';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.turfDetailMap = { value: detailMap };
    shader.uniforms.turfDetailNormal = { value: detailNormal };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vTurfXZ;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvTurfXZ = (modelMatrix * vec4(transformed, 1.0)).xz;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vTurfXZ;
uniform sampler2D turfDetailMap;
uniform sampler2D turfDetailNormal;
const mat2 TURF_ROT = mat2(0.8, -0.6, 0.6, 0.8);`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float turfNear = 1.0 - smoothstep(12.0, 85.0, length(vViewPosition));
vec2 turfUvA = vTurfXZ * 0.62;
vec2 turfUvB = TURF_ROT * vTurfXZ * 0.24 + 0.37;
vec3 turfFine = texture2D(turfDetailMap, turfUvA).rgb * 2.0;
vec3 turfClump = mix(vec3(1.0), texture2D(turfDetailMap, turfUvB).rgb * 2.0, 0.55);
diffuseColor.rgb *= mix(vec3(1.0), turfFine * turfClump, turfNear);
float turfPatch = texture2D(turfDetailMap, vTurfXZ * 0.018).a * 0.6
  + texture2D(turfDetailMap, TURF_ROT * vTurfXZ * 0.047 + 0.5).a * 0.4;
diffuseColor.rgb *= vec3(0.94 + 0.12 * turfPatch, 0.9 + 0.2 * turfPatch, 0.94 + 0.12 * turfPatch);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
// Blade gaps scatter light: matte up close, keeping the mowing sheen readable.
roughnessFactor = min(1.0, roughnessFactor + (0.1 + 0.15 * (1.0 - turfFine.g * 0.5)) * turfNear);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
vec2 turfSlope = (texture2D(turfDetailNormal, turfUvA).xy * 2.0 - 1.0)
  + 0.5 * (texture2D(turfDetailNormal, turfUvB).xy * 2.0 - 1.0);
normal = normalize(normal + (viewMatrix * vec4(turfSlope.x, 0.0, -turfSlope.y, 0.0)).xyz * 0.9 * turfNear);`
      );
  };
}

// ============================================================================
// 9. SHADED PBR MATERIAL SWATCH GENERATOR (ZERO BLACK SQUARES IN UI)
// ============================================================================

const swatchDataUrlCache = new Map<string, string | null>();

const FACADE_IDS = new Set<string>(FACADE_MATERIAL_CATALOG.map((m) => m.id));
const ROOF_IDS = new Set<string>(ROOF_MATERIAL_CATALOG.map((m) => m.id));
const STRUCTURE_IDS = new Set<string>(STRUCTURE_MATERIAL_CATALOG.map((m) => m.id));
const SEAT_IDS = new Set<string>(SEAT_MATERIAL_CATALOG.map((m) => m.id));
const TURF_IDS = new Set<string>(TURF_MATERIAL_CATALOG.map((m) => m.id));
const TRACK_IDS = new Set<string>(TRACK_MATERIAL_CATALOG.map((m) => m.id));
const PLAZA_IDS = new Set<string>(PLAZA_MATERIAL_CATALOG.map((m) => m.id));

/**
 * Shades an `80 x 52` RGBA pixel buffer directly from the procedural PBR material buffers
 * (`albedo`, `normal`, `roughness`, `metalness`) under a bright daylight studio lighting rig
 * with curved-cylinder specular sheen so every material (including dark metals, zinc & glass)
 * is crisp, colorful, and never renders as a dark/black square.
 */
export function renderMaterialSwatchPixels(
  materialId: string,
  width: number = 80,
  height: number = 52
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);

  // Turf & Plaza specialized crisp studio swatches
  if (TURF_IDS.has(materialId)) {
    const preset = getTurfPresetColors(materialId as PitchTurfMaterialId);
    const c1 = new THREE.Color(preset.primary);
    const c2 = new THREE.Color(preset.secondary);
    for (let y = 0; y < height; y++) {
      const vf = y / height;
      for (let x = 0; x < width; x++) {
        const uf = x / width;
        const stripe = Math.floor(uf * 5) % 2 === 0 ? c1 : c2;
        const blade = periodicNoise2D(uf, vf, 48, 32, 1881);
        const worn =
          materialId === 'winter_worn'
            ? Math.max(0, 1 - Math.hypot((uf - 0.5) * 2.2, (vf - 0.5) * 2.2)) * 0.38
            : 0;
        const chalkLine = Math.abs(vf - 0.52) < 0.032;
        const shade = 0.88 + blade * 0.28 + (1 - vf) * 0.08;
        const r = chalkLine
          ? 246
          : clampByte((stripe.r * 255 * (1 - worn) + 124 * worn) * shade);
        const g = chalkLine
          ? 248
          : clampByte((stripe.g * 255 * (1 - worn) + 92 * worn) * shade);
        const b = chalkLine
          ? 250
          : clampByte((stripe.b * 255 * (1 - worn) + 52 * worn) * shade);
        const i = (y * width + x) * 4;
        out[i] = r;
        out[i + 1] = g;
        out[i + 2] = b;
        out[i + 3] = 255;
      }
    }
    return out;
  }

  let buffers: CachedPbrBuffers | null = null;
  let uScale = 0.42;
  let vScale = 0.28;
  let metalness = 0.08;
  let clearcoat = 0.1;
  let tint: [number, number, number] | null = null;

  if (FACADE_IDS.has(materialId)) {
    const mat = createFacadePbrMaterial(materialId as FacadeMaterialId, 'day', false, 1);
    buffers = pbrBufferCache.get(`facade_${materialId}_day_v6`) ?? null;
    metalness = mat.metalness;
    clearcoat = mat.clearcoat;
    uScale = materialId === 'heritage_brick' ? 0.28 : 0.5;
    vScale = materialId === 'heritage_brick' ? 0.18 : 0.34;
    mat.dispose();
  } else if (ROOF_IDS.has(materialId)) {
    const mat = createRoofPbrMaterial(materialId as RoofMaterialId, 1.0, 'day', false, 1);
    buffers = pbrBufferCache.get(`roof_${materialId}_v2`) ?? null;
    metalness = mat.metalness;
    clearcoat = mat.clearcoat;
    uScale = 0.45;
    vScale = 0.45;
    mat.dispose();
  } else if (STRUCTURE_IDS.has(materialId)) {
    const mat = createStructurePbrMaterial(materialId as StructureMaterialId, 1);
    buffers = pbrBufferCache.get(`struct_${materialId}_v2`) ?? null;
    metalness = mat.metalness;
    clearcoat = mat.clearcoat;
    uScale = 0.75;
    vScale = 0.5;
    mat.dispose();
  } else if (SEAT_IDS.has(materialId)) {
    const pri =
      materialId === 'ribbed_stadium_shell'
        ? '#2563eb'
        : materialId === 'padded_club_velvet'
        ? '#334155'
        : '#dc2626';
    const mat = createSeatTerracePbrMaterial(
      materialId as SeatMaterialId,
      pri,
      '#f8fafc',
      6,
      1
    );
    buffers = pbrBufferCache.get(`seats_${materialId}_${pri}_#f8fafc_6_v3`) ?? null;
    metalness = 0.06;
    clearcoat = 0.35;
    uScale = 0.16;
    vScale = 0.22;
    mat.dispose();
  } else if (TRACK_IDS.has(materialId)) {
    const mat = createTrackPbrMaterial(materialId as TrackMaterialId, 1);
    buffers = pbrBufferCache.get(`track_${materialId}_v2`) ?? null;
    uScale = 0.8;
    vScale = 0.55;
    mat.dispose();
  } else if (PLAZA_IDS.has(materialId)) {
    createPlazaDetailNormalAndRoughness(materialId as PlazaMaterialId, 1);
    buffers = pbrBufferCache.get(`plaza_detail_${materialId}_v2`) ?? null;
    tint =
      materialId === 'sandstone_esplanade'
        ? [214, 206, 192]
        : materialId === 'urban_asphalt'
        ? [74, 82, 96]
        : [138, 148, 160];
    uScale = 0.7;
    vScale = 0.48;
  }

  // Sun + sky studio vectors
  const lx = -0.42;
  const ly = 0.48;
  const lz = 0.77;
  // Half-vector between sun and viewer `(0, 0, 1)`
  const hLen = Math.hypot(lx, ly, lz + 1);
  const hx = lx / hLen;
  const hy = ly / hLen;
  const hz = (lz + 1) / hLen;

  for (let y = 0; y < height; y++) {
    const yn = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x++) {
      const xn = x / Math.max(1, width - 1);
      const u = (0.18 + xn * uScale) % 1;
      const v = (0.28 + (1 - yn) * vScale) % 1;

      let ar = 148;
      let ag = 156;
      let ab = 168;
      let nx = 0;
      let ny = 0;
      let nz = 1;
      let rough = 0.55;

      if (buffers) {
        const px = Math.min(buffers.sizeW - 1, Math.floor(u * buffers.sizeW));
        const py = Math.min(buffers.sizeH - 1, Math.floor(v * buffers.sizeH));
        const bIdx = (py * buffers.sizeW + px) * 4;
        if (tint) {
          const lum = 0.82 + (buffers.roughness[bIdx] / 255 - 0.5) * -0.35;
          ar = tint[0] * lum;
          ag = tint[1] * lum;
          ab = tint[2] * lum;
        } else {
          ar = buffers.albedo[bIdx];
          ag = buffers.albedo[bIdx + 1];
          ab = buffers.albedo[bIdx + 2];
        }
        nx = (buffers.normal[bIdx] / 255) * 2 - 1;
        ny = (buffers.normal[bIdx + 1] / 255) * 2 - 1;
        nz = Math.max(0.2, (buffers.normal[bIdx + 2] / 255) * 2 - 1);
        rough = buffers.roughness[bIdx] / 255;
      }

      // Gently curved architectural sample tile so flat metals & dark glass catch sky reflection
      const curveNx = (xn - 0.5) * 0.52;
      const curveNy = (0.5 - yn) * 0.36;
      let fnx = nx * 0.8 + curveNx;
      let fny = ny * 0.8 + curveNy;
      let fnz = nz;
      const nLen = Math.hypot(fnx, fny, fnz) || 1;
      fnx /= nLen;
      fny /= nLen;
      fnz /= nLen;

      const ndotl = Math.max(0, fnx * lx + fny * ly + fnz * lz);
      const ndoth = Math.max(0, fnx * hx + fny * hy + fnz * hz);
      const skyFill = 0.52 + 0.22 * (fny * 0.5 + 0.5);
      const diffuse = skyFill + ndotl * (0.78 - metalness * 0.28);

      const shininess = Math.max(6, (1 - rough) * 68 + clearcoat * 42);
      const specStrength = (0.18 + metalness * 0.65 + clearcoat * 0.45) * (1.05 - rough * 0.55);
      const spec = Math.pow(ndoth, shininess) * specStrength;

      // Sky reflection lift so dark anthracite / zinc / glass / velvet never crush to black
      const envReflect = (metalness * 0.26 + clearcoat * 0.22) * (0.65 + 0.35 * (1 - yn));

      let r = ar * diffuse + (ar * metalness + 255 * (1 - metalness * 0.65)) * spec + 210 * envReflect;
      let g = ag * diffuse + (ag * metalness + 255 * (1 - metalness * 0.65)) * spec + 225 * envReflect;
      let b = ab * diffuse + (ab * metalness + 255 * (1 - metalness * 0.65)) * spec + 245 * envReflect;

      // White lane lines overlay on athletics tracks
      if (TRACK_IDS.has(materialId) && (Math.abs(yn - 0.34) < 0.035 || Math.abs(yn - 0.72) < 0.035)) {
        r = 246;
        g = 248;
        b = 250;
      }

      const oIdx = (y * width + x) * 4;
      out[oIdx] = clampByte(r);
      out[oIdx + 1] = clampByte(g);
      out[oIdx + 2] = clampByte(b);
      out[oIdx + 3] = 255;
    }
  }

  return out;
}

/**
 * Returns a cached PNG data-URL showing the lit 3D PBR material surface for UI buttons.
 * Returns `null` only in non-DOM/mock environments where 2D Canvas `createImageData` is absent.
 */
export function getMaterialPreviewDataUrl(materialId: string): string | null {
  if (swatchDataUrlCache.has(materialId)) {
    return swatchDataUrlCache.get(materialId) ?? null;
  }
  if (typeof document === 'undefined') {
    return null;
  }
  try {
    const w = 80;
    const h = 52;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (
      !ctx ||
      typeof ctx.createImageData !== 'function' ||
      typeof ctx.putImageData !== 'function' ||
      typeof canvas.toDataURL !== 'function'
    ) {
      swatchDataUrlCache.set(materialId, null);
      return null;
    }
    const pixels = renderMaterialSwatchPixels(materialId, w, h);
    const imgData = ctx.createImageData(w, h);
    imgData.data.set(pixels);
    ctx.putImageData(imgData, 0, 0);
    const url = canvas.toDataURL('image/png');
    const valid = typeof url === 'string' && url.startsWith('data:image/') ? url : null;
    swatchDataUrlCache.set(materialId, valid);
    return valid;
  } catch {
    swatchDataUrlCache.set(materialId, null);
    return null;
  }
}

// ============================================================================
// 10. THEMED STADIUM SPONSOR & COMPETITION LED RIBBON TEXTURES
// ============================================================================

type BrandLogoId =
  | 'adidas'
  | 'nike'
  | 'coca_cola'
  | 'visa'
  | 'qatar_airways'
  | 'mcdonalds'
  | 'hyundai'
  | 'fifa'
  | 'heineken'
  | 'ps5'
  | 'mastercard'
  | 'fedex'
  | 'lays'
  | 'ucl'
  | 'uber_eats'
  | 'kipsta'
  | 'bein'
  | 'betclic'
  | 'orange'
  | 'ea_sports'
  | 'barclays'
  | 'guinness'
  | 'hublot'
  | 'castrol'
  | 'hankook'
  | 'swissquote'
  | 'just_eat'
  | 'enterprise'
  | 'strauss'
  | 'credit_agricole'
  | 'edf'
  | 'vw'
  | 'fff'
  | 'apple_tv'
  | 'target'
  | 'continental'
  | 'audi'
  | 'att'
  | 'mls';

interface SponsorSlotSpec {
  bg: string;
  fg: string;
  accent: string;
  logo: BrandLogoId;
}

const SPONSOR_THEMES: Record<AdBoardTheme, SponsorSlotSpec[]> = {
  champions_league: [
    { bg: '#09143c', fg: '#ffffff', accent: '#38bdf8', logo: 'ucl' },
    { bg: '#064e3b', fg: '#ffffff', accent: '#ef4444', logo: 'heineken' },
    { bg: '#003791', fg: '#ffffff', accent: '#60a5fa', logo: 'ps5' },
    { bg: '#111827', fg: '#ffffff', accent: '#f59e0b', logo: 'mastercard' },
    { bg: '#2e1065', fg: '#ffffff', accent: '#f97316', logo: 'fedex' },
    { bg: '#5c0632', fg: '#ffffff', accent: '#f8fafc', logo: 'qatar_airways' },
    { bg: '#eab308', fg: '#7f1d1d', accent: '#dc2626', logo: 'lays' },
    { bg: '#09143c', fg: '#ffffff', accent: '#38bdf8', logo: 'ps5' },
  ],
  world_cup: [
    { bg: '#0c2340', fg: '#ffffff', accent: '#facc15', logo: 'fifa' },
    { bg: '#09090b', fg: '#ffffff', accent: '#f8fafc', logo: 'adidas' },
    { bg: '#dc2626', fg: '#ffffff', accent: '#fef2f2', logo: 'coca_cola' },
    { bg: '#1a1f71', fg: '#ffffff', accent: '#f7b600', logo: 'visa' },
    { bg: '#5c0632', fg: '#ffffff', accent: '#f1f5f9', logo: 'qatar_airways' },
    { bg: '#002c5f', fg: '#ffffff', accent: '#93c5fd', logo: 'hyundai' },
    { bg: '#b91c1c', fg: '#facc15', accent: '#facc15', logo: 'mcdonalds' },
    { bg: '#dc2626', fg: '#ffffff', accent: '#ffffff', logo: 'coca_cola' },
  ],
  ligue_1: [
    { bg: '#da291c', fg: '#ffc72c', accent: '#ffc72c', logo: 'mcdonalds' },
    { bg: '#06c167', fg: '#09090b', accent: '#ffffff', logo: 'uber_eats' },
    { bg: '#0f172a', fg: '#ffffff', accent: '#38bdf8', logo: 'kipsta' },
    { bg: '#5b21b6', fg: '#ffffff', accent: '#e9d5ff', logo: 'bein' },
    { bg: '#dc2626', fg: '#ffffff', accent: '#fde047', logo: 'betclic' },
    { bg: '#111827', fg: '#ffffff', accent: '#ff7900', logo: 'orange' },
    { bg: '#5c0632', fg: '#ffffff', accent: '#f8fafc', logo: 'qatar_airways' },
    { bg: '#da291c', fg: '#ffc72c', accent: '#ffc72c', logo: 'mcdonalds' },
  ],
  premier_league: [
    { bg: '#37003c', fg: '#ffffff', accent: '#00ff85', logo: 'ea_sports' },
    { bg: '#00aeef', fg: '#ffffff', accent: '#0c4a6e', logo: 'barclays' },
    { bg: '#09090b', fg: '#f59e0b', accent: '#fef3c7', logo: 'guinness' },
    { bg: '#f8fafc', fg: '#09090b', accent: '#dc2626', logo: 'nike' },
    { bg: '#18181b', fg: '#ffffff', accent: '#ef4444', logo: 'hublot' },
    { bg: '#00843d', fg: '#ffffff', accent: '#ef4444', logo: 'castrol' },
    { bg: '#37003c', fg: '#00ff85', accent: '#ffffff', logo: 'ea_sports' },
    { bg: '#00aeef', fg: '#ffffff', accent: '#f8fafc', logo: 'barclays' },
  ],
  europa_league: [
    { bg: '#111111', fg: '#ff6900', accent: '#ffffff', logo: 'hankook' },
    { bg: '#ff6900', fg: '#111111', accent: '#ffffff', logo: 'just_eat' },
    { bg: '#18181b', fg: '#ffffff', accent: '#ff6900', logo: 'swissquote' },
    { bg: '#007a33', fg: '#ffffff', accent: '#ecfdf5', logo: 'enterprise' },
    { bg: '#b91c1c', fg: '#ffffff', accent: '#fca5a5', logo: 'strauss' },
    { bg: '#111111', fg: '#ffffff', accent: '#ff6900', logo: 'hankook' },
    { bg: '#ff6900', fg: '#ffffff', accent: '#111111', logo: 'just_eat' },
    { bg: '#18181b', fg: '#ff6900', accent: '#ffffff', logo: 'swissquote' },
  ],
  equipe_de_france: [
    { bg: '#002395', fg: '#ffffff', accent: '#ed2939', logo: 'fff' },
    { bg: '#09090b', fg: '#ffffff', accent: '#38bdf8', logo: 'nike' },
    { bg: '#006a4e', fg: '#ffffff', accent: '#ef4444', logo: 'credit_agricole' },
    { bg: '#003896', fg: '#ffffff', accent: '#ff6600', logo: 'edf' },
    { bg: '#111827', fg: '#ffffff', accent: '#ff7900', logo: 'orange' },
    { bg: '#001e50', fg: '#ffffff', accent: '#93c5fd', logo: 'vw' },
    { bg: '#06c167', fg: '#09090b', accent: '#ffffff', logo: 'uber_eats' },
    { bg: '#002395', fg: '#ffffff', accent: '#ed2939', logo: 'fff' },
  ],
  mls_usa: [
    { bg: '#09090b', fg: '#ffffff', accent: '#a1a1aa', logo: 'apple_tv' },
    { bg: '#e11d24', fg: '#ffffff', accent: '#ffffff', logo: 'coca_cola' },
    { bg: '#0f172a', fg: '#ffffff', accent: '#ef4444', logo: 'mls' },
    { bg: '#111111', fg: '#ffffff', accent: '#f8fafc', logo: 'adidas' },
    { bg: '#cc0000', fg: '#ffffff', accent: '#ffffff', logo: 'target' },
    { bg: '#f59e0b', fg: '#09090b', accent: '#09090b', logo: 'continental' },
    { bg: '#18181b', fg: '#ffffff', accent: '#e4e4e7', logo: 'audi' },
    { bg: '#009fdb', fg: '#ffffff', accent: '#e0f2fe', logo: 'att' },
  ],
};

function drawBrandSlot(
  ctx: CanvasRenderingContext2D,
  slot: SponsorSlotSpec,
  x: number,
  w: number,
  h: number
): void {
  ctx.save();
  ctx.fillStyle = slot.bg;
  ctx.fillRect(x, 0, w - 3, h);

  // Subtle LED cabinet top/bottom bezel rim
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(x, 0, w - 3, 4);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(x, h - 5, w - 3, 5);

  const cx = x + w * 0.5;
  const cy = h * 0.5;
  ctx.fillStyle = slot.fg;
  ctx.strokeStyle = slot.fg;
  ctx.textAlign = 'center';

  switch (slot.logo) {
    case 'adidas': {
      // Iconic 3-stripes mountain + bold lowercase wordmark
      const bx = x + 48;
      for (let s = 0; s < 3; s++) {
        const barH = 16 + s * 10;
        ctx.save();
        ctx.translate(bx + s * 13, cy + 12);
        ctx.rotate(-0.46);
        ctx.fillRect(0, -barH, 8, barH);
        ctx.restore();
      }
      ctx.font = '900 34px Inter, Arial, sans-serif';
      ctx.fillText('adidas', cx + 28, cy + 12);
      break;
    }
    case 'nike': {
      // Crisp Swoosh + NIKE
      ctx.beginPath();
      ctx.moveTo(x + 36, cy + 2);
      ctx.quadraticCurveTo(x + 28, cy + 22, x + 52, cy + 16);
      ctx.lineTo(x + 104, cy - 12);
      ctx.quadraticCurveTo(x + 56, cy + 8, x + 44, cy + 4);
      ctx.closePath();
      ctx.fill();
      ctx.font = 'italic 900 34px Inter, Arial, sans-serif';
      ctx.fillText('NIKE', cx + 34, cy + 12);
      break;
    }
    case 'coca_cola': {
      ctx.font = 'italic 900 36px Georgia, serif';
      ctx.fillText('Coca-Cola', cx, cy + 8);
      // Dynamic white ribbon wave underneath
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x + 28, cy + 22);
      ctx.bezierCurveTo(x + 90, cy + 10, x + w - 90, cy + 32, x + w - 28, cy + 18);
      ctx.stroke();
      break;
    }
    case 'mcdonalds': {
      // Golden Arches M + wordmark
      ctx.strokeStyle = slot.accent;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(x + 32, cy + 20);
      ctx.quadraticCurveTo(x + 43, cy - 28, x + 54, cy + 18);
      ctx.quadraticCurveTo(x + 65, cy - 28, x + 76, cy + 20);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 28px Inter, Arial, sans-serif';
      ctx.fillText("McDonald's", cx + 28, cy + 10);
      break;
    }
    case 'mastercard': {
      ctx.fillStyle = '#eb001b';
      ctx.beginPath();
      ctx.arc(x + 52, cy, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f79e1b';
      ctx.globalAlpha = 0.88;
      ctx.beginPath();
      ctx.arc(x + 76, cy, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 26px Inter, Arial, sans-serif';
      ctx.fillText('mastercard', cx + 36, cy + 9);
      break;
    }
    case 'heineken': {
      // Red 5-point star + Heineken
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 18 : 7;
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        const px = x + 44 + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 31px Inter, Arial, sans-serif';
      ctx.fillText('Heineken', cx + 22, cy + 11);
      break;
    }
    case 'apple_tv': {
      // Crisp Apple silhouette + tv+
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + 56, cy + 3, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = slot.bg;
      ctx.beginPath();
      ctx.arc(x + 71, cy + 1, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(x + 58, cy - 15, 6, 3, -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '700 36px Inter, Arial, sans-serif';
      ctx.fillText('tv+', cx + 24, cy + 13);
      break;
    }
    case 'audi': {
      ctx.lineWidth = 4.5;
      for (let r = 0; r < 4; r++) {
        ctx.beginPath();
        ctx.arc(cx - 51 + r * 34, cy, 20, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'target': {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + 48, cy, 21, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#cc0000';
      ctx.beginPath();
      ctx.arc(x + 48, cy, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + 48, cy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '900 30px Inter, Arial, sans-serif';
      ctx.fillText('TARGET', cx + 28, cy + 11);
      break;
    }
    case 'visa': {
      ctx.fillStyle = '#f7b600';
      ctx.fillRect(x + 24, 14, 18, 8);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'italic 900 40px Inter, Arial, sans-serif';
      ctx.fillText('VISA', cx, cy + 15);
      break;
    }
    case 'orange': {
      ctx.fillStyle = '#ff7900';
      ctx.fillRect(x + 28, cy - 22, 44, 44);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 13px Inter, Arial, sans-serif';
      ctx.fillText('orange', x + 50, cy + 16);
      ctx.font = '800 30px Inter, Arial, sans-serif';
      ctx.fillText('Orange 5G', cx + 30, cy + 11);
      break;
    }
    case 'fedex': {
      ctx.font = '900 38px Inter, Arial, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Fed', cx - 24, cy + 13);
      ctx.fillStyle = '#ff6600';
      ctx.fillText('Ex', cx + 32, cy + 13);
      break;
    }
    case 'ps5': {
      ctx.font = '800 36px Inter, Arial, sans-serif';
      ctx.fillText('PS5', cx, cy + 13);
      ctx.strokeStyle = slot.accent;
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 18, 16, w - 39, h - 32);
      break;
    }
    case 'ucl': {
      ctx.strokeStyle = slot.accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x + 44, cy, 19, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = '800 24px Inter, Arial, sans-serif';
      ctx.fillText('CHAMPIONS', cx + 22, cy - 2);
      ctx.font = '700 18px Inter, Arial, sans-serif';
      ctx.fillStyle = slot.accent;
      ctx.fillText('LEAGUE', cx + 22, cy + 20);
      break;
    }
    case 'fff': {
      ctx.fillStyle = '#002395';
      ctx.fillRect(x + 20, 18, 12, h - 36);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + 32, 18, 12, h - 36);
      ctx.fillStyle = '#ed2939';
      ctx.fillRect(x + 44, 18, 12, h - 36);
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 24px Inter, Arial, sans-serif';
      ctx.fillText('ÉQUIPE DE FRANCE', cx + 20, cy + 9);
      break;
    }
    default: {
      const labelMap: Record<string, string> = {
        qatar_airways: 'QATAR AIRWAYS',
        hyundai: 'HYUNDAI',
        fifa: 'FIFA WORLD CUP',
        lays: "Lay's",
        uber_eats: 'Uber Eats',
        kipsta: 'KIPSTA',
        bein: 'beIN SPORTS',
        betclic: 'Betclic',
        ea_sports: 'EA SPORTS FC',
        barclays: 'BARCLAYS',
        guinness: 'GUINNESS',
        hublot: 'HUBLOT',
        castrol: 'Castrol',
        hankook: 'HANKOOK',
        swissquote: 'Swissquote',
        just_eat: 'JUST EAT',
        enterprise: 'enterprise',
        strauss: 'STRAUSS',
        credit_agricole: 'CRÉDIT AGRICOLE',
        edf: 'EDF',
        vw: 'VOLKSWAGEN',
        continental: 'Continental',
        att: 'AT&T',
        mls: 'MLS · APPLE TV',
      };
      const text = labelMap[slot.logo] ?? slot.logo.toUpperCase();
      ctx.fillStyle = slot.accent;
      ctx.beginPath();
      ctx.arc(x + 32, cy, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = slot.fg;
      ctx.font = text.length > 12 ? '800 23px Inter, Arial, sans-serif' : '900 30px Inter, Arial, sans-serif';
      ctx.fillText(text, cx + 14, cy + 10);
      break;
    }
  }

  ctx.restore();
}

const ledSponsorCache = new Map<AdBoardTheme, THREE.CanvasTexture>();

/**
 * Generates vibrant 2048x128 stadium LED perimeter & balcony advertising ribbon texture
 * with authentic sponsor logos & competition branding for the chosen `theme`.
 */
export function createLedSponsorRibbonTexture(
  theme: AdBoardTheme = 'champions_league'
): THREE.CanvasTexture {
  const safeTheme: AdBoardTheme = SPONSOR_THEMES[theme] ? theme : 'champions_league';
  const cached = ledSponsorCache.get(safeTheme);
  if (cached) {
    return cached.clone();
  }

  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const slots = SPONSOR_THEMES[safeTheme];
  const segW = canvas.width / slots.length;
  for (let i = 0; i < slots.length; i++) {
    drawBrandSlot(ctx, slots[i], i * segW, segW, canvas.height);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(3, 1);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  ledSponsorCache.set(safeTheme, tex);
  return tex.clone();
}

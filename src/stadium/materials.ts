import * as THREE from 'three';
import {
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
  StructureMaterialId,
  TrackMaterialId,
} from './schema';

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
}

export const ENVELOPE_STYLE_CATALOG: EnvelopeCatalogEntry[] = [
  {
    id: 'enveloping_skin',
    label: 'Peau enveloppante continue',
    subtitle: 'Façade unifiée (coussins ETFE, mur-rideau, brique ou résille)',
  },
  {
    id: 'exposed_structure',
    label: 'Structure apparente',
    subtitle: 'Dessous des gradins, poutres crémaillères & escaliers visibles',
  },
  {
    id: 'colonnade_forest',
    label: 'Colonnade / forêt de poteaux',
    subtitle: 'Péristyle dense de colonnes élancées filtrant les coursives',
  },
  {
    id: 'louver_curtain',
    label: 'Brise-soleil à lames ajourées',
    subtitle: 'Double peau en lames horizontales devant noyau vitré',
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
];

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
    label: 'Bâtiment',
    subtitle: 'Pavillon d’angle vitré pour salons, loges et bureaux',
  },
  {
    id: 'screen',
    label: 'Écran géant',
    subtitle: 'Portique d’angle portant un écran LED haute visibilité',
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

// ============================================================================
// 1. ARCHITECTURAL PRECAST / BOARD-FORMED CONCRETE BOWL MATERIAL
// ============================================================================

export function createConcreteBowlMaterial(
  maxAnisotropy: number = 4
): THREE.MeshStandardMaterial {
  const buffers = synthesizeCachedPbrBuffers(
    'concrete_bowl_v2',
    256,
    256,
    3.4,
    false,
    (u, v) => {
      const fbm = periodicFbm2D(u, v, 12, 4, 101);
      const fine = periodicNoise2D(u, v, 64, 64, 202);

      // Formwork shutter panels (4x8 panels per tile)
      const panelU = (u * 4) % 1;
      const panelV = (v * 8) % 1;
      const seamU = panelU < 0.018 || panelU > 0.982;
      const seamV = panelV < 0.025 || panelV > 0.975;
      const isSeam = seamU || seamV;

      // Formwork tie-rod cone holes (2 per shutter panel)
      const hole1 = Math.hypot(panelU - 0.22, (panelV - 0.5) * 0.55) < 0.032;
      const hole2 = Math.hypot(panelU - 0.78, (panelV - 0.5) * 0.55) < 0.032;
      const isTieHole = hole1 || hole2;

      // Subtle panel-to-panel tone shift like real poured concrete
      const panelIdHash = hash2Periodic(
        Math.floor(u * 4),
        Math.floor(v * 8),
        4,
        8,
        303
      );
      let base = 132 + (fbm - 0.5) * 28 + (fine - 0.5) * 14 + (panelIdHash - 0.5) * 10;
      let height = 0.55 + fbm * 0.22 + fine * 0.1;
      let rough = 0.84 + (fbm - 0.5) * 0.12;

      if (isSeam) {
        base -= 26;
        height = 0.18;
        rough = 0.95;
      } else if (isTieHole) {
        base -= 38;
        height = 0.08;
        rough = 0.96;
      }

      return {
        r: base * 0.96,
        g: base * 0.99,
        b: base * 1.04,
        height,
        roughness: rough,
      };
    }
  );

  const maps = wrapDataTextures(buffers, 4, 3, maxAnisotropy);
  return new THREE.MeshStandardMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: maps.roughnessMap,
    roughness: 0.92,
    metalness: 0.04,
  });
}

// ============================================================================
// 2. EXTERIOR FACADE PBR MATERIALS (7 ARCHITECTURAL MATERIALS)
// ============================================================================

export function createFacadePbrMaterial(
  facadeId: FacadeMaterialId,
  lighting: LightingMode,
  flatShading: boolean = false,
  maxAnisotropy: number = 4
): THREE.MeshPhysicalMaterial {
  const isNight = lighting !== 'day';
  const key = `facade_${facadeId}_${isNight ? 'lit' : 'day'}_v3`;

  const buffers = synthesizeCachedPbrBuffers(key, 256, 256, 4.2, true, (u, v) => {
    const fbm = periodicFbm2D(u, v, 10, 3, 401);
    const fine = periodicNoise2D(u, v, 48, 48, 505);

    // Concourse horizontal glazed vision bands on floors
    const floorBand = (v * 4) % 1;
    const winBay = (u * 12) % 1;
    const inVisionBand = floorBand > 0.28 && floorBand < 0.74 && winBay > 0.09 && winBay < 0.91;
    const roomLitHash = hash2Periodic(Math.floor(u * 12), Math.floor(v * 4), 12, 4, 707);

    if (facadeId === 'etfe_cushions_facade') {
      const du = (u * 7 + v * 5) % 1;
      const dv = (u * 7 - v * 5 + 10) % 1;
      const seam = du < 0.06 || du > 0.94 || dv < 0.06 || dv > 0.94;
      if (seam) {
        return {
          r: 30,
          g: 41,
          b: 59,
          height: 0.08,
          roughness: 0.44,
        };
      }
      const pillowDome = Math.sin(du * Math.PI) * Math.sin(dv * Math.PI);
      const cellTint = hash2Periodic(
        Math.floor(u * 7 + v * 5),
        Math.floor(u * 7 - v * 5 + 10),
        14,
        14,
        603
      );
      const glowStrength = isNight ? 0.65 + pillowDome * 0.35 : 0;
      const warmRedAccent = cellTint > 0.72;
      return {
        r: isNight
          ? (warmRedAccent ? 235 : 145) + pillowDome * 40
          : 215 + pillowDome * 35,
        g: isNight
          ? (warmRedAccent ? 95 : 210) + pillowDome * 38
          : 232 + pillowDome * 20,
        b: isNight ? 248 : 248 + pillowDome * 7,
        height: 0.22 + pillowDome * 0.76,
        roughness: 0.14 + (1 - pillowDome) * 0.14,
        emissiveR: isNight ? (warmRedAccent ? 239 : 56) * glowStrength : 0,
        emissiveG: isNight ? (warmRedAccent ? 68 : 189) * glowStrength : 0,
        emissiveB: isNight ? (warmRedAccent ? 68 : 248) * glowStrength : 0,
      };
    }

    if (facadeId === 'glass_curtain') {
      const mullionX = ((u * 16) % 1) < 0.065;
      const transomY = ((v * 8) % 1) < 0.075;
      const spandrel = ((v * 4) % 1) < 0.24;
      if (mullionX || transomY) {
        return {
          r: 38,
          g: 46,
          b: 58,
          height: 0.88,
          roughness: 0.36,
        };
      }
      if (spandrel) {
        return {
          r: 18,
          g: 28,
          b: 44,
          height: 0.48,
          roughness: 0.22,
        };
      }
      const lit = isNight && roomLitHash > 0.22;
      return {
        r: lit ? 210 : 58 + fbm * 16,
        g: lit ? 176 : 82 + fbm * 18,
        b: lit ? 115 : 104 + fbm * 20,
        height: 0.5,
        roughness: 0.07 + fine * 0.03,
        emissiveR: lit ? 245 : 0,
        emissiveG: lit ? 195 : 0,
        emissiveB: lit ? 115 : 0,
      };
    }

    if (facadeId === 'brushed_steel_mesh') {
      const louver = Math.sin(v * Math.PI * 48) * 0.5 + 0.5;
      const ribU = ((u * 8) % 1) < 0.05;
      const perf = !ribU && louver < 0.28 && inVisionBand;
      if (perf && isNight) {
        return {
          r: 235,
          g: 196,
          b: 125,
          height: 0.15,
          roughness: 0.5,
          emissiveR: 235,
          emissiveG: 185,
          emissiveB: 105,
        };
      }
      const brush = periodicNoise2D(u, v, 8, 96, 612);
      const val = ribU ? 145 : 178 + louver * 36 + (brush - 0.5) * 18;
      return {
        r: val * 0.96,
        g: val * 0.99,
        b: val * 1.04,
        height: ribU ? 0.92 : 0.35 + louver * 0.45,
        roughness: ribU ? 0.28 : 0.24 + (1 - louver) * 0.22,
      };
    }

    if (facadeId === 'weathered_corten') {
      if (inVisionBand && ((v * 4) % 1) > 0.36 && ((v * 4) % 1) < 0.64) {
        const lit = isNight && roomLitHash > 0.25;
        return {
          r: lit ? 235 : 22,
          g: lit ? 182 : 32,
          b: lit ? 105 : 46,
          height: 0.2,
          roughness: 0.1,
          emissiveR: lit ? 235 : 0,
          emissiveG: lit ? 175 : 0,
          emissiveB: lit ? 92 : 0,
        };
      }
      const cassetteU = ((u * 8) % 1) < 0.04;
      const cassetteV = ((v * 8) % 1) < 0.04;
      const patina = periodicFbm2D(u, v, 8, 4, 811);
      const streak = periodicNoise2D(u, v, 32, 6, 812);
      if (cassetteU || cassetteV) {
        return { r: 42, g: 20, b: 14, height: 0.12, roughness: 0.92 };
      }
      const rustMix = clamp01(patina * 0.7 + streak * 0.3);
      return {
        r: 112 + rustMix * 84,
        g: 42 + rustMix * 42,
        b: 20 + rustMix * 16,
        height: 0.45 + patina * 0.35 + fine * 0.15,
        roughness: 0.62 + (1 - rustMix) * 0.26,
      };
    }

    if (facadeId === 'heritage_brick') {
      if (inVisionBand && ((u * 12) % 1) > 0.22 && ((u * 12) % 1) < 0.78) {
        const lit = isNight && roomLitHash > 0.28;
        return {
          r: lit ? 238 : 24,
          g: lit ? 195 : 36,
          b: lit ? 120 : 52,
          height: 0.15,
          roughness: 0.12,
          emissiveR: lit ? 230 : 0,
          emissiveG: lit ? 180 : 0,
          emissiveB: lit ? 98 : 0,
        };
      }
      // Stone string-course cornice every floor
      if (floorBand < 0.08) {
        return {
          r: 214 + (fbm - 0.5) * 16,
          g: 208 + (fbm - 0.5) * 16,
          b: 196 + (fbm - 0.5) * 16,
          height: 0.85,
          roughness: 0.74,
        };
      }
      const rowIdx = Math.floor(v * 32);
      const rowFrac = (v * 32) % 1;
      const stagger = (rowIdx % 2) * 0.5;
      const colIdx = Math.floor(u * 16 + stagger);
      const colFrac = (u * 16 + stagger) % 1;
      const isMortar = rowFrac < 0.14 || colFrac < 0.08;
      if (isMortar) {
        return {
          r: 186 + (fine - 0.5) * 18,
          g: 180 + (fine - 0.5) * 18,
          b: 170 + (fine - 0.5) * 18,
          height: 0.14,
          roughness: 0.94,
        };
      }
      const brickTint = hash2Periodic(colIdx, rowIdx, 16, 32, 909);
      return {
        r: 132 + brickTint * 46 + (fine - 0.5) * 14,
        g: 46 + brickTint * 22 + (fine - 0.5) * 10,
        b: 34 + brickTint * 16,
        height: 0.68 + fine * 0.2,
        roughness: 0.72 + (1 - brickTint) * 0.16,
      };
    }

    if (facadeId === 'limestone_travertine') {
      if (inVisionBand && ((v * 4) % 1) > 0.34 && ((v * 4) % 1) < 0.68) {
        const lit = isNight && roomLitHash > 0.25;
        return {
          r: lit ? 242 : 28,
          g: lit ? 202 : 44,
          b: lit ? 132 : 62,
          height: 0.18,
          roughness: 0.1,
          emissiveR: lit ? 235 : 0,
          emissiveG: lit ? 190 : 0,
          emissiveB: lit ? 112 : 0,
        };
      }
      const rowIdx = Math.floor(v * 12);
      const rowFrac = (v * 12) % 1;
      const colIdx = Math.floor(u * 8 + (rowIdx % 2) * 0.5);
      const colFrac = (u * 8 + (rowIdx % 2) * 0.5) % 1;
      const joint = rowFrac < 0.06 || colFrac < 0.04;
      const vein = periodicNoise2D(u, v, 6, 32, 933);
      const blockTone = hash2Periodic(colIdx, rowIdx, 8, 12, 934);
      if (joint) {
        return { r: 158, g: 151, b: 140, height: 0.16, roughness: 0.92 };
      }
      const base = 212 + (blockTone - 0.5) * 16 + (vein - 0.5) * 18;
      return {
        r: base * 1.02,
        g: base * 0.98,
        b: base * 0.9,
        height: 0.62 + vein * 0.22 - (fine > 0.82 ? 0.18 : 0),
        roughness: 0.58 + (fine > 0.82 ? 0.28 : 0.08),
      };
    }

    if (facadeId === 'timber_diagrid') {
      const slat = ((u * 36) % 1);
      const isGap = slat < 0.26;
      const diagA = Math.abs(((u * 4 + v * 2) % 1) - 0.5) < 0.045;
      const diagB = Math.abs(((u * 4 - v * 2 + 4) % 1) - 0.5) < 0.045;
      if (diagA || diagB) {
        return {
          r: 188,
          g: 118,
          b: 52,
          height: 0.94,
          roughness: 0.52,
        };
      }
      if (isGap) {
        const lit = isNight && inVisionBand && roomLitHash > 0.2;
        return {
          r: lit ? 242 : 24,
          g: lit ? 192 : 30,
          b: lit ? 110 : 38,
          height: 0.15,
          roughness: 0.16,
          emissiveR: lit ? 238 : 0,
          emissiveG: lit ? 182 : 0,
          emissiveB: lit ? 96 : 0,
        };
      }
      const grain = periodicNoise2D(u, v, 48, 8, 955);
      return {
        r: 162 + grain * 42,
        g: 98 + grain * 28,
        b: 44 + grain * 14,
        height: 0.68 + grain * 0.16,
        roughness: 0.56 + (1 - grain) * 0.18,
      };
    }

    // Default: `architectural_concrete` facade
    if (inVisionBand && ((v * 4) % 1) > 0.36 && ((v * 4) % 1) < 0.66) {
      const lit = isNight && roomLitHash > 0.25;
      return {
        r: lit ? 236 : 26,
        g: lit ? 196 : 38,
        b: lit ? 124 : 52,
        height: 0.18,
        roughness: 0.12,
        emissiveR: lit ? 228 : 0,
        emissiveG: lit ? 182 : 0,
        emissiveB: lit ? 102 : 0,
      };
    }
    const seamU = ((u * 8) % 1) < 0.03;
    const seamV = ((v * 8) % 1) < 0.04;
    const val = (seamU || seamV ? 105 : 156) + (fbm - 0.5) * 26 + (fine - 0.5) * 12;
    return {
      r: val * 0.97,
      g: val * 0.99,
      b: val * 1.02,
      height: seamU || seamV ? 0.18 : 0.64 + fbm * 0.2,
      roughness: seamU || seamV ? 0.95 : 0.78 + (fbm - 0.5) * 0.14,
    };
  });

  const maps = wrapDataTextures(buffers, 7, 2, maxAnisotropy);

  const isMetallic = facadeId === 'brushed_steel_mesh';
  const isGlass = facadeId === 'glass_curtain';
  const isEtfe = facadeId === 'etfe_cushions_facade';
  const isCorten = facadeId === 'weathered_corten';

  return new THREE.MeshPhysicalMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(isEtfe ? 1.35 : 1.0, isEtfe ? 1.35 : 1.0),
    roughnessMap: maps.roughnessMap,
    roughness: 1.0,
    metalness: isMetallic ? 0.82 : isGlass ? 0.35 : isCorten ? 0.42 : 0.06,
    clearcoat: isGlass || isEtfe ? 0.92 : isMetallic ? 0.35 : 0.0,
    clearcoatRoughness: isGlass ? 0.08 : isEtfe ? 0.14 : 0.25,
    envMapIntensity: isGlass ? 1.45 : isMetallic ? 1.25 : isEtfe ? 1.15 : 0.85,
    emissive: new THREE.Color(isNight ? 0xffffff : 0x000000),
    emissiveMap: maps.emissiveMap,
    emissiveIntensity: isNight ? (isEtfe ? 1.15 : 0.82) : 0,
    flatShading,
    side: THREE.DoubleSide,
  });
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
  const isMetalRoof = roofId === 'standing_seam_zinc' || roofId === 'titanium_scales';
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
    metalness: isMetalRoof ? 0.78 : isGlassRoof ? 0.18 : 0.06,
    clearcoat: isGlassRoof ? 0.95 : isEtfe ? 0.75 : roofId === 'titanium_scales' ? 0.35 : 0.0,
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

  return new THREE.MeshPhysicalMaterial({
    map: maps.map,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughnessMap: maps.roughnessMap,
    roughness: 1.0,
    metalness: isWood ? 0.08 : isCorten ? 0.48 : 0.82,
    clearcoat: structureId === 'white_steel' ? 0.35 : 0,
    clearcoatRoughness: 0.22,
    envMapIntensity: isWood ? 0.75 : 1.15,
  });
}

// ============================================================================
// 5. 3D MOLDED BUCKET SEATING + RADIAL STAIRS + VOMITORIES PBR MATERIAL
// ============================================================================

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

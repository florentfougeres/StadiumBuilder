import React, { useMemo } from 'react';
import {
  calculateStadiumMetrics,
  resolveStandRoofStyle,
} from '../stadium/capacity';
import {
  ENVELOPE_STYLE_CATALOG,
  FACADE_MATERIAL_CATALOG,
  PLAZA_MATERIAL_CATALOG,
  resolveStadiumMaterials,
  ROOF_MATERIAL_CATALOG,
  SEAT_CLUB_PALETTES,
  SEAT_MATERIAL_CATALOG,
  STRUCTURE_MATERIAL_CATALOG,
  TRACK_MATERIAL_CATALOG,
  TURF_MATERIAL_CATALOG,
} from '../stadium/materials';
import {
  getEffectiveSunkenDepth,
  isContinuousBowlShape,
  RoofStyle,
  SeatingType,
  slopeDegFromRiser,
  StadiumShape,
  StandSide,
} from '../stadium/schema';
import { computeStandSightlines } from '../stadium/sightlines';
import { useStadiumStore } from '../state/useStadiumStore';

export type DockSection = 'architecture' | 'stands' | 'roof_colors' | 'objects' | 'exports';

interface InspectorProps {
  section: DockSection;
  layout?: 'sidebar' | 'dock';
}

const SHAPE_OPTIONS: { id: StadiumShape; label: string; desc: string }[] = [
  {
    id: 'four_stands',
    label: 'Stade « à l’anglaise » (4 tribunes)',
    desc: '4 tribunes indépendantes collées au terrain & coins ouverts',
  },
  {
    id: 'compact_urban',
    label: 'Rectangulaire à coins fermés',
    desc: 'Angles remplis en enceinte continue UEFA & tours d’accès',
  },
  {
    id: 'english_rectangular',
    label: 'Rectangulaire modulable',
    desc: 'Tribunes hétérogènes à coins ouverts ou fermés au choix',
  },
  {
    id: 'modern_bowl',
    label: 'Bowl (cuvette) continu',
    desc: 'Gradins elliptiques continus 360° sans rupture',
  },
  {
    id: 'steep_cauldron',
    label: 'Chaudron parabolique raide',
    desc: 'Pente forte (34–37°), proximité immédiate & fort surplomb',
  },
  {
    id: 'olympic_oval',
    label: 'Bowl avec piste d’athlétisme',
    desc: 'Cuvette évasée autour d’une piste 8 couloirs',
  },
  {
    id: 'horseshoe',
    label: 'Fer à cheval (en U ouvert)',
    desc: '3 côtés continus & extrémité ouverte sur parvis panoramique',
  },
  {
    id: 'sunken_bowl',
    label: 'Amphithéâtre semi-enterré',
    desc: 'Anneaux bas creusés dans le sol, seuls le haut et le toit émergent',
  },
  {
    id: 'octagonal_arena',
    label: 'Arène octogonale facettée',
    desc: '8 pans coupés géométriques & virages à 45°',
  },
];

const ROOF_OPTIONS: { id: RoofStyle; label: string; desc: string }[] = [
  {
    id: 'cantilever',
    label: 'Porte-à-faux (cantilever)',
    desc: 'Fléaux encastrés à l’arrière sans poteaux gênants',
  },
  {
    id: 'column_supported',
    label: 'Sur poteaux dans les gradins',
    desc: 'Poteaux fins plantés dans les gradins (économique, vue gênée)',
  },
  {
    id: 'goalpost_truss',
    label: 'Poutre-portique (goalpost)',
    desc: 'Mégapoutre franchissant la tribune sur 2 pylônes latéraux',
  },
  {
    id: 'truss',
    label: 'Charpente treillis & frontons',
    desc: 'Toitures indépendantes à frontons vitrés d’angles',
  },
  {
    id: 'suspended_masts',
    label: 'Haubané / suspendu sur mâts',
    desc: 'Mâts extérieurs et nappes de câbles portant le toit par le dessus',
  },
  {
    id: 'giant_arch',
    label: 'Arche géante porteuse',
    desc: 'Grand arc métallique franchissant le stade & câbles suspente',
  },
  {
    id: 'bowstring_arch',
    label: 'Bi-poutres lenticulaires',
    desc: '2 mégapoutres tubulaires sur 4 tours d’angles',
  },
  {
    id: 'bicycle_wheel',
    label: 'Roue de vélo (anneau tendu)',
    desc: 'Anneau extérieur comprimé, anneau intérieur tendu & câbles radiaux',
  },
  {
    id: 'tensile_net',
    label: 'Résille & membranes tendues',
    desc: 'Voile anticlastic PTFE/ETFE sur mâts inclinés & haubans',
  },
  {
    id: 'enveloping_shell',
    label: 'Coque intégrale enveloppante',
    desc: 'Continuité fluide entre façade et couverture',
  },
  {
    id: 'twin_arch',
    label: 'Arches jumelles',
    desc: '2 arcs treillis parallèles portant l’anneau de couverture',
  },
  {
    id: 'retractable',
    label: 'Toit rétractable motorisé',
    desc: 'Panneaux coulissants épousant l’ouverture centrale',
  },
  {
    id: 'fixed_dome',
    label: 'Dôme fixe intégral',
    desc: 'Coupole fermée à résille géodésique & oculus zénithal',
  },
  {
    id: 'none',
    label: 'Découvert (ciel ouvert)',
    desc: 'Gradins à l’air libre sans couverture',
  },
];

const SEATING_TYPE_OPTIONS: { id: SeatingType; label: string; desc: string }[] = [
  {
    id: 'seated',
    label: 'Places assises individuelles',
    desc: 'Coques numérotées standard UEFA/FIFA',
  },
  {
    id: 'safe_standing',
    label: 'Gradins debout (Safe Standing)',
    desc: 'Barrières brise-foule continues & sièges verrouillables (+34% cap.)',
  },
  {
    id: 'telescopic',
    label: 'Gradins bas télescopiques',
    desc: 'Cassettes basses rétractables avançant vers la pelouse',
  },
];

const STAND_TABS: { id: StandSide; label: string }[] = [
  { id: 'south', label: 'Sud' },
  { id: 'north', label: 'Nord' },
  { id: 'east', label: 'Est' },
  { id: 'west', label: 'Ouest' },
];

const TIER_OPTIONS: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5];

/**
 * Pure SVG procedural material swatch preview (zero inline styles, crisp micro-textures).
 */
const MaterialSwatchSvg: React.FC<{ materialId: string }> = ({ materialId }) => {
  switch (materialId) {
    case 'glass_curtain':
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill="#0f2942" />
          <polygon points="0,0 26,0 10,28 0,28" fill="#0284c7" opacity="0.55" />
          <polygon points="18,0 30,0 14,28 4,28" fill="#bae6fd" opacity="0.3" />
          <line x1="10" y1="0" x2="10" y2="28" stroke="#020617" strokeWidth="1.5" />
          <line x1="20" y1="0" x2="20" y2="28" stroke="#020617" strokeWidth="1.5" />
          <line x1="30" y1="0" x2="30" y2="28" stroke="#020617" strokeWidth="1.5" />
          <line x1="0" y1="14" x2="40" y2="14" stroke="#64748b" strokeWidth="1" />
        </svg>
      );
    case 'brushed_steel_mesh':
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill="#94a3b8" />
          <polygon points="0,0 28,0 12,28 0,28" fill="#e2e8f0" opacity="0.65" />
          {[4, 8, 12, 16, 20, 24].map((y) => (
            <line key={y} x1="0" y1={y} x2="40" y2={y} stroke="#1e293b" strokeWidth="1.2" opacity="0.55" />
          ))}
        </svg>
      );
    case 'architectural_concrete':
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill="#8b95a1" />
          <line x1="20" y1="0" x2="20" y2="28" stroke="#475569" strokeWidth="1" />
          <line x1="0" y1="14" x2="40" y2="14" stroke="#475569" strokeWidth="1" />
          <circle cx="10" cy="7" r="1.4" fill="#334155" />
          <circle cx="30" cy="7" r="1.4" fill="#334155" />
          <circle cx="10" cy="21" r="1.4" fill="#334155" />
          <circle cx="30" cy="21" r="1.4" fill="#334155" />
        </svg>
      );
    case 'weathered_corten':
    case 'corten_structure':
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill="#7c2d12" />
          <circle cx="12" cy="10" r="10" fill="#c2410c" opacity="0.65" />
          <circle cx="30" cy="20" r="9" fill="#431407" opacity="0.6" />
          <line x1="14" y1="0" x2="14" y2="28" stroke="#291509" strokeWidth="1.2" />
          <line x1="28" y1="0" x2="28" y2="28" stroke="#291509" strokeWidth="1.2" />
        </svg>
      );
    case 'heritage_brick':
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill="#88291a" />
          {[7, 14, 21].map((y) => (
            <line key={y} x1="0" y1={y} x2="40" y2={y} stroke="#cbd5e1" strokeWidth="1" opacity="0.65" />
          ))}
          <line x1="13" y1="0" x2="13" y2="7" stroke="#cbd5e1" strokeWidth="1" opacity="0.6" />
          <line x1="27" y1="0" x2="27" y2="7" stroke="#cbd5e1" strokeWidth="1" opacity="0.6" />
          <line x1="20" y1="7" x2="20" y2="14" stroke="#cbd5e1" strokeWidth="1" opacity="0.6" />
          <line x1="13" y1="14" x2="13" y2="21" stroke="#cbd5e1" strokeWidth="1" opacity="0.6" />
          <line x1="27" y1="14" x2="27" y2="21" stroke="#cbd5e1" strokeWidth="1" opacity="0.6" />
        </svg>
      );
    case 'limestone_travertine':
    case 'sandstone_esplanade':
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill="#d6d0c4" />
          <rect x="0" y="0" width="40" height="10" fill="#e7e2d8" opacity="0.7" />
          <line x1="0" y1="10" x2="40" y2="10" stroke="#78716c" strokeWidth="1" opacity="0.55" />
          <line x1="0" y1="20" x2="40" y2="20" stroke="#78716c" strokeWidth="1" opacity="0.55" />
          <line x1="22" y1="0" x2="22" y2="10" stroke="#78716c" strokeWidth="1" opacity="0.45" />
          <line x1="12" y1="10" x2="12" y2="20" stroke="#78716c" strokeWidth="1" opacity="0.45" />
        </svg>
      );
    case 'timber_diagrid':
    case 'glulam_acoustic_deck':
    case 'glulam_timber':
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill="#b45309" />
          {[5, 11, 17, 23, 29, 35].map((x) => (
            <line key={x} x1={x} y1="0" x2={x} y2="28" stroke="#451a03" strokeWidth="1.6" opacity="0.65" />
          ))}
          <polygon points="0,0 40,0 40,9 0,14" fill="#f59e0b" opacity="0.28" />
        </svg>
      );
    case 'ptfe_membrane':
    case 'white_steel':
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill="#e2e8f0" />
          <polygon points="0,0 32,0 16,28 0,28" fill="#ffffff" opacity="0.85" />
          <line x1="14" y1="0" x2="14" y2="28" stroke="#94a3b8" strokeWidth="1" />
          <line x1="28" y1="0" x2="28" y2="28" stroke="#94a3b8" strokeWidth="1" />
        </svg>
      );
    case 'etfe_cushions':
    case 'etfe_cushions_facade':
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill="#38bdf8" />
          <polygon points="20,2 37,14 20,26 3,14" fill="#f0f9ff" stroke="#1e293b" strokeWidth="1.2" />
          <ellipse cx="20" cy="14" rx="8" ry="5" fill="#bae6fd" opacity="0.7" />
        </svg>
      );
    case 'polycarbonate_glass':
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill="#38bdf8" opacity="0.45" />
          <polygon points="0,0 24,0 8,28 0,28" fill="#e0f2fe" opacity="0.7" />
          {[8, 16, 24, 32].map((x) => (
            <line key={x} x1={x} y1="0" x2={x} y2="28" stroke="#1e293b" strokeWidth="1.2" />
          ))}
        </svg>
      );
    case 'standing_seam_zinc':
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill="#64748b" />
          {[6, 13, 20, 27, 34].map((x) => (
            <g key={x}>
              <line x1={x} y1="0" x2={x} y2="28" stroke="#1e293b" strokeWidth="1.4" />
              <line x1={x + 1.5} y1="0" x2={x + 1.5} y2="28" stroke="#cbd5e1" strokeWidth="0.9" />
            </g>
          ))}
        </svg>
      );
    case 'titanium_scales':
    case 'galvanized_steel':
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill="#94a3b8" />
          <polygon points="0,0 24,0 40,28 14,28" fill="#f1f5f9" opacity="0.65" />
          <line x1="0" y1="9" x2="40" y2="9" stroke="#475569" strokeWidth="0.9" />
          <line x1="0" y1="19" x2="40" y2="19" stroke="#475569" strokeWidth="0.9" />
        </svg>
      );
    case 'anthracite_steel':
    case 'anthracite_apron':
    case 'urban_asphalt':
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill="#1e293b" />
          <polygon points="0,0 22,0 10,28 0,28" fill="#475569" opacity="0.55" />
          <circle cx="28" cy="10" r="1" fill="#94a3b8" opacity="0.5" />
          <circle cx="16" cy="20" r="1" fill="#94a3b8" opacity="0.5" />
        </svg>
      );
    case 'molded_poly_mosaic':
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill="#991b1b" />
          <rect x="3" y="4" width="6" height="8" rx="1.5" fill="#ef4444" />
          <rect x="11" y="4" width="6" height="8" rx="1.5" fill="#f8fafc" />
          <rect x="19" y="4" width="6" height="8" rx="1.5" fill="#dc2626" />
          <rect x="27" y="4" width="6" height="8" rx="1.5" fill="#fca5a5" />
          <rect x="3" y="15" width="6" height="8" rx="1.5" fill="#dc2626" />
          <rect x="11" y="15" width="6" height="8" rx="1.5" fill="#b91c1c" />
          <rect x="19" y="15" width="6" height="8" rx="1.5" fill="#f8fafc" />
          <rect x="27" y="15" width="6" height="8" rx="1.5" fill="#ef4444" />
        </svg>
      );
    case 'ribbed_stadium_shell':
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill="#1e3a8a" />
          {[4, 13, 22, 31].map((x) => (
            <rect key={x} x={x} y="4" width="6" height="20" rx="2" fill="#3b82f6" />
          ))}
          <rect x="0" y="12" width="40" height="4" fill="#f8fafc" opacity="0.85" />
        </svg>
      );
    case 'padded_club_velvet':
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill="#0f172a" />
          {[4, 14, 24].map((x) => (
            <rect key={x} x={x} y="4" width="8" height="20" rx="2.5" fill="#334155" stroke="#475569" strokeWidth="0.8" />
          ))}
        </svg>
      );
    case 'hybrid_emerald':
    case 'natural_ryegrass':
    case 'winter_worn':
    case 'pro_synthetic': {
      const c1 =
        materialId === 'winter_worn'
          ? '#245830'
          : materialId === 'natural_ryegrass'
          ? '#227334'
          : materialId === 'pro_synthetic'
          ? '#166534'
          : '#1d6832';
      const c2 =
        materialId === 'winter_worn'
          ? '#2d6a3b'
          : materialId === 'natural_ryegrass'
          ? '#309146'
          : materialId === 'pro_synthetic'
          ? '#1b7a3e'
          : '#268040';
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill={c1} />
          <rect x="8" y="0" width="8" height="28" fill={c2} />
          <rect x="24" y="0" width="8" height="28" fill={c2} />
          {materialId === 'winter_worn' && (
            <ellipse cx="20" cy="14" rx="9" ry="5" fill="#785832" opacity="0.45" />
          )}
          <line x1="0" y1="14" x2="40" y2="14" stroke="#f8fafc" strokeWidth="1" opacity="0.75" />
        </svg>
      );
    }
    case 'mondo_red':
    case 'mondo_blue':
    case 'mondo_violet': {
      const fill =
        materialId === 'mondo_blue'
          ? '#1d4ed8'
          : materialId === 'mondo_violet'
          ? '#5b21b6'
          : '#9a2b20';
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill={fill} />
          {[7, 14, 21].map((y) => (
            <line key={y} x1="0" y1={y} x2="40" y2={y} stroke="#f8fafc" strokeWidth="0.9" opacity="0.85" />
          ))}
        </svg>
      );
    }
    default:
      return (
        <svg viewBox="0 0 40 28" className="w-10 h-7 rounded border border-slate-700 shrink-0">
          <rect width="40" height="28" fill="#475569" />
          <line x1="13" y1="0" x2="13" y2="28" stroke="#cbd5e1" strokeWidth="0.8" opacity="0.4" />
          <line x1="27" y1="0" x2="27" y2="28" stroke="#cbd5e1" strokeWidth="0.8" opacity="0.4" />
          <line x1="0" y1="14" x2="40" y2="14" stroke="#cbd5e1" strokeWidth="0.8" opacity="0.4" />
        </svg>
      );
  }
};

const PaletteChipSvg: React.FC<{ primary: string; secondary: string }> = ({
  primary,
  secondary,
}) => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 rounded-full border border-slate-700 shrink-0">
    <path d="M0,0 L24,0 L0,24 Z" fill={primary} />
    <path d="M24,0 L24,24 L0,24 Z" fill={secondary} />
  </svg>
);

export const Inspector: React.FC<InspectorProps> = ({ section, layout = 'sidebar' }) => {
  const doc = useStadiumStore((s) => s.doc);
  const activeStandTab = useStadiumStore((s) => s.activeStandTab);
  const setActiveStandTab = useStadiumStore((s) => s.setActiveStandTab);

  const setShape = useStadiumStore((s) => s.setShape);
  const setSunkenDepth = useStadiumStore((s) => s.setSunkenDepth);
  const setCornerFill = useStadiumStore((s) => s.setCornerFill);
  const updatePitch = useStadiumStore((s) => s.updatePitch);
  const updateStand = useStadiumStore((s) => s.updateStand);
  const convertStandToKopWall = useStadiumStore((s) => s.convertStandToKopWall);
  const updateAllStands = useStadiumStore((s) => s.updateAllStands);
  const applyTargetCapacity = useStadiumStore((s) => s.applyTargetCapacity);
  const updateRoof = useStadiumStore((s) => s.updateRoof);
  const updateColors = useStadiumStore((s) => s.updateColors);
  const updateMaterials = useStadiumStore((s) => s.updateMaterials);

  const metrics = useMemo(() => calculateStadiumMetrics(doc), [doc]);
  const resolvedMaterials = useMemo(() => resolveStadiumMaterials(doc), [doc]);
  const currentStand = doc.stands[activeStandTab];
  const currentStandMetrics = metrics.stands[activeStandTab];
  const effectiveSunkenDepth = getEffectiveSunkenDepth(doc);
  const activeStandRoofStyle = resolveStandRoofStyle(doc, activeStandTab);

  const maxNeighbourHeight = useMemo(() => {
    let maxH = 0;
    (['north', 'south', 'east', 'west'] as StandSide[]).forEach((s) => {
      if (s !== activeStandTab && metrics.stands[s].enabled) {
        maxH = Math.max(maxH, metrics.stands[s].maxHeight);
      }
    });
    return maxH;
  }, [metrics, activeStandTab]);

  const currentSlopeDeg =
    currentStand.slopeAngleDeg ??
    slopeDegFromRiser(currentStand.riserHeight, currentStand.rowDepth);

  const sightlineDetails = useMemo(
    () =>
      computeStandSightlines(
        currentStand,
        doc.pitch.hasTrack ? doc.pitch.trackLanes * 1.22 + 2.5 : 0,
        activeStandRoofStyle
      ),
    [currentStand, doc.pitch.hasTrack, doc.pitch.trackLanes, activeStandRoofStyle]
  );

  const isSidebar = layout === 'sidebar';

  if (section === 'architecture') {
    return (
      <div
        className={
          isSidebar
            ? 'space-y-5'
            : 'grid grid-cols-1 md:grid-cols-12 gap-5 items-start'
        }
      >
        {/* 8 Stadium Morphologies & Target Capacity */}
        <div className={isSidebar ? 'space-y-4' : 'md:col-span-6 space-y-3'}>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">
                Morphologie de l’enceinte
              </span>
              <span className="text-[11px] text-slate-400">
                {SHAPE_OPTIONS.length} morphologies
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {SHAPE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setShape(opt.id)}
                  className={`p-2.5 rounded-lg border text-left transition-colors ${
                    doc.shape === opt.id
                      ? 'bg-emerald-600/20 border-emerald-500 text-emerald-100'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className="text-xs font-semibold truncate">{opt.label}</div>
                  <div className="text-[11px] text-slate-400 line-clamp-2 mt-0.5 leading-snug">
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 p-3 rounded-lg bg-slate-950 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-200 font-medium">Capacité cible automatique</span>
              <span className="font-mono tabular-nums text-emerald-400 font-semibold">
                {metrics.totalCapacity.toLocaleString('fr-FR')} places
              </span>
            </div>
            <input
              type="range"
              min={8000}
              max={110000}
              step={1000}
              value={Math.min(110000, metrics.totalCapacity)}
              onChange={(e) => applyTargetCapacity(Number(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-slate-500 font-mono tabular-nums">
              <span>8 000</span>
              <span>55 000</span>
              <span>110 000</span>
            </div>
          </div>

          {/* Sunken Excavation Depth (Amphithéâtre semi-enterré) */}
          <div className="space-y-1.5 p-3 rounded-lg bg-slate-950 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-200 font-medium">
                Encastrement dans le sol (semi-enterré)
              </span>
              <span className="font-mono tabular-nums text-emerald-400 font-semibold">
                {effectiveSunkenDepth > 0
                  ? `-${effectiveSunkenDepth.toFixed(1)} m`
                  : 'Au niveau du sol (0 m)'}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={15}
              step={0.5}
              value={effectiveSunkenDepth}
              onChange={(e) => setSunkenDepth(Number(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="text-[11px] text-slate-400 leading-snug">
              Creuse les gradins inférieurs sous un talus paysager et un parvis surélevé pour réduire la hauteur émergente.
            </div>
          </div>
        </div>

        {/* FIFA Pitch Dimensions */}
        <div
          className={
            isSidebar
              ? 'space-y-3 pt-4 border-t border-slate-800'
              : 'md:col-span-3 space-y-2.5'
          }
        >
          <span className="text-xs font-semibold text-slate-200 block">
            Dimensions du terrain FIFA
          </span>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300">Longueur terrain</span>
              <span className="font-mono tabular-nums text-slate-200">
                {doc.pitch.length} m
              </span>
            </div>
            <input
              type="range"
              min={95}
              max={115}
              step={1}
              value={doc.pitch.length}
              onChange={(e) => updatePitch({ length: Number(e.target.value) })}
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300">Largeur terrain</span>
              <span className="font-mono tabular-nums text-slate-200">
                {doc.pitch.width} m
              </span>
            </div>
            <input
              type="range"
              min={60}
              max={75}
              step={1}
              value={doc.pitch.width}
              onChange={(e) => updatePitch({ width: Number(e.target.value) })}
              className="w-full accent-emerald-500 cursor-pointer"
            />
          </div>
        </div>

        {/* Track, Corners & Turf Options */}
        <div
          className={
            isSidebar
              ? 'space-y-2.5 pt-4 border-t border-slate-800 text-xs'
              : 'md:col-span-3 space-y-2 text-xs'
          }
        >
          <span className="text-xs font-semibold text-slate-200 block">
            Options d’aire de jeu
          </span>

          <label className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700">
            <span className="text-slate-200">Piste d’athlétisme (8 couloirs)</span>
            <input
              type="checkbox"
              checked={doc.pitch.hasTrack}
              onChange={(e) => updatePitch({ hasTrack: e.target.checked })}
              className="accent-emerald-500 w-4 h-4"
            />
          </label>

          <label className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700">
            <span className="text-slate-200">Panneaux LED publicitaires</span>
            <input
              type="checkbox"
              checked={doc.pitch.adBoards}
              onChange={(e) => updatePitch({ adBoards: e.target.checked })}
              className="accent-emerald-500 w-4 h-4"
            />
          </label>

          {doc.shape === 'english_rectangular' && (
            <label className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-950 border border-slate-800 cursor-pointer hover:border-slate-700">
              <span className="text-slate-200">Virages dans les coins</span>
              <input
                type="checkbox"
                checked={doc.cornerFill}
                onChange={(e) => setCornerFill(e.target.checked)}
                className="accent-emerald-500 w-4 h-4"
              />
            </label>
          )}

          {doc.shape === 'compact_urban' && (
            <div className="px-3 py-2 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-emerald-200 text-[11px]">
              Virages d’angles étagés et tours d’accès urbaines activés automatiquement.
            </div>
          )}

          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800">
            <span className="text-slate-300">Motif de tonte</span>
            <select
              value={doc.pitch.grassPattern}
              onChange={(e) =>
                updatePitch({
                  grassPattern: e.target.value as 'stripes' | 'checker' | 'solid',
                })
              }
              className="bg-slate-900 text-slate-100 text-xs rounded px-2.5 py-1 border border-slate-700"
            >
              <option value="stripes">Bandes UEFA</option>
              <option value="checker">Damier</option>
              <option value="solid">Pelouse unie</option>
            </select>
          </div>
        </div>
      </div>
    );
  }

  if (section === 'stands') {
    return (
      <div className="space-y-4">
        {/* Stand Selector Bar */}
        <div className="space-y-2.5">
          <div className="grid grid-cols-4 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            {STAND_TABS.map((t) => {
              const st = doc.stands[t.id];
              const sm = metrics.stands[t.id];
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveStandTab(t.id)}
                  className={`px-1.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 flex flex-col items-center ${
                    activeStandTab === t.id
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>
                    {t.label} ({st.tiers} ét.)
                  </span>
                  <span
                    className={`text-[10px] font-mono tabular-nums ${
                      activeStandTab === t.id ? 'text-emerald-100' : 'text-slate-500'
                    }`}
                  >
                    {sm.enabled ? `${(sm.capacity / 1000).toFixed(1)}k pl.` : 'Off'}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <label className="flex items-center gap-2 text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={currentStand.enabled}
                onChange={(e) =>
                  updateStand(activeStandTab, { enabled: e.target.checked })
                }
                className="accent-emerald-500 w-4 h-4"
              />
              <span>Tribune active ({currentStand.name})</span>
            </label>

            <button
              type="button"
              onClick={() =>
                updateAllStands({
                  rows: currentStand.rows,
                  tiers: currentStand.tiers,
                  slopeAngleDeg: currentSlopeDeg,
                  rowDepth: currentStand.rowDepth,
                  riserHeight: currentStand.riserHeight,
                  seatWidth: currentStand.seatWidth,
                  distanceToPitch: currentStand.distanceToPitch,
                  aisleCount: currentStand.aisleCount,
                })
              }
              className="px-2.5 py-1 text-xs font-medium text-emerald-300 hover:text-emerald-200 bg-emerald-950/50 border border-emerald-500/30 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              Copier sur les 4 tribunes
            </button>
          </div>
        </div>

        {/* Profil des gradins: Mur Kop 1 niveau pleine hauteur, Loges VIP, Debout, Télescopique */}
        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-slate-200">
                Profil typologique de la tribune
              </div>
              <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                Hauteur crête : {currentStandMetrics.maxHeight.toFixed(1)} m
                {maxNeighbourHeight > 0
                  ? ` · Max autres tribunes : ${maxNeighbourHeight.toFixed(1)} m`
                  : ''}
              </div>
            </div>

            <button
              type="button"
              disabled={!currentStand.enabled}
              onClick={() => convertStandToKopWall(activeStandTab)}
              className="px-2.5 py-1.5 text-xs font-semibold text-amber-200 hover:text-amber-100 bg-amber-950/50 border border-amber-500/40 rounded-md transition-colors disabled:opacity-40"
            >
              Mur Kop 1 niveau (aligner hauteur max)
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
            {SEATING_TYPE_OPTIONS.map((stOpt) => {
              const active = (currentStand.seatingType ?? 'seated') === stOpt.id;
              return (
                <button
                  key={stOpt.id}
                  type="button"
                  disabled={!currentStand.enabled}
                  onClick={() =>
                    updateStand(activeStandTab, {
                      seatingType: stOpt.id,
                      ...(stOpt.id === 'telescopic' && currentStand.distanceToPitch < 8.5
                        ? { distanceToPitch: 10.5 }
                        : {}),
                    })
                  }
                  className={`p-2 rounded-lg border text-left transition-colors ${
                    active
                      ? 'bg-emerald-600/20 border-emerald-500 text-emerald-100'
                      : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                  } disabled:opacity-40`}
                >
                  <div className="text-xs font-semibold truncate">{stOpt.label}</div>
                  <div className="text-[10px] text-slate-400 line-clamp-2 mt-0.5 leading-snug">
                    {stOpt.desc}
                  </div>
                </button>
              );
            })}
          </div>

          {currentStand.tiers >= 2 && (
            <label className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 cursor-pointer hover:border-slate-700 text-xs">
              <span className="text-slate-200">
                Loges & salons VIP vitrés intercalés entre les anneaux
              </span>
              <input
                type="checkbox"
                disabled={!currentStand.enabled}
                checked={currentStand.vipLoges !== false}
                onChange={(e) =>
                  updateStand(activeStandTab, { vipLoges: e.target.checked })
                }
                className="accent-emerald-500 w-4 h-4"
              />
            </label>
          )}

          {!isContinuousBowlShape(doc.shape) && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs">
              <span className="text-slate-300">Toiture propre à cette tribune</span>
              <select
                disabled={!currentStand.enabled}
                value={currentStand.roofStyleOverride ?? 'inherit'}
                onChange={(e) =>
                  updateStand(activeStandTab, {
                    roofStyleOverride:
                      e.target.value === 'inherit'
                        ? undefined
                        : (e.target.value as RoofStyle),
                  })
                }
                className="bg-slate-950 text-slate-100 text-xs rounded px-2 py-1 border border-slate-700 max-w-[190px]"
              >
                <option value="inherit">Identique au stade global</option>
                <option value="cantilever">Porte-à-faux (cantilever)</option>
                <option value="column_supported">Sur poteaux dans gradins</option>
                <option value="goalpost_truss">Poutre-portique (goalpost)</option>
                <option value="truss">Charpente treillis & frontons</option>
                <option value="none">Découvert (sans toit)</option>
              </select>
            </div>
          )}
        </div>

        {/* Highlighted Controls: Nombre d'étages (1–5) + Inclinaison (°) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Number of Tiers (Étages 1–5) per Stand */}
          <div className="space-y-1.5 p-3 rounded-lg bg-slate-950 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-200 font-semibold">Nombre d’anneaux</span>
              <span className="font-mono tabular-nums text-emerald-400 font-semibold">
                {currentStand.tiers} {currentStand.tiers > 1 ? 'anneaux' : 'seul niveau'}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-1 pt-0.5">
              {TIER_OPTIONS.map((tierNum) => (
                <button
                  key={tierNum}
                  type="button"
                  disabled={!currentStand.enabled}
                  onClick={() => updateStand(activeStandTab, { tiers: tierNum })}
                  className={`py-1.5 text-xs font-semibold rounded-md border transition-colors ${
                    currentStand.tiers === tierNum
                      ? 'bg-emerald-600 border-emerald-500 text-white'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
                  } disabled:opacity-40`}
                >
                  {tierNum}
                </button>
              ))}
            </div>
          </div>

          {/* Direct Inclination Angle Slider (18° to 38°) */}
          <div className="space-y-1.5 p-3 rounded-lg bg-slate-950 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-200 font-semibold">Inclinaison (pente)</span>
              <span className="font-mono tabular-nums text-emerald-400 font-semibold">
                {currentSlopeDeg.toFixed(1)}°
              </span>
            </div>
            <input
              type="range"
              min={18}
              max={38}
              step={0.5}
              disabled={!currentStand.enabled}
              value={currentSlopeDeg}
              onChange={(e) =>
                updateStand(activeStandTab, {
                  slopeAngleDeg: Number(e.target.value),
                })
              }
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono tabular-nums">
              <span>18° douce</span>
              <span>28° FIFA</span>
              <span>37° mur vertical</span>
            </div>
          </div>
        </div>

        {/* Fine Geometry Sliders */}
        <div
          className={
            isSidebar
              ? 'grid grid-cols-1 sm:grid-cols-2 gap-3'
              : 'grid grid-cols-2 md:grid-cols-5 gap-3 items-start'
          }
        >
          <div className="space-y-1 p-2.5 rounded-lg bg-slate-950 border border-slate-800">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300">Rangées totales</span>
              <span className="font-mono tabular-nums text-slate-100 font-semibold">
                {currentStand.rows} (~{Math.round(currentStand.rows / currentStand.tiers)}/ét.)
              </span>
            </div>
            <input
              type="range"
              min={8}
              max={108}
              step={1}
              disabled={!currentStand.enabled}
              value={currentStand.rows}
              onChange={(e) =>
                updateStand(activeStandTab, { rows: Number(e.target.value) })
              }
              className="w-full accent-emerald-500"
            />
          </div>

          <div className="space-y-1 p-2.5 rounded-lg bg-slate-950 border border-slate-800">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300">Distance terrain</span>
              <span className="font-mono tabular-nums text-slate-100">
                {currentStand.distanceToPitch.toFixed(1)} m
              </span>
            </div>
            <input
              type="range"
              min={4.5}
              max={20}
              step={0.5}
              disabled={!currentStand.enabled}
              value={currentStand.distanceToPitch}
              onChange={(e) =>
                updateStand(activeStandTab, { distanceToPitch: Number(e.target.value) })
              }
              className="w-full accent-emerald-500"
            />
          </div>

          <div className="space-y-1 p-2.5 rounded-lg bg-slate-950 border border-slate-800">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300">Profondeur rangée</span>
              <span className="font-mono tabular-nums text-slate-100">
                {Math.round(currentStand.rowDepth * 100)} cm
              </span>
            </div>
            <input
              type="range"
              min={0.72}
              max={0.95}
              step={0.01}
              disabled={!currentStand.enabled}
              value={currentStand.rowDepth}
              onChange={(e) =>
                updateStand(activeStandTab, { rowDepth: Number(e.target.value) })
              }
              className="w-full accent-emerald-500"
            />
          </div>

          <div className="space-y-1 p-2.5 rounded-lg bg-slate-950 border border-slate-800">
            <div className="flex justify-between text-xs">
              <span className="text-slate-300">Largeur de siège</span>
              <span className="font-mono tabular-nums text-slate-100">
                {Math.round(currentStand.seatWidth * 100)} cm
              </span>
            </div>
            <input
              type="range"
              min={0.46}
              max={0.62}
              step={0.01}
              disabled={!currentStand.enabled}
              value={currentStand.seatWidth}
              onChange={(e) =>
                updateStand(activeStandTab, { seatWidth: Number(e.target.value) })
              }
              className="w-full accent-emerald-500"
            />
          </div>

          <div className="space-y-1 p-2.5 rounded-lg bg-slate-950 border border-slate-800 sm:col-span-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">Nombre d’allées d’escaliers & vomitoires</span>
              <span className="font-mono tabular-nums text-slate-100">
                {currentStand.aisleCount} allées (marche {Math.round(currentStand.riserHeight * 100)} cm)
              </span>
            </div>
            <input
              type="range"
              min={2}
              max={14}
              step={1}
              disabled={!currentStand.enabled}
              value={currentStand.aisleCount}
              onChange={(e) =>
                updateStand(activeStandTab, {
                  aisleCount: Number(e.target.value),
                })
              }
              className="w-full accent-emerald-500"
            />
          </div>
        </div>

        {/* Sightline C-Value & Multi-Tier Cross-Section SVG */}
        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300 font-mono tabular-nums">
            <span className="text-emerald-400 font-semibold">
              {currentStandMetrics.capacity.toLocaleString('fr-FR')} pl. (~{currentStandMetrics.seatsPerRow}/rg)
            </span>
            <span aria-hidden="true">·</span>
            <span>{currentStand.tiers} ét.</span>
            <span aria-hidden="true">·</span>
            <span>{currentStandMetrics.slopeDegrees}°</span>
            <span aria-hidden="true">·</span>
            <span>H {currentStandMetrics.maxHeight} m</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-400">
              <div>
                C-Value min :{' '}
                <span className="text-slate-100 font-mono tabular-nums font-semibold">
                  {sightlineDetails.minCValueMm} mm
                </span>
              </div>
              <div>
                Visibilité FIFA :{' '}
                <span className="text-emerald-300 font-medium">
                  {sightlineDetails.grade} (moy. {sightlineDetails.avgCValueMm} mm)
                </span>
              </div>
            </div>

            <svg
              width="170"
              height="52"
              viewBox="0 0 170 52"
              className="shrink-0 bg-slate-900 rounded border border-slate-800 px-1"
              aria-label="Profil géométrique multi-étages de la tribune"
            >
              <line x1="6" y1="46" x2="34" y2="46" stroke="#10b981" strokeWidth="2.2" />
              {sightlineDetails.points.length > 1 && (
                <>
                  {[1, 2, 3, 4, 5].map((tNum) => {
                    const tierPts = sightlineDetails.points.filter((p) => p.tier === tNum);
                    if (tierPts.length === 0) return null;
                    return (
                      <polyline
                        key={tNum}
                        fill="none"
                        stroke={tNum % 2 === 1 ? '#e2e8f0' : '#38bdf8'}
                        strokeWidth="1.8"
                        points={tierPts
                          .map((pt) => {
                            const x = 34 + Math.min(130, pt.distanceX * 1.45);
                            const y = Math.max(4, 46 - pt.eyeHeightY * 0.72);
                            return `${x.toFixed(1)},${y.toFixed(1)}`;
                          })
                          .join(' ')}
                      />
                    );
                  })}
                  {(() => {
                    const last = sightlineDetails.points[sightlineDetails.points.length - 1];
                    const lx = 34 + Math.min(130, last.distanceX * 1.45);
                    const ly = Math.max(4, 46 - last.eyeHeightY * 0.72);
                    return (
                      <line
                        x1={lx}
                        y1={ly}
                        x2="32"
                        y2="46"
                        stroke="#10b981"
                        strokeWidth="0.9"
                        strokeDasharray="2 2"
                      />
                    );
                  })()}
                </>
              )}
            </svg>
          </div>
        </div>
      </div>
    );
  }

  if (section === 'roof_colors') {
    return (
      <div
        className={
          isSidebar
            ? 'space-y-5'
            : 'grid grid-cols-1 md:grid-cols-12 gap-5 items-start'
        }
      >
        {/* Roof Parameters */}
        <div className={isSidebar ? 'space-y-3' : 'md:col-span-6 space-y-2.5'}>
          <span className="text-xs font-semibold text-slate-200 block">
            Système de couverture & toiture
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ROOF_OPTIONS.map((ro) => (
              <button
                key={ro.id}
                type="button"
                onClick={() => updateRoof({ style: ro.id })}
                className={`p-2.5 rounded-lg border text-left transition-colors ${
                  doc.roof.style === ro.id
                    ? 'bg-emerald-600/20 border-emerald-500 text-emerald-100'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <div className="text-xs font-semibold truncate">{ro.label}</div>
                <div className="text-[11px] text-slate-400 truncate mt-0.5">
                  {ro.desc}
                </div>
              </button>
            ))}
          </div>

          {doc.roof.style === 'retractable' && (
            <label className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-950 border border-emerald-500/40 cursor-pointer hover:border-emerald-400 text-xs">
              <span className="text-slate-100 font-medium">
                Fermer les panneaux du toit rétractable
              </span>
              <input
                type="checkbox"
                checked={Boolean(doc.roof.retractableClosed)}
                onChange={(e) =>
                  updateRoof({ retractableClosed: e.target.checked })
                }
                className="accent-emerald-500 w-4 h-4"
              />
            </label>
          )}

          <div className="space-y-3 p-3 rounded-lg bg-slate-950 border border-slate-800">
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300">Hauteur libre au-dessus des gradins</span>
                <span className="font-mono tabular-nums text-slate-200">
                  +{doc.roof.heightOffset.toFixed(1)} m
                </span>
              </div>
              <input
                type="range"
                min={2}
                max={12}
                step={0.5}
                disabled={doc.roof.style === 'none'}
                value={doc.roof.heightOffset}
                onChange={(e) => updateRoof({ heightOffset: Number(e.target.value) })}
                className="w-full accent-emerald-500"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300">Taux de couverture des sièges</span>
                <span className="font-mono tabular-nums text-slate-200">
                  {Math.round(doc.roof.coverageRatio * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.55}
                max={1.15}
                step={0.05}
                disabled={doc.roof.style === 'none' || doc.roof.style === 'fixed_dome'}
                value={doc.roof.coverageRatio}
                onChange={(e) => updateRoof({ coverageRatio: Number(e.target.value) })}
                className="w-full accent-emerald-500"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300">Opacité de la membrane</span>
                <span className="font-mono tabular-nums text-slate-200">
                  {Math.round(doc.roof.opacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={1}
                step={0.05}
                disabled={doc.roof.style === 'none'}
                value={doc.roof.opacity}
                onChange={(e) => updateRoof({ opacity: Number(e.target.value) })}
                className="w-full accent-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* PBR Architectural Materials & Envelope Typologies */}
        <div
          className={
            isSidebar
              ? 'space-y-4 pt-4 border-t border-slate-800'
              : 'md:col-span-6 space-y-4'
          }
        >
          {/* 0. Exterior Envelope & Facade Architecture */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">
                Architecture d’enveloppe & sous-face
              </span>
              <span className="text-[11px] text-slate-400">
                {ENVELOPE_STYLE_CATALOG.length} typologies
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {ENVELOPE_STYLE_CATALOG.map((envOpt) => {
                const active =
                  (resolvedMaterials.envelopeStyle ?? 'enveloping_skin') === envOpt.id;
                return (
                  <button
                    key={envOpt.id}
                    type="button"
                    onClick={() => updateMaterials({ envelopeStyle: envOpt.id })}
                    className={`p-2 rounded-lg border text-left transition-colors ${
                      active
                        ? 'bg-emerald-600/20 border-emerald-500 text-emerald-100'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="text-xs font-semibold truncate">{envOpt.label}</div>
                    <div className="text-[10px] text-slate-400 line-clamp-2 mt-0.5 leading-snug">
                      {envOpt.subtitle}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 1. Exterior Facade Cladding */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">
                Matériau & vêture de façade
              </span>
              <span className="text-[11px] text-slate-400">Texture PBR + relief</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {FACADE_MATERIAL_CATALOG.map((item) => {
                const active = resolvedMaterials.facade === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => updateMaterials({ facade: item.id })}
                    className={`flex items-center gap-2.5 p-2 rounded-lg border text-left transition-colors ${
                      active
                        ? 'bg-emerald-600/20 border-emerald-500 text-emerald-100'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <MaterialSwatchSvg materialId={item.id} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">{item.label}</div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {item.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Roof Cladding Membrane / Glazing / Metal */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">
                Couverture de toiture
              </span>
              <span className="text-[11px] text-slate-400">Translucidité & joints</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {ROOF_MATERIAL_CATALOG.map((item) => {
                const active = resolvedMaterials.roof === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => updateMaterials({ roof: item.id })}
                    className={`flex items-center gap-2.5 p-2 rounded-lg border text-left transition-colors ${
                      active
                        ? 'bg-emerald-600/20 border-emerald-500 text-emerald-100'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <MaterialSwatchSvg materialId={item.id} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">{item.label}</div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {item.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Primary Structural Framing */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">
                Charpente & ossature porteuse
              </span>
              <span className="text-[11px] text-slate-400">Acier, Corten ou Bois</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {STRUCTURE_MATERIAL_CATALOG.map((item) => {
                const active = resolvedMaterials.structure === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => updateMaterials({ structure: item.id })}
                    className={`flex items-center gap-2.5 p-2 rounded-lg border text-left transition-colors ${
                      active
                        ? 'bg-emerald-600/20 border-emerald-500 text-emerald-100'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <MaterialSwatchSvg materialId={item.id} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">{item.label}</div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {item.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Seating Shells & Club Textile Harmonies */}
          <div className="space-y-2.5 p-3 rounded-lg bg-slate-950 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200">
                Sellerie & coques des gradins 3D
              </span>
              <span className="text-[11px] text-slate-400">Relief par siège</span>
            </div>

            <div className="grid grid-cols-1 gap-1.5">
              {SEAT_MATERIAL_CATALOG.map((item) => {
                const active = resolvedMaterials.seatFinish === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => updateMaterials({ seatFinish: item.id })}
                    className={`flex items-center gap-2.5 p-2 rounded-lg border text-left transition-colors ${
                      active
                        ? 'bg-emerald-600/20 border-emerald-500 text-emerald-100'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <MaterialSwatchSvg materialId={item.id} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">{item.label}</div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {item.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="pt-1 space-y-1.5">
              <span className="text-[11px] text-slate-400 block">
                Harmonies textiles des sièges :
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {SEAT_CLUB_PALETTES.map((pal) => {
                  const isCurrent =
                    doc.colors.seatsPrimary.toLowerCase() === pal.primary.toLowerCase() &&
                    doc.colors.seatsSecondary.toLowerCase() === pal.secondary.toLowerCase();
                  return (
                    <button
                      key={pal.id}
                      type="button"
                      onClick={() =>
                        updateColors({
                          seatsPrimary: pal.primary,
                          seatsSecondary: pal.secondary,
                        })
                      }
                      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-[11px] transition-colors ${
                        isCurrent
                          ? 'bg-emerald-600/20 border-emerald-500 text-emerald-100'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <PaletteChipSvg primary={pal.primary} secondary={pal.secondary} />
                      <span className="truncate">{pal.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <label className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-slate-900 border border-slate-800 cursor-pointer text-[11px] text-slate-300">
                  <span className="truncate">Teinte coque 1</span>
                  <input
                    type="color"
                    value={doc.colors.seatsPrimary}
                    onChange={(e) => updateColors({ seatsPrimary: e.target.value })}
                    className="w-6 h-5 rounded cursor-pointer bg-transparent border-0 shrink-0"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-slate-900 border border-slate-800 cursor-pointer text-[11px] text-slate-300">
                  <span className="truncate">Teinte motif 2</span>
                  <input
                    type="color"
                    value={doc.colors.seatsSecondary}
                    onChange={(e) => updateColors({ seatsSecondary: e.target.value })}
                    className="w-6 h-5 rounded cursor-pointer bg-transparent border-0 shrink-0"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* 5. Turf, Track & Mineral Esplanade Surfaces */}
          <div className="space-y-3 p-3 rounded-lg bg-slate-950 border border-slate-800">
            <div className="space-y-1.5">
              <span className="text-xs font-semibold text-slate-200 block">
                Surface agronomique de la pelouse
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {TURF_MATERIAL_CATALOG.map((item) => {
                  const active = resolvedMaterials.pitchTurf === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => updateMaterials({ pitchTurf: item.id })}
                      className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-colors ${
                        active
                          ? 'bg-emerald-600/20 border-emerald-500 text-emerald-100'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <MaterialSwatchSvg materialId={item.id} />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold truncate">{item.label}</div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {item.subtitle}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
              <span className="text-xs font-semibold text-slate-200 block">
                Revêtement piste & abords techniques
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {TRACK_MATERIAL_CATALOG.map((item) => {
                  const active = resolvedMaterials.trackSurface === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => updateMaterials({ trackSurface: item.id })}
                      className={`flex items-center gap-2 p-1.5 rounded-lg border text-left transition-colors ${
                        active
                          ? 'bg-emerald-600/20 border-emerald-500 text-emerald-100'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <MaterialSwatchSvg materialId={item.id} />
                      <span className="text-[11px] font-medium truncate">
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
              <span className="text-xs font-semibold text-slate-200 block">
                Sol minéral du parvis extérieur
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                {PLAZA_MATERIAL_CATALOG.map((item) => {
                  const active = resolvedMaterials.plazaSurface === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => updateMaterials({ plazaSurface: item.id })}
                      className={`flex items-center gap-2 p-1.5 rounded-lg border text-left transition-colors ${
                        active
                          ? 'bg-emerald-600/20 border-emerald-500 text-emerald-100'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      <MaterialSwatchSvg materialId={item.id} />
                      <span className="text-[11px] font-medium truncate">
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

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
import { ObjectList } from './ObjectList';
import { ProjectsPanel } from './ProjectsPanel';
import type { EditorNode } from './StructureTree';
import {
  Button,
  FieldRow,
  OptionList,
  PanelSection,
  Segmented,
  SelectField,
  SliderField,
  Switch,
  ToggleField,
} from './ui';

export const SHAPE_OPTIONS: { id: StadiumShape; label: string; desc: string }[] = [
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

export const ROOF_OPTIONS: { id: RoofStyle; label: string; desc: string }[] = [
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
          <rect width="40" height="28" fill="#94a3b8" />
          <polygon points="0,0 28,0 12,28 0,28" fill="#e2e8f0" opacity="0.65" />
          {[4, 8, 12, 16, 20, 24].map((y) => (
            <line key={y} x1="0" y1={y} x2="40" y2={y} stroke="#1e293b" strokeWidth="1.2" opacity="0.55" />
          ))}
        </svg>
      );
    case 'architectural_concrete':
      return (
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
          <rect width="40" height="28" fill="#7c2d12" />
          <circle cx="12" cy="10" r="10" fill="#c2410c" opacity="0.65" />
          <circle cx="30" cy="20" r="9" fill="#431407" opacity="0.6" />
          <line x1="14" y1="0" x2="14" y2="28" stroke="#291509" strokeWidth="1.2" />
          <line x1="28" y1="0" x2="28" y2="28" stroke="#291509" strokeWidth="1.2" />
        </svg>
      );
    case 'heritage_brick':
      return (
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
          <rect width="40" height="28" fill="#e2e8f0" />
          <polygon points="0,0 32,0 16,28 0,28" fill="#ffffff" opacity="0.85" />
          <line x1="14" y1="0" x2="14" y2="28" stroke="#94a3b8" strokeWidth="1" />
          <line x1="28" y1="0" x2="28" y2="28" stroke="#94a3b8" strokeWidth="1" />
        </svg>
      );
    case 'etfe_cushions':
    case 'etfe_cushions_facade':
      return (
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
          <rect width="40" height="28" fill="#38bdf8" />
          <polygon points="20,2 37,14 20,26 3,14" fill="#f0f9ff" stroke="#1e293b" strokeWidth="1.2" />
          <ellipse cx="20" cy="14" rx="8" ry="5" fill="#bae6fd" opacity="0.7" />
        </svg>
      );
    case 'polycarbonate_glass':
      return (
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
          <rect width="40" height="28" fill="#38bdf8" opacity="0.45" />
          <polygon points="0,0 24,0 8,28 0,28" fill="#e0f2fe" opacity="0.7" />
          {[8, 16, 24, 32].map((x) => (
            <line key={x} x1={x} y1="0" x2={x} y2="28" stroke="#1e293b" strokeWidth="1.2" />
          ))}
        </svg>
      );
    case 'standing_seam_zinc':
      return (
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
          <rect width="40" height="28" fill="#1e293b" />
          <polygon points="0,0 22,0 10,28 0,28" fill="#475569" opacity="0.55" />
          <circle cx="28" cy="10" r="1" fill="#94a3b8" opacity="0.5" />
          <circle cx="16" cy="20" r="1" fill="#94a3b8" opacity="0.5" />
        </svg>
      );
    case 'molded_poly_mosaic':
      return (
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
          <rect width="40" height="28" fill="#1e3a8a" />
          {[4, 13, 22, 31].map((x) => (
            <rect key={x} x={x} y="4" width="6" height="20" rx="2" fill="#3b82f6" />
          ))}
          <rect x="0" y="12" width="40" height="4" fill="#f8fafc" opacity="0.85" />
        </svg>
      );
    case 'padded_club_velvet':
      return (
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
          <rect width="40" height="28" fill={fill} />
          {[7, 14, 21].map((y) => (
            <line key={y} x1="0" y1={y} x2="40" y2={y} stroke="#f8fafc" strokeWidth="0.9" opacity="0.85" />
          ))}
        </svg>
      );
    }
    default:
      return (
        <svg viewBox="0 0 40 28" aria-hidden className="w-7 h-5 rounded-sm shrink-0">
          <rect width="40" height="28" fill="#475569" />
          <line x1="13" y1="0" x2="13" y2="28" stroke="#cbd5e1" strokeWidth="0.8" opacity="0.4" />
          <line x1="27" y1="0" x2="27" y2="28" stroke="#cbd5e1" strokeWidth="0.8" opacity="0.4" />
          <line x1="0" y1="14" x2="40" y2="14" stroke="#cbd5e1" strokeWidth="0.8" opacity="0.4" />
        </svg>
      );
  }
};

const SeatPaletteChip: React.FC<{ primary: string; secondary: string }> = ({
  primary,
  secondary,
}) => (
  <svg viewBox="0 0 24 24" aria-hidden className="w-4 h-4 rounded-full shrink-0">
    <path d="M0,0 L24,0 L0,24 Z" fill={primary} />
    <path d="M24,0 L24,24 L0,24 Z" fill={secondary} />
  </svg>
);

const ColorField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
}> = ({ label, value, onChange }) => (
  <FieldRow label={label}>
    <span className="text-2xs text-ink-faint uppercase tabular-nums">{value}</span>
    <input
      type="color"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-6 h-6 p-0 rounded border border-line-strong bg-transparent cursor-pointer"
    />
  </FieldRow>
);

const PanelHeader: React.FC<{ title: string; meta?: React.ReactNode; action?: React.ReactNode }> = ({
  title,
  meta,
  action,
}) => (
  <div className="flex items-center gap-3 h-12 px-4 border-b border-line">
    <div className="flex-1 min-w-0">
      <h2 className="text-sm font-semibold text-ink truncate">{title}</h2>
      {meta && <div className="text-2xs text-ink-faint tabular-nums truncate">{meta}</div>}
    </div>
    {action}
  </div>
);

const STAND_LABELS: Record<StandSide, string> = {
  north: 'Nord',
  south: 'Sud',
  east: 'Est',
  west: 'Ouest',
};

const STAND_ROOF_OVERRIDES: { id: RoofStyle | 'inherit'; label: string }[] = [
  { id: 'inherit', label: 'Comme le stade' },
  { id: 'cantilever', label: 'Porte-à-faux' },
  { id: 'column_supported', label: 'Sur poteaux' },
  { id: 'goalpost_truss', label: 'Poutre-portique' },
  { id: 'truss', label: 'Charpente treillis' },
  { id: 'none', label: 'Découverte' },
];

const fr = (n: number) => n.toLocaleString('fr-FR');
const fr1 = (n: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const BowlInspector: React.FC = () => {
  const doc = useStadiumStore((s) => s.doc);
  const setShape = useStadiumStore((s) => s.setShape);
  const setSunkenDepth = useStadiumStore((s) => s.setSunkenDepth);
  const setCornerFill = useStadiumStore((s) => s.setCornerFill);
  const updatePitch = useStadiumStore((s) => s.updatePitch);
  const applyTargetCapacity = useStadiumStore((s) => s.applyTargetCapacity);
  const metrics = useMemo(() => calculateStadiumMetrics(doc), [doc]);
  const sunken = getEffectiveSunkenDepth(doc);

  return (
    <>
      <PanelHeader title="Enceinte et terrain" meta={`${fr(metrics.totalCapacity)} places`} />
      <PanelSection title="Forme">
        <OptionList
          label="Forme de l’enceinte"
          value={doc.shape}
          onChange={setShape}
          options={SHAPE_OPTIONS.map((o) => ({ id: o.id, label: o.label, detail: o.desc }))}
        />
      </PanelSection>
      <PanelSection title="Capacité">
        <SliderField
          label="Capacité visée"
          hint="Ajuste les rangs de toutes les tribunes pour approcher ce total"
          min={8000}
          max={110000}
          step={1000}
          value={Math.min(110000, metrics.totalCapacity)}
          display={`${fr(metrics.totalCapacity)} places`}
          onChange={applyTargetCapacity}
        />
        <SliderField
          label="Enfouissement"
          hint="Creuse les gradins bas sous un talus pour réduire la hauteur visible"
          min={0}
          max={15}
          step={0.5}
          value={sunken}
          display={sunken > 0 ? `−${fr1(sunken)} m` : 'Au niveau du sol'}
          onChange={setSunkenDepth}
        />
      </PanelSection>
      <PanelSection title="Terrain">
        <SliderField
          label="Longueur"
          min={95}
          max={115}
          step={1}
          value={doc.pitch.length}
          display={`${doc.pitch.length} m`}
          onChange={(v) => updatePitch({ length: v })}
        />
        <SliderField
          label="Largeur"
          min={60}
          max={75}
          step={1}
          value={doc.pitch.width}
          display={`${doc.pitch.width} m`}
          onChange={(v) => updatePitch({ width: v })}
        />
        <SelectField
          label="Motif de tonte"
          value={doc.pitch.grassPattern}
          onChange={(v) => updatePitch({ grassPattern: v })}
          options={[
            { id: 'stripes', label: 'Bandes' },
            { id: 'checker', label: 'Damier' },
            { id: 'solid', label: 'Uni' },
          ]}
        />
        <ToggleField
          label="Piste d’athlétisme"
          checked={doc.pitch.hasTrack}
          onChange={(v) => updatePitch({ hasTrack: v })}
        />
        <ToggleField
          label="Panneaux LED publicitaires"
          checked={doc.pitch.adBoards}
          onChange={(v) => updatePitch({ adBoards: v })}
        />
        {doc.shape === 'english_rectangular' && (
          <ToggleField label="Virages dans les coins" checked={doc.cornerFill} onChange={setCornerFill} />
        )}
        {doc.shape === 'compact_urban' && (
          <p className="text-2xs text-ink-faint">
            Les coins sont fermés par des virages étagés et des tours d’accès.
          </p>
        )}
      </PanelSection>
    </>
  );
};

const SightlineProfile: React.FC<{
  points: ReturnType<typeof computeStandSightlines>['points'];
}> = ({ points }) => {
  if (points.length < 2) return null;
  const toXY = (p: (typeof points)[number]) => {
    const x = 34 + Math.min(220, p.distanceX * 2.2);
    const y = Math.max(4, 66 - p.eyeHeightY * 1.05);
    return [x, y] as const;
  };
  const last = toXY(points[points.length - 1]);
  return (
    <svg
      viewBox="0 0 264 72"
      className="w-full h-auto rounded bg-canvas"
      role="img"
      aria-label="Coupe de la tribune et ligne de vue la plus haute"
    >
      <line x1="6" y1="66" x2="34" y2="66" stroke="var(--color-ink-faint)" strokeWidth="2" />
      {[1, 2, 3, 4, 5].map((tier) => {
        const tierPts = points.filter((p) => p.tier === tier);
        if (tierPts.length === 0) return null;
        return (
          <polyline
            key={tier}
            fill="none"
            stroke={tier % 2 === 1 ? 'var(--color-ink)' : 'var(--color-accent-ink)'}
            strokeWidth="1.6"
            points={tierPts.map((p) => toXY(p).join(',')).join(' ')}
          />
        );
      })}
      <line
        x1={last[0]}
        y1={last[1]}
        x2="32"
        y2="66"
        stroke="var(--color-ink-faint)"
        strokeWidth="0.9"
        strokeDasharray="3 3"
      />
    </svg>
  );
};

const StandInspector: React.FC = () => {
  const doc = useStadiumStore((s) => s.doc);
  const side = useStadiumStore((s) => s.activeStandTab);
  const updateStand = useStadiumStore((s) => s.updateStand);
  const updateAllStands = useStadiumStore((s) => s.updateAllStands);
  const convertStandToKopWall = useStadiumStore((s) => s.convertStandToKopWall);
  const metrics = useMemo(() => calculateStadiumMetrics(doc), [doc]);

  const stand = doc.stands[side];
  const sm = metrics.stands[side];
  const roofStyle = resolveStandRoofStyle(doc, side);
  const slope = stand.slopeAngleDeg ?? slopeDegFromRiser(stand.riserHeight, stand.rowDepth);
  const off = !stand.enabled;

  const sightlines = useMemo(
    () =>
      computeStandSightlines(
        stand,
        doc.pitch.hasTrack ? doc.pitch.trackLanes * 1.22 + 2.5 : 0,
        roofStyle
      ),
    [stand, doc.pitch.hasTrack, doc.pitch.trackLanes, roofStyle]
  );

  const tallestOther = (['north', 'south', 'east', 'west'] as StandSide[])
    .filter((s) => s !== side && metrics.stands[s].enabled)
    .reduce((max, s) => Math.max(max, metrics.stands[s].maxHeight), 0);

  return (
    <>
      <PanelHeader
        title={`Tribune ${STAND_LABELS[side]}`}
        meta={
          off
            ? 'Désactivée'
            : `${fr(sm.capacity)} places · ${sm.seatsPerRow} par rang · ${fr1(sm.maxHeight)} m de haut`
        }
        action={
          <Switch
            label="Tribune active"
            checked={stand.enabled}
            onChange={(v) => updateStand(side, { enabled: v })}
          />
        }
      />
      <PanelSection title="Profil">
        <FieldRow label="Niveaux">
          <Segmented
            label="Nombre de niveaux"
            size="sm"
            disabled={off}
            value={stand.tiers}
            onChange={(t) => updateStand(side, { tiers: t })}
            options={TIER_OPTIONS.map((t) => ({ id: t, label: String(t) }))}
          />
        </FieldRow>
        <SliderField
          label="Pente"
          hint="28° est la norme courante ; au-delà de 35° la tribune devient un mur"
          min={18}
          max={38}
          step={0.5}
          disabled={off}
          value={slope}
          display={`${fr1(slope)}°`}
          onChange={(v) => updateStand(side, { slopeAngleDeg: v })}
        />
        <SliderField
          label="Rangs"
          min={8}
          max={108}
          step={1}
          disabled={off}
          value={stand.rows}
          display={`${stand.rows} · ${Math.round(stand.rows / stand.tiers)} par niveau`}
          onChange={(v) => updateStand(side, { rows: v })}
        />
        <SliderField
          label="Recul par rapport au terrain"
          min={4.5}
          max={20}
          step={0.5}
          disabled={off}
          value={stand.distanceToPitch}
          display={`${fr1(stand.distanceToPitch)} m`}
          onChange={(v) => updateStand(side, { distanceToPitch: v })}
        />
      </PanelSection>
      <PanelSection title="Places">
        <OptionList
          label="Type de places"
          disabled={off}
          value={stand.seatingType ?? 'seated'}
          onChange={(id) =>
            updateStand(side, {
              seatingType: id,
              ...(id === 'telescopic' && stand.distanceToPitch < 8.5 ? { distanceToPitch: 10.5 } : {}),
            })
          }
          options={SEATING_TYPE_OPTIONS.map((o) => ({ id: o.id, label: o.label, detail: o.desc }))}
        />
        {stand.tiers >= 2 && (
          <ToggleField
            label="Loges VIP entre les niveaux"
            disabled={off}
            checked={stand.vipLoges !== false}
            onChange={(v) => updateStand(side, { vipLoges: v })}
          />
        )}
        {!isContinuousBowlShape(doc.shape) && (
          <SelectField
            label="Toiture de cette tribune"
            disabled={off}
            value={stand.roofStyleOverride ?? 'inherit'}
            onChange={(v) =>
              updateStand(side, { roofStyleOverride: v === 'inherit' ? undefined : v })
            }
            options={STAND_ROOF_OVERRIDES}
          />
        )}
      </PanelSection>
      <PanelSection title="Lignes de vue">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-ink-muted">C-value minimale</span>
          <span className="text-ink tabular-nums">{sightlines.minCValueMm} mm</span>
        </div>
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-ink-muted">Visibilité</span>
          <span className="text-ink">
            {sightlines.grade}
            <span className="text-ink-faint tabular-nums"> · moy. {sightlines.avgCValueMm} mm</span>
          </span>
        </div>
        <SightlineProfile points={sightlines.points} />
      </PanelSection>
      <PanelSection title="Avancé" defaultOpen={false}>
        <SliderField
          label="Profondeur de rang"
          min={0.72}
          max={0.95}
          step={0.01}
          disabled={off}
          value={stand.rowDepth}
          display={`${Math.round(stand.rowDepth * 100)} cm`}
          scale={100}
          onChange={(v) => updateStand(side, { rowDepth: v })}
        />
        <SliderField
          label="Largeur de siège"
          min={0.46}
          max={0.62}
          step={0.01}
          disabled={off}
          value={stand.seatWidth}
          display={`${Math.round(stand.seatWidth * 100)} cm`}
          scale={100}
          onChange={(v) => updateStand(side, { seatWidth: v })}
        />
        <SliderField
          label="Allées et vomitoires"
          min={2}
          max={14}
          step={1}
          disabled={off}
          value={stand.aisleCount}
          display={`${stand.aisleCount} · marche ${Math.round(stand.riserHeight * 100)} cm`}
          onChange={(v) => updateStand(side, { aisleCount: v })}
        />
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            disabled={off}
            onClick={() =>
              updateAllStands({
                rows: stand.rows,
                tiers: stand.tiers,
                slopeAngleDeg: slope,
                rowDepth: stand.rowDepth,
                riserHeight: stand.riserHeight,
                seatWidth: stand.seatWidth,
                distanceToPitch: stand.distanceToPitch,
                aisleCount: stand.aisleCount,
              })
            }
          >
            Appliquer aux 4 tribunes
          </Button>
          <Button
            disabled={off}
            title={
              tallestOther > 0
                ? `Un seul niveau monté jusqu’à ${fr1(tallestOther)} m, la hauteur de la plus haute tribune`
                : 'Un seul niveau pleine hauteur'
            }
            onClick={() => convertStandToKopWall(side)}
          >
            Transformer en kop
          </Button>
        </div>
      </PanelSection>
    </>
  );
};

const RoofInspector: React.FC = () => {
  const roof = useStadiumStore((s) => s.doc.roof);
  const updateRoof = useStadiumStore((s) => s.updateRoof);
  const none = roof.style === 'none';

  return (
    <>
      <PanelHeader title="Toiture" meta={ROOF_OPTIONS.find((o) => o.id === roof.style)?.label} />
      <PanelSection title="Système">
        <OptionList
          label="Système de toiture"
          value={roof.style}
          onChange={(style) => updateRoof({ style })}
          options={ROOF_OPTIONS.map((o) => ({ id: o.id, label: o.label, detail: o.desc }))}
        />
        {roof.style === 'retractable' && (
          <ToggleField
            label="Panneaux fermés"
            checked={Boolean(roof.retractableClosed)}
            onChange={(v) => updateRoof({ retractableClosed: v })}
          />
        )}
      </PanelSection>
      <PanelSection title="Dimensions">
        <SliderField
          label="Hauteur au-dessus des gradins"
          min={2}
          max={12}
          step={0.5}
          disabled={none}
          value={roof.heightOffset}
          display={`+${fr1(roof.heightOffset)} m`}
          onChange={(v) => updateRoof({ heightOffset: v })}
        />
        <SliderField
          label="Couverture des sièges"
          min={0.55}
          max={1.15}
          step={0.05}
          disabled={none || roof.style === 'fixed_dome'}
          value={roof.coverageRatio}
          display={`${Math.round(roof.coverageRatio * 100)} %`}
          scale={100}
          onChange={(v) => updateRoof({ coverageRatio: v })}
        />
        <SliderField
          label="Opacité de la membrane"
          min={0.5}
          max={1}
          step={0.05}
          disabled={none}
          value={roof.opacity}
          display={`${Math.round(roof.opacity * 100)} %`}
          scale={100}
          onChange={(v) => updateRoof({ opacity: v })}
        />
      </PanelSection>
    </>
  );
};

function materialOptions<T extends string>(
  catalog: { id: T; label: string; subtitle: string }[]
) {
  return catalog.map((item) => ({
    id: item.id,
    label: item.label,
    detail: item.subtitle,
    leading: <MaterialSwatchSvg materialId={item.id} />,
  }));
}

const MaterialsInspector: React.FC = () => {
  const doc = useStadiumStore((s) => s.doc);
  const updateMaterials = useStadiumStore((s) => s.updateMaterials);
  const updateColors = useStadiumStore((s) => s.updateColors);
  const mats = useMemo(() => resolveStadiumMaterials(doc), [doc]);

  return (
    <>
      <PanelHeader title="Façade et matériaux" />
      <PanelSection title="Enveloppe">
        <OptionList
          label="Enveloppe extérieure"
          value={mats.envelopeStyle ?? 'enveloping_skin'}
          onChange={(envelopeStyle) => updateMaterials({ envelopeStyle })}
          options={ENVELOPE_STYLE_CATALOG.map((o) => ({ id: o.id, label: o.label, detail: o.subtitle }))}
        />
      </PanelSection>
      <PanelSection title="Façade">
        <OptionList
          label="Matériau de façade"
          value={mats.facade}
          onChange={(facade) => updateMaterials({ facade })}
          options={materialOptions(FACADE_MATERIAL_CATALOG)}
        />
      </PanelSection>
      <PanelSection title="Couverture du toit">
        <OptionList
          label="Matériau de couverture"
          value={mats.roof}
          onChange={(roof) => updateMaterials({ roof })}
          options={materialOptions(ROOF_MATERIAL_CATALOG)}
        />
      </PanelSection>
      <PanelSection title="Charpente">
        <OptionList
          label="Matériau de charpente"
          value={mats.structure}
          onChange={(structure) => updateMaterials({ structure })}
          options={materialOptions(STRUCTURE_MATERIAL_CATALOG)}
        />
      </PanelSection>
      <PanelSection title="Sièges">
        <OptionList
          label="Finition des sièges"
          value={mats.seatFinish}
          onChange={(seatFinish) => updateMaterials({ seatFinish })}
          options={materialOptions(SEAT_MATERIAL_CATALOG)}
        />
        <div className="grid grid-cols-2 gap-px -mx-2" role="group" aria-label="Couleurs de club">
          {SEAT_CLUB_PALETTES.map((pal) => {
            const current =
              doc.colors.seatsPrimary.toLowerCase() === pal.primary.toLowerCase() &&
              doc.colors.seatsSecondary.toLowerCase() === pal.secondary.toLowerCase();
            return (
              <button
                key={pal.id}
                type="button"
                aria-pressed={current}
                onClick={() => updateColors({ seatsPrimary: pal.primary, seatsSecondary: pal.secondary })}
                className={`flex items-center gap-2 h-7 px-2 rounded text-left text-xs transition-colors duration-100 ${
                  current ? 'bg-accent-soft text-ink font-medium' : 'text-ink hover:bg-hover'
                }`}
              >
                <SeatPaletteChip primary={pal.primary} secondary={pal.secondary} />
                <span className="truncate">{pal.label}</span>
              </button>
            );
          })}
        </div>
        <ColorField
          label="Couleur principale"
          value={doc.colors.seatsPrimary}
          onChange={(v) => updateColors({ seatsPrimary: v })}
        />
        <ColorField
          label="Couleur du motif"
          value={doc.colors.seatsSecondary}
          onChange={(v) => updateColors({ seatsSecondary: v })}
        />
      </PanelSection>
      <PanelSection title="Sols" defaultOpen={false}>
        <div className="text-2xs text-ink-faint">Pelouse</div>
        <OptionList
          label="Pelouse"
          value={mats.pitchTurf}
          onChange={(pitchTurf) => updateMaterials({ pitchTurf })}
          options={materialOptions(TURF_MATERIAL_CATALOG)}
        />
        <div className="text-2xs text-ink-faint pt-1">Piste et abords</div>
        <OptionList
          label="Piste et abords"
          value={mats.trackSurface}
          onChange={(trackSurface) => updateMaterials({ trackSurface })}
          options={materialOptions(TRACK_MATERIAL_CATALOG)}
        />
        <div className="text-2xs text-ink-faint pt-1">Parvis</div>
        <OptionList
          label="Parvis"
          value={mats.plazaSurface}
          onChange={(plazaSurface) => updateMaterials({ plazaSurface })}
          options={materialOptions(PLAZA_MATERIAL_CATALOG)}
        />
      </PanelSection>
    </>
  );
};

export const Inspector: React.FC<{ node: EditorNode }> = ({ node }) => {
  switch (node) {
    case 'bowl':
      return <BowlInspector />;
    case 'stand':
      return <StandInspector />;
    case 'roof':
      return <RoofInspector />;
    case 'materials':
      return <MaterialsInspector />;
    case 'objects':
      return <ObjectList />;
    case 'projects':
      return <ProjectsPanel />;
  }
};

import React, { useEffect, useMemo, useState } from 'react';
import { MIN_PITCH_SETBACK } from '../stadium/bowlRing';
import {
  calculateStadiumMetrics,
  getTrackRadialOffset,
  resolveStandRoofStyle,
} from '../stadium/capacity';
import {
  computeRoofShadowDensity,
  CORNER_MODE_CATALOG,
  ENVELOPE_STYLE_CATALOG,
  FACADE_MATERIAL_CATALOG,
  FACADE_PATTERN_CATALOG,
  resolveFacadePalette,
  FLOODLIGHT_RIG_CATALOG,
  getMaterialPreviewDataUrl,
  PLAZA_MATERIAL_CATALOG,
  resolveStadiumMaterials,
  ROOF_MATERIAL_CATALOG,
  SEAT_CLUB_PALETTES,
  SEAT_MATERIAL_CATALOG,
  SKYLIGHT_MODE_CATALOG,
  STRUCTURE_MATERIAL_CATALOG,
  TRACK_MATERIAL_CATALOG,
  TURF_MATERIAL_CATALOG,
} from '../stadium/materials';
import {
  CornerId,
  CornerJoin,
  CrossAisleConfig,
  CornerMode,
  EnvelopeProfile,
  EnvelopeStyle,
  getEffectiveSunkenDepth,
  getMaxPitchLengthForTrack,
  isContinuousBowlShape,
  CORNER_PYLON_MAX_HEIGHT,
  resolveAllCorners,
  resolveCornerPylonFrame,
  resolveCounterweightTrusses,
  resolveFloodlightRig,
  resolvePortalCount,
  resolveSite,
  resolveSpanningGirderCount,
  resolveSuspendedMasts,
  resolveWaveAmplitude,
  resolveRetractable,
  resolveStandVomitories,
  vomitoryLevelsOfTier,
  VOMITORY_ROWS_PER_LEVEL,
  resolveCrossAisles,
  RETRACTABLE_MAX_PYLONS,
  RETRACTABLE_PANEL_LIMITS,
  RetractableConfig,
  RetractableMotion,
  RetractablePanelKind,
  RoofStyle,
  SeatingType,
  SiteSetting,
  slopeDegFromRiser,
  StadiumShape,
  SeatPattern,
  SeatTierStyle,
  StandSide,
  TRACK_MAX_PITCH_WIDTH_M,
} from '../stadium/schema';
import { isIntegralShell, isMovableRoof, roofDefinition, ROOF_STYLES } from '../stadium/roofCatalog';
import { OFFERED_SHAPES, shapeDefinition } from '../stadium/shapeCatalog';
import { resolveSeatTierStyle, SeatStyleScope, seatStyleAt } from '../stadium/seatPattern';
import {
  computeStandSightlines,
  DEFAULT_TIER_OVERHANG_M,
  resolveStandTiers,
} from '../stadium/sightlines';
import { StandTarget, useStadiumStore } from '../state/useStadiumStore';
import { ObjectList } from './ObjectList';
import { Plus, X } from 'lucide-react';
import { thumbnailUrl } from './thumbnails';
import {
  AdvancedSection,
  Button,
  FieldRow,
  GalleryOption,
  IconButton,
  GalleryPicker,
  OptionList,
  choiceClass,
  PanelSection,
  SubGroup,
  Segmented,
  SelectField,
  SliderField,
  Switch,
  TextField,
  ToggleField,
} from './ui';

export const SHAPE_OPTIONS: { id: StadiumShape; label: string; desc: string }[] = OFFERED_SHAPES.map((id) => ({
  id,
  label: shapeDefinition(id).label,
  desc: shapeDefinition(id).desc,
}));

export const ROOF_OPTIONS: { id: RoofStyle; label: string; desc: string }[] = ROOF_STYLES.map((id) => ({
  id,
  label: roofDefinition(id).label,
  desc: roofDefinition(id).desc,
}));

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

const STAND_TABS: { id: StandTarget; label: string }[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'south', label: 'Sud' },
  { id: 'north', label: 'Nord' },
  { id: 'east', label: 'Est' },
  { id: 'west', label: 'Ouest' },
];

const TIER_OPTIONS: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5];

const ENVELOPE_PROFILE_OPTIONS: { id: EnvelopeProfile; label: string; detail: string }[] = [
  { id: 'straight', label: 'Verticale', detail: 'Peau droite le long des tribunes' },
  { id: 'bulging', label: 'Calebasse bombée', detail: 'Se gonfle à mi-hauteur, comme une calebasse' },
  { id: 'tent', label: 'Tente inclinée', detail: 'Large pied concave qui se replie jusqu’au toit, comme une tente' },
  { id: 'saucer', label: 'Soucoupe évasée', detail: 'Pied en retrait, la peau s’évase vers le bord du toit' },
];

/**
 * Pure SVG procedural material swatch preview (zero inline styles, crisp micro-textures).
 */
const MaterialSwatchSvg: React.FC<{ materialId: string }> = ({ materialId }) => {
  switch (materialId) {
    case 'glass_curtain':
      return (
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
          <rect width="40" height="28" fill="#94a3b8" />
          <polygon points="0,0 28,0 12,28 0,28" fill="#e2e8f0" opacity="0.65" />
          {[4, 8, 12, 16, 20, 24].map((y) => (
            <line key={y} x1="0" y1={y} x2="40" y2={y} stroke="#1e293b" strokeWidth="1.2" opacity="0.55" />
          ))}
        </svg>
      );
    case 'architectural_concrete':
      return (
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
          <rect width="40" height="28" fill="#7c2d12" />
          <circle cx="12" cy="10" r="10" fill="#c2410c" opacity="0.65" />
          <circle cx="30" cy="20" r="9" fill="#431407" opacity="0.6" />
          <line x1="14" y1="0" x2="14" y2="28" stroke="#291509" strokeWidth="1.2" />
          <line x1="28" y1="0" x2="28" y2="28" stroke="#291509" strokeWidth="1.2" />
        </svg>
      );
    case 'heritage_brick':
      return (
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
          <rect width="40" height="28" fill="#e2e8f0" />
          <polygon points="0,0 32,0 16,28 0,28" fill="#ffffff" opacity="0.85" />
          <line x1="14" y1="0" x2="14" y2="28" stroke="#94a3b8" strokeWidth="1" />
          <line x1="28" y1="0" x2="28" y2="28" stroke="#94a3b8" strokeWidth="1" />
        </svg>
      );
    case 'etfe_cushions':
    case 'etfe_cushions_facade':
      return (
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
          <rect width="40" height="28" fill="#38bdf8" />
          <polygon points="20,2 37,14 20,26 3,14" fill="#f0f9ff" stroke="#1e293b" strokeWidth="1.2" />
          <ellipse cx="20" cy="14" rx="8" ry="5" fill="#bae6fd" opacity="0.7" />
        </svg>
      );
    case 'polycarbonate_glass':
      return (
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
          <rect width="40" height="28" fill="#38bdf8" opacity="0.45" />
          <polygon points="0,0 24,0 8,28 0,28" fill="#e0f2fe" opacity="0.7" />
          {[8, 16, 24, 32].map((x) => (
            <line key={x} x1={x} y1="0" x2={x} y2="28" stroke="#1e293b" strokeWidth="1.2" />
          ))}
        </svg>
      );
    case 'standing_seam_zinc':
      return (
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
          <rect width="40" height="28" fill="#1e293b" />
          <polygon points="0,0 22,0 10,28 0,28" fill="#475569" opacity="0.55" />
          <circle cx="28" cy="10" r="1" fill="#94a3b8" opacity="0.5" />
          <circle cx="16" cy="20" r="1" fill="#94a3b8" opacity="0.5" />
        </svg>
      );
    case 'molded_poly_mosaic':
      return (
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
          <rect width="40" height="28" fill="#1e3a8a" />
          {[4, 13, 22, 31].map((x) => (
            <rect key={x} x={x} y="4" width="6" height="20" rx="2" fill="#3b82f6" />
          ))}
          <rect x="0" y="12" width="40" height="4" fill="#f8fafc" opacity="0.85" />
        </svg>
      );
    case 'padded_club_velvet':
      return (
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
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
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
          <rect width="40" height="28" fill={fill} />
          {[7, 14, 21].map((y) => (
            <line key={y} x1="0" y1={y} x2="40" y2={y} stroke="#f8fafc" strokeWidth="0.9" opacity="0.85" />
          ))}
        </svg>
      );
    }
    default:
      return (
        <svg viewBox="0 0 40 28" aria-hidden className="w-10 h-[26px] rounded-sm shrink-0">
          <rect width="40" height="28" fill="#475569" />
          <line x1="13" y1="0" x2="13" y2="28" stroke="#cbd5e1" strokeWidth="0.8" opacity="0.4" />
          <line x1="27" y1="0" x2="27" y2="28" stroke="#cbd5e1" strokeWidth="0.8" opacity="0.4" />
          <line x1="0" y1="14" x2="40" y2="14" stroke="#cbd5e1" strokeWidth="0.8" opacity="0.4" />
        </svg>
      );
  }
};

/**
 * Lit render of the material's actual PBR texture. Rendering is deferred past the first paint
 * (each facade texture synthesises 512² texels on first use); the SVG sketch shows meanwhile and
 * stays as the fallback where no 2D canvas exists.
 */
const MaterialPreview: React.FC<{ materialId: string; fill?: boolean }> = ({ materialId, fill }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      const next = getMaterialPreviewDataUrl(materialId);
      if (alive) setUrl(next);
    }, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [materialId]);
  return url ? (
    <img
      src={url}
      alt=""
      aria-hidden
      className={`${fill ? 'w-full h-full' : 'w-10 h-[26px]'} rounded-sm shrink-0 object-cover ring-1 ring-black/10`}
    />
  ) : (
    <MaterialSwatchSvg materialId={materialId} />
  );
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

const SEAT_PATTERN_OPTIONS: { id: SeatPattern; label: string }[] = [
  { id: 'solid', label: 'Uni' },
  { id: 'mosaic', label: 'Mosaïque aléatoire' },
  { id: 'gradient', label: 'Dégradé vers le haut' },
  { id: 'stripes', label: 'Rayures de rangées' },
  { id: 'lettering', label: 'Inscription' },
];

/**
 * Cross aisles of a stand: any number per tier, each with its tier, position and width. An aisle
 * too close to a tier end or to another aisle (fewer than three rows) is left out of the stand.
 */
const CrossAisleList: React.FC<{
  aisles: CrossAisleConfig[];
  tierCount: number;
  disabled: boolean;
  onChange: (aisles: CrossAisleConfig[]) => void;
}> = ({ aisles, tierCount, disabled, onChange }) => {
  const set = (i: number, patch: Partial<CrossAisleConfig>) =>
    onChange(aisles.map((a, k) => (k === i ? { ...a, ...patch } : a)));
  // Aisles of `tier` spaced evenly through it, so none lands on another.
  const spread = (list: CrossAisleConfig[], tier: number) => {
    const on = list.filter((a) => a.tier === tier);
    return list.map((a) => (a.tier === tier ? { ...a, ratio: (on.indexOf(a) + 1) / (on.length + 1) } : a));
  };
  const add = () => {
    // A new aisle goes on the lowest tier with fewest aisles.
    const perTier = Array.from({ length: tierCount }, (_, t) => aisles.filter((a) => a.tier === t).length);
    const tier = perTier.indexOf(Math.min(...perTier));
    onChange(spread([...aisles, { tier, ratio: 0.5, width: 1.8 }], tier));
  };
  const moveTo = (i: number, tier: number) => {
    const from = aisles[i].tier;
    onChange(spread(spread(aisles.map((a, k) => (k === i ? { ...a, tier } : a)), tier), from));
  };
  return (
    <div className="space-y-3">
      <FieldRow
        label="Coursives transversales"
        hint="Allées horizontales qui coupent un étage ; les rangs derrière chacune sont surélevés par un muret. Plusieurs possibles par étage"
      >
        <Button disabled={disabled || aisles.length >= tierCount * 4} onClick={add}>
          <Plus aria-hidden className="w-3.5 h-3.5" />
          Ajouter
        </Button>
      </FieldRow>
      {aisles.map((a, i) => (
        <div key={i} className="space-y-2 pl-2 border-l border-line">
          <FieldRow label={`Coursive ${i + 1}`}>
            <IconButton
              label={`Retirer la coursive ${i + 1}`}
              disabled={disabled}
              onClick={() => onChange(aisles.filter((_, k) => k !== i))}
            >
              <X aria-hidden className="w-3.5 h-3.5" />
            </IconButton>
          </FieldRow>
          {tierCount > 1 && (
            <FieldRow label="Étage" hint="Étage que la coursive coupe, 1 étant le plus bas">
              <Segmented
                label={`Étage de la coursive ${i + 1}`}
                size="sm"
                disabled={disabled}
                value={Math.min(a.tier, tierCount - 1)}
                onChange={(tier) => moveTo(i, tier)}
                options={Array.from({ length: tierCount }, (_, t) => ({ id: t, label: String(t + 1) }))}
              />
            </FieldRow>
          )}
          <SliderField
            label="Position"
            hint="Part des rangs de l’étage devant la coursive"
            min={0.1}
            max={0.9}
            step={0.05}
            disabled={disabled}
            value={a.ratio}
            display={`${Math.round(a.ratio * 100)} %`}
            onChange={(ratio) => set(i, { ratio })}
          />
          <SliderField
            label="Largeur"
            min={1.2}
            max={3}
            step={0.1}
            disabled={disabled}
            value={a.width}
            display={`${fr1(a.width)} m`}
            onChange={(width) => set(i, { width })}
          />
        </div>
      ))}
    </div>
  );
};

const TIER_NAMES = ['bas', 'deuxième', 'troisième', 'quatrième', 'cinquième'];

/**
 * Colour and pattern of the seats, set at one of four levels: the whole stadium, one tier on every
 * stand, one whole stand, one tier of one stand. A narrower level wins over a broader one. With
 * every stand selected only the two stadium-wide levels are offered.
 */
const SeatTiersEditor: React.FC<{ editAll: boolean; side: StandSide }> = ({ editAll, side }) => {
  const doc = useStadiumStore((s) => s.doc);
  const target = useStadiumStore((s) => s.activeStandTab);
  const updateSeatStyle = useStadiumStore((s) => s.updateSeatStyle);
  const clearNarrower = useStadiumStore((s) => s.clearNarrowerSeatStyles);
  const stand = doc.stands[side];
  const sides = Object.keys(STAND_LABELS) as StandSide[];
  const standName = STAND_LABELS[side].toLowerCase();
  const scopeOptions: { id: SeatStyleScope; label: string }[] = [
    { id: 'stadium', label: 'Tout le stade' },
    { id: 'tier', label: editAll ? 'Chaque étage' : 'Cet étage partout' },
    ...(editAll
      ? []
      : [
          { id: 'stand' as const, label: `Tribune ${standName} entière` },
          { id: 'stand_tier' as const, label: `Étages de la tribune ${standName}` },
        ]),
  ];
  const [chosen, setScope] = useState<SeatStyleScope>(() =>
    sides.some((s) => doc.stands[s].seatTiers?.some(Boolean))
      ? 'stand_tier'
      : sides.some((s) => doc.stands[s].seatStyle)
        ? 'stand'
        : doc.seatTierStyles?.some(Boolean)
          ? 'tier'
          : 'stadium'
  );
  const scope = scopeOptions.some((o) => o.id === chosen) ? chosen : 'tier';
  const perTier = scope === 'tier' || scope === 'stand_tier';
  // All stands: as many tiers as the tallest stand has, shown with the displayed stand's values.
  const tierCount = editAll
    ? Math.max(...sides.map((s) => (doc.stands[s].enabled ? doc.stands[s].tiers : 0)), 1)
    : Math.max(1, stand.tiers);
  const narrowerSet = (t: number): boolean => {
    const standLevels = (s: StandSide) => doc.stands[s].seatTiers?.some(Boolean) || !!doc.stands[s].seatStyle;
    switch (scope) {
      case 'stadium':
        return !!doc.seatTierStyles?.some(Boolean) || sides.some(standLevels);
      case 'tier':
        return sides.some((s) => !!doc.stands[s].seatStyle || !!doc.stands[s].seatTiers?.[t]);
      case 'stand':
        return !!stand.seatTiers?.some(Boolean);
      case 'stand_tier':
        return false;
    }
  };
  const blocks = perTier ? Array.from({ length: tierCount }, (_, t) => t) : [0];
  return (
    <>
      <SelectField label="Appliquer à" value={scope} options={scopeOptions} onChange={setScope} />
      <p className="text-2xs leading-snug text-ink-faint">
        Du plus général au plus précis : stade, étage, tribune, étage d’une tribune. Le réglage le plus précis
        l’emporte.
      </p>
      {blocks.map((t) => {
        const style = resolveSeatTierStyle(doc, stand, t, scope);
        const own = seatStyleAt(doc, stand, t, scope) !== undefined;
        const set = (patch: Partial<SeatTierStyle>) => updateSeatStyle(scope, target, t, patch);
        const title = perTier
          ? tierCount === 1
            ? 'Sièges'
            : `Étage ${t + 1} (${TIER_NAMES[t] ?? t + 1})`
          : scope === 'stadium'
            ? 'Tous les sièges'
            : `Tribune ${standName}`;
        return (
          <SubGroup key={`${scope}-${t}`} title={title}>
            <SelectField
              label="Motif"
              value={style.pattern}
              options={SEAT_PATTERN_OPTIONS}
              onChange={(pattern) => set({ pattern })}
            />
            <ColorField label="Couleur" value={style.color} onChange={(color) => set({ color })} />
            {style.pattern !== 'solid' && (
              <ColorField
                label={style.pattern === 'lettering' ? 'Couleur des lettres' : 'Couleur du motif'}
                value={style.accent}
                onChange={(accent) => set({ accent })}
              />
            )}
            {style.pattern === 'mosaic' && (
              <SliderField
                label="Sièges de la couleur du motif"
                value={style.share}
                min={0.02}
                max={0.6}
                step={0.01}
                scale={100}
                display={`${Math.round(style.share * 100)} %`}
                onChange={(share) => set({ share })}
              />
            )}
            {style.pattern === 'lettering' && (
              <TextField
                label="Texte"
                value={style.text}
                placeholder="Ex. ALLEZ"
                maxLength={24}
                hint="Écrit avec les sièges, en capitales, au centre de la tribune"
                onChange={(text) => set({ text })}
              />
            )}
            {narrowerSet(t) && (
              <p className="text-2xs leading-snug text-ink-faint">
                Des réglages plus précis remplacent celui-ci sur une partie des sièges.{' '}
                <button
                  type="button"
                  onClick={() => clearNarrower(scope, target, t)}
                  className="underline underline-offset-2 hover:text-ink"
                >
                  Les effacer
                </button>
              </p>
            )}
            {own && (
              <button
                type="button"
                onClick={() => updateSeatStyle(scope, target, t, null)}
                className="text-2xs text-ink-faint underline underline-offset-2 hover:text-ink"
              >
                {scope === 'stadium' ? 'Revenir aux couleurs du club' : 'Reprendre le réglage plus général'}
              </button>
            )}
          </SubGroup>
        );
      })}
    </>
  );
};

const PanelHeader: React.FC<{ title: string; meta?: React.ReactNode; action?: React.ReactNode }> = ({
  title,
  meta,
  action,
}) => (
  <div className="flex items-center gap-3 min-h-12 py-2 px-4 border-b border-line">
    <div className="flex-1 min-w-0">
      <h2 className="text-sm font-semibold leading-snug text-ink">{title}</h2>
      {meta && <div className="text-2xs leading-snug text-ink-faint tabular-nums">{meta}</div>}
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
  ...ROOF_STYLES.flatMap((id) => {
    const label = roofDefinition(id).standLabel;
    return label ? [{ id, label }] : [];
  }),
];

const fr = (n: number) => n.toLocaleString('fr-FR');
const fr1 = (n: number) =>
  n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const CORNER_COMPASS_GRID: { id: CornerId; label: string; eastSide?: boolean }[] = [
  { id: 'nw', label: 'Nord-Ouest' },
  { id: 'ne', label: 'Nord-Est', eastSide: true },
  { id: 'sw', label: 'Sud-Ouest' },
  { id: 'se', label: 'Sud-Est', eastSide: true },
];

/** The editor's tabs, in the order of the tab rail. */
export type EditorTab = 'shape' | 'pitch' | 'stands' | 'roof' | 'facade' | 'site' | 'objects';

const SHAPE_GALLERY: GalleryOption<StadiumShape>[] = SHAPE_OPTIONS.map((o) => ({
  id: o.id,
  label: o.label,
  detail: o.desc,
  image: thumbnailUrl('shapes', o.id),
}));

// Integral shells are both roof and facade: they are offered with the envelopes (Façade tab).
const ROOF_GALLERY: GalleryOption<RoofStyle>[] = ROOF_OPTIONS.filter((o) => !isIntegralShell(o.id)).map((o) => ({
  id: o.id,
  label: o.label,
  detail: o.desc,
  image: thumbnailUrl('roofs', o.id),
}));

const ENVELOPE_GALLERY: GalleryOption<EnvelopeStyle | RoofStyle>[] = [
  ...ENVELOPE_STYLE_CATALOG.map((o) => ({
    id: o.id,
    label: o.label,
    detail: o.subtitle,
    image: thumbnailUrl('envelopes', o.id),
  })),
  ...ROOF_OPTIONS.filter((o) => isIntegralShell(o.id)).map((o) => ({
    id: o.id as RoofStyle,
    label: o.label,
    detail: `${o.desc} · remplace le toit`,
    image: thumbnailUrl('roofs', o.id),
  })),
];

/** A material catalog as gallery tiles, each pictured by its rendered texture. */
function materialGallery<T extends string>(
  catalog: { id: T; label: string; subtitle: string }[]
): GalleryOption<T>[] {
  return catalog.map((item) => ({
    id: item.id,
    label: item.label,
    detail: item.subtitle,
    preview: <MaterialPreview materialId={item.id} fill />,
  }));
}

const CORNER_IDS: CornerId[] = ['nw', 'ne', 'sw', 'se'];

const CORNER_JOIN_OPTIONS: { id: CornerJoin; label: string; detail: string }[] = [
  {
    id: 'blend',
    label: 'Transition progressive',
    detail: 'Le coin passe d’une tribune à l’autre en changeant de hauteur',
  },
  {
    id: 'end',
    label: 'Au niveau des virages',
    detail: 'Le coin garde la hauteur de la tribune derrière le but, les latérales s’arrêtent en pignon',
  },
  {
    id: 'side',
    label: 'Au niveau des tribunes latérales',
    detail: 'Le coin garde la hauteur des latérales et s’arrête en pignon contre le virage',
  },
];

/** On a bowl the rows keep their level: the progressive join ends the extra rows one by one. */
const BOWL_CORNER_JOIN_OPTIONS = CORNER_JOIN_OPTIONS.map((o) =>
  o.id === 'blend'
    ? { ...o, detail: 'Les rangs en trop s’arrêtent un à un dans le coin, anneau supérieur d’abord' }
    : o
);

const ShapePanel: React.FC = () => {
  const doc = useStadiumStore((s) => s.doc);
  const setShape = useStadiumStore((s) => s.setShape);
  const setSunkenDepth = useStadiumStore((s) => s.setSunkenDepth);
  const setCornerRoundness = useStadiumStore((s) => s.setCornerRoundness);
  const setCornerMode = useStadiumStore((s) => s.setCornerMode);
  const setAllCorners = useStadiumStore((s) => s.setAllCorners);
  const setCornerJoin = useStadiumStore((s) => s.setCornerJoin);
  const setCornerAccess = useStadiumStore((s) => s.setCornerAccess);
  const applyTargetCapacity = useStadiumStore((s) => s.applyTargetCapacity);
  const updateConcourse = useStadiumStore((s) => s.updateConcourse);
  const metrics = useMemo(() => calculateStadiumMetrics(doc), [doc]);
  const resolvedCorners = useMemo(() => resolveAllCorners(doc), [doc]);
  const sunken = getEffectiveSunkenDepth(doc);
  const concourseWidth = doc.concourse?.width ?? 0;
  const concourseHeight = doc.concourse?.heightRatio ?? 0.5;

  // The horseshoe's open end has no east corners to dress.
  const lockedCorner = (id: CornerId) => doc.shape === 'horseshoe' && (id === 'ne' || id === 'se');
  const editable = CORNER_IDS.filter((id) => !lockedCorner(id));
  const sharedMode = editable.every((id) => resolvedCorners[id] === resolvedCorners[editable[0]])
    ? resolvedCorners[editable[0]]
    : 'mixed';
  const cornerOptions = CORNER_MODE_CATALOG.map((c) => ({ id: c.id, label: c.label }));

  return (
    <>
      <PanelHeader title="Forme" meta={`${fr(metrics.totalCapacity)} places`} />
      <PanelSection title="Enceinte">
        <GalleryPicker
          label="Forme de l’enceinte"
          value={doc.shape}
          onChange={setShape}
          options={SHAPE_GALLERY}
        />
        {doc.shape === 'rounded_rectangle' && (
          <SliderField
            label="Arrondi des angles"
            hint="De l’angle presque vif au virage complet"
            min={0}
            max={1}
            step={0.05}
            value={doc.cornerRoundness ?? 0.5}
            display={`${Math.round((doc.cornerRoundness ?? 0.5) * 100)} %`}
            onChange={setCornerRoundness}
          />
        )}
        {doc.shape === 'tilted_bowl' && (
          <p className="text-2xs text-ink-faint">
            La pente vient des rangs des tribunes nord (haute) et sud (basse) ; les virages suivent.
          </p>
        )}
      </PanelSection>
      <PanelSection title="Capacité">
        <SliderField
          label="Capacité visée"
          hint="Ajuste les rangs de toutes les tribunes pour approcher ce total"
          min={2000}
          max={110000}
          step={1000}
          value={Math.min(110000, metrics.totalCapacity)}
          display={`${fr(metrics.totalCapacity)} places`}
          onChange={applyTargetCapacity}
        />
      </PanelSection>
      <PanelSection title="Coins">
        <SelectField<CornerMode | 'mixed'>
          label="Les quatre coins"
          value={sharedMode}
          onChange={(mode) => mode !== 'mixed' && setAllCorners(mode)}
          options={
            sharedMode === 'mixed'
              ? [{ id: 'mixed', label: 'Différents' }, ...cornerOptions]
              : cornerOptions
          }
        />
        {(isContinuousBowlShape(doc.shape)
          ? doc.shape !== 'saddle_bowl' && doc.shape !== 'tilted_bowl'
          : editable.some((id) => resolvedCorners[id] === 'filled')) && (
          <OptionList<CornerJoin>
            label="Raccord entre tribunes de hauteurs différentes"
            value={doc.cornerJoin ?? 'blend'}
            onChange={setCornerJoin}
            options={isContinuousBowlShape(doc.shape) ? BOWL_CORNER_JOIN_OPTIONS : CORNER_JOIN_OPTIONS}
          />
        )}
        <SubGroup title="Accès véhicule">
          <p className="text-2xs text-ink-faint">
            Ouverture sous les gradins du coin, pour les secours et les camions.
          </p>
          {CORNER_COMPASS_GRID.map((corner) => {
            const seated = !lockedCorner(corner.id) && resolvedCorners[corner.id] === 'filled';
            return (
              <ToggleField
                key={corner.id}
                label={corner.label}
                hint={seated ? undefined : 'Seulement pour un coin en gradins'}
                disabled={!seated}
                checked={seated && Boolean(doc.cornerAccess?.[corner.id])}
                onChange={(on) => setCornerAccess(corner.id, on)}
              />
            );
          })}
        </SubGroup>
      </PanelSection>
      <AdvancedSection tab="shape">
        <SubGroup title="Coins un par un">
          {CORNER_COMPASS_GRID.map((corner) => (
            <SelectField
              key={corner.id}
              label={corner.label}
              disabled={lockedCorner(corner.id)}
              value={lockedCorner(corner.id) ? 'open' : resolvedCorners[corner.id]}
              onChange={(mode) => setCornerMode(corner.id, mode)}
              options={cornerOptions}
            />
          ))}
        </SubGroup>
        <SubGroup title="Enfouissement">
          <SliderField
            label="Profondeur sous le sol"
            hint="Creuse les gradins bas sous un talus pour réduire la hauteur visible"
            min={0}
            max={15}
            step={0.5}
            value={sunken}
            display={sunken > 0 ? `−${fr1(sunken)} m` : 'Au niveau du sol'}
            onChange={setSunkenDepth}
          />
        </SubGroup>
        <SubGroup title="Coursive extérieure">
          <SliderField
            label="Profondeur derrière les tribunes"
            hint="Bâtiment qui entoure les gradins : coursives, escaliers, loges, accès"
            min={0}
            max={24}
            step={0.5}
            value={concourseWidth}
            display={concourseWidth > 0 ? `${fr1(concourseWidth)} m` : 'Aucune'}
            onChange={(v) => updateConcourse({ width: v })}
          />
          <SliderField
            label="Hauteur"
            hint="Part de la hauteur des tribunes : basse pour un socle, pleine pour une façade continue"
            min={0.15}
            max={1}
            step={0.05}
            scale={100}
            disabled={concourseWidth <= 0}
            value={concourseHeight}
            display={concourseHeight >= 0.98 ? 'Jusqu’en haut des tribunes' : `${Math.round(concourseHeight * 100)} %`}
            onChange={(v) => updateConcourse({ heightRatio: v })}
          />
        </SubGroup>
      </AdvancedSection>
    </>
  );
};

const PitchPanel: React.FC = () => {
  const doc = useStadiumStore((s) => s.doc);
  const updatePitch = useStadiumStore((s) => s.updatePitch);
  const setFrontFence = useStadiumStore((s) => s.setFrontFence);
  const updateMaterials = useStadiumStore((s) => s.updateMaterials);
  const mats = useMemo(() => resolveStadiumMaterials(doc), [doc]);
  const maxPitchWidth = doc.pitch.hasTrack ? TRACK_MAX_PITCH_WIDTH_M : 75;
  const maxPitchLength = doc.pitch.hasTrack
    ? Math.min(115, getMaxPitchLengthForTrack(doc.pitch.width))
    : 115;
  const movable = doc.pitch.movablePitch ?? 'none';

  return (
    <>
      <PanelHeader title="Terrain" meta={`${doc.pitch.length} × ${doc.pitch.width} m`} />
      <PanelSection title="Dimensions">
        <SliderField
          label="Longueur"
          hint={
            doc.pitch.hasTrack
              ? `Limitée à ${maxPitchLength} m pour rester dans la corde de 36,5 m`
              : undefined
          }
          min={95}
          max={maxPitchLength}
          step={1}
          value={doc.pitch.length}
          display={`${doc.pitch.length} m`}
          onChange={(v) => updatePitch({ length: v })}
        />
        <SliderField
          label="Largeur"
          hint={
            doc.pitch.hasTrack
              ? `Limitée à ${TRACK_MAX_PITCH_WIDTH_M} m à l’intérieur de la piste`
              : undefined
          }
          min={60}
          max={maxPitchWidth}
          step={1}
          value={doc.pitch.width}
          display={`${doc.pitch.width} m`}
          onChange={(v) => updatePitch({ width: v })}
        />
      </PanelSection>
      <PanelSection title="Pelouse">
        <GalleryPicker
          label="Pelouse"
          value={mats.pitchTurf}
          onChange={(pitchTurf) => updateMaterials({ pitchTurf })}
          options={materialGallery(TURF_MATERIAL_CATALOG)}
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
      </PanelSection>
      <PanelSection title="Piste d’athlétisme">
        <ToggleField
          label="Piste de 400 m"
          hint="400 m officiel (droites 84,39 m · rayon 36,5 m · couloirs 1,22 m)"
          checked={doc.pitch.hasTrack}
          onChange={(v) => updatePitch({ hasTrack: v })}
        />
        {doc.pitch.hasTrack && (
          <SliderField
            label="Couloirs"
            min={6}
            max={9}
            step={1}
            value={doc.pitch.trackLanes}
            display={`${doc.pitch.trackLanes} couloirs`}
            onChange={(trackLanes) => updatePitch({ trackLanes })}
          />
        )}
      </PanelSection>
      <AdvancedSection tab="pitch">
        <SubGroup title="Pelouse mobile">
          <SelectField
            label="Type"
            value={movable}
            onChange={(movablePitch) => updatePitch({ movablePitch })}
            options={[
              { id: 'none', label: 'Fixe' },
              { id: 'half_lift', label: 'Demi-pelouse relevée' },
              { id: 'slide_out', label: 'Sort du stade' },
            ]}
          />
          {movable !== 'none' && (
            <SliderField
              label="Mode arène"
              hint="0 % : pelouse en place · 100 % : plancher d’arène dégagé"
              min={0}
              max={1}
              step={0.05}
              value={doc.pitch.movablePitchState ?? 0}
              display={`${Math.round((doc.pitch.movablePitchState ?? 0) * 100)} %`}
              scale={100}
              onChange={(movablePitchState) => updatePitch({ movablePitchState })}
            />
          )}
        </SubGroup>
        <SubGroup title="Bord du terrain">
          <ToggleField
            label="Panneaux LED publicitaires"
            checked={doc.pitch.adBoards}
            onChange={(v) => updatePitch({ adBoards: v })}
          />
          <FieldRow
            label="Barrière devant les tribunes"
            hint="Vitre basse moderne, ou grillage anti-envahissement des stades des années 80-90"
          >
            <Segmented
              label="Barrière devant les tribunes"
              size="sm"
              value={doc.frontFence ?? 'glass'}
              onChange={(frontFence) => setFrontFence({ frontFence })}
              options={[
                { id: 'glass', label: 'Vitre' },
                { id: 'mesh', label: 'Grillage' },
              ]}
            />
          </FieldRow>
          {doc.frontFence === 'mesh' && (
            <SliderField
              label="Hauteur du grillage"
              min={1.5}
              max={4}
              step={0.1}
              value={doc.frontFenceHeight ?? 2.5}
              display={`${fr1(doc.frontFenceHeight ?? 2.5)} m`}
              onChange={(frontFenceHeight) => setFrontFence({ frontFenceHeight })}
            />
          )}
          <GalleryPicker
            label="Piste et abords"
            value={mats.trackSurface}
            onChange={(trackSurface) => updateMaterials({ trackSurface })}
            options={materialGallery(TRACK_MATERIAL_CATALOG)}
          />
        </SubGroup>
      </AdvancedSection>
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

const StandsPanel: React.FC = () => {
  const doc = useStadiumStore((s) => s.doc);
  const target = useStadiumStore((s) => s.activeStandTab);
  const setActiveStandTab = useStadiumStore((s) => s.setActiveStandTab);
  const editAll = target === 'all';
  // With all stands selected, the south stand's values are shown and edits go to all four.
  const side: StandSide = editAll ? 'south' : target;
  const updateStand = useStadiumStore((s) => s.updateStand);
  const updateStandTier = useStadiumStore((s) => s.updateStandTier);
  const resetStandTiersUniform = useStadiumStore((s) => s.resetStandTiersUniform);
  const convertStandToKopWall = useStadiumStore((s) => s.convertStandToKopWall);
  const updateMaterials = useStadiumStore((s) => s.updateMaterials);
  const updateColors = useStadiumStore((s) => s.updateColors);
  const metrics = useMemo(() => calculateStadiumMetrics(doc), [doc]);
  const mats = useMemo(() => resolveStadiumMaterials(doc), [doc]);

  const stand = doc.stands[side];
  const sm = metrics.stands[side];
  const roofStyle = resolveStandRoofStyle(doc, side);
  const slope = stand.slopeAngleDeg ?? slopeDegFromRiser(stand.riserHeight, stand.rowDepth);
  const off = !stand.enabled;
  const resolvedTiers = useMemo(() => resolveStandTiers(stand), [stand]);
  const vomSpec = useMemo(() => resolveStandVomitories(stand), [stand]);
  const crossAisles = useMemo(() => resolveCrossAisles(stand), [stand]);
  const tierOverhang = stand.tierOverhang ?? DEFAULT_TIER_OVERHANG_M;
  const hasAsymmetricTiers = Boolean(stand.tierConfigs && stand.tierConfigs.length > 0);
  const separateStands = !isContinuousBowlShape(doc.shape);

  const trackOffsets = useMemo(() => getTrackRadialOffset(doc), [doc]);
  const trackExtra =
    side === 'north' || side === 'south'
      ? trackOffsets.sideOffset
      : trackOffsets.endOffset;

  const sightlines = useMemo(
    () => computeStandSightlines(stand, trackExtra, roofStyle),
    [stand, trackExtra, roofStyle]
  );

  const tallestOther = (['north', 'south', 'east', 'west'] as StandSide[])
    .filter((s) => s !== side && metrics.stands[s].enabled)
    .reduce((max, s) => Math.max(max, metrics.stands[s].maxHeight), 0);

  return (
    <>
      <PanelHeader
        title={editAll ? 'Toutes les tribunes' : `Tribune ${STAND_LABELS[side]}`}
        meta={
          editAll
            ? `${fr(metrics.totalCapacity)} places · réglages appliqués aux 4 tribunes`
            : off
            ? 'Désactivée'
            : `${fr(sm.capacity)} places · ${sm.seatsPerRow} par rang · ${fr1(sm.maxHeight)} m de haut`
        }
        action={
          <Switch
            label="Tribune active"
            checked={stand.enabled}
            onChange={(v) => updateStand(target, { enabled: v })}
          />
        }
      />
      <div className="px-4 py-2 border-b border-line">
        <Segmented
          label="Sélection de la tribune"
          size="sm"
          value={target}
          onChange={setActiveStandTab}
          options={STAND_TABS}
        />
      </div>
      <PanelSection title="Résumé" persistKey="stands:summary">
        <FieldRow
          label="Évacuation"
          hint="Étage le plus lent, 79 personnes par mètre et par minute (Green Guide : 8 min au plus)"
        >
          <span className={`text-xs tabular-nums ${sm.evacuationMinutes > 8 ? 'text-danger' : 'text-ink'}`}>
            {off ? '—' : `${fr1(sm.evacuationMinutes)} min`}
          </span>
        </FieldRow>
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
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-ink-muted">Distance moy. au terrain</span>
          <span className="text-ink tabular-nums">{fr1(sightlines.avgDistanceM)} m</span>
        </div>
        <SightlineProfile points={sightlines.points} />
      </PanelSection>
      <PanelSection title="Gradins" persistKey="stands:terraces">
        <FieldRow label="Étages">
          <Segmented
            label="Nombre d’étages"
            size="sm"
            disabled={off}
            value={stand.tiers}
            onChange={(t) => updateStand(target, { tiers: t })}
            options={TIER_OPTIONS.map((t) => ({ id: t, label: String(t) }))}
          />
        </FieldRow>
        <SliderField
          label="Rangs"
          min={8}
          max={108}
          step={1}
          disabled={off}
          value={stand.rows}
          display={`${stand.rows} · ${Math.round(stand.rows / stand.tiers)} par étage`}
          onChange={(v) => updateStand(target, { rows: v })}
        />
        <SliderField
          label="Pente"
          hint="28° est la norme courante ; au-delà de 35° la tribune devient un mur"
          min={16}
          max={42}
          step={0.5}
          disabled={off}
          value={slope}
          display={`${fr1(slope)}°`}
          onChange={(v) => updateStand(target, { slopeAngleDeg: v })}
        />
        <FieldRow
          label="Pente des gradins"
          hint="Progressive : rangs bas plus plats, rangs hauts plus raides, même hauteur totale. Garde une bonne visibilité à chaque rang"
        >
          <Segmented
            label="Pente des gradins"
            size="sm"
            disabled={off}
            value={stand.rakeProfile ?? 'constant'}
            onChange={(rakeProfile) => updateStand(target, { rakeProfile })}
            options={[
              { id: 'constant', label: 'Constante' },
              { id: 'progressive', label: 'Progressive' },
            ]}
          />
        </FieldRow>
        <SliderField
          label={doc.pitch.hasTrack ? 'Recul depuis la piste' : 'Recul depuis le terrain'}
          hint={
            doc.pitch.hasTrack
              ? 'Mesuré depuis le bord extérieur de la piste : 0 m pose le pied de la tribune contre la piste'
              : undefined
          }
          min={doc.pitch.hasTrack ? 0 : MIN_PITCH_SETBACK}
          max={20}
          step={0.5}
          disabled={off}
          value={stand.distanceToPitch}
          display={`${fr1(stand.distanceToPitch)} m`}
          onChange={(v) => updateStand(target, { distanceToPitch: v })}
        />
        <SliderField
          label="Hauteur du premier rang"
          hint="Au-dessus du terrain. 0 m : premier rang au ras de la pelouse, à l'anglaise. Plus haut : un mur de front plus haut, et la tribune démarre au-dessus"
          min={0}
          max={10}
          step={0.1}
          disabled={off}
          value={stand.elevationStart}
          display={`${fr1(stand.elevationStart)} m`}
          onChange={(v) => updateStand(target, { elevationStart: v })}
        />
        <SliderField
          label="Profondeur de rang"
          min={0.72}
          max={0.95}
          step={0.01}
          disabled={off}
          value={stand.rowDepth}
          display={`${Math.round(stand.rowDepth * 100)} cm`}
          scale={100}
          onChange={(v) => updateStand(target, { rowDepth: v })}
        />
      </PanelSection>
      {stand.tiers >= 2 && (
        <PanelSection title="Étage par étage" defaultOpen={false} persistKey="stands:tiers">
            <SliderField
              label="Avancée en encorbellement"
              hint="Avance les étages supérieurs au-dessus des derniers rangs de l’étage inférieur ; la dalle remonte pour garder 2,4 m au-dessus des rangs abrités"
              min={0}
              max={7.5}
              step={0.25}
              disabled={off}
              value={tierOverhang}
              display={tierOverhang > 0 ? `+${fr1(tierOverhang)} m` : 'Aligné'}
              onChange={(v) => updateStand(target, { tierOverhang: v })}
            />
          <div className="flex items-center justify-between text-2xs">
            <span className="text-ink-faint">
              {hasAsymmetricTiers
                ? 'Profil indépendant actif par étage'
                : 'Réglage séparé des rangs, pentes et surplombs'}
            </span>
            {hasAsymmetricTiers && (
              <Button disabled={off} onClick={() => resetStandTiersUniform(target)}>
                Réuniformiser
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {resolvedTiers.map((tSpec) => (
              <div
                key={tSpec.tierIndex}
                className="p-2.5 rounded border border-line bg-canvas/50 space-y-2"
              >
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-medium text-ink">
                    Étage {tSpec.tierIndex + 1}
                    {tSpec.tierIndex === 0
                      ? ' (bas)'
                      : tSpec.tierIndex === resolvedTiers.length - 1
                      ? ' (haut)'
                      : ''}
                  </span>
                  <span className="text-2xs text-ink-faint tabular-nums">
                    {tSpec.rows} rangs · {fr1(tSpec.slopeAngleDeg)}° · marche{' '}
                    {Math.round(tSpec.riserHeight * 100)} cm
                  </span>
                </div>
                <SliderField
                  label={`Rangs (étage ${tSpec.tierIndex + 1})`}
                  min={4}
                  max={60}
                  step={1}
                  disabled={off}
                  value={tSpec.rows}
                  display={`${tSpec.rows} rangs`}
                  onChange={(r) =>
                    updateStandTier(target, tSpec.tierIndex, { rows: r })
                  }
                />
                <SliderField
                  label={`Pente (étage ${tSpec.tierIndex + 1})`}
                  min={16}
                  max={42}
                  step={0.5}
                  disabled={off}
                  value={tSpec.slopeAngleDeg}
                  display={`${fr1(tSpec.slopeAngleDeg)}°`}
                  onChange={(ang) =>
                    updateStandTier(target, tSpec.tierIndex, { slopeAngleDeg: ang })
                  }
                />
                {tSpec.tierIndex > 0 && (
                  <SliderField
                    label={`Encorbellement (étage ${tSpec.tierIndex + 1})`}
                    min={0}
                    max={7.5}
                    step={0.25}
                    disabled={off}
                    value={tSpec.overhang}
                    display={tSpec.overhang > 0 ? `+${fr1(tSpec.overhang)} m` : '0,0 m'}
                    onChange={(ov) =>
                      updateStandTier(target, tSpec.tierIndex, { overhang: ov })
                    }
                  />
                )}
              </div>
            ))}
          </div>
        </PanelSection>
      )}
      <PanelSection title="Circulations" persistKey="stands:circulation">
        <CrossAisleList
          aisles={crossAisles}
          tierCount={resolvedTiers.length}
          disabled={off}
          onChange={(list) =>
            updateStand(target, {
              crossAisles: list,
              crossAisle: undefined,
              crossAisleRatio: undefined,
              crossAisleWidth: undefined,
            })
          }
        />
        <SubGroup title="Vomitoires">
          <SliderField
            label="Nombre de vomitoires"
            hint="Ouvertures réelles découpées dans les gradins vers les coursives"
            min={0}
            max={10}
            step={1}
            disabled={off}
            value={vomSpec.count}
            display={vomSpec.count === 0 ? 'Aucun' : `${vomSpec.count} ouvertures`}
            onChange={(v) => updateStand(target, { vomitoryCount: v })}
          />
          <FieldRow
            label="Rangées par étage"
            hint="Plusieurs rangées de vomitoires superposées dans un même étage, pour un étage très haut comme un mur de Kop"
          >
            <Segmented
              label="Rangées de vomitoires par étage"
              size="sm"
              disabled={off || vomSpec.count === 0}
              value={vomSpec.levels}
              onChange={(v) => updateStand(target, { vomitoryLevels: v })}
              options={([1, 2, 3, 4] as const).map((n) => ({ id: n, label: String(n) }))}
            />
          </FieldRow>
          {vomSpec.count > 0 && vomSpec.levels > 1 && (
            <>
              {resolvedTiers.some((t) => vomitoryLevelsOfTier(stand, t.rows) < vomSpec.levels) && (
                <p className="text-2xs text-ink-muted">
                  {resolvedTiers
                    .map((t) => ({ t, n: vomitoryLevelsOfTier(stand, t.rows) }))
                    .filter(({ n }) => n < vomSpec.levels)
                    .map(({ t, n }) => `${resolvedTiers.length > 1 ? `Étage ${t.tierIndex + 1}` : 'L’étage'} : ${n} rangée${n > 1 ? 's' : ''} (${t.rows} rangs)`)
                    .join(' · ')}
                  {` — il faut ${VOMITORY_ROWS_PER_LEVEL} rangs par rangée de vomitoires.`}
                </p>
              )}
              <ToggleField
                label="En quinconce"
                hint="Chaque rangée de vomitoires décalée d’une demi-travée par rapport à celle du dessous"
                disabled={off}
                checked={vomSpec.staggered}
                onChange={(vomitoryStaggered) => updateStand(target, { vomitoryStaggered })}
              />
            </>
          )}
          <SliderField
            label="Position verticale"
            min={0.2}
            max={0.8}
            step={0.05}
            scale={100}
            disabled={off || vomSpec.count === 0}
            value={vomSpec.rowRatio}
            display={`${Math.round(vomSpec.rowRatio * 100)} % ${vomSpec.levels > 1 ? 'de chaque rangée' : 'de l’étage'}`}
            onChange={(v) => updateStand(target, { vomitoryRowRatio: v })}
          />
          <SliderField
            label="Décalage latéral"
            min={-0.25}
            max={0.25}
            step={0.05}
            scale={100}
            disabled={off || vomSpec.count === 0}
            value={vomSpec.offsetRatio}
            display={
              Math.abs(vomSpec.offsetRatio) < 0.01
                ? 'Centré'
                : `${vomSpec.offsetRatio > 0 ? '+' : ''}${Math.round(vomSpec.offsetRatio * 100)} %`
            }
            onChange={(v) => updateStand(target, { vomitoryOffsetRatio: v })}
          />
        </SubGroup>
        <SubGroup title="Escaliers">
          <SliderField
            label="Escaliers radiaux"
            min={0}
            max={16}
            step={1}
            disabled={off}
            value={stand.aisleCount}
            display={stand.aisleCount === 0 ? 'Aucun' : `${stand.aisleCount} volées`}
            onChange={(v) => updateStand(target, { aisleCount: v })}
          />
          <SliderField
            label="Largeur d’escalier"
            min={0.9}
            max={2.4}
            step={0.1}
            disabled={off || stand.aisleCount === 0}
            value={stand.aisleWidth}
            display={`${fr1(stand.aisleWidth)} m`}
            onChange={(v) => updateStand(target, { aisleWidth: v })}
          />
          <FieldRow
            label="Évacuation"
            hint="Étage le plus lent, 79 personnes par mètre et par minute (Green Guide : 8 min au plus)"
          >
            <span
              className={`tabular-nums ${sm.evacuationMinutes > 8 ? 'text-danger' : 'text-ink'}`}
            >
              {off ? '—' : `${fr1(sm.evacuationMinutes)} min`}
            </span>
          </FieldRow>
        </SubGroup>
      </PanelSection>
      <PanelSection title="Sièges" persistKey="stands:seats">
        <OptionList
          label="Type de places"
          disabled={off}
          value={stand.seatingType ?? 'seated'}
          onChange={(id) =>
            updateStand(target, {
              seatingType: id,
              ...(id === 'telescopic' && stand.distanceToPitch < 8.5 ? { distanceToPitch: 10.5 } : {}),
            })
          }
          options={SEATING_TYPE_OPTIONS.map((o) => ({ id: o.id, label: o.label, detail: o.desc }))}
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
          onChange={(v) => updateStand(target, { seatWidth: v })}
        />
        <GalleryPicker
          label="Finition des sièges"
          value={mats.seatFinish}
          onChange={(seatFinish) => updateMaterials({ seatFinish })}
          options={materialGallery(SEAT_MATERIAL_CATALOG)}
        />
        <ToggleField
          label="Sièges 3D individuels"
          hint="Désactive pour un rendu plus léger sur les machines modestes"
          checked={mats.seats3d !== false}
          onChange={(seats3d) => updateMaterials({ seats3d })}
        />
        <SubGroup title="Couleurs">
          <div className="grid grid-cols-2 gap-1" role="group" aria-label="Couleurs de club">
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
                  className={`flex items-center gap-2 min-h-8 px-2 py-1.5 text-left text-xs leading-snug ${choiceClass(current)} ${
                    current ? 'font-medium' : ''
                  }`}
                >
                  <SeatPaletteChip primary={pal.primary} secondary={pal.secondary} />
                  <span className="flex-1 min-w-0">{pal.label}</span>
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
            label="Couleur secondaire"
            value={doc.colors.seatsSecondary}
            onChange={(v) => updateColors({ seatsSecondary: v })}
          />
          <SeatTiersEditor editAll={editAll} side={side} />
        </SubGroup>
      </PanelSection>
      <PanelSection title="Équipements et habillage" persistKey="stands:fittings">
        <ToggleField
          label="Bancs de touche intégrés"
          hint="Abris des équipes encastrés dans le mur de front, de part et d’autre de la ligne médiane"
          disabled={off}
          checked={stand.dugouts === true}
          onChange={(dugouts) => updateStand(target, { dugouts })}
        />
        <ToggleField
          label="Tribune de presse"
          hint="Rangs centraux équipés de pupitres et d’écrans pour les journalistes"
          disabled={off}
          checked={stand.pressBox === true}
          onChange={(pressBox) => updateStand(target, { pressBox })}
        />
        {stand.tiers >= 2 && (
          <ToggleField
            label="Loges VIP entre les étages"
            disabled={off}
            checked={stand.vipLoges !== false}
            onChange={(v) => updateStand(target, { vipLoges: v })}
          />
        )}
        {separateStands && (
          <>
            <ToggleField
              label="Tifo aux couleurs du club"
              hint="Tous les supporters habillés en bandes diagonales des deux couleurs (public activé)"
              disabled={off || doc.materials?.crowd !== true}
              checked={stand.tifo === true}
              onChange={(tifo) => updateStand(target, { tifo })}
            />
            <ToggleField
              label="Banderoles de supporters"
              hint="Bâches aux couleurs du club sur le mur du terrain et les nez de balcon"
              disabled={off}
              checked={stand.banners === true}
              onChange={(banners) => updateStand(target, { banners })}
            />
            <ToggleField
              label="Gradins sur talus enherbé"
              hint="Gradins posés sur une butte de terre engazonnée, comme les petits stades et stades d’athlétisme"
              disabled={off}
              checked={stand.embankment === true}
              onChange={(embankment) => updateStand(target, { embankment })}
            />
          </>
        )}
      </PanelSection>
      {(separateStands || !editAll) && (
        <PanelSection
          title={separateStands ? 'Toit, structure et façade' : 'Tribune mobile et façade'}
          persistKey="stands:structure"
        >
          {!editAll && (
            <SliderField
              label="Tribune mobile : recul"
              hint="Tribune montée sur rails, reculée pour dégager une piste ou avancée au bord du terrain"
              disabled={off}
              min={0}
              max={15}
              step={0.5}
              value={stand.retractShift ?? 0}
              display={`${fr1(stand.retractShift ?? 0)} m`}
              onChange={(v) =>
                updateStand(target, {
                  retractShift: v,
                  distanceToPitch: Math.max(0, stand.distanceToPitch - (stand.retractShift ?? 0) + v),
                })
              }
            />
          )}
          {separateStands && (
            <>
              <SelectField
                label="Toiture"
                disabled={off}
                value={stand.roofStyleOverride ?? 'inherit'}
                onChange={(v) =>
                  updateStand(target, { roofStyleOverride: v === 'inherit' ? undefined : v })
                }
                options={STAND_ROOF_OVERRIDES}
              />
              <SelectField
                label="Structure"
                disabled={off}
                value={stand.structureMaterialOverride ?? 'inherit'}
                onChange={(v) =>
                  updateStand(target, {
                    structureMaterialOverride: v === 'inherit' ? undefined : v,
                  })
                }
                options={[
                  { id: 'inherit', label: 'Comme le stade' },
                  ...STRUCTURE_MATERIAL_CATALOG.map((o) => ({ id: o.id, label: o.label })),
                ]}
              />
            </>
          )}
          <SelectField
            label="Façade"
            disabled={off}
            value={stand.envelopeStyleOverride ?? 'inherit'}
            onChange={(v) => updateStand(target, { envelopeStyleOverride: v === 'inherit' ? undefined : v })}
            options={[
              { id: 'inherit', label: 'Comme le stade' },
              ...ENVELOPE_STYLE_CATALOG.map((o) => ({ id: o.id, label: o.label })),
            ]}
          />
          <SelectField
            label="Revêtement de façade"
            disabled={off}
            value={stand.facadeMaterialOverride ?? 'inherit'}
            onChange={(v) => updateStand(target, { facadeMaterialOverride: v === 'inherit' ? undefined : v })}
            options={[
              { id: 'inherit', label: 'Comme le stade' },
              ...FACADE_MATERIAL_CATALOG.map((o) => ({ id: o.id, label: o.label })),
            ]}
          />
        </PanelSection>
      )}
      <PanelSection title="Public" persistKey="stands:crowd">
        <ToggleField
          label="Spectateurs dans les tribunes"
          hint="Désactivé, les sièges restent vides"
          disabled={mats.seats3d === false}
          checked={mats.crowd === true}
          onChange={(crowd) => updateMaterials({ crowd })}
        />
        <SliderField
          label="Affluence"
          hint="Part des places occupées par des spectateurs"
          disabled={mats.seats3d === false || mats.crowd !== true}
          value={mats.crowdAttendance ?? 0.9}
          min={0}
          max={1}
          step={0.05}
          scale={100}
          display={`${Math.round((mats.crowdAttendance ?? 0.9) * 100)} %`}
          onChange={(crowdAttendance) => updateMaterials({ crowdAttendance })}
        />
      </PanelSection>
      <PanelSection title="Raccourcis" defaultOpen={false} persistKey="stands:shortcuts">
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            disabled={off}
            onClick={() =>
              updateStand('all', {
                rows: stand.rows,
                tiers: stand.tiers,
                slopeAngleDeg: slope,
                rowDepth: stand.rowDepth,
                riserHeight: stand.riserHeight,
                seatWidth: stand.seatWidth,
                distanceToPitch: stand.distanceToPitch,
                aisleCount: stand.aisleCount,
                aisleWidth: stand.aisleWidth,
                vomitoryCount: stand.vomitoryCount,
                vomitoryRowRatio: stand.vomitoryRowRatio,
                vomitoryOffsetRatio: stand.vomitoryOffsetRatio,
                vomitoryLevels: stand.vomitoryLevels,
                vomitoryStaggered: stand.vomitoryStaggered,
                tierOverhang: stand.tierOverhang,
                tierConfigs: stand.tierConfigs
                  ? stand.tierConfigs.map((tc) => ({ ...tc }))
                  : undefined,
              })
            }
          >
            Appliquer aux 4 tribunes
          </Button>
          <Button
            disabled={off}
            title={
              tallestOther > 0
                ? `Un seul étage monté jusqu’à ${fr1(tallestOther)} m, la hauteur de la plus haute tribune`
                : 'Un seul étage pleine hauteur'
            }
            onClick={() => convertStandToKopWall(target)}
          >
            Transformer en kop
          </Button>
        </div>
      </PanelSection>
    </>
  );
};

const COVERED_SIDE_ORDER: StandSide[] = ['north', 'south', 'east', 'west'];

const RoofPanel: React.FC = () => {
  const doc = useStadiumStore((s) => s.doc);
  const roof = doc.roof;
  const shape = doc.shape;
  const updateRoof = useStadiumStore((s) => s.updateRoof);
  const updateMaterials = useStadiumStore((s) => s.updateMaterials);
  const mats = useMemo(() => resolveStadiumMaterials(doc), [doc]);
  const none = roof.style === 'none';
  const covered = roof.coveredSides ?? COVERED_SIDE_ORDER;
  const skyMode = roof.skylightMode ?? 'none';
  const skyRatio = roof.skylightRatio ?? 0.35;
  const trusses = resolveCounterweightTrusses(roof);
  const cornerFrame = useMemo(() => {
    const m = calculateStadiumMetrics(doc);
    // Same floor as the roof builder's ring bounds.
    const maxStandH = Math.max(12, ...Object.values(m.stands).map((s) => s.maxHeight));
    return resolveCornerPylonFrame(doc.roof, maxStandH);
  }, [doc]);

  const toggleSide = (side: StandSide) => {
    const next = covered.includes(side) ? covered.filter((s) => s !== side) : [...covered, side];
    if (next.length === 0) return;
    updateRoof({ coveredSides: next.length === 4 ? undefined : COVERED_SIDE_ORDER.filter((s) => next.includes(s)) });
  };

  const baseShadowDensity = none ? 0 : computeRoofShadowDensity(mats.roof, roof.opacity);
  const skyOpenShare = skyMode === 'none' ? 0 : Math.min(0.68, skyRatio * 0.82);
  const solarTransmissionPct = none
    ? 100
    : Math.round(
        ((1 - baseShadowDensity) * (1 - skyOpenShare) + 0.94 * skyOpenShare) * 100
      );

  return (
    <>
      <PanelHeader title="Toit" meta={ROOF_OPTIONS.find((o) => o.id === roof.style)?.label} />
      <PanelSection title="Système de toiture">
        {isIntegralShell(roof.style) && (
          <p className="text-2xs text-ink-muted">
            Le toit fait partie de l’enveloppe « {ROOF_OPTIONS.find((o) => o.id === roof.style)?.label} » (onglet Façade).
            Choisir un toit ci-dessous la remplace par une façade classique.
          </p>
        )}
        <GalleryPicker
          label="Système de toiture"
          value={roof.style}
          onChange={(style) => updateRoof({ style })}
          options={ROOF_GALLERY}
        />
      </PanelSection>
      {roof.style === 'suspended_masts' && (
        <PanelSection title="Mâts et haubans">
          <SliderField
            label="Nombre de mâts"
            min={6}
            max={36}
            step={1}
            value={resolveSuspendedMasts(roof).mastCount}
            display={String(resolveSuspendedMasts(roof).mastCount)}
            onChange={(v) => updateRoof({ mastCount: v })}
          />
          <SliderField
            label="Hauteur des mâts au-dessus du toit"
            min={8}
            max={45}
            step={0.5}
            value={resolveSuspendedMasts(roof).mastHeight}
            display={`${resolveSuspendedMasts(roof).mastHeight} m`}
            onChange={(v) => updateRoof({ mastHeight: v })}
          />
        </PanelSection>
      )}
      {roof.style === 'concrete_portals' && (
        <PanelSection title="Portiques en béton">
          <SliderField
            label="Nombre de portiques"
            hint="Nervures réparties sur tout le pourtour du stade"
            min={24}
            max={72}
            step={1}
            value={resolvePortalCount(roof)}
            display={String(resolvePortalCount(roof))}
            onChange={(v) => updateRoof({ portalCount: v })}
          />
        </PanelSection>
      )}
      {roof.style === 'spanning_girders' && (
        <PanelSection title="Méga-poutres">
          <SliderField
            label="Nombre de méga-poutres"
            hint="Poutres transversales posées sur les murs, sous la couverture"
            min={2}
            max={6}
            step={1}
            value={resolveSpanningGirderCount(roof)}
            display={String(resolveSpanningGirderCount(roof))}
            onChange={(v) => updateRoof({ girderCount: v })}
          />
        </PanelSection>
      )}
      {roof.style === 'counterweighted_cantilever' && (
        <PanelSection title="Fermes à contre-poids">
          <SliderField
            label="Nombre de fermes"
            min={12}
            max={48}
            step={1}
            value={trusses.trussCount}
            display={String(trusses.trussCount)}
            onChange={(v) => updateRoof({ trussCount: v })}
          />
          <SliderField
            label="Longueur du contre-fléau"
            hint="Bras arrière ancré au sol, en part du bras côté terrain"
            min={0.3}
            max={0.7}
            step={0.01}
            value={trusses.backspanRatio}
            display={`${Math.round(trusses.backspanRatio * 100)} %`}
            scale={100}
            onChange={(v) => updateRoof({ backspanRatio: v })}
          />
        </PanelSection>
      )}
      {roof.style === 'corner_pylons' && (
        <PanelSection title="Pylônes et méga-poutres">
          <SliderField
            label="Hauteur des pylônes"
            hint="Au-dessus des poutres, des haubans relient la tête des pylônes aux poutres"
            min={Math.ceil(cornerFrame.girderTopY + 2)}
            max={CORNER_PYLON_MAX_HEIGHT}
            step={1}
            value={Math.round(cornerFrame.pylonTopY)}
            display={`${Math.round(cornerFrame.pylonTopY)} m`}
            onChange={(v) => updateRoof({ pylonHeight: v })}
          />
          <SliderField
            label="Bombement de la couverture"
            hint="Relève la couverture vers le terrain en dôme"
            min={0}
            max={25}
            step={1}
            value={cornerFrame.crownRise}
            display={`${cornerFrame.crownRise} m`}
            onChange={(v) => updateRoof({ crownRise: v })}
          />
          <ToggleField
            label="Résille en treillis 3D"
            checked={Boolean(roof.spaceFrame)}
            onChange={(v) => updateRoof({ spaceFrame: v })}
          />
        </PanelSection>
      )}
      {isMovableRoof(roof.style) && (
        <RetractableRoofSection
          retractable={resolveRetractable(roof)}
          iris={roof.style === 'petal_iris'}
          horseshoe={shape === 'horseshoe'}
          onChange={(patch) => updateRoof({ retractable: { ...roof.retractable, ...patch } })}
        />
      )}
      {isContinuousBowlShape(shape) && !none && (
        <PanelSection title="Tribunes couvertes">
          <div className="grid grid-cols-4 gap-1" role="group" aria-label="Tribunes couvertes">
            {COVERED_SIDE_ORDER.map((side) => {
              const on = covered.includes(side);
              return (
                <button
                  key={side}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleSide(side)}
                  className={`min-h-7 py-1 text-xs leading-tight ${choiceClass(on)} ${on ? 'font-medium' : ''}`}
                >
                  {STAND_LABELS[side]}
                </button>
              );
            })}
          </div>
          <p className="text-2xs text-ink-faint">
            Pour un toit seulement sur la tribune principale, ou sur les deux tribunes latérales.
          </p>
        </PanelSection>
      )}
      <PanelSection title="Couverture">
        <GalleryPicker
          label="Matériau de couverture"
          disabled={none}
          value={mats.roof}
          onChange={(r) => updateMaterials({ roof: r })}
          options={materialGallery(ROOF_MATERIAL_CATALOG)}
        />
        <SliderField
          label="Opacité"
          hint="Baissez pour du verre ou de l’ETFE translucide laissant filtrer le soleil sur la pelouse"
          min={0.15}
          max={1}
          step={0.05}
          disabled={none}
          value={roof.opacity}
          display={`${Math.round(roof.opacity * 100)} %`}
          scale={100}
          onChange={(v) => updateRoof({ opacity: v })}
        />
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="Vitrages rapides">
          <button
            type="button"
            disabled={none}
            onClick={() => {
              updateMaterials({ roof: 'polycarbonate_glass' });
              updateRoof({ opacity: 0.35 });
            }}
            className={`min-h-7 py-1 px-1.5 text-2xs leading-tight ${choiceClass(
              mats.roof === 'polycarbonate_glass' && roof.opacity <= 0.45
            )} disabled:opacity-40`}
          >
            Verre clair
          </button>
          <button
            type="button"
            disabled={none}
            onClick={() => {
              updateMaterials({ roof: 'etfe_cushions' });
              updateRoof({ opacity: 0.55 });
            }}
            className={`min-h-7 py-1 px-1.5 text-2xs leading-tight ${choiceClass(
              mats.roof === 'etfe_cushions' && roof.opacity <= 0.65
            )} disabled:opacity-40`}
          >
            Coussins ETFE
          </button>
          <button
            type="button"
            disabled={none}
            onClick={() => {
              updateMaterials({ roof: 'ptfe_membrane' });
              updateRoof({ opacity: 0.92 });
            }}
            className={`min-h-7 py-1 px-1.5 text-2xs leading-tight ${choiceClass(
              mats.roof === 'ptfe_membrane' && roof.opacity >= 0.85
            )} disabled:opacity-40`}
          >
            Membrane PTFE
          </button>
        </div>
      </PanelSection>
      <AdvancedSection tab="roof">
        <SubGroup title="Dimensions">
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
            disabled={none || roof.style === 'fixed_dome' || roof.style === 'air_dome' || roof.style === 'cable_dome'}
            value={roof.coverageRatio}
            display={`${Math.round(roof.coverageRatio * 100)} %`}
            scale={100}
            onChange={(v) => updateRoof({ coverageRatio: v })}
          />
        </SubGroup>
        <SubGroup title="Percées de lumière">
        <OptionList
          label="Percées de lumière"
          disabled={none}
          value={skyMode}
          onChange={(mode) =>
            updateRoof({
              skylightMode: mode,
              skylightRatio:
                mode !== 'none' && (!roof.skylightRatio || roof.skylightRatio < 0.1)
                  ? 0.35
                  : roof.skylightRatio,
            })
          }
          options={SKYLIGHT_MODE_CATALOG.map((o) => ({
            id: o.id,
            label: o.label,
            detail: o.subtitle,
          }))}
        />
        {skyMode !== 'none' && !none && (
          <SliderField
            label="Ouverture des percées"
            min={0.1}
            max={0.7}
            step={0.05}
            scale={100}
            value={skyRatio}
            display={`${Math.round(skyRatio * 100)} %`}
            onChange={(v) => updateRoof({ skylightRatio: v })}
          />
        )}
        <div className="flex items-baseline justify-between pt-1 text-xs">
          <span className="text-ink-muted">Lumière transmise sous toiture</span>
          <span className="text-ink tabular-nums">{solarTransmissionPct} %</span>
        </div>
        </SubGroup>
        <SubGroup title="Fermeture">
          <ToggleField
            label="Toit au-dessus de la coursive"
            hint="Prolonge le bord extérieur de la toiture jusqu’à la façade"
            disabled={none || (doc.concourse?.width ?? 0) <= 0}
            checked={roof.overConcourse !== false}
            onChange={(overConcourse) => updateRoof({ overConcourse })}
          />
          <ToggleField
            label="Fermer l’espace sous la toiture"
            hint="Habille d’une peau à lames le vide entre le haut de la façade (ou de la coursive) et le toit"
            disabled={none}
            checked={roof.enclosed !== false}
            onChange={(enclosed) => updateRoof({ enclosed })}
          />
          <ToggleField
            label="Pare-vent vitré"
            hint="Remplace la peau par des vitrages clairs entre les tribunes et le toit"
            disabled={none || roof.enclosed === false}
            checked={roof.enclosureGlazed === true}
            onChange={(enclosureGlazed) => updateRoof({ enclosureGlazed })}
          />
        </SubGroup>
        <SubGroup title="Charpente">
          <GalleryPicker
            label="Matériau de charpente"
            value={mats.structure}
            onChange={(structure) => updateMaterials({ structure })}
            options={materialGallery(STRUCTURE_MATERIAL_CATALOG)}
          />
        </SubGroup>
      </AdvancedSection>
    </>
  );
};

const RETRACTABLE_MOTION_OPTIONS: { id: RetractableMotion; label: string; desc: string }[] = [
  {
    id: 'slide_longitudinal',
    label: 'Coulissant dans l’axe',
    desc: 'Panneaux sur méga-poutres, empilés au-dessus des virages',
  },
  {
    id: 'slide_transverse',
    label: 'Coulissant en travers',
    desc: 'Panneaux qui s’écartent vers les tribunes latérales',
  },
  {
    id: 'slide_off',
    label: 'Toit qui sort du stade',
    desc: 'Le toit roule hors de l’enceinte sur des rails à chevalets',
  },
  {
    id: 'rotate_vertical',
    label: 'Secteurs pivotants',
    desc: 'Secteurs qui tournent autour d’un moyeu central et s’empilent',
  },
  {
    id: 'rotate_horizontal',
    label: 'Volets à charnière',
    desc: 'Volets articulés sur la couronne, relevés vers l’extérieur',
  },
  {
    id: 'iris',
    label: 'Iris à pétales',
    desc: 'Pétales qui pivotent sur la couronne comme un diaphragme',
  },
  {
    id: 'fold_central',
    label: 'Membrane repliée au centre',
    desc: 'Membrane sur câbles, ramenée vers un anneau central suspendu',
  },
  {
    id: 'fold_edge',
    label: 'Membrane en accordéon',
    desc: 'Fermes mobiles qui se regroupent en plissant la membrane',
  },
  {
    id: 'combined_stack',
    label: 'Coulissant et pivotant',
    desc: '3 panneaux s’empilent sur un panneau fixe, dont un en tournant',
  },
];

const PANEL_KIND_OPTIONS: { id: RetractablePanelKind; label: string }[] = [
  { id: 'rigid', label: 'Rigides' },
  { id: 'membrane', label: 'Membrane' },
  { id: 'mixed', label: 'Mixtes' },
];

const PARK_END_OPTIONS: { id: RetractableConfig['parkEnd']; label: string }[] = [
  { id: 'both', label: 'Deux côtés' },
  { id: 'east', label: 'Est' },
  { id: 'west', label: 'Ouest' },
];

/** One-click open / close of the movable roof, animated in the viewport. */
function RoofMotionButton({ openRatio, disabled }: { openRatio: number; disabled?: boolean }) {
  const motion = useStadiumStore((s) => s.roofMotion);
  const animateRoof = useStadiumStore((s) => s.animateRoof);
  const target = motion ? motion.to : openRatio >= 0.5 ? 0 : 1;
  const moving = motion !== null;
  return (
    <button
      type="button"
      disabled={disabled || moving}
      onClick={() => animateRoof(target)}
      className={`h-8 w-full text-xs font-medium ${choiceClass(false)} disabled:opacity-60`}
    >
      {moving ? (motion.to === 0 ? 'Fermeture…' : 'Ouverture…') : target === 0 ? 'Fermer le toit' : 'Ouvrir le toit'}
    </button>
  );
}

function RetractableRoofSection({
  retractable,
  iris,
  horseshoe,
  onChange,
}: {
  retractable: RetractableConfig;
  iris: boolean;
  horseshoe: boolean;
  onChange: (patch: Partial<RetractableConfig>) => void;
}) {
  const { motion, openRatio, panelCount, panelKind, panelMaterial, parkEnd, suspensionMast, mastPosition, pylonCount } =
    retractable;
  const limits = RETRACTABLE_PANEL_LIMITS[motion];
  const parks =
    motion === 'slide_longitudinal' || motion === 'slide_off' || motion === 'fold_edge';
  const countLabel =
    motion === 'fold_central' ? 'Câbles' : motion === 'fold_edge' ? 'Fermes mobiles' : 'Panneaux';
  return (
    <PanelSection title="Toit mobile">
      {horseshoe && (
        <p className="text-2xs text-ink-faint">
          Le fer à cheval n’a pas d’ouverture fermée : seule la couronne fixe est construite.
        </p>
      )}
      {!iris && (
        <OptionList
          label="Mouvement"
          value={motion}
          onChange={(m) => onChange({ motion: m, panelCount: RETRACTABLE_PANEL_LIMITS[m].def })}
          options={RETRACTABLE_MOTION_OPTIONS.map((o) => ({ id: o.id, label: o.label, detail: o.desc }))}
        />
      )}
      <SliderField
        label="Ouverture"
        min={0}
        max={1}
        step={0.05}
        value={openRatio}
        display={openRatio === 0 ? 'Fermé' : `${Math.round(openRatio * 100)} %`}
        scale={100}
        onChange={(v) => onChange({ openRatio: v })}
      />
      <RoofMotionButton openRatio={openRatio} disabled={horseshoe} />
      {limits.min < limits.max && (
        <SliderField
          label={countLabel}
          min={limits.min}
          max={limits.max}
          step={1}
          value={panelCount}
          display={String(panelCount)}
          onChange={(v) => onChange({ panelCount: v })}
        />
      )}
      {parks && (
        <Segmented
          label="Côté de rangement"
          value={parkEnd}
          options={PARK_END_OPTIONS}
          onChange={(v) => onChange({ parkEnd: v })}
        />
      )}
      {motion === 'fold_central' && (
        <FieldRow label="Mât porteur">
          <Segmented
            label="Mât porteur"
            size="sm"
            value={!suspensionMast ? 'none' : mastPosition}
            onChange={(v) =>
              onChange(v === 'none' ? { suspensionMast: false } : { suspensionMast: true, mastPosition: v })
            }
            options={[
              { id: 'none', label: 'Aucun' },
              { id: 'outside', label: 'Incliné' },
              { id: 'central', label: 'Aiguille' },
            ]}
          />
        </FieldRow>
      )}
      <SliderField
        label="Pylônes porteurs"
        hint="Pylônes inclinés autour du stade, qui tiennent la couronne fixe par des haubans"
        min={0}
        max={RETRACTABLE_MAX_PYLONS}
        step={1}
        value={pylonCount}
        display={pylonCount === 0 ? 'Aucun' : String(pylonCount)}
        onChange={(v) => onChange({ pylonCount: v })}
      />
      <Segmented
        label="Type de panneaux"
        value={panelKind}
        options={PANEL_KIND_OPTIONS}
        onChange={(v) => onChange({ panelKind: v })}
      />
      <GalleryPicker
        label="Matériau des panneaux"
        value={panelMaterial}
        onChange={(v) => onChange({ panelMaterial: v })}
        options={materialGallery(ROOF_MATERIAL_CATALOG)}
      />
    </PanelSection>
  );
}

const FacadePanel: React.FC = () => {
  const doc = useStadiumStore((s) => s.doc);
  const updateMaterials = useStadiumStore((s) => s.updateMaterials);
  const mats = useMemo(() => resolveStadiumMaterials(doc), [doc]);
  const pattern = mats.facadePattern ?? 'none';
  const density = mats.facadeDensity ?? 1.0;
  const depth = mats.facadeDepth ?? 0.85;
  const setEnvelope = useStadiumStore((s) => s.setEnvelope);
  const updateRoof = useStadiumStore((s) => s.updateRoof);
  const shell = isIntegralShell(doc.roof.style) ? doc.roof.style : null;
  const envelope = shell ?? mats.envelopeStyle ?? 'enveloping_skin';

  return (
    <>
      <PanelHeader title="Façade" meta={ENVELOPE_GALLERY.find((o) => o.id === envelope)?.label} />
      <PanelSection title="Enveloppe">
        <GalleryPicker
          label="Enveloppe extérieure"
          value={envelope}
          onChange={setEnvelope}
          options={ENVELOPE_GALLERY}
        />
        {shell && (
          <p className="text-2xs text-ink-faint">
            Coque intégrale : elle forme à la fois la façade et le toit. Choisis une autre enveloppe pour retrouver un toit séparé.
          </p>
        )}
        {shell === 'wave_canopy' && (
          <SliderField
            label="Amplitude de l’ondulation"
            hint="Écart de hauteur entre les creux et les crêtes de la peau"
            min={0}
            max={14}
            step={0.5}
            value={resolveWaveAmplitude(doc.roof)}
            display={`${resolveWaveAmplitude(doc.roof)} m`}
            onChange={(waveAmplitude) => updateRoof({ waveAmplitude })}
          />
        )}
        {envelope === 'colonnade_forest' && (
          <Segmented
            label="Forme des poteaux"
            size="sm"
            value={mats.colonnadeShape ?? 'straight'}
            onChange={(colonnadeShape) => updateMaterials({ colonnadeShape })}
            options={[
              { id: 'straight', label: 'Fûts droits' },
              { id: 'palm', label: 'Palmiers' },
            ]}
          />
        )}
        {envelope === 'colonnade_forest' && (
          <SliderField
            label="Densité des poteaux"
            hint="Jusqu’à 4 fois plus de poteaux, pour une vraie forêt"
            min={0.5}
            max={4}
            step={0.1}
            value={mats.colonnadeDensity ?? 1}
            display={`${fr1(mats.colonnadeDensity ?? 1)}×`}
            onChange={(colonnadeDensity) => updateMaterials({ colonnadeDensity })}
          />
        )}
        {isContinuousBowlShape(doc.shape) && envelope === 'enveloping_skin' && (
          <OptionList
            label="Silhouette de la peau"
            value={mats.envelopeProfile ?? 'straight'}
            onChange={(envelopeProfile) => updateMaterials({ envelopeProfile })}
            options={ENVELOPE_PROFILE_OPTIONS}
          />
        )}
        <SliderField
          label="Socle vitré en retrait"
          hint={
            (doc.concourse?.width ?? 0) > 0.5
              ? 'Sans coursive extérieure seulement : c’est elle qui forme la façade ici'
              : 'Hall vitré au pied du stade, l’enveloppe avance au-dessus sur une rangée de poteaux'
          }
          disabled={(doc.concourse?.width ?? 0) > 0.5}
          min={0}
          max={12}
          step={0.5}
          value={mats.plinthHeight ?? 0}
          display={(mats.plinthHeight ?? 0) >= 3 ? `${fr1(mats.plinthHeight ?? 0)} m` : 'Aucun'}
          onChange={(plinthHeight) => updateMaterials({ plinthHeight })}
        />
        {envelope === 'enveloping_skin' && (
          <>
            <SliderField
              label="Bandes verticales sombres"
              hint="Traits foncés qui montent le long de la peau, comme sur une calebasse"
              min={0}
              max={40}
              step={2}
              value={mats.facadeStripeSpacing ?? 0}
              display={(mats.facadeStripeSpacing ?? 0) >= 4 ? `tous les ${mats.facadeStripeSpacing} m` : 'Aucune'}
              onChange={(facadeStripeSpacing) => updateMaterials({ facadeStripeSpacing })}
            />
            <ToggleField
              label="Anneau lumineux en pied"
              hint="Bande orangée qui rougeoie au pied de la façade, surtout la nuit"
              checked={mats.facadeBaseGlow === true}
              onChange={(facadeBaseGlow) => updateMaterials({ facadeBaseGlow })}
            />
          </>
        )}
      </PanelSection>
      <PanelSection title="Matériau">
        <GalleryPicker
          label="Matériau de façade"
          value={mats.facade}
          onChange={(facade) => updateMaterials({ facade })}
          options={materialGallery(FACADE_MATERIAL_CATALOG)}
        />
        {mats.facade === 'etfe_cushions_facade' && (
          <ColorField
            label="Couleur d’éclairage la nuit"
            value={mats.facadeGlowHex ?? '#ffffff'}
            onChange={(facadeGlowHex) => updateMaterials({ facadeGlowHex })}
          />
        )}
      </PanelSection>
      <AdvancedSection tab="facade">
        <SubGroup title="Relief paramétrique">
        <OptionList
          label="Motif géométrique 3D"
          value={pattern}
          onChange={(facadePattern) => updateMaterials({ facadePattern })}
          options={FACADE_PATTERN_CATALOG.map((o) => ({
            id: o.id,
            label: o.label,
            detail: o.subtitle,
          }))}
        />
        {(pattern === 'pixel_mosaic' || pattern === 'woven_basket') && (
          <>
            {resolveFacadePalette(doc)
              .slice(0, pattern === 'woven_basket' ? 2 : 4)
              .map((hex, i) => (
                <ColorField
                  key={i}
                  label={pattern === 'woven_basket' ? `Bandes ${i === 0 ? 'montantes' : 'descendantes'}` : `Couleur ${i + 1}`}
                  value={hex}
                  onChange={(v) => {
                    const facadePalette = resolveFacadePalette(doc);
                    facadePalette[i] = v;
                    updateMaterials({ facadePalette });
                  }}
                />
              ))}
            {mats.facadePalette && (
              <button
                type="button"
                onClick={() => updateMaterials({ facadePalette: undefined })}
                className="text-2xs text-ink-faint underline underline-offset-2 hover:text-ink"
              >
                Revenir aux couleurs du club
              </button>
            )}
          </>
        )}
        <SliderField
          label="Densité du motif"
          min={0.4}
          max={2.2}
          step={0.1}
          disabled={pattern === 'none'}
          value={density}
          display={`${fr1(density)}×`}
          onChange={(facadeDensity) => updateMaterials({ facadeDensity })}
        />
        <SliderField
          label="Profondeur du relief"
          min={0.15}
          max={2.4}
          step={0.05}
          disabled={pattern === 'none'}
          value={depth}
          display={`${fr1(depth)} m`}
          onChange={(facadeDepth) => updateMaterials({ facadeDepth })}
        />
        {(pattern === 'triangulated_lace' || pattern === 'scales' || pattern === 'honeycomb' || pattern === 'voronoi') && (
          <SliderField
            label="Bombement de la façade"
            hint="La peau se bombe vers l’extérieur à mi-hauteur"
            min={0}
            max={1}
            step={0.05}
            value={mats.facadeBulge ?? 0}
            display={`${Math.round((mats.facadeBulge ?? 0) * 6 * 10) / 10} m`}
            onChange={(facadeBulge) => updateMaterials({ facadeBulge })}
          />
        )}
        </SubGroup>
      </AdvancedSection>
    </>
  );
};

export const SITE_OPTIONS: { id: SiteSetting; label: string; detail: string }[] = [
  { id: 'none', label: 'Aucun', detail: 'Sol d’origine, sans décor urbain ni paysager autour du stade' },
  { id: 'urban', label: 'Quartier urbain', detail: 'Maisons mitoyennes au ras du stade, à l’anglaise, le long d’une rue étroite' },
  { id: 'esplanade', label: 'Esplanade', detail: 'Grand parvis minéral planté, allées axiales et pelouses' },
  { id: 'park', label: 'Parc arboré', detail: 'Bosquets, chemins sinueux, étang et promenade sous les arbres' },
  { id: 'parking', label: 'Parkings', detail: 'Nappes de stationnement plantées, voie de ceinture et allées piétonnes' },
];

const SitePanel: React.FC = () => {
  const doc = useStadiumStore((s) => s.doc);
  const updateSite = useStadiumStore((s) => s.updateSite);
  const updateMaterials = useStadiumStore((s) => s.updateMaterials);
  const mats = useMemo(() => resolveStadiumMaterials(doc), [doc]);
  const site = resolveSite(doc);
  return (
    <>
      <PanelHeader title="Abords" meta={SITE_OPTIONS.find((o) => o.id === site.setting)?.label} />
      <PanelSection title="Cadre autour du stade">
        <OptionList
          label="Cadre autour du stade"
          value={site.setting}
          onChange={(setting) => updateSite({ setting })}
          options={SITE_OPTIONS}
        />
      </PanelSection>
      <PanelSection title="Parvis">
        <GalleryPicker
          label="Revêtement du parvis"
          value={mats.plazaSurface}
          onChange={(plazaSurface) => updateMaterials({ plazaSurface })}
          options={materialGallery(PLAZA_MATERIAL_CATALOG)}
        />
      </PanelSection>
      <PanelSection title="Socle">
        <SliderField
          label="Hauteur du socle"
          hint="Podium de commerces et parkings autour du stade, grand escalier au sud"
          min={0}
          max={14}
          step={0.5}
          value={site.podiumHeight}
          display={site.podiumHeight > 0.5 ? `${fr1(site.podiumHeight)} m` : 'Aucun'}
          onChange={(podiumHeight) => updateSite({ podiumHeight })}
        />
        <SliderField
          label="Butte paysagère"
          hint="Talus engazonné adossé à la façade, comme un stade posé sur une colline ; tranchées aux entrées"
          min={0}
          max={16}
          step={0.5}
          value={site.mound}
          display={site.mound > 0.5 ? `${fr1(site.mound)} m` : 'Aucune'}
          onChange={(mound) => updateSite({ mound })}
        />
        <FieldRow label="Plan d’eau">
          <Segmented
            label="Plan d’eau"
            size="sm"
            value={site.water}
            onChange={(water) => updateSite({ water })}
            options={[
              { id: 'none', label: 'Aucun' },
              { id: 'moat', label: 'Douves' },
              { id: 'waterfront', label: 'Bord de l’eau' },
            ]}
          />
        </FieldRow>
      </PanelSection>
      <PanelSection title="Accès et sécurité">
        <ToggleField
          label="Entrées à tourniquets"
          hint="Pavillons d’accès lettrés sur les axes du stade, avec billetterie"
          checked={site.entrances}
          onChange={(entrances) => updateSite({ entrances })}
        />
        <ToggleField
          label="Périmètre clôturé"
          hint="Grille anti-intrusion autour du parvis, ouverte à chaque entrée"
          checked={site.perimeterFence}
          onChange={(perimeterFence) => updateSite({ perimeterFence })}
        />
      </PanelSection>
    </>
  );
};

/** Pitch floodlights, set with the other equipment. */
const FloodlightSection: React.FC = () => {
  const rigMode = useStadiumStore((s) => resolveFloodlightRig(s.doc));
  const setFloodlightRig = useStadiumStore((s) => s.setFloodlightRig);
  return (
    <PanelSection title="Éclairage du terrain">
      <OptionList
        label="Système de projecteurs"
        value={rigMode}
        onChange={setFloodlightRig}
        options={FLOODLIGHT_RIG_CATALOG.map((o) => ({ id: o.id, label: o.label, detail: o.subtitle }))}
      />
    </PanelSection>
  );
};

export const Inspector: React.FC<{ tab: EditorTab }> = ({ tab }) => {
  switch (tab) {
    case 'shape':
      return <ShapePanel />;
    case 'pitch':
      return <PitchPanel />;
    case 'stands':
      return <StandsPanel />;
    case 'roof':
      return <RoofPanel />;
    case 'facade':
      return <FacadePanel />;
    case 'site':
      return <SitePanel />;
    case 'objects':
      return <ObjectList footer={<FloodlightSection />} />;
  }
};

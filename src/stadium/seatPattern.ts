import * as THREE from 'three';
import { SeatPattern, SeatTierStyle, StadiumDocument, StandConfig } from './schema';

/** A tier's seat style with every field filled in. */
export interface ResolvedSeatTierStyle {
  pattern: SeatPattern;
  color: string;
  accent: string;
  share: number;
  text: string;
}

/** Most tiers a stand can have. */
const MAX_TIERS = 5;

/**
 * Where a seat style is set, from the broadest to the most specific: the whole stadium, one tier
 * on every stand, one whole stand, one tier of one stand. A narrower level wins field by field.
 */
export type SeatStyleScope = 'stadium' | 'tier' | 'stand' | 'stand_tier';

export const SEAT_STYLE_SCOPES: readonly SeatStyleScope[] = ['stadium', 'tier', 'stand', 'stand_tier'];

/** The style set at `scope` for tier `tierIdx` of `stand`, if any. */
export function seatStyleAt(
  doc: StadiumDocument,
  stand: StandConfig,
  tierIdx: number,
  scope: SeatStyleScope
): SeatTierStyle | undefined {
  switch (scope) {
    case 'stadium':
      return doc.seatStyle ?? undefined;
    case 'tier':
      return doc.seatTierStyles?.[tierIdx] ?? undefined;
    case 'stand':
      return stand.seatStyle ?? undefined;
    case 'stand_tier':
      return stand.seatTiers?.[tierIdx] ?? undefined;
  }
}

/**
 * Style of tier `tierIdx` of `stand`, merging every level up to `upTo` (all of them by default).
 * Unset fields keep the stadium's club colours, alternating from one tier to the next as the
 * stands always did.
 */
export function resolveSeatTierStyle(
  doc: StadiumDocument,
  stand: StandConfig,
  tierIdx: number,
  upTo: SeatStyleScope = 'stand_tier'
): ResolvedSeatTierStyle {
  const own: SeatTierStyle = {};
  for (const scope of SEAT_STYLE_SCOPES.slice(0, SEAT_STYLE_SCOPES.indexOf(upTo) + 1)) {
    const layer = seatStyleAt(doc, stand, tierIdx, scope);
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) (own as Record<string, unknown>)[key] = value;
    }
  }
  const even = tierIdx % 2 === 0;
  const main = even ? doc.colors.seatsPrimary : doc.colors.seatsSecondary;
  const other = even ? doc.colors.seatsSecondary : doc.colors.seatsPrimary;
  return {
    pattern: own.pattern ?? 'solid',
    color: own.color ?? main,
    accent: own.accent ?? other,
    share: Math.max(0, Math.min(1, own.share ?? 0.25)),
    text: own.text ?? '',
  };
}

/** Where a seat sits in its tier, for its colour. */
export interface SeatSample {
  /** Across the stand, left to right as seen from the pitch (`0..1`). */
  u: number;
  /** Row within the tier, front row first. */
  rowInTier: number;
  rowsInTier: number;
  /** Length of the seat's row (m), so lettering keeps its proportions. */
  rowLength: number;
  /** Stable index of the seat, for the random patterns. */
  index: number;
}

/** Rows of a `stripes` band. */
const STRIPE_ROWS = 3;
/** Slope length of one row on the rake (m), for the lettering's proportions. */
const ROW_SLOPE_M = 0.9;

/** Deterministic value in `[0, 1)` from an integer. */
function hash01(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Colours seats tier by tier; build one per stand and call it for every seat. */
export function createSeatPainter(styles: ResolvedSeatTierStyle[]) {
  const colors = styles.map((s) => ({ main: new THREE.Color(s.color), accent: new THREE.Color(s.accent) }));
  const masks = new Map<string, LetteringMask | null>();
  return (tier: number, seat: SeatSample, out: THREE.Color): THREE.Color => {
    const t = Math.max(0, Math.min(styles.length - 1, tier));
    const style = styles[t];
    const { main, accent } = colors[t];
    const v = seat.rowsInTier > 1 ? seat.rowInTier / (seat.rowsInTier - 1) : 0;
    let useAccent = false;
    switch (style.pattern) {
      case 'mosaic':
        useAccent = hash01(seat.index) < style.share;
        break;
      case 'gradient':
        // Accent seats thicken toward the back rows, scattered rather than in bands.
        useAccent = hash01(seat.index) < v;
        break;
      case 'stripes':
        useAccent = Math.floor(seat.rowInTier / STRIPE_ROWS) % 2 === 1;
        break;
      case 'lettering': {
        if (!style.text.trim()) break;
        const aspect = seat.rowLength / Math.max(1, seat.rowsInTier * ROW_SLOPE_M);
        // Bucketed so every row of a tier shares one mask.
        const key = `${t}|${Math.round(aspect * 4) / 4}`;
        if (!masks.has(key)) masks.set(key, buildLetteringMask(style.text, aspect));
        const mask = masks.get(key);
        useAccent = mask ? mask.at(seat.u, v) : false;
        break;
      }
    }
    return out.copy(useAccent ? accent : main);
  };
}

export type SeatPainter = ReturnType<typeof createSeatPainter>;

/**
 * Painter for every tier of `stand`. Without `lettering` a lettered tier shows its main colour,
 * for pieces such as corners that carry a stand's colours but not its inscription.
 */
export function createStandSeatPainter(
  doc: StadiumDocument,
  stand: StandConfig,
  { lettering = true }: { lettering?: boolean } = {}
): SeatPainter {
  return createSeatPainter(
    Array.from({ length: MAX_TIERS }, (_, t) => {
      const style = resolveSeatTierStyle(doc, stand, t);
      return !lettering && style.pattern === 'lettering' ? { ...style, pattern: 'solid' as const } : style;
    })
  );
}

interface LetteringMask {
  /** Whether the letters cover point (`u` across, `v` front to back) of the tier. */
  at: (u: number, v: number) => boolean;
}

/**
 * Rasterises `text` in bold capitals, centred and as large as fits a tier `aspect` times wider
 * than it is tall. Null where no 2D canvas can be read back (tests, workers): seats stay plain.
 */
function buildLetteringMask(text: string, aspect: number): LetteringMask | null {
  if (typeof document === 'undefined') return null;
  const w = 512;
  const h = Math.max(12, Math.round(w / Math.max(1, aspect)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof ctx.getImageData !== 'function' || typeof ctx.measureText !== 'function') return null;
  const word = text.trim().toUpperCase();
  let size = h * 0.78;
  ctx.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  const width = ctx.measureText(word).width;
  if (width > w * 0.92) {
    size *= (w * 0.92) / width;
    ctx.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  }
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(word, w / 2, h / 2);
  const data = ctx.getImageData(0, 0, w, h).data;
  return {
    at: (u, v) => {
      const x = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
      // The back row is the top of the letters.
      const y = Math.min(h - 1, Math.max(0, Math.floor((1 - v) * h)));
      return data[(y * w + x) * 4 + 3] > 127;
    },
  };
}

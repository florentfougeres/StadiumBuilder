import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createPresetDocument } from '../presets';
import { createStandSeatPainter, resolveSeatTierStyle, SeatSample } from '../seatPattern';

const seat = (over: Partial<SeatSample> = {}): SeatSample => ({
  u: 0.5,
  rowInTier: 0,
  rowsInTier: 20,
  rowLength: 100,
  index: 0,
  ...over,
});

const hex = (c: THREE.Color) => `#${c.getHexString()}`;

describe('seat patterns', () => {
  it('keeps the club colours, alternating per tier, on tiers left unset', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    const stand = doc.stands.south;
    expect(resolveSeatTierStyle(doc, stand, 0).color).toBe(doc.colors.seatsPrimary);
    expect(resolveSeatTierStyle(doc, stand, 1).color).toBe(doc.colors.seatsSecondary);
    expect(resolveSeatTierStyle(doc, stand, 2).pattern).toBe('solid');
  });

  it('scatters about the requested share of accent seats in a mosaic', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    const stand = { ...doc.stands.south, seatTiers: [{ pattern: 'mosaic' as const, color: '#ff0000', accent: '#0000ff', share: 0.3 }] };
    const paint = createStandSeatPainter(doc, stand);
    const out = new THREE.Color();
    let accent = 0;
    for (let i = 0; i < 4000; i++) if (hex(paint(0, seat({ index: i }), out)) === '#0000ff') accent++;
    expect(accent / 4000).toBeGreaterThan(0.26);
    expect(accent / 4000).toBeLessThan(0.34);
  });

  it('bands rows in stripes and thickens the accent toward the back in a gradient', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    const stand = {
      ...doc.stands.south,
      seatTiers: [
        { pattern: 'stripes' as const, color: '#ffffff', accent: '#000000' },
        { pattern: 'gradient' as const, color: '#ffffff', accent: '#000000' },
      ],
    };
    const paint = createStandSeatPainter(doc, stand);
    const out = new THREE.Color();
    expect(hex(paint(0, seat({ rowInTier: 0 }), out))).toBe('#ffffff');
    expect(hex(paint(0, seat({ rowInTier: 3 }), out))).toBe('#000000');
    const share = (row: number) => {
      let n = 0;
      for (let i = 0; i < 2000; i++) if (hex(paint(1, seat({ rowInTier: row, index: i }), out)) === '#000000') n++;
      return n / 2000;
    };
    expect(share(2)).toBeLessThan(share(17));
  });
});

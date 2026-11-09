import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPresetDocument } from '../presets';
import { resolveSeatTierStyle } from '../seatPattern';
import { useStadiumStore } from '../../state/useStadiumStore';

describe('seat style scopes', () => {
  it('lets each narrower level win field by field over the broader ones', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    doc.seatStyle = { pattern: 'mosaic', color: '#111111', accent: '#222222' };
    doc.seatTierStyles = [undefined, { color: '#333333' }];
    doc.stands.north = { ...doc.stands.north, seatStyle: { accent: '#444444' }, seatTiers: [{ color: '#555555' }] };

    const south = doc.stands.south;
    expect(resolveSeatTierStyle(doc, south, 0)).toMatchObject({ pattern: 'mosaic', color: '#111111', accent: '#222222' });
    expect(resolveSeatTierStyle(doc, south, 1).color).toBe('#333333');

    const north = doc.stands.north;
    expect(resolveSeatTierStyle(doc, north, 0)).toMatchObject({ pattern: 'mosaic', color: '#555555', accent: '#444444' });
    expect(resolveSeatTierStyle(doc, north, 1)).toMatchObject({ color: '#333333', accent: '#444444' });
    // Up to a given level, the narrower ones are ignored (what that level's editor shows).
    expect(resolveSeatTierStyle(doc, north, 0, 'tier').accent).toBe('#222222');
  });

  it('keeps the alternating club colours when no level is set', () => {
    const doc = createPresetDocument('bowl_bowstring_60k');
    expect(resolveSeatTierStyle(doc, doc.stands.east, 1).color).toBe(doc.colors.seatsSecondary);
  });
});

describe('seat style store actions', () => {
  beforeEach(() => {
    // The store autosaves on a browser timer; nothing is saved in tests.
    vi.stubGlobal('window', { setTimeout: () => 0, clearTimeout: () => undefined });
    useStadiumStore.setState({ doc: createPresetDocument('bowl_bowstring_60k') });
  });

  it('writes and removes each level', () => {
    const { updateSeatStyle } = useStadiumStore.getState();
    updateSeatStyle('stadium', 'all', 0, { color: '#101010' });
    updateSeatStyle('tier', 'all', 2, { pattern: 'stripes' });
    updateSeatStyle('stand', 'north', 0, { pattern: 'lettering', text: 'CITY' });
    updateSeatStyle('stand_tier', 'west', 1, { color: '#202020' });
    let doc = useStadiumStore.getState().doc;
    expect(doc.seatStyle?.color).toBe('#101010');
    expect(doc.seatTierStyles?.[2]?.pattern).toBe('stripes');
    expect(doc.stands.north.seatStyle?.text).toBe('CITY');
    expect(doc.stands.south.seatStyle).toBeUndefined();
    expect(doc.stands.west.seatTiers?.[1]?.color).toBe('#202020');

    useStadiumStore.getState().updateSeatStyle('stand', 'north', 0, null);
    doc = useStadiumStore.getState().doc;
    expect(doc.stands.north.seatStyle).toBeUndefined();
  });

  it('paints over the levels that would win, so the last paint shows', () => {
    const { updateSeatStyle } = useStadiumStore.getState();
    updateSeatStyle('stand_tier', 'north', 0, { color: '#303030', pattern: 'stripes' });
    updateSeatStyle('stand', 'north', 0, { color: '#202020' });
    let doc = useStadiumStore.getState().doc;
    // The cell keeps its stripes but takes the stand's new colour.
    expect(doc.stands.north.seatTiers?.[0]).toEqual({ pattern: 'stripes' });
    expect(resolveSeatTierStyle(doc, doc.stands.north, 0).color).toBe('#202020');

    // A tier painted on every stand wins on that tier, the stand keeps its colour elsewhere.
    updateSeatStyle('tier', 'all', 1, { color: '#101010' });
    doc = useStadiumStore.getState().doc;
    expect(resolveSeatTierStyle(doc, doc.stands.north, 1).color).toBe('#101010');
    expect(resolveSeatTierStyle(doc, doc.stands.north, 0).color).toBe('#202020');
    expect(resolveSeatTierStyle(doc, doc.stands.north, 2).color).toBe('#202020');

    updateSeatStyle('stadium', 'all', 0, { color: '#000000' });
    doc = useStadiumStore.getState().doc;
    for (const side of ['north', 'south', 'east', 'west'] as const) {
      for (const t of [0, 1, 2]) expect(resolveSeatTierStyle(doc, doc.stands[side], t).color).toBe('#000000');
    }
    expect(resolveSeatTierStyle(doc, doc.stands.north, 0).pattern).toBe('stripes');
  });

  it('returns every seat to the club colours when they change', () => {
    const { updateSeatStyle, setClubColors } = useStadiumStore.getState();
    updateSeatStyle('stand', 'east', 0, { color: '#123456', pattern: 'mosaic' });
    setClubColors({ seatsPrimary: '#ff0000', seatsSecondary: '#ffffff' });
    const doc = useStadiumStore.getState().doc;
    expect(resolveSeatTierStyle(doc, doc.stands.east, 0)).toMatchObject({ color: '#ff0000', pattern: 'mosaic' });
  });
});

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

  it('clears only the levels narrower than the one edited', () => {
    const { updateSeatStyle, clearNarrowerSeatStyles } = useStadiumStore.getState();
    updateSeatStyle('tier', 'all', 0, { color: '#101010' });
    updateSeatStyle('stand', 'north', 0, { color: '#202020' });
    updateSeatStyle('stand_tier', 'north', 0, { color: '#303030' });
    updateSeatStyle('stand_tier', 'north', 1, { color: '#404040' });

    clearNarrowerSeatStyles('stand', 'north', 0);
    let doc = useStadiumStore.getState().doc;
    expect(doc.stands.north.seatStyle?.color).toBe('#202020');
    expect(doc.stands.north.seatTiers).toBeUndefined();

    updateSeatStyle('stand_tier', 'north', 1, { color: '#404040' });
    clearNarrowerSeatStyles('tier', 'all', 0);
    doc = useStadiumStore.getState().doc;
    expect(doc.seatTierStyles?.[0]?.color).toBe('#101010');
    expect(doc.stands.north.seatStyle).toBeUndefined();
    expect(doc.stands.north.seatTiers?.[1]?.color).toBe('#404040');

    clearNarrowerSeatStyles('stadium', 'all', 0);
    doc = useStadiumStore.getState().doc;
    expect(doc.seatTierStyles).toBeUndefined();
    expect(doc.stands.north.seatTiers).toBeUndefined();
  });
});

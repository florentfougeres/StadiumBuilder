import { beforeEach, describe, expect, it } from 'vitest';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
});

describe('wheel mode', () => {
  it('defaults to auto, remembers a forced choice and reads it back after a reload', async () => {
    const { getWheelMode, setWheelMode } = await import('../../editor/wheelMode');
    expect(getWheelMode()).toBe('auto');
    setWheelMode('zoom');
    expect(getWheelMode()).toBe('zoom');
    expect(store.get('stadiumforge.wheelMode')).toBe('zoom');
  });
});

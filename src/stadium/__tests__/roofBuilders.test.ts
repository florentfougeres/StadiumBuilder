import { describe, expect, it } from 'vitest';
import { ARENA_ROOF_BUILDERS } from '../generateRoof';
import { roofDefinition, ROOF_STYLES } from '../roofCatalog';

describe('roof builders', () => {
  it('every whole-arena roof in the catalog has a builder', () => {
    const missing = ROOF_STYLES.filter((s) => roofDefinition(s).placement === 'arena' && !ARENA_ROOF_BUILDERS[s]);
    expect(missing).toEqual([]);
  });

  it('only whole-arena roofs are built as one roof', () => {
    const stray = Object.keys(ARENA_ROOF_BUILDERS).filter(
      (s) => roofDefinition(s as keyof typeof ARENA_ROOF_BUILDERS).placement !== 'arena'
    );
    expect(stray).toEqual([]);
  });

  it('integral shells are whole-arena roofs', () => {
    const shells = ROOF_STYLES.filter((s) => roofDefinition(s).integralShell);
    expect(shells.length).toBeGreaterThan(0);
    for (const s of shells) expect(roofDefinition(s).placement, s).toBe('arena');
  });
});

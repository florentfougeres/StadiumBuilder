import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D } from '../buildStadiumScene';
import { CORNER_STRUCTURES } from '../corners';
import { generateStandsGroup } from '../generateStand';
import { CORNER_MODE_CATALOG } from '../materials';
import { createPresetDocument } from '../presets';
import type { CornerMode } from '../schema';

/** Textures are drawn on a canvas: any 2D call is a no-op here. */
if (typeof document === 'undefined') {
  const noop = () => ({ addColorStop: () => {} });
  const context = new Proxy({}, { get: () => noop, set: () => true });
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({ width: 1024, height: 512, getContext: () => context }),
  };
}

/** Modes whose corner is empty or carries on the stands' own rows. */
const NO_STRUCTURE: CornerMode[] = ['open', 'filled'];

describe('corner structures', () => {
  it('every corner mode offered in the editor is built', () => {
    const missing = CORNER_MODE_CATALOG.map((c) => c.id).filter((m) => !NO_STRUCTURE.includes(m) && !CORNER_STRUCTURES[m]);
    expect(missing).toEqual([]);
  });

  for (const mode of Object.keys(CORNER_STRUCTURES) as CornerMode[]) {
    it(`draws a ${mode} in each corner of separate stands`, () => {
      const doc = createPresetDocument('traditional_four_stands_42k');
      doc.shape = 'english_rectangular';
      doc.cornerFill = true;
      doc.corners = { nw: mode, ne: mode, sw: mode, se: mode };
      const group = generateStandsGroup(doc);
      const found = new Set<string>();
      group.traverse((o: THREE.Object3D) => {
        const m = /^Corner\w+_(NW|NE|SW|SE)$/.exec(o.name);
        if (m) found.add(m[1]);
      });
      disposeObject3D(group);
      expect([...found].sort()).toEqual(['NE', 'NW', 'SE', 'SW']);
    });
  }
});

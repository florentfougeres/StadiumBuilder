import * as THREE from 'three';
import { createRailSampler, railStations, slab, verticals } from './rail';
import { dressingGroup, place } from './dressingKit';
import type { EnvelopeDrawer } from './types';

/**
 * `colonnade_forest`: behind the stands, a recessed glazed core, a deep cornice and three
 * staggered rows of slender columns (density adjustable); in front of a wall, two staggered rows.
 */
export const colonnadeForest: EnvelopeDrawer = {
  stand({ rail, closed, mats, structureMat, loft, wall, add }) {
    add(wall(-1.6, 0.8), loft(slab(-1.6, 6, 0.95, (pt) => pt.yTop - 0.8), structureMat));
    const spacing = 4.2 / Math.max(0.5, Math.min(4, mats.colonnadeDensity ?? 1));
    const colGeo = new THREE.CylinderGeometry(0.21, 0.24, 1, 10);
    [0.2, 2.5, 4.8].forEach((out, r) => {
      add(verticals(railStations(rail, closed, spacing, r % 2 ? 0.5 : 0), out, colGeo, structureMat, 'EnvelopeColonnade'));
    });
  },
  dressing(p) {
  const rail = createRailSampler(p.samples, p.closed);
  if (!rail) return null;
  const { totalLen, sampleAtArc } = rail;
  const closed = p.closed;
    const columns: THREE.Matrix4[] = [];
    const count = Math.max(4, Math.round(totalLen / 2.4));
    const step = totalLen / count;
    for (let i = 0; i < count; i++) {
      for (const [out, shift] of [
        [1.8, 0],
        [3.6, 0.5],
      ] as const) {
        const pt = sampleAtArc(((closed ? i : i + 0.5) + shift) * step);
        const h = pt.yTop - pt.yBottom;
        if (h < 0.8) continue;
        columns.push(place(pt, out, pt.yBottom + h / 2, 0.36, h, 0.36));
      }
    }
    return dressingGroup([['EnvelopePrimary', columns]], p.frameMat);
  },
};

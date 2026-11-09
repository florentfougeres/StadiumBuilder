import { createStrut } from '../meshKit';
import { createRailSampler, railPoint, railStations, slab, strutMatrix } from './rail';
import { dressingGroup, place } from './dressingKit';
import type { EnvelopeDrawer } from './types';
import * as THREE from 'three';

/** Round member slightly flared at its foot. */
const strut = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) => createStrut(a, b, r, r * 1.15, mat);

/**
 * `exposed_structure`: no skin. Behind the stands, raker frames under the open soffit, an elevated
 * walkway and stair flights outside; in front of a wall, deep columns with crossed bracing.
 */
export const exposedStructure: EnvelopeDrawer = {
  lobby: false,
  stand({ rail, closed, structureMat, concreteMat, loft, add }) {
    const depthOf = (pt: (typeof rail)[number]) => pt.depth ?? 20;
    const concY = (pt: (typeof rail)[number]) => Math.min(pt.yTop - 2.5, Math.max(pt.yBottom + 4.2, pt.yTop * 0.42));
    add(
      loft((pt) => {
        const mid = -depthOf(pt) * 0.28;
        const half = Math.max(3.5, depthOf(pt) * 0.36) / 2;
        return slab(mid - half, mid + half, 0.42, (p) => concY(p) - 0.42)(pt);
      }, concreteMat)
    );
    const bays = railStations(rail, closed, 8.5);
    bays.forEach((pt, i) => {
      const depth = depthOf(pt);
      add(
        strut(railPoint(pt, -depth * 0.72, Math.max(0.2, pt.yBottom * 0.4)), railPoint(pt, -0.4, pt.yTop - 1.2), 0.36, structureMat),
        strut(railPoint(pt, -0.4, pt.yBottom), railPoint(pt, -0.4, pt.yTop), 0.34, structureMat),
        strut(
          railPoint(pt, -depth * 0.42, pt.yBottom),
          railPoint(pt, -depth * 0.42, Math.max(pt.yBottom + 1.5, pt.yTop * 0.48)),
          0.28,
          structureMat
        )
      );
      const next = bays[i + 1] ?? (closed ? bays[0] : null);
      if (i % 2 === 0 && next && pt.yTop - pt.yBottom > 6) {
        add(strut(railPoint(pt, 0.8, pt.yBottom + 0.2), railPoint(next, 0.8, concY(next)), 0.4, concreteMat));
        if (next.yTop - concY(next) > 4.5) {
          add(strut(railPoint(next, 1.5, concY(next)), railPoint(pt, 0.4, pt.yTop - 1.8), 0.38, concreteMat));
        }
      }
    });
  },
  dressing(p) {
  const rail = createRailSampler(p.samples, p.closed);
  if (!rail) return null;
  const { totalLen, sampleAtArc } = rail;
  const closed = p.closed;
    const columns: THREE.Matrix4[] = [];
    const bracing: THREE.Matrix4[] = [];
    const count = Math.max(4, Math.round(totalLen / 9));
    const step = totalLen / count;
    for (let i = 0; i < count; i++) {
      const s = closed ? i * step : (i + 0.5) * step;
      const pt = sampleAtArc(s);
      const h = pt.yTop - pt.yBottom;
      if (h < 0.8) continue;
      columns.push(place(pt, 0.9, pt.yBottom + h / 2, 0.7, h, 1.1));
      if (!closed && i === count - 1) continue;
      const next = sampleAtArc(closed ? ((i + 1) % count) * step : s + step);
      if (next.yTop - next.yBottom < 0.8) continue;
      bracing.push(
        strutMatrix(railPoint(pt, 0.9, pt.yBottom), railPoint(next, 0.9, next.yTop), 0.32),
        strutMatrix(railPoint(pt, 0.9, pt.yTop), railPoint(next, 0.9, next.yBottom), 0.32),
        // Ring beam along the top of the bay.
        strutMatrix(railPoint(pt, 0.9, pt.yTop - 0.2), railPoint(next, 0.9, next.yTop - 0.2), 0.45)
      );
    }
    return dressingGroup(
      [
        ['EnvelopePrimary', columns],
        ['EnvelopeSecondary', bracing],
      ],
      p.frameMat
    );
  },
};

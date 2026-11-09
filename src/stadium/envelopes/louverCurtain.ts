import * as THREE from 'three';
import { createRailSampler } from './rail';
import { dressingGroup, place } from './dressingKit';
import type { EnvelopeDrawer } from './types';

/**
 * `louver_curtain`: horizontal brise-soleil blades, in front of a glazed core behind the stands,
 * hung on slim vertical hangers in front of a wall.
 */
export const louverCurtain: EnvelopeDrawer = {
  stand({ rail, structureMat, loft, wall, add }) {
    add(wall(-0.2, 0.3));
    const levels = Math.max(5, Math.floor(Math.max(...rail.map((pt) => pt.yTop - pt.yBottom)) / 2.2));
    for (let l = 0; l < levels; l++) {
      const f = l / Math.max(1, levels - 1);
      add(
        loft((pt) => {
          const y = pt.yBottom + 2.6 + f * Math.max(1, pt.yTop - pt.yBottom - 3);
          return [
            [0.5, y - 0.18],
            [1.8, y + 0.18],
            [1.8, y + 0.26],
            [0.5, y - 0.1],
            [0.5, y - 0.18],
          ];
        }, structureMat)
      );
    }
  },
  dressing(p) {
  const rail = createRailSampler(p.samples, p.closed);
  if (!rail) return null;
  const { totalLen, sampleAtArc } = rail;
  const closed = p.closed;
    const blades: THREE.Matrix4[] = [];
    const hangers: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();
    const count = Math.max(4, Math.round(totalLen / 3));
    const step = totalLen / count;
    for (let i = 0; i < count; i++) {
      const pt = sampleAtArc(closed ? i * step : (i + 0.5) * step);
      const h = pt.yTop - pt.yBottom;
      if (h < 0.8) continue;
      hangers.push(place(pt, 1.1, pt.yBottom + h / 2, 0.08, h, 0.6));
      for (let y = pt.yBottom + 0.55; y < pt.yTop - 0.2; y += 0.85) {
        dummy.position.set(pt.x + pt.nx * 1.1, y, pt.z + pt.nz * 1.1);
        dummy.rotation.set(-0.35, Math.atan2(pt.nx, pt.nz), 0, 'YXZ');
        dummy.scale.set(step * 1.01, 0.05, 0.75);
        dummy.updateMatrix();
        blades.push(dummy.matrix.clone());
      }
    }
    return dressingGroup(
      [
        ['EnvelopePrimary', blades],
        ['EnvelopeSecondary', hangers],
      ],
      p.frameMat
    );
  },
};

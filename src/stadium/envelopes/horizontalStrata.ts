import * as THREE from 'three';
import { createRailSampler, type FacadeRailSample, instancedBoxes, slabMatrix } from './rail';
import { dressedSkin } from './skin';

/** Storey height (m) of the stacked balcony strata. */
const STRATA_STOREY = 4.2;

/**
 * Horizontal strata: a balcony slab at every storey projecting from the wall, its depth swelling
 * and receding along the facade, alternately closed by a solid upstand and left open behind a
 * slim rail, so the elevation reads as bands of varied openness.
 */
function buildHorizontalStrata(samples: FacadeRailSample[], closed: boolean, facadeMat: THREE.Material, frameMat: THREE.Material): THREE.Group | null {
  const rail = createRailSampler(samples, closed);
  if (!rail) return null;
  const { totalLen, sampleAtArc } = rail;
  const segs = Math.max(8, Math.round(totalLen / 3));
  const slabs: THREE.Matrix4[] = [];
  const upstands: THREE.Matrix4[] = [];
  const rails: THREE.Matrix4[] = [];
  // Whole waves around a closed ring so the swell meets itself.
  const waves = Math.max(1, Math.round(totalLen / 60));
  const at = (s: number, y: number, out: number) => {
    const pt = sampleAtArc(closed ? s % totalLen : s);
    return new THREE.Vector3(pt.x + pt.nx * out, y, pt.z + pt.nz * out);
  };
  const ref = sampleAtArc(0);
  const levels = Math.max(1, Math.floor((ref.yTop - ref.yBottom - 1) / STRATA_STOREY));
  for (let l = 1; l <= levels; l++) {
    const solid = l % 2 === 0;
    for (let i = 0; i < segs; i++) {
      const s0 = (i / segs) * totalLen;
      const s1 = ((i + 1) / segs) * totalLen;
      const mid = sampleAtArc(closed ? ((s0 + s1) / 2) % totalLen : (s0 + s1) / 2);
      const y = mid.yBottom + l * STRATA_STOREY;
      if (y > mid.yTop - 0.6) continue;
      const depth = 1.4 + 1.1 * Math.sin(((s0 + s1) / 2 / totalLen) * Math.PI * 2 * waves + l * 1.1);
      const out = depth / 2 + 0.3;
      slabs.push(slabMatrix(at(s0, y, out), at(s1, y, out), depth, 0.3));
      const edge = depth + 0.3;
      if (solid) upstands.push(slabMatrix(at(s0, y + 0.6, edge), at(s1, y + 0.6, edge), 0.2, 1.0));
      else rails.push(slabMatrix(at(s0, y + 1.05, edge), at(s1, y + 1.05, edge), 0.08, 0.08));
    }
  }
  const group = new THREE.Group();
  group.name = 'EnvelopeHorizontalStrata';
  for (const mesh of [
    instancedBoxes('StrataSlabs', slabs, facadeMat),
    instancedBoxes('StrataUpstands', upstands, facadeMat),
    instancedBoxes('StrataRails', rails, frameMat),
  ]) {
    if (mesh) group.add(mesh);
  }
  return group.children.length > 0 ? group : null;
}

/** `horizontal_strata`: stacked balcony slabs, swelling in depth, alternately closed and open. */
export const horizontalStrata = dressedSkin((p) =>
  buildHorizontalStrata(p.samples, p.closed, p.facadeMat ?? p.frameMat, p.frameMat)
);

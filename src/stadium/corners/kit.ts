import * as THREE from 'three';
import type { RectangularCornerSpec } from '../bowlRing';
import type { StadiumDocument, StandSide } from '../schema';

/** Everything a corner structure needs: the corner, the stands it joins, and the stadium's materials. */
export interface CornerStructureContext {
  doc: StadiumDocument;
  corner: RectangularCornerSpec;
  /** Depth (front to back, m) and crest height (m) of a stand's section as built. */
  section: (side: StandSide) => { totalDepth: number; topHeight: number };
  concreteMat: THREE.MeshStandardMaterial;
  facadeMat: THREE.Material;
  structureMat: THREE.Material;
  turnstileTex: THREE.CanvasTexture;
}

export type CornerStructureBuilder = (ctx: CornerStructureContext) => THREE.Group;

/** Section used when neither stand of a corner is built (m). */
const NO_STAND = { depth: 20, height: 18 };

/**
 * Depth and height of the corner at its two ends: those of the stand on each side, or of the stand
 * the corner join keeps all along, or of the other stand where one is not built.
 */
export function cornerEnds(ctx: CornerStructureContext): {
  a: { depth: number; height: number };
  b: { depth: number; height: number };
} {
  const { doc, corner } = ctx;
  const end = (side: StandSide) => {
    if (!doc.stands[side].enabled) return null;
    const s = ctx.section(side);
    return { depth: s.totalDepth, height: s.topHeight };
  };
  const a = end(corner.follow ?? corner.sideA);
  const b = end(corner.follow ?? corner.sideB);
  return { a: a ?? b ?? NO_STAND, b: b ?? a ?? NO_STAND };
}

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildEnvelopeDressing, buildStandEnvelope, ENVELOPE_DRAWERS } from '../envelopes';
import type { FacadeRailSample } from '../envelopes/rail';
import { ENVELOPE_STYLE_CATALOG, resolveStadiumMaterials } from '../materials';
import { createPresetDocument } from '../presets';

/** Textures are drawn on a canvas: any 2D call is a no-op here. */
if (typeof document === 'undefined') {
  const noop = () => ({ addColorStop: () => {} });
  const context = new Proxy({}, { get: () => noop, set: () => true });
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({ width: 1024, height: 512, getContext: () => context }),
  };
}

/** A straight 80 m facade line, 24 m tall, behind 30 m deep stands. */
const rail: FacadeRailSample[] = Array.from({ length: 9 }, (_, i) => ({
  x: -40 + i * 10,
  z: 60,
  nx: 0,
  nz: 1,
  yBottom: 0,
  yTop: 24,
  depth: 30,
}));

const meshCount = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) n++;
  });
  return n;
};

describe('envelope styles', () => {
  it('every catalog style has a drawer, and every drawer a catalog entry', () => {
    expect(Object.keys(ENVELOPE_DRAWERS).sort()).toEqual(ENVELOPE_STYLE_CATALOG.map((e) => e.id).sort());
  });

  for (const { id } of ENVELOPE_STYLE_CATALOG) {
    it(`${id} draws behind the stands and in front of a wall`, () => {
      const doc = createPresetDocument('traditional_four_stands_42k');
      doc.materials = { ...resolveStadiumMaterials(doc), envelopeStyle: id, facade: 'glass_curtain', facadePattern: 'none' };
      const mat = new THREE.MeshStandardMaterial();
      const stand = buildStandEnvelope({
        doc,
        rail,
        closed: false,
        facadeMat: mat,
        structureMat: mat,
        concreteMat: mat,
        turnstileTex: new THREE.Texture(),
      });
      expect(meshCount(stand)).toBeGreaterThan(1);
      const dressing = buildEnvelopeDressing({ style: id, samples: rail, closed: false, frameMat: mat, facadeMat: mat });
      expect(dressing && meshCount(dressing)).toBeGreaterThan(0);
    });
  }
});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildStadiumSceneGraph, disposeObject3D } from '../buildStadiumScene';
import { createPresetDocument, STADIUM_PRESETS } from '../presets';

/** Textures are drawn on a canvas: any 2D call is a no-op here. */
if (typeof document === 'undefined') {
  const noop = () => ({ addColorStop: () => {}, width: 0 });
  const imageData = (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
  const context = new Proxy({}, { get: (_t, key) => (key === 'getImageData' || key === 'createImageData' ? imageData : noop), set: () => true });
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({ width: 1024, height: 512, getContext: () => context }),
  };
}

/**
 * Triangles drawn from the overview (far levels of the distance LODs). Today's heaviest example
 * draws about 5.6 million; a regression that brings back full-detail crowds would double that.
 */
const MAX_OVERVIEW_TRIANGLES = 9_000_000;
/**
 * Wall-clock budget for one viewport build. The heaviest example takes about 0.45 s on a laptop
 * and the 2-core CI runner is 5-6x slower; the bound still catches a second-long regression
 * there (a halo screen's cables once cost 1.4 s on a laptop).
 */
const MAX_BUILD_MS = 6000;

const triangles = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

function overviewTriangles(root: THREE.Object3D): number {
  let tris = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const lod = mesh.parent as THREE.LOD | null;
    if (lod?.isLOD && lod.levels[0].object === mesh) return;
    tris += triangles(mesh.geometry) * ((mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1);
  });
  return tris;
}

function firstNonFinitePosition(root: THREE.Object3D): string | null {
  let bad: string | null = null;
  root.traverse((o) => {
    const pos = (o as THREE.Mesh).geometry?.attributes?.position;
    if (bad || !pos) return;
    const a = pos.array;
    for (let i = 0; i < a.length; i++) {
      if (!Number.isFinite(a[i])) {
        bad = o.name || o.parent?.name || o.type;
        return;
      }
    }
  });
  return bad;
}

describe('viewport build budget', () => {
  for (const preset of STADIUM_PRESETS) {
    it(`${preset.id} builds in time, finite, within the triangle budget`, () => {
      const doc = createPresetDocument(preset.id);
      const start = performance.now();
      const { rootGroup } = buildStadiumSceneGraph(doc, { mergeStatic: true, distanceLod: true, maxAnisotropy: 1 });
      const ms = performance.now() - start;
      try {
        expect(firstNonFinitePosition(rootGroup)).toBeNull();
        expect(overviewTriangles(rootGroup)).toBeLessThan(MAX_OVERVIEW_TRIANGLES);
        expect(ms).toBeLessThan(MAX_BUILD_MS);
      } finally {
        disposeObject3D(rootGroup);
      }
    });
  }

  it('LOD levels share the instances of their near mesh', () => {
    const { rootGroup } = buildStadiumSceneGraph(createPresetDocument('bowl_bowstring_60k'), {
      distanceLod: true,
      maxAnisotropy: 1,
    });
    const lods: THREE.LOD[] = [];
    rootGroup.traverse((o) => {
      if ((o as THREE.LOD).isLOD) lods.push(o as THREE.LOD);
    });
    expect(lods.map((l) => l.name)).toEqual(expect.arrayContaining(['SeatsLod', 'CrowdBodiesLod', 'CrowdHeadsLod']));
    for (const lod of lods) {
      const [near, far] = lod.levels.map((l) => l.object as THREE.InstancedMesh);
      expect(far.instanceMatrix).toBe(near.instanceMatrix);
      expect(far.count).toBe(near.count);
      expect(triangles(far.geometry)).toBeLessThan(triangles(near.geometry));
    }
    disposeObject3D(rootGroup);
  });
});

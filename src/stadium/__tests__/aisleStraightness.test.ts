import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createPresetDocument } from '../presets';
import { generateStandsGroup } from '../generateStand';

/** Textures are drawn on a canvas: any 2D call is a no-op here. */
function ensureCanvasMock() {
  if (typeof document !== 'undefined') return;
  const noop = () => ({ addColorStop: () => {} });
  const context = new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === 'getImageData'
          ? (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })
          : noop,
      set: () => true,
    }
  );
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({ width: 1024, height: 512, getContext: () => context }),
  };
}

/**
 * Aisle stairs must be straight lines in plan: every tread's nosing of one aisle sits on the same
 * radial line, in a bowl whose stands differ in tiers and heights too.
 */
describe('aisle stairs in a bowl of uneven stands', () => {
  it('keeps every aisle a straight line in plan', () => {
    ensureCanvasMock();
    const doc = createPresetDocument('cauldron_cable_42k');
    const group = generateStandsGroup(doc);
    const nosings: THREE.InstancedMesh[] = [];
    group.traverse((o) => {
      if (o.name === 'RadialStairNosings') nosings.push(o as THREE.InstancedMesh);
    });
    expect(nosings.length).toBeGreaterThan(0);
    const pts: [number, number][] = [];
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (const mesh of nosings) {
      mesh.updateWorldMatrix(true, false);
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        v.setFromMatrixPosition(m).applyMatrix4(mesh.matrixWorld);
        pts.push([v.x, v.z]);
      }
    }
    // Group the nosings by aisle: neighbours within 1.2 m in plan chain into the same aisle.
    const parent = pts.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const cell = 1.5;
    const grid = new Map<string, number[]>();
    pts.forEach(([x, z], i) => {
      const k = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
    });
    pts.forEach(([x, z], i) => {
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++)
          for (const j of grid.get(`${cx + dx},${cz + dz}`) ?? [])
            if (Math.hypot(pts[j][0] - x, pts[j][1] - z) < 1.5) parent[find(i)] = find(j);
    });
    const groups = new Map<number, [number, number][]>();
    pts.forEach((p, i) => (groups.get(find(i)) ?? groups.set(find(i), []).get(find(i))!).push(p));
    let worst = 0;
    for (const g of groups.values()) {
      if (g.length < 20) continue;
      // Principal axis through the cloud, then the widest perpendicular spread.
      const mx = g.reduce((a, p) => a + p[0], 0) / g.length;
      const mz = g.reduce((a, p) => a + p[1], 0) / g.length;
      let sxx = 0, szz = 0, sxz = 0;
      for (const [x, z] of g) { sxx += (x - mx) ** 2; szz += (z - mz) ** 2; sxz += (x - mx) * (z - mz); }
      const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
      const nx = -Math.sin(ang), nz = Math.cos(ang);
      const dev = g.map(([x, z]) => Math.abs((x - mx) * nx + (z - mz) * nz));
      worst = Math.max(worst, Math.max(...dev));
    }
    console.log('AISLES', groups.size, 'worst deviation m', worst.toFixed(2));
    expect(worst).toBeLessThan(0.6);
  });
});

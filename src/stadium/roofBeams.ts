import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Structural members and outline helpers shared by the roof builders. */

/** Box beam between two points, oriented along the segment. */
export function beamGeometry(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(0.05, dir.length());
  const geo = new THREE.BoxGeometry(w, h, len);
  const upHint =
    Math.abs(dir.y) > 0.99 * len ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  geo.applyMatrix4(new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), upHint));
  geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geo;
}

export function mergedMesh(
  parts: THREE.BufferGeometry[],
  mat: THREE.Material,
  name: string
): THREE.Mesh | null {
  if (parts.length === 0) return null;
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat);
  parts.forEach((g) => g.dispose());
  flat.forEach((g) => g.dispose());
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, mat);
  mesh.name = name;
  mesh.castShadow = true;
  return mesh;
}

/** Extent `[min, max]` of the outline across the line `axis = value` (axis `x` or `z`). */
export function chordAt(
  poly: { x: number; z: number }[],
  axis: 'x' | 'z',
  value: number
): [number, number] | null {
  const other = axis === 'x' ? 'z' : 'x';
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((a[axis] - value) * (b[axis] - value) > 0 || a[axis] === b[axis]) continue;
    const f = (value - a[axis]) / (b[axis] - a[axis]);
    const v = a[other] + (b[other] - a[other]) * f;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return lo < hi ? [lo, hi] : null;
}


import * as THREE from 'three';

/**
 * Facade rails: the outer line of a facade sampled with its outward normal and its bottom and top
 * heights, and the tools every envelope style draws along it.
 */

export interface FacadeRailSample {
  /** World or local X coordinate on the exterior facade surface */
  x: number;
  /** World or local Z coordinate on the exterior facade surface */
  z: number;
  /** Outward unit normal X */
  nx: number;
  /** Outward unit normal Z */
  nz: number;
  /** Base Y of the facade at this sample (e.g. ground or sunken berm top) */
  yBottom: number;
  /** Crest Y of the facade at this sample */
  yTop: number;
  /** Horizontal distance (m) back to the front of the stand, inward along -n (stand envelopes). */
  depth?: number;
}

/** Arc-length resampling of a facade rail, so features can be spaced in metres. */
export function createRailSampler(
  samples: FacadeRailSample[],
  closed: boolean
): { totalLen: number; sampleAtArc: (s: number) => FacadeRailSample } | null {
  if (samples.length < 2) return null;
  const segCount = closed ? samples.length : samples.length - 1;
  const cumLen: number[] = [0];
  let totalLen = 0;
  for (let i = 0; i < segCount; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % samples.length];
    totalLen += Math.hypot(b.x - a.x, b.z - a.z);
    cumLen.push(totalLen);
  }
  if (totalLen < 3.0) return null;

  const sampleAtArc = (s: number): FacadeRailSample => {
    const clampedS = Math.max(0, Math.min(totalLen, s));
    let lo = 0;
    let hi = segCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumLen[mid + 1] < clampedS) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const s0 = cumLen[lo];
    const s1 = cumLen[lo + 1];
    const f = s1 > s0 + 1e-6 ? (clampedS - s0) / (s1 - s0) : 0;
    const a = samples[lo];
    const b = samples[(lo + 1) % samples.length];
    const nxRaw = a.nx + (b.nx - a.nx) * f;
    const nzRaw = a.nz + (b.nz - a.nz) * f;
    const nLen = Math.max(1e-5, Math.hypot(nxRaw, nzRaw));
    return {
      x: a.x + (b.x - a.x) * f,
      z: a.z + (b.z - a.z) * f,
      nx: nxRaw / nLen,
      nz: nzRaw / nLen,
      yBottom: a.yBottom + (b.yBottom - a.yBottom) * f,
      yTop: a.yTop + (b.yTop - a.yTop) * f,
      depth: a.depth === undefined || b.depth === undefined ? undefined : a.depth + (b.depth - a.depth) * f,
    };
  };
  return { totalLen, sampleAtArc };
}

/** Outward offset (m) of the stands' facade wall from the back of the stands. */
export const FACADE_WALL_OFFSET = 0.3;

/** Instanced unit boxes from a list of transforms, or null when the list is empty. */
export function instancedBoxes(name: string, list: THREE.Matrix4[], mat: THREE.Material): THREE.InstancedMesh | null {
  if (list.length === 0) return null;
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length);
  inst.name = name;
  list.forEach((m, i) => inst.setMatrixAt(i, m));
  inst.instanceMatrix.needsUpdate = true;
  inst.computeBoundingSphere();
  inst.castShadow = true;
  inst.receiveShadow = true;
  return inst;
}

/** Unit box stretched from `a` to `b` with a square section `size`. */
export function strutMatrix(a: THREE.Vector3, b: THREE.Vector3, size: number): THREE.Matrix4 {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return new THREE.Matrix4().compose(
    new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5),
    q,
    new THREE.Vector3(size, len, size)
  );
}

/** Box of `width × thickness` laid from `a` to `b`, its width horizontal and across the run. */
export function slabMatrix(a: THREE.Vector3, b: THREE.Vector3, width: number, thickness: number): THREE.Matrix4 {
  const dummy = new THREE.Object3D();
  dummy.position.addVectors(a, b).multiplyScalar(0.5);
  dummy.lookAt(b);
  dummy.scale.set(width, thickness, a.distanceTo(b) * 1.02);
  dummy.updateMatrix();
  return dummy.matrix.clone();
}

export function referenceHeight(sampleAtArc: (s: number) => FacadeRailSample, totalLen: number): number {
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const pt = sampleAtArc(((i + 0.5) / 8) * totalLen);
    sum += Math.max(0, pt.yTop - pt.yBottom - 0.5);
  }
  return Math.max(4, sum / 8);
}

/** Height (m) of the ground-floor entrance band with its turnstiles. */
export const lobbyHeight = (pt: FacadeRailSample) => Math.min(3.4, Math.max(2, pt.yTop - pt.yBottom) * 0.85);

/**
 * Splits a rail where it is interrupted (a `null` sample, e.g. a corner left open), so no wall
 * spans the gap. A closed rail cut somewhere becomes open runs.
 */
export function splitRail(
  samples: (FacadeRailSample | null)[],
  closed: boolean
): { samples: FacadeRailSample[]; closed: boolean }[] {
  if (samples.every((s) => s !== null)) return [{ samples: samples as FacadeRailSample[], closed }];
  const runs: FacadeRailSample[][] = [];
  let run: FacadeRailSample[] = [];
  for (const s of samples) {
    if (s) run.push(s);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) {
    // On a closed rail the last run carries on into the first.
    if (closed && samples[0] !== null && runs.length) runs[0] = [...run, ...runs[0]];
    else runs.push(run);
  }
  return runs.filter((r) => r.length >= 2).map((r) => ({ samples: r, closed: false }));
}

/**
 * Lofts a cross-section along the rail: `profile` gives, per sample, points as (outward offset,
 * height), and consecutive samples are joined into quads. Faces point to the right of the profile
 * direction (an upward profile faces outward, a counter-clockwise loop is a solid), whichever way
 * the rail runs.
 */
export function loftAlongRail(
  samples: FacadeRailSample[],
  closed: boolean,
  profile: (pt: FacadeRailSample) => [number, number][],
  mat: THREE.Material,
  uTileM: number = 12
): THREE.Mesh | null {
  if (samples.length < 2) return null;
  const pos: number[] = [];
  const uv: number[] = [];
  let cols = 0;
  let arc = 0;
  samples.forEach((pt, i) => {
    if (i > 0) arc += Math.hypot(pt.x - samples[i - 1].x, pt.z - samples[i - 1].z);
    const section = profile(pt);
    cols = section.length;
    section.forEach(([out, y], k) => {
      pos.push(pt.x + pt.nx * out, y, pt.z + pt.nz * out);
      uv.push(arc / uTileM, k / Math.max(1, section.length - 1));
    });
  });
  // (up × tangent) · normal tells which way the rail runs around its outward side.
  const [p0, p1] = samples;
  const forward = (p1.z - p0.z) * p0.nx - (p1.x - p0.x) * p0.nz > 0;
  const idx: number[] = [];
  const segs = closed ? samples.length : samples.length - 1;
  for (let s = 0; s < segs; s++) {
    const a0 = s * cols;
    const b0 = ((s + 1) % samples.length) * cols;
    for (let k = 0; k < cols - 1; k++) {
      if (forward) idx.push(a0 + k, a0 + k + 1, b0 + k, b0 + k, a0 + k + 1, b0 + k + 1);
      else idx.push(a0 + k, b0 + k, a0 + k + 1, b0 + k, b0 + k + 1, a0 + k + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Points along the rail every `spacing` metres, shifted by `phase` bays (0..1). */
export function railStations(
  samples: FacadeRailSample[],
  closed: boolean,
  spacing: number,
  phase: number = 0
): FacadeRailSample[] {
  const rail = createRailSampler(samples, closed);
  if (!rail) return [];
  const count = Math.max(2, Math.round(rail.totalLen / spacing));
  const step = rail.totalLen / count;
  const offset = closed ? phase : 0.5 + phase * 0.5;
  return Array.from({ length: count }, (_, i) => rail.sampleAtArc((i + offset) * step));
}

/** Point `out` metres outward of a rail sample, at height `y`. */
export const railPoint = (pt: FacadeRailSample, out: number, y: number) =>
  new THREE.Vector3(pt.x + pt.nx * out, y, pt.z + pt.nz * out);

/** Instanced vertical members: a unit-height `geo` stretched to the facade at each station. */
export function verticals(
  stations: FacadeRailSample[],
  out: number,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  name: string
): THREE.InstancedMesh | null {
  const list = stations.filter((pt) => pt.yTop - pt.yBottom > 0.8);
  if (!list.length) return null;
  const inst = new THREE.InstancedMesh(geo, mat, list.length);
  inst.name = name;
  const dummy = new THREE.Object3D();
  list.forEach((pt, i) => {
    const h = pt.yTop - pt.yBottom;
    dummy.position.copy(railPoint(pt, out, pt.yBottom + h / 2));
    dummy.rotation.set(0, Math.atan2(pt.nx, pt.nz), 0);
    dummy.scale.set(1, h, 1);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  });
  inst.instanceMatrix.needsUpdate = true;
  inst.computeBoundingSphere();
  inst.castShadow = true;
  return inst;
}

/** Horizontal slab lofted along the rail, from `out0` to `out1` at height `y(pt)`. */
export const slab = (out0: number, out1: number, thickness: number, y: (pt: FacadeRailSample) => number) =>
  (pt: FacadeRailSample): [number, number][] => [
    [out0, y(pt)],
    [out1, y(pt)],
    [out1, y(pt) + thickness],
    [out0, y(pt) + thickness],
    [out0, y(pt)],
  ];

import * as THREE from 'three';
import { sampleRoundedBowlRing } from '../bowlRing';
import { StadiumDocument } from '../schema';
import { computeStadiumRingBounds } from './ringBounds';

/** Share (`0..1`) of the drop from the tallest stand to the local one that the roof follows. */
export function resolveRoofRelief(doc: StadiumDocument): number {
  return Math.max(0, Math.min(1, doc.roof.followStands ?? 0));
}

const SAMPLES = 360;
/** Half-width (samples) of the moving average that rounds the steps between stands. */
const SMOOTH = 12;

/**
 * Vertical warp of a whole-arena roof. Every builder sets its roof over the tallest stand; this
 * lowers it, around the ring, toward the crest of the stands below. Points at or under the local
 * crest stay put (feet on the ground or on the stands), points at the tallest crest and above move
 * down by the full drop (canopy, trusses and masts keep their shape), points between are squeezed.
 */
export interface RoofReliefField {
  /** Height a point at plan position `(x, z)` and height `y` moves to. */
  warpY(x: number, y: number, z: number): number;
  /** How far the roof moves down above plan position `(x, z)` (m). */
  dropAt(x: number, z: number): number;
}

/** The warp for `doc`, or null when its roof stays level. */
export function createRoofReliefField(doc: StadiumDocument): RoofReliefField | null {
  const relief = resolveRoofRelief(doc);
  if (relief <= 0) return null;
  const { ring, maxStandH, avgDepth, standHeightAtNormal } = computeStadiumRingBounds(doc);

  // Crest height by polar angle, sampled mid-depth so roof points map to the stand under them.
  const raw: number[] = [];
  const angles: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const p = sampleRoundedBowlRing(ring, i / SAMPLES, avgDepth * 0.5);
    angles.push(Math.atan2(p.z, p.x));
    raw.push(Math.min(maxStandH, standHeightAtNormal(p.nx, p.nz)));
  }
  // Widest crest nearby, then averaged: the roof keeps full height over a tall stand, never dips
  // below a crest, and eases down over the lower stand's end. The ring wraps, so the windows do.
  const at = (list: number[], i: number) => list[(i + SAMPLES) % SAMPLES];
  const dilated = raw.map((_, i) => {
    let top = -Infinity;
    for (let k = -SMOOTH; k <= SMOOTH; k++) top = Math.max(top, at(raw, i + k));
    return top;
  });
  const table = dilated.map((_, i) => {
    let sum = 0;
    for (let k = -SMOOTH; k <= SMOOTH; k++) sum += at(dilated, i + k);
    return { angle: angles[i], crest: sum / (SMOOTH * 2 + 1) };
  });
  table.sort((a, b) => a.angle - b.angle);
  if (maxStandH - Math.min(...table.map((s) => s.crest)) < 0.05) return null;

  const crestAt = (x: number, z: number): number => {
    const angle = Math.atan2(z, x);
    let hi = table.findIndex((s) => s.angle >= angle);
    if (hi < 0) hi = 0;
    const lo = (hi - 1 + SAMPLES) % SAMPLES;
    const a = table[lo];
    const b = table[hi];
    const span = (b.angle - a.angle + Math.PI * 4) % (Math.PI * 2);
    const f = span < 1e-9 ? 0 : ((angle - a.angle + Math.PI * 4) % (Math.PI * 2)) / span;
    return a.crest + (b.crest - a.crest) * f;
  };

  return {
    warpY(x, y, z) {
      const crest = crestAt(x, z);
      const gap = maxStandH - crest;
      if (gap <= 0 || y <= crest) return y;
      return y - relief * gap * Math.min(1, (y - crest) / gap);
    },
    dropAt(x, z) {
      return relief * Math.max(0, maxStandH - crestAt(x, z));
    },
  };
}

const v = new THREE.Vector3();

/** A warped copy of `geometry`, whose points `toRoof` takes to roof space. */
function warpGeometry(
  geometry: THREE.BufferGeometry,
  toRoof: THREE.Matrix4,
  field: RoofReliefField
): THREE.BufferGeometry {
  const fromRoof = toRoof.clone().invert();
  const out = geometry.clone();
  const pos = out.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(toRoof);
    v.y = field.warpY(v.x, v.y, v.z);
    v.applyMatrix4(fromRoof);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  if (out.getAttribute('normal')) out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** Instances are stretched whole: their bottom and top follow the warp at their centre. */
function warpInstances(mesh: THREE.InstancedMesh, toRoof: THREE.Matrix4, field: RoofReliefField): void {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const local = mesh.geometry.boundingBox!;
  const fromRoof = toRoof.clone().invert();
  const inst = new THREE.Matrix4();
  const world = new THREE.Matrix4();
  const affine = new THREE.Matrix4();
  const box = new THREE.Box3();
  const centre = new THREE.Vector3();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, inst);
    world.multiplyMatrices(toRoof, inst);
    box.copy(local).applyMatrix4(world);
    box.getCenter(centre);
    const y0 = field.warpY(centre.x, box.min.y, centre.z);
    const y1 = field.warpY(centre.x, box.max.y, centre.z);
    const h = box.max.y - box.min.y;
    const s = h > 1e-6 ? (y1 - y0) / h : 1;
    // y → y0 + (y − min)·s, in roof space.
    affine.set(1, 0, 0, 0, 0, s, 0, y0 - box.min.y * s, 0, 0, 1, 0, 0, 0, 0, 1);
    inst.multiplyMatrices(fromRoof, affine.multiply(world));
    mesh.setMatrixAt(i, inst);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
}

/** Warps every mesh, line and light under `obj`; `parentToRoof` takes its parent's space to roof space. */
function warpSubtree(obj: THREE.Object3D, parentToRoof: THREE.Matrix4, field: RoofReliefField): void {
  obj.updateMatrix();
  const toRoof = new THREE.Matrix4().multiplyMatrices(parentToRoof, obj.matrix);

  // Moving roof panels are rebuilt frame by frame: each rebuild is warped the same way.
  const rebuild = obj.userData.rebuildAt as ((ratio: number) => THREE.Object3D) | undefined;
  if (typeof rebuild === 'function') {
    const frozen = parentToRoof.clone();
    const wrapped = (ratio: number) => {
      const next = rebuild(ratio);
      warpSubtree(next, frozen, field);
      next.userData.rebuildAt = wrapped;
      return next;
    };
    obj.userData.rebuildAt = wrapped;
  }

  if (obj instanceof THREE.InstancedMesh) {
    warpInstances(obj, toRoof, field);
  } else if ((obj as THREE.Mesh).isMesh || (obj as THREE.Line).isLine || (obj as THREE.Points).isPoints) {
    const holder = obj as THREE.Mesh;
    holder.geometry = warpGeometry(holder.geometry, toRoof, field);
  } else if ((obj as THREE.Light).isLight) {
    // Lights only move, down with the roof above them.
    v.setFromMatrixPosition(toRoof);
    obj.position.y += field.warpY(v.x, v.y, v.z) - v.y;
  }

  for (const child of obj.children) warpSubtree(child, toRoof, field);
}

/** Lowers a whole-arena roof, built in the stadium's space, to follow the stands' crests. */
export function applyRoofRelief(doc: StadiumDocument, roof: THREE.Object3D): void {
  const field = createRoofReliefField(doc);
  if (!field) return;
  for (const child of roof.children) warpSubtree(child, new THREE.Matrix4(), field);
}

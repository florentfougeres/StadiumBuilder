import * as THREE from 'three';
import { getBowlArcRange, sampleRoundedBowlRing } from './bowlRing';
import { createConcreteBowlMaterial } from './materials';
import { FACADE_WALL_OFFSET, createRailSampler, type FacadeRailSample } from './envelopes/rail';
import { computeStadiumRingBounds } from './roofs/ringBounds';
import { StadiumDocument } from './schema';

/** Plan of one core: width along the facade and depth out from it (m). */
const CORE_WIDTH = 8.5;
const CORE_DEPTH = 6.5;
/** Lift overrun and roof parapet over the highest landing, the facade crest (m). */
const CORE_OVERRUN = 2.4;
/** Storey of the landings, read on the outer face as slab bands (m). */
const LANDING_STOREY = 3.6;
/** Glazed slot down the outer face, lighting the stair (m). */
const SLOT_WIDTH = 1.4;

/** Number of cores a project may ask for (`concourse.stairCores`). */
export const STAIR_CORE_COUNTS = [0, 4, 8, 12] as const;

/**
 * Stair and lift cores: concrete towers standing against the outer facade (or the outer concourse),
 * from the ground to just above its crest, each with a glazed slot down its outer face and its
 * landings read as slab bands. They are spread evenly round the outline, half a step off the axes
 * so the entrances on the axes stay clear (four cores land on the diagonals). None by default.
 */
export function generateStairCores(doc: StadiumDocument, crossSectionClip: boolean, maxAnisotropy: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'StairCores';
  const count = Math.max(0, Math.round(doc.concourse?.stairCores ?? 0));
  if (count === 0) return group;

  const { ring, standDepthAtNormal, standHeightAtNormal, standShiftAtNormal } = computeStadiumRingBounds(doc);
  const concourseWidth = doc.concourse?.width ?? 0;
  const hasConcourse = concourseWidth > 0.5;

  // Outer line of the building: the concourse wall, else the facade behind the stands.
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const segments = Math.max(48, Math.round(192 * Math.max(0.25, tEnd - tStart)));
  const samples: FacadeRailSample[] = [];
  for (let s = 0; s < (closed ? segments : segments + 1); s++) {
    const t = tStart + (s / segments) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const depth = standDepthAtNormal(n.nx, n.nz);
    const offset = standShiftAtNormal(n.nx, n.nz) + (hasConcourse ? depth + concourseWidth : depth + FACADE_WALL_OFFSET);
    const p = sampleRoundedBowlRing(ring, t, offset);
    samples.push({ x: p.x, z: p.z, nx: p.nx, nz: p.nz, yBottom: 0, yTop: standHeightAtNormal(n.nx, n.nz) });
  }
  const rail = createRailSampler(samples, closed);
  if (!rail) return group;

  const walls: THREE.Matrix4[] = [];
  const slots: THREE.Matrix4[] = [];
  const bands: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();
  /** Box centred `along` the facade and `out` from it, at height `y`, sized `w` x `h` x `d`. */
  const place = (pt: FacadeRailSample, out: number, y: number, w: number, h: number, d: number) => {
    dummy.position.set(pt.x + pt.nx * out, y, pt.z + pt.nz * out);
    dummy.rotation.set(0, Math.atan2(pt.nx, pt.nz), 0);
    dummy.scale.set(w, h, d);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  };

  for (let i = 0; i < count; i++) {
    const pt = rail.sampleAtArc(((i + 0.5) / count) * rail.totalLen);
    const height = Math.max(8, pt.yTop + CORE_OVERRUN);
    // Set slightly into the wall so the tower reads as built against it, with no gap on a curve.
    walls.push(place(pt, CORE_DEPTH / 2 - 0.4, height / 2, CORE_WIDTH, height, CORE_DEPTH));
    const outFace = CORE_DEPTH - 0.4;
    slots.push(place(pt, outFace + 0.02, height / 2 + 0.6, SLOT_WIDTH, height - 3.2, 0.12));
    for (let y = LANDING_STOREY; y < height - 1.5; y += LANDING_STOREY) {
      bands.push(place(pt, outFace + 0.06, y, CORE_WIDTH + 0.12, 0.28, 0.14));
    }
  }

  const concrete = createConcreteBowlMaterial(maxAnisotropy);
  const night = doc.lighting !== 'day';
  const glass = new THREE.MeshStandardMaterial({
    color: night ? 0xf3d9a4 : 0x27313b,
    emissive: night ? 0xe8b866 : 0x000000,
    emissiveIntensity: night ? 0.9 : 0,
    roughness: 0.15,
    metalness: 0.4,
  });
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (const [name, list, mat] of [
    ['StairCoreWalls', walls, concrete],
    ['StairCoreSlots', slots, glass],
    ['StairCoreLandings', bands, concrete],
  ] as const) {
    if (list.length === 0) continue;
    const mesh = new THREE.InstancedMesh(box, mat, list.length);
    list.forEach((m, k) => mesh.setMatrixAt(k, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    group.add(mesh);
  }
  return group;
}

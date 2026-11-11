import * as THREE from 'three';
import type { FacadeMaterialId } from '../schema';
import { place } from './dressingKit';
import { pushRakerFrame } from './exposedStructure';
import { FACADE_WALL_OFFSET, type FacadeRailSample, instancedBoxes, loftAlongRail, railStations, verticals } from './rail';
import { storeyFenestration } from './skin';

/** Spacing (m) of the gable's pilasters, the same module as the facade behind the stand. */
const GABLE_BAY = 7.5;

/** How far (m) below the rows the gable's cladding stops, leaving the stepped concrete edge on show. */
const RAKER_DROP = 1.1;

export interface GableParams {
  /** Outline of the stand's cross-section as (distance from the pitch-side front, height). */
  profilePts: [number, number][];
  totalDepth: number;
  /** Ground level of the facade around the stand. */
  gradeY: number;
  /** Position of the gable along the stand; its sign is the way the gable faces. */
  lx: number;
  facade: FacadeMaterialId;
  facadeMat: THREE.Material;
  structureMat: THREE.Material;
  concreteMat: THREE.Material;
  night: boolean;
}

/** Height of the rows `d` metres behind the front of the stand: the top of its outline there. */
export function terraceHeightAt(profilePts: [number, number][], d: number): number {
  let top = 0;
  for (let i = 0; i < profilePts.length - 1; i++) {
    const [d0, y0] = profilePts[i];
    const [d1, y1] = profilePts[i + 1];
    if (d < Math.min(d0, d1) || d > Math.max(d0, d1)) continue;
    const upright = Math.abs(d1 - d0) < 1e-6;
    top = Math.max(top, upright ? Math.max(y0, y1) : y0 + ((y1 - y0) * (d - d0)) / (d1 - d0));
  }
  return top;
}

/**
 * The end of a stand left open by its corner, in the stand's local frame (x along the stand, z
 * away from the pitch). The bare concrete section stays as the stepped edge under the rows; below
 * it the gable is built like the facade it turns the corner from: the same cladding, pilasters on
 * the same module, a raking beam under the rows from the pitch wall to the crest, the storeys'
 * openings and string courses wherever a full floor fits under that beam, and exit doors at grade.
 */
export function buildGableEnvelope(params: GableParams): THREE.Group | null {
  const { profilePts, totalDepth, gradeY, lx, facadeMat, structureMat, concreteMat, night } = params;
  const facing = lx > 0 ? 1 : -1;
  // The gable as a facade rail from the front of the stand to its back corner, its top following
  // the rows. It runs one wall thickness past the back to close the corner with the rear facade.
  const length = totalDepth + FACADE_WALL_OFFSET;
  const steps = Math.max(2, Math.ceil(length));
  const rail: FacadeRailSample[] = Array.from({ length: steps + 1 }, (_, i) => {
    const d = (i / steps) * length;
    const top = terraceHeightAt(profilePts, Math.min(d, totalDepth - 0.05)) - RAKER_DROP;
    return { x: lx, z: d, nx: facing, nz: 0, yBottom: gradeY, yTop: Math.max(gradeY, top) };
  });
  if (Math.max(...rail.map((pt) => pt.yTop - pt.yBottom)) < 4) return null;

  const group = new THREE.Group();
  group.name = 'StandGable';
  const add = (...objs: (THREE.Object3D | null)[]) => objs.forEach((o) => o && group.add(o));
  const out = FACADE_WALL_OFFSET;
  add(
    loftAlongRail(
      rail,
      false,
      (pt) => [
        [out, pt.yBottom],
        [out, pt.yTop],
      ],
      facadeMat
    ),
    // Raking beam along the top of the cladding, and the return that closes it back to the concrete.
    loftAlongRail(
      rail,
      false,
      (pt) => {
        const deep = Math.min(0.9, Math.max(0, pt.yTop - pt.yBottom));
        return [
          [out, pt.yTop - deep],
          [out + 0.3, pt.yTop - deep],
          [out + 0.3, pt.yTop],
          [0, pt.yTop],
        ];
      },
      structureMat
    ),
    verticals(
      railStations(rail, false, GABLE_BAY).map((pt) => ({ ...pt, yTop: pt.yTop - 0.4 })),
      out + 0.2,
      new THREE.BoxGeometry(0.55, 1, 0.5),
      structureMat,
      'GablePilasters'
    ),
    storeyFenestration({
      rail,
      closed: false,
      baySpacing: GABLE_BAY,
      facade: params.facade,
      structureMat,
      concreteMat,
      night,
    })
  );

  // Exit doors at grade in the bays tall enough for them: a double leaf under a small canopy.
  const leaves: THREE.Matrix4[] = [];
  const frames: THREE.Matrix4[] = [];
  const bays = railStations(rail, false, GABLE_BAY, 1).slice(0, -1);
  bays.forEach((pt, i) => {
    if (i % 2 !== bays.length % 2 || pt.yTop - pt.yBottom < 4.2) return;
    leaves.push(place(pt, out + 0.04, pt.yBottom + 1.2, 2.1, 2.4, 0.08));
    frames.push(
      place(pt, out + 0.08, pt.yBottom + 2.46, 2.4, 0.14, 0.18),
      place(pt, out + 0.08, pt.yBottom + 1.2, 0.07, 2.4, 0.12),
      place(pt, out + 0.75, pt.yBottom + 2.85, 3.2, 0.12, 1.5)
    );
  });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.55, metalness: 0.6 });
  add(instancedBoxes('GableExitDoors', leaves, doorMat), instancedBoxes('GableDoorFrames', frames, structureMat));
  return group;
}

/**
 * End frame of a hollow stand, just inside its open gable: the raker beam under the soffit and its
 * columns on footings, so the raked slab is seen to be carried where it is cut.
 */
export function buildGableFrame(params: {
  totalDepth: number;
  topHeight: number;
  gradeY: number;
  lx: number;
  structureMat: THREE.Material;
  concreteMat: THREE.Material;
}): THREE.Group | null {
  const { totalDepth, topHeight, gradeY, lx, structureMat, concreteMat } = params;
  if (topHeight <= 5) return null;
  const inset = lx > 0 ? -0.45 : 0.45;
  const parts = { rakers: [] as THREE.Matrix4[], columns: [] as THREE.Matrix4[], footings: [] as THREE.Matrix4[] };
  pushRakerFrame({ x: lx + inset, z: totalDepth, nx: 0, nz: 1, yBottom: gradeY, yTop: topHeight, depth: totalDepth }, parts);
  const group = new THREE.Group();
  group.name = 'StandGableFrame';
  for (const mesh of [
    instancedBoxes('GableRakers', parts.rakers, structureMat),
    instancedBoxes('GableFrameColumns', parts.columns, structureMat),
    instancedBoxes('GableFootings', parts.footings, concreteMat),
  ]) {
    if (mesh) group.add(mesh);
  }
  return group;
}

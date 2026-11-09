import * as THREE from 'three';
import {
  buildCurtainWallArticulation,
  buildEnvelopeDressing,
  buildParametricFacadeOnRail,
  createRailSampler,
  FACADE_WALL_OFFSET,
  type FacadeRailSample,
} from './parametricFacade';
import type { EnvelopeStyle, StadiumDocument, StructureMaterialId } from './schema';
import { resolveStadiumMaterials } from './materials';

/**
 * Exterior envelope of the stands, drawn the same way behind a straight stand, around a corner
 * and around a continuous bowl: each of them only describes its outer facade as a rail whose
 * samples carry `depth`, the distance back to the front of the stand.
 */

/** Ground level (m) of the facade: the berm of a sunken bowl, never above two thirds of the crest. */
export function facadeGradeY(sunkenDepth: number, crestY: number): number {
  return Math.min(sunkenDepth, Math.max(0, crestY * 0.68));
}

/**
 * Stands whose underside is left open to view (raker frames, colonnades, or a steel or timber
 * frame of their own), so the stand is built as a hollow raked slab rather than a solid block.
 */
export function isHollowStand(doc: StadiumDocument, ownStructure?: StructureMaterialId | 'inherit'): boolean {
  if (doc.roof.style === 'enveloping_shell') return false;
  const envelope = resolveStadiumMaterials(doc).envelopeStyle ?? 'enveloping_skin';
  return (
    envelope === 'exposed_structure' ||
    envelope === 'colonnade_forest' ||
    (ownStructure !== undefined && ownStructure !== 'inherit' && ownStructure !== 'reinforced_concrete')
  );
}

/** Envelopes drawn as a dressing in front of the plain facade wall (see `buildEnvelopeDressing`). */
const RAIL_DRESSED: ReadonlySet<EnvelopeStyle> = new Set([
  'stacked_arcades',
  'media_mesh',
  'helical_ramps',
  'horizontal_strata',
]);

/** Height (m) of the ground-floor entrance band with its turnstiles. */
const lobbyHeight = (pt: FacadeRailSample) => Math.min(3.4, Math.max(2, pt.yTop - pt.yBottom) * 0.85);

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
function railStations(
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

const at = (pt: FacadeRailSample, out: number, y: number) =>
  new THREE.Vector3(pt.x + pt.nx * out, y, pt.z + pt.nz * out);

function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, Math.max(0.05, dir.length()), 6), mat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true;
  return mesh;
}

/** Instanced vertical members: a unit-height `geo` stretched to the facade at each station. */
function verticals(
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
    dummy.position.copy(at(pt, out, pt.yBottom + h / 2));
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

/** Outward offset (m) of a plain skin at height fraction `vf` for the chosen silhouette, or null when upright. */
function skinSilhouette(doc: StadiumDocument): ((h: number, vf: number) => number) | null {
  const mats = resolveStadiumMaterials(doc);
  const profile = mats.envelopeProfile ?? 'straight';
  if (profile === 'bulging') return (h, vf) => FACADE_WALL_OFFSET + Math.sin(vf * Math.PI) * Math.min(7, h * 0.17);
  if (profile === 'tent') return (h, vf) => FACADE_WALL_OFFSET + Math.pow(1 - vf, 1.5) * Math.min(16, h * 0.55);
  if (mats.facade === 'etfe_cushions_facade') return (_h, vf) => Math.sin(vf * Math.PI) * 3.8 + vf * 0.8;
  return null;
}

/** Horizontal slab lofted along the rail, from `out0` to `out1` at height `y(pt)`. */
const slab = (out0: number, out1: number, thickness: number, y: (pt: FacadeRailSample) => number) =>
  (pt: FacadeRailSample): [number, number][] => [
    [out0, y(pt)],
    [out1, y(pt)],
    [out1, y(pt) + thickness],
    [out0, y(pt) + thickness],
    [out0, y(pt)],
  ];

export interface StandEnvelopeParams {
  doc: StadiumDocument;
  /** Outer facade line of the stands; every sample needs `depth`. */
  rail: FacadeRailSample[];
  closed: boolean;
  facadeMat: THREE.Material;
  structureMat: THREE.Material;
  concreteMat: THREE.Material;
  turnstileTex: THREE.Texture;
  /** Accent of an upright plain skin instead of pilasters (bowl shapes with their own elevation). */
  skinAccent?: 'piers' | 'bands';
  name?: string;
}

/** Draws the envelope chosen in `doc.materials` along the outer facade of the stands. */
export function buildStandEnvelope(params: StandEnvelopeParams): THREE.Group {
  const { doc, closed, facadeMat, structureMat, concreteMat, turnstileTex, skinAccent } = params;
  const group = new THREE.Group();
  group.name = params.name ?? 'StandEnvelope';
  const rail = params.rail;
  if (doc.roof.style === 'enveloping_shell' || rail.length < 2) return group;

  const mats = resolveStadiumMaterials(doc);
  const envelope: EnvelopeStyle = mats.envelopeStyle ?? 'enveloping_skin';
  const night = doc.lighting !== 'day';
  const wallMat = facadeMat.clone();
  wallMat.side = THREE.DoubleSide;
  const add = (...objs: (THREE.Object3D | null)[]) => objs.forEach((o) => o && group.add(o));
  const loft = (profile: (pt: FacadeRailSample) => [number, number][], mat: THREE.Material, uTileM?: number) =>
    loftAlongRail(rail, closed, profile, mat, uTileM);
  const wall = (out: number, topInset: number) =>
    loft((pt) => [
      [out, pt.yBottom],
      [out, pt.yTop - topInset],
    ], wallMat);
  const depthOf = (pt: FacadeRailSample) => pt.depth ?? 20;

  if (envelope === 'exposed_structure') {
    // Raker frames under the open soffit, an elevated walkway and stair flights outside.
    const concY = (pt: FacadeRailSample) => Math.min(pt.yTop - 2.5, Math.max(pt.yBottom + 4.2, pt.yTop * 0.42));
    add(
      loft((pt) => {
        const mid = -depthOf(pt) * 0.28;
        const half = Math.max(3.5, depthOf(pt) * 0.36) / 2;
        return slab(mid - half, mid + half, 0.42, (p) => concY(p) - 0.42)(pt);
      }, concreteMat)
    );
    const bays = railStations(rail, closed, 8.5);
    bays.forEach((pt, i) => {
      const depth = depthOf(pt);
      add(
        strut(at(pt, -depth * 0.72, Math.max(0.2, pt.yBottom * 0.4)), at(pt, -0.4, pt.yTop - 1.2), 0.36, structureMat),
        strut(at(pt, -0.4, pt.yBottom), at(pt, -0.4, pt.yTop), 0.34, structureMat),
        strut(
          at(pt, -depth * 0.42, pt.yBottom),
          at(pt, -depth * 0.42, Math.max(pt.yBottom + 1.5, pt.yTop * 0.48)),
          0.28,
          structureMat
        )
      );
      const next = bays[i + 1] ?? (closed ? bays[0] : null);
      if (i % 2 === 0 && next && pt.yTop - pt.yBottom > 6) {
        add(strut(at(pt, 0.8, pt.yBottom + 0.2), at(next, 0.8, concY(next)), 0.4, concreteMat));
        if (next.yTop - concY(next) > 4.5) {
          add(strut(at(next, 1.5, concY(next)), at(pt, 0.4, pt.yTop - 1.8), 0.38, concreteMat));
        }
      }
    });
  } else if (envelope === 'colonnade_forest') {
    // Recessed glazed core, a deep cornice and three staggered rows of slender columns.
    add(wall(-1.6, 0.8), loft(slab(-1.6, 6, 0.95, (pt) => pt.yTop - 0.8), structureMat));
    const spacing = 4.2 / Math.max(0.5, Math.min(4, mats.colonnadeDensity ?? 1));
    const colGeo = new THREE.CylinderGeometry(0.21, 0.24, 1, 10);
    [0.2, 2.5, 4.8].forEach((out, r) => {
      add(verticals(railStations(rail, closed, spacing, r % 2 ? 0.5 : 0), out, colGeo, structureMat, 'EnvelopeColonnade'));
    });
  } else if (envelope === 'louver_curtain') {
    // Glazed core behind horizontal brise-soleil blades.
    add(wall(-0.2, 0.3));
    const levels = Math.max(5, Math.floor(Math.max(...rail.map((pt) => pt.yTop - pt.yBottom)) / 2.2));
    for (let l = 0; l < levels; l++) {
      const f = l / Math.max(1, levels - 1);
      add(
        loft((pt) => {
          const y = pt.yBottom + 2.6 + f * Math.max(1, pt.yTop - pt.yBottom - 3);
          return [
            [0.5, y - 0.18],
            [1.8, y + 0.18],
            [1.8, y + 0.26],
            [0.5, y - 0.1],
            [0.5, y - 0.18],
          ];
        }, structureMat)
      );
    }
  } else {
    // A skin, shaped when `enveloping_skin` asks for a silhouette, then a dressing or the plain
    // wall's own articulation.
    const silhouette = envelope === 'enveloping_skin' ? skinSilhouette(doc) : null;
    add(
      silhouette
        ? loft((pt) => {
            const h = pt.yTop - pt.yBottom;
            return Array.from({ length: 9 }, (_, b) => [silhouette(h, b / 8), pt.yBottom + (b / 8) * h] as [number, number]);
          }, wallMat)
        : wall(FACADE_WALL_OFFSET, 0.25)
    );
    const dressing = RAIL_DRESSED.has(envelope)
      ? buildEnvelopeDressing({
          samples: rail.map((pt) => ({ ...pt, x: pt.x + pt.nx * 0.55, z: pt.z + pt.nz * 0.55 })),
          closed,
          style: envelope,
          frameMat: structureMat,
          facadeMat,
          ledColors: [doc.colors.seatsPrimary, doc.colors.seatsSecondary],
          night,
        })
      : null;
    const glazed =
      dressing || silhouette
        ? null
        : buildCurtainWallArticulation({
            samples: rail.map((pt) => ({ ...pt, yBottom: pt.yBottom + lobbyHeight(pt) })),
            closed,
            frameMat: structureMat,
            facadeMaterial: mats.facade,
            offset: 0.2,
          });
    add(dressing, glazed);
    if (!dressing && !silhouette && !glazed) {
      if (skinAccent === 'bands') {
        for (const f of [0.34, 0.66, 0.96]) {
          add(
            loft((pt) => {
              const y = pt.yBottom + f * (pt.yTop - pt.yBottom);
              return [
                [0.2, y - 0.45],
                [0.6 + f * 1.3, y],
                [0.2, y + 0.45],
                [0.2, y - 0.45],
              ];
            }, structureMat)
          );
        }
      } else {
        const piers = skinAccent === 'piers';
        add(
          verticals(
            railStations(rail, closed, piers ? 9 : 7.5),
            piers ? 1.1 : 0.58,
            new THREE.BoxGeometry(piers ? 1.45 : 0.62, 1, piers ? 2.6 : 2.2),
            structureMat,
            'EnvelopePilasters'
          )
        );
      }
    }
  }

  // Ground-floor entrance band with turnstiles, under a canopy.
  if (envelope !== 'exposed_structure') {
    const lobbyMat = new THREE.MeshPhysicalMaterial({
      map: turnstileTex,
      emissive: new THREE.Color(night ? 0xfbbf24 : 0x000000),
      emissiveMap: turnstileTex,
      emissiveIntensity: night ? 0.55 : 0,
      roughness: 0.18,
      metalness: 0.35,
      clearcoat: 0.85,
      side: THREE.DoubleSide,
    });
    add(
      loft((pt) => [
        [1.05, pt.yBottom],
        [1.05, pt.yBottom + lobbyHeight(pt)],
      ], lobbyMat, 24),
      loft(slab(0.2, 3.4, 0.45, (pt) => pt.yBottom + lobbyHeight(pt)), structureMat)
    );
  }

  // Parametric relief, unless an outer concourse wraps the stands (it carries the relief then).
  const pattern = mats.facadePattern ?? 'none';
  if (pattern !== 'none' && (doc.concourse?.width ?? 0) <= 0.5) {
    const lobby = envelope !== 'exposed_structure';
    add(
      buildParametricFacadeOnRail({
        samples: rail.map((pt) => ({
          ...pt,
          x: pt.x + pt.nx * 1.05,
          z: pt.z + pt.nz * 1.05,
          yBottom: pt.yBottom + (lobby ? lobbyHeight(pt) + 0.35 : 0.2),
          yTop: Math.max(pt.yBottom + 2, pt.yTop - 0.15),
        })),
        closed,
        pattern,
        density: mats.facadeDensity ?? 1.0,
        depth: mats.facadeDepth ?? 0.85,
        bulge: mats.facadeBulge ?? 0,
        primaryMat: facadeMat,
        accentMat: structureMat,
      })
    );
  }
  return group;
}

import * as THREE from 'three';
import { getBowlArcRange, sampleRoundedBowlRing } from './bowlRing';
import { computeStadiumRingBounds } from './generateRoof';
import { createFacadePbrMaterial, createStructurePbrMaterial, resolveStadiumMaterials } from './materials';
import {
  BOWL_CURTAIN_WALL_OFFSET,
  buildEnvelopeDressing,
  buildParametricFacadeOnRail,
  FacadeRailSample,
} from './parametricFacade';
import { isContinuousBowlShape, StadiumDocument, StandSide } from './schema';

const SIDES: StandSide[] = ['north', 'south', 'east', 'west'];

/** No global roof and no stand with its own roof. */
function hasNoRoof(doc: StadiumDocument): boolean {
  return (
    doc.roof.style === 'none' &&
    SIDES.every((side) => {
      const override = doc.stands[side].roofStyleOverride;
      return !override || override === 'inherit' || override === 'none';
    })
  );
}

/** Gaps smaller than this are left open (m); the cap stops rays from catching distant roofs. */
const MIN_SKIRT = 1;
const MAX_SKIRT = 60;
const CANOPY_NAMES = new Set(['RoofCanopySurface', 'RetractableRoofLeaf']);

/**
 * Skirt closing the band between the top of the facade (or outer concourse) and the underside of
 * the roof, so the stadium reads as one enveloped volume instead of a roof floating over exposed
 * terraces (`roof.enclosed`, on by default). It follows the bowl contour behind the stands, which
 * for separate stands runs along their backs. The roof underside is found by casting a ray
 * straight up at each sample, which works for every roof style without knowing its geometry;
 * where the ray finds no roof (open corners, uncovered stands), the band stays open.
 */
export function generateEnvelopeSkirt(
  doc: StadiumDocument,
  roofGroup: THREE.Object3D,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'EnvelopeSkirt';
  const mats = resolveStadiumMaterials(doc);
  if (doc.roof.enclosed === false || hasNoRoof(doc)) return group;
  // Bowls carry a curtain wall set slightly proud of the stand backs (see generateStand).
  const facadeOffset = isContinuousBowlShape(doc.shape) ? BOWL_CURTAIN_WALL_OFFSET : 0.3;

  const { ring, innerHalfX, innerHalfZ, standDepthAtNormal, standHeightAtNormal } =
    computeStadiumRingBounds(doc);
  const concourseWidth = doc.concourse?.width ?? 0;
  const hasConcourse = concourseWidth > 0.5;
  const concourseRatio = Math.min(1, Math.max(0.15, doc.concourse?.heightRatio ?? 0.5));
  const covered = doc.roof.coveredSides;
  const sideAt = (x: number, z: number): StandSide =>
    Math.abs(x) / innerHalfX >= Math.abs(z) / innerHalfZ
      ? x > 0
        ? 'east'
        : 'west'
      : z > 0
      ? 'south'
      : 'north';

  // Only the cladding counts as the roof underside: arches, masts and cables pass over the
  // facade line without closing it.
  const isCanopy = (obj: THREE.Object3D | null): boolean => {
    for (let o = obj; o; o = o.parent) {
      if (CANOPY_NAMES.has(o.name)) return true;
    }
    return false;
  };

  roofGroup.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  raycaster.far = MAX_SKIRT;
  const up = new THREE.Vector3(0, 1, 0);
  const origin = new THREE.Vector3();

  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const segments = Math.max(48, Math.round(192 * Math.max(0.25, tEnd - tStart)));
  const count = closed ? segments : segments + 1;

  // Contiguous runs of samples that have a roof above them.
  const runs: FacadeRailSample[][] = [];
  let run: FacadeRailSample[] = [];
  let unbroken = closed;
  for (let s = 0; s < count; s++) {
    const t = tStart + (s / segments) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const depth = standDepthAtNormal(n.nx, n.nz);
    const standTop = standHeightAtNormal(n.nx, n.nz);
    const offset = hasConcourse ? depth + concourseWidth : depth + facadeOffset;
    const baseY = hasConcourse ? Math.max(4.5, standTop * concourseRatio) : standTop;
    const p = sampleRoundedBowlRing(ring, t, offset);

    let topY: number | null = null;
    if (!covered || covered.includes(sideAt(p.x, p.z))) {
      origin.set(p.x, baseY + 0.2, p.z);
      raycaster.set(origin, up);
      const hit = raycaster.intersectObject(roofGroup, true).find((h) => isCanopy(h.object));
      if (hit && hit.distance > MIN_SKIRT) topY = hit.point.y;
    }

    if (topY === null) {
      if (run.length > 0) runs.push(run);
      run = [];
      unbroken = false;
      continue;
    }
    run.push({ x: p.x, z: p.z, nx: p.nx, nz: p.nz, yBottom: baseY - 0.3, yTop: topY });
  }
  if (run.length > 0) runs.push(run);
  const loop = unbroken && runs.length === 1;

  // The band continues the facade up to the roof, in the same cladding and envelope.
  const screenMat = createFacadePbrMaterial(mats.facade, doc.lighting, false, maxAnisotropy);
  const facadePattern = mats.facadePattern ?? 'none';
  const finMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);

  for (const rail of runs) {
    if (rail.length < 2) continue;
    // Screen panel set just behind the fins.
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let run = 0;
    rail.forEach((p, i) => {
      if (i > 0) run += Math.hypot(p.x - rail[i - 1].x, p.z - rail[i - 1].z);
      pos.push(p.x, p.yBottom, p.z, p.x, p.yTop + 0.3, p.z);
      // Same scale as the concourse facade (12 m per tile), continuing its storeys upward.
      uv.push(run / 12, p.yBottom / 12, run / 12, (p.yTop + 0.3) / 12);
    });
    const segs = loop ? rail.length : rail.length - 1;
    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      const b = ((i + 1) % rail.length) * 2;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const panel = new THREE.Mesh(geo, screenMat);
    panel.castShadow = true;
    panel.receiveShadow = true;
    group.add(panel);

    const dressing =
      facadePattern === 'none'
        ? buildEnvelopeDressing({
            samples: rail,
            closed: loop,
            style: mats.envelopeStyle ?? 'enveloping_skin',
            frameMat: finMat,
            storeys: false,
          })
        : buildParametricFacadeOnRail({
            samples: rail,
            closed: loop,
            pattern: facadePattern,
            density: mats.facadeDensity ?? 1.0,
            depth: mats.facadeDepth ?? 0.85,
            primaryMat: screenMat,
            accentMat: finMat,
            name: 'SkirtParametricFacade',
          });
    if (dressing) group.add(dressing);
  }
  return group;
}

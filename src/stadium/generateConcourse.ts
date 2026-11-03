import * as THREE from 'three';
import { getBowlArcRange, sampleRoundedBowlRing } from './bowlRing';
import { computeStadiumRingBounds } from './generateRoof';
import {
  createConcreteBowlMaterial,
  createFacadePbrMaterial,
  createStructurePbrMaterial,
  resolveStadiumMaterials,
} from './materials';
import { buildParametricFacadeOnRail } from './parametricFacade';
import { StadiumDocument } from './schema';

/** Storey height of the concourse levels, read on the facade as slab bands. */
const LEVEL_HEIGHT = 4.5;

/**
 * Outer concourse ring: the building mass that wraps the seating bowl (concourses, stairs,
 * hospitality), so the stadium no longer stops at the last row of seats. It follows the bowl
 * contour behind every stand, corners included, and reads as a facade with floor slabs.
 */
export function generateConcourseGroup(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'OuterConcourse';
  const width = doc.concourse?.width ?? 0;
  if (width <= 0.5) return group;

  const heightRatio = Math.min(1, Math.max(0.15, doc.concourse?.heightRatio ?? 0.5));
  const { ring, standDepthAtNormal, standHeightAtNormal } = computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const segments = Math.max(48, Math.round(192 * arcFraction));
  const count = closed ? segments : segments + 1;

  // Per sample: inner offset (overlapping the stand back), outer offset, height.
  const samples = Array.from({ length: count }, (_, s) => {
    const t = tStart + (s / segments) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const depth = standDepthAtNormal(n.nx, n.nz);
    const height = Math.max(LEVEL_HEIGHT, standHeightAtNormal(n.nx, n.nz) * heightRatio);
    const inner = sampleRoundedBowlRing(ring, t, depth - 0.6);
    const outer = sampleRoundedBowlRing(ring, t, depth + width);
    const slabEdge = sampleRoundedBowlRing(ring, t, depth + width + 0.35);
    return { inner, outer, slabEdge, height };
  });

  const mats = resolveStadiumMaterials(doc);
  const facadeMat = createFacadePbrMaterial(mats.facade, doc.lighting, false, maxAnisotropy);
  const deckMat = createConcreteBowlMaterial(maxAnisotropy);
  const slabMat = new THREE.MeshStandardMaterial({ color: 0xd6d3cd, roughness: 0.8 });

  // A strip of quads between two rails of points, one quad per ring segment.
  const strip = (
    rail: (i: number) => [THREE.Vector3, THREE.Vector3],
    uScale: number,
    mat: THREE.Material
  ) => {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let run = 0;
    for (let i = 0; i < count; i++) {
      const [a, b] = rail(i);
      if (i > 0) run += rail(i - 1)[0].distanceTo(a);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      uvs.push(run / uScale, 0, run / uScale, a.distanceTo(b) / uScale);
    }
    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      const b = (closed ? (i + 1) % count : i + 1) * 2;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  const v = (p: { x: number; z: number }, y: number) => new THREE.Vector3(p.x, y, p.z);

  // Outer facade (bottom → top), roof deck (outer → inner), inner wall facing the stands.
  group.add(
    strip((i) => [v(samples[i].outer, 0), v(samples[i].outer, samples[i].height)], 12, facadeMat),
    strip(
      (i) => [v(samples[i].outer, samples[i].height), v(samples[i].inner, samples[i].height)],
      8,
      deckMat
    ),
    strip((i) => [v(samples[i].inner, samples[i].height), v(samples[i].inner, 0)], 8, deckMat)
  );

  // Floor slabs projecting slightly from the facade at each concourse level.
  const minHeight = Math.min(...samples.map((s) => s.height));
  for (let y = LEVEL_HEIGHT; y < minHeight - 0.5; y += LEVEL_HEIGHT) {
    const curve = new THREE.CatmullRomCurve3(
      samples.map((s) => v(s.slabEdge, y)),
      closed
    );
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segments, 0.28, 4, closed), slabMat));
  }

  // Parapet along the deck edge when the concourse stops below the top of the stands.
  if (heightRatio < 0.98) {
    const railCurve = new THREE.CatmullRomCurve3(
      samples.map((s) => v(s.outer, s.height + 1.05)),
      closed
    );
    group.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(railCurve, segments, 0.06, 4, closed),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.7, roughness: 0.35 })
      )
    );
  }

  // 3D Parametric Facade Relief on outer concourse perimeter
  const facadePattern = mats.facadePattern ?? 'none';
  if (facadePattern !== 'none') {
    const structMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
    const sampleCount = closed ? segments : count;
    const facadeSamples = Array.from({ length: sampleCount }, (_, i) => ({
      x: samples[i].outer.x,
      z: samples[i].outer.z,
      nx: samples[i].outer.nx,
      nz: samples[i].outer.nz,
      yBottom: 0,
      yTop: samples[i].height,
    }));
    const relief = buildParametricFacadeOnRail({
      samples: facadeSamples,
      closed,
      pattern: facadePattern,
      density: mats.facadeDensity ?? 1.0,
      depth: mats.facadeDepth ?? 0.85,
      primaryMat: facadeMat,
      accentMat: structMat,
      name: 'ConcourseParametricFacade',
    });
    if (relief) {
      group.add(relief);
    }
  }

  return group;
}

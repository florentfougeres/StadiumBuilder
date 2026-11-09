import * as THREE from 'three';
import { roofDefinition } from './roofCatalog';
import { getBowlArcRange, sampleRoundedBowlRing } from './bowlRing';
import { computeStadiumRingBounds } from './roofs/ringBounds';
import { createFacadePbrMaterial, createStructurePbrMaterial, resolveFacadePalette, resolveStadiumMaterials } from './materials';
import { buildEnvelopeDressing } from './envelopes';
import { FACADE_WALL_OFFSET, type FacadeRailSample } from './envelopes/rail';
import { buildParametricFacadeOnRail } from './parametricFacade';
import { createRailSampler } from './envelopes/rail';
import { GlassWallConfig, StadiumDocument, StandSide } from './schema';

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
/** Inward distances (m) from the facade line at which the roof underside is looked for. */
const ROOF_EDGE_PROBES = [0, 1.5, 3];
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
  if (doc.roof.enclosed === false || hasNoRoof(doc) || roofDefinition(doc.roof.style).openEaves) return group;
  const facadeOffset = FACADE_WALL_OFFSET;

  const {
    ring,
    innerHalfX,
    innerHalfZ,
    overConcourse,
    standDepthAtNormal,
    standHeightAtNormal,
    standShiftAtNormal,
  } = computeStadiumRingBounds(doc);
  const concourseWidth = doc.concourse?.width ?? 0;
  // A roof stopping at the stand backs is closed there, from the crest up, not at the concourse.
  const hasConcourse = concourseWidth > 0.5 && overConcourse;
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

  roofGroup.updateMatrixWorld(true);
  const probeRoofUnderside = createCanopyProbe(roofGroup);
  const origin = new THREE.Vector3();

  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const segments = Math.max(48, Math.round(192 * Math.max(0.25, tEnd - tStart)));
  const count = closed ? segments : segments + 1;

  // Contiguous runs of samples that have a roof above them; the glass wall side is kept apart.
  const glassWall = doc.roof.glassWall;
  const gable: { s: number; pt: FacadeRailSample }[] = [];
  const runs: FacadeRailSample[][] = [];
  let run: FacadeRailSample[] = [];
  let unbroken = closed;
  for (let s = 0; s < count; s++) {
    const t = tStart + (s / segments) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const depth = standDepthAtNormal(n.nx, n.nz);
    const standTop = standHeightAtNormal(n.nx, n.nz);
    const offset =
      standShiftAtNormal(n.nx, n.nz) + (hasConcourse ? depth + concourseWidth : depth + facadeOffset);
    const baseY = hasConcourse ? Math.max(4.5, standTop * concourseRatio) : standTop;
    const p = sampleRoundedBowlRing(ring, t, offset);

    let topY: number | null = null;
    if (!covered || covered.includes(sideAt(p.x, p.z))) {
      // The roof edge may stop just short of the facade line: probe a little inward too.
      for (const inset of ROOF_EDGE_PROBES) {
        origin.set(p.x - p.nx * inset, baseY + 0.2, p.z - p.nz * inset);
        const hit = probeRoofUnderside(origin);
        if (hit && hit.distance > MIN_SKIRT) {
          topY = hit.point.y;
          break;
        }
      }
    }

    if (topY !== null && glassWall && sideAt(p.x, p.z) === glassWall.side) {
      gable.push({ s, pt: { x: p.x, z: p.z, nx: p.nx, nz: p.nz, yBottom: baseY - 0.3, yTop: topY } });
      topY = null;
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
  if (glassWall && gable.length > 1) {
    // On a closed ring the side may straddle the seam: start it after the gap.
    const gap = gable.findIndex((g, i) => i > 0 && g.s !== gable[i - 1].s + 1);
    const ordered = closed && gap > 0 ? [...gable.slice(gap), ...gable.slice(0, gap)] : gable;
    group.add(buildGlassWall(ordered.map((g) => g.pt), glassWall));
  }

  // The band continues the facade up to the roof, in the same cladding and envelope, or is glazed
  // as a clear windbreak that keeps the bowl and the sky line visible.
  const glazed = doc.roof.enclosureGlazed === true;
  const screenMat = glazed
    ? new THREE.MeshPhysicalMaterial({
        color: 0xdbeafe,
        transparent: true,
        opacity: 0.22,
        roughness: 0.05,
        metalness: 0.1,
        clearcoat: 1,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    : createFacadePbrMaterial(mats.facade, doc.lighting, false, maxAnisotropy, mats.facadeGlowHex);
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
    panel.castShadow = !glazed;
    panel.receiveShadow = true;
    group.add(panel);

    if (glazed) {
      group.add(buildGlazingMullions(rail, loop, finMat));
      continue;
    }

    const dressing =
      facadePattern === 'none'
        ? buildEnvelopeDressing({
            samples: rail,
            closed: loop,
            style: mats.envelopeStyle ?? 'enveloping_skin',
            frameMat: finMat,
            storeys: false,
            facadeMat: screenMat,
            ledColors: [doc.colors.seatsPrimary, doc.colors.seatsSecondary],
            night: doc.lighting !== 'day',
            glowHex: mats.facadeGlowHex,
          })
        : buildParametricFacadeOnRail({
            samples: rail,
            closed: loop,
            pattern: facadePattern,
            density: mats.facadeDensity ?? 1.0,
            depth: mats.facadeDepth ?? 0.85,
            bulge: mats.facadeBulge ?? 0,
            primaryMat: screenMat,
            accentMat: finMat,
            palette: resolveFacadePalette(doc),
            name: 'SkirtParametricFacade',
          });
    if (dressing) group.add(dressing);
  }
  return group;
}

/**
 * Nearest roof-cladding hit straight above a point, within `MAX_SKIRT`. Only the cladding counts
 * as the roof underside: arches, masts and cables pass over the facade line without closing it.
 * Every cladding mesh and instance is boxed once in world space, so each ray only intersects the
 * few pieces above it instead of every truss instance of the roof.
 */
function createCanopyProbe(
  roofGroup: THREE.Object3D
): (origin: THREE.Vector3) => THREE.Intersection | null {
  const raycaster = new THREE.Raycaster();
  raycaster.far = MAX_SKIRT;
  const up = new THREE.Vector3(0, 1, 0);
  // Lines and points hit within their threshold of the ray, so their boxes are widened by it.
  const margin = Math.max(raycaster.params.Line.threshold, raycaster.params.Points.threshold);

  const boxes: THREE.Box3[] = [];
  const tests: ((hits: THREE.Intersection[]) => void)[] = [];
  const instanceMesh = new THREE.Mesh();
  const instanceMatrix = new THREE.Matrix4();

  const isCanopy = (obj: THREE.Object3D | null): boolean => {
    for (let o = obj; o; o = o.parent) {
      if (CANOPY_NAMES.has(o.name)) return true;
    }
    return false;
  };

  roofGroup.traverse((obj) => {
    const geometry = (obj as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (geometry?.attributes?.position && isCanopy(obj)) {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const local = geometry.boundingBox!;
      if (obj instanceof THREE.InstancedMesh) {
        for (let i = 0; i < obj.count; i++) {
          const world = new THREE.Matrix4().multiplyMatrices(
            obj.matrixWorld,
            obj.getMatrixAt(i, instanceMatrix)
          );
          boxes.push(local.clone().applyMatrix4(world).expandByScalar(margin));
          // Same per-instance test as InstancedMesh.raycast, reported against the instanced mesh.
          tests.push((hits) => {
            instanceMesh.geometry = obj.geometry;
            instanceMesh.material = obj.material;
            instanceMesh.matrixWorld = world;
            const found: THREE.Intersection[] = [];
            instanceMesh.raycast(raycaster, found);
            for (const h of found) hits.push({ ...h, instanceId: i, object: obj });
          });
        }
      } else {
        boxes.push(local.clone().applyMatrix4(obj.matrixWorld).expandByScalar(margin));
        tests.push((hits) => obj.raycast(raycaster, hits));
      }
    }
  });

  return (origin) => {
    raycaster.set(origin, up);
    const top = origin.y + MAX_SKIRT;
    const hits: THREE.Intersection[] = [];
    boxes.forEach((b, i) => {
      if (
        origin.x >= b.min.x &&
        origin.x <= b.max.x &&
        origin.z >= b.min.z &&
        origin.z <= b.max.z &&
        b.max.y >= origin.y &&
        b.min.y <= top
      ) {
        tests[i](hits);
      }
    });
    if (hits.length === 0) return null;
    return hits.reduce((a, b) => (b.distance < a.distance ? b : a));
  };
}

/** Glazing pitch (m) between the mullions of a glass windbreak. */
const WINDBREAK_MULLION_SPACING_M = 2.4;

/** Slim mullions holding the windbreak panes, one every `WINDBREAK_MULLION_SPACING_M` along the rail. */
function buildGlazingMullions(
  rail: { x: number; z: number; yBottom: number; yTop: number }[],
  closed: boolean,
  mat: THREE.Material
): THREE.InstancedMesh {
  const matrices: THREE.Matrix4[] = [];
  const segs = closed ? rail.length : rail.length - 1;
  let carry = 0;
  for (let i = 0; i < segs; i++) {
    const a = rail[i];
    const b = rail[(i + 1) % rail.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    for (let along = carry; along < len; along += WINDBREAK_MULLION_SPACING_M) {
      const f = along / len;
      const yB = a.yBottom + (b.yBottom - a.yBottom) * f;
      const yT = a.yTop + (b.yTop - a.yTop) * f + 0.3;
      matrices.push(
        new THREE.Matrix4()
          .makeScale(0.09, Math.max(0.1, yT - yB), 0.12)
          .setPosition(a.x + (b.x - a.x) * f, (yB + yT) / 2, a.z + (b.z - a.z) * f)
      );
    }
    carry = len < carry ? carry - len : WINDBREAK_MULLION_SPACING_M - ((len - carry) % WINDBREAK_MULLION_SPACING_M);
  }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, Math.max(1, matrices.length));
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.count = matrices.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = 'WindbreakMullions';
  mesh.castShadow = true;
  return mesh;
}

/**
 * Giant glazed wall on one side of the band between stands and roof: a row of tall framed glass
 * doors that stay shut, pivot on their vertical axis, or slide apart and stack at both ends.
 */
function buildGlassWall(rail: FacadeRailSample[], cfg: GlassWallConfig): THREE.Group {
  const group = new THREE.Group();
  group.name = 'GlassEndWall';
  const sampler = createRailSampler(rail, false);
  if (!sampler) return group;
  const { totalLen, sampleAtArc } = sampler;
  const n = Math.max(3, Math.min(8, Math.round(totalLen / 24)));
  const w = totalLen / n;
  const open = Math.max(0, Math.min(1, cfg.openRatio));
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xcfe3f5,
    transparent: true,
    opacity: 0.3,
    roughness: 0.04,
    metalness: 0.15,
    clearcoat: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const frame = new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.4, metalness: 0.7 });
  for (let i = 0; i < n; i++) {
    const c = sampleAtArc((i + 0.5) * w);
    const a = sampleAtArc(i * w + 0.01);
    const b = sampleAtArc(Math.min(totalLen - 0.01, (i + 1) * w));
    const yB = Math.max(a.yBottom, b.yBottom, c.yBottom);
    const h = Math.min(a.yTop, b.yTop, c.yTop) - yB;
    if (h < 2) continue;
    const door = new THREE.Group();
    door.name = 'GlassWallDoor';
    const pane = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, h - 0.3, 0.12), glass);
    door.add(pane);
    // Frame: posts, rails and two transoms.
    for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, h, 0.5), frame);
      post.position.x = x;
      door.add(post);
    }
    for (const y of [-h / 2 + 0.2, -h / 6, h / 6, h / 2 - 0.2]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, 0.4), frame);
      rail.position.y = y;
      door.add(rail);
    }
    door.position.set(c.x, yB + h / 2, c.z);
    door.rotation.y = Math.atan2(c.nx, c.nz);
    if (cfg.motion === 'pivot') {
      door.rotation.y += open * (Math.PI / 2) * 0.95;
    } else if (cfg.motion === 'slide') {
      // Each half parts toward its end, the panels nesting outward of one another.
      const half = (n - 1) / 2;
      const steps = i < half ? i : i > half ? n - 1 - i : 0;
      const dir = i < half ? -1 : 1;
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const tx = (b.x - a.x) / len;
      const tz = (b.z - a.z) / len;
      const shift = open * steps * w * dir;
      const out = open * steps * 0.7;
      door.position.x += tx * shift + c.nx * out;
      door.position.z += tz * shift + c.nz * out;
    }
    group.add(door);
  }
  return group;
}

import * as THREE from 'three';
import { FacadePatternId } from './schema';
import { createRailSampler, type FacadeRailSample, referenceHeight } from './envelopes/rail';

/**
 * Parametric relief patterns (honeycomb, voronoi, triangulated lace, scales…) laid over a facade
 * rail, whichever envelope style carries them.
 */

/** Outward bow (m) of a bulged skin at relative height `f` (0 = bottom, 1 = top). */
function bulgeOffset(bulge: number, f: number): number {
  return Math.max(0, Math.min(1, bulge)) * 6 * Math.sin(Math.PI * f);
}

/**
 * Tiled skins standing proud of the facade: `triangulated_lace` (Jean Bouin) alternates up- and
 * down-pointing triangular panels whose size varies across the skin, and `scales` (La Défense
 * Arena) hangs rows of shingles tilted out at the bottom so each overlaps the row below.
 */
function buildTiledSkin(
  pattern: 'triangulated_lace' | 'scales',
  sampleAtArc: (s: number) => FacadeRailSample,
  totalLen: number,
  closed: boolean,
  density: number,
  depth: number,
  bulge: number,
  mat: THREE.Material,
  group: THREE.Group
): THREE.Group {
  const lace = pattern === 'triangulated_lace';
  const tileW = lace ? Math.max(2.2, 4.6 / density) : Math.max(2.0, 4.2 / density);
  const cols = Math.max(4, Math.min(400, Math.round(totalLen / tileW)));
  const stepS = totalLen / cols;
  const dummy = new THREE.Object3D();
  const matrices: THREE.Matrix4[] = [];
  const probe = sampleAtArc(0);
  const refH = Math.max(4, probe.yTop - probe.yBottom - 0.5);
  const rows = lace
    ? Math.max(2, Math.round(refH / (stepS * 0.87)))
    : Math.max(1, Math.min(5, Math.round(density * 2.4)));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols * (lace ? 2 : 1); c++) {
      // Lace: two triangles per column (pointing up, then down); scales: offset every other row.
      const sCenter = lace ? (c * 0.5 + 0.25 + (r % 2) * 0.5) * stepS : (c + 0.5 + (r % 2) * 0.5) * stepS;
      if (!closed && (sCenter < stepS * 0.3 || sCenter > totalLen - stepS * 0.3)) continue;
      const pt = sampleAtArc(closed ? sCenter % totalLen : sCenter);
      const wallH = pt.yTop - pt.yBottom - 0.5;
      if (wallH < 2.5) continue;
      const rowH = wallH / rows;
      const f = (r + 0.5) / rows;
      const yaw = Math.atan2(pt.nx, pt.nz);
      const out = depth * 0.5 + bulgeOffset(bulge, f);
      dummy.position.set(pt.x + pt.nx * out, pt.yBottom + 0.25 + rowH * (r + 0.5), pt.z + pt.nz * out);
      if (lace) {
        // Panel size breathes across the skin so the openings between panels vary.
        const breathe = 0.72 + 0.22 * Math.sin(sCenter * 0.21 + r * 1.3) * Math.cos(sCenter * 0.07);
        const flip = (c + r) % 2 === 0 ? 0 : Math.PI;
        dummy.rotation.set(0, yaw, flip, 'YXZ');
        dummy.scale.set(stepS * breathe, rowH * breathe, Math.max(0.12, depth * 0.3));
      } else {
        dummy.rotation.set(-0.16, yaw, 0, 'YXZ');
        dummy.scale.set(stepS * 1.04, rowH * 1.12, Math.max(0.2, depth * 0.4));
      }
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    }
  }

  if (matrices.length > 0) {
    let geo: THREE.BufferGeometry;
    if (lace) {
      // Unit triangle (width 1, height 1) pointing up, extruded along +z.
      const tri = new THREE.Shape([
        new THREE.Vector2(-0.5, -0.5),
        new THREE.Vector2(0.5, -0.5),
        new THREE.Vector2(0, 0.5),
      ]);
      geo = new THREE.ExtrudeGeometry(tri, { depth: 1, bevelEnabled: false });
      geo.translate(0, 0, -0.5);
    } else {
      // Shingle: a shallow cylindrical shell, convex outward, 1 x 1 x 1.
      geo = new THREE.CylinderGeometry(0.62, 0.62, 1, 12, 1, true, -Math.PI / 4, Math.PI / 2);
      geo.rotateZ(Math.PI / 2);
      geo.rotateY(Math.PI / 2);
      geo.translate(0, 0, -0.44);
    }
    geo.computeVertexNormals();
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    inst.name = lace ? 'FacadeLacePanels' : 'FacadeScales';
    matrices.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }
  return group;
}

/** A facade cell as a convex polygon unrolled on the rail: `s` = arc length (m), `v` = height share. */
type FacadeCell = { s: number; v: number }[];

/** Share of each cell kept as panel; the rest opens as a joint between neighbours. */
const CELL_FILL = 0.84;

function shrinkCell(cell: FacadeCell): FacadeCell {
  const cs = cell.reduce((a, p) => a + p.s, 0) / cell.length;
  const cv = cell.reduce((a, p) => a + p.v, 0) / cell.length;
  return cell.map((p) => ({ s: cs + (p.s - cs) * CELL_FILL, v: cv + (p.v - cv) * CELL_FILL }));
}

/** Pointy-top hexagons in staggered rows, seamless around a closed rail. */
function honeycombCells(
  totalLen: number,
  closed: boolean,
  density: number,
  sampleAtArc: (s: number) => FacadeRailSample
): FacadeCell[] {
  const refH = referenceHeight(sampleAtArc, totalLen);
  const radius = Math.max(1.1, 2.4 / density);
  const cols = Math.max(4, Math.min(360, Math.round(totalLen / (Math.sqrt(3) * radius))));
  const w = totalLen / cols;
  const rows = Math.max(2, Math.round(refH / (1.5 * radius)));
  const dv = 1 / rows;
  // Hexagon height spans 4/3 of the row pitch so rows interlock.
  const hv = (dv * 4) / 3;
  const cells: FacadeCell[] = [];
  for (let r = 0; r <= rows; r++) {
    const cv = r * dv;
    for (let c = 0; c < cols + (closed ? 0 : 1); c++) {
      const cs = (c + (r % 2) * 0.5) * w;
      const cell: FacadeCell = [];
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 2 + (k * Math.PI) / 3;
        cell.push({ s: cs + Math.cos(a) * w * 0.5 * (2 / Math.sqrt(3)), v: cv + Math.sin(a) * hv * 0.5 });
      }
      const clipped = closed ? cell : clipCell(cell, 's', 0, totalLen);
      const inBand = clipCell(clipped, 'v', 0, 1);
      if (inBand.length >= 3) cells.push(shrinkCell(inBand));
    }
  }
  return cells;
}

/** Deterministic pseudo-random in `[0, 1)`. */
function hash01(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Clips a convex cell to `lo <= p[key] <= hi`. */
function clipCell(cell: FacadeCell, key: 's' | 'v', lo: number, hi: number): FacadeCell {
  let out = clipHalfPlane(cell, (p) => p[key] - lo);
  out = clipHalfPlane(out, (p) => hi - p[key]);
  return out;
}

/** Keeps the part of `cell` where `side(p) >= 0` (side is affine in the point). */
function clipHalfPlane(cell: FacadeCell, side: (p: { s: number; v: number }) => number): FacadeCell {
  const out: FacadeCell = [];
  for (let i = 0; i < cell.length; i++) {
    const a = cell[i];
    const b = cell[(i + 1) % cell.length];
    const da = side(a);
    const db = side(b);
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push({ s: a.s + (b.s - a.s) * t, v: a.v + (b.v - a.v) * t });
    }
  }
  return out;
}

/**
 * Voronoi cells of jittered seeds, rows packed tighter toward the top so the cells get finer as
 * the facade rises. Each cell is the seed's square neighbourhood clipped by the bisectors of the
 * nearby seeds (in metres, so cells keep their proportions on a tall or low wall).
 */
function voronoiCells(
  totalLen: number,
  closed: boolean,
  density: number,
  sampleAtArc: (s: number) => FacadeRailSample
): FacadeCell[] {
  const refH = referenceHeight(sampleAtArc, totalLen);
  const size = Math.max(2.2, 4.8 / density);
  const cols = Math.max(4, Math.min(240, Math.round(totalLen / size)));
  const w = totalLen / cols;
  const rows = Math.max(2, Math.round(refH / size));
  // Row lines warped so the upper rows are thinner.
  const rowV = (r: number) => 1 - Math.pow(1 - r / rows, 1.45);
  const seeds: { s: number; y: number; c: number; r: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const v0 = rowV(r);
    const v1 = rowV(r + 1);
    for (let c = 0; c < cols; c++) {
      const v = v0 + (v1 - v0) * (0.2 + 0.6 * hash01(c, r + 7));
      seeds.push({ s: (c + 0.15 + 0.7 * hash01(c + 3, r)) * w, y: v * refH, c, r });
    }
  }
  const seedAt = (c: number, r: number) => {
    if (r < 0 || r >= rows) return null;
    if (closed) {
      const wrapped = ((c % cols) + cols) % cols;
      const seed = seeds[r * cols + wrapped];
      return { s: seed.s + (c - wrapped) * w, y: seed.y };
    }
    if (c < 0 || c >= cols) return null;
    return seeds[r * cols + c];
  };

  const cells: FacadeCell[] = [];
  for (const seed of seeds) {
    const reach = Math.max(w, refH / rows) * 3;
    let poly: { s: number; v: number }[] = [
      { s: seed.s - reach, v: seed.y - reach },
      { s: seed.s + reach, v: seed.y - reach },
      { s: seed.s + reach, v: seed.y + reach },
      { s: seed.s - reach, v: seed.y + reach },
    ];
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        if (dr === 0 && dc === 0) continue;
        const o = seedAt(seed.c + dc, seed.r + dr);
        if (!o) continue;
        const ms = (seed.s + o.s) / 2;
        const my = (seed.y + o.y) / 2;
        const ds = seed.s - o.s;
        const dy = seed.y - o.y;
        poly = clipHalfPlane(poly, (p) => (p.s - ms) * ds + (p.v - my) * dy);
        if (poly.length < 3) break;
      }
    }
    let cell: FacadeCell = poly.map((p) => ({ s: p.s, v: p.v / refH }));
    if (!closed) cell = clipCell(cell, 's', 0, totalLen);
    cell = clipCell(cell, 'v', 0, 1);
    if (cell.length >= 3) cells.push(shrinkCell(cell));
  }
  return cells;
}

/** Extrudes unrolled cells into panels standing proud of the rail (one merged mesh). */
function extrudeCellsOnRail(
  cells: FacadeCell[],
  sampleAtArc: (s: number) => FacadeRailSample,
  totalLen: number,
  closed: boolean,
  depth: number,
  bulge: number
): THREE.BufferGeometry | null {
  const thickness = Math.max(0.12, depth * 0.35);
  const positions: number[] = [];
  const uvs: number[] = [];
  const toWorld = (p: { s: number; v: number }, front: boolean): THREE.Vector3 | null => {
    const s = closed ? ((p.s % totalLen) + totalLen) % totalLen : p.s;
    const pt = sampleAtArc(s);
    const wallH = pt.yTop - pt.yBottom - 0.5;
    if (wallH < 2.5) return null;
    const out = depth * 0.5 + bulgeOffset(bulge, p.v) + (front ? 0 : -thickness);
    return new THREE.Vector3(pt.x + pt.nx * out, pt.yBottom + 0.25 + p.v * wallH, pt.z + pt.nz * out);
  };
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, flip: boolean) => {
    const [p, q, r] = flip ? [a, c, b] : [a, b, c];
    positions.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
    for (const v of [p, q, r]) uvs.push(v.x * 0.25 + v.z * 0.25, v.y * 0.25);
  };

  for (const cell of cells) {
    const front = cell.map((p) => toWorld(p, true));
    const back = cell.map((p) => toWorld(p, false));
    if (front.some((v) => !v) || back.some((v) => !v)) continue;
    const f = front as THREE.Vector3[];
    const b = back as THREE.Vector3[];
    const cf = f.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(f.length);
    const cb = b.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(b.length);
    // Face the front fan outward, whichever way the rail runs.
    const outward = new THREE.Vector3().subVectors(cf, cb);
    const n = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(f[0], cf),
      new THREE.Vector3().subVectors(f[1], cf)
    );
    const flip = n.dot(outward) < 0;
    for (let i = 0; i < f.length; i++) {
      const j = (i + 1) % f.length;
      tri(cf, f[i], f[j], flip);
      tri(cb, b[j], b[i], flip);
      tri(f[i], b[i], b[j], flip);
      tri(f[i], b[j], f[j], flip);
    }
  }
  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Generates a real 3D parametric facade relief assembly (`vertical_fins`, `diagrid`, or `cassette_panels`)
 * along a sequence of exterior wall samples (`samples[0..N-1]`).
 * Uses `InstancedMesh` so hundreds of fins, diagrid struts, or faceted cassettes render in 1-2 draw calls.
 */
export function buildParametricFacadeOnRail(params: {
  samples: FacadeRailSample[];
  closed: boolean;
  pattern: FacadePatternId;
  density: number;
  depth: number;
  /** Outward bow of `triangulated_lace` and `scales` skins (`0..1`, up to 6 m at mid-height). */
  bulge?: number;
  primaryMat: THREE.Material;
  accentMat: THREE.Material;
  name?: string;
}): THREE.Group | null {
  const {
    samples,
    closed,
    pattern,
    density,
    depth,
    bulge = 0,
    primaryMat,
    accentMat,
    name = 'ParametricFacadeRelief',
  } = params;

  if (pattern === 'none' || samples.length < 2) {
    return null;
  }

  const safeDensity = Math.max(0.4, Math.min(2.2, density));
  const safeDepth = Math.max(0.15, Math.min(2.4, depth));

  const rail = createRailSampler(samples, closed);
  if (!rail) return null;
  const { totalLen, sampleAtArc } = rail;

  const group = new THREE.Group();
  group.name = name;

  const dummy = new THREE.Object3D();
  const upVec = new THREE.Vector3(0, 1, 0);
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const qOrient = new THREE.Quaternion();

  if (pattern === 'triangulated_lace' || pattern === 'scales') {
    return buildTiledSkin(pattern, sampleAtArc, totalLen, closed, safeDensity, safeDepth, bulge, primaryMat, group);
  }

  if (pattern === 'honeycomb' || pattern === 'voronoi') {
    const cells =
      pattern === 'honeycomb'
        ? honeycombCells(totalLen, closed, safeDensity, sampleAtArc)
        : voronoiCells(totalLen, closed, safeDensity, sampleAtArc);
    const geo = extrudeCellsOnRail(cells, sampleAtArc, totalLen, closed, safeDepth, bulge);
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, primaryMat);
    mesh.name = pattern === 'honeycomb' ? 'FacadeHoneycomb' : 'FacadeVoronoi';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return group;
  }

  if (pattern === 'vertical_fins') {
    const spacing = Math.max(1.1, 2.85 / safeDensity);
    const finCount = Math.max(4, Math.min(480, Math.round(totalLen / spacing)));
    const stepS = totalLen / finCount;
    const finThickness = Math.max(0.08, Math.min(0.22, 0.14 / Math.sqrt(safeDensity)));

    const matrices: THREE.Matrix4[] = [];
    const tieMatrices: THREE.Matrix4[] = [];

    for (let i = 0; i < finCount; i++) {
      const s = closed ? i * stepS : (i + 0.5) * stepS;
      const pt = sampleAtArc(s);
      const h = pt.yTop - pt.yBottom - 0.5;
      if (h < 1.8) continue;

      const yaw = Math.atan2(pt.nx, pt.nz);
      // Slight rhythmic architectural twist (18° sun-shading louver angle)
      const louverTwist = 0.31;
      const outShift = safeDepth * 0.52 + 0.06;

      dummy.position.set(
        pt.x + pt.nx * outShift,
        pt.yBottom + 0.25 + h * 0.5,
        pt.z + pt.nz * outShift
      );
      dummy.rotation.set(0, yaw + louverTwist, 0);
      dummy.scale.set(finThickness, h, safeDepth);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());

      // Horizontal collector rail segment at mid-height and top
      const bayLen = stepS * 1.03;
      for (const frac of [0.35, 0.72]) {
        dummy.position.set(
          pt.x + pt.nx * 0.16,
          pt.yBottom + 0.25 + h * frac,
          pt.z + pt.nz * 0.16
        );
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.set(bayLen, 0.16, 0.24);
        dummy.updateMatrix();
        tieMatrices.push(dummy.matrix.clone());
      }
    }

    if (matrices.length > 0) {
      const finGeom = new THREE.BoxGeometry(1, 1, 1);
      const finInst = new THREE.InstancedMesh(finGeom, primaryMat, matrices.length);
      finInst.name = 'FacadeVerticalFins';
      for (let i = 0; i < matrices.length; i++) {
        finInst.setMatrixAt(i, matrices[i]);
      }
      finInst.instanceMatrix.needsUpdate = true;
      finInst.castShadow = true;
      finInst.receiveShadow = true;
      group.add(finInst);
    }

    if (tieMatrices.length > 0) {
      const tieGeom = new THREE.BoxGeometry(1, 1, 1);
      const tieInst = new THREE.InstancedMesh(tieGeom, accentMat, tieMatrices.length);
      tieInst.name = 'FacadeFinCollectors';
      for (let i = 0; i < tieMatrices.length; i++) {
        tieInst.setMatrixAt(i, tieMatrices[i]);
      }
      tieInst.instanceMatrix.needsUpdate = true;
      group.add(tieInst);
    }

    return group;
  }

  if (pattern === 'diagrid') {
    const bayWidth = Math.max(3.2, 7.6 / safeDensity);
    const bayCount = Math.max(4, Math.min(220, Math.round(totalLen / bayWidth)));
    const stepS = totalLen / bayCount;
    const courses = Math.max(2, Math.min(6, Math.round(2.4 * safeDensity)));
    const outOffset = safeDepth * 0.55 + 0.12;
    const ribRadius = Math.max(0.11, Math.min(0.36, 0.12 + safeDepth * 0.085));

    const strutMatrices: THREE.Matrix4[] = [];
    const ringMatrices: THREE.Matrix4[] = [];

    for (let i = 0; i < bayCount; i++) {
      const s0 = i * stepS;
      const s1 = (i + 1) * stepS;
      const pt0 = sampleAtArc(s0);
      const pt1 = sampleAtArc(closed && i === bayCount - 1 ? 0 : s1);

      const h0 = pt0.yTop - pt0.yBottom - 0.4;
      const h1 = pt1.yTop - pt1.yBottom - 0.4;
      if (h0 < 2.0 || h1 < 2.0) continue;

      for (let c = 0; c < courses; c++) {
        const fBot = c / courses;
        const fTop = (c + 1) / courses;

        const y0Bot = pt0.yBottom + 0.2 + h0 * fBot;
        const y0Top = pt0.yBottom + 0.2 + h0 * fTop;
        const y1Bot = pt1.yBottom + 0.2 + h1 * fBot;
        const y1Top = pt1.yBottom + 0.2 + h1 * fTop;

        // Rising diagonal: (pt0, bot) -> (pt1, top)
        pA.set(pt0.x + pt0.nx * outOffset, y0Bot, pt0.z + pt0.nz * outOffset);
        pB.set(pt1.x + pt1.nx * outOffset, y1Top, pt1.z + pt1.nz * outOffset);
        dir.subVectors(pB, pA);
        const lenUp = dir.length();
        if (lenUp > 0.25) {
          mid.addVectors(pA, pB).multiplyScalar(0.5);
          qOrient.setFromUnitVectors(upVec, dir.normalize());
          dummy.position.copy(mid);
          dummy.quaternion.copy(qOrient);
          dummy.scale.set(ribRadius, lenUp, safeDepth * 0.55 + ribRadius);
          dummy.updateMatrix();
          strutMatrices.push(dummy.matrix.clone());
        }

        // Falling diagonal: (pt0, top) -> (pt1, bot)
        pA.set(pt0.x + pt0.nx * outOffset, y0Top, pt0.z + pt0.nz * outOffset);
        pB.set(pt1.x + pt1.nx * outOffset, y1Bot, pt1.z + pt1.nz * outOffset);
        dir.subVectors(pB, pA);
        const lenDown = dir.length();
        if (lenDown > 0.25) {
          mid.addVectors(pA, pB).multiplyScalar(0.5);
          qOrient.setFromUnitVectors(upVec, dir.normalize());
          dummy.position.copy(mid);
          dummy.quaternion.copy(qOrient);
          dummy.scale.set(ribRadius, lenDown, safeDepth * 0.55 + ribRadius);
          dummy.updateMatrix();
          strutMatrices.push(dummy.matrix.clone());
        }

        // Horizontal node ring beam at top of course
        pA.set(pt0.x + pt0.nx * (outOffset * 0.78), y0Top, pt0.z + pt0.nz * (outOffset * 0.78));
        pB.set(pt1.x + pt1.nx * (outOffset * 0.78), y1Top, pt1.z + pt1.nz * (outOffset * 0.78));
        dir.subVectors(pB, pA);
        const ringLen = dir.length();
        if (ringLen > 0.2) {
          mid.addVectors(pA, pB).multiplyScalar(0.5);
          qOrient.setFromUnitVectors(upVec, dir.normalize());
          dummy.position.copy(mid);
          dummy.quaternion.copy(qOrient);
          dummy.scale.set(ribRadius * 0.75, ringLen, ribRadius * 0.9);
          dummy.updateMatrix();
          ringMatrices.push(dummy.matrix.clone());
        }
      }
    }

    if (strutMatrices.length > 0) {
      const strutGeom = new THREE.BoxGeometry(1, 1, 1);
      const strutInst = new THREE.InstancedMesh(
        strutGeom,
        accentMat,
        strutMatrices.length
      );
      strutInst.name = 'FacadeDiagridStruts';
      for (let i = 0; i < strutMatrices.length; i++) {
        strutInst.setMatrixAt(i, strutMatrices[i]);
      }
      strutInst.instanceMatrix.needsUpdate = true;
      strutInst.castShadow = true;
      strutInst.receiveShadow = true;
      group.add(strutInst);
    }

    if (ringMatrices.length > 0) {
      const ringGeom = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
      const ringInst = new THREE.InstancedMesh(
        ringGeom,
        primaryMat,
        ringMatrices.length
      );
      ringInst.name = 'FacadeDiagridRings';
      for (let i = 0; i < ringMatrices.length; i++) {
        ringInst.setMatrixAt(i, ringMatrices[i]);
      }
      ringInst.instanceMatrix.needsUpdate = true;
      group.add(ringInst);
    }

    return group;
  }

  // `cassette_panels`: staggered 3D faceted architectural cassettes
  const panelSpan = Math.max(2.4, 5.4 / safeDensity);
  const colCount = Math.max(4, Math.min(260, Math.round(totalLen / panelSpan)));
  const stepS = totalLen / colCount;
  const rowCount = Math.max(3, Math.min(10, Math.round(4.2 * safeDensity)));

  const cassetteMatrices: THREE.Matrix4[] = [];
  for (let r = 0; r < rowCount; r++) {
    const fBot = r / rowCount;
    const fTop = (r + 1) / rowCount;
    const stagger = (r % 2) * 0.5;
    const colsInRow = closed ? colCount : Math.max(2, colCount - (r % 2));

    for (let c = 0; c < colsInRow; c++) {
      const sCenter = (c + 0.5 + stagger) * stepS;
      if (!closed && (sCenter < stepS * 0.35 || sCenter > totalLen - stepS * 0.35)) {
        continue;
      }
      const pt = sampleAtArc(closed ? sCenter % totalLen : sCenter);
      const wallH = pt.yTop - pt.yBottom - 0.5;
      if (wallH < 2.2) continue;

      const panelH = Math.max(0.65, (wallH / rowCount) * 0.86);
      const panelW = Math.max(0.8, stepS * 0.88);
      const yMid = pt.yBottom + 0.25 + wallH * ((fBot + fTop) * 0.5);

      const yaw = Math.atan2(pt.nx, pt.nz);
      // Alternating subtle 3D facet tilt so light & sky reflections play across cassettes
      const checker = (c + r) % 2 === 0 ? 1 : -1;
      const pitchTilt = checker * Math.min(0.18, 0.05 + safeDepth * 0.055);
      const yawTilt = ((c % 3) - 1) * 0.055;
      const outShift = safeDepth * (0.42 + ((c + r) % 2) * 0.16);

      dummy.position.set(
        pt.x + pt.nx * outShift,
        yMid,
        pt.z + pt.nz * outShift
      );
      dummy.rotation.set(pitchTilt, yaw + yawTilt, 0, 'YXZ');
      dummy.scale.set(panelW, panelH, Math.max(0.14, safeDepth * 0.55));
      dummy.updateMatrix();
      cassetteMatrices.push(dummy.matrix.clone());
    }
  }

  if (cassetteMatrices.length > 0) {
    // Beveled 4-sided pyramid/frustum cassette box for crisp light-catching facets
    const baseGeom = new THREE.CylinderGeometry(0.62, 0.72, 1, 4, 1);
    baseGeom.rotateY(Math.PI * 0.25);
    baseGeom.rotateX(Math.PI * 0.5);
    baseGeom.computeVertexNormals();

    const cassetteInst = new THREE.InstancedMesh(
      baseGeom,
      primaryMat,
      cassetteMatrices.length
    );
    cassetteInst.name = 'FacadeCassettePanels';
    for (let i = 0; i < cassetteMatrices.length; i++) {
      cassetteInst.setMatrixAt(i, cassetteMatrices[i]);
    }
    cassetteInst.instanceMatrix.needsUpdate = true;
    cassetteInst.castShadow = true;
    cassetteInst.receiveShadow = true;
    group.add(cassetteInst);
  }

  return group;
}

/**
 * Convenience helper for straight stands in stand-local coordinates:
 * rear exterior wall sits at `z = rearWallZ` with outward normal `(0, 0, +1)` across `x in [-span/2, +span/2]`.
 */
export function buildStraightParametricFacade(params: {
  span: number;
  rearWallZ: number;
  yBottom: number;
  yTop: number;
  pattern: FacadePatternId;
  density: number;
  depth: number;
  /** Outward bow of `triangulated_lace` and `scales` skins (`0..1`, up to 6 m at mid-height). */
  bulge?: number;
  primaryMat: THREE.Material;
  accentMat: THREE.Material;
  name?: string;
}): THREE.Group | null {
  const {
    span,
    rearWallZ,
    yBottom,
    yTop,
    pattern,
    density,
    depth,
    bulge,
    primaryMat,
    accentMat,
    name,
  } = params;
  if (pattern === 'none' || span < 4 || yTop - yBottom < 2.0) return null;

  const samples: FacadeRailSample[] = [
    {
      x: -span * 0.49,
      z: rearWallZ,
      nx: 0,
      nz: 1,
      yBottom,
      yTop,
    },
    {
      x: span * 0.49,
      z: rearWallZ,
      nx: 0,
      nz: 1,
      yBottom,
      yTop,
    },
  ];

  return buildParametricFacadeOnRail({
    samples,
    closed: false,
    pattern,
    density,
    depth,
    bulge,
    primaryMat,
    accentMat,
    name,
  });
}

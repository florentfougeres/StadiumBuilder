import * as THREE from 'three';
import { FacadePatternId } from './schema';

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
    primaryMat,
    accentMat,
    name = 'ParametricFacadeRelief',
  } = params;

  if (pattern === 'none' || samples.length < 2) {
    return null;
  }

  const safeDensity = Math.max(0.4, Math.min(2.2, density));
  const safeDepth = Math.max(0.15, Math.min(2.4, depth));

  // Build cumulative arc-length table for uniform arc-length resampling
  const segCount = closed ? samples.length : samples.length - 1;
  const cumLen: number[] = [0];
  let totalLen = 0;
  for (let i = 0; i < segCount; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % samples.length];
    const ds = Math.hypot(b.x - a.x, b.z - a.z);
    totalLen += ds;
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
    };
  };

  const group = new THREE.Group();
  group.name = name;

  const dummy = new THREE.Object3D();
  const upVec = new THREE.Vector3(0, 1, 0);
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const qOrient = new THREE.Quaternion();

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
    primaryMat,
    accentMat,
    name,
  });
}

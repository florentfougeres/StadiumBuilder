import * as THREE from 'three';
import { createRailSampler, type FacadeRailSample, instancedBoxes, referenceHeight } from './rail';
import { dressedSkin } from './skin';

/** Arcade bay width (m) and the storey height an arcade aims for. */
const ARCADE_BAY = 8;

const ARCADE_STOREY = 10;

/** Arcade screen offset in front of the wall (m), leaving a loggia behind the arches. */
const ARCADE_OUT = 1.7;

/**
 * Storeys of round-arched bays on piers standing in front of the wall, each storey capped by a
 * cornice, the heritage arcaded elevation. One bay is a single extruded frame (piers, arch and
 * spandrels) instanced around the rail.
 */
function buildStackedArcades(samples: FacadeRailSample[], closed: boolean, mat: THREE.Material): THREE.Group | null {
  const rail = createRailSampler(samples, closed);
  if (!rail) return null;
  const { totalLen, sampleAtArc } = rail;
  const refH = referenceHeight(sampleAtArc, totalLen) + 0.5;
  // A band lower than an arcade storey (the strip up to the roof) keeps its plain wall.
  if (refH < ARCADE_STOREY * 0.6) return null;
  const storeys = Math.max(1, Math.min(4, Math.round(refH / ARCADE_STOREY)));
  const bays = Math.max(3, Math.round(totalLen / ARCADE_BAY));
  const step = totalLen / bays;
  // Bay frame drawn one bay wide, `aspect` tall: piers 0.2 wide each side, a half-round arch
  // springing so a 0.14-high spandrel band remains above its crown.
  const aspect = refH / storeys / step;
  const r = Math.min(0.3, aspect * 0.4);
  const spring = Math.max(0.05, aspect - 0.14 * aspect - r);
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.lineTo(-r, 0);
  shape.lineTo(-r, spring);
  shape.absarc(0, spring, r, Math.PI, 0, true);
  shape.lineTo(r, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0.5, aspect);
  shape.lineTo(-0.5, aspect);
  shape.closePath();
  const bayGeo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 10 });
  bayGeo.translate(0, 0, -0.5);
  // Shape units are one bay wide: rescale the uvs so the masonry tiles every 2.5 m, not per bay.
  const uv = bayGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * step) / 2.5, (uv.getY(i) * step) / 2.5);

  const dummy = new THREE.Object3D();
  const bayMats: THREE.Matrix4[] = [];
  const cornices: THREE.Matrix4[] = [];
  const loggias: THREE.Matrix4[] = [];
  for (let i = 0; i < bays; i++) {
    const pt = sampleAtArc(closed ? (i + 0.5) * step : (i + 0.5) * step);
    const h = pt.yTop - pt.yBottom;
    if (h < 3) continue;
    const storeyH = h / storeys;
    const yaw = Math.atan2(pt.nx, pt.nz);
    for (let k = 0; k < storeys; k++) {
      const y = pt.yBottom + k * storeyH;
      dummy.position.set(pt.x + pt.nx * ARCADE_OUT, y, pt.z + pt.nz * ARCADE_OUT);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(step * 1.03, storeyH / aspect, 0.9);
      dummy.updateMatrix();
      bayMats.push(dummy.matrix.clone());
      dummy.position.set(pt.x + pt.nx * (ARCADE_OUT + 0.15), y + storeyH - 0.18, pt.z + pt.nz * (ARCADE_OUT + 0.15));
      dummy.scale.set(step * 1.02, 0.36, 1.2);
      dummy.updateMatrix();
      cornices.push(dummy.matrix.clone());
      // Shadowed loggia behind the arches, so the openings read from afar.
      dummy.position.set(pt.x + pt.nx * (ARCADE_OUT - 1.1), y + storeyH / 2, pt.z + pt.nz * (ARCADE_OUT - 1.1));
      dummy.scale.set(step * 1.01, storeyH, 0.1);
      dummy.updateMatrix();
      loggias.push(dummy.matrix.clone());
    }
  }
  if (bayMats.length === 0) return null;
  const group = new THREE.Group();
  group.name = 'EnvelopeArcades';
  const arcades = new THREE.InstancedMesh(bayGeo, mat, bayMats.length);
  arcades.name = 'ArcadeBays';
  bayMats.forEach((m, i) => arcades.setMatrixAt(i, m));
  arcades.instanceMatrix.needsUpdate = true;
  arcades.computeBoundingSphere();
  arcades.castShadow = true;
  arcades.receiveShadow = true;
  group.add(arcades);
  const corniceMesh = instancedBoxes('ArcadeCornices', cornices, mat);
  if (corniceMesh) group.add(corniceMesh);
  const shade = new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 0.95 });
  const loggiaMesh = instancedBoxes('ArcadeLoggias', loggias, shade);
  if (loggiaMesh) group.add(loggiaMesh);
  return group;
}

/** `stacked_arcades`: storeys of round arches on piers, in the facade material. */
export const stackedArcades = dressedSkin((p) => buildStackedArcades(p.samples, p.closed, p.facadeMat ?? p.frameMat));

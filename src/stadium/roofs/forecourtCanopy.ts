import * as THREE from 'three';
import { createStructurePbrMaterial, resolveStadiumMaterials } from '../materials';
import { getEffectiveSunkenDepth, StadiumDocument } from '../schema';
import { buildCanopyMaterialBundle } from './roofKit';

/** Deepest canopy reach over the forecourt (m). */
export const FORECOURT_CANOPY_MAX_DEPTH = 90;
/** Column grid under the canopy (m). */
const COLUMN_GRID = 18;
/** Slope of the canopy falling away from the stadium roof. */
const FALL = Math.tan(THREE.MathUtils.degToRad(3));

/**
 * Canopy carrying the stadium roof on over the forecourt on one side, open on its edges and held
 * by a grid of slender columns (Inglewood: one translucent roof over the bowl and the plaza).
 * It starts at the roof's outer edge on that side, found by measuring the roof built before it.
 */
export function buildForecourtCanopy(doc: StadiumDocument, roof: THREE.Object3D, maxAnisotropy: number): THREE.Group | null {
  const cfg = doc.roof.forecourtCanopy;
  if (!cfg || cfg.depth < 4 || doc.roof.style === 'none') return null;
  roof.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(roof);
  if (box.isEmpty()) return null;

  // Local frame: `u` runs along the side, `v` outward from the stadium.
  const alongX = cfg.side === 'north' || cfg.side === 'south';
  const sign = cfg.side === 'south' || cfg.side === 'east' ? 1 : -1;
  const edge = alongX ? (sign > 0 ? box.max.z : -box.min.z) : sign > 0 ? box.max.x : -box.min.x;
  const halfSpan = (alongX ? box.max.x - box.min.x : box.max.z - box.min.z) * 0.36;
  const world = (u: number, v: number, y: number) =>
    alongX ? new THREE.Vector3(u, y, sign * v) : new THREE.Vector3(sign * v, y, u);

  // Height of the roof surface just inside its edge, probed straight down.
  const raycaster = new THREE.Raycaster();
  const meshes: THREE.Object3D[] = [];
  roof.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) meshes.push(o);
  });
  let edgeY = box.min.y + (box.max.y - box.min.y) * 0.3;
  raycaster.set(world(0, edge - 4, box.max.y + 5), new THREE.Vector3(0, -1, 0));
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (hit) edgeY = hit.point.y;

  const v0 = edge - 4;
  const v1 = edge + cfg.depth;
  const y0 = edgeY - 0.4;
  const y1 = y0 - (v1 - v0) * FALL;
  const group = new THREE.Group();
  group.name = 'ForecourtCanopy';

  const { surfaceMat } = buildCanopyMaterialBundle(doc, maxAnisotropy, Math.max(2, cfg.depth / 12), 2);
  const corners = [world(-halfSpan, v0, y0), world(halfSpan, v0, y0), world(halfSpan, v1, y1), world(-halfSpan, v1, y1)];
  const geo = new THREE.BufferGeometry().setFromPoints(corners);
  geo.setIndex(sign > 0 === alongX ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geo.computeVertexNormals();
  const deck = new THREE.Mesh(geo, surfaceMat);
  deck.name = 'RoofCanopySurface';
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  const steel = createStructurePbrMaterial(resolveStadiumMaterials(doc).structure, maxAnisotropy);
  const groundY = getEffectiveSunkenDepth(doc) > 0.5 ? getEffectiveSunkenDepth(doc) : 0;
  const beam = (a: THREE.Vector3, b: THREE.Vector3, size: number) => {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, len), steel);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.lookAt(b);
    m.castShadow = true;
    return m;
  };
  // Edge beams and a grid of ribs under the deck.
  const ribs = Math.max(2, Math.round((halfSpan * 2) / COLUMN_GRID));
  for (let i = 0; i <= ribs; i++) {
    const u = -halfSpan + (i / ribs) * halfSpan * 2;
    group.add(beam(world(u, v0, y0 - 0.5), world(u, v1, y1 - 0.5), 0.7));
  }
  group.add(beam(world(-halfSpan, v1, y1 - 0.5), world(halfSpan, v1, y1 - 0.5), 0.9));
  // Slender columns on the grid, clear of the facade.
  const rows = Math.max(1, Math.floor((v1 - edge - 6) / COLUMN_GRID) + 1);
  for (let r = 0; r < rows; r++) {
    const v = Math.min(v1 - 2, edge + 10 + r * COLUMN_GRID);
    const y = y0 - (v - v0) * FALL - 0.5;
    for (let i = 0; i <= ribs; i++) {
      const u = -halfSpan + (i / ribs) * halfSpan * 2;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, y - groundY, 10), steel);
      col.position.copy(world(u, v, (y + groundY) / 2));
      col.castShadow = true;
      group.add(col);
    }
  }
  return group;
}

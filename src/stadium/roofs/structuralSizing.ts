import * as THREE from 'three';

/**
 * Rules of thumb an engineer sizes a roof frame with before any calculation. Members drawn to
 * them read as a structure that carries its roof; members drawn at one fixed size read as a model.
 */

/** Slenderness limit of a roof column: its free height over its diameter. */
const COLUMN_SLENDERNESS = 30;

/** Smallest radius (m) a column of free height `height` can have. */
export const columnRadiusFor = (height: number): number => height / (2 * COLUMN_SLENDERNESS);

/** Depth (m) of a truss simply supported over `span`: a fourteenth of it, within `[min, max]`. */
export const trussDepthFor = (span: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, span / 14));

/** Height (m) of the tie mast over a roof cantilevering `reach`: a sixth of it, within `[min, max]`. */
export const cantileverMastRise = (reach: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, reach / 6));

/** Columns are braced one bay in this many. */
const BRACED_BAY_EVERY = 4;

interface FoundColumn {
  mesh: THREE.Mesh;
  foot: THREE.Vector3;
  head: THREE.Vector3;
  height: number;
  radius: number;
}

const _UP = new THREE.Vector3(0, 1, 0);

/** Unit box stretched from `a` to `b` with a square section `size`. */
function rodMatrix(a: THREE.Vector3, b: THREE.Vector3, size: number): THREE.Matrix4 {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  return new THREE.Matrix4().compose(
    new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5),
    new THREE.Quaternion().setFromUnitVectors(_UP, dir.normalize()),
    new THREE.Vector3(size, len, size)
  );
}

/**
 * Near-vertical cylinders at least 5 m tall and 14 cm thick, in the roof's own space: the columns
 * of every roof style, whichever builder made them (the same reading `addColumnDownpipes` uses).
 */
function findColumns(roof: THREE.Object3D): FoundColumn[] {
  roof.updateMatrixWorld(true);
  const toRoot = roof.matrixWorld.clone().invert();
  const m = new THREE.Matrix4();
  const found: FoundColumn[] = [];
  roof.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return;
    const geo = mesh.geometry as THREE.CylinderGeometry;
    if (geo.type !== 'CylinderGeometry') return;
    const { height, radiusTop, radiusBottom } = geo.parameters;
    if (height < 5 || Math.min(radiusTop, radiusBottom) < 0.14) return;
    m.multiplyMatrices(toRoot, mesh.matrixWorld);
    const a = new THREE.Vector3(0, -height / 2, 0).applyMatrix4(m);
    const b = new THREE.Vector3(0, height / 2, 0).applyMatrix4(m);
    const foot = a.y < b.y ? a : b;
    const head = a.y < b.y ? b : a;
    const len = head.distanceTo(foot);
    if (len < 5 || (head.y - foot.y) / len < 0.95) return;
    const origin = new THREE.Vector3().applyMatrix4(m);
    const radius = new THREE.Vector3((radiusTop + radiusBottom) / 2, 0, 0).applyMatrix4(m).sub(origin).length();
    found.push({ mesh, foot, head, height: len, radius });
  });
  return found;
}

/**
 * Sizes the roof's columns to what they carry, and grounds them:
 * - a column too slender for its height is thickened to the slenderness limit;
 * - a column standing on the ground gets a concrete pad footing and a steel base plate;
 * - along each row of ground columns, one bay in four is cross-braced (the bays that keep a real
 *   frame from racking), in panels about as tall as the bay is wide.
 * Columns standing in the rows or on a stand crest are held by the stand: they are only sized.
 */
export function dimensionRoofColumns(roof: THREE.Object3D): void {
  const columns = findColumns(roof);
  if (columns.length === 0) return;

  for (const col of columns) {
    const needed = columnRadiusFor(col.height);
    if (col.radius >= needed) continue;
    // A cylinder runs along its local Y, so X and Z are its section.
    const k = Math.min(2.4, needed / col.radius);
    col.mesh.scale.x *= k;
    col.mesh.scale.z *= k;
    col.mesh.updateMatrix();
    col.radius *= k;
  }

  // Masts thicker than a metre stand on their own piled base, drawn by their builder.
  const grounded = columns.filter((c) => c.foot.y < 1 && c.radius < 1);
  if (grounded.length === 0) return;

  const pads: THREE.Matrix4[] = [];
  const plates: THREE.Matrix4[] = [];
  for (const col of grounded) {
    const yaw = new THREE.Quaternion().setFromAxisAngle(_UP, Math.atan2(col.foot.x, col.foot.z));
    const side = Math.max(1.3, col.radius * 5.5);
    pads.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(col.foot.x, col.foot.y + 0.16, col.foot.z),
        yaw,
        new THREE.Vector3(side, 0.5, side)
      )
    );
    const plate = col.radius * 3.4;
    plates.push(
      new THREE.Matrix4().compose(
        new THREE.Vector3(col.foot.x, col.foot.y + 0.44, col.foot.z),
        yaw,
        new THREE.Vector3(plate, 0.07, plate)
      )
    );
  }

  // Rows are read around the stadium: neighbours in bearing that stand a bay apart.
  const tall = grounded
    .filter((c) => c.height >= 8)
    .sort((a, b) => Math.atan2(a.foot.z, a.foot.x) - Math.atan2(b.foot.z, b.foot.x));
  const rods: THREE.Matrix4[] = [];
  const ties: THREE.Matrix4[] = [];
  const at = (c: FoundColumn, y: number) =>
    c.foot.clone().lerp(c.head, Math.min(1, Math.max(0, (y - c.foot.y) / (c.head.y - c.foot.y))));
  let bay = 0;
  for (let i = 0; i < tall.length; i++) {
    const a = tall[i];
    const b = tall[(i + 1) % tall.length];
    if (a === b) continue;
    const width = Math.hypot(a.foot.x - b.foot.x, a.foot.z - b.foot.z);
    if (width < 4 || width > 18 || Math.abs(a.head.y - b.head.y) > 3) continue;
    if (bay++ % BRACED_BAY_EVERY !== 1) continue;
    const y0 = Math.max(a.foot.y, b.foot.y) + 0.7;
    const y1 = Math.min(a.head.y, b.head.y) - 0.9;
    if (y1 - y0 < 4) continue;
    const panels = Math.min(5, Math.max(1, Math.round((y1 - y0) / width)));
    const size = Math.max(0.1, Math.min(a.radius, b.radius) * 0.36);
    for (let p = 0; p < panels; p++) {
      const lo = y0 + ((y1 - y0) * p) / panels;
      const hi = y0 + ((y1 - y0) * (p + 1)) / panels;
      rods.push(rodMatrix(at(a, lo), at(b, hi), size), rodMatrix(at(b, lo), at(a, hi), size));
      ties.push(rodMatrix(at(a, hi), at(b, hi), size * 1.5));
    }
  }

  const steel = grounded[0].mesh.material as THREE.Material;
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb4b1a9, roughness: 0.92, metalness: 0 });
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (const [name, list, mat] of [
    ['RoofColumnFootings', pads, concrete],
    ['RoofColumnBasePlates', plates, steel],
    ['RoofColumnBracing', rods, steel],
    ['RoofColumnBracingTies', ties, steel],
  ] as const) {
    if (list.length === 0) continue;
    const inst = new THREE.InstancedMesh(box, mat, list.length);
    list.forEach((mtx, i) => inst.setMatrixAt(i, mtx));
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.name = name;
    roof.add(inst);
  }
}

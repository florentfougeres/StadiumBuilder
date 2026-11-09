import * as THREE from 'three';
import { createRailSampler, instancedBoxes, railPoint, railStations, slab, strutMatrix, verticals } from './rail';
import type { FacadeRailSample } from './rail';
import { dressingGroup, place } from './dressingKit';
import type { EnvelopeDrawer, EnvelopeStandContext } from './types';

/**
 * `colonnade_forest`: behind the stands, a recessed glazed core, a deep cornice and three
 * staggered rows of slender columns (density adjustable); in front of a wall, two staggered rows.
 */
export const colonnadeForest: EnvelopeDrawer = {
  stand({ rail, closed, mats, structureMat, facadeMat, loft, wall, add }) {
    if (mats.colonnadeShape === 'doric') {
      add(wall(-1.6, 0.8));
      doricColonnade(rail, closed, mats.colonnadeDensity ?? 1, facadeMat, loft, add);
      return;
    }
    add(wall(-1.6, 0.8), loft(slab(-1.6, 6, 0.95, (pt) => pt.yTop - 0.8), structureMat));
    if (mats.colonnadeShape === 'square') {
      // Monumental square piers of stone (Berlin 1936): one row, in the facade cladding.
      const pierSpacing = 6.5 / Math.max(0.5, Math.min(4, mats.colonnadeDensity ?? 1));
      add(verticals(railStations(rail, closed, pierSpacing), 1.4, new THREE.BoxGeometry(1.5, 1, 1.5), facadeMat, 'EnvelopeSquarePiers'));
      return;
    }
    if (mats.colonnadeShape === 'palm') {
      add(palmColumns(railStations(rail, closed, 7.5 / Math.max(0.5, Math.min(4, mats.colonnadeDensity ?? 1))), structureMat));
      return;
    }
    const spacing = 4.2 / Math.max(0.5, Math.min(4, mats.colonnadeDensity ?? 1));
    const colGeo = new THREE.CylinderGeometry(0.21, 0.24, 1, 10);
    [0.2, 2.5, 4.8].forEach((out, r) => {
      add(verticals(railStations(rail, closed, spacing, r % 2 ? 0.5 : 0), out, colGeo, structureMat, 'EnvelopeColonnade'));
    });
  },
  dressing(p) {
  const rail = createRailSampler(p.samples, p.closed);
  if (!rail) return null;
  const { totalLen, sampleAtArc } = rail;
  const closed = p.closed;
    const columns: THREE.Matrix4[] = [];
    const count = Math.max(4, Math.round(totalLen / 2.4));
    const step = totalLen / count;
    for (let i = 0; i < count; i++) {
      for (const [out, shift] of [
        [1.8, 0],
        [3.6, 0.5],
      ] as const) {
        const pt = sampleAtArc(((closed ? i : i + 0.5) + shift) * step);
        const h = pt.yTop - pt.yBottom;
        if (h < 0.8) continue;
        columns.push(place(pt, out, pt.yBottom + h / 2, 0.36, h, 0.36));
      }
    }
    return dressingGroup([['EnvelopePrimary', columns]], p.frameMat);
  },
};

/** Fronds of each palm, fanned along the facade and outward. */
const PALM_FRONDS = 7;

/**
 * Stylised date palms: a tapering trunk that opens near the top into a fan of fronds reaching up
 * to the cornice, the fans of neighbouring palms meeting under it.
 */
function palmColumns(stations: FacadeRailSample[], mat: THREE.Material): THREE.Group | null {
  const trunks: THREE.Matrix4[] = [];
  const fronds: THREE.Matrix4[] = [];
  const out = 3.2;
  for (const pt of stations) {
    const h = pt.yTop - pt.yBottom;
    if (h < 6) continue;
    const crownY = pt.yBottom + h * 0.66;
    const base = railPoint(pt, out, pt.yBottom);
    const crown = railPoint(pt, out, crownY);
    trunks.push(strutMatrix(base, crown, 0.75));
    const tx = -pt.nz;
    const tz = pt.nx;
    for (let f = 0; f < PALM_FRONDS; f++) {
      const a = (f / (PALM_FRONDS - 1) - 0.5) * Math.PI * 0.85;
      const reach = 3.6;
      // Two segments per frond: rising out of the crown, then arching back toward the cornice.
      const mid = crown
        .clone()
        .add(new THREE.Vector3(tx * Math.sin(a) * reach, h * 0.17, tz * Math.sin(a) * reach))
        .add(new THREE.Vector3(pt.nx * Math.cos(a) * 1.2, 0, pt.nz * Math.cos(a) * 1.2));
      const tip = railPoint(pt, out - 2.4, pt.yTop - 0.8).add(
        new THREE.Vector3(tx * Math.sin(a) * reach * 1.25, 0, tz * Math.sin(a) * reach * 1.25)
      );
      fronds.push(strutMatrix(crown, mid, 0.28), strutMatrix(mid, tip, 0.2));
    }
  }
  const group = new THREE.Group();
  group.name = 'EnvelopePalms';
  for (const mesh of [instancedBoxes('EnvelopePalmTrunks', trunks, mat), instancedBoxes('EnvelopePalmFronds', fronds, mat)]) {
    if (mesh) {
      mesh.castShadow = true;
      group.add(mesh);
    }
  }
  return group.children.length ? group : null;
}

/** Doric order: 20 flutes, an entablature 1/4 of the column height, columns 7 diameters tall. */
const DORIC_FLUTES = 20;
const COLUMN_OUT = 3.2;

/** Unit-height fluted shaft of unit radius, slightly tapering toward the top. */
function flutedShaft(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.86, 1, 1, DORIC_FLUTES * 4, 1, false);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-4) continue;
    const a = Math.atan2(z, x);
    // Shallow concave flutes meeting at sharp arrises.
    const k = 1 - 0.07 * Math.abs(Math.sin((a * DORIC_FLUTES) / 2));
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Neoclassical Doric portico in front of the facade: a stepped stylobate, a row of fluted columns
 * with their capitals, and an entablature (architrave, frieze with triglyphs, projecting cornice).
 */
function doricColonnade(
  rail: EnvelopeStandContext['rail'],
  closed: boolean,
  density: number,
  stone: THREE.Material,
  loft: EnvelopeStandContext['loft'],
  add: EnvelopeStandContext['add']
): void {
  const tall = Math.max(...rail.map((pt) => pt.yTop - pt.yBottom));
  if (tall < 6) return;
  const entH = Math.max(1.6, Math.min(5, tall * 0.2));
  const stepH = 0.3;
  // Stylobate: three steps widening toward the ground.
  for (let k = 0; k < 3; k++) {
    add(loft(slab(-1.6, COLUMN_OUT + 2.4 - k * 0.45, stepH, (pt) => pt.yBottom + k * stepH), stone));
  }
  const entY = (pt: FacadeRailSample) => pt.yTop - 0.2 - entH;
  add(
    loft(slab(-1.6, COLUMN_OUT + 1.2, entH * 0.42, entY), stone),
    loft(slab(-1.6, COLUMN_OUT + 1.05, entH * 0.4, (pt) => entY(pt) + entH * 0.42), stone),
    loft(slab(-1.6, COLUMN_OUT + 1.9, entH * 0.18, (pt) => entY(pt) + entH * 0.82), stone)
  );

  const colH = (pt: FacadeRailSample) => entY(pt) - (pt.yBottom + 3 * stepH);
  const radius = Math.max(0.55, Math.min(1.3, (tall - entH) / 14));
  const spacing = (radius * 2 * 3.2) / Math.max(0.5, Math.min(4, density));
  const stations = railStations(rail, closed, spacing).filter((pt) => colH(pt) > 3);
  if (!stations.length) return;

  const shafts = new THREE.InstancedMesh(flutedShaft(), stone, stations.length);
  shafts.name = 'EnvelopeDoricColumns';
  const echinus = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.32, 0.9, 1, 24), stone, stations.length);
  const abaci: THREE.Matrix4[] = [];
  const triglyphs: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();
  stations.forEach((pt, i) => {
    const y0 = pt.yBottom + 3 * stepH;
    const h = colH(pt);
    const capH = Math.min(1.2, h * 0.08);
    const shaftH = h - capH;
    const yaw = Math.atan2(pt.nx, pt.nz);
    dummy.position.copy(railPoint(pt, COLUMN_OUT, y0 + shaftH / 2));
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(radius, shaftH, radius);
    dummy.updateMatrix();
    shafts.setMatrixAt(i, dummy.matrix);
    dummy.position.copy(railPoint(pt, COLUMN_OUT, y0 + shaftH + capH * 0.3));
    dummy.scale.set(radius, capH * 0.6, radius);
    dummy.updateMatrix();
    echinus.setMatrixAt(i, dummy.matrix);
    abaci.push(new THREE.Matrix4().compose(
      railPoint(pt, COLUMN_OUT, y0 + h - capH * 0.2),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
      new THREE.Vector3(radius * 2.7, capH * 0.4, radius * 2.7)
    ));
    // One triglyph over each column on the frieze face.
    const friezeY = entY(pt) + entH * 0.63;
    triglyphs.push(place(pt, COLUMN_OUT + 1.1, friezeY, radius * 1.2, entH * 0.36, 0.2));
  });
  for (const inst of [shafts, echinus]) {
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.castShadow = true;
    inst.receiveShadow = true;
  }
  add(shafts, echinus, instancedBoxes('EnvelopeDoricAbaci', abaci, stone), instancedBoxes('EnvelopeTriglyphs', triglyphs, stone));
}

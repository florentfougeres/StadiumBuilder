import * as THREE from 'three';
import { createRailSampler, instancedBoxes, railPoint, railStations, slab, strutMatrix, verticals } from './rail';
import type { FacadeRailSample } from './rail';
import { dressingGroup, place } from './dressingKit';
import type { EnvelopeDrawer } from './types';

/**
 * `colonnade_forest`: behind the stands, a recessed glazed core, a deep cornice and three
 * staggered rows of slender columns (density adjustable); in front of a wall, two staggered rows.
 */
export const colonnadeForest: EnvelopeDrawer = {
  stand({ rail, closed, mats, structureMat, loft, wall, add }) {
    add(wall(-1.6, 0.8), loft(slab(-1.6, 6, 0.95, (pt) => pt.yTop - 0.8), structureMat));
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

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D } from '../buildStadiumScene';
import { calculateStandMetrics, stadiumCornerLayout } from '../capacity';
import { generateRoofGroup } from '../generateRoof';
import { resolveCornerFollow } from '../generateStand';
import { createPresetDocument } from '../presets';
import { CornerJoin, CornerMode, RoofStyle, StadiumShape } from '../schema';

/** A four-stand ground with tall side stands and low end stands, all corners seated or built over. */
function asymmetricGround(shape: StadiumShape, join: CornerJoin, roof: RoofStyle, mode: CornerMode = 'filled') {
  const doc = createPresetDocument('traditional_four_stands_42k');
  doc.shape = shape;
  doc.cornerFill = true;
  doc.corners = { nw: mode, ne: mode, sw: mode, se: mode };
  doc.stands.east = { ...doc.stands.east, rows: 14, tiers: 1 };
  doc.stands.west = { ...doc.stands.west, rows: 14, tiers: 1 };
  doc.cornerJoin = join;
  doc.roof.style = roof;
  return doc;
}

/**
 * How far, from each corner's centre along its bisector, the corner stand reaches and the roof
 * canopy reaches. The stand's reach comes from the layout alone, independently of the roof code.
 */
function cornerReaches(doc: ReturnType<typeof asymmetricGround>) {
  const layout = stadiumCornerLayout(doc, false, resolveCornerFollow(doc));
  const roof = generateRoofGroup(doc);
  roof.updateMatrixWorld(true);
  const canopy: THREE.Vector3[] = [];
  roof.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.name !== 'RoofCanopySurface') return;
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      canopy.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    }
  });
  disposeObject3D(roof);

  return Object.values(layout.corners).map((c) => {
    const depthOf = (side: typeof c.sideA) => calculateStandMetrics(doc, side).totalDepth;
    const depth = c.follow ? depthOf(c.follow) : (depthOf(c.sideA) + depthOf(c.sideB)) / 2;
    const mid = (c.thetaStart + c.thetaEnd) / 2;
    const dir = new THREE.Vector2(Math.cos(mid), Math.sin(mid));
    // Canopy points in a narrow wedge around the bisector, measured along it.
    let roofReach = 0;
    for (const p of canopy) {
      const dx = p.x - c.cx;
      const dz = p.z - c.cz;
      const along = dx * dir.x + dz * dir.y;
      const across = Math.abs(-dx * dir.y + dz * dir.x);
      if (along > 0 && across < Math.max(4, along * 0.1)) roofReach = Math.max(roofReach, along);
    }
    return { id: c.id, stand: c.radius + depth, roof: roofReach };
  });
}

describe('whole-arena roofs over the corners of separate stands', () => {
  for (const shape of ['english_rectangular', 'compact_urban', 'four_stands'] as StadiumShape[]) {
    for (const join of ['blend', 'end', 'side'] as CornerJoin[]) {
      for (const roof of ['vaulted_ring', 'serrated_canopy', 'saucer_dome'] as RoofStyle[]) {
        it(`${roof} covers the ${join} corners of ${shape}`, () => {
          for (const c of cornerReaches(asymmetricGround(shape, join, roof))) {
            expect(c.roof, `corner ${c.id}`).toBeGreaterThanOrEqual(c.stand - 0.5);
          }
        });
      }
    }
  }

  for (const join of ['blend', 'end', 'side'] as CornerJoin[]) {
    it(`covers the ${join} corner buildings of english_rectangular`, () => {
      const doc = asymmetricGround('english_rectangular', join, 'vaulted_ring', 'building');
      for (const c of cornerReaches(doc)) {
        expect(c.roof, `corner ${c.id}`).toBeGreaterThanOrEqual(c.stand - 0.5);
      }
    });
  }

  it('corner buildings keep the stand the join picks', () => {
    const layout = (join: CornerJoin) => {
      const doc = asymmetricGround('english_rectangular', join, 'vaulted_ring', 'building');
      return stadiumCornerLayout(doc, false, resolveCornerFollow(doc)).corners.sw;
    };
    expect(layout('blend').follow).toBeUndefined();
    expect(layout('side').follow).toBe('south');
    expect(layout('end').follow).toBe('west');
  });
});

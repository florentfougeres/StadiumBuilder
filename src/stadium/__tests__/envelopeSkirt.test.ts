import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D } from '../buildStadiumScene';
import { generateRoofGroup } from '../generateRoof';
import { computeStadiumRingBounds } from '../roofs/ringBounds';
import { generateEnvelopeSkirt } from '../generateEnvelopeSkirt';
import { createPresetDocument } from '../presets';
import { StadiumDocument, StandSide } from '../schema';

const SIDES: StandSide[] = ['north', 'south', 'east', 'west'];

/** Skirt rail samples (bottom vertices of the screen panels) per stand side. */
function skirtSamplesPerSide(doc: StadiumDocument): Record<StandSide, number> {
  const roof = generateRoofGroup(doc);
  const skirt = generateEnvelopeSkirt(doc, roof, false, 1);
  const { innerHalfX, innerHalfZ } = computeStadiumRingBounds(doc);
  const counts: Record<StandSide, number> = { north: 0, south: 0, east: 0, west: 0 };
  for (const child of skirt.children) {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) continue;
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 2) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const side: StandSide =
        Math.abs(x) / innerHalfX >= Math.abs(z) / innerHalfZ ? (x > 0 ? 'east' : 'west') : z > 0 ? 'south' : 'north';
      counts[side]++;
    }
  }
  disposeObject3D(roof);
  disposeObject3D(skirt);
  return counts;
}

describe('envelope skirt under the roof', () => {
  it('closes every stand when one stand of a four-stand ground sits further from the pitch', () => {
    const doc = createPresetDocument('traditional_four_stands_42k');
    doc.roof.style = 'cantilever';
    doc.roof.enclosed = true;
    doc.stands.north.distanceToPitch += 6;
    doc.stands.north.rows += 15;
    const counts = skirtSamplesPerSide(doc);
    for (const side of SIDES) expect(counts[side], side).toBeGreaterThan(20);
  });

  it('closes the band at the stand backs when the roof stops short of the concourse', () => {
    const doc = createPresetDocument('circular_folded_52k');
    doc.roof.style = 'cantilever';
    doc.roof.enclosed = true;
    doc.roof.overConcourse = false;
    delete doc.roof.coveredSides;
    const counts = skirtSamplesPerSide(doc);
    for (const side of SIDES) expect(counts[side], side).toBeGreaterThan(20);
  });
});

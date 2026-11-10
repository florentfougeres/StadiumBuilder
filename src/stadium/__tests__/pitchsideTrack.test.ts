import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D } from '../buildStadiumScene';
import { generatePitchGroup } from '../generatePitch';
import { createPresetDocument } from '../presets';
import { clampPitchToTrack, getTrackGeometry } from '../schema';

/** Textures are drawn on a canvas: any 2D call is a no-op here. */
if (typeof document === 'undefined') {
  const noop = () => ({ addColorStop: () => {} });
  const context = new Proxy({}, { get: () => noop, set: () => true });
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({ width: 1024, height: 512, getContext: () => context }),
  };
}

/** Every vertex of the LED board ring, in pitch coordinates. */
function boardVertices(group: THREE.Object3D): THREE.Vector3[] {
  group.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  group.getObjectByName('LedBoards')!.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    }
  });
  return out;
}

describe('pitchside boards inside a running track', () => {
  it('keeps the boards and their props off the track and off the pitch', () => {
    const doc = createPresetDocument('olympic_masts_80k');
    expect(doc.pitch.hasTrack).toBe(true);
    const pitch = clampPitchToTrack(doc.pitch);
    const track = getTrackGeometry(pitch);
    const group = generatePitchGroup(doc.pitch, doc.colors, 1, 'day', doc.materials);

    for (const v of boardVertices(group)) {
      const along = Math.max(0, Math.abs(v.x) - track.straightHalfLength);
      // Inside the kerb, on the straights and through the bends.
      expect(track.innerRadius - Math.hypot(along, v.z)).toBeGreaterThan(0);
      // Outside the field of play.
      const dx = Math.abs(v.x) - pitch.length / 2;
      const dz = Math.abs(v.z) - pitch.width / 2;
      expect(Math.max(dx, dz)).toBeGreaterThan(0.2);
    }
    disposeObject3D(group);
  });
});

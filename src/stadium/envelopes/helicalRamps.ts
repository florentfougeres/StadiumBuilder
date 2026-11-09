import * as THREE from 'three';
import { createRailSampler, type FacadeRailSample, instancedBoxes, referenceHeight, slabMatrix } from './rail';
import { dressedSkin } from './skin';

/** Width (m) of an access ramp and its offset in front of the wall. */
const RAMP_WIDTH = 3.4;

const RAMP_OUT = 2.6;

/** Ramp gradient (rise over run). */
const RAMP_SLOPE = 0.12;

/**
 * Spiral access ramps wound around the facade: several parallel ramps climb from the ground to
 * the crest along the whole rail, each with a parapet, on slender posts at their outer edge, so
 * the facade reads as diagonal bands of ramps over the wall.
 */
function buildHelicalRamps(samples: FacadeRailSample[], closed: boolean, facadeMat: THREE.Material, frameMat: THREE.Material): THREE.Group | null {
  const rail = createRailSampler(samples, closed);
  if (!rail) return null;
  const { totalLen, sampleAtArc } = rail;
  const refH = referenceHeight(sampleAtArc, totalLen) + 0.5;
  const ramps = Math.max(2, Math.min(6, Math.round(refH / 7)));
  // Each ramp climbs at about 12 % (steep enough to read as a diagonal band), so a long ring holds
  // several climbs; a whole number of them keeps the ring seamless. On a straight stand the ramps
  // zigzag up and back down the run instead.
  const climbs = Math.max(1, Math.round(totalLen / (refH / RAMP_SLOPE)));
  const step = 2;
  const segs = Math.max(8, Math.round(totalLen / step));
  const decks: THREE.Matrix4[] = [];
  const parapets: THREE.Matrix4[] = [];
  const posts: THREE.Matrix4[] = [];
  const point = (s: number, frac: number, out: number, dy = 0) => {
    const pt = sampleAtArc(closed ? ((s % totalLen) + totalLen) % totalLen : s);
    const h = Math.max(0, pt.yTop - pt.yBottom - 1.2);
    return new THREE.Vector3(pt.x + pt.nx * out, pt.yBottom + 0.3 + frac * h + dy, pt.z + pt.nz * out);
  };
  for (let r = 0; r < ramps; r++) {
    const phase = r / ramps;
    for (let i = 0; i < segs; i++) {
      const s0 = (i / segs) * totalLen;
      const s1 = ((i + 1) / segs) * totalLen;
      let f0 = ((i / segs) * climbs + phase) % 1;
      let f1 = f0 + climbs / segs;
      if (!closed) {
        // Zigzag: up along the rail, then back down, so ramps meet the ground at both ends.
        const tri = (f: number) => 1 - Math.abs(1 - 2 * f);
        f0 = tri(f0);
        f1 = tri(f1 % 1);
      } else if (f1 > 1) continue; // landing where a ramp ends at the crest and the next starts
      const a = point(s0, f0, RAMP_OUT);
      const b = point(s1, f1, RAMP_OUT);
      decks.push(slabMatrix(a, b, RAMP_WIDTH, 0.32));
      const pa = point(s0, f0, RAMP_OUT + RAMP_WIDTH / 2 - 0.08, 0.7);
      const pb = point(s1, f1, RAMP_OUT + RAMP_WIDTH / 2 - 0.08, 0.7);
      parapets.push(slabMatrix(pa, pb, 0.16, 1.1));
    }
  }
  // Slender posts on the outer edge, running from the ground to the crest.
  const postStep = 9;
  const postCount = Math.max(4, Math.round(totalLen / postStep));
  for (let i = 0; i < postCount; i++) {
    const s = ((closed ? i : i + 0.5) / postCount) * totalLen;
    const foot = point(s, 0, RAMP_OUT + RAMP_WIDTH / 2, -0.3);
    const head = point(s, 1, RAMP_OUT + RAMP_WIDTH / 2, 0.9);
    posts.push(slabMatrix(foot, head, 0.32, 0.32));
  }
  const group = new THREE.Group();
  group.name = 'EnvelopeHelicalRamps';
  for (const mesh of [
    instancedBoxes('RampDecks', decks, facadeMat),
    instancedBoxes('RampParapets', parapets, frameMat),
    instancedBoxes('RampPosts', posts, frameMat),
  ]) {
    if (mesh) group.add(mesh);
  }
  return group.children.length > 0 ? group : null;
}

/** `helical_ramps`: access ramps wound around the facade in parallel diagonal bands. */
export const helicalRamps = dressedSkin((p) => buildHelicalRamps(p.samples, p.closed, p.facadeMat ?? p.frameMat, p.frameMat));

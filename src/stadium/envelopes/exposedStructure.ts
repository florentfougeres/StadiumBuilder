import { createRailSampler, type FacadeRailSample, instancedBoxes, railPoint, railStations, slab, slabMatrix, strutMatrix } from './rail';
import { dressingGroup, place } from './dressingKit';
import type { EnvelopeDrawer } from './types';
import * as THREE from 'three';

/** Section side (m) of a frame column of free height `h`: a twenty-second of it. */
const columnSide = (h: number) => Math.min(1, Math.max(0.4, h / 22));

type FramePoint = FacadeRailSample;
const depthOf = (pt: FramePoint) => pt.depth ?? 20;

/**
 * The raked soffit of a hollow stand (see `buildStandProfilePoints`), as (distance from the front
 * of the stand, height): front footing, knee, rear edge.
 */
const soffit = (pt: FramePoint): [number, number][] => {
  const depth = depthOf(pt);
  return [
    [2.4, 0],
    [Math.max(3.6, depth * 0.5), Math.max(1.4, pt.yTop * 0.44 - 1.4)],
    [depth, Math.max(2.2, pt.yTop - 2.35)],
  ];
};

const soffitY = (pt: FramePoint, d: number) => {
  const [a, b, c] = soffit(pt);
  const [p, q] = d <= b[0] ? [a, b] : [b, c];
  return p[1] + ((q[1] - p[1]) * (d - p[0])) / Math.max(1e-3, q[0] - p[0]);
};

/** A point `d` metres behind the front of the stand, on the frame line of `pt`. */
const at = (pt: FramePoint, d: number, y: number) => railPoint(pt, d - depthOf(pt), y);

export interface RakerFrameParts {
  rakers: THREE.Matrix4[];
  columns: THREE.Matrix4[];
  footings: THREE.Matrix4[];
}

/**
 * One frame under a hollow stand, at rail sample `pt` (on the back of the stand, carrying its
 * `depth`): the raker beam under the soffit from the front footing to the rear edge, and three
 * columns sized to their height on pad footings. Returns the depths of the middle and rear columns.
 */
export function pushRakerFrame(pt: FramePoint, parts: RakerFrameParts): { midD: number; rearD: number; drop: number } {
  const depth = depthOf(pt);
  const [front, knee, rear] = soffit(pt);
  const rakerDepth = Math.min(1.5, Math.max(0.7, (rear[0] - knee[0]) / 9));
  const drop = rakerDepth / 2 + 0.05;
  const rearD = rear[0] - 0.45;
  parts.rakers.push(
    slabMatrix(at(pt, front[0], Math.max(pt.yBottom, front[1])), at(pt, knee[0], knee[1] - drop), 0.55, rakerDepth),
    slabMatrix(at(pt, knee[0], knee[1] - drop), at(pt, rearD, rear[1] - drop), 0.55, rakerDepth)
  );
  const midD = (knee[0] + rear[0]) / 2;
  for (const [d, yTop] of [
    [knee[0], knee[1] - drop],
    [midD, soffitY(pt, midD) - drop],
    [rearD, rear[1] - drop],
  ]) {
    const h = yTop - pt.yBottom;
    if (h < 1.5) continue;
    const side = columnSide(h);
    parts.columns.push(place(pt, d - depth, pt.yBottom + h / 2, side, h, side));
    parts.footings.push(place(pt, d - depth, pt.yBottom + 0.12, side * 2.6, 0.45, side * 2.6));
  }
  // Front footing where the raker lands.
  parts.footings.push(place(pt, front[0] - depth, pt.yBottom + 0.12, 1.6, 0.45, 2.2));
  return { midD, rearD, drop };
}

/** One bay in this many is cross-braced along the facade. */
const BRACED_BAY_EVERY = 4;

/**
 * `exposed_structure`: no skin. Behind the stands the frame that carries them is on show, one
 * frame per 8.5 m bay: a raker beam under the raked soffit from the front footing to the rear edge
 * beam, three columns sized to their height on pad footings, an elevated walkway slab on its own
 * beams with stair flights up to it, and cross-bracing in one bay in four. In front of a wall,
 * deep columns with crossed bracing.
 */
export const exposedStructure: EnvelopeDrawer = {
  lobby: false,
  stand({ rail, closed, structureMat, concreteMat, loft, add }) {
    const concY = (pt: FramePoint) => Math.min(pt.yTop - 2.5, Math.max(pt.yBottom + 4.2, pt.yTop * 0.42));

    add(
      loft((pt) => {
        const mid = -depthOf(pt) * 0.28;
        const half = Math.max(3.5, depthOf(pt) * 0.36) / 2;
        return slab(mid - half, mid + half, 0.42, (p) => concY(p) - 0.42)(pt);
      }, concreteMat),
      // Rear edge beam tying the frames together under the top rows.
      loft((pt) => {
        // A stand too low to be hollow has no edge beam: the loft closes to a sliver there.
        const deep = pt.yTop > 5 ? 0.9 : 0.01;
        return slab(-0.75, -0.2, deep, () => Math.max(2.2, pt.yTop - 2.35) - deep)(pt);
      }, structureMat)
    );

    const rakers: THREE.Matrix4[] = [];
    const columns: THREE.Matrix4[] = [];
    const beams: THREE.Matrix4[] = [];
    const bracing: THREE.Matrix4[] = [];
    const footings: THREE.Matrix4[] = [];
    const stairs: THREE.Matrix4[] = [];
    const rails: THREE.Matrix4[] = [];
    const bays = railStations(rail, closed, 8.5);
    bays.forEach((pt, i) => {
      // A stand this low is a solid block: nothing to carry.
      if (pt.yTop <= 5) return;
      const { midD, rearD } = pushRakerFrame(pt, { rakers, columns, footings });
      const rearY = Math.max(2.2, pt.yTop - 2.35);
      // Cross beam carrying the walkway slab from the middle column to the rear one.
      const deck = concY(pt) - 0.42;
      if (deck > pt.yBottom + 2.5 && deck < soffitY(pt, midD)) {
        beams.push(slabMatrix(at(pt, midD, deck - 0.35), at(pt, rearD, deck - 0.35), 0.4, 0.7));
      }

      const next = bays[i + 1] ?? (closed ? bays[0] : null);
      if (!next || next.yTop <= 5) return;
      if (i % BRACED_BAY_EVERY === 1) {
        // Braced bay in the rear column line, in two panels about the walkway level.
        const out = -0.45;
        const levels = [pt.yBottom + 0.6, Math.max(pt.yBottom + 3, concY(pt)), rearY - 1.2];
        for (let k = 0; k < levels.length - 1; k++) {
          if (levels[k + 1] - levels[k] < 2.5) continue;
          bracing.push(
            strutMatrix(railPoint(pt, out, levels[k]), railPoint(next, out, levels[k + 1]), 0.16),
            strutMatrix(railPoint(next, out, levels[k]), railPoint(pt, out, levels[k + 1]), 0.16)
          );
        }
      }
      if (i % 2 === 0 && pt.yTop - pt.yBottom > 6) {
        // Stair flight up to the walkway, outside the frame line, with its balustrade.
        const a = railPoint(pt, 1.6, pt.yBottom + 0.1);
        const b = railPoint(next, 1.6, concY(next) - 0.2);
        stairs.push(slabMatrix(a, b, 2.2, 0.32));
        for (const side of [-1.05, 1.05]) {
          const lift = new THREE.Vector3(pt.nx * side, 1.05, pt.nz * side);
          rails.push(strutMatrix(a.clone().add(lift), b.clone().add(lift), 0.07));
        }
        // Landing bridging the stair head back to the walkway slab.
        stairs.push(slabMatrix(railPoint(next, -depthOf(next) * 0.1, concY(next) - 0.2), railPoint(next, 2.7, concY(next) - 0.2), 2.4, 0.3));
      }
    });
    add(
      instancedBoxes('EnvelopeRakers', rakers, structureMat),
      instancedBoxes('EnvelopeFrameColumns', columns, structureMat),
      instancedBoxes('EnvelopeWalkwayBeams', beams, structureMat),
      instancedBoxes('EnvelopeFrameBracing', bracing, structureMat),
      instancedBoxes('EnvelopeFootings', footings, concreteMat),
      instancedBoxes('EnvelopeStairFlights', stairs, concreteMat),
      instancedBoxes('EnvelopeStairRails', rails, structureMat)
    );
  },
  dressing(p) {
  const rail = createRailSampler(p.samples, p.closed);
  if (!rail) return null;
  const { totalLen, sampleAtArc } = rail;
  const closed = p.closed;
    const columns: THREE.Matrix4[] = [];
    const bracing: THREE.Matrix4[] = [];
    const count = Math.max(4, Math.round(totalLen / 9));
    const step = totalLen / count;
    for (let i = 0; i < count; i++) {
      const s = closed ? i * step : (i + 0.5) * step;
      const pt = sampleAtArc(s);
      const h = pt.yTop - pt.yBottom;
      if (h < 0.8) continue;
      columns.push(place(pt, 0.9, pt.yBottom + h / 2, 0.7, h, 1.1));
      if (!closed && i === count - 1) continue;
      const next = sampleAtArc(closed ? ((i + 1) % count) * step : s + step);
      if (next.yTop - next.yBottom < 0.8) continue;
      bracing.push(
        strutMatrix(railPoint(pt, 0.9, pt.yBottom), railPoint(next, 0.9, next.yTop), 0.32),
        strutMatrix(railPoint(pt, 0.9, pt.yTop), railPoint(next, 0.9, next.yBottom), 0.32),
        // Ring beam along the top of the bay.
        strutMatrix(railPoint(pt, 0.9, pt.yTop - 0.2), railPoint(next, 0.9, next.yTop - 0.2), 0.45)
      );
    }
    return dressingGroup(
      [
        ['EnvelopePrimary', columns],
        ['EnvelopeSecondary', bracing],
      ],
      p.frameMat
    );
  },
};

import * as THREE from 'three';
import { createRailSampler, type FacadeRailSample, instancedBoxes, slabMatrix } from './rail';
import { dressedSkin } from './skin';

/** Width (m) of a stair flight and its offset in front of the wall. */
const STAIR_WIDTH = 2.2;
const STAIR_OUT = 1.6;
/** Height (m) climbed by one flight, between two landings. */
const STOREY = 4.2;
/** Horizontal run of a flight (m): steep, as on 1930s steel stands. */
const FLIGHT_RUN = 7;
/** Length (m) of one structural bay along the facade; stairs fill every other bay. */
const BAY = 2 * FLIGHT_RUN + 4;

/**
 * Exposed steel frame hung outside the facade with zigzag stair flights: in every other bay
 * flights climb back and forth between landings at each storey, the frame's columns and storey
 * beams running along the whole facade, as on an interwar steel stadium.
 */
function buildExternalStairs(samples: FacadeRailSample[], closed: boolean, facadeMat: THREE.Material, frameMat: THREE.Material): THREE.Group | null {
  const rail = createRailSampler(samples, closed);
  if (!rail) return null;
  const { totalLen, sampleAtArc } = rail;
  const bays = Math.max(1, Math.round(totalLen / BAY));
  const bayLen = totalLen / bays;
  const point = (s: number, out: number, y: number) => {
    const pt = sampleAtArc(closed ? ((s % totalLen) + totalLen) % totalLen : Math.max(0, Math.min(totalLen, s)));
    return new THREE.Vector3(pt.x + pt.nx * out, y, pt.z + pt.nz * out);
  };
  const height = (s: number) => {
    const pt = sampleAtArc(closed ? ((s % totalLen) + totalLen) % totalLen : Math.max(0, Math.min(totalLen, s)));
    return { bottom: pt.yBottom, top: pt.yTop };
  };
  const flights: THREE.Matrix4[] = [];
  const landings: THREE.Matrix4[] = [];
  const frame: THREE.Matrix4[] = [];
  const edge = STAIR_OUT + STAIR_WIDTH / 2;

  for (let b = 0; b < bays; b++) {
    const s0 = b * bayLen;
    // Columns at each bay line, on both faces of the stair zone.
    const { bottom, top } = height(s0);
    if (closed || b > 0) {
      for (const out of [STAIR_OUT - STAIR_WIDTH / 2, edge]) {
        frame.push(slabMatrix(point(s0, out, bottom - 0.2), point(s0, out, top + 0.3), 0.36, 0.36));
      }
    }
    if (b % 2 === 1 || top - bottom < STOREY) continue;
    const mid = s0 + bayLen / 2;
    const storeys = Math.floor((top - bottom - 0.6) / STOREY);
    for (let k = 0; k < storeys; k++) {
      const y0 = bottom + k * STOREY;
      const y1 = y0 + STOREY;
      const dir = k % 2 === 0 ? 1 : -1;
      const a = point(mid - (dir * FLIGHT_RUN) / 2, STAIR_OUT, y0 + 0.2);
      const c = point(mid + (dir * FLIGHT_RUN) / 2, STAIR_OUT, y1 + 0.2);
      flights.push(slabMatrix(a, c, STAIR_WIDTH, 0.28));
      // Outer handrail of the flight.
      flights.push(slabMatrix(point(mid - (dir * FLIGHT_RUN) / 2, edge - 0.06, y0 + 1.1), point(mid + (dir * FLIGHT_RUN) / 2, edge - 0.06, y1 + 1.1), 0.08, 0.08));
      // Landing at the top of the flight, cantilevered past its end.
      const end = mid + (dir * FLIGHT_RUN) / 2;
      landings.push(slabMatrix(point(end - dir * 0.2, STAIR_OUT, y1 + 0.2), point(end + dir * 2.2, STAIR_OUT, y1 + 0.2), STAIR_WIDTH, 0.3));
    }
  }
  // Storey beams along the whole facade, tying the columns.
  const segs = Math.max(4, Math.round(totalLen / 3));
  for (let i = 0; i < segs; i++) {
    const sa = (i / segs) * totalLen;
    const sb = ((i + 1) / segs) * totalLen;
    const ha = height(sa);
    const hb = height(sb);
    for (let y = STOREY; ; y += STOREY) {
      if (ha.bottom + y > ha.top - 0.3 || hb.bottom + y > hb.top - 0.3) break;
      frame.push(slabMatrix(point(sa, edge, ha.bottom + y), point(sb, edge, hb.bottom + y), 0.22, 0.5));
    }
    frame.push(slabMatrix(point(sa, edge, ha.top), point(sb, edge, hb.top), 0.3, 0.7));
  }

  const group = new THREE.Group();
  group.name = 'EnvelopeExternalStairs';
  for (const mesh of [
    instancedBoxes('StairFlights', flights, frameMat),
    instancedBoxes('StairLandings', landings, facadeMat),
    instancedBoxes('StairFrame', frame, frameMat),
  ]) {
    if (mesh) {
      mesh.castShadow = true;
      group.add(mesh);
    }
  }
  return group.children.length > 0 ? group : null;
}

/** `external_stairs`: an exposed steel frame with zigzag stairs climbing outside the facade. */
export const externalStairs = dressedSkin((p) => buildExternalStairs(p.samples, p.closed, p.facadeMat ?? p.frameMat, p.frameMat));

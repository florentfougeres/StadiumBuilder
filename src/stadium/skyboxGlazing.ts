import * as THREE from 'three';
import { VIP_STOREY_M } from './sightlines';

/**
 * Glazed front of a row of hospitality boxes (loges) at a tier break.
 *
 * The boxes have no modelled rooms: the loggia is a shallow recess in the stand profile. The glass
 * instead shows them by interior mapping: each pixel casts the view ray into a virtual room behind
 * the pane (box width x storey height x depth) and shades the wall, floor, ceiling, table, guests
 * or blinds it hits, so every box reads as a lit room with real perspective from any viewpoint.
 * The pane itself is dark low-roughness glass whose sky and floodlight reflections come from the
 * scene environment, and the interior fades with the Fresnel term at grazing angles. Mullions,
 * box partitions, storey slab edges, sills and handrails are real geometry in front of the pane.
 *
 * The room frame is rebuilt per pixel from screen-space derivatives of the view position and of
 * the `sbRoom` coordinates, so it survives any transform, including the static mesh merge.
 */

/** Width of one box between partitions (m). */
export const SKYBOX_WIDTH_M = 5;
/** Depth of the virtual room behind the pane (m). */
const ROOM_DEPTH_M = 4.6;
/** Spacing of the glazing mullions inside a box (m). */
const MULLION_PITCH_M = SKYBOX_WIDTH_M / 4;
/** Height of the slab edge between two storeys of boxes (m). */
const SLAB_EDGE_M = 0.42;

/** Storeys of boxes a pane of this height holds (the tier-break loggia grows one storey at a time). */
export function skyboxStoreysForHeight(height: number): number {
  return Math.max(1, Math.round((height + 0.15 - 1.95) / VIP_STOREY_M) + 1);
}

/** One run of boxes along the glass line, sampled in order along the stand. */
export interface SkyboxRun {
  /** Glass line at each sample (only `x`, `z` are read). */
  line: THREE.Vector3[];
  /** Bottom and top of the pane at each sample. */
  bottomY: number[];
  topY: number[];
  /** Horizontal unit direction into the boxes (away from the pitch) at each sample. */
  inward: THREE.Vector3[];
  /** The run loops back to its first sample (a full bowl ring). */
  closed?: boolean;
}

const INTERIOR_GLSL = /* glsl */ `
varying vec2 vSbRoom;
uniform vec3 sbRoomSize;
uniform float sbGlow;
uniform float sbNight;

float sbHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Guest silhouette on a plane facing the glass: a body narrowing at the shoulders, and a head.
float sbPerson(vec2 q, float cx, float h) {
  float body = step(abs(q.x - cx), 0.22 - 0.07 * smoothstep(h * 0.76, h * 0.84, q.y)) * step(q.y, h * 0.86);
  float head = step(length(vec2(q.x - cx, (q.y - h * 0.93) * 0.85)), 0.105);
  return max(body, head);
}

vec3 sbInterior(vec3 pos, vec3 V, vec3 Nc, out float fres) {
  vec3 dp1 = dFdx(pos);
  vec3 dp2 = dFdy(pos);
  vec2 duv1 = dFdx(vSbRoom);
  vec2 duv2 = dFdy(vSbRoom);
  vec3 Ng = cross(dp1, dp2);
  vec3 dp2perp = cross(dp2, Ng);
  vec3 dp1perp = cross(Ng, dp1);
  vec3 T = normalize(dp2perp * duv1.x + dp1perp * duv2.x);
  vec3 B = normalize(dp2perp * duv1.y + dp1perp * duv2.y);

  float cosV = clamp(dot(-V, Nc), 0.0, 1.0);
  fres = 0.04 + 0.96 * pow(1.0 - cosV, 5.0);

  float W = sbRoomSize.x;
  float H = sbRoomSize.y;
  float D = sbRoomSize.z;
  vec3 d = vec3(dot(V, T), dot(V, B), max(0.02, dot(V, -Nc)));
  vec2 cell = floor(vSbRoom / vec2(W, H));
  vec3 o = vec3(vSbRoom.x - cell.x * W, vSbRoom.y - cell.y * H, 0.0);
  float rnd = sbHash(cell);
  float rnd2 = sbHash(cell + 17.3);

  // Most boxes lit, a few dim (empty).
  float lit = rnd2 < 0.18 ? 0.3 : 0.85 + 0.3 * rnd;

  // Blinds lowered over part of some panes, on the glass plane itself.
  float blind = rnd < 0.2 ? 0.5 : (rnd < 0.36 ? 0.22 : 0.0);
  if (blind > 0.0 && o.y > H * (1.0 - blind)) {
    float slat = 0.8 + 0.2 * step(0.5, fract(o.y / 0.09));
    return vec3(0.5, 0.48, 0.44) * slat * (0.5 + 0.5 * lit);
  }

  float tx = d.x > 0.0 ? (W - o.x) / d.x : o.x / max(-d.x, 1e-4);
  float ty = d.y > 0.0 ? (H - o.y) / d.y : o.y / max(-d.y, 1e-4);
  float tz = D / d.z;
  float t = min(min(tx, ty), tz);
  vec3 h = o + d * t;
  vec3 col;
  if (t == tz) {
    // Back wall: plaster over a dark wood bar, and a TV showing the match.
    col = mix(vec3(0.62, 0.55, 0.46), vec3(0.44, 0.48, 0.54), step(0.5, rnd2));
    if (h.y < 1.05) col = vec3(0.2, 0.12, 0.07) * (0.8 + 0.2 * step(0.04, fract(h.x / 0.7)));
    else if (h.y < 1.1) col = vec3(0.8, 0.78, 0.74);
    vec2 tv = abs(vec2(h.x - W * 0.5, h.y - 1.85));
    if (tv.x < 0.62 && tv.y < 0.36) {
      col = (tv.x < 0.58 && tv.y < 0.32) ? vec3(0.07, 0.24, 0.1) * (1.0 + 2.0 * sbNight) : vec3(0.02);
    }
    col *= 0.62;
  } else if (t == ty) {
    if (d.y > 0.0) {
      // Ceiling with a grid of downlights.
      vec2 g = abs(fract(h.xz / vec2(1.25, 1.15)) - 0.5);
      col = vec3(0.78, 0.77, 0.74) * 0.85;
      if (max(g.x, g.y) < 0.09) col = vec3(1.0, 0.92, 0.78) * (2.2 + 2.5 * sbNight) * lit;
    } else {
      // Carpet, darker toward the back.
      col = mix(vec3(0.1, 0.1, 0.12), vec3(0.17, 0.08, 0.08), step(0.6, rnd)) * (1.0 - 0.3 * h.z / D);
    }
  } else {
    // Partitions: oak panelling with grooves.
    col = vec3(0.46, 0.33, 0.22) * (0.75 + 0.25 * step(0.03, fract(h.z / 0.6))) * 0.85;
  }

  // A table along the front of the box, then guests standing behind it.
  if (d.y < 0.0 && o.y > 0.76) {
    float tt = (o.y - 0.76) / -d.y;
    vec3 hp = o + d * tt;
    if (tt < t && hp.z > 1.0 && hp.z < 1.7 && hp.x > 0.5 && hp.x < W - 0.5) {
      col = vec3(0.85, 0.84, 0.8) * 0.75;
      t = tt;
    }
  }
  if (rnd2 > 0.18) {
    float tp = 2.6 / d.z;
    vec3 hp = o + d * tp;
    if (tp < t && hp.y > 0.0) {
      float m = 0.0;
      for (int i = 0; i < 3; i++) {
        if (float(i) > rnd * 3.0) break;
        float cx = 0.8 + (W - 1.6) * fract(rnd * (7.13 + float(i) * 3.71));
        m = max(m, sbPerson(hp.xy, cx, 1.66 + 0.14 * fract(rnd2 * (5.0 + float(i)))));
      }
      if (m > 0.0) {
        col = mix(vec3(0.08, 0.08, 0.1), vec3(0.3, 0.12, 0.1), step(0.55, fract(rnd * 9.7))) * 0.8;
        t = tp;
      }
    }
  }

  // Light falls off from the window wall to the back; the ceiling fittings warm the top.
  float shade = (0.55 + 0.45 * (1.0 - clamp(t * d.z / D, 0.0, 1.0))) * (0.75 + 0.35 * smoothstep(0.0, H, h.y));
  return col * shade * lit;
}
`;

/** Glass of one run: dark, glossy, reflecting the environment, showing the boxes behind. */
function createSkyboxGlassMaterial(isNight: boolean, storeyH: number): THREE.MeshPhysicalMaterial {
  // A clear coat over the base layer stands for the two faces of the double glazing.
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x04080b,
    roughness: 0.03,
    metalness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.6,
  });
  material.name = 'SkyboxGlass';
  const uniforms = {
    sbRoomSize: { value: new THREE.Vector3(SKYBOX_WIDTH_M, storeyH, ROOM_DEPTH_M) },
    sbGlow: { value: isNight ? 1.2 : 0.48 },
    sbNight: { value: isNight ? 1 : 0 },
  };
  material.customProgramCacheKey = () => 'skybox-interior-v1';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 sbRoom;\nvarying vec2 vSbRoom;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSbRoom = sbRoom;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${INTERIOR_GLSL}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec3 sbPos = -vViewPosition;
  vec3 sbV = normalize(sbPos);
  vec3 sbNc = normalize(cross(dFdx(sbPos), dFdy(sbPos)));
  if (dot(sbNc, sbV) > 0.0) sbNc = -sbNc;
  float sbFres;
  vec3 sbCol = sbInterior(sbPos, sbV, sbNc, sbFres);
  totalEmissiveRadiance += sbCol * vec3(0.72, 0.84, 0.86) * sbGlow * (1.0 - sbFres);
}`
      );
  };
  return material;
}

/**
 * Glazing, mullions, partitions and slab edges of one run of boxes. Partitions and the room cells
 * of the interior both repeat every `SKYBOX_WIDTH_M` of arc length, so they line up.
 */
export function buildSkyboxGlazing(run: SkyboxRun, isNight: boolean): THREE.Group | null {
  const n = run.line.length;
  if (n < 2) return null;
  const closed = run.closed === true && n >= 3;
  const segCount = closed ? n : n - 1;
  const next = (i: number) => (i + 1) % n;

  // Arc length at each sample along the glass line.
  const arc = new Float32Array(segCount + 1);
  for (let k = 0; k < segCount; k++) {
    const a = run.line[k];
    const b = run.line[next(k)];
    arc[k + 1] = arc[k] + Math.hypot(b.x - a.x, b.z - a.z);
  }
  const total = arc[segCount];
  if (total < 1) return null;

  let heightSum = 0;
  for (let i = 0; i < n; i++) heightSum += run.topY[i] - run.bottomY[i];
  const meanH = heightSum / n;
  if (meanH < 0.6) return null;
  const storeys = skyboxStoreysForHeight(meanH);
  const storeyH = meanH / storeys;

  // Pane: one strip; `sbRoom` = (arc length, height scaled so each storey is `storeyH`).
  const vCount = (segCount + 1) * 2;
  const pos = new Float32Array(vCount * 3);
  const room = new Float32Array(vCount * 2);
  const nor = new Float32Array(vCount * 3);
  for (let k = 0; k <= segCount; k++) {
    const i = k % n;
    const p = run.line[i];
    const inw = run.inward[i];
    pos.set([p.x, run.bottomY[i], p.z, p.x, run.topY[i], p.z], k * 6);
    nor.set([-inw.x, 0, -inw.z, -inw.x, 0, -inw.z], k * 6);
    room.set([arc[k], 0, arc[k], storeys * storeyH], k * 4);
  }
  const idx: number[] = [];
  for (let k = 0; k < segCount; k++) {
    const a = k * 2;
    const c = (k + 1) * 2;
    const p0 = run.line[k % n];
    const p1 = run.line[next(k)];
    const inw = run.inward[k % n];
    // Triangle (a, c, a+1) faces along (along x up); keep the front toward the pitch.
    const ax = p1.x - p0.x;
    const az = p1.z - p0.z;
    if (ax * inw.z - az * inw.x < 0) idx.push(a, c, a + 1, c, c + 1, a + 1);
    else idx.push(a, a + 1, c, c, a + 1, c + 1);
  }
  const paneGeo = new THREE.BufferGeometry();
  paneGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  paneGeo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  paneGeo.setAttribute('sbRoom', new THREE.BufferAttribute(room, 2));
  paneGeo.setIndex(idx);

  const group = new THREE.Group();
  group.name = 'SkyboxGlazing';
  const pane = new THREE.Mesh(paneGeo, createSkyboxGlassMaterial(isNight, storeyH));
  pane.receiveShadow = true;
  group.add(pane);

  // Frame pieces as instanced unit boxes: x along the glass line, y up, z across it.
  const frames: THREE.Matrix4[] = [];
  const fins: THREE.Matrix4[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const basis = new THREE.Matrix4();
  const place = (list: THREE.Matrix4[], centre: THREE.Vector3, along: THREE.Vector3, size: [number, number, number]) => {
    const x = along.clone().normalize();
    const z = new THREE.Vector3().crossVectors(x, up).normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    basis.makeBasis(x, y, z);
    const q = new THREE.Quaternion().setFromRotationMatrix(basis);
    list.push(new THREE.Matrix4().compose(centre, q, new THREE.Vector3(...size)));
  };

  // The run at arc length `s`: glass line point, pane bottom and top, inward and tangent.
  const sampleAt = (s: number) => {
    let k = 0;
    while (k < segCount - 1 && arc[k + 1] < s) k++;
    const f = Math.max(0, Math.min(1, (s - arc[k]) / Math.max(1e-6, arc[k + 1] - arc[k])));
    const i = k % n;
    const j = next(k);
    const a = run.line[i];
    const b = run.line[j];
    return {
      p: new THREE.Vector3(a.x + (b.x - a.x) * f, 0, a.z + (b.z - a.z) * f),
      bot: run.bottomY[i] + (run.bottomY[j] - run.bottomY[i]) * f,
      top: run.topY[i] + (run.topY[j] - run.topY[i]) * f,
      inward: run.inward[i].clone().lerp(run.inward[j], f).setY(0).normalize(),
      tangent: new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize(),
    };
  };

  // Vertical mullions, and a white partition fin at every box boundary (every fourth one).
  const mullionCount = Math.floor(total / MULLION_PITCH_M + 1e-6);
  for (let m = closed ? 0 : 1; m < (closed ? mullionCount : mullionCount + (total % MULLION_PITCH_M > 0.3 ? 1 : 0)); m++) {
    const sm = sampleAt(m * MULLION_PITCH_M);
    const h = sm.top - sm.bot;
    const isPartition = m % 4 === 0;
    const out = isPartition ? 0.14 : 0.05;
    const c = sm.p.clone().addScaledVector(sm.inward, -out).setY((sm.bot + sm.top) / 2);
    place(isPartition ? fins : frames, c, sm.tangent, isPartition ? [0.2, h, 0.32] : [0.055, h, 0.12]);
  }

  // Along each segment: sill, head, a slab edge at each storey break and a handrail transom
  // across the lower pane of each storey.
  for (let k = 0; k < segCount; k++) {
    const i = k % n;
    const j = next(k);
    if (arc[k + 1] - arc[k] < 1e-3) continue;
    const a = run.line[i];
    const b = run.line[j];
    const inw = run.inward[i].clone().add(run.inward[j]).setY(0).normalize();
    const at = (fracH: number, offM: number, out: number) => {
      const ya = run.bottomY[i] + (run.topY[i] - run.bottomY[i]) * fracH + offM;
      const yb = run.bottomY[j] + (run.topY[j] - run.bottomY[j]) * fracH + offM;
      const along = new THREE.Vector3(b.x - a.x, yb - ya, b.z - a.z);
      const c = new THREE.Vector3((a.x + b.x) / 2, (ya + yb) / 2, (a.z + b.z) / 2).addScaledVector(inw, -out);
      return { c, along, len: along.length() + 0.02 };
    };
    const sill = at(0, 0.06, 0.06);
    place(frames, sill.c, sill.along, [sill.len, 0.12, 0.2]);
    const head = at(1, -0.06, 0.06);
    place(frames, head.c, head.along, [head.len, 0.12, 0.2]);
    for (let st = 0; st < storeys; st++) {
      const rail = at(st / storeys, 1.08, 0.12);
      place(frames, rail.c, rail.along, [rail.len, 0.05, 0.05]);
      if (st > 0) {
        const slab = at(st / storeys, 0, 0.22);
        place(fins, slab.c, slab.along, [slab.len, SLAB_EDGE_M, 0.5]);
      }
    }
  }

  const unit = new THREE.BoxGeometry(1, 1, 1);
  const addInstances = (list: THREE.Matrix4[], material: THREE.Material, name: string) => {
    if (list.length === 0) return;
    const mesh = new THREE.InstancedMesh(unit.clone(), material, list.length);
    mesh.name = name;
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  addInstances(frames, new THREE.MeshStandardMaterial({ color: 0x2a2f35, roughness: 0.38, metalness: 0.75 }), 'SkyboxMullions');
  addInstances(fins, new THREE.MeshStandardMaterial({ color: 0xe8eaec, roughness: 0.5, metalness: 0.08 }), 'SkyboxPartitions');
  unit.dispose();
  return group;
}

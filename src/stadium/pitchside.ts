import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createLedSponsorRibbonTexture } from './materials';
import type { AdBoardTheme, LightingMode } from './schema';

/**
 * Pitch-side furniture around a football pitch: the goals with their hanging nets, the LED
 * advertising boards, the sponsor carpets beside the goals and the TV cameras behind them.
 * The pitch frame is `x` along the pitch, `z` across it, `y` up, the centre spot at the origin.
 */

// ---------------------------------------------------------------- Goals

const GOAL_W = 7.32;
const GOAL_H = 2.44;
const POST_R = 0.06;
/** Box goal: net depth at the ground frame (m) and height of the back top corners (m). */
const GOAL_D = 2.0;
const BACK_H = 2.3;
/** Net cell size (m): square mesh, 14 cm. */
const NET_CELL = 0.14;
/** The net attaches just behind the posts and crossbar. */
const NET_X0 = 0.07;
const NET_TOP = GOAL_H - 0.03;

/** Slack of the hung net (m): the roof bellies, the back stays a near-flat upright rectangle. */
const SAG_BACK_EDGE = 0.07;
const SAG_ROOF_SIDE = 0.04;
const SAG_ROOF_MID = 0.16;
const PINCH_BACK = 0.008;
const BELLY_SIDE = 0.03;

let netCanvas: HTMLCanvasElement | null = null;
/** One square cell of knotted net, white cord on transparent: tiles in both directions. */
function createNetAlphaTexture(): THREE.Texture {
  if (!netCanvas) {
    netCanvas = document.createElement('canvas');
    netCanvas.width = 64;
    netCanvas.height = 64;
    const ctx = netCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = '#ffffff';
    // Cords on the tile edges, half on each side, so neighbouring tiles join up.
    const half = 2.6;
    ctx.fillRect(0, 0, 64, half);
    ctx.fillRect(0, 64 - half, 64, half);
    ctx.fillRect(0, 0, half, 64);
    ctx.fillRect(64 - half, 0, half, 64);
    // Knots at the corners.
    for (const [x, y] of [[0, 0], [64, 0], [0, 64], [64, 64]]) {
      ctx.beginPath();
      ctx.arc(x, y, 4.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(netCanvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Roof: from the crossbar back to the back top corners, slack in the middle and along its free edges. */
function roofPoint(u: number, v: number): THREE.Vector3 {
  const su = Math.sin(Math.PI * u);
  const sv = Math.sin(Math.PI * v);
  const y = NET_TOP + (BACK_H - NET_TOP) * v - SAG_BACK_EDGE * su * v - SAG_ROOF_SIDE * sv - SAG_ROOF_MID * su * sv;
  return new THREE.Vector3(NET_X0 + (GOAL_D - NET_X0) * v, y, (u - 0.5) * GOAL_W);
}

/** Back: from the roof's back edge down to the ground bar, its free sides pulled in toward the middle. */
function backPoint(u: number, v: number): THREE.Vector3 {
  const top = roofPoint(u, 1).y;
  const sv = Math.sin(Math.PI * v);
  return new THREE.Vector3(
    GOAL_D - 0.02 * Math.sin(Math.PI * u) * sv,
    top * (1 - v),
    (u - 0.5) * GOAL_W * (1 - PINCH_BACK * 2 * sv)
  );
}

/** Side: between the post, the roof's side edge, the back's side edge and the ground. */
function sidePoint(sz: -1 | 1, u: number, v: number): THREE.Vector3 {
  const edge = sz < 0 ? 0 : 1;
  const top = roofPoint(edge, u).y;
  const back = backPoint(edge, v);
  return new THREE.Vector3(
    NET_X0 + (GOAL_D - NET_X0) * u,
    top * (1 - v),
    (back.z - sz * (GOAL_W / 2)) * u + sz * (GOAL_W / 2) - sz * BELLY_SIDE * Math.sin(Math.PI * u) * Math.sin(Math.PI * v)
  );
}

/** A net sheet sampled from `at(u, v)`, its UVs in mesh cells over `lenU` x `lenV` metres. */
function netSheet(at: (u: number, v: number) => THREE.Vector3, lenU: number, lenV: number, cols: number, rows: number) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const p = at(i / cols, j / rows);
      pos.push(p.x, p.y, p.z);
      uv.push(((i / cols) * lenU) / NET_CELL, ((j / rows) * lenV) / NET_CELL);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + cols + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Tube through a list of points (a frame bar or the net's edge rope). */
function tube(points: THREE.Vector3[], r: number, segs = 24): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'centripetal'), segs, r, 8, false);
}

/** Points along a sheet edge. */
function edge(at: (t: number) => THREE.Vector3, n = 24): THREE.Vector3[] {
  return Array.from({ length: n + 1 }, (_, i) => at(i / n));
}

/**
 * A full-size box goal: round white posts and crossbar, a dark green ground frame with thin rear
 * uprights holding the back corners, and a square-mesh net hung slack over them: the roof sags,
 * the back's free sides pull in toward the middle, the sides belly inward. Built with the net
 * toward `+x`; `sideSign = -1` turns it round for the other end.
 */
export function buildFootballGoal(sideSign: -1 | 1): THREE.Group {
  const goal = new THREE.Group();
  goal.name = 'Goal';
  if (sideSign < 0) goal.rotation.y = Math.PI;

  const postMat = new THREE.MeshPhysicalMaterial({
    color: 0xf7f7f5,
    roughness: 0.35,
    metalness: 0.05,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1d4a35, roughness: 0.45, metalness: 0.5 });
  const netColor = 0xf5f5f4;

  // Posts and crossbar, rounded caps over the top corners.
  const postGeo = new THREE.CylinderGeometry(POST_R, POST_R, GOAL_H, 28);
  postGeo.translate(0, GOAL_H / 2, 0);
  const barGeo = new THREE.CylinderGeometry(POST_R, POST_R, GOAL_W, 28);
  barGeo.rotateX(Math.PI / 2);
  barGeo.translate(0, GOAL_H, 0);
  const jointGeo = new THREE.SphereGeometry(POST_R, 20, 14);
  const whites: THREE.BufferGeometry[] = [barGeo];
  for (const sz of [-1, 1]) {
    whites.push(postGeo.clone().translate(0, 0, (sz * GOAL_W) / 2));
    whites.push(jointGeo.clone().translate(0, GOAL_H, (sz * GOAL_W) / 2));
  }
  const frame = new THREE.Mesh(mergeGeometries(whites)!, postMat);
  frame.castShadow = true;
  goal.add(frame);
  [postGeo, jointGeo, ...whites].forEach((g) => g.dispose());

  // Ground frame (sides and back) and the thin rear uprights at the back corners.
  const steel: THREE.BufferGeometry[] = [];
  for (const sz of [-1, 1]) {
    const z = (sz * GOAL_W) / 2;
    steel.push(new THREE.BoxGeometry(GOAL_D, 0.04, 0.04).translate(GOAL_D / 2, 0.02, z));
    steel.push(new THREE.CylinderGeometry(0.025, 0.025, BACK_H, 10).translate(GOAL_D + 0.03, BACK_H / 2, z));
  }
  steel.push(new THREE.BoxGeometry(0.04, 0.04, GOAL_W + 0.04).translate(GOAL_D, 0.02, 0));
  const ground = new THREE.Mesh(mergeGeometries(steel.map((g) => g.toNonIndexed()))!, frameMat);
  steel.forEach((g) => g.dispose());
  ground.castShadow = true;
  goal.add(ground);

  // Square-mesh net: crisp cords through alpha-to-coverage, casting their shadow on the turf.
  const netMat = new THREE.MeshStandardMaterial({
    color: netColor,
    roughness: 0.9,
    alphaMap: createNetAlphaTexture(),
    alphaTest: 0.45,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
  });
  const sheets = [
    netSheet(roofPoint, GOAL_W, GOAL_D, 48, 16),
    netSheet(backPoint, GOAL_W, BACK_H, 48, 16),
    netSheet((u, v) => sidePoint(-1, u, v), GOAL_D, GOAL_H, 14, 16),
    netSheet((u, v) => sidePoint(1, u, v), GOAL_D, GOAL_H, 14, 16),
  ];
  const net = new THREE.Mesh(mergeGeometries(sheets)!, netMat);
  sheets.forEach((g) => g.dispose());
  net.name = 'GoalNet';
  net.castShadow = true;
  goal.add(net);

  // Edge ropes along the net's free edges: the roof's back edge and side edges, the back's sides.
  const ropes = [
    tube(edge((t) => roofPoint(t, 1), 40), 0.011, 40),
    ...([0, 1] as const).flatMap((e) => [
      tube(edge((t) => roofPoint(e, t)), 0.011),
      tube(edge((t) => backPoint(e, t)), 0.011),
    ]),
  ];
  const rope = new THREE.Mesh(mergeGeometries(ropes)!, new THREE.MeshStandardMaterial({ color: netColor, roughness: 0.85 }));
  ropes.forEach((g) => g.dispose());
  rope.castShadow = true;
  goal.add(rope);
  return goal;
}

// ---------------------------------------------------------------- LED boards

/** LED face height (m), its tilt back from vertical, foot clearance, cabinet depth, module size. */
const BOARD_H = 0.9;
const BOARD_TILT = THREE.MathUtils.degToRad(11);
const BOARD_FOOT = 0.08;
const BOARD_DEPTH = 0.12;
const MODULE_LEN = 1.0;
const MODULE_GAP = 0.012;

/** A board module: the chord `a`→`b` of the ring, at distance `s` along it. */
interface BoardModule {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  s: number;
}

/**
 * Modules of a rounded-rectangle ring of boards (half extents `hx`, `hz`, corner radius `r`) cut
 * into ~1 m chords, minus those `skip` rejects (the gap left for the dugouts).
 */
function ringModules(hx: number, hz: number, r: number, skip: (x: number, z: number) => boolean): BoardModule[] {
  r = Math.max(0.5, Math.min(r, hx - 0.5, hz - 0.5));
  const pts: { x: number; z: number }[] = [];
  const straight = (x0: number, z0: number, x1: number, z1: number) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / MODULE_LEN));
    for (let i = 0; i < n; i++) pts.push({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n });
  };
  const arc = (cx: number, cz: number, a0: number) => {
    const n = Math.max(2, Math.round((r * Math.PI) / 2 / MODULE_LEN));
    for (let i = 0; i < n; i++) {
      const a = a0 - ((Math.PI / 2) * i) / n;
      pts.push({ x: cx + r * Math.cos(a), z: cz + r * Math.sin(a) });
    }
  };
  straight(-(hx - r), hz, hx - r, hz);
  arc(hx - r, hz - r, Math.PI / 2);
  straight(hx, hz - r, hx, -(hz - r));
  arc(hx - r, -(hz - r), 0);
  straight(hx - r, -hz, -(hx - r), -hz);
  arc(-(hx - r), -(hz - r), -Math.PI / 2);
  straight(-hx, -(hz - r), -hx, hz - r);
  arc(-(hx - r), hz - r, Math.PI);

  const out: BoardModule[] = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (!skip((a.x + b.x) / 2, (a.z + b.z) / 2)) out.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, s });
    s += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return out;
}

type V3 = [number, number, number];

/** Appends quad a-b-c-d (counter-clockwise seen from its front) as two triangles. */
function pushQuad(pos: number[], uv: number[], q: V3[], uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
  const [a, b, c, d] = q;
  pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const [ua, ub, uc, ud] = uvs;
  uv.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud);
}

function flatGeometry(pos: number[], uv: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

/**
 * LED advertising boards: 1 m cabinets with a hairline gap, the face leaning back 11°, a rubber
 * cushion on top and a rear prop leg each; the sponsor ribbon runs on along the ring at its true
 * aspect (one repeat every 16 board heights).
 */
function buildBoardRing(modules: BoardModule[], ledMat: THREE.Material, bodyMat: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  group.name = 'LedBoards';
  const facePos: number[] = [];
  const faceUv: number[] = [];
  const bodyPos: number[] = [];
  const bodyUv: number[] = [];
  const legs: THREE.BufferGeometry[] = [];
  const period = BOARD_H * 16;
  const lean = BOARD_H * Math.sin(BOARD_TILT);
  const top = BOARD_FOOT + BOARD_H * Math.cos(BOARD_TILT);
  const cushion = top + 0.045;
  const legGeo = new THREE.BoxGeometry(0.05, 1, 0.05);
  const yAxis = new THREE.Vector3(0, 1, 0);

  for (const m of modules) {
    let tx = m.bx - m.ax;
    let tz = m.bz - m.az;
    const len = Math.hypot(tx, tz);
    if (len < 0.05) continue;
    tx /= len;
    tz /= len;
    // Normal toward the pitch: the ring is convex around the origin.
    let nx = -tz;
    let nz = tx;
    if (nx * (m.ax + m.bx) + nz * (m.az + m.bz) > 0) {
      nx = -nx;
      nz = -nz;
    }
    const g = Math.min(MODULE_GAP, len * 0.1);
    const ends: [number, number, number][] = [
      [m.ax + tx * g, m.az + tz * g, (m.s + g) / period],
      [m.bx - tx * g, m.bz - tz * g, (m.s + len - g) / period],
    ];
    // Left end as seen from the pitch first, so the face winds counter-clockwise toward `n`; when
    // the ring runs right to left, `u` is negated so the ribbon still reads left to right.
    if (-tz * nx + tx * nz < 0) {
      ends.reverse();
      for (const e of ends) e[2] = -e[2];
    }
    const [[lx, lz, uL], [rx, rz, uR]] = ends;
    const back = (x: number, z: number, d: number): [number, number] => [x - nx * d, z - nz * d];
    const [lxT, lzT] = back(lx, lz, lean);
    const [rxT, rzT] = back(rx, rz, lean);
    const [lxB, lzB] = back(lx, lz, BOARD_DEPTH);
    const [rxB, rzB] = back(rx, rz, BOARD_DEPTH);
    const [lxBT, lzBT] = back(lx, lz, lean + BOARD_DEPTH);
    const [rxBT, rzBT] = back(rx, rz, lean + BOARD_DEPTH);

    pushQuad(facePos, faceUv, [[lx, BOARD_FOOT, lz], [rx, BOARD_FOOT, rz], [rxT, top, rzT], [lxT, top, lzT]], [
      [uL, 0],
      [uR, 0],
      [uR, 1],
      [uL, 1],
    ]);
    // Cabinet: back panel, cushion (front, top, back), skirt and end caps.
    const quads: V3[][] = [
      [[rxB, BOARD_FOOT, rzB], [lxB, BOARD_FOOT, lzB], [lxBT, top, lzBT], [rxBT, top, rzBT]],
      [[lxT, top, lzT], [rxT, top, rzT], [rxT, cushion, rzT], [lxT, cushion, lzT]],
      [[lxT, cushion, lzT], [rxT, cushion, rzT], [rxBT, cushion, rzBT], [lxBT, cushion, lzBT]],
      [[rxBT, top, rzBT], [lxBT, top, lzBT], [lxBT, cushion, lzBT], [rxBT, cushion, rzBT]],
      [[lx, 0, lz], [rx, 0, rz], [rx, BOARD_FOOT, rz], [lx, BOARD_FOOT, lz]],
      [[lxB, BOARD_FOOT, lzB], [lx, BOARD_FOOT, lz], [lxT, cushion, lzT], [lxBT, cushion, lzBT]],
      [[rx, BOARD_FOOT, rz], [rxB, BOARD_FOOT, rzB], [rxBT, cushion, rzBT], [rxT, cushion, rzT]],
    ];
    for (const q of quads) pushQuad(bodyPos, bodyUv, q);

    // Rear prop: from high on the back panel down to a foot 0.6 m behind.
    const mx = (lx + rx) / 2;
    const mz = (lz + rz) / 2;
    const dTop = BOARD_DEPTH + lean * 0.75;
    const pTop = new THREE.Vector3(mx - nx * dTop, top * 0.75, mz - nz * dTop);
    const pFoot = new THREE.Vector3(mx - nx * 0.62, 0, mz - nz * 0.62);
    const dir = new THREE.Vector3().subVectors(pTop, pFoot);
    const leg = legGeo.clone().applyMatrix4(
      new THREE.Matrix4().compose(
        pFoot.clone().addScaledVector(dir, 0.5),
        new THREE.Quaternion().setFromUnitVectors(yAxis, dir.clone().normalize()),
        new THREE.Vector3(1, dir.length(), 1)
      )
    );
    legs.push(leg.toNonIndexed());
    leg.dispose();
  }
  legGeo.dispose();

  const face = new THREE.Mesh(flatGeometry(facePos, faceUv), ledMat);
  face.name = 'LedBoardFaces';
  face.castShadow = true;
  const bodyParts = [flatGeometry(bodyPos, bodyUv), ...legs];
  const body = new THREE.Mesh(mergeGeometries(bodyParts)!, bodyMat);
  body.name = 'LedBoardCabinets';
  body.castShadow = true;
  body.receiveShadow = true;
  bodyParts.forEach((g) => g.dispose());
  group.add(face, body);
  return group;
}

/**
 * Sponsor carpet lying on the turf beside a goal: `w` m along the goal line, `d` m deep, one brand
 * of the ribbon from `u0`.
 */
function buildCarpet(tex: THREE.Texture, w: number, d: number, u0: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  geo.rotateY(Math.PI / 2);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const span = w / (d * 16);
  for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * span);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.88 });
  const carpet = new THREE.Mesh(geo, mat);
  carpet.name = 'SponsorCarpet';
  carpet.receiveShadow = true;
  return carpet;
}

/** Broadcast camera on a tripod, the lens toward local `-x`. */
function buildTvCamera(bodyMat: THREE.Material, steelMat: THREE.Material): THREE.Group {
  const cam = new THREE.Group();
  cam.name = 'TvCamera';
  const headY = 1.32;
  const yAxis = new THREE.Vector3(0, 1, 0);
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4;
    const foot = new THREE.Vector3(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55);
    const head = new THREE.Vector3(Math.cos(a) * 0.08, headY - 0.12, Math.sin(a) * 0.08);
    const dir = new THREE.Vector3().subVectors(head, foot);
    const leg = new THREE.CylinderGeometry(0.018, 0.022, dir.length(), 6).applyMatrix4(
      new THREE.Matrix4().compose(
        foot.clone().addScaledVector(dir, 0.5),
        new THREE.Quaternion().setFromUnitVectors(yAxis, dir.clone().normalize()),
        new THREE.Vector3(1, 1, 1)
      )
    );
    parts.push(leg);
  }
  parts.push(new THREE.CylinderGeometry(0.07, 0.09, 0.14, 10).translate(0, headY - 0.07, 0));
  const tripod = new THREE.Mesh(mergeGeometries(parts)!, steelMat);
  parts.forEach((p) => p.dispose());
  tripod.castShadow = true;
  cam.add(tripod);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.2), bodyMat);
  body.position.set(0.06, headY + 0.15, 0);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.065, 0.62, 16).rotateZ(Math.PI / 2), bodyMat);
  lens.position.set(-0.45, headY + 0.13, 0);
  const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.12, 16, 1, true).rotateZ(Math.PI / 2), steelMat);
  hood.position.set(-0.8, headY + 0.13, 0);
  const finder = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.14), bodyMat);
  finder.position.set(0.12, headY + 0.37, 0.12);
  for (const m of [body, lens, hood, finder]) {
    m.castShadow = true;
    cam.add(m);
  }
  return cam;
}

export interface AdBoardLayout {
  /** Half-length and half-width of the ring of boards (m). */
  hx: number;
  hz: number;
  cornerR: number;
  /** Half pitch length (m): where the goal lines are. */
  goalX: number;
  /** The boards stop for the dugouts on the `+z` touchline within this half-length (m). */
  dugoutGap: number;
  /** Sponsor carpets beside the goals, where there is room behind the goal line. */
  carpets: boolean;
}

/** LED boards, sponsor carpets and TV cameras around the pitch. */
export function buildPitchAdvertising(layout: AdBoardLayout, lighting: LightingMode, theme?: AdBoardTheme): THREE.Group {
  const group = new THREE.Group();
  group.name = 'PitchAdvertising';
  const tex = createLedSponsorRibbonTexture(theme);
  tex.repeat.set(1, 1);
  const ledMat = new THREE.MeshStandardMaterial({
    map: tex,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: tex,
    emissiveIntensity: lighting === 'day' ? 0.42 : 1.0,
    roughness: 0.32,
    metalness: 0.1,
  });
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x141619,
    roughness: 0.62,
    metalness: 0.35,
    side: THREE.DoubleSide,
  });

  const { hx, hz, cornerR, dugoutGap, goalX } = layout;
  const modules = ringModules(hx, hz, cornerR, (x, z) => z > hz - 0.5 && Math.abs(x) < dugoutGap);
  group.add(buildBoardRing(modules, ledMat, bodyMat));

  const depth = Math.min(2.3, hx - goalX - 0.9);
  if (layout.carpets && depth > 1.2) {
    const carpetTex = createLedSponsorRibbonTexture(theme);
    carpetTex.repeat.set(1, 1);
    let k = 0;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const carpet = buildCarpet(carpetTex, 7.5, depth, 0.11 + 0.23 * k++);
        // Laid a few centimetres proud of the turf, clear of its depth.
        carpet.position.set(sx * (goalX + 0.4 + depth / 2), 0.07, sz * 9.5);
        group.add(carpet);
      }
    }
  }

  // Two cameras behind each goal, either side of the net, the lens on the centre spot.
  const camBody = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.5, metalness: 0.4 });
  const camSteel = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.35, metalness: 0.8 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cam = buildTvCamera(camBody, camSteel);
      const px = sx * (hx + 1.1);
      const pz = sz * 8.5;
      cam.position.set(px, 0, pz);
      cam.rotation.y = Math.atan2(-pz, px);
      group.add(cam);
    }
  }
  return group;
}

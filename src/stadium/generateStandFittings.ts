import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Pitch-side fittings of a stand: the teams' dugouts set into the front wall, the press seats
 * with their desks and screens, and the wire fence over the front wall.
 *
 * Every builder works in a stand-local frame: `x` along the stand, `y` up, `z` from the pitch
 * into the stand (the front wall at `z = 0`, the pitch toward `-z`).
 */

/** Distance from the halfway line to the centre of each dugout (m), clear of the players' tunnel. */
export const DUGOUT_OFFSET = 10.5;
const DUGOUT_W = 7.2;
const DUGOUT_D = 2.6;

/** Press seats: default rows of the press box, and the bounds of its settings. */
export const PRESS_ROWS = 6;
export const PRESS_ROWS_RANGE: [number, number] = [2, 8];
export const PRESS_LENGTH_RANGE: [number, number] = [8, 60];

/** Press box settings of a stand (see `StandConfig.pressBox*`). */
export interface PressBoxSettings {
  pressBoxTier?: number;
  pressBoxRows?: number;
  pressBoxLength?: number;
}

/** Length of the press box (m) when unset. */
export const PRESS_LENGTH_DEFAULT = 30;

/** Length of the press box (m): the chosen one, never past the stand. */
export function pressBoxLength(stand: PressBoxSettings, standLength: number): number {
  const want = stand.pressBoxLength ?? PRESS_LENGTH_DEFAULT;
  return Math.max(4, Math.min(want, standLength * 0.9));
}
/** Spacing of the press places along a row (m). */
export const PRESS_PITCH = 0.9;

/** Tier holding the press box, clamped to the stand's `tierCount`. */
export function pressBoxTier(stand: PressBoxSettings, tierCount: number): number {
  return Math.max(0, Math.min(tierCount - 1, Math.round(stand.pressBoxTier ?? 0)));
}

/**
 * Index range (in the tier's rows) of the press rows. Under a tier above, the press takes the
 * back rows, sheltered by its overhang; in the top tier of a multi-tier stand it takes the front
 * rows behind the balcony; on a single tier it sits two-thirds up rather than against the crest.
 */
export function pressRowRange(
  tierRows: number,
  tierIdx: number,
  tiers: number,
  stand: PressBoxSettings = {}
): [number, number] {
  const auto = Math.min(PRESS_ROWS, Math.max(2, Math.floor(tierRows / 3)));
  const rows = Math.max(0, Math.min(tierRows, stand.pressBoxRows ?? auto));
  if (tierIdx < tiers - 1) return [tierRows - rows, tierRows];
  if (tiers >= 2) return [0, rows];
  const end = Math.min(tierRows, Math.max(rows, Math.round(tierRows * 0.72)));
  return [end - rows, end];
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // All boxes share the same attributes: concatenate them by hand to stay dependency-free.
  const nonIndexed = geos.map((g) => g.toNonIndexed());
  const count = nonIndexed.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let off = 0;
  for (const g of nonIndexed) {
    pos.set(g.attributes.position.array as Float32Array, off * 3);
    nor.set(g.attributes.normal.array as Float32Array, off * 3);
    off += g.attributes.position.count;
    g.dispose();
  }
  geos.forEach((g) => g.dispose());
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

/** Canopy profile of a dugout (z toward the pitch negative, y up): off the wall, over the seats. */
const DUGOUT_CANOPY = new THREE.QuadraticBezierCurve3(
  new THREE.Vector3(0, 2.2, 0),
  new THREE.Vector3(0, 2.45, -2.0),
  new THREE.Vector3(0, 1.45, -DUGOUT_D - 0.1)
);

/**
 * A padded bucket seat facing `-z`: pedestal, shell with side bolsters and headrest, leather
 * cushions; returned as shell and cushion geometries to instance.
 */
function dugoutSeatGeometries(): { shell: THREE.BufferGeometry; cushion: THREE.BufferGeometry } {
  const recline = (g: THREE.BufferGeometry) => g.rotateX(0.2).translate(0, 0.5, 0.2);
  const shell = merge([
    box(0.07, 0.36, 0.07, 0, 0.18, 0),
    box(0.52, 0.1, 0.5, 0, 0.41, 0),
    recline(box(0.54, 0.86, 0.08, 0, 0.43, 0.04)),
    recline(box(0.07, 0.62, 0.2, -0.24, 0.31, -0.05)),
    recline(box(0.07, 0.62, 0.2, 0.24, 0.31, -0.05)),
    box(0.06, 0.18, 0.44, -0.25, 0.53, -0.02),
    box(0.06, 0.18, 0.44, 0.25, 0.53, -0.02),
  ]);
  const cushion = merge([
    box(0.42, 0.08, 0.44, 0, 0.5, -0.02),
    recline(box(0.38, 0.5, 0.05, 0, 0.26, -0.02)),
    recline(box(0.3, 0.17, 0.06, 0, 0.71, -0.02)),
  ]);
  return { shell, cushion };
}

/**
 * One dugout in front of the wall: a rubber floor with a step, a curved clear polycarbonate
 * canopy on aluminium ribs with glass cheeks, and two rows of padded bucket seats facing the
 * pitch; a light strip under the canopy's lip at night.
 */
export function buildDugout(isNight: boolean, seatColor: THREE.ColorRepresentation = 0x1f2329): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Dugout';
  const alu = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.3, metalness: 0.85 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.92 });
  const backMat = new THREE.MeshStandardMaterial({ color: 0x31363d, roughness: 0.7 });
  const clear = new THREE.MeshPhysicalMaterial({
    color: 0xe2e8f0,
    roughness: 0.03,
    metalness: 0,
    transparent: true,
    opacity: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const shellMat = new THREE.MeshStandardMaterial({ color: seatColor, roughness: 0.38, metalness: 0.1 });
  const leather = new THREE.MeshPhysicalMaterial({
    color: 0x0d0e10,
    roughness: 0.42,
    sheen: 0.4,
    sheenColor: new THREE.Color(0x3a3d44),
  });

  // Floor, back step and a padded back panel against the wall.
  const floor = new THREE.Mesh(
    merge([box(DUGOUT_W, 0.08, DUGOUT_D, 0, 0.04, -DUGOUT_D / 2), box(DUGOUT_W, 0.26, 1.05, 0, 0.13, -0.525)]),
    floorMat
  );
  floor.receiveShadow = true;
  group.add(floor);
  group.add(new THREE.Mesh(box(DUGOUT_W, 2.15, 0.06, 0, 1.12, -0.03), backMat));

  // Curved clear canopy across the width, aluminium ribs over it, a lip beam at the front.
  const profile = DUGOUT_CANOPY.getPoints(18);
  const canopyPos: number[] = [];
  const canopyIdx: number[] = [];
  profile.forEach((p) => {
    canopyPos.push(-DUGOUT_W / 2, p.y, p.z, DUGOUT_W / 2, p.y, p.z);
  });
  for (let i = 0; i < profile.length - 1; i++) {
    const a = i * 2;
    canopyIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const canopyGeo = new THREE.BufferGeometry();
  canopyGeo.setAttribute('position', new THREE.Float32BufferAttribute(canopyPos, 3));
  canopyGeo.setIndex(canopyIdx);
  canopyGeo.computeVertexNormals();
  group.add(new THREE.Mesh(canopyGeo, clear));

  // Glass cheeks: the canopy profile down to the floor, sloping back to the step.
  const cheek = new THREE.Shape();
  cheek.moveTo(0, 0);
  for (const p of profile) cheek.lineTo(-p.z, p.y);
  cheek.lineTo(DUGOUT_D - 0.15, 0.6);
  cheek.lineTo(DUGOUT_D - 0.45, 0);
  cheek.closePath();
  const cheekGeo = new THREE.ShapeGeometry(cheek, 6);
  // Shape x is the distance toward the pitch: x -> -z.
  cheekGeo.rotateY(Math.PI / 2);
  const ribs: THREE.BufferGeometry[] = [];
  const cheekEdge = cheek.getPoints(24).map((p) => new THREE.Vector3(0, p.y, -p.x));
  for (const sx of [-1, 1]) {
    group.add(new THREE.Mesh(cheekGeo.clone().translate((sx * DUGOUT_W) / 2, 0, 0), clear));
    ribs.push(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(cheekEdge.map((p) => p.clone().setX((sx * DUGOUT_W) / 2)), true),
        64,
        0.035,
        6,
        true
      )
    );
  }
  cheekGeo.dispose();
  for (const fx of [-1 / 6, 1 / 6]) {
    ribs.push(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(profile.map((p) => new THREE.Vector3(fx * DUGOUT_W, p.y + 0.03, p.z))),
        24,
        0.03,
        6,
        false
      )
    );
  }
  const lipZ = profile[profile.length - 1];
  const lip = new THREE.CylinderGeometry(0.05, 0.05, DUGOUT_W, 10).rotateZ(Math.PI / 2).translate(0, lipZ.y, lipZ.z);
  ribs.push(lip);
  const frame = new THREE.Mesh(mergeGeometries(ribs.map((g) => g.toNonIndexed()))!, alu);
  ribs.forEach((g) => g.dispose());
  frame.castShadow = true;
  group.add(frame);

  if (isNight) {
    const strip = new THREE.Mesh(
      box(DUGOUT_W - 0.3, 0.03, 0.05, 0, lipZ.y - 0.07, lipZ.z + 0.12),
      new THREE.MeshBasicMaterial({ color: 0xf8fafc })
    );
    group.add(strip);
  }

  // Two rows of padded bucket seats facing the pitch, the back row on the step.
  const seatW = 0.6;
  const perRow = Math.floor((DUGOUT_W - 0.5) / seatW);
  const places: THREE.Matrix4[] = [];
  for (const [z, y] of [[-0.62, 0.26], [-1.7, 0.08]] as const) {
    for (let i = 0; i < perRow; i++) {
      const x = -((perRow - 1) * seatW) / 2 + i * seatW;
      places.push(new THREE.Matrix4().makeTranslation(x, y, z));
    }
  }
  const { shell, cushion } = dugoutSeatGeometries();
  for (const [geo, mat] of [[shell, shellMat], [cushion, leather]] as const) {
    const inst = new THREE.InstancedMesh(geo, mat, places.length);
    places.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }
  return group;
}

/** The two dugouts of a stand, either side of `x = 0`, in front of its wall. */
export function buildDugoutPair(isNight: boolean, seatColor?: THREE.ColorRepresentation): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Dugouts';
  for (const sx of [-1, 1]) {
    const d = buildDugout(isNight, seatColor);
    d.position.x = sx * DUGOUT_OFFSET;
    group.add(d);
  }
  return group;
}

/** A press place: where it stands on its tread front, and which way the journalist faces. */
export interface PressPlace {
  x: number;
  y: number;
  z: number;
  /** Rotation about `y` taking the local `+z` (from the pitch into the stand) to the stand's. */
  yaw: number;
}

/**
 * Press places: a desk with its modesty panel, a screen and a swivel chair, instanced over the
 * given places (front edge of each place's tread).
 */
export function buildPressDesks(places: PressPlace[], isNight: boolean): THREE.Group | null {
  if (places.length === 0) return null;
  const group = new THREE.Group();
  group.name = 'PressBox';
  const deskGeo = merge([box(0.86, 0.04, 0.4, 0, 0.74, 0.24), box(0.86, 0.72, 0.03, 0, 0.37, 0.05)]);
  const darkGeo = merge([
    box(0.46, 0.3, 0.03, 0, 0.95, 0.12),
    box(0.06, 0.12, 0.06, 0, 0.8, 0.12),
    box(0.42, 0.06, 0.4, 0, 0.46, 0.6),
    box(0.42, 0.42, 0.05, 0, 0.72, 0.79),
    box(0.06, 0.4, 0.06, 0, 0.22, 0.6),
  ]);
  const deskMat = new THREE.MeshStandardMaterial({ color: 0xe7e5e4, roughness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.5,
    emissive: new THREE.Color(isNight ? 0x1e3a5f : 0x000000),
  });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 1, 0);
  const unit = new THREE.Vector3(1, 1, 1);
  for (const [geo, mat] of [[deskGeo, deskMat], [darkGeo, darkMat]] as const) {
    const inst = new THREE.InstancedMesh(geo, mat, places.length);
    places.forEach((p, i) => {
      q.setFromAxisAngle(axis, p.yaw);
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, unit);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }
  return group;
}

let meshTexture: THREE.CanvasTexture | null = null;
/** Diamond wire mesh, drawn once. */
function getWireMeshTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  if (meshTexture) return meshTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 64, 64);
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, 32);
    ctx.lineTo(32, 0);
    ctx.lineTo(64, 32);
    ctx.lineTo(32, 64);
    ctx.closePath();
    ctx.stroke();
  }
  meshTexture = new THREE.CanvasTexture(canvas);
  meshTexture.wrapS = THREE.RepeatWrapping;
  meshTexture.wrapT = THREE.RepeatWrapping;
  meshTexture.anisotropy = 4;
  return meshTexture;
}

/** Spacing of the fence posts (m). */
const POST_SPACING = 3;
/** Wire mesh cells per metre. */
const MESH_PER_M = 9;

/**
 * Wire fence along runs of parapet points (each run a polyline of the parapet top), `height` m
 * tall, with posts, a top rail and the top leaning toward the pitch.
 */
export function buildWireFence(
  runs: { points: THREE.Vector3[]; inward: THREE.Vector3[] }[],
  height: number
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'PitchFence';
  const tex = getWireMeshTexture();
  const meshMat = new THREE.MeshStandardMaterial({
    color: 0xc0c6cc,
    metalness: 0.6,
    roughness: 0.45,
    side: THREE.DoubleSide,
    ...(tex ? { alphaMap: tex, alphaTest: 0.35, transparent: false } : { transparent: true, opacity: 0.25 }),
  });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.7, roughness: 0.4 });
  // The top 0.6 m leans 0.45 m toward the pitch, to stop climbers.
  const lean = Math.min(0.6, height * 0.25);
  const postGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 6);
  const posts: THREE.Matrix4[] = [];
  const up = new THREE.Vector3(0, 1, 0);

  for (const run of runs) {
    const n = run.points.length;
    if (n < 2) continue;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let along = 0;
    let nextPost = 0;
    for (let i = 0; i < n; i++) {
      const p = run.points[i];
      const inn = run.inward[i];
      if (i > 0) along += p.distanceTo(run.points[i - 1]);
      const knee = p.clone().addScaledVector(up, height - lean);
      const top = knee.clone().addScaledVector(up, lean).addScaledVector(inn, 0.45);
      for (const [v, h] of [[p, 0], [knee, height - lean], [top, height]] as const) {
        pos.push(v.x, v.y, v.z);
        uv.push(along * MESH_PER_M, h * MESH_PER_M);
      }
      if (i > 0) {
        const a = (i - 1) * 3;
        const b = i * 3;
        idx.push(a, b, a + 1, b, b + 1, a + 1, a + 1, b + 1, a + 2, b + 1, b + 2, a + 2);
      }
      // Posts at the spacing and at both ends.
      if (along >= nextPost || i === n - 1) {
        posts.push(
          new THREE.Matrix4().compose(
            p.clone().addScaledVector(up, (height - lean) / 2),
            new THREE.Quaternion(),
            new THREE.Vector3(1, height - lean, 1)
          )
        );
        nextPost = along + POST_SPACING;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, meshMat));

    // Rails at the foot, the knee and the top.
    for (const level of [0, 1, 2]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(pos[(i * 3 + level) * 3], pos[(i * 3 + level) * 3 + 1], pos[(i * 3 + level) * 3 + 2]));
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(2, n * 2), 0.035, 5, false), steelMat));
    }
  }
  if (posts.length > 0) {
    const inst = new THREE.InstancedMesh(postGeo, steelMat, posts.length);
    posts.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.castShadow = true;
    group.add(inst);
  }
  return group;
}

/** Height of the wire fence (m), defaulted and clamped. */
export function resolveFenceHeight(height: number | undefined): number {
  return Math.max(1.5, Math.min(4, height ?? 2.5));
}

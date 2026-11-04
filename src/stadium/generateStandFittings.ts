import * as THREE from 'three';

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

/** Press seats: rows and length of the press box. */
export const PRESS_ROWS = 6;
export function pressBoxLength(standLength: number): number {
  return Math.max(10, Math.min(32, standLength * 0.32));
}
/** Spacing of the press places along a row (m). */
export const PRESS_PITCH = 0.9;

/** Index range (in the tier's rows) of the press rows: the back of the lowest tier. */
export function pressRowRange(tierRows: number, tiers: number): [number, number] {
  const rows = Math.min(PRESS_ROWS, Math.max(2, Math.floor(tierRows / 3)));
  // On a single tier, the press sits two-thirds up rather than against the crest.
  const end = tiers >= 2 ? tierRows : Math.max(rows, Math.round(tierRows * 0.72));
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

/**
 * One dugout in front of the wall: a floor, white side cheeks, a glazed roof sloping down to the
 * pitch, two stepped rows of padded seats facing the pitch.
 */
export function buildDugout(isNight: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Dugout';
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.4, metalness: 0.3 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.9 });
  const roofMat = new THREE.MeshPhysicalMaterial({
    color: 0xdbeafe,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.38,
    side: THREE.DoubleSide,
  });
  const seatMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.55,
    emissive: new THREE.Color(isNight ? 0x0b1220 : 0x000000),
  });

  const zMid = -DUGOUT_D / 2;
  const floor = new THREE.Mesh(merge([box(DUGOUT_W, 0.1, DUGOUT_D, 0, 0.05, zMid), box(DUGOUT_W, 0.32, 1.0, 0, 0.16, -0.5)]), floorMat);
  floor.receiveShadow = true;
  group.add(floor);

  const backH = 2.0;
  const frontH = 1.75;
  // Side cheeks follow the roof slope; a low kerb along the front.
  const cheekShape = new THREE.Shape();
  cheekShape.moveTo(0, 0);
  cheekShape.lineTo(0, backH);
  cheekShape.lineTo(-DUGOUT_D, frontH);
  cheekShape.lineTo(-DUGOUT_D, 0);
  cheekShape.closePath();
  const cheekGeo = new THREE.ExtrudeGeometry(cheekShape, { depth: 0.12, bevelEnabled: false });
  // Shape x -> world z, shape y -> world y, extrusion -> world x.
  cheekGeo.rotateY(Math.PI / 2);
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(cheekGeo, sx < 0 ? frameMat : frameMat);
    cheek.position.x = sx * (DUGOUT_W / 2) - (sx > 0 ? 0.12 : 0);
    cheek.castShadow = true;
    group.add(cheek);
  }
  group.add(new THREE.Mesh(box(DUGOUT_W, 0.18, 0.12, 0, 0.09, -DUGOUT_D + 0.06), frameMat));

  // Glazed roof with a white front beam.
  const slope = Math.atan2(backH - frontH, DUGOUT_D);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(DUGOUT_W, 0.04, Math.hypot(DUGOUT_D, backH - frontH) + 0.2), roofMat);
  roof.position.set(0, (backH + frontH) / 2 + 0.02, zMid - 0.1);
  roof.rotation.x = -slope;
  group.add(roof);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(DUGOUT_W + 0.1, 0.14, 0.14), frameMat);
  beam.position.set(0, frontH, -DUGOUT_D - 0.05);
  beam.castShadow = true;
  group.add(beam);

  // Two rows of bucket seats facing the pitch, the back row on the step.
  const seatW = 0.56;
  const perRow = Math.floor((DUGOUT_W - 0.6) / seatW);
  const seatParts: THREE.BufferGeometry[] = [];
  for (const [z, y] of [[-0.45, 0.32], [-1.45, 0.1]] as const) {
    for (let i = 0; i < perRow; i++) {
      const x = -((perRow - 1) * seatW) / 2 + i * seatW;
      seatParts.push(box(0.48, 0.1, 0.46, x, y + 0.42, z));
      seatParts.push(box(0.48, 0.62, 0.08, x, y + 0.75, z + 0.24));
    }
  }
  const seats = new THREE.Mesh(merge(seatParts), seatMat);
  seats.castShadow = true;
  group.add(seats);
  return group;
}

/** The two dugouts of a stand, either side of `x = 0`, in front of its wall. */
export function buildDugoutPair(isNight: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Dugouts';
  for (const sx of [-1, 1]) {
    const d = buildDugout(isNight);
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

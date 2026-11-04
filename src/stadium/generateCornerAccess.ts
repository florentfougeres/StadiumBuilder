import * as THREE from 'three';

/**
 * Vehicle access through a stadium corner (fire engines, ambulances, event trucks): under seated
 * corners a tunnel carved through the lower rows, a bridge deck carrying the rows above it; in an
 * open corner a driveway from the pitch apron out to a gate.
 */

/** Clear width of the access (m). */
export const CORNER_ACCESS_WIDTH = 7;
/** Clear height under the deck (m), enough for a fire engine or a stage truck. */
export const CORNER_ACCESS_CLEARANCE = 4.6;
/** Depth of the deck slab over the tunnel (m). */
const DECK_SLAB = 0.7;
/** Rows below this height are carved out for the tunnel. */
export const CORNER_ACCESS_DECK_Y = CORNER_ACCESS_CLEARANCE + DECK_SLAB;

/** A swept stand: per-slice 2D profiles `(d behind the front wall, y)` placed in the world. */
export interface SweptStand {
  sliceCount: number;
  closed: boolean;
  profiles: [number, number][][];
  world: (slice: number, d: number, y: number) => [number, number, number];
}

export interface CornerTunnelPlan {
  /** Consecutive slices bounding the tunnel (wrapping on a closed ring), first to last. */
  slices: number[];
  /** Per entry of `slices`, the first profile point kept: segments before it are carved. */
  keep: number[];
}

const wrap = (s: number, n: number) => ((s % n) + n) % n;

function frontPoint(sw: SweptStand, s: number): THREE.Vector2 {
  const [x, , z] = sw.world(s, 0, 0);
  return new THREE.Vector2(x, z);
}

/** First point of a profile at or above the deck: the rows from there on stay. */
function firstKeptPoint(pts: [number, number][]): number {
  // The last points are the crest and the rear wall down to the ground.
  for (let i = 3; i < pts.length - 2; i++) {
    if (pts[i][1] >= CORNER_ACCESS_DECK_Y - 1e-3) return i;
  }
  return -1;
}

/**
 * Picks the slices around `target` (a point of the pitch-side front) spanning the access width,
 * and the rows to carve in each. `null` when the stand is too low to pass a vehicle under.
 */
export function planCornerTunnel(sw: SweptStand, target: { x: number; z: number }): CornerTunnelPlan | null {
  const n = sw.sliceCount;
  if (n < 3) return null;
  const goal = new THREE.Vector2(target.x, target.z);
  let centre = 0;
  let best = Infinity;
  for (let s = 0; s < n; s++) {
    const dist = frontPoint(sw, s).distanceTo(goal);
    if (dist < best) {
      best = dist;
      centre = s;
    }
  }
  let lo = centre;
  let hi = centre;
  const canGrow = (s: number) => (sw.closed ? hi - lo < Math.floor(n / 6) : s >= 0 && s < n);
  // Grow the window one slice at a time, on the side keeping it centred on the target.
  while (frontPoint(sw, wrap(lo, n)).distanceTo(frontPoint(sw, wrap(hi, n))) < CORNER_ACCESS_WIDTH) {
    const left = canGrow(lo - 1);
    const right = canGrow(hi + 1);
    if (!left && !right) break;
    const dl = left ? frontPoint(sw, wrap(lo - 1, n)).distanceTo(goal) : Infinity;
    const dr = right ? frontPoint(sw, wrap(hi + 1, n)).distanceTo(goal) : Infinity;
    if (dl <= dr) lo--;
    else hi++;
  }
  if (hi === lo) return null;
  const slices: number[] = [];
  for (let s = lo; s <= hi; s++) slices.push(wrap(s, n));
  const keep = slices.map((s) => firstKeptPoint(sw.profiles[s]));
  if (keep.some((k) => k < 0)) return null;
  return { slices, keep };
}

/** Whether the quad from slice `s` to the next, on profile segment `p`, is carved by the tunnel. */
export function isTunnelQuad(plan: CornerTunnelPlan, s: number, p: number): boolean {
  const i = plan.slices.indexOf(s);
  if (i < 0 || i >= plan.slices.length - 1) return false;
  return p < Math.max(plan.keep[i], plan.keep[i + 1]);
}

/** Whether the bay from slice `s` to the next lies over the tunnel. */
export function isTunnelBay(plan: CornerTunnelPlan, s: number): boolean {
  const i = plan.slices.indexOf(s);
  return i >= 0 && i < plan.slices.length - 1;
}

interface AccessMaterials {
  concrete: THREE.Material;
  bore: THREE.Material;
  asphalt: THREE.Material;
  marking: THREE.Material;
  shutter: THREE.Material;
  steel: THREE.Material;
  hazard: THREE.Material;
  light: THREE.Material;
}

let hazardTexture: THREE.CanvasTexture | null = null;
function getHazardTexture(): THREE.CanvasTexture {
  if (hazardTexture) return hazardTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#facc15';
    ctx.fillRect(0, 0, 128, 16);
    ctx.fillStyle = '#111827';
    for (let x = -16; x < 128; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 16);
      ctx.lineTo(x + 8, 0);
      ctx.lineTo(x + 16, 0);
      ctx.lineTo(x + 8, 16);
      ctx.closePath();
      ctx.fill();
    }
  }
  hazardTexture = new THREE.CanvasTexture(canvas);
  hazardTexture.wrapS = THREE.RepeatWrapping;
  hazardTexture.colorSpace = THREE.SRGBColorSpace;
  hazardTexture.repeat.set(4, 1);
  return hazardTexture;
}

function accessMaterials(concrete: THREE.Material, isNight: boolean): AccessMaterials {
  const twoSided = concrete.clone();
  twoSided.side = THREE.DoubleSide;
  const hasDocument = typeof document !== 'undefined';
  return {
    concrete: twoSided,
    bore: new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.92, side: THREE.DoubleSide }),
    asphalt: new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.96 }),
    marking: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.7 }),
    shutter: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.55, metalness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.4, metalness: 0.75 }),
    hazard: hasDocument
      ? new THREE.MeshStandardMaterial({ map: getHazardTexture(), roughness: 0.6 })
      : new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.6 }),
    light: isNight
      ? new THREE.MeshBasicMaterial({ color: 0xfff3c4 })
      : new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.4 }),
  };
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Road with a dashed centre line in a local frame (`x` across, `z` along the drive, `y` up),
 * from `z0` to `z1`.
 */
function addRoad(group: THREE.Group, mats: AccessMaterials, width: number, z0: number, z1: number): void {
  const len = z1 - z0;
  const road = box(width, 0.06, len, mats.asphalt, 0, 0.03, (z0 + z1) / 2);
  road.castShadow = false;
  group.add(road);
  for (const sx of [-1, 1]) {
    group.add(box(0.12, 0.012, len, mats.marking, sx * (width / 2 - 0.3), 0.066, (z0 + z1) / 2));
  }
  for (let z = z0 + 1; z < z1 - 1.5; z += 4) {
    const dash = box(0.14, 0.012, 2, mats.marking, 0, 0.066, z + 1);
    dash.castShadow = false;
    group.add(dash);
  }
}

/** Sliding steel gate across the drive at `z`, with its two posts. */
function addGate(group: THREE.Group, mats: AccessMaterials, width: number, z: number): void {
  const h = 2.6;
  for (const sx of [-1, 1]) group.add(box(0.35, h + 0.4, 0.35, mats.steel, sx * (width / 2 + 0.25), (h + 0.4) / 2, z));
  group.add(box(width, 0.08, 0.08, mats.steel, 0, h, z));
  group.add(box(width, 0.08, 0.08, mats.steel, 0, 0.25, z));
  const bars = Math.round(width / 0.22);
  const bar = new THREE.BoxGeometry(0.04, h - 0.25, 0.04);
  const inst = new THREE.InstancedMesh(bar, mats.steel, bars);
  const m = new THREE.Matrix4();
  for (let i = 0; i < bars; i++) {
    m.makeTranslation(-width / 2 + (i + 0.5) * (width / bars), 0.25 + (h - 0.25) / 2, z);
    inst.setMatrixAt(i, m);
  }
  inst.castShadow = true;
  group.add(inst);
}

/**
 * Tunnel through a swept stand: carves nothing itself (the stand skips the quads, see
 * `isTunnelQuad`), but builds the bridge deck over the carved rows, the bore under it, its road
 * and the shutter at its far end.
 */
export function buildCornerTunnel(
  sw: SweptStand,
  plan: CornerTunnelPlan,
  concrete: THREE.Material,
  isNight: boolean
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'CornerVehicleTunnel';
  const mats = accessMaterials(concrete, isNight);
  const hc = CORNER_ACCESS_CLEARANCE;

  // Bridge deck: the slab over the tunnel up to the first kept row, with a parapet at its front.
  const deckProfiles = plan.slices.map((s, i): [number, number][] => {
    const pts = sw.profiles[s];
    const [dK, yK] = pts[plan.keep[i]];
    const d = Math.max(0.6, dK);
    return [[0, hc], [0, yK + 1.0], [0.3, yK + 1.0], [0.3, yK], [d, yK], [d, hc], [0, hc]];
  });
  const pCount = deckProfiles[0].length;
  const positions: number[] = [];
  const index: number[] = [];
  deckProfiles.forEach((prof, i) => {
    for (const [d, y] of prof) positions.push(...sw.world(plan.slices[i], d, y));
  });
  for (let i = 0; i < deckProfiles.length - 1; i++) {
    for (let p = 0; p < pCount - 1; p++) {
      const a = i * pCount + p;
      const b = (i + 1) * pCount + p;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // Side faces of the deck.
  for (const i of [0, deckProfiles.length - 1]) {
    const base = positions.length / 3;
    const prof = deckProfiles[i];
    for (const [d, y] of prof) positions.push(...sw.world(plan.slices[i], d, y));
    // Fan over the six distinct points (the profile repeats its first point to close).
    const [p0, p1, p2, p3, p4, p5] = [0, 1, 2, 3, 4, 5].map((k) => base + k);
    index.push(p0, p1, p2, p0, p2, p3, p0, p3, p4, p0, p4, p5);
  }
  const deckGeo = new THREE.BufferGeometry();
  deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  deckGeo.setIndex(index);
  deckGeo.computeVertexNormals();
  const deck = new THREE.Mesh(deckGeo, mats.concrete);
  deck.name = 'CornerTunnelDeck';
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // Bore: a straight box along the corner's axis, as wide as the carved front.
  const first = plan.slices[0];
  const last = plan.slices[plan.slices.length - 1];
  const a = frontPoint(sw, first);
  const b = frontPoint(sw, last);
  const width = a.distanceTo(b);
  const mouth = a.clone().add(b).multiplyScalar(0.5);
  const out = new THREE.Vector2();
  for (const s of [first, last]) {
    const [x1, , z1] = sw.world(s, 1, 0);
    const f = frontPoint(sw, s);
    out.add(new THREE.Vector2(x1 - f.x, z1 - f.y).normalize());
  }
  out.normalize();
  // Through the whole stand, to its rear wall.
  const length = Math.max(
    8,
    ...plan.slices.map((s) => Math.max(...sw.profiles[s].map(([d]) => d)))
  );

  const bore = new THREE.Group();
  bore.position.set(mouth.x, 0, mouth.y);
  bore.rotation.y = Math.atan2(out.x, out.y);
  const wall = 0.35;
  const inner = width - 2 * wall;
  for (const sx of [-1, 1]) bore.add(box(wall, hc, length, mats.bore, sx * (width / 2 - wall / 2), hc / 2, length / 2));
  bore.add(box(width, 0.4, length, mats.bore, 0, hc + 0.2, length / 2));
  // Height-limit beam over the mouth.
  bore.add(box(width, 0.45, 0.12, mats.hazard, 0, hc - 0.225, 0.08));
  // Ceiling lights down the bore.
  for (let z = 2; z < length - 1; z += 4) bore.add(box(inner * 0.5, 0.06, 0.4, mats.light, 0, hc - 0.03, z));
  // Shutter at the far end, seen from the pitch and from outside.
  bore.add(box(inner, hc - 0.1, 0.15, mats.shutter, 0, (hc - 0.1) / 2, length - 0.2));
  addRoad(bore, mats, inner, -2.5, length - 0.3);
  group.add(bore);
  return group;
}

/**
 * Driveway through an open corner, from the pitch apron at `start` outward along `dir` for
 * `length` metres, with a gate `gateAt` metres from the start.
 */
export function buildCornerDriveway(
  start: { x: number; z: number },
  dir: { x: number; z: number },
  length: number,
  gateAt: number,
  concrete: THREE.Material,
  isNight: boolean
): THREE.Group {
  const mats = accessMaterials(concrete, isNight);
  const group = new THREE.Group();
  group.name = 'CornerVehicleDriveway';
  group.position.set(start.x, 0, start.z);
  group.rotation.y = Math.atan2(dir.x, dir.z);
  addRoad(group, mats, CORNER_ACCESS_WIDTH - 0.7, 0, length);
  addGate(group, mats, CORNER_ACCESS_WIDTH - 0.7, gateAt);
  return group;
}

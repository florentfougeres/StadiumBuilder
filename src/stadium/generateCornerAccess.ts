import * as THREE from 'three';

/**
 * Vehicle access through a seated stadium corner (fire engines, ambulances, event trucks): a
 * tunnel carved through the lower rows, a bridge deck carrying the rows above it.
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
  shutter: THREE.Material;
  light: THREE.Material;
}

function accessMaterials(concrete: THREE.Material, isNight: boolean): AccessMaterials {
  const twoSided = concrete.clone();
  twoSided.side = THREE.DoubleSide;
  return {
    concrete: twoSided,
    bore: new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.92, side: THREE.DoubleSide }),
    shutter: new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.55, metalness: 0.6 }),
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
 * Tunnel through a swept stand: carves nothing itself (the stand skips the quads, see
 * `isTunnelQuad`), but builds the bridge deck over the carved rows, the bore under it and the
 * shutter at its far end. Nothing reaches out of the stand onto the pitch side.
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
  // Ceiling lights down the bore.
  for (let z = 2; z < length - 1; z += 4) bore.add(box(inner * 0.5, 0.06, 0.4, mats.light, 0, hc - 0.03, z));
  // Shutter at the far end, seen from the pitch and from outside.
  bore.add(box(inner, hc - 0.1, 0.15, mats.shutter, 0, (hc - 0.1) / 2, length - 0.2));
  // Plain concrete floor, inside the stand only.
  const floor = box(inner, 0.04, length - 0.3, mats.bore, 0, 0.02, (length - 0.3) / 2);
  floor.castShadow = false;
  bore.add(floor);
  group.add(bore);
  return group;
}

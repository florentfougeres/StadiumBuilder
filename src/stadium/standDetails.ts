import * as THREE from 'three';
import { ignoreRaycasts } from './meshKit';

/**
 * Construction details of a swept stand, shared by every stand builder (straight stands, corners,
 * the continuous bowl): they all describe their terraces the same way, as a 2D profile per slice
 * mapped round the stand by `sampleWorldPoint`, so the details follow straight runs and curves
 * alike, and every builder gets them whether or not it seats people.
 *
 * - aisle stairs: intermediate steps in every radial aisle, so each row is climbed in goings of
 *   under 20 cm, with contrasting nosings on every step edge;
 * - glazed balustrades along the front edge of every upper tier;
 * - the joints between the precast terrace units, across tread and riser, on one radial grid for
 *   every row (the units sit on the same raker beams), and the expansion joints that cut the whole
 *   stand every 60-70 m, with their steel cover plates, through the balustrades and soffits;
 * - the underside of every cantilevered tier: downstand beams and recessed light fittings.
 *
 * Profile conventions (see `buildStandProfilePoints`): `d` grows away from the pitch, `y` up; a
 * seat tread is a horizontal segment, followed by its riser (vertical) up to the next tread.
 */
export interface StandSweep {
  /** Slices across the stand; `activeSegments` of them are joined to the next. */
  ringCount: number;
  activeSegments: number;
  closed: boolean;
  profilePtsPerSlice: [number, number][][];
  sampleWorldPoint: (sliceIdx: number, radD: number, py: number) => [number, number, number];
  isSeatSegmentMask: boolean[];
  /** Quads carved out of the terraces (vomitory openings). */
  isHoleQuad?: (sliceIdx: number, profileSegIdx: number) => boolean;
  aisleCount: number;
  aisleWidth: number;
  /** Fittings in the soffits are lit (dusk and night). */
  lit: boolean;
}

/** Rise of one aisle step at most: a row's riser is climbed in as many steps as that takes. */
const MAX_STEP_RISE = 0.2;
/** Length of one precast terrace unit along the stand (m). */
const PRECAST_UNIT_M = 7.2;
/**
 * Longest run of a concrete stand between two expansion joints (m): beyond it, shrinkage and
 * temperature would crack it, so a long stand or a bowl ring is cut into blocks of 60-70 m.
 */
const EXPANSION_BLOCK_M = 65;
/** Width of an expansion joint and of the steel plate that covers it on the terraces (m). */
const EXPANSION_GAP_M = 0.05;
const EXPANSION_COVER_M = 0.22;
/** Height of the glazed balustrade over an upper tier's front edge (m). */
const BALUSTRADE_H = 0.95;
/** Spacing of the downstand beams under a cantilevered tier (m). */
const SOFFIT_BEAM_SPACING = 6;

const UP = new THREE.Vector3(0, 1, 0);

/** A position round the stand: slice, and fraction of the way to the next slice. */
interface SweepPoint {
  s: number;
  f: number;
}

class SweepFrame {
  constructor(private readonly sw: StandSweep) {}

  next(s: number): number {
    return this.sw.closed ? (s + 1) % this.sw.ringCount : s + 1;
  }

  /** World point on slice `s` at fraction `t` of profile segment `seg`, raised by `dy`, pushed back by `dd`. */
  private slicePoint(s: number, seg: number, t: number, dy: number, dd: number): THREE.Vector3 {
    const pts = this.sw.profilePtsPerSlice[s];
    const [d0, y0] = pts[seg];
    const [d1, y1] = pts[seg + 1];
    return new THREE.Vector3(...this.sw.sampleWorldPoint(s, d0 + (d1 - d0) * t + dd, y0 + (y1 - y0) * t + dy));
  }

  point(at: SweepPoint, seg: number, t: number, dy = 0, dd = 0): THREE.Vector3 {
    return this.slicePoint(at.s, seg, t, dy, dd).lerp(this.slicePoint(this.next(at.s), seg, t, dy, dd), at.f);
  }

  /** Unit axes at a point: along the stand, and horizontally away from the pitch. */
  axes(at: SweepPoint, seg: number, t: number): { x: THREE.Vector3; z: THREE.Vector3 } {
    const z = this.point(at, seg, t, 0, 0.5).sub(this.point(at, seg, t)).setY(0).normalize();
    const x = new THREE.Vector3().crossVectors(UP, z).normalize();
    return { x, z };
  }

  /**
   * The line at fraction `t` of segment `seg` round the stand: its length, and a lookup from a
   * distance along it to the slice holding that distance.
   */
  line(seg: number, t: number): { total: number; at: (along: number) => SweepPoint } {
    const lens: number[] = [];
    let total = 0;
    for (let s = 0; s < this.sw.activeSegments; s++) {
      const len = this.slicePoint(s, seg, t, 0, 0).distanceTo(this.slicePoint(this.next(s), seg, t, 0, 0));
      lens.push(len);
      total += len;
    }
    return {
      total,
      at: (along: number) => {
        let run = 0;
        for (let s = 0; s < lens.length; s++) {
          if (along <= run + lens[s] || s === lens.length - 1) {
            return { s, f: lens[s] > 1e-6 ? THREE.MathUtils.clamp((along - run) / lens[s], 0, 1) : 0 };
          }
          run += lens[s];
        }
        return { s: 0, f: 0 };
      },
    };
  }

  hole(at: SweepPoint, seg: number): boolean {
    return this.sw.isHoleQuad?.(at.s, seg) ?? false;
  }
}

/** Boxes as (centre, axes, size), made into one instanced mesh. */
class BoxBatch {
  readonly matrices: THREE.Matrix4[] = [];

  add(c: THREE.Vector3, x: THREE.Vector3, z: THREE.Vector3, sx: number, sy: number, sz: number): void {
    this.matrices.push(
      new THREE.Matrix4()
        .makeBasis(x.clone().multiplyScalar(sx), UP.clone().multiplyScalar(sy), z.clone().multiplyScalar(sz))
        .setPosition(c)
    );
  }

  build(name: string, mat: THREE.Material, castShadow: boolean): THREE.InstancedMesh | null {
    if (this.matrices.length === 0) return null;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, this.matrices.length);
    this.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.name = name;
    ignoreRaycasts(mesh);
    return mesh;
  }
}

/** Flat quads in one merged mesh (precast joints, glass, handrails). */
class QuadBatch {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];

  /** Quad a-b-c-d facing `n` (the materials are double-sided, so winding does not matter). */
  add(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3): void {
    for (const p of [a, b, c, a, c, d]) {
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(n.x, n.y, n.z);
    }
  }

  build(name: string, mat: THREE.Material): THREE.Mesh | null {
    if (this.pos.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.receiveShadow = true;
    ignoreRaycasts(mesh);
    return mesh;
  }
}

interface Tread {
  seg: number;
  tier: number;
  /** The plain riser behind it, straight up to the next tread; -1 when a walkway or wall follows. */
  riserSeg: number;
}

/** Seat treads with their tier (a run of four or more non-seat segments is a tier break). */
function listTreads(sw: StandSweep): Tread[] {
  const mask = sw.isSeatSegmentMask;
  const pts = sw.profilePtsPerSlice[0];
  const out: Tread[] = [];
  let tier = 0;
  let gap = 0;
  let seen = false;
  mask.forEach((isSeat, p) => {
    if (!isSeat) {
      gap++;
      return;
    }
    if (seen && gap >= 4) tier++;
    seen = true;
    gap = 0;
    const plain =
      p + 2 < mask.length && !mask[p + 1] && mask[p + 2] && Math.abs(pts[p + 2][0] - pts[p + 1][0]) < 0.05;
    out.push({ seg: p, tier, riserSeg: plain ? p + 1 : -1 });
  });
  return out;
}

function riseOf(sw: StandSweep, at: SweepPoint, riserSeg: number): number {
  if (riserSeg < 0) return 0;
  const pts = sw.profilePtsPerSlice[at.s];
  return pts[riserSeg + 1][1] - pts[riserSeg][1];
}

function depthOf(sw: StandSweep, at: SweepPoint, seg: number): number {
  const pts = sw.profilePtsPerSlice[at.s];
  return pts[seg + 1][0] - pts[seg][0];
}

type DetailMaterials = {
  step: THREE.MeshStandardMaterial;
  nosing: THREE.MeshStandardMaterial;
  joint: THREE.MeshStandardMaterial;
  gap: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  beam: THREE.MeshStandardMaterial;
};
let detailMaterials: DetailMaterials | null = null;

/** Plain colours without textures, shared across builds (like the handrails' steel). */
function materials(): DetailMaterials {
  detailMaterials ??= {
    step: new THREE.MeshStandardMaterial({ color: 0xbab8b2, roughness: 0.92 }),
    nosing: new THREE.MeshStandardMaterial({ color: 0xe3b22b, roughness: 0.55 }),
    // Lifted a few millimetres off the concrete rather than polygon-offset (negative offsets bleed
    // over the turf, see the pitch tests).
    joint: new THREE.MeshStandardMaterial({ color: 0x55554f, roughness: 1, side: THREE.DoubleSide }),
    gap: new THREE.MeshStandardMaterial({ color: 0x1d1d1b, roughness: 1, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({
      color: 0xcfe2e6,
      roughness: 0.06,
      metalness: 0.1,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    steel: new THREE.MeshStandardMaterial({ color: 0xc6ccd2, roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide }),
    beam: new THREE.MeshStandardMaterial({ color: 0xd9d8d3, roughness: 0.85 }),
  };
  return detailMaterials;
}

/** Recessed fittings: glowing at dusk and night only. */
function lightMaterial(lit: boolean): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xf3f1ea,
    emissive: new THREE.Color(0xfff1d6),
    emissiveIntensity: lit ? 2.2 : 0,
    roughness: 0.4,
  });
}

/** A1: intermediate steps and nosings in every radial aisle. */
function buildAisleStairs(sw: StandSweep, frame: SweepFrame, treads: Tread[], mats: DetailMaterials): THREE.Object3D[] {
  if (sw.aisleCount <= 0) return [];
  const steps = new BoxBatch();
  const nosings = new BoxBatch();
  const width = Math.max(0.8, sw.aisleWidth * 0.9);
  for (const tr of treads) {
    for (let k = 0; k < sw.aisleCount; k++) {
      // The same slice position on every tread: a radial line, as the seats' aisles are.
      const u = ((k + 0.5) / sw.aisleCount) * sw.activeSegments;
      const s = Math.min(sw.activeSegments - 1, Math.floor(u));
      const at = { s, f: u - s };
      if (frame.hole(at, tr.seg)) continue;
      const depth = depthOf(sw, at, tr.seg);
      if (depth < 0.3) continue;
      const rise = riseOf(sw, at, tr.riserSeg);
      const n = rise > 0.05 ? THREE.MathUtils.clamp(Math.ceil(rise / MAX_STEP_RISE), 1, 4) : 1;
      const { x, z } = frame.axes(at, tr.seg, 0.5);
      for (let j = 0; j < n; j++) {
        const t0 = j / n;
        const h = (rise * j) / n;
        // Each step a block from its front edge to the back of the tread, as tall as the step.
        if (j > 0) steps.add(frame.point(at, tr.seg, (t0 + 1) / 2, h / 2), x, z, width, h, depth * (1 - t0));
        nosings.add(frame.point(at, tr.seg, t0, h + 0.012, 0.045), x, z, width * 0.96, 0.026, 0.08);
      }
    }
  }
  return [steps.build('RadialStairSteps', mats.step, false), nosings.build('RadialStairNosings', mats.nosing, false)].filter(
    (m): m is THREE.InstancedMesh => m !== null
  );
}

/** A2: glazed balustrade with a steel handrail and posts along the front of every upper tier. */
function buildTierFrontBalustrades(sw: StandSweep, frame: SweepFrame, treads: Tread[], grid: ConstructionGrid, mats: DetailMaterials): THREE.Object3D[] {
  const pts0 = sw.profilePtsPerSlice[0];
  const glass = new QuadBatch();
  const rail = new QuadBatch();
  const posts = new BoxBatch();
  const fronts = treads.filter((tr, i) => {
    if (tr.tier === 0 || (i > 0 && treads[i - 1].tier === tr.tier)) return false;
    // The tier's first tread starts on top of a fascia: the segment before it rises straight up.
    const p = tr.seg;
    return p > 0 && Math.abs(pts0[p][0] - pts0[p - 1][0]) < 0.05 && pts0[p][1] - pts0[p - 1][1] > 0.3;
  });
  for (const tr of fronts) {
    let prev: { b: THREE.Vector3; t: THREE.Vector3; z: THREE.Vector3 } | null = null;
    for (let s = 0; s <= sw.activeSegments; s++) {
      const at = s === sw.activeSegments ? { s: s - 1, f: 1 } : { s, f: 0 };
      const b = frame.point(at, tr.seg, 0, 0, 0.08);
      const t = b.clone().setY(b.y + BALUSTRADE_H);
      const { z } = frame.axes(at, tr.seg, 0);
      if (prev) {
        const n = z.clone().negate();
        glass.add(
          prev.b.clone().setY(prev.b.y + 0.06),
          b.clone().setY(b.y + 0.06),
          t.clone().setY(t.y - 0.06),
          prev.t.clone().setY(prev.t.y - 0.06),
          n
        );
        // Handrail: a flat cap over a front band.
        rail.add(prev.t, t, t.clone().addScaledVector(z, 0.09), prev.t.clone().addScaledVector(prev.z, 0.09), UP);
        rail.add(prev.t.clone().setY(prev.t.y - 0.05), t.clone().setY(t.y - 0.05), t, prev.t, n);
      }
      // No balustrade across a carved opening.
      prev = s < sw.activeSegments && frame.hole(at, tr.seg) ? null : { b, t, z };
    }
    const line = frame.line(tr.seg, 0);
    const count = Math.max(1, Math.round(line.total / 1.6));
    for (let k = 0; k <= count; k++) {
      const at = line.at((k / count) * line.total);
      const { x, z } = frame.axes(at, tr.seg, 0);
      posts.add(frame.point(at, tr.seg, 0, BALUSTRADE_H / 2, 0.08), x, z, 0.05, BALUSTRADE_H, 0.05);
    }
    // Each block of the stand ends its balustrade on a post of its own, a gap between the two.
    for (const at of grid.expansionJoints) {
      if (frame.hole(at, tr.seg)) continue;
      const { x, z } = frame.axes(at, tr.seg, 0);
      for (const side of [-1, 1]) {
        const c = frame.point(at, tr.seg, 0, BALUSTRADE_H / 2, 0.08).addScaledVector(x, side * (EXPANSION_GAP_M / 2 + 0.04));
        posts.add(c, x, z, 0.07, BALUSTRADE_H + 0.02, 0.07);
      }
    }
  }
  const out: THREE.Object3D[] = [];
  const g = glass.build('TierFrontGlass', mats.glass);
  if (g) {
    g.renderOrder = 2;
    out.push(g);
  }
  const r = rail.build('TierFrontRail', mats.steel);
  if (r) out.push(r);
  const p = posts.build('TierFrontPosts', mats.steel, false);
  if (p) out.push(p);
  return out;
}

/**
 * The stand's construction grid: where its precast units meet, and which of those joints are
 * expansion joints. Laid out once along a middle row and shared by every row as the same slice
 * positions, so joints run radially across a curved bowl instead of drifting row by row.
 */
interface ConstructionGrid {
  unitJoints: SweepPoint[];
  expansionJoints: SweepPoint[];
}

function constructionGrid(sw: StandSweep, frame: SweepFrame, treads: Tread[]): ConstructionGrid {
  const empty = { unitJoints: [], expansionJoints: [] };
  if (treads.length === 0) return empty;
  const line = frame.line(treads[Math.floor(treads.length / 2)].seg, 0.5);
  if (line.total < PRECAST_UNIT_M) return empty;
  // Expansion blocks of equal length; a ring closes on itself, an open stand keeps its two ends.
  const blocks = Math.max(1, Math.round(line.total / EXPANSION_BLOCK_M));
  const blockLen = line.total / blocks;
  const unitsPerBlock = Math.max(1, Math.round(blockLen / PRECAST_UNIT_M));
  const unitJoints: SweepPoint[] = [];
  const expansionJoints: SweepPoint[] = [];
  for (let b = 0; b < blocks; b++) {
    const start = b * blockLen;
    if (b > 0 || sw.closed) expansionJoints.push(line.at(start));
    for (let u = 1; u < unitsPerBlock; u++) unitJoints.push(line.at(start + (u / unitsPerBlock) * blockLen));
  }
  return { unitJoints, expansionJoints };
}

/** Whether a slice position falls in one of the stand's radial aisles (`half`: share of the stand). */
function inAisle(sw: StandSweep, at: SweepPoint, half: number): boolean {
  if (sw.aisleCount <= 0) return false;
  const u = (at.s + at.f) / Math.max(1, sw.activeSegments);
  return Array.from({ length: sw.aisleCount }, (_, k) => (k + 0.5) / sw.aisleCount).some((a) => Math.abs(a - u) < half);
}

/** Rough length of the stand along its middle (m), to turn an aisle width into a share of it. */
function frameLengthHint(sw: StandSweep): number {
  const mid = Math.floor(sw.profilePtsPerSlice[0].length / 2);
  let total = 0;
  for (let s = 0; s < sw.activeSegments; s++) {
    const n = sw.closed ? (s + 1) % sw.ringCount : s + 1;
    const [d0, y0] = sw.profilePtsPerSlice[s][mid];
    const [d1, y1] = sw.profilePtsPerSlice[n][mid];
    total += new THREE.Vector3(...sw.sampleWorldPoint(s, d0, y0)).distanceTo(new THREE.Vector3(...sw.sampleWorldPoint(n, d1, y1)));
  }
  return total;
}

/**
 * A4: joints between the precast units, across each tread and up its riser, and the expansion
 * joints: a wider gap under a steel cover plate, across every row of the stand.
 */
function buildPrecastJoints(sw: StandSweep, frame: SweepFrame, treads: Tread[], grid: ConstructionGrid, mats: DetailMaterials): THREE.Object3D[] {
  const joints = new QuadBatch();
  const gaps = new QuadBatch();
  const covers = new QuadBatch();
  const strip = (batch: QuadBatch, tr: Tread, at: SweepPoint, half: number, lift: number) => {
    const { x, z } = frame.axes(at, tr.seg, 0.5);
    const w = x.multiplyScalar(half);
    const front = frame.point(at, tr.seg, 0, lift);
    const rear = frame.point(at, tr.seg, 1, lift);
    batch.add(front.clone().sub(w), front.clone().add(w), rear.clone().add(w), rear.clone().sub(w), UP);
    const foot = frame.point(at, tr.seg, 1, 0, -lift);
    const head = foot.clone().setY(foot.y + riseOf(sw, at, tr.riserSeg));
    batch.add(foot.clone().sub(w), foot.clone().add(w), head.clone().add(w), head.clone().sub(w), z.negate());
  };
  const aisleHalf = (sw.aisleWidth * 0.6) / Math.max(1, frameLengthHint(sw));
  const units = grid.unitJoints.filter((at) => !inAisle(sw, at, aisleHalf));
  for (const tr of treads) {
    if (tr.riserSeg < 0) continue;
    for (const at of units) {
      if (frame.hole(at, tr.seg)) continue;
      strip(joints, tr, at, 0.012, 0.008);
    }
    for (const at of grid.expansionJoints) {
      if (frame.hole(at, tr.seg)) continue;
      strip(gaps, tr, at, EXPANSION_GAP_M / 2, 0.008);
      strip(covers, tr, at, EXPANSION_COVER_M / 2, 0.014);
    }
  }
  const out: THREE.Object3D[] = [];
  const j = joints.build('PrecastJoints', mats.joint);
  if (j) out.push(j);
  const g = gaps.build('ExpansionJointGaps', mats.gap);
  if (g) out.push(g);
  const c = covers.build('ExpansionJointCovers', mats.steel);
  if (c) out.push(c);
  return out;
}

/** B5: downstand beams and recessed lights under every cantilevered tier. */
function buildSoffits(sw: StandSweep, frame: SweepFrame, grid: ConstructionGrid, mats: DetailMaterials): THREE.Object3D[] {
  const pts0 = sw.profilePtsPerSlice[0];
  const beams = new BoxBatch();
  const lights = new BoxBatch();
  for (let seg = 0; seg < pts0.length - 1; seg++) {
    if (sw.isSeatSegmentMask[seg]) continue;
    const [d0, y0] = pts0[seg];
    const [d1, y1] = pts0[seg + 1];
    // A soffit runs level from the loggia's back wall out toward the pitch.
    if (Math.abs(y1 - y0) > 0.02 || d0 - d1 < 0.8) continue;
    const span = d0 - d1;
    const beamH = THREE.MathUtils.clamp(span * 0.09, 0.3, 0.6);
    const line = frame.line(seg, 1);
    const count = Math.max(2, Math.round(line.total / SOFFIT_BEAM_SPACING));
    const step = line.total / count;
    for (let k = 0; k <= count; k++) {
      const at = line.at(k * step);
      const { x, z } = frame.axes(at, seg, 0.5);
      // From the back wall to just short of the fascia, its top against the soffit.
      beams.add(frame.point(at, seg, 0.52, -beamH / 2), x, z, 0.32, beamH, span * 0.92);
      if (k === count) continue;
      for (const t of span > 3 ? [0.3, 0.7] : [0.5]) {
        for (const off of [0.25, 0.5, 0.75]) {
          const la = line.at((k + off) * step);
          const ax = frame.axes(la, seg, t);
          lights.add(frame.point(la, seg, t, -0.02), ax.x, ax.z, 1.2, 0.04, 0.2);
        }
      }
    }
    // Two blocks meet at an expansion joint: each ends on a beam of its own.
    for (const at of grid.expansionJoints) {
      const { x, z } = frame.axes(at, seg, 0.5);
      for (const side of [-1, 1]) {
        const c = frame.point(at, seg, 0.52, -beamH / 2).addScaledVector(x, side * (EXPANSION_GAP_M / 2 + 0.2));
        beams.add(c, x, z, 0.32, beamH, span * 0.92);
      }
    }
  }
  const out: THREE.Object3D[] = [];
  const b = beams.build('SoffitBeams', mats.beam, true);
  if (b) out.push(b);
  if (lights.matrices.length > 0) out.push(lights.build('SoffitLights', lightMaterial(sw.lit), false)!);
  return out;
}

/** Every construction detail of one swept stand, in its builder's frame. */
export function buildStandDetails(sw: StandSweep): THREE.Group | null {
  if (sw.activeSegments < 1 || sw.profilePtsPerSlice.length === 0) return null;
  const frame = new SweepFrame(sw);
  const treads = listTreads(sw);
  const mats = materials();
  const grid = constructionGrid(sw, frame, treads);
  const parts = [
    ...buildAisleStairs(sw, frame, treads, mats),
    ...buildTierFrontBalustrades(sw, frame, treads, grid, mats),
    ...buildPrecastJoints(sw, frame, treads, grid, mats),
    ...buildSoffits(sw, frame, grid, mats),
  ];
  if (parts.length === 0) return null;
  const group = new THREE.Group();
  group.name = 'StandDetails';
  group.add(...parts);
  return group;
}

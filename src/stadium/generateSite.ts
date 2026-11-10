import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createSiteGroundGeometry } from './generatePitch';
import { createPlazaDetailNormalAndRoughness } from './materials';
import { setFarDetail } from './meshKit';
import {
  DEFAULT_STADIUM_MATERIALS,
  LightingMode,
  PlazaMaterialId,
  resolveSite,
  SiteConfig,
  SiteSetting,
  StadiumDocument,
} from './schema';

/** Side of the square site in metres; its edge dissolves in the scene fog. */
const SITE_SIZE = 1400;
const HALF_SITE = SITE_SIZE / 2;
const GROUND_TEX_PX = 2048;

/** Outer facade of the built stadium, approximated by `|x/halfX|^n + |z/halfZ|^n = 1`. */
export interface SiteFootprint {
  halfX: number;
  halfZ: number;
  exponent: number;
}

/** Depth of the paved forecourt between the facade and the surroundings, per setting. */
const FORECOURT_DEPTH: Record<SiteSetting, number> = {
  none: 30,
  // English grounds: a pavement, then the street of terraced houses right against the stands.
  urban: 5,
  esplanade: 48,
  park: 24,
  parking: 22,
};

/** Width of the gap a gate opens in the fence, and of the clear approach kept in front of it. */
const GATE_WIDTH = 18;

const PLAZA_COLOR: Record<PlazaMaterialId, string> = {
  granite_pavers: '#9c9e9d',
  sandstone_esplanade: '#cdbfa6',
  urban_asphalt: '#56595d',
};

interface Pt {
  x: number;
  z: number;
}

/** Deterministic generator so the surroundings stay identical across rebuilds. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// Footprint ring
// ---------------------------------------------------------------------------------------------

function ringPoint(fp: SiteFootprint, theta: number, offset: number): Pt {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const e = 2 / fp.exponent;
  return {
    x: Math.sign(c) * Math.pow(Math.abs(c), e) * (fp.halfX + offset),
    z: Math.sign(s) * Math.pow(Math.abs(s), e) * (fp.halfZ + offset),
  };
}

function ringNormal(fp: SiteFootprint, theta: number, offset: number): Pt {
  const a = ringPoint(fp, theta - 0.002, offset);
  const b = ringPoint(fp, theta + 0.002, offset);
  const tx = b.x - a.x;
  const tz = b.z - a.z;
  const len = Math.hypot(tx, tz) || 1;
  return { x: tz / len, z: -tx / len };
}

/** Below 1 inside the ring drawn `offset` m outside the facade, above 1 outside it. */
function ringLevel(fp: SiteFootprint, x: number, z: number, offset: number): number {
  return (
    Math.pow(Math.abs(x) / (fp.halfX + offset), fp.exponent) +
    Math.pow(Math.abs(z) / (fp.halfZ + offset), fp.exponent)
  );
}

/** Points about every `step` m along the ring at `offset`, with their ring parameter. */
function sampleRing(fp: SiteFootprint, offset: number, step: number): { p: Pt; theta: number }[] {
  const dense = 1440;
  const pts: Pt[] = [];
  const cum: number[] = [0];
  for (let i = 0; i <= dense; i++) {
    pts.push(ringPoint(fp, (i / dense) * Math.PI * 2, offset));
    if (i > 0) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  const total = cum[dense];
  const count = Math.max(8, Math.round(total / step));
  const out: { p: Pt; theta: number }[] = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (j < dense - 1 && cum[j + 1] < target) j++;
    const f = (target - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]);
    const theta = ((j + f) / dense) * Math.PI * 2;
    out.push({ p: ringPoint(fp, theta, offset), theta });
  }
  return out;
}

/** Entrance gates: the four stadium axes, plus the diagonals once the perimeter is long. */
function gateThetas(fp: SiteFootprint): number[] {
  const axes = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
  if (fp.halfX + fp.halfZ < 150) return axes;
  return [...axes, Math.PI / 4, (Math.PI * 3) / 4, (Math.PI * 5) / 4, (Math.PI * 7) / 4];
}

// ---------------------------------------------------------------------------------------------
// Layout shared by the painted ground and the 3D dressing
// ---------------------------------------------------------------------------------------------

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Capsule kept clear of trees (paths, avenues, roads). */
interface Corridor {
  a: Pt;
  b: Pt;
  r: number;
}

interface TreeSpot {
  x: number;
  z: number;
  s: number;
  conifer: boolean;
}

interface CarSpot {
  x: number;
  z: number;
  yaw: number;
}

interface SiteLayout {
  forecourt: number;
  gates: { p: Pt; n: Pt; label: string }[];
  corridors: Corridor[];
  blocks: (Rect & { green: boolean })[];
  lots: Rect[];
  pond: { c: Pt; rx: number; rz: number } | null;
  trees: TreeSpot[];
  lamps: Pt[];
  cars: CarSpot[];
  /** Ring offsets of roads that circle the stadium, with their width. */
  ringRoads: { offset: number; width: number }[];
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

function inCorridor(layout: SiteLayout, p: Pt, pad = 0): boolean {
  return layout.corridors.some((c) => distToSegment(p, c.a, c.b) < c.r + pad);
}

function inRect(r: Rect, p: Pt, pad = 0): boolean {
  return p.x > r.x0 - pad && p.x < r.x1 + pad && p.z > r.z0 - pad && p.z < r.z1 + pad;
}

function nearRingRoad(layout: SiteLayout, fp: SiteFootprint, p: Pt): boolean {
  return layout.ringRoads.some(
    (road) =>
      ringLevel(fp, p.x, p.z, road.offset + road.width / 2 + 2) < 1 &&
      ringLevel(fp, p.x, p.z, road.offset - road.width / 2 - 2) > 1
  );
}

function insideSite(p: Pt, margin = 20): boolean {
  return Math.abs(p.x) < HALF_SITE - margin && Math.abs(p.z) < HALF_SITE - margin;
}

function planSite(fp: SiteFootprint, site: SiteConfig): SiteLayout {
  const rand = seededRandom(0x5eed + site.setting.length * 977);
  const F = FORECOURT_DEPTH[site.setting];
  const layout: SiteLayout = {
    forecourt: F,
    gates: gateThetas(fp).map((theta, i) => ({
      p: ringPoint(fp, theta, F),
      n: ringNormal(fp, theta, F),
      label: String.fromCharCode(65 + i),
    })),
    corridors: [],
    blocks: [],
    lots: [],
    pond: null,
    trees: [],
    lamps: [],
    cars: [],
    ringRoads: [],
  };

  // Every gate keeps a clear approach straight out from the fence.
  for (const g of layout.gates) {
    layout.corridors.push({
      a: { x: g.p.x - g.n.x * 6, z: g.p.z - g.n.z * 6 },
      b: { x: g.p.x + g.n.x * 30, z: g.p.z + g.n.z * 30 },
      r: GATE_WIDTH / 2,
    });
  }
  const nearGate = (p: Pt, r: number) => layout.gates.some((g) => Math.hypot(p.x - g.p.x, p.z - g.p.z) < r);

  // Bare site: forecourt and lawn only, nothing built or planted around the stadium.
  if (site.setting === 'none') return layout;

  // Forecourt edge lighting columns, every ~24 m.
  for (const { p } of sampleRing(fp, F - 2.5, 24)) {
    if (!nearGate(p, GATE_WIDTH * 0.6)) layout.lamps.push(p);
  }

  const tree = (x: number, z: number, s: number, conifer = false) => layout.trees.push({ x, z, s, conifer });

  switch (site.setting) {
    case 'urban': {
      // A narrow street runs round the ground; the houses' front doors open straight onto it.
      const streetW = 9;
      const frontage = F + streetW + 1;
      layout.ringRoads.push({ offset: F + streetW / 2, width: streetW });
      for (const { p } of sampleRing(fp, F + streetW + 0.5, 30)) layout.lamps.push(p);

      // European perimeter blocks on a street grid, cleared around the stadium.
      const pitch = 92;
      const street = 16;
      const n = Math.ceil(HALF_SITE / pitch);
      for (let i = -n; i < n; i++) {
        for (let j = -n; j < n; j++) {
          const r: Rect = {
            x0: i * pitch + street / 2,
            x1: (i + 1) * pitch - street / 2,
            z0: j * pitch + street / 2,
            z1: (j + 1) * pitch - street / 2,
          };
          if (!insideSite({ x: r.x0, z: r.z0 }, 10) || !insideSite({ x: r.x1, z: r.z1 }, 10)) continue;
          const probes: Pt[] = [];
          for (const fx of [0, 0.5, 1]) {
            for (const fz of [0, 0.5, 1]) {
              probes.push({ x: r.x0 + (r.x1 - r.x0) * fx, z: r.z0 + (r.z1 - r.z0) * fz });
            }
          }
          // Blocks reaching the stadium are cut back to the street rather than dropped, so the
          // terraces line it closely. Nothing is built across a gate's approach.
          const clear = (q: Rect) =>
            [0, 0.25, 0.5, 0.75, 1].every((fx) =>
              [0, 0.25, 0.5, 0.75, 1].every((fz) => {
                const p = { x: q.x0 + (q.x1 - q.x0) * fx, z: q.z0 + (q.z1 - q.z0) * fz };
                return ringLevel(fp, p.x, p.z, frontage) >= 1 && !inCorridor(layout, p, 3);
              })
            );
          const cut = { ...r };
          for (let k = 0; k < 16 && !clear(cut); k++) {
            const cx = (cut.x0 + cut.x1) / 2;
            const cz = (cut.z0 + cut.z1) / 2;
            // Trim the face that looks at the stadium, along the axis the block is closer on.
            if (Math.abs(cx) / (fp.halfX + frontage) >= Math.abs(cz) / (fp.halfZ + frontage)) {
              if (cx > 0) cut.x0 += 6;
              else cut.x1 -= 6;
            } else if (cz > 0) cut.z0 += 6;
            else cut.z1 -= 6;
          }
          if (!clear(cut) || cut.x1 - cut.x0 < 26 || cut.z1 - cut.z0 < 26) continue;
          layout.blocks.push({ ...cut, green: rand() < 0.09 });
        }
      }

      // Street trees on every other avenue, and parked cars along the kerbs.
      for (let i = -n; i <= n; i++) {
        const line = i * pitch;
        for (let t = -HALF_SITE + 30; t < HALF_SITE - 30; t += 12) {
          for (const side of [-1, 1]) {
            const spots: [Pt, number][] = [
              [{ x: line + side * 6.2, z: t }, 0],
              [{ x: t, z: line + side * 6.2 }, Math.PI / 2],
            ];
            for (const [p, yaw] of spots) {
              if (ringLevel(fp, p.x, p.z, F + 12) < 1) continue;
              if (i % 2 === 0 && rand() < 0.85) tree(p.x, p.z, 0.75 + rand() * 0.25);
              const lane = { x: p.x - (yaw === 0 ? side * 2.4 : 0), z: p.z - (yaw === 0 ? 0 : side * 2.4) };
              if (rand() < 0.35) layout.cars.push({ x: lane.x, z: lane.z, yaw: yaw + (rand() < 0.5 ? 0 : Math.PI) });
            }
          }
        }
      }
      for (const b of layout.blocks) {
        if (!b.green) continue;
        for (let k = 0; k < 14; k++) {
          tree(b.x0 + 6 + rand() * (b.x1 - b.x0 - 12), b.z0 + 6 + rand() * (b.z1 - b.z0 - 12), 0.9 + rand() * 0.5);
        }
      }
      break;
    }

    case 'esplanade': {
      layout.ringRoads.push({ offset: F + 78, width: 14 });
      // Four axial promenades running from the forecourt to the edge of the site.
      for (const g of layout.gates.slice(0, 4)) {
        layout.corridors.push({ a: g.p, b: { x: g.n.x * HALF_SITE * 1.5, z: g.n.z * HALF_SITE * 1.5 }, r: 17 });
        for (let d = 8; d < HALF_SITE * 1.5; d += 10) {
          for (const side of [-1, 1]) {
            const p = { x: g.p.x + g.n.x * d - g.n.z * side * 14, z: g.p.z + g.n.z * d + g.n.x * side * 14 };
            if (insideSite(p) && !nearRingRoad(layout, fp, p)) tree(p.x, p.z, 0.85);
          }
          if (d % 30 === 8) {
            for (const side of [-1, 1]) {
              const p = { x: g.p.x + g.n.x * d - g.n.z * side * 10, z: g.p.z + g.n.z * d + g.n.x * side * 10 };
              if (insideSite(p)) layout.lamps.push(p);
            }
          }
        }
      }
      // Clipped alignments on the plaza itself.
      for (const off of [F * 0.42, F * 0.72]) {
        for (const { p } of sampleRing(fp, off, 10)) {
          if (!nearGate(ringPointNear(fp, p, F), GATE_WIDTH * 1.1)) tree(p.x, p.z, 0.72);
        }
      }
      scatterTrees(layout, fp, rand, F + 92, 1400, 0.55);
      break;
    }

    case 'park': {
      // Winding paths from every gate, plus a promenade loop through the woods.
      for (const g of layout.gates) {
        let prev = g.p;
        const phase = rand() * Math.PI * 2;
        for (let d = 12; d < HALF_SITE * 1.5; d += 12) {
          const wiggle = Math.sin(d / 45 + phase) * 14;
          const next = {
            x: g.p.x + g.n.x * d - g.n.z * wiggle,
            z: g.p.z + g.n.z * d + g.n.x * wiggle,
          };
          layout.corridors.push({ a: prev, b: next, r: 4.5 });
          prev = next;
          if (!insideSite(next, -40)) break;
        }
      }
      const loop = sampleRing(fp, F + 70, 12);
      loop.forEach(({ p }, i) => {
        layout.corridors.push({ a: p, b: loop[(i + 1) % loop.length].p, r: 4.5 });
        if (i % 3 === 0) layout.lamps.push({ x: p.x, z: p.z });
      });
      const pondAt = ringPoint(fp, Math.PI * 0.62, F + 150);
      layout.pond = { c: pondAt, rx: 46, rz: 30 };
      scatterTrees(layout, fp, rand, F + 6, 14000, 0.1);
      break;
    }

    case 'parking': {
      layout.ringRoads.push({ offset: F + 8, width: 13 });
      // Pedestrian avenues on the axes, kept free of cars.
      for (const g of layout.gates.slice(0, 4)) {
        layout.corridors.push({ a: g.p, b: { x: g.n.x * HALF_SITE * 1.5, z: g.n.z * HALF_SITE * 1.5 }, r: 12 });
      }
      const lotW = 62;
      const lotD = 37;
      for (let i = -12; i < 12; i++) {
        for (let j = -16; j < 16; j++) {
          const cx = (i + 0.5) * (lotW + 8);
          const cz = (j + 0.5) * (lotD + 9);
          const r: Rect = { x0: cx - lotW / 2, x1: cx + lotW / 2, z0: cz - lotD / 2, z1: cz + lotD / 2 };
          const corners: Pt[] = [
            { x: r.x0, z: r.z0 },
            { x: r.x1, z: r.z0 },
            { x: r.x0, z: r.z1 },
            { x: r.x1, z: r.z1 },
          ];
          if (corners.some((p) => ringLevel(fp, p.x, p.z, F + 17) < 1)) continue;
          if (ringLevel(fp, cx, cz, F + 230) > 1 || !insideSite({ x: cx, z: cz }, 50)) continue;
          if (corners.some((p) => inCorridor(layout, p)) || inCorridor(layout, { x: cx, z: cz })) continue;
          layout.lots.push(r);
        }
      }
      for (const lot of layout.lots) {
        const cz = (lot.z0 + lot.z1) / 2;
        for (let x = lot.x0 + 1.3; x < lot.x1 - 1.3; x += 2.6) {
          for (const [rowZ, yaw] of [
            [lot.z0 + 3.5, 0],
            [cz - 3, Math.PI],
            [cz + 3, 0],
            [lot.z1 - 3.5, Math.PI],
          ] as const) {
            if (rand() < 0.72) layout.cars.push({ x: x + 1.3, z: rowZ, yaw: yaw + Math.PI / 2 });
          }
        }
        for (let x = lot.x0 + 6; x < lot.x1 - 3; x += 12) tree(x, cz, 0.62);
        layout.lamps.push({ x: (lot.x0 + lot.x1) / 2 + 0.5, z: cz });
      }
      scatterTrees(layout, fp, rand, F + 240, 900, 0.5);
      break;
    }
  }

  return layout;
}

/** The point of the ring at `offset` closest in direction to `p` (for gate proximity tests). */
function ringPointNear(fp: SiteFootprint, p: Pt, offset: number): Pt {
  const theta = Math.atan2(p.z / fp.halfZ, p.x / fp.halfX);
  return ringPoint(fp, theta, offset);
}

/**
 * Natural groves: trees fall where a low-frequency field is high, so the land reads as clumps and
 * clearings instead of an even sprinkle. Paths, roads, the pond, lots and blocks stay clear.
 */
function scatterTrees(
  layout: SiteLayout,
  fp: SiteFootprint,
  rand: () => number,
  minOffset: number,
  attempts: number,
  threshold: number
): void {
  for (let k = 0; k < attempts; k++) {
    const p = { x: (rand() * 2 - 1) * (HALF_SITE - 15), z: (rand() * 2 - 1) * (HALF_SITE - 15) };
    if (ringLevel(fp, p.x, p.z, minOffset) < 1) continue;
    const field =
      0.5 +
      0.28 * Math.sin(p.x / 61 + 1.3) * Math.cos(p.z / 47 - 0.4) +
      0.22 * Math.sin((p.x + p.z) / 29);
    if (field < threshold + rand() * 0.25) continue;
    if (inCorridor(layout, p, 2) || nearRingRoad(layout, fp, p)) continue;
    if (layout.pond && ((p.x - layout.pond.c.x) / (layout.pond.rx + 4)) ** 2 + ((p.z - layout.pond.c.z) / (layout.pond.rz + 4)) ** 2 < 1) continue;
    if (layout.lots.some((r) => inRect(r, p, 3)) || layout.blocks.some((r) => inRect(r, p, 3))) continue;
    layout.trees.push({ x: p.x, z: p.z, s: 0.8 + rand() * 0.6, conifer: rand() < 0.18 });
  }
}

// ---------------------------------------------------------------------------------------------
// Painted ground
// ---------------------------------------------------------------------------------------------

function traceRing(ctx: CanvasRenderingContext2D, fp: SiteFootprint, offset: number): void {
  const steps = 240;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const p = ringPoint(fp, (i / steps) * Math.PI * 2, offset);
    if (i === 0) ctx.moveTo(p.x, p.z);
    else ctx.lineTo(p.x, p.z);
  }
  ctx.closePath();
}

function strokeCorridor(ctx: CanvasRenderingContext2D, c: Corridor, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(c.a.x, c.a.z);
  ctx.lineTo(c.b.x, c.b.z);
  ctx.stroke();
}

/**
 * Paints the whole site in world metres (canvas x = world x, canvas y = world z), matching the
 * normalized UVs of the site ground geometry.
 */
function paintSiteGround(
  fp: SiteFootprint,
  site: SiteConfig,
  layout: SiteLayout,
  plaza: PlazaMaterialId,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = GROUND_TEX_PX;
  canvas.height = GROUND_TEX_PX;
  const ctx = canvas.getContext('2d')!;
  const k = GROUND_TEX_PX / SITE_SIZE;
  ctx.save();
  ctx.scale(k, k);
  ctx.translate(HALF_SITE, HALF_SITE);

  const grass = '#5b7340';
  const asphalt = '#3d4044';
  const gravel = '#c4b89e';
  const sidewalk = '#9a958c';
  const plazaColor = PLAZA_COLOR[plaza];
  const rand = seededRandom(91);

  const base: Record<SiteSetting, string> = {
    none: grass,
    urban: asphalt,
    esplanade: grass,
    park: grass,
    parking: grass,
  };
  ctx.fillStyle = base[site.setting];
  ctx.fillRect(-HALF_SITE, -HALF_SITE, SITE_SIZE, SITE_SIZE);

  // Mottling so lawns and asphalt are never a flat colour.
  for (let i = 0; i < 9000; i++) {
    const x = (rand() * 2 - 1) * HALF_SITE;
    const z = (rand() * 2 - 1) * HALF_SITE;
    const r = 2 + rand() * 9;
    ctx.fillStyle =
      site.setting === 'urban'
        ? `rgba(${rand() < 0.5 ? '255,255,255' : '0,0,0'},0.035)`
        : rand() < 0.5
          ? 'rgba(120,140,60,0.10)'
          : 'rgba(30,50,25,0.10)';
    ctx.beginPath();
    ctx.ellipse(x, z, r, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (site.setting === 'urban') {
    for (const b of layout.blocks) {
      ctx.fillStyle = sidewalk;
      ctx.fillRect(b.x0 - 3, b.z0 - 3, b.x1 - b.x0 + 6, b.z1 - b.z0 + 6);
      ctx.fillStyle = b.green ? grass : '#6f7457';
      ctx.fillRect(b.x0 + 15, b.z0 + 15, b.x1 - b.x0 - 30, b.z1 - b.z0 - 30);
      if (b.green) ctx.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
    }
    // Lane markings down the middle of every street.
    ctx.strokeStyle = 'rgba(235,235,225,0.55)';
    ctx.lineWidth = 0.25;
    ctx.setLineDash([3, 5]);
    for (let i = -8; i <= 8; i++) {
      const line = i * 92;
      ctx.beginPath();
      ctx.moveTo(line, -HALF_SITE);
      ctx.lineTo(line, HALF_SITE);
      ctx.moveTo(-HALF_SITE, line);
      ctx.lineTo(HALF_SITE, line);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  if (site.setting === 'esplanade') {
    for (const c of layout.corridors) strokeCorridor(ctx, c, plazaColor, c.r * 2);
  }

  if (site.setting === 'park') {
    if (layout.pond) {
      const { c, rx, rz } = layout.pond;
      ctx.fillStyle = '#7d8a5c';
      ctx.beginPath();
      ctx.ellipse(c.x, c.z, rx + 3, rz + 3, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#35505a';
      ctx.beginPath();
      ctx.ellipse(c.x, c.z, rx, rz, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const c of layout.corridors) strokeCorridor(ctx, c, gravel, 5);
  }

  if (site.setting === 'parking') {
    for (const c of layout.corridors) strokeCorridor(ctx, c, plazaColor, c.r * 2);
    for (const lot of layout.lots) {
      ctx.fillStyle = '#9b978d';
      ctx.fillRect(lot.x0 - 1.5, lot.z0 - 1.5, lot.x1 - lot.x0 + 3, lot.z1 - lot.z0 + 3);
      ctx.fillStyle = asphalt;
      ctx.fillRect(lot.x0, lot.z0, lot.x1 - lot.x0, lot.z1 - lot.z0);
      const cz = (lot.z0 + lot.z1) / 2;
      ctx.fillStyle = '#62764a';
      ctx.fillRect(lot.x0 + 2, cz - 0.9, lot.x1 - lot.x0 - 4, 1.8);
    }
    // Access roads between the rows of lots.
    ctx.strokeStyle = asphalt;
    ctx.lineWidth = 8;
    const zs = new Set(layout.lots.map((l) => Math.round(l.z1 + 4.5)));
    for (const z of zs) {
      ctx.beginPath();
      ctx.moveTo(-HALF_SITE, z);
      ctx.lineTo(HALF_SITE, z);
      ctx.stroke();
    }
  }

  // Ring roads with kerbs and a dashed centre line.
  for (const road of layout.ringRoads) {
    ctx.strokeStyle = sidewalk;
    ctx.lineWidth = road.width + 6;
    traceRing(ctx, fp, road.offset);
    ctx.stroke();
    ctx.strokeStyle = asphalt;
    ctx.lineWidth = road.width;
    traceRing(ctx, fp, road.offset);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(240,240,230,0.7)';
    ctx.lineWidth = 0.3;
    ctx.setLineDash([4, 6]);
    traceRing(ctx, fp, road.offset);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Forecourt last, so it sits over everything up to the facade.
  ctx.fillStyle = plazaColor;
  traceRing(ctx, fp, layout.forecourt);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 0.8;
  traceRing(ctx, fp, layout.forecourt);
  ctx.stroke();

  ctx.restore();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/** Paved band from under the facade to the forecourt edge, with real-size slab relief. */
function buildForecourt(
  fp: SiteFootprint,
  depth: number,
  plaza: PlazaMaterialId,
  maxAnisotropy: number
): THREE.Mesh {
  const steps = 360;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    for (const off of [-4, depth]) {
      const p = ringPoint(fp, theta, off);
      pos.push(p.x, 0, p.z);
      uv.push(p.x / 3.2, p.z / 3.2);
    }
    if (i < steps) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const detail = createPlazaDetailNormalAndRoughness(plaza, maxAnisotropy);
  const mat = new THREE.MeshStandardMaterial({
    color: PLAZA_COLOR[plaza],
    normalMap: detail.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: detail.roughnessMap,
    roughness: 0.85,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'SiteForecourt';
  mesh.position.y = 0.02;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// Vegetation, lighting columns, cars
// ---------------------------------------------------------------------------------------------

/**
 * A broadleaf crown: a few noisy lobes, smoothed into one blob. Detail 1 (80 faces a lobe) for
 * close views; detail 0 (20 faces a lobe) is the far level, where thousands of crowns are a few
 * pixels each.
 */
function createBroadleafCrownGeometry(detail: 0 | 1): THREE.BufferGeometry {
  const lobes: [number, number, number, number][] = [
    [0, 0, 0, 1],
    [0.55, -0.12, 0.3, 0.72],
    [-0.5, 0.05, -0.35, 0.78],
    [0.1, 0.48, -0.1, 0.7],
    [-0.2, -0.2, 0.55, 0.66],
  ];
  const parts = lobes.map(([x, y, z, r], li) => {
    const g = new THREE.IcosahedronGeometry(r, detail);
    g.deleteAttribute('uv');
    // Detail 0 comes with flat normals, which would keep the lobes' corners from welding below.
    g.deleteAttribute('normal');
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      // Noise from the vertex position, so the copies of a shared corner move together and the
      // merged crown stays watertight with smooth normals.
      const px = p.getX(i);
      const py = p.getY(i);
      const pz = p.getZ(i);
      const n = Math.sin(px * 7.1 + li * 1.7) * Math.cos(py * 6.3 - li) * Math.sin(pz * 5.7 + li * 0.5);
      const jitter = 0.9 + n * 0.14;
      p.setXYZ(i, px * jitter + x, py * jitter + y, pz * jitter + z);
    }
    return g;
  });
  const merged = mergeVertices(mergeGeometries(parts)!, 0.001);
  merged.computeVertexNormals();
  return merged;
}

function buildTrees(trees: TreeSpot[], lighting: LightingMode): THREE.Group {
  const group = new THREE.Group();
  group.name = 'SiteTrees';
  if (trees.length === 0) return group;

  const rand = seededRandom(23);
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 1, 6);
  trunkGeo.translate(0, 0.5, 0);
  const broadGeo = createBroadleafCrownGeometry(1);
  const coneGeo = new THREE.ConeGeometry(1, 2.6, 9);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4f3d2e, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });

  const broad = trees.filter((t) => !t.conifer);
  const conifers = trees.filter((t) => t.conifer);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
  const broadMesh = new THREE.InstancedMesh(broadGeo, leafMat, Math.max(1, broad.length));
  const coneMesh = new THREE.InstancedMesh(coneGeo, leafMat, Math.max(1, conifers.length));
  broadMesh.count = broad.length;
  setFarDetail(broadMesh, createBroadleafCrownGeometry(0));
  coneMesh.count = conifers.length;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();
  const light = lighting === 'night' ? 0.6 : lighting === 'dusk' ? 0.8 : 1;
  let bi = 0;
  let ci = 0;
  trees.forEach((t, i) => {
    const yaw = rand() * Math.PI * 2;
    q.setFromAxisAngle(up, yaw);
    const trunkH = (t.conifer ? 2.2 : 3.4) * t.s;
    m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s, trunkH, t.s));
    trunks.setMatrixAt(i, m);
    if (t.conifer) {
      const r = 2.1 * t.s;
      m.compose(new THREE.Vector3(t.x, trunkH + r * 1.2, t.z), q, new THREE.Vector3(r, r * 1.05, r));
      coneMesh.setMatrixAt(ci, m);
      color.setHSL(0.36 + rand() * 0.04, 0.32, (0.17 + rand() * 0.05) * light);
      coneMesh.setColorAt(ci++, color);
    } else {
      const r = 3.1 * t.s;
      m.compose(
        new THREE.Vector3(t.x, trunkH + r * 0.62, t.z),
        q,
        new THREE.Vector3(r * (0.92 + rand() * 0.16), r * (0.8 + rand() * 0.14), r * (0.92 + rand() * 0.16))
      );
      broadMesh.setMatrixAt(bi, m);
      color.setHSL(0.22 + rand() * 0.1, 0.38 + rand() * 0.14, (0.24 + rand() * 0.1) * light);
      broadMesh.setColorAt(bi++, color);
    }
  });
  for (const mesh of [trunks, broadMesh, coneMesh]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }
  group.add(trunks, broadMesh, coneMesh);
  return group;
}

function buildLamps(lamps: Pt[], lighting: LightingMode): THREE.Group {
  const group = new THREE.Group();
  group.name = 'SiteLamps';
  if (lamps.length === 0) return group;
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.13, 7, 8);
  poleGeo.translate(0, 3.5, 0);
  const headGeo = new THREE.BoxGeometry(0.9, 0.16, 0.36);
  headGeo.translate(0, 7.05, 0);
  const lit = lighting !== 'day';
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.4, metalness: 0.8 });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xe7e5e4,
    emissive: new THREE.Color(0xffd79a),
    emissiveIntensity: lit ? 3 : 0,
    roughness: 0.3,
  });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lamps.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, lamps.length);
  const m = new THREE.Matrix4();
  lamps.forEach((p, i) => {
    m.makeRotationY(Math.atan2(p.x, p.z));
    m.setPosition(p.x, 0, p.z);
    poles.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
  });
  for (const mesh of [poles, heads]) {
    mesh.castShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }
  group.add(poles, heads);
  return group;
}

const CAR_COLORS = [0xf8fafc, 0x1f2937, 0x9ca3af, 0x6b7280, 0x0f172a, 0x991b1b, 0x1e3a8a, 0xd1d5db, 0x374151, 0x166534];

function buildCars(cars: CarSpot[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'SiteCars';
  if (cars.length === 0) return group;
  const rand = seededRandom(5);
  const bodyGeo = new THREE.BoxGeometry(4.3, 0.75, 1.8);
  bodyGeo.translate(0, 0.62, 0);
  const cabinGeo = new THREE.BoxGeometry(2.3, 0.62, 1.6);
  cabinGeo.translate(-0.25, 1.3, 0);
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.5, clearcoat: 0.8 });
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.12, metalness: 0.6 });
  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, cars.length);
  const cabins = new THREE.InstancedMesh(cabinGeo, cabinMat, cars.length);
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  cars.forEach((c, i) => {
    m.makeRotationY(c.yaw);
    m.setPosition(c.x, 0, c.z);
    bodies.setMatrixAt(i, m);
    cabins.setMatrixAt(i, m);
    bodies.setColorAt(i, color.setHex(CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)]));
  });
  for (const mesh of [bodies, cabins]) {
    mesh.castShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }
  group.add(bodies, cabins);
  return group;
}

/** White bay lines of every parking lot. */
function buildParkingMarkings(lots: Rect[]): THREE.InstancedMesh | null {
  const spots: Pt[] = [];
  for (const lot of lots) {
    const cz = (lot.z0 + lot.z1) / 2;
    for (let x = lot.x0 + 1.3; x <= lot.x1 - 1.3; x += 2.6) {
      for (const z of [lot.z0 + 3.5, cz - 3, cz + 3, lot.z1 - 3.5]) spots.push({ x, z });
    }
  }
  if (spots.length === 0) return null;
  const geo = new THREE.PlaneGeometry(0.12, 5);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.7 }),
    spots.length
  );
  const m = new THREE.Matrix4();
  spots.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p.x, 0.04, p.z)));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  mesh.name = 'SiteParkingMarkings';
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// City blocks
// ---------------------------------------------------------------------------------------------

const FLOOR_H = 3.2;
const BAY_W = 3.4;
/** The facade texture holds 8 bays by 8 storeys; storey 0 (the bottom row) is the shopfront. */
const FACADE_TILE = 8;
const PLASTER = ['#efe7d8', '#e6d6b8', '#d8c29f', '#f3f0ea', '#cfc5b6', '#e2cca6', '#c8b498', '#d9d4cb'];
const ROOF_TINTS = ['#a9502e', '#9a4a2c', '#b7633a', '#8d4632', '#5b5f66', '#a65a3c'];

function createFacadeTextures(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const size = 512;
  const cell = size / FACADE_TILE;
  const rand = seededRandom(31);
  const make = () => {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    return c;
  };
  const colorCanvas = make();
  const glowCanvas = make();
  const ctx = colorCanvas.getContext('2d')!;
  const glow = glowCanvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  glow.fillStyle = '#000000';
  glow.fillRect(0, 0, size, size);

  for (let row = 0; row < FACADE_TILE; row++) {
    const shop = row === FACADE_TILE - 1;
    // String course between storeys.
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, row * cell, size, 3);
    for (let col = 0; col < FACADE_TILE; col++) {
      const x = col * cell;
      const y = row * cell;
      if (shop) {
        ctx.fillStyle = '#26303a';
        ctx.fillRect(x + 4, y + 14, cell - 8, cell - 14);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x, y + 8, cell, 6);
        if (rand() < 0.8) {
          glow.fillStyle = '#ffd9a0';
          glow.fillRect(x + 4, y + 14, cell - 8, cell - 14);
        }
        continue;
      }
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(x + 17, y + 13, cell - 34, cell - 22);
      const tint = 30 + Math.floor(rand() * 30);
      ctx.fillStyle = `rgb(${tint},${tint + 8},${tint + 16})`;
      ctx.fillRect(x + 19, y + 15, cell - 38, cell - 27);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x + 31, y + 15, 2, cell - 27);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(x + 16, y + cell - 12, cell - 32, 3);
      if (rand() < 0.32) {
        glow.fillStyle = rand() < 0.7 ? '#ffcf8a' : '#cfe3ff';
        glow.fillRect(x + 19, y + 15, cell - 38, cell - 27);
      }
    }
  }
  const finish = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  return { map: finish(colorCanvas, true), emissive: finish(glowCanvas, true) };
}

class MeshBatch {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];

  /** Planar polygon (3 or 4 points, counter-clockwise seen from outside). */
  face(pts: THREE.Vector3[], uvs: [number, number][], color: THREE.Color): void {
    const tris = pts.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2];
    for (const t of tris) {
      this.pos.push(pts[t].x, pts[t].y, pts[t].z);
      this.uv.push(uvs[t][0], uvs[t][1]);
      this.col.push(color.r, color.g, color.b);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

/**
 * Perimeter blocks of 3- to 8-storey plastered buildings with tiled pitched roofs and the odd
 * flat-roofed one, around planted courtyards: the dense city fabric around an inner-city ground.
 */
function buildCityBlocks(blocks: SiteLayout['blocks'], lighting: LightingMode, fp: SiteFootprint): THREE.Group {
  const group = new THREE.Group();
  group.name = 'SiteCityBlocks';
  const rand = seededRandom(77);
  const walls = new MeshBatch();
  const roofs = new MeshBatch();
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const wallColor = new THREE.Color();
  const roofColor = new THREE.Color();

  const building = (x0: number, z0: number, x1: number, z1: number, storeys: number) => {
    const h = storeys * FLOOR_H;
    const vTop = storeys / FACADE_TILE;
    const uOff = Math.floor(rand() * FACADE_TILE) / FACADE_TILE;
    wallColor.set(PLASTER[Math.floor(rand() * PLASTER.length)]);
    const wall = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      const u1 = uOff + len / BAY_W / FACADE_TILE;
      walls.face([v(ax, 0, az), v(bx, 0, bz), v(bx, h, bz), v(ax, h, az)], [[uOff, 0], [u1, 0], [u1, vTop], [uOff, vTop]], wallColor);
    };
    // Counter-clockwise from above, so every face points outward.
    wall(x0, z1, x1, z1);
    wall(x1, z1, x1, z0);
    wall(x1, z0, x0, z0);
    wall(x0, z0, x0, z1);

    const alongX = x1 - x0 >= z1 - z0;
    const span = alongX ? z1 - z0 : x1 - x0;
    if (rand() < 0.22) {
      roofColor.set('#6b6b68');
      roofs.face([v(x0, h, z1), v(x1, h, z1), v(x1, h, z0), v(x0, h, z0)], [[0, 0], [1, 0], [1, 1], [0, 1]], roofColor);
      return;
    }
    roofColor.set(ROOF_TINTS[Math.floor(rand() * ROOF_TINTS.length)]);
    const r = Math.min(span * 0.42, 4.5);
    const e = 0.45;
    const gableUv = (n: number): [number, number] => [uOff, vTop + n];
    if (alongX) {
      const zc = (z0 + z1) / 2;
      const len = (x1 - x0) / 2.4;
      const slope = Math.hypot(span / 2 + e, r) / 1.2;
      roofs.face([v(x0 - e, h - 0.3, z1 + e), v(x1 + e, h - 0.3, z1 + e), v(x1 + e, h + r, zc), v(x0 - e, h + r, zc)], [[0, 0], [len, 0], [len, slope], [0, slope]], roofColor);
      roofs.face([v(x1 + e, h - 0.3, z0 - e), v(x0 - e, h - 0.3, z0 - e), v(x0 - e, h + r, zc), v(x1 + e, h + r, zc)], [[0, 0], [len, 0], [len, slope], [0, slope]], roofColor);
      walls.face([v(x1, h, z1), v(x1, h, z0), v(x1, h + r, zc)], [gableUv(0), gableUv(0), gableUv(0)], wallColor);
      walls.face([v(x0, h, z0), v(x0, h, z1), v(x0, h + r, zc)], [gableUv(0), gableUv(0), gableUv(0)], wallColor);
    } else {
      const xc = (x0 + x1) / 2;
      const len = (z1 - z0) / 2.4;
      const slope = Math.hypot(span / 2 + e, r) / 1.2;
      roofs.face([v(x1 + e, h - 0.3, z1 + e), v(x1 + e, h - 0.3, z0 - e), v(xc, h + r, z0 - e), v(xc, h + r, z1 + e)], [[0, 0], [len, 0], [len, slope], [0, slope]], roofColor);
      roofs.face([v(x0 - e, h - 0.3, z0 - e), v(x0 - e, h - 0.3, z1 + e), v(xc, h + r, z1 + e), v(xc, h + r, z0 - e)], [[0, 0], [len, 0], [len, slope], [0, slope]], roofColor);
      walls.face([v(x0, h, z1), v(x1, h, z1), v(xc, h + r, z1)], [gableUv(0), gableUv(0), gableUv(0)], wallColor);
      walls.face([v(x1, h, z0), v(x0, h, z0), v(xc, h + r, z0)], [gableUv(0), gableUv(0), gableUv(0)], wallColor);
    }
  };

  for (const b of blocks) {
    if (b.green) continue;
    // Taller buildings further from the stadium, like a city thickening toward its centre.
    const far = Math.min(1, Math.max(0, (Math.hypot(b.x0 + b.x1, b.z0 + b.z1) / 2 - Math.max(fp.halfX, fp.halfZ)) / 400));
    const storeys = () => Math.max(3, Math.min(8, Math.round(3 + rand() * 3 + far * 2)));
    const depth = 12 + rand() * 3;
    const lots = (from: number, to: number, cb: (a: number, c: number) => void) => {
      let a = from;
      while (to - a > 8) {
        const w = Math.min(to - a, 12 + rand() * 14);
        cb(a, to - a - w < 8 ? to : a + w);
        a = to - a - w < 8 ? to : a + w;
      }
    };
    lots(b.x0, b.x1, (a, c) => building(a, b.z0, c, b.z0 + depth, storeys()));
    lots(b.x0, b.x1, (a, c) => building(a, b.z1 - depth, c, b.z1, storeys()));
    lots(b.z0 + depth, b.z1 - depth, (a, c) => building(b.x0, a, b.x0 + depth, c, storeys()));
    lots(b.z0 + depth, b.z1 - depth, (a, c) => building(b.x1 - depth, a, b.x1, c, storeys()));
  }
  if (walls.pos.length === 0) return group;

  const tex = createFacadeTextures();
  const glow = lighting === 'night' ? 1.1 : lighting === 'dusk' ? 0.55 : 0;
  const wallMesh = new THREE.Mesh(
    walls.build(),
    new THREE.MeshStandardMaterial({
      map: tex.map,
      vertexColors: true,
      emissive: new THREE.Color(glow > 0 ? 0xffffff : 0x000000),
      emissiveMap: tex.emissive,
      emissiveIntensity: glow,
      roughness: 0.88,
    })
  );
  const roofMesh = new THREE.Mesh(
    roofs.build(),
    new THREE.MeshStandardMaterial({ map: createRoofTileTexture(), vertexColors: true, roughness: 0.82, side: THREE.DoubleSide })
  );
  for (const mesh of [wallMesh, roofMesh]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  group.add(wallMesh, roofMesh);
  return group;
}

/** Courses of clay tiles: a light/dark band every course, multiplied by the roof tint. */
function createRoofTileTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 64);
  for (let row = 0; row < 4; row++) {
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, row * 16 + 13, 64, 3);
    for (let col = 0; col < 4; col++) {
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(col * 16 + (row % 2) * 8, row * 16, 1, 16);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------------------------
// Perimeter fence and entrances
// ---------------------------------------------------------------------------------------------

/** Anti-climb vertical-bar panel: bars cut out of the alpha so the stadium shows through. */
function createFenceAlphaTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#ffffff';
  for (let x = 0; x < 256; x += 8) ctx.fillRect(x, 0, 2, 64);
  ctx.fillRect(0, 4, 256, 3);
  ctx.fillRect(0, 57, 256, 3);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function buildPerimeterFence(fp: SiteFootprint, layout: SiteLayout): THREE.Group {
  const group = new THREE.Group();
  group.name = 'SitePerimeterFence';
  const panelLen = 2.5;
  const height = 2.6;
  const ring = sampleRing(fp, layout.forecourt, panelLen).map((s) => s.p);
  const segments: [Pt, Pt][] = [];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    if (!layout.gates.some((g) => Math.hypot(mid.x - g.p.x, mid.z - g.p.z) < GATE_WIDTH / 2)) segments.push([a, b]);
  });
  if (segments.length === 0) return group;

  const steel = new THREE.MeshStandardMaterial({ color: 0x2f3a33, roughness: 0.5, metalness: 0.7 });
  const panelMat = new THREE.MeshStandardMaterial({
    color: 0x2f3a33,
    roughness: 0.5,
    metalness: 0.7,
    alphaMap: createFenceAlphaTexture(),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  const panelGeo = new THREE.PlaneGeometry(1, height);
  panelGeo.translate(0, height / 2 + 0.05, 0);
  const postGeo = new THREE.BoxGeometry(0.1, height + 0.2, 0.1);
  postGeo.translate(0, (height + 0.2) / 2, 0);
  const panels = new THREE.InstancedMesh(panelGeo, panelMat, segments.length);
  const posts = new THREE.InstancedMesh(postGeo, steel, segments.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  segments.forEach(([a, b], i) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    q.setFromAxisAngle(up, -Math.atan2(b.z - a.z, b.x - a.x));
    m.compose(new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2), q, new THREE.Vector3(len, 1, 1));
    panels.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(a.x, 0, a.z), q, new THREE.Vector3(1, 1, 1));
    posts.setMatrixAt(i, m);
  });
  for (const mesh of [panels, posts]) {
    mesh.castShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }
  group.add(panels, posts);
  return group;
}

function createGateSignTexture(label: string, accent: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PORTE', 128, 50);
  ctx.font = 'bold 54px sans-serif';
  ctx.fillText(label, 128, 108);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Turnstile pavilion across a gate: a slender canopy on four columns sheltering a row of
 * full-height turnstiles, with a ticket booth and lettered gate totems on either side.
 */
function buildEntrances(layout: SiteLayout, accent: string, lighting: LightingMode): THREE.Group {
  const group = new THREE.Group();
  group.name = 'SiteEntrances';
  const lit = lighting !== 'day';
  const frame = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.4, metalness: 0.75 });
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.45, metalness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.25, metalness: 0.9 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xbfd6e6,
    roughness: 0.05,
    transmission: 0.6,
    transparent: true,
    opacity: 0.45,
  });
  const soffitMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(0xfff1d6),
    emissiveIntensity: lit ? 1.6 : 0,
  });

  const w = GATE_WIDTH;
  for (const g of layout.gates) {
    const gate = new THREE.Group();
    gate.name = `Gate_${g.label}`;
    gate.position.set(g.p.x, 0, g.p.z);
    // Local +z faces out of the stadium; local x runs along the fence.
    gate.rotation.y = Math.atan2(g.n.x, g.n.z);

    const canopy = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 0.45, 8), canopyMat);
    canopy.position.set(0, 4.6, 0);
    const soffit = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 6.5), soffitMat);
    soffit.position.set(0, 4.35, 0);
    gate.add(canopy, soffit);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 4.4, 10), frame);
        col.position.set(sx * (w / 2 - 0.4), 2.2, sz * 3.2);
        gate.add(col);
      }
    }

    // Full-height rotor turnstiles separated by glazed screens.
    const lanes = Math.floor((w - 4) / 1.5);
    for (let i = 0; i < lanes; i++) {
      const x = -((lanes - 1) * 1.5) / 2 + i * 1.5;
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.3, 12, 1, true), steel);
      rotor.position.set(x, 1.15, 0);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 12), frame);
      cap.position.set(x, 2.35, 0);
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.1, 1.6), glass);
      screen.position.set(x + 0.75, 1.05, 0);
      const reader = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.1, 0.18), frame);
      reader.position.set(x - 0.55, 0.55, 0.75);
      gate.add(rotor, cap, screen, reader);
    }

    // Ticket booth on one side, lettered totems on both.
    const booth = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.8, 2.2), canopyMat);
    booth.position.set(w / 2 + 2.2, 1.4, 1.5);
    const boothGlass = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 0.05), glass);
    boothGlass.position.set(w / 2 + 2.2, 1.6, 2.62);
    gate.add(booth, boothGlass);

    const signTex = createGateSignTexture(g.label, accent);
    const signMat = new THREE.MeshStandardMaterial({
      map: signTex,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: signTex,
      emissiveIntensity: lit ? 1.2 : 0.15,
      roughness: 0.4,
    });
    for (const sx of [-1, 1]) {
      const totem = new THREE.Mesh(new THREE.BoxGeometry(1.4, 6.5, 0.5), frame);
      totem.position.set(sx * (w / 2 + 0.6), 3.25, 4.3);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.65), signMat);
      face.position.set(sx * (w / 2 + 0.6), 5.6, 4.56);
      gate.add(totem, face);
    }

    gate.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    group.add(gate);
  }
  return group;
}

// ---------------------------------------------------------------------------------------------
// Classic ground (setting `none`): the original stylised site, kept exactly as it was
// ---------------------------------------------------------------------------------------------

/** Footprint of the classic ground, which predates the square site. */
const CLASSIC_GROUND_W = 620;
const CLASSIC_GROUND_D = 560;

/**
 * Generates realistic urban site ground texture calibrated to `plazaId`
 * (`granite_pavers`, `sandstone_esplanade`, `urban_asphalt`).
 */
function createClassicGroundTexture(
  plazaId: PlazaMaterialId,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  // Landscaped outer green-slate urban parklands
  ctx.fillStyle = '#182821';
  ctx.fillRect(0, 0, 1024, 1024);

  for (let i = 0; i < 3200; i++) {
    const x = Math.abs((Math.sin(i * 23.1) * 41231.9) % 1) * 1024;
    const y = Math.abs((Math.cos(i * 67.4) * 17392.3) % 1) * 1024;
    ctx.fillStyle =
      i % 2 === 0 ? 'rgba(34, 197, 94, 0.045)' : 'rgba(15, 23, 42, 0.08)';
    ctx.fillRect(x, y, 4, 4);
  }

  // Perimeter asphalt ring avenues
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 24;
  for (const pos of [96, 928]) {
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, 1024);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, pos);
    ctx.lineTo(1024, pos);
    ctx.stroke();
  }

  ctx.save();
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([12, 10]);
  for (const pos of [96, 928]) {
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, 1024);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, pos);
    ctx.lineTo(1024, pos);
    ctx.stroke();
  }
  ctx.restore();

  // Grand pedestrian stadium podium / parvis around stadium footprint
  const grad = ctx.createRadialGradient(512, 512, 130, 512, 512, 405);
  if (plazaId === 'sandstone_esplanade') {
    grad.addColorStop(0, '#c7bfb3');
    grad.addColorStop(0.68, '#a89f91');
    grad.addColorStop(0.94, '#57534e');
    grad.addColorStop(1, '#182821');
  } else if (plazaId === 'urban_asphalt') {
    grad.addColorStop(0, '#334155');
    grad.addColorStop(0.68, '#1e293b');
    grad.addColorStop(0.94, '#0f172a');
    grad.addColorStop(1, '#182821');
  } else {
    grad.addColorStop(0, '#64748b');
    grad.addColorStop(0.68, '#475569');
    grad.addColorStop(0.94, '#1e293b');
    grad.addColorStop(1, '#182821');
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(512, 512, 412, 372, 0, 0, Math.PI * 2);
  ctx.fill();

  // Architectural concentric & radial paving joints on plaza
  ctx.strokeStyle =
    plazaId === 'sandstone_esplanade'
      ? 'rgba(68, 64, 60, 0.16)'
      : 'rgba(255, 255, 255, 0.09)';
  ctx.lineWidth = 1.3;
  for (const r of [245, 298, 352, 398]) {
    ctx.beginPath();
    ctx.ellipse(512, 512, r, r * 0.9, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let a = 0; a < 28; a++) {
    const phi = (a / 28) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(512 + Math.cos(phi) * 205, 512 + Math.sin(phi) * 185);
    ctx.lineTo(512 + Math.cos(phi) * 408, 512 + Math.sin(phi) * 368);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Adds multi-species landscaped perimeter boulevard trees (varied tint & organic multi-lobe crowns)
 * and illuminated architectural promenade light columns around the plaza.
 */
function createClassicLandscaping(lighting: LightingMode): THREE.Group {
  const group = new THREE.Group();
  const treeCount = 52;

  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.46, 3.8, 7);
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x4a3222,
    roughness: 0.94,
  });

  const canopyGeo = new THREE.IcosahedronGeometry(3.5, 1);
  const canopyMat = new THREE.MeshStandardMaterial({
    color: lighting === 'night' ? 0x1a3f28 : 0x2f683b,
    roughness: 0.88,
    metalness: 0.01,
  });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeCount);
  trunks.castShadow = true;
  canopies.castShadow = true;
  canopies.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  for (let i = 0; i < treeCount; i++) {
    const angle = (i / treeCount) * Math.PI * 2 + 0.05;
    const rx = 178 + (i % 3) * 6;
    const rz = 156 + ((i + 1) % 3) * 6;
    const tx = Math.cos(angle) * rx;
    const tz = Math.sin(angle) * rz;
    const scaleJitter = 0.82 + ((i * 19) % 11) * 0.036;

    dummy.position.set(tx, 1.9 * scaleJitter, tz);
    dummy.scale.set(scaleJitter, scaleJitter, scaleJitter);
    dummy.rotation.set(0, angle, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);

    dummy.position.set(tx, 5.3 * scaleJitter, tz);
    dummy.scale.set(scaleJitter * 1.18, scaleJitter * 0.92, scaleJitter * 1.12);
    dummy.rotation.set(0.18 * (i % 3), angle * 1.7, 0);
    dummy.updateMatrix();
    canopies.setMatrixAt(i, dummy.matrix);

    // Subtle botanical foliage hue variation per tree
    const hueShift = ((i * 7) % 10) * 0.008 - 0.04;
    tint.setHSL(0.35 + hueShift, 0.42, lighting === 'night' ? 0.22 : 0.34);
    canopies.setColorAt(i, tint);
  }
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
  trunks.computeBoundingSphere();
  canopies.computeBoundingSphere();
  group.add(trunks, canopies);

  // Warm pedestrian promenade light columns around outer plaza
  const poleCount = 32;
  const poleGeo = new THREE.CylinderGeometry(0.11, 0.16, 5.2, 8);
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.36,
    metalness: 0.8,
  });
  const lanternGeo = new THREE.CylinderGeometry(0.28, 0.18, 0.55, 10);
  const isLit = lighting !== 'day';
  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    emissive: new THREE.Color(isLit ? 0xfbbf24 : 0x000000),
    emissiveIntensity: isLit ? 2.2 : 0,
    roughness: 0.18,
  });

  const poles = new THREE.InstancedMesh(poleGeo, poleMat, poleCount);
  const lanterns = new THREE.InstancedMesh(lanternGeo, lanternMat, poleCount);
  for (let i = 0; i < poleCount; i++) {
    const angle = (i / poleCount) * Math.PI * 2;
    const px = Math.cos(angle) * 149;
    const pz = Math.sin(angle) * 129;

    dummy.position.set(px, 2.6, pz);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);

    dummy.position.set(px, 5.35, pz);
    dummy.updateMatrix();
    lanterns.setMatrixAt(i, dummy.matrix);
  }
  poles.instanceMatrix.needsUpdate = true;
  lanterns.instanceMatrix.needsUpdate = true;
  poles.computeBoundingSphere();
  lanterns.computeBoundingSphere();
  group.add(poles, lanterns);

  return group;
}

function buildClassicGround(doc: StadiumDocument, plaza: PlazaMaterialId, maxAnisotropy: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'SiteClassicGround';
  const plazaDetail = createPlazaDetailNormalAndRoughness(plaza, maxAnisotropy);
  const ground = new THREE.Mesh(
    createSiteGroundGeometry(doc.pitch, CLASSIC_GROUND_W, CLASSIC_GROUND_D),
    new THREE.MeshStandardMaterial({
      map: createClassicGroundTexture(plaza, maxAnisotropy),
      normalMap: plazaDetail.normalMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: plazaDetail.roughnessMap,
      roughness: doc.lighting === 'night' ? 0.72 : 0.88,
      metalness: 0.05,
    })
  );
  ground.name = 'SiteGround';
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  group.add(ground, createClassicLandscaping(doc.lighting));
  return group;
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/**
 * Builds the land around the stadium for the chosen setting: ground, forecourt, vegetation,
 * street furniture, buildings or car parks, plus the optional fence and entrance pavilions.
 * Everything is laid out from the stadium's real outer footprint, so it follows any shape.
 */
// ---------------------------------------------------------------------------------------------
// Podium
// ---------------------------------------------------------------------------------------------

/** How far the podium deck reaches beyond the stadium facade (m). */
const PODIUM_MARGIN = 16;
/** Grand stair riser and tread (m): an easy outdoor flight. */
const STAIR_RISER = 0.16;
const STAIR_TREAD = 0.42;

/**
 * The stadium's podium: a raised deck from just inside the facade out to `PODIUM_MARGIN`, its
 * outer wall lined with shopfronts and car-park openings in turn, and a grand stair on the south
 * axis from the deck down to the ground. The stadium itself stays on the ground: the podium
 * wraps the foot of its facade, so its gates open onto the deck.
 */
function buildPodium(
  doc: StadiumDocument,
  fp: SiteFootprint,
  height: number,
  plaza: PlazaMaterialId,
  maxAnisotropy: number
): { group: THREE.Group; footprint: SiteFootprint } {
  const group = new THREE.Group();
  group.name = 'SitePodium';
  const night = doc.lighting !== 'day';
  const steps = 240;
  const outline = (offset: number) =>
    Array.from({ length: steps }, (_, i) => {
      const p = ringPoint(fp, (i / steps) * Math.PI * 2, offset);
      // Shape y maps to world -z once the extrusion is turned upright.
      return new THREE.Vector2(p.x, -p.z);
    });
  const shape = new THREE.Shape(outline(PODIUM_MARGIN));
  shape.holes.push(new THREE.Path(outline(-4).reverse()));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  // Paving tiles at 3.2 m on the deck, the wall's own scale on the sides.
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3.2, uv.getY(i) / 3.2);

  const detail = createPlazaDetailNormalAndRoughness(plaza, maxAnisotropy);
  const deckMat = new THREE.MeshStandardMaterial({
    color: PLAZA_COLOR[plaza],
    normalMap: detail.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: detail.roughnessMap,
    roughness: 0.85,
    metalness: 0.02,
  });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xb8b2a7, roughness: 0.88, metalness: 0.02 });
  const body = new THREE.Mesh(geo, [deckMat, wallMat]);
  body.name = 'PodiumBody';
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const stairW = Math.min(52, fp.halfX * 0.45);
  const flights = Math.max(2, Math.ceil(height / STAIR_RISER));
  const riser = height / flights;
  const run = flights * STAIR_TREAD;
  const z0 = fp.halfZ + PODIUM_MARGIN;

  // Shopfronts and car-park mouths in bays along the outer wall, clear of the stair.
  const shopMat = new THREE.MeshStandardMaterial({
    color: night ? 0xffe7b8 : 0x8fb2c4,
    emissive: night ? 0xffb85c : 0x000000,
    emissiveIntensity: night ? 0.9 : 0,
    roughness: 0.12,
    metalness: 0.3,
  });
  const parkMat = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.95 });
  const dummy = new THREE.Object3D();
  const shops: THREE.Matrix4[] = [];
  const parks: THREE.Matrix4[] = [];
  const dense = 1440;
  const pts = Array.from({ length: dense }, (_, i) => ringPoint(fp, (i / dense) * Math.PI * 2, PODIUM_MARGIN));
  const bay = 9;
  let acc = 0;
  let k = 0;
  for (let i = 0; i < dense; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % dense];
    acc += Math.hypot(b.x - a.x, b.z - a.z);
    if (acc < bay) continue;
    acc = 0;
    if (a.z > 0 && Math.abs(a.x) < stairW / 2 + 3) continue;
    const n = ringNormal(fp, (i / dense) * Math.PI * 2, PODIUM_MARGIN);
    const isPark = k++ % 3 === 2;
    const h = isPark ? Math.min(3.2, height - 1) : height - 1.4;
    dummy.position.set(a.x + n.x * 0.12, 0.2 + h / 2, a.z + n.z * 0.12);
    dummy.rotation.set(0, Math.atan2(n.x, n.z), 0);
    dummy.scale.set(isPark ? 6.8 : 7.6, h, 0.3);
    dummy.updateMatrix();
    (isPark ? parks : shops).push(dummy.matrix.clone());
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (const [name, list, mat] of [
    ['PodiumShopfronts', shops, shopMat],
    ['PodiumCarParkMouths', parks, parkMat],
  ] as const) {
    if (list.length === 0) continue;
    const inst = new THREE.InstancedMesh(box, mat, list.length);
    inst.name = name;
    list.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }

  // Grand stair: each step a solid block from the deck edge out to its own nosing.
  // Pale stone, so the treads read against the paving below.
  const stairMat = new THREE.MeshStandardMaterial({ color: 0xded8cb, roughness: 0.8, metalness: 0.02 });
  const stairs = new THREE.InstancedMesh(box, stairMat, flights - 1);
  stairs.name = 'PodiumGrandStair';
  for (let i = 0; i < flights - 1; i++) {
    const top = height - (i + 1) * riser;
    const depth = (i + 1) * STAIR_TREAD + 1;
    dummy.position.set(0, top / 2, z0 - 1 + depth / 2);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(stairW, top, depth);
    dummy.updateMatrix();
    stairs.setMatrixAt(i, dummy.matrix);
  }
  stairs.instanceMatrix.needsUpdate = true;
  stairs.computeBoundingSphere();
  stairs.castShadow = true;
  stairs.receiveShadow = true;
  group.add(stairs);
  // Cheek walls along both sides of the flight.
  const cheek = new THREE.Shape([
    new THREE.Vector2(-1, 0),
    new THREE.Vector2(run, 0),
    new THREE.Vector2(run, 0.9),
    new THREE.Vector2(-1, height + 0.9),
  ]);
  const cheekGeo = new THREE.ExtrudeGeometry(cheek, { depth: 0.6, bevelEnabled: false });
  cheekGeo.rotateY(-Math.PI / 2);
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(cheekGeo, wallMat);
    wall.position.set(side * (stairW / 2 + 0.3) + 0.3, 0, z0);
    wall.castShadow = true;
    group.add(wall);
  }

  return {
    group,
    footprint: { halfX: fp.halfX + PODIUM_MARGIN, halfZ: fp.halfZ + PODIUM_MARGIN + run, exponent: fp.exponent },
  };
}

export function generateSiteGroup(doc: StadiumDocument, stadiumFp: SiteFootprint, maxAnisotropy: number = 4): THREE.Group {
  const site = resolveSite(doc);
  const mats = { ...DEFAULT_STADIUM_MATERIALS, ...(doc.materials ?? {}) };
  const group = new THREE.Group();
  group.name = 'SiteSurroundings';
  // A podium widens the built footprint: the surroundings are laid out around it.
  const podium = site.podiumHeight > 0.5 ? buildPodium(doc, stadiumFp, site.podiumHeight, mats.plazaSurface, maxAnisotropy) : null;
  if (podium) group.add(podium.group);
  const fp = podium?.footprint ?? stadiumFp;
  const layout = planSite(fp, site);
  const waterfront = fp.halfX + layout.forecourt + 14;
  const moat = { from: layout.forecourt + 4, to: layout.forecourt + 18 };
  const moundRun = site.mound * 3;
  // Nothing stands in the water or on the mound's slope.
  const clear = (p: Pt) =>
    !(site.water === 'waterfront' && p.x > waterfront - 3) &&
    !(site.water === 'moat' && ringLevel(fp, p.x, p.z, moat.from - 2) > 1 && ringLevel(fp, p.x, p.z, moat.to + 2) < 1) &&
    !(site.mound > 0.5 && ringLevel(fp, p.x, p.z, moundRun + 2) < 1);
  layout.trees = layout.trees.filter(clear);
  layout.lamps = layout.lamps.filter(clear);
  layout.cars = layout.cars.filter(clear);
  layout.lots = layout.lots.filter((r) => clear({ x: r.x0, z: r.z0 }) && clear({ x: r.x1, z: r.z1 }));
  layout.blocks = layout.blocks.filter((r) => clear({ x: r.x0, z: r.z0 }) && clear({ x: r.x1, z: r.z1 }));
  if (site.water === 'moat') group.add(buildMoat(fp, moat.from, moat.to));
  if (site.water === 'waterfront') group.add(buildWaterfront(waterfront));
  if (site.mound > 0.5) group.add(buildMound(fp, site.mound, moundRun));

  if (site.setting === 'none') {
    group.add(buildClassicGround(doc, mats.plazaSurface, maxAnisotropy));
    if (site.perimeterFence) group.add(buildPerimeterFence(fp, layout));
    if (site.entrances) group.add(buildEntrances(layout, doc.colors.seatsPrimary, doc.lighting));
    return group;
  }

  const detail = createPlazaDetailNormalAndRoughness('urban_asphalt', maxAnisotropy);
  const groundNormal = detail.normalMap.clone();
  groundNormal.wrapS = THREE.RepeatWrapping;
  groundNormal.wrapT = THREE.RepeatWrapping;
  groundNormal.repeat.set(SITE_SIZE / 6, SITE_SIZE / 6);
  groundNormal.needsUpdate = true;
  const ground = new THREE.Mesh(
    createSiteGroundGeometry(doc.pitch, SITE_SIZE, SITE_SIZE),
    new THREE.MeshStandardMaterial({
      map: paintSiteGround(fp, site, layout, mats.plazaSurface, maxAnisotropy),
      normalMap: groundNormal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.92,
      metalness: 0.02,
    })
  );
  ground.name = 'SiteGround';
  ground.position.y = -0.05;
  ground.receiveShadow = true;

  group.add(
    ground,
    buildForecourt(fp, layout.forecourt, mats.plazaSurface, maxAnisotropy),
    buildTrees(layout.trees, doc.lighting),
    buildLamps(layout.lamps, doc.lighting),
    buildCars(layout.cars)
  );
  const markings = buildParkingMarkings(layout.lots);
  if (markings) group.add(markings);
  if (site.setting === 'urban') group.add(buildCityBlocks(layout.blocks, doc.lighting, fp));
  if (site.perimeterFence) group.add(buildPerimeterFence(fp, layout));
  if (site.entrances) group.add(buildEntrances(layout, doc.colors.seatsPrimary, doc.lighting));
  return group;
}

// ---------------------------------------------------------------------------------------------
// Water and landform
// ---------------------------------------------------------------------------------------------

function waterMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0x1d4a63,
    roughness: 0.06,
    metalness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
  });
}

/** Ribbon between two rings of the footprint, `inner` and `outer` metres out, at height `y`. */
function ringBand(fp: SiteFootprint, inner: number, outer: number, y: number, mat: THREE.Material, name: string): THREE.Mesh {
  const segs = 240;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const theta = (i / segs) * Math.PI * 2;
    const a = ringPoint(fp, theta, inner);
    const b = ringPoint(fp, theta, outer);
    pos.push(a.x, y, a.z, b.x, y, b.z);
    if (i < segs) {
      const k = i * 2;
      // Same winding as the forecourt, so the band faces up.
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.receiveShadow = true;
  return mesh;
}

/** Moat ringing the forecourt, crossed by a bridge at every gate, with stone copings. */
function buildMoat(fp: SiteFootprint, from: number, to: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'SiteMoat';
  const stone = new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.85 });
  group.add(
    ringBand(fp, from, to, 0.04, waterMaterial(), 'MoatWater'),
    ringBand(fp, from - 1.2, from, 0.12, stone, 'MoatCoping'),
    ringBand(fp, to, to + 1.2, 0.12, stone, 'MoatCoping')
  );
  for (const theta of gateThetas(fp)) {
    const a = ringPoint(fp, theta, from - 1.5);
    const b = ringPoint(fp, theta, to + 1.5);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(GATE_WIDTH * 0.7, 0.5, len), stone);
    bridge.position.set((a.x + b.x) / 2, 0.3, (a.z + b.z) / 2);
    bridge.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    bridge.castShadow = true;
    bridge.receiveShadow = true;
    bridge.name = 'MoatBridge';
    group.add(bridge);
  }
  return group;
}

/** River or bay along the east side of the site, behind a stone quay. */
function buildWaterfront(x0: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'SiteWaterfront';
  const width = SITE_SIZE / 2 - x0;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(width, SITE_SIZE).rotateX(-Math.PI / 2), waterMaterial());
  water.position.set(x0 + width / 2, 0.04, 0);
  water.receiveShadow = true;
  water.name = 'WaterfrontWater';
  const quay = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.9, SITE_SIZE),
    new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.85 })
  );
  quay.position.set(x0 - 1.2, 0.2, 0);
  quay.receiveShadow = true;
  quay.name = 'WaterfrontQuay';
  group.add(water, quay);
  return group;
}

/**
 * Grassed mound banked against the facade, `height` metres up the wall and sloping down over
 * `run` metres, opened by a cutting at every gate so the entrances stay reachable.
 */
function buildMound(fp: SiteFootprint, height: number, run: number): THREE.Mesh {
  const segs = 360;
  const steps = 8;
  const gates = gateThetas(fp);
  const perimeter = 2 * Math.PI * Math.max(fp.halfX, fp.halfZ);
  const gap = ((GATE_WIDTH * 0.75) / perimeter) * Math.PI * 2;
  const angDist = (a: number, b: number) => {
    const d = Math.abs(a - b) % (Math.PI * 2);
    return Math.min(d, Math.PI * 2 - d);
  };
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const theta = (i / segs) * Math.PI * 2;
    // Height falls to nothing across each gate's cutting.
    const nearest = Math.min(...gates.map((g) => angDist(theta, g)));
    const cut = Math.max(0, Math.min(1, (nearest - gap) / gap));
    for (let k = 0; k <= steps; k++) {
      const f = k / steps;
      const p = ringPoint(fp, theta, -0.5 + f * run);
      pos.push(p.x, height * cut * 0.5 * (1 + Math.cos(Math.PI * f)) + 0.02, p.z);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < steps; k++) {
      const a = i * (steps + 1) + k;
      const b = a + steps + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x4f7f3c, roughness: 0.96, side: THREE.DoubleSide }));
  mesh.name = 'SiteMound';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

import * as THREE from 'three';
import { beamGeometry, chordAt, mergedMesh } from './roofBeams';
import { RoundedBowlGeometry, sampleRoundedBowlRing } from '../bowlRing';
import { createRoofPbrMaterial, createRoofShadowDepthMaterial } from '../materials';
import { RetractableConfig, resolveRetractable, StadiumDocument } from '../schema';

/**
 * Movable panels of `retractable` and `petal_iris` roofs, laid over the opening left by the
 * perimeter canopy. Each panel is cut from the opening outline in its closed position, then
 * moved by `openRatio` along the chosen motion (Mahovič's typology: sliding, rotating, folding).
 */

type Pt = { x: number; z: number };

export interface RetractableContext {
  ring: RoundedBowlGeometry;
  /** Canopy deck height. */
  roofY: number;
  innerOffset: number;
  outerOffset: number;
  primaryStructMat: THREE.Material;
  crossSectionClip: boolean;
  maxAnisotropy: number;
}

/** Panels overlap the canopy rim by this much in their closed position. */
const LEAF_OVERLAP = 2.0;
/** Vertical spacing between stacked open panels. */
const STACK_STEP = 0.9;

/** Keeps the part of `poly` where `nx * x + nz * z <= c` (Sutherland–Hodgman, one edge). */
function clipHalfPlane(poly: Pt[], nx: number, nz: number, c: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = nx * a.x + nz * a.z - c;
    const db = nx * b.x + nz * b.z - c;
    if (da <= 0) out.push(a);
    if (da * db < 0) {
      const f = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f });
    }
  }
  return out;
}

function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
}

/** Wedge of `poly` between directions `a0` and `a1` (radians in the XZ plane, `a1 - a0 < π`). */
function clipWedge(poly: Pt[], a0: number, a1: number): Pt[] {
  const left = clipHalfPlane(poly, Math.sin(a0), -Math.cos(a0), 0);
  return clipHalfPlane(left, -Math.sin(a1), Math.cos(a1), 0);
}

/** Farthest point of the (star-shaped) outline along direction `a` from the origin. */
function rayHit(poly: Pt[], a: number): Pt {
  const dx = Math.cos(a);
  const dz = Math.sin(a);
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const ex = q.x - p.x;
    const ez = q.z - p.z;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = (p.x * ez - p.z * ex) / den;
    const s = (p.x * dz - p.z * dx) / den;
    if (t > best && s >= 0 && s <= 1) best = t;
  }
  return { x: dx * best, z: dz * best };
}

interface PanelKit {
  cfg: RetractableConfig;
  panelMat: THREE.Material;
  shadowMat: THREE.MeshDepthMaterial;
  frameMat: THREE.Material;
  /** Height of the panel underside in the closed position. */
  leafY: number;
}

/**
 * One movable panel cut from `poly` (world XZ, closed position): deck slab, perimeter frame and,
 * for rigid and mixed panels, stiffeners. Built in world coordinates so motions only apply a
 * rigid transform to the returned group.
 */
function buildPanel(poly: Pt[], kit: PanelKit): THREE.Group {
  const { cfg, panelMat, shadowMat, frameMat, leafY } = kit;
  const group = new THREE.Group();
  group.name = 'RetractableRoofPanel';
  const thick = cfg.panelKind === 'rigid' ? 0.55 : 0.12;

  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, -p.z)));
  const deckGeo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  deckGeo.rotateX(-Math.PI / 2);
  deckGeo.translate(0, leafY, 0);
  const deck = new THREE.Mesh(deckGeo, panelMat);
  deck.name = 'RetractableRoofLeaf';
  deck.customDepthMaterial = shadowMat;
  deck.castShadow = true;
  deck.receiveShadow = true;
  deck.renderOrder = 3;
  group.add(deck);

  const frameW = cfg.panelKind === 'membrane' ? 0.22 : 0.5;
  const frameY = leafY + thick + frameW * 0.5;
  const parts: THREE.BufferGeometry[] = [];
  // Perimeter frame, decimated so long curved edges keep a reasonable segment count.
  const step = Math.max(1, Math.floor(poly.length / 32));
  const rim = poly.filter((_, i) => i % step === 0);
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i];
    const b = rim[(i + 1) % rim.length];
    if (Math.hypot(b.x - a.x, b.z - a.z) < 0.3) continue;
    parts.push(
      beamGeometry(
        new THREE.Vector3(a.x, frameY, a.z),
        new THREE.Vector3(b.x, frameY, b.z),
        frameW,
        frameW
      )
    );
  }
  if (cfg.panelKind !== 'membrane') {
    // Stiffeners spanning the panel's shorter direction, every ~9 m along its longer one.
    const xs = poly.map((p) => p.x);
    const zs = poly.map((p) => p.z);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanZ = Math.max(...zs) - Math.min(...zs);
    const along: 'x' | 'z' = spanX >= spanZ ? 'x' : 'z';
    const min = along === 'x' ? Math.min(...xs) : Math.min(...zs);
    const span = Math.max(spanX, spanZ);
    const count = Math.max(1, Math.round(span / 9));
    const beamY = leafY + thick + 0.55;
    for (let k = 1; k <= count; k++) {
      const u = min + (span * k) / (count + 1);
      const chord = chordAt(poly, along, u);
      if (!chord || chord[1] - chord[0] < 2) continue;
      const a =
        along === 'x' ? new THREE.Vector3(u, beamY, chord[0]) : new THREE.Vector3(chord[0], beamY, u);
      const b =
        along === 'x' ? new THREE.Vector3(u, beamY, chord[1]) : new THREE.Vector3(chord[1], beamY, u);
      parts.push(beamGeometry(a, b, 0.6, 1.1));
    }
  }
  const frame = mergedMesh(parts, frameMat, 'RetractableRoofPanelFrame');
  if (frame) group.add(frame);
  return group;
}

function rotationAboutPoint(axis: THREE.Vector3, angle: number, pivot: THREE.Vector3): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(new THREE.Matrix4().makeRotationAxis(axis, angle))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
}

/** Panel cut from `poly`, moved by the world-space rigid transform `m`. */
function addPanel(group: THREE.Group, poly: Pt[], kit: PanelKit, m: THREE.Matrix4): void {
  const panel = buildPanel(poly, kit);
  panel.applyMatrix4(m);
  group.add(panel);
}

/** Tube following the opening outline: the runway of rotating, iris and stacking roofs. */
function buildRingRail(contour: Pt[], y: number, mat: THREE.Material): THREE.Mesh {
  const pts = contour.map((p) => new THREE.Vector3(p.x, y, p.z));
  const rail = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), contour.length * 2, 0.45, 6, true),
    mat
  );
  rail.name = 'RetractableRoofRingRail';
  rail.castShadow = true;
  return rail;
}

/** Stacked panels only separate vertically during the first quarter of the travel. */
function stackLift(level: number, openRatio: number): number {
  return level * STACK_STEP * Math.min(1, openRatio * 4);
}

/**
 * Sliding panels (`slide_longitudinal`, `slide_transverse`, `slide_off`): strips cut across the
 * travel axis slide over two runway girders and stack at the parking end(s), the panel nearest
 * its end lowest. `slide_off` rolls the panels clear of the building onto rails on trestles.
 */
function buildSlidingRoof(group: THREE.Group, contour: Pt[], kit: PanelKit, ctx: RetractableContext): void {
  const { cfg } = kit;
  const axis: 'x' | 'z' = cfg.motion === 'slide_transverse' ? 'z' : 'x';
  const us = contour.map((p) => p[axis]);
  const uMin = Math.min(...us);
  const uMax = Math.max(...us);
  const n = cfg.panelCount;
  const w = (uMax - uMin) / n;
  const toward = (centre: number): 1 | -1 => {
    if (cfg.parkEnd === 'east') return 1;
    if (cfg.parkEnd === 'west') return -1;
    return centre >= (uMin + uMax) / 2 ? 1 : -1;
  };
  const strips = Array.from({ length: n }, (_, i) => {
    const lo = uMin + i * w;
    return { lo, hi: lo + w, dir: toward(lo + w / 2) };
  });
  const along = (d: number) =>
    axis === 'x' ? new THREE.Vector3(d, 0, 0) : new THREE.Vector3(0, 0, d);

  // Parked panels stay over the canopy band at their end: a panel wider than the band leaves
  // part of the opening covered rather than overhanging the facade. `slide_off` rolls clear.
  const band = Math.max(4, ctx.outerOffset - ctx.innerOffset - LEAF_OVERLAP);
  const offSite = cfg.motion === 'slide_off';
  let farthest = 0;
  for (const s of strips) {
    const rank = strips
      .filter((o) => o.dir === s.dir)
      .sort((a, b) => (s.dir > 0 ? b.lo - a.lo : a.lo - b.lo))
      .indexOf(s);
    const nx = axis === 'x' ? 1 : 0;
    const nz = axis === 'z' ? 1 : 0;
    const poly = clipHalfPlane(clipHalfPlane(contour, -nx, -nz, -s.lo), nx, nz, s.hi);
    if (poly.length < 3 || polygonArea(poly) < 1) continue;
    const clear = s.dir > 0 ? uMax - s.lo : -(s.hi - uMin);
    const overBand = s.dir > 0 ? uMax + band - s.hi : -(s.lo - (uMin - band));
    const travel = offSite || Math.abs(overBand) > Math.abs(clear) ? clear : overBand;
    farthest = Math.max(farthest, Math.abs(travel));
    const offset = along(travel * cfg.openRatio).setY(stackLift(rank, cfg.openRatio));
    addPanel(group, poly, kit, new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z));
  }

  // Two runway girders, parallel to the travel axis, long enough for the parked panels.
  const mid = chordAt(contour, axis, (uMin + uMax) / 2) ?? [-10, 10];
  const halfDepth = Math.min(Math.abs(mid[0]), Math.abs(mid[1]));
  const parkReach = offSite ? farthest : Math.min(farthest, w, band);
  const gLo = uMin - (strips.some((s) => s.dir < 0) ? parkReach : 0);
  const gHi = uMax + (strips.some((s) => s.dir > 0) ? parkReach : 0);
  const girderH = cfg.panelKind === 'rigid' ? 2.6 : 1.6;
  const girderY = kit.leafY - girderH / 2 - 0.05;
  const canopyEdge = Math.max(-uMin, uMax) + (ctx.outerOffset - ctx.innerOffset);
  const parts: THREE.BufferGeometry[] = [];
  for (const sign of ctx.crossSectionClip ? [-1] : [-1, 1]) {
    const v = sign * halfDepth * 0.62;
    const at = (u: number, y: number) =>
      axis === 'x' ? new THREE.Vector3(u, y, v) : new THREE.Vector3(v, y, u);
    parts.push(beamGeometry(at(gLo, girderY), at(gHi, girderY), 1.4, girderH));
    // Trestles carry the girders down to the ground wherever they run past the canopy.
    for (const end of [gLo, gHi]) {
      const sgn = Math.sign(end);
      for (let u = end; Math.abs(u) > canopyEdge; u -= sgn * 24) {
        parts.push(beamGeometry(at(u, 0), at(u, girderY - girderH / 2), 1.2, 1.2));
      }
    }
  }
  const girders = mergedMesh(parts, ctx.primaryStructMat, 'RetractableRoofGirders');
  if (girders) group.add(girders);
}

/** Wedge sectors of the opening around the bowl centre, sector 0 centred on the +x (east) axis. */
function sectorWedges(contour: Pt[], n: number): { poly: Pt[]; a0: number; a1: number; k: number }[] {
  const out: { poly: Pt[]; a0: number; a1: number; k: number }[] = [];
  for (let k = 0; k < n; k++) {
    const a0 = ((k - 0.5) * 2 * Math.PI) / n;
    const a1 = ((k + 0.5) * 2 * Math.PI) / n;
    const poly = clipWedge(contour, a0, a1);
    if (poly.length >= 3 && polygonArea(poly) >= 1) out.push({ poly, a0, a1, k });
  }
  return out;
}

const UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3();

/** `rotate_vertical`: sectors pivot about a central hub and stack over the east sector. */
function buildRotatingRoof(group: THREE.Group, contour: Pt[], kit: PanelKit, ctx: RetractableContext): void {
  const { cfg } = kit;
  for (const { poly, a0, a1, k } of sectorWedges(contour, cfg.panelCount)) {
    const mid = (a0 + a1) / 2;
    const angle = Math.atan2(Math.sin(mid), Math.cos(mid));
    // A rotation of θ about +Y turns the XZ direction `a` into `a - θ`: θ = angle brings it east.
    const m = new THREE.Matrix4()
      .makeTranslation(0, stackLift(k, cfg.openRatio), 0)
      .multiply(rotationAboutPoint(UP, angle * cfg.openRatio, ORIGIN));
    addPanel(group, poly, kit, m);
  }
  const hubH = cfg.panelCount * STACK_STEP + 3;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, hubH, 16), ctx.primaryStructMat);
  hub.position.set(0, kit.leafY + hubH / 2 - 1, 0);
  hub.name = 'RetractableRoofPivotHub';
  group.add(hub, buildRingRail(contour, kit.leafY - 0.5, ctx.primaryStructMat));
}

/** `rotate_horizontal`: triangular flaps hinged on the opening rim, lifted up and outward. */
function buildHingedFlapRoof(group: THREE.Group, contour: Pt[], kit: PanelKit, ctx: RetractableContext): void {
  const { cfg } = kit;
  const maxAngle = 1.9;
  const hinges: THREE.BufferGeometry[] = [];
  for (const { poly, a0, a1 } of sectorWedges(contour, cfg.panelCount)) {
    const a = rayHit(contour, a0);
    const b = rayHit(contour, a1);
    const axis = new THREE.Vector3(b.x - a.x, 0, b.z - a.z);
    if (axis.lengthSq() < 1) continue;
    axis.normalize();
    const pivot = new THREE.Vector3((a.x + b.x) / 2, kit.leafY, (a.z + b.z) / 2);
    // Pick the sense that lifts the inner tip (the bowl centre) upward.
    const tip = new THREE.Vector3(0, kit.leafY, 0).sub(pivot).applyAxisAngle(axis, 0.5);
    const sense = tip.y > 0 ? 1 : -1;
    addPanel(group, poly, kit, rotationAboutPoint(axis, sense * maxAngle * cfg.openRatio, pivot));
    hinges.push(
      beamGeometry(
        new THREE.Vector3(a.x, kit.leafY, a.z),
        new THREE.Vector3(b.x, kit.leafY, b.z),
        0.8,
        0.8
      )
    );
  }
  const hingeMesh = mergedMesh(hinges, ctx.primaryStructMat, 'RetractableRoofHinges');
  if (hingeMesh) group.add(hingeMesh);
}

/**
 * `iris`: spiral petals tile the opening like a camera diaphragm (each edge curls by
 * `IRIS_CURL` toward the centre). Opening, every petal twists and slides outward along its
 * bisector onto the fixed crown, never farther than the crown is deep, so it stays over the roof
 * instead of overhanging the facade; alternate petals ride higher to pass over their neighbours.
 */
const IRIS_CURL = 0.55;

function irisPetal(contour: Pt[], a0: number, a1: number, curl: number): Pt[] {
  const steps = 14;
  const at = (f: number, a: number): Pt => {
    const rim = rayHit(contour, a);
    return { x: rim.x * f, z: rim.z * f };
  };
  const poly: Pt[] = [];
  // Leading edge from the centre out to the rim, rim arc, trailing edge back to the centre.
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    poly.push(at(f, a0 + curl * (1 - f)));
  }
  for (let i = 1; i < steps; i++) {
    poly.push(at(1, a0 + ((a1 - a0) * i) / steps));
  }
  for (let i = steps; i >= 1; i--) {
    const f = i / steps;
    poly.push(at(f, a1 + curl * (1 - f)));
  }
  return poly;
}

function buildIrisRoof(group: THREE.Group, contour: Pt[], kit: PanelKit, ctx: RetractableContext): void {
  const { cfg } = kit;
  const n = cfg.panelCount;
  const twist = (0.35 * Math.PI) / n;
  const band = Math.max(3, ctx.outerOffset - ctx.innerOffset - LEAF_OVERLAP);
  const curl = IRIS_CURL * ((2 * Math.PI) / n);
  for (let k = 0; k < n; k++) {
    const a0 = ((k - 0.5) * 2 * Math.PI) / n;
    const a1 = ((k + 0.5) * 2 * Math.PI) / n;
    const mid = (a0 + a1) / 2;
    if (ctx.crossSectionClip && Math.sin(mid) > 0.2) continue;
    const poly = irisPetal(contour, a0, a1, curl);
    const rimDist = Math.hypot(rayHit(contour, mid).x, rayHit(contour, mid).z);
    const reach = Math.min(band, rimDist) * cfg.openRatio;
    const lift = (k % 2) * 0.6 * Math.min(1, cfg.openRatio * 4) + 0.05 * k * Math.min(1, cfg.openRatio * 4);
    const m = new THREE.Matrix4()
      .makeTranslation(Math.cos(mid) * reach, lift, Math.sin(mid) * reach)
      .multiply(rotationAboutPoint(UP, -twist * cfg.openRatio, ORIGIN));
    addPanel(group, poly, kit, m);
    const p = rayHit(contour, a0);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.4, 10), ctx.primaryStructMat);
    pin.position.set(p.x, kit.leafY + 0.4, p.z);
    pin.name = 'RetractableRoofIrisPin';
    group.add(pin);
  }
  group.add(buildRingRail(contour, kit.leafY - 0.5, ctx.primaryStructMat));
}

function membraneMesh(pos: number[], idx: number[], kit: PanelKit): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, kit.panelMat);
  mesh.name = 'RetractableRoofMembrane';
  mesh.customDepthMaterial = kit.shadowMat;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * `fold_central`: membrane tensioned by radial cables from the rim to a raised central ring.
 * Opening winches the membrane toward the ring, where it gathers into a hanging pleated bundle;
 * with `suspensionMast`, an inclined tower outside the bowl carries the ring.
 */
function buildCentralFoldRoof(group: THREE.Group, contour: Pt[], kit: PanelKit, ctx: RetractableContext): void {
  const { cfg, leafY } = kit;
  const ringR = 6;
  const ringY = leafY + 14;
  const reach = 1 - cfg.openRatio;
  // The cross-section keeps the north half, where z = sin(a) <= 0.
  const a0 = ctx.crossSectionClip ? Math.PI : 0;
  const a1 = 2 * Math.PI;
  const segs = 128;
  const rows = 12;
  const pleats = cfg.panelCount;
  const visible = (a: number) => !ctx.crossSectionClip || Math.sin(a) <= 1e-6;

  if (reach > 0.02) {
    const pos: number[] = [];
    const idx: number[] = [];
    for (let s = 0; s <= segs; s++) {
      const a = a0 + ((a1 - a0) * s) / segs;
      const rim = rayHit(contour, a);
      const inner = { x: Math.cos(a) * ringR, z: Math.sin(a) * ringR };
      const pleat = 0.8 * cfg.openRatio * Math.abs(Math.sin((a * pleats) / 2));
      for (let r = 0; r <= rows; r++) {
        const f = (r / rows) * reach;
        const y = ringY + (leafY - ringY) * f - 2.2 * Math.sin(Math.PI * f) - pleat;
        pos.push(inner.x + (rim.x - inner.x) * f, y, inner.z + (rim.z - inner.z) * f);
      }
    }
    for (let s = 0; s < segs; s++) {
      for (let r = 0; r < rows; r++) {
        const a = s * (rows + 1) + r;
        const b = a + rows + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    group.add(membraneMesh(pos, idx, kit));
  }

  // Gathered membrane: a pleated cone hanging under the ring, growing as the roof opens.
  if (cfg.openRatio > 0.02) {
    const h = 3 + 9 * cfg.openRatio;
    const bundle = new THREE.Mesh(new THREE.ConeGeometry(ringR * 0.95, h, pleats, 1, true), kit.panelMat);
    bundle.rotation.x = Math.PI;
    bundle.position.set(0, ringY - h / 2, 0);
    bundle.name = 'RetractableRoofGatheredMembrane';
    group.add(bundle);
  }

  const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.7, 8, 32), ctx.primaryStructMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = ringY;
  ring.name = 'RetractableRoofCentralRing';
  // Fixed membrane cap closing the ring's eye.
  const cap = new THREE.Mesh(
    new THREE.CircleGeometry(ringR, 32, a0, a1 - a0).rotateX(Math.PI / 2),
    kit.panelMat
  );
  cap.position.y = ringY + 0.2;
  cap.name = 'RetractableRoofMembrane';
  group.add(ring, cap);

  const cables: THREE.BufferGeometry[] = [];
  for (let k = 0; k < cfg.panelCount; k++) {
    const a = (k / cfg.panelCount) * 2 * Math.PI;
    if (!visible(a)) continue;
    const rim = rayHit(contour, a);
    cables.push(
      beamGeometry(
        new THREE.Vector3(rim.x, leafY, rim.z),
        new THREE.Vector3(Math.cos(a) * ringR, ringY, Math.sin(a) * ringR),
        0.18,
        0.18
      )
    );
  }

  if (cfg.suspensionMast && cfg.mastPosition === 'central') {
    // Needle over the centre: the ring hangs at its foot, stays from its tip fan out to the rim.
    const tip = new THREE.Vector3(0, ringY + 48, 0);
    const foot = new THREE.Vector3(0, ringY - 6, 0);
    const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.4, tip.y - foot.y, 10), ctx.primaryStructMat);
    needle.position.y = (tip.y + foot.y) / 2;
    needle.castShadow = true;
    needle.name = 'RetractableRoofCentralNeedle';
    group.add(needle);
    const stays = 16;
    for (let k = 0; k < stays; k++) {
      const a = (k / stays) * 2 * Math.PI;
      if (!visible(a)) continue;
      const rim = rayHit(contour, a);
      cables.push(beamGeometry(tip, new THREE.Vector3(rim.x, leafY + 1, rim.z), 0.22, 0.22));
    }
  } else if (cfg.suspensionMast) {
    // Inclined tower rising beyond the west end and leaning over the bowl.
    const westRim = rayHit(contour, Math.PI);
    const foot = new THREE.Vector3(westRim.x - (ctx.outerOffset - ctx.innerOffset) - 30, 0, 0);
    const head = new THREE.Vector3(westRim.x * 0.3, ringY + 55, 0);
    const dir = new THREE.Vector3().subVectors(head, foot);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 6.5, dir.length(), 8), ctx.primaryStructMat);
    mast.position.copy(foot).add(head).multiplyScalar(0.5);
    mast.quaternion.setFromUnitVectors(UP, dir.normalize());
    mast.castShadow = true;
    mast.name = 'RetractableRoofInclinedMast';
    group.add(mast);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * 2 * Math.PI;
      if (!visible(a)) continue;
      cables.push(
        beamGeometry(head, new THREE.Vector3(Math.cos(a) * ringR, ringY, Math.sin(a) * ringR), 0.3, 0.3)
      );
    }
  }
  const cableMesh = mergedMesh(cables, ctx.primaryStructMat, 'RetractableRoofCables');
  if (cableMesh) group.add(cableMesh);
}

/**
 * `fold_edge`: arched trusses run on rails along the long axis; the membrane between two trusses
 * keeps its length, so it sags into accordion pleats as the trusses bunch at the parking end.
 */
function buildEdgeFoldRoof(group: THREE.Group, contour: Pt[], kit: PanelKit, ctx: RetractableContext): void {
  const { cfg, leafY } = kit;
  const xs = contour.map((p) => p.x);
  const uMin = Math.min(...xs) + 1;
  const uMax = Math.max(...xs) - 1;
  const n = cfg.panelCount;
  const spacing = (uMax - uMin) / (n - 1);
  const parked = 2.2;
  const rise = 4;
  // With 'both', the western half parks west and the rest east.
  const westCount = cfg.parkEnd === 'west' ? n : cfg.parkEnd === 'east' ? 0 : Math.ceil(n / 2);

  const trusses = Array.from({ length: n }, (_, k) => {
    // Each truss keeps the span of its closed station and rides the rails with it.
    const closedX = uMin + k * spacing;
    const openX = k < westCount ? uMin + k * parked : uMax - (n - 1 - k) * parked;
    const chord = chordAt(contour, 'x', closedX) ?? [-4, 4];
    return {
      x: closedX + (openX - closedX) * cfg.openRatio,
      zLo: chord[0],
      zHi: ctx.crossSectionClip ? Math.min(0, chord[1]) : chord[1],
    };
  });
  const archY = (v: number) => leafY + rise * Math.sin(Math.PI * v);
  const cols = 24;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    // Where the two parking groups split apart, no membrane bridges the gap.
    if (k === westCount - 1 && westCount < n && cfg.openRatio > 0) continue;
    const t0 = trusses[k];
    const t1 = trusses[k + 1];
    const d = Math.max(0, t1.x - t0.x);
    const sag = Math.sqrt(Math.max(0, (spacing / 2) ** 2 - (d / 2) ** 2));
    const base = pos.length / 3;
    for (let c = 0; c <= cols; c++) {
      const v = c / cols;
      const z0 = t0.zLo + (t0.zHi - t0.zLo) * v;
      const z1 = t1.zLo + (t1.zHi - t1.zLo) * v;
      pos.push(t0.x, archY(v), z0);
      pos.push((t0.x + t1.x) / 2, archY(v) - sag, (z0 + z1) / 2);
      pos.push(t1.x, archY(v), z1);
    }
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < 2; r++) {
        const a = base + c * 3 + r;
        const b = a + 3;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  if (idx.length > 0) group.add(membraneMesh(pos, idx, kit));

  const parts: THREE.BufferGeometry[] = [];
  for (const t of trusses) {
    let prev: THREE.Vector3 | null = null;
    for (let c = 0; c <= 16; c++) {
      const v = c / 16;
      const p = new THREE.Vector3(t.x, archY(v) + 0.4, t.zLo + (t.zHi - t.zLo) * v);
      if (prev) parts.push(beamGeometry(prev, p, 0.7, 1.2));
      prev = p;
    }
  }
  // Rails along both long edges of the opening.
  const mid = chordAt(contour, 'x', 0) ?? [-10, 10];
  for (const z of ctx.crossSectionClip ? [mid[0] * 0.92] : [mid[0] * 0.92, mid[1] * 0.92]) {
    parts.push(
      beamGeometry(new THREE.Vector3(uMin - 2, leafY - 0.6, z), new THREE.Vector3(uMax + 2, leafY - 0.6, z), 1, 1)
    );
  }
  const frame = mergedMesh(parts, ctx.primaryStructMat, 'RetractableRoofTrusses');
  if (frame) group.add(frame);
}

/**
 * `combined_stack`: four panels along the long axis. The east one is fixed, the two middle ones
 * slide east over it and the west one swings 180° around the bowl centre to land on top.
 */
function buildCombinedStackRoof(group: THREE.Group, contour: Pt[], kit: PanelKit, ctx: RetractableContext): void {
  const { cfg } = kit;
  const xs = contour.map((p) => p.x);
  const uMin = Math.min(...xs);
  const uMax = Math.max(...xs);
  const w = (uMax - uMin) / 4;
  for (let i = 0; i < 4; i++) {
    const hi = uMax - i * w;
    const poly = clipHalfPlane(clipHalfPlane(contour, -1, 0, -(hi - w)), 1, 0, hi);
    if (poly.length < 3 || polygonArea(poly) < 1) continue;
    const lift = stackLift(i, cfg.openRatio);
    let m: THREE.Matrix4;
    if (i < 3) {
      m = new THREE.Matrix4().makeTranslation(i * w * cfg.openRatio, lift, 0);
    } else {
      m = new THREE.Matrix4()
        .makeTranslation(0, lift, 0)
        .multiply(rotationAboutPoint(UP, Math.PI * cfg.openRatio, ORIGIN));
    }
    addPanel(group, poly, kit, m);
  }
  group.add(buildRingRail(contour, kit.leafY - 0.5, ctx.primaryStructMat));
}

/**
 * Inclined pylons standing outside the bowl, leaning out, their tips staying the canopy at its
 * inner rim and its outer edge; they hold the fixed part of the roof, the panels slide below.
 */
function buildPeripheralPylons(cfg: RetractableConfig, ctx: RetractableContext): THREE.Group | null {
  if (cfg.pylonCount <= 0) return null;
  const group = new THREE.Group();
  group.name = 'RetractableRoofPylons';
  const stays: THREE.BufferGeometry[] = [];
  const height = ctx.roofY + 42;
  for (let k = 0; k < cfg.pylonCount; k++) {
    // Offset by half a step so no pylon sits on a cut axis.
    const t = (k + 0.5) / cfg.pylonCount;
    const outer = sampleRoundedBowlRing(ctx.ring, t, ctx.outerOffset + 14);
    if (ctx.crossSectionClip && outer.z > 0) continue;
    const foot = new THREE.Vector3(outer.x, 0, outer.z);
    const tip = new THREE.Vector3(outer.x + outer.nx * 9, height, outer.z + outer.nz * 9);
    const dir = new THREE.Vector3().subVectors(tip, foot);
    const pylon = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 2.6, dir.length(), 8), ctx.primaryStructMat);
    pylon.position.copy(foot).add(tip).multiplyScalar(0.5);
    pylon.quaternion.setFromUnitVectors(UP, dir.normalize());
    pylon.castShadow = true;
    group.add(pylon);
    for (const dt of [-0.35, 0, 0.35].map((d) => d / cfg.pylonCount)) {
      const rim = sampleRoundedBowlRing(ctx.ring, t + dt, ctx.innerOffset + 1);
      const edge = sampleRoundedBowlRing(ctx.ring, t + dt, ctx.outerOffset);
      stays.push(
        beamGeometry(tip, new THREE.Vector3(rim.x, ctx.roofY + 2, ctx.crossSectionClip ? Math.min(0, rim.z) : rim.z), 0.2, 0.2),
        beamGeometry(tip, new THREE.Vector3(edge.x, ctx.roofY + 1, ctx.crossSectionClip ? Math.min(0, edge.z) : edge.z), 0.2, 0.2)
      );
    }
    // Backstay to the ground, anchoring the pull of the canopy.
    const anchor = sampleRoundedBowlRing(ctx.ring, t, ctx.outerOffset + 34);
    stays.push(beamGeometry(tip, new THREE.Vector3(anchor.x, 0, anchor.z), 0.3, 0.3));
  }
  const cables = mergedMesh(stays, ctx.primaryStructMat, 'RetractableRoofPylonStays');
  if (cables) group.add(cables);
  return group.children.length ? group : null;
}

/**
 * Movable panels at the document's `openRatio`. The group's `userData.rebuildAt(ratio)` rebuilds
 * them at another opening with the same materials, so the editor can animate the roof frame by
 * frame without regenerating the stadium.
 */
export function buildRetractablePanels(doc: StadiumDocument, ctx: RetractableContext): THREE.Group {
  const base = resolveRetractable(doc.roof);

  const contourSegs = 96;
  const contour: Pt[] = [];
  for (let s = 0; s < contourSegs; s++) {
    const p = sampleRoundedBowlRing(ctx.ring, s / contourSegs, ctx.innerOffset + LEAF_OVERLAP);
    // The cross-section keeps only the north half (z <= 0).
    contour.push({ x: p.x, z: ctx.crossSectionClip ? Math.min(0, p.z) : p.z });
  }

  const translucent =
    base.panelMaterial === 'polycarbonate_glass' || base.panelMaterial === 'etfe_cushions';
  const opacity = translucent
    ? Math.min(doc.roof.opacity, base.openRatio === 0 ? 0.84 : 0.65)
    : doc.roof.opacity;
  const panelMat = createRoofPbrMaterial(base.panelMaterial, opacity, doc.lighting, false, ctx.maxAnisotropy, 4, 4);
  const shadowMat = createRoofShadowDepthMaterial(base.panelMaterial, opacity, 'none', 0, 0.04, 0.04);

  const buildAt = (openRatio: number): THREE.Group => {
    const group = new THREE.Group();
    group.name = 'RetractableRoofPanels';
    const cfg: RetractableConfig = { ...base, openRatio: Math.max(0, Math.min(1, openRatio)) };
    const kit: PanelKit = { cfg, panelMat, shadowMat, frameMat: ctx.primaryStructMat, leafY: ctx.roofY + 2.15 };
    switch (cfg.motion) {
      case 'slide_longitudinal':
      case 'slide_transverse':
      case 'slide_off':
        buildSlidingRoof(group, contour, kit, ctx);
        break;
      case 'rotate_vertical':
        buildRotatingRoof(group, contour, kit, ctx);
        break;
      case 'rotate_horizontal':
        buildHingedFlapRoof(group, contour, kit, ctx);
        break;
      case 'iris':
        buildIrisRoof(group, contour, kit, ctx);
        break;
      case 'fold_central':
        buildCentralFoldRoof(group, contour, kit, ctx);
        break;
      case 'fold_edge':
        buildEdgeFoldRoof(group, contour, kit, ctx);
        break;
      case 'combined_stack':
        buildCombinedStackRoof(group, contour, kit, ctx);
        break;
    }
    const pylons = buildPeripheralPylons(cfg, ctx);
    if (pylons) group.add(pylons);
    // Kept out of the static mesh merge so it can be swapped while the roof moves.
    group.userData.keepSeparate = true;
    group.userData.rebuildAt = buildAt;
    return group;
  };
  return buildAt(base.openRatio);
}

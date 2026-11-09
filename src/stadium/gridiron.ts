import * as THREE from 'three';
import { GRIDIRON_END_ZONE_M, PitchConfig, YARD_M } from './schema';

/**
 * American football (NFL) field: painted markings drawn into the pitch texture, and the 3D
 * furniture standing on it (gooseneck goal posts, end-zone pylons).
 */

const FOOT_M = 0.3048;
/** White border around the field, outside the sidelines and end lines. */
const BORDER_M = 6 * FOOT_M;
/** Inbound edge of the hash marks, measured from each sideline. */
const HASH_FROM_SIDELINE_M = (70 + 9 / 12) * FOOT_M;
const TICK_M = 2 * FOOT_M;
/** Centre of the yard numbers, 10 yards in from each sideline; digits are 6 ft tall. */
const NUMBER_CENTRE_M = 10 * YARD_M;
const NUMBER_HEIGHT_M = 6 * FOOT_M;
const DEFAULT_END_ZONE_COLOR = '#1d3c78';

/**
 * Paints the gridiron over the turf already filled on `ctx`. The field (end zones included)
 * starts at (`px0`, `py0`) px: canvas x runs down the field, canvas y across it.
 */
export function drawGridironMarkings(
  ctx: CanvasRenderingContext2D,
  pitch: PitchConfig,
  px0: number,
  py0: number,
  scaleX: number,
  scaleY: number,
  marginSide: number
): void {
  const L = pitch.length;
  const W = pitch.width;
  const ez = GRIDIRON_END_ZONE_M;
  const team = pitch.endZoneColor ?? DEFAULT_END_ZONE_COLOR;
  const white = 'rgba(255, 255, 255, 0.96)';

  ctx.save();
  // Draw in metres from the north-west corner of the field.
  ctx.translate(px0, py0);
  ctx.scale(scaleX, scaleY);

  ctx.fillStyle = team;
  ctx.fillRect(0, 0, ez, W);
  ctx.fillRect(L - ez, 0, ez, W);

  // Midfield logo disc.
  ctx.beginPath();
  ctx.ellipse(L / 2, W / 2, 4.2, 4.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 0.25;
  ctx.strokeStyle = white;
  ctx.stroke();

  // 6 ft white border around the whole field.
  ctx.fillStyle = white;
  ctx.fillRect(-BORDER_M, -BORDER_M, L + 2 * BORDER_M, BORDER_M);
  ctx.fillRect(-BORDER_M, W, L + 2 * BORDER_M, BORDER_M);
  ctx.fillRect(-BORDER_M, 0, BORDER_M, W);
  ctx.fillRect(L, 0, BORDER_M, W);

  // Team areas between the 32-yard lines, behind a yellow restraining line, on both sidelines.
  const boxDepth = Math.min(9, marginSide - BORDER_M - 2.2);
  if (boxDepth > 1) {
    const x0 = ez + 32 * YARD_M;
    const x1 = L - ez - 32 * YARD_M;
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 0.15;
    for (const [y, dir] of [
      [-BORDER_M - 1.83, -1],
      [W + BORDER_M + 1.83, 1],
    ] as const) {
      ctx.strokeRect(x0, Math.min(y, y + dir * boxDepth), x1 - x0, boxDepth);
    }
  }

  // Yard lines every 5 yards; the goal lines are twice as wide.
  for (let yd = 0; yd <= 100; yd += 5) {
    const x = ez + yd * YARD_M;
    const w = yd === 0 || yd === 100 ? 0.2 : 0.1;
    ctx.fillRect(x - w / 2, 0.2, w, W - 0.4);
  }

  // One-yard ticks along both sidelines and at both rows of hash marks.
  for (let yd = 1; yd < 100; yd++) {
    if (yd % 5 === 0) continue;
    const x = ez + yd * YARD_M - 0.05;
    for (const y of [0.2, W - 0.2 - TICK_M, HASH_FROM_SIDELINE_M - TICK_M, W - HASH_FROM_SIDELINE_M]) {
      ctx.fillRect(x, y, 0.1, TICK_M);
    }
  }

  // Two-point conversion marks, 2 yards out from each goal line.
  for (const x of [ez + 2 * YARD_M, L - ez - 2 * YARD_M]) {
    ctx.fillRect(x - 0.05, W / 2 - YARD_M / 2, 0.1, YARD_M);
  }
  ctx.restore();

  // Text in pixels: fractional font sizes under a scaled transform render unevenly.
  const numberPx = NUMBER_HEIGHT_M * scaleY;
  ctx.fillStyle = white;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${numberPx}px Arial, Helvetica, sans-serif`;
  for (let yd = 10; yd <= 90; yd += 10) {
    const label = String(yd <= 50 ? yd : 100 - yd);
    const cx = px0 + (ez + yd * YARD_M) * scaleX;
    // Upright for the south stand, upside down on the north half: each faces its sideline.
    for (const [cy, rot] of [
      [py0 + (W - NUMBER_CENTRE_M) * scaleY, 0],
      [py0 + NUMBER_CENTRE_M * scaleY, Math.PI],
    ] as const) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      // Digits sit either side of the yard line.
      ctx.fillText(label[0], -0.78 * scaleX, 0);
      ctx.fillText(label[1], 0.78 * scaleX, 0);
      if (yd !== 50) {
        // Arrow pointing to the nearer goal line.
        const toWest = yd < 50;
        const dir = (toWest ? -1 : 1) * (rot === 0 ? 1 : -1);
        const ax = dir * 1.75 * scaleX;
        const ay = -numberPx * 0.32;
        ctx.beginPath();
        ctx.moveTo(ax + dir * 0.55 * scaleX, ay);
        ctx.lineTo(ax, ay - 0.3 * scaleY);
        ctx.lineTo(ax, ay + 0.3 * scaleY);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  const word = pitch.endZoneText?.trim().toUpperCase();
  if (word) {
    const heightPx = ez * 0.48 * scaleX;
    ctx.font = `800 ${heightPx}px Arial, sans-serif`;
    for (const [x, rot] of [
      [ez / 2, -Math.PI / 2],
      [L - ez / 2, Math.PI / 2],
    ] as const) {
      ctx.save();
      ctx.translate(px0 + x * scaleX, py0 + (W / 2) * scaleY);
      ctx.rotate(rot);
      const maxW = (W - 6) * scaleY;
      const w = ctx.measureText(word).width;
      if (w > maxW) ctx.scale(maxW / w, 1);
      ctx.fillText(word, 0, 0);
      ctx.restore();
    }
  }
}

/** Crossbar 10 ft above the end line, uprights 18 ft 6 in apart rising 35 ft above it. */
const CROSSBAR_Y = 10 * FOOT_M;
const UPRIGHT_GAP = 18.5 * FOOT_M;
const UPRIGHT_H = 35 * FOOT_M;
const POST_OFFSET = 6 * FOOT_M;

interface GridironMaterials {
  yellow: THREE.Material;
  pad: THREE.Material;
  ribbon: THREE.Material;
}

/** Gooseneck goal post on the end line (local x = 0), its base set back 6 ft along +x. */
function createGooseneckPost(m: GridironMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'GridironGoalPost';
  const b = POST_OFFSET;
  const neck = new THREE.CatmullRomCurve3([
    new THREE.Vector3(b, 0, 0),
    new THREE.Vector3(b, CROSSBAR_Y * 0.62, 0),
    new THREE.Vector3(b * 0.78, CROSSBAR_Y * 0.9, 0),
    new THREE.Vector3(b * 0.3, CROSSBAR_Y, 0),
    new THREE.Vector3(0, CROSSBAR_Y, 0),
  ]);
  const post = new THREE.Mesh(new THREE.TubeGeometry(neck, 24, 0.1, 10), m.yellow);
  post.castShadow = true;
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.9, 14), m.pad);
  pad.position.set(b, 0.95, 0);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, UPRIGHT_GAP, 10).rotateX(Math.PI / 2), m.yellow);
  bar.position.y = CROSSBAR_Y;
  bar.castShadow = true;
  group.add(post, pad, bar);
  for (const z of [-UPRIGHT_GAP / 2, UPRIGHT_GAP / 2]) {
    const upright = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, UPRIGHT_H, 8), m.yellow);
    upright.position.set(0, CROSSBAR_Y + UPRIGHT_H / 2, z);
    upright.castShadow = true;
    // Wind ribbon flying from the tip.
    const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.1), m.ribbon);
    ribbon.position.set(-0.52, CROSSBAR_Y + UPRIGHT_H - 0.08, z);
    group.add(upright, ribbon);
  }
  return group;
}

/** Goal posts behind both end lines and the eight orange pylons at the end-zone corners. */
export function createGridironFurniture(pitch: PitchConfig): THREE.Group {
  const group = new THREE.Group();
  group.name = 'GridironFurniture';
  const m: GridironMaterials = {
    yellow: new THREE.MeshStandardMaterial({ color: 0xffcf1a, roughness: 0.38, metalness: 0.25 }),
    pad: new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 }),
    ribbon: new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.7, side: THREE.DoubleSide }),
  };
  for (const sx of [-1, 1] as const) {
    const post = createGooseneckPost(m);
    post.position.set((sx * pitch.length) / 2, 0.03, 0);
    if (sx < 0) post.rotation.y = Math.PI;
    group.add(post);
  }
  const pylonGeo = new THREE.BoxGeometry(0.1, 0.46, 0.1);
  const pylonMat = new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.55 });
  for (const x of [pitch.length / 2, pitch.length / 2 - GRIDIRON_END_ZONE_M]) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pylon = new THREE.Mesh(pylonGeo, pylonMat);
        pylon.position.set(sx * x, 0.26, (sz * pitch.width) / 2);
        group.add(pylon);
      }
    }
  }
  return group;
}

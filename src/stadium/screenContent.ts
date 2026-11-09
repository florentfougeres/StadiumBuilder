import * as THREE from 'three';

/**
 * What the stadium's giant screens show: the live TV feed of the match (the broadcast camera's
 * view of the pitch with its players, the crowd beyond and the score bug), seen through the
 * screen's LED pixel grid. Shared by every screen in the scene; drawn once.
 */

const W = 1024;
const H = 576;
let feedCanvas: HTMLCanvasElement | null = null;

/** Small deterministic generator, so the picture is the same on every build. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function drawFeed(ctx: CanvasRenderingContext2D): void {
  const rand = rng(7);
  const horizon = 168;

  // Crowd in the far stand: dark rows speckled with shirts and scarves.
  const stand = ctx.createLinearGradient(0, 0, 0, horizon);
  stand.addColorStop(0, '#1b1d24');
  stand.addColorStop(1, '#2b2a31');
  ctx.fillStyle = stand;
  ctx.fillRect(0, 0, W, horizon);
  const shirts = ['#c8102e', '#f5f5f5', '#1e3a8a', '#d6d3d1', '#7f1d1d', '#fbbf24', '#3f3f46'];
  for (let y = 4; y < horizon - 26; y += 7) {
    for (let x = rand() * 6; x < W; x += 5 + rand() * 4) {
      ctx.fillStyle = shirts[Math.floor(rand() * shirts.length)];
      ctx.globalAlpha = 0.55 + rand() * 0.4;
      ctx.fillRect(x, y + rand() * 2, 3.2, 4.5);
      ctx.fillStyle = '#e7c3a0';
      ctx.fillRect(x + 0.6, y - 2, 2, 2);
    }
  }
  ctx.globalAlpha = 1;

  // Advertising boards along the far touchline.
  const boards = ['#0b3d91', '#e11d48', '#111827', '#f59e0b', '#0f766e', '#ffffff', '#7c3aed'];
  for (let x = 0, i = 0; x < W; x += 96, i++) {
    ctx.fillStyle = boards[i % boards.length];
    ctx.fillRect(x, horizon - 24, 96, 22);
    ctx.fillStyle = i % boards.length === 5 ? '#111827' : 'rgba(255,255,255,0.85)';
    ctx.fillRect(x + 22, horizon - 16, 52, 6);
  }

  // Pitch in perspective: mowing stripes fan out from a vanishing point above the frame.
  const vx = W / 2;
  const vy = -900;
  const k = (horizon - vy) / (H - vy);
  for (let i = -22; i < 22; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#2f7d32' : '#3a8f3c';
    ctx.beginPath();
    ctx.moveTo(vx + i * 140 * k, horizon);
    ctx.lineTo(vx + (i + 1) * 140 * k, horizon);
    ctx.lineTo(vx + (i + 1) * 140, H);
    ctx.lineTo(vx + i * 140, H);
    ctx.closePath();
    ctx.fill();
  }
  const light = ctx.createLinearGradient(0, horizon, 0, H);
  light.addColorStop(0, 'rgba(0,0,0,0.18)');
  light.addColorStop(1, 'rgba(255,255,255,0.05)');
  ctx.fillStyle = light;
  ctx.fillRect(0, horizon, W, H - horizon);

  // Lines: far touchline, halfway line and the centre circle.
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, horizon + 4);
  ctx.lineTo(W, horizon + 4);
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(vx, horizon + 4);
  ctx.lineTo(vx, H);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(vx, 372, 190, 92, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Players in two kits: shadow, socks and shorts, shirt, head; and the ball.
  const players: [number, number, number][] = [
    [300, 330, 0], [420, 270, 0], [560, 300, 1], [640, 410, 1], [470, 450, 0],
    [760, 260, 1], [230, 470, 0], [880, 360, 1], [350, 230, 1], [690, 520, 0],
  ];
  for (const [x, y, team] of players) {
    const s = 0.55 + ((y - horizon) / (H - horizon)) * 0.75;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x + 6 * s, y + 1, 11 * s, 3.5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = team === 0 ? '#111827' : '#ffffff';
    ctx.fillRect(x - 5 * s, y - 26 * s, 4 * s, 26 * s);
    ctx.fillRect(x + 1 * s, y - 26 * s, 4 * s, 26 * s);
    ctx.fillStyle = team === 0 ? '#c8102e' : '#1d4ed8';
    ctx.fillRect(x - 8 * s, y - 52 * s, 16 * s, 27 * s);
    ctx.fillStyle = '#d6a77a';
    ctx.beginPath();
    ctx.arc(x, y - 58 * s, 5.5 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(598, 418, 5, 0, Math.PI * 2);
  ctx.fill();

  // Score bug, top left, and the broadcaster's live tag, top right.
  ctx.fillStyle = 'rgba(10,12,18,0.92)';
  ctx.fillRect(36, 30, 330, 46);
  ctx.fillStyle = '#c8102e';
  ctx.fillRect(36, 30, 8, 46);
  ctx.fillStyle = '#1d4ed8';
  ctx.fillRect(194, 30, 8, 46);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 26px Inter, Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('DOM', 56, 54);
  ctx.textAlign = 'center';
  ctx.fillText('2 – 1', 156, 54);
  ctx.textAlign = 'left';
  ctx.fillText('EXT', 214, 54);
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(282, 30, 84, 46);
  ctx.fillStyle = '#0b0d12';
  ctx.fillText('67:42', 290, 54);
  ctx.fillStyle = 'rgba(10,12,18,0.85)';
  ctx.fillRect(W - 150, 30, 114, 34);
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(W - 130, 47, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 20px Inter, Arial, sans-serif';
  ctx.fillText('DIRECT', W - 116, 48);
}

/** Dark gaps between LED pixels: close up, the screen reads as a grid of diodes. */
function drawPixelGrid(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  for (let x = 2; x < W; x += 3) ctx.fillRect(x, 0, 1, H);
  for (let y = 2; y < H; y += 3) ctx.fillRect(0, y, W, 1);
}

/** The live feed on a giant screen (16:9): a fresh texture over the shared picture. */
export function createScreenFeedTexture(): THREE.CanvasTexture {
  if (!feedCanvas) {
    feedCanvas = document.createElement('canvas');
    feedCanvas.width = W;
    feedCanvas.height = H;
    const ctx = feedCanvas.getContext('2d')!;
    drawFeed(ctx);
    drawPixelGrid(ctx);
  }
  const tex = new THREE.CanvasTexture(feedCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

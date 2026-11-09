import * as THREE from 'three';
import { createRailSampler, type FacadeRailSample, instancedBoxes } from './rail';
import { dressedSkin } from './skin';

const ledTextureCache = new Map<string, THREE.CanvasTexture>();

/** LED pixel field: diagonal bands sweeping between two colours, on a dark backing. */
function ledSkinTexture(a: string, b: string): THREE.CanvasTexture {
  const key = `${a}|${b}`;
  const cached = ledTextureCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  const c = new THREE.Color();
  const pitch = 4;
  for (let y = 0; y < canvas.height; y += pitch) {
    for (let x = 0; x < canvas.width; x += pitch) {
      // Seamless across the texture width (one full wave period per tile).
      const u = x / canvas.width;
      const wave = 0.5 + 0.5 * Math.sin(u * Math.PI * 4 + (y / canvas.height) * 3.2);
      const glow = 0.45 + 0.55 * Math.pow(0.5 + 0.5 * Math.sin(u * Math.PI * 2 - y * 0.05), 2);
      c.copy(ca).lerp(cb, wave).multiplyScalar(glow);
      ctx.fillStyle = `#${c.getHexString()}`;
      ctx.fillRect(x + 0.5, y + 0.5, pitch - 1.4, pitch - 1.4);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  ledTextureCache.set(key, tex);
  return tex;
}

/** Length of facade one LED texture tile covers (m). */
const LED_TILE = 36;

/**
 * Media facade: a continuous LED pixel skin a little in front of the wall, unlit so it reads as
 * emitted light (brighter at night), framed by slim mullions and top and bottom rails.
 */
function buildMediaMesh(
  samples: FacadeRailSample[],
  closed: boolean,
  frameMat: THREE.Material,
  colors: [string, string],
  night: boolean
): THREE.Group | null {
  const rail = createRailSampler(samples, closed);
  if (!rail) return null;
  const { totalLen, sampleAtArc } = rail;
  const out = 0.9;
  const segs = Math.max(8, Math.min(720, Math.round(totalLen / 1.5)));
  // A whole number of tiles around a closed ring keeps the seam invisible.
  const tiles = closed ? Math.max(1, Math.round(totalLen / LED_TILE)) : totalLen / LED_TILE;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const s = (i / segs) * totalLen;
    const pt = sampleAtArc(closed && i === segs ? 0 : s);
    const top = Math.max(pt.yBottom + 0.6, pt.yTop - 0.4);
    const x = pt.x + pt.nx * out;
    const z = pt.z + pt.nz * out;
    positions.push(x, pt.yBottom + 0.3, z, x, top, z);
    const u = (i / segs) * tiles;
    uvs.push(u, 0, u, 1);
    if (i < segs) {
      const a = i * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const skinMat = new THREE.MeshBasicMaterial({
    map: ledSkinTexture(colors[0], colors[1]),
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  skinMat.color.setScalar(night ? 1.15 : 0.85);
  const skin = new THREE.Mesh(geo, skinMat);
  skin.name = 'MediaFacadeSkin';

  const dummy = new THREE.Object3D();
  const frames: THREE.Matrix4[] = [];
  const bays = Math.max(4, Math.round(totalLen / 6));
  const step = totalLen / bays;
  for (let i = 0; i < bays; i++) {
    const pt = sampleAtArc(closed ? i * step : (i + 0.5) * step);
    const h = pt.yTop - pt.yBottom;
    if (h < 1.2) continue;
    const yaw = Math.atan2(pt.nx, pt.nz);
    dummy.position.set(pt.x + pt.nx * (out + 0.12), pt.yBottom + h / 2, pt.z + pt.nz * (out + 0.12));
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(0.14, h, 0.3);
    dummy.updateMatrix();
    frames.push(dummy.matrix.clone());
    for (const y of [pt.yBottom + 0.2, pt.yTop - 0.3]) {
      const mid = sampleAtArc(closed ? ((i + 0.5) * step) % totalLen : Math.min(totalLen, (i + 1) * step));
      dummy.position.set(mid.x + mid.nx * (out + 0.1), y, mid.z + mid.nz * (out + 0.1));
      dummy.rotation.set(0, Math.atan2(mid.nx, mid.nz), 0);
      dummy.scale.set(step * 1.02, 0.25, 0.35);
      dummy.updateMatrix();
      frames.push(dummy.matrix.clone());
    }
  }
  const group = new THREE.Group();
  group.name = 'EnvelopeMediaMesh';
  group.add(skin);
  const frameMesh = instancedBoxes('MediaFacadeFrame', frames, frameMat);
  if (frameMesh) group.add(frameMesh);
  return group;
}

/** `media_mesh`: an LED pixel skin in the club colours, framed by slim mullions. */
export const mediaMesh = dressedSkin((p) =>
  buildMediaMesh(p.samples, p.closed, p.frameMat, p.ledColors ?? ['#2563eb', '#f8fafc'], p.night ?? false)
);

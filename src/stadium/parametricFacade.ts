import * as THREE from 'three';
import { EnvelopeStyle, FacadeMaterialId, FacadePatternId } from './schema';

export interface FacadeRailSample {
  /** World or local X coordinate on the exterior facade surface */
  x: number;
  /** World or local Z coordinate on the exterior facade surface */
  z: number;
  /** Outward unit normal X */
  nx: number;
  /** Outward unit normal Z */
  nz: number;
  /** Base Y of the facade at this sample (e.g. ground or sunken berm top) */
  yBottom: number;
  /** Crest Y of the facade at this sample */
  yTop: number;
}

/** Arc-length resampling of a facade rail, so features can be spaced in metres. */
function createRailSampler(
  samples: FacadeRailSample[],
  closed: boolean
): { totalLen: number; sampleAtArc: (s: number) => FacadeRailSample } | null {
  if (samples.length < 2) return null;
  const segCount = closed ? samples.length : samples.length - 1;
  const cumLen: number[] = [0];
  let totalLen = 0;
  for (let i = 0; i < segCount; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % samples.length];
    totalLen += Math.hypot(b.x - a.x, b.z - a.z);
    cumLen.push(totalLen);
  }
  if (totalLen < 3.0) return null;

  const sampleAtArc = (s: number): FacadeRailSample => {
    const clampedS = Math.max(0, Math.min(totalLen, s));
    let lo = 0;
    let hi = segCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumLen[mid + 1] < clampedS) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const s0 = cumLen[lo];
    const s1 = cumLen[lo + 1];
    const f = s1 > s0 + 1e-6 ? (clampedS - s0) / (s1 - s0) : 0;
    const a = samples[lo];
    const b = samples[(lo + 1) % samples.length];
    const nxRaw = a.nx + (b.nx - a.nx) * f;
    const nzRaw = a.nz + (b.nz - a.nz) * f;
    const nLen = Math.max(1e-5, Math.hypot(nxRaw, nzRaw));
    return {
      x: a.x + (b.x - a.x) * f,
      z: a.z + (b.z - a.z) * f,
      nx: nxRaw / nLen,
      nz: nzRaw / nLen,
      yBottom: a.yBottom + (b.yBottom - a.yBottom) * f,
      yTop: a.yTop + (b.yTop - a.yTop) * f,
    };
  };
  return { totalLen, sampleAtArc };
}

/** Outward offset of a bowl's glazed envelope from the back of the stands (m). */
export const BOWL_CURTAIN_WALL_OFFSET = 0.7;

/** Curtain-wall module: mullion spacing, primary mullion rhythm and storey height (m). */
const MULLION_SPACING = 1.5;
const PRIMARY_EVERY = 6;
const STOREY_HEIGHT = 4.5;

/**
 * Base articulation of a glazed or clad envelope: slim mullions on a 1.5 m module with a deeper
 * primary mullion every 9 m, and a slab-edge band at every storey. This is what makes a facade
 * read at building scale (the reference renders' fine vertical rhythm) rather than as a flat skin.
 */
export function buildCurtainWallArticulation(params: {
  samples: FacadeRailSample[];
  closed: boolean;
  frameMat: THREE.Material;
  facadeMaterial?: FacadeMaterialId;
  /** How far the frame stands proud of the facade surface (m). */
  offset?: number;
  /** Slab-edge bands at each storey; off for a screen with no floors behind it. */
  storeys?: boolean;
}): THREE.Group | null {
  const {
    samples,
    closed,
    frameMat,
    facadeMaterial = 'glass_curtain',
    offset = 0.05,
    storeys = true,
  } = params;
  // Only glazed curtain-wall facades wear the dense 1.5 m × 4.5 m aluminum mullion/transom grid;
  // masonry, concrete, stone, Corten, ETFE cushions, zinc, composite, timber & green walls read through their own material!
  if (facadeMaterial !== 'glass_curtain') return null;
  const rail = createRailSampler(samples, closed);
  if (!rail) return null;
  const { totalLen, sampleAtArc } = rail;

  const count = Math.max(4, Math.round(totalLen / MULLION_SPACING));
  const step = totalLen / count;
  const dummy = new THREE.Object3D();
  const mullions: THREE.Matrix4[] = [];
  const slabs: THREE.Matrix4[] = [];

  for (let i = 0; i < count; i++) {
    const s = closed ? i * step : (i + 0.5) * step;
    const pt = sampleAtArc(s);
    const h = pt.yTop - pt.yBottom;
    if (h < (storeys ? 2.5 : 0.8)) continue;
    const yaw = Math.atan2(pt.nx, pt.nz);
    const primary = i % PRIMARY_EVERY === 0;
    const depth = primary ? 0.85 : 0.32;
    const out = offset + depth * 0.5;
    dummy.position.set(pt.x + pt.nx * out, pt.yBottom + h * 0.5, pt.z + pt.nz * out);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(primary ? 0.24 : 0.09, h, depth);
    dummy.updateMatrix();
    mullions.push(dummy.matrix.clone());

    // Slab-edge band at each storey, one module long, standing slightly proud of the mullions.
    for (let y = pt.yBottom + STOREY_HEIGHT; storeys && y < pt.yTop - 1; y += STOREY_HEIGHT) {
      dummy.position.set(pt.x + pt.nx * (offset + 0.3), y, pt.z + pt.nz * (offset + 0.3));
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(step * 1.02, 0.42, 0.6);
      dummy.updateMatrix();
      slabs.push(dummy.matrix.clone());
    }
  }

  const group = new THREE.Group();
  group.name = 'CurtainWallArticulation';
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (const [name, list] of [
    ['CurtainWallMullions', mullions],
    ['CurtainWallSlabEdges', slabs],
  ] as const) {
    if (list.length === 0) continue;
    const inst = new THREE.InstancedMesh(box, frameMat, list.length);
    inst.name = name;
    list.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }
  return group.children.length > 0 ? group : null;
}

/** Instanced unit boxes from a list of transforms, or null when the list is empty. */
function instancedBoxes(name: string, list: THREE.Matrix4[], mat: THREE.Material): THREE.InstancedMesh | null {
  if (list.length === 0) return null;
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, list.length);
  inst.name = name;
  list.forEach((m, i) => inst.setMatrixAt(i, m));
  inst.instanceMatrix.needsUpdate = true;
  inst.computeBoundingSphere();
  inst.castShadow = true;
  inst.receiveShadow = true;
  return inst;
}

/** Unit box stretched from `a` to `b` with a square section `size`. */
function strutMatrix(a: THREE.Vector3, b: THREE.Vector3, size: number): THREE.Matrix4 {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return new THREE.Matrix4().compose(
    new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5),
    q,
    new THREE.Vector3(size, len, size)
  );
}

/**
 * Envelope style applied in front of a facade rail (the outer concourse wall, or the band
 * between it and the roof), so the chosen envelope stays visible when a concourse wraps the
 * stands:
 * - `enveloping_skin`: the curtain-wall articulation;
 * - `louver_curtain`: horizontal brise-soleil blades hung on slim vertical hangers;
 * - `colonnade_forest`: two staggered rows of slender full-height columns;
 * - `exposed_structure`: deep columns with crossed diagonal bracing between them;
 * - `stacked_arcades`: storeys of round arches on piers, in the facade material;
 * - `media_mesh`: an LED pixel skin in the club colours, framed by slim mullions;
 * - `helical_ramps`: access ramps wound around the facade in parallel diagonal bands;
 * - `horizontal_strata`: stacked balcony slabs, swelling in depth, alternately closed and open.
 */
export function buildEnvelopeDressing(params: {
  samples: FacadeRailSample[];
  closed: boolean;
  style: EnvelopeStyle;
  frameMat: THREE.Material;
  facadeMaterial?: FacadeMaterialId;
  storeys?: boolean;
  /** Masonry of `stacked_arcades` (falls back to `frameMat`). */
  facadeMat?: THREE.Material;
  /** `media_mesh`: the two colours the LED skin animates between. */
  ledColors?: [string, string];
  /** `media_mesh`: brighter pixels at dusk and night. */
  night?: boolean;
}): THREE.Group | null {
  const { samples, closed, style, frameMat, facadeMaterial, storeys = true } = params;
  if (style === 'stacked_arcades') {
    return buildStackedArcades(samples, closed, params.facadeMat ?? frameMat);
  }
  if (style === 'helical_ramps') {
    return buildHelicalRamps(samples, closed, params.facadeMat ?? frameMat, frameMat);
  }
  if (style === 'horizontal_strata') {
    return buildHorizontalStrata(samples, closed, params.facadeMat ?? frameMat, frameMat);
  }
  if (style === 'media_mesh') {
    return buildMediaMesh(samples, closed, frameMat, params.ledColors ?? ['#2563eb', '#f8fafc'], params.night ?? false);
  }
  if (style === 'enveloping_skin') {
    return buildCurtainWallArticulation({
      samples,
      closed,
      frameMat,
      facadeMaterial,
      storeys,
    });
  }
  const rail = createRailSampler(samples, closed);
  if (!rail) return null;
  const { totalLen, sampleAtArc } = rail;
  const dummy = new THREE.Object3D();
  const place = (pt: FacadeRailSample, out: number, y: number, sx: number, sy: number, sz: number) => {
    dummy.position.set(pt.x + pt.nx * out, y, pt.z + pt.nz * out);
    dummy.rotation.set(0, Math.atan2(pt.nx, pt.nz), 0);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  };
  const at = (pt: FacadeRailSample, out: number, y: number) =>
    new THREE.Vector3(pt.x + pt.nx * out, y, pt.z + pt.nz * out);

  const primary: THREE.Matrix4[] = [];
  const secondary: THREE.Matrix4[] = [];

  if (style === 'louver_curtain') {
    const module = 3;
    const count = Math.max(4, Math.round(totalLen / module));
    const step = totalLen / count;
    for (let i = 0; i < count; i++) {
      const pt = sampleAtArc(closed ? i * step : (i + 0.5) * step);
      const h = pt.yTop - pt.yBottom;
      if (h < 0.8) continue;
      secondary.push(place(pt, 1.1, pt.yBottom + h / 2, 0.08, h, 0.6));
      for (let y = pt.yBottom + 0.55; y < pt.yTop - 0.2; y += 0.85) {
        dummy.position.set(pt.x + pt.nx * 1.1, y, pt.z + pt.nz * 1.1);
        dummy.rotation.set(-0.35, Math.atan2(pt.nx, pt.nz), 0, 'YXZ');
        dummy.scale.set(step * 1.01, 0.05, 0.75);
        dummy.updateMatrix();
        primary.push(dummy.matrix.clone());
      }
    }
  } else if (style === 'colonnade_forest') {
    const spacing = 2.4;
    const count = Math.max(4, Math.round(totalLen / spacing));
    const step = totalLen / count;
    for (let i = 0; i < count; i++) {
      for (const [out, shift] of [
        [1.8, 0],
        [3.6, 0.5],
      ] as const) {
        const pt = sampleAtArc(((closed ? i : i + 0.5) + shift) * step);
        const h = pt.yTop - pt.yBottom;
        if (h < 0.8) continue;
        primary.push(place(pt, out, pt.yBottom + h / 2, 0.36, h, 0.36));
      }
    }
  } else {
    const spacing = 9;
    const count = Math.max(4, Math.round(totalLen / spacing));
    const step = totalLen / count;
    for (let i = 0; i < count; i++) {
      const s = closed ? i * step : (i + 0.5) * step;
      const pt = sampleAtArc(s);
      const h = pt.yTop - pt.yBottom;
      if (h < 0.8) continue;
      primary.push(place(pt, 0.9, pt.yBottom + h / 2, 0.7, h, 1.1));
      if (!closed && i === count - 1) continue;
      const next = sampleAtArc(closed ? ((i + 1) % count) * step : s + step);
      if (next.yTop - next.yBottom < 0.8) continue;
      secondary.push(
        strutMatrix(at(pt, 0.9, pt.yBottom), at(next, 0.9, next.yTop), 0.32),
        strutMatrix(at(pt, 0.9, pt.yTop), at(next, 0.9, next.yBottom), 0.32),
        // Ring beam along the top of the bay.
        strutMatrix(at(pt, 0.9, pt.yTop - 0.2), at(next, 0.9, next.yTop - 0.2), 0.45)
      );
    }
  }

  const group = new THREE.Group();
  group.name = 'EnvelopeDressing';
  for (const mesh of [
    instancedBoxes('EnvelopePrimary', primary, frameMat),
    instancedBoxes('EnvelopeSecondary', secondary, frameMat),
  ]) {
    if (mesh) group.add(mesh);
  }
  return group.children.length > 0 ? group : null;
}

/** Arcade bay width (m) and the storey height an arcade aims for. */
const ARCADE_BAY = 8;
const ARCADE_STOREY = 10;
/** Arcade screen offset in front of the wall (m), leaving a loggia behind the arches. */
const ARCADE_OUT = 1.7;

/**
 * Storeys of round-arched bays on piers standing in front of the wall, each storey capped by a
 * cornice, the heritage arcaded elevation. One bay is a single extruded frame (piers, arch and
 * spandrels) instanced around the rail.
 */
function buildStackedArcades(samples: FacadeRailSample[], closed: boolean, mat: THREE.Material): THREE.Group | null {
  const rail = createRailSampler(samples, closed);
  if (!rail) return null;
  const { totalLen, sampleAtArc } = rail;
  const refH = referenceHeight(sampleAtArc, totalLen) + 0.5;
  // A band lower than an arcade storey (the strip up to the roof) keeps its plain wall.
  if (refH < ARCADE_STOREY * 0.6) return null;
  const storeys = Math.max(1, Math.min(4, Math.round(refH / ARCADE_STOREY)));
  const bays = Math.max(3, Math.round(totalLen / ARCADE_BAY));
  const step = totalLen / bays;
  // Bay frame drawn one bay wide, `aspect` tall: piers 0.2 wide each side, a half-round arch
  // springing so a 0.14-high spandrel band remains above its crown.
  const aspect = refH / storeys / step;
  const r = Math.min(0.3, aspect * 0.4);
  const spring = Math.max(0.05, aspect - 0.14 * aspect - r);
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.lineTo(-r, 0);
  shape.lineTo(-r, spring);
  shape.absarc(0, spring, r, Math.PI, 0, true);
  shape.lineTo(r, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0.5, aspect);
  shape.lineTo(-0.5, aspect);
  shape.closePath();
  const bayGeo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 10 });
  bayGeo.translate(0, 0, -0.5);
  // Shape units are one bay wide: rescale the uvs so the masonry tiles every 2.5 m, not per bay.
  const uv = bayGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * step) / 2.5, (uv.getY(i) * step) / 2.5);

  const dummy = new THREE.Object3D();
  const bayMats: THREE.Matrix4[] = [];
  const cornices: THREE.Matrix4[] = [];
  const loggias: THREE.Matrix4[] = [];
  for (let i = 0; i < bays; i++) {
    const pt = sampleAtArc(closed ? (i + 0.5) * step : (i + 0.5) * step);
    const h = pt.yTop - pt.yBottom;
    if (h < 3) continue;
    const storeyH = h / storeys;
    const yaw = Math.atan2(pt.nx, pt.nz);
    for (let k = 0; k < storeys; k++) {
      const y = pt.yBottom + k * storeyH;
      dummy.position.set(pt.x + pt.nx * ARCADE_OUT, y, pt.z + pt.nz * ARCADE_OUT);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(step * 1.03, storeyH / aspect, 0.9);
      dummy.updateMatrix();
      bayMats.push(dummy.matrix.clone());
      dummy.position.set(pt.x + pt.nx * (ARCADE_OUT + 0.15), y + storeyH - 0.18, pt.z + pt.nz * (ARCADE_OUT + 0.15));
      dummy.scale.set(step * 1.02, 0.36, 1.2);
      dummy.updateMatrix();
      cornices.push(dummy.matrix.clone());
      // Shadowed loggia behind the arches, so the openings read from afar.
      dummy.position.set(pt.x + pt.nx * (ARCADE_OUT - 1.1), y + storeyH / 2, pt.z + pt.nz * (ARCADE_OUT - 1.1));
      dummy.scale.set(step * 1.01, storeyH, 0.1);
      dummy.updateMatrix();
      loggias.push(dummy.matrix.clone());
    }
  }
  if (bayMats.length === 0) return null;
  const group = new THREE.Group();
  group.name = 'EnvelopeArcades';
  const arcades = new THREE.InstancedMesh(bayGeo, mat, bayMats.length);
  arcades.name = 'ArcadeBays';
  bayMats.forEach((m, i) => arcades.setMatrixAt(i, m));
  arcades.instanceMatrix.needsUpdate = true;
  arcades.computeBoundingSphere();
  arcades.castShadow = true;
  arcades.receiveShadow = true;
  group.add(arcades);
  const corniceMesh = instancedBoxes('ArcadeCornices', cornices, mat);
  if (corniceMesh) group.add(corniceMesh);
  const shade = new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 0.95 });
  const loggiaMesh = instancedBoxes('ArcadeLoggias', loggias, shade);
  if (loggiaMesh) group.add(loggiaMesh);
  return group;
}

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

/** Box of `width × thickness` laid from `a` to `b`, its width horizontal and across the run. */
function slabMatrix(a: THREE.Vector3, b: THREE.Vector3, width: number, thickness: number): THREE.Matrix4 {
  const dummy = new THREE.Object3D();
  dummy.position.addVectors(a, b).multiplyScalar(0.5);
  dummy.lookAt(b);
  dummy.scale.set(width, thickness, a.distanceTo(b) * 1.02);
  dummy.updateMatrix();
  return dummy.matrix.clone();
}

/** Width (m) of an access ramp and its offset in front of the wall. */
const RAMP_WIDTH = 3.4;
const RAMP_OUT = 2.6;
/** Ramp gradient (rise over run). */
const RAMP_SLOPE = 0.12;

/**
 * Spiral access ramps wound around the facade: several parallel ramps climb from the ground to
 * the crest along the whole rail, each with a parapet, on slender posts at their outer edge, so
 * the facade reads as diagonal bands of ramps over the wall.
 */
function buildHelicalRamps(samples: FacadeRailSample[], closed: boolean, facadeMat: THREE.Material, frameMat: THREE.Material): THREE.Group | null {
  const rail = createRailSampler(samples, closed);
  if (!rail) return null;
  const { totalLen, sampleAtArc } = rail;
  const refH = referenceHeight(sampleAtArc, totalLen) + 0.5;
  const ramps = Math.max(2, Math.min(6, Math.round(refH / 7)));
  // Each ramp climbs at about 12 % (steep enough to read as a diagonal band), so a long ring holds
  // several climbs; a whole number of them keeps the ring seamless. On a straight stand the ramps
  // zigzag up and back down the run instead.
  const climbs = Math.max(1, Math.round(totalLen / (refH / RAMP_SLOPE)));
  const step = 2;
  const segs = Math.max(8, Math.round(totalLen / step));
  const decks: THREE.Matrix4[] = [];
  const parapets: THREE.Matrix4[] = [];
  const posts: THREE.Matrix4[] = [];
  const point = (s: number, frac: number, out: number, dy = 0) => {
    const pt = sampleAtArc(closed ? ((s % totalLen) + totalLen) % totalLen : s);
    const h = Math.max(0, pt.yTop - pt.yBottom - 1.2);
    return new THREE.Vector3(pt.x + pt.nx * out, pt.yBottom + 0.3 + frac * h + dy, pt.z + pt.nz * out);
  };
  for (let r = 0; r < ramps; r++) {
    const phase = r / ramps;
    for (let i = 0; i < segs; i++) {
      const s0 = (i / segs) * totalLen;
      const s1 = ((i + 1) / segs) * totalLen;
      let f0 = ((i / segs) * climbs + phase) % 1;
      let f1 = f0 + climbs / segs;
      if (!closed) {
        // Zigzag: up along the rail, then back down, so ramps meet the ground at both ends.
        const tri = (f: number) => 1 - Math.abs(1 - 2 * f);
        f0 = tri(f0);
        f1 = tri(f1 % 1);
      } else if (f1 > 1) continue; // landing where a ramp ends at the crest and the next starts
      const a = point(s0, f0, RAMP_OUT);
      const b = point(s1, f1, RAMP_OUT);
      decks.push(slabMatrix(a, b, RAMP_WIDTH, 0.32));
      const pa = point(s0, f0, RAMP_OUT + RAMP_WIDTH / 2 - 0.08, 0.7);
      const pb = point(s1, f1, RAMP_OUT + RAMP_WIDTH / 2 - 0.08, 0.7);
      parapets.push(slabMatrix(pa, pb, 0.16, 1.1));
    }
  }
  // Slender posts on the outer edge, running from the ground to the crest.
  const postStep = 9;
  const postCount = Math.max(4, Math.round(totalLen / postStep));
  for (let i = 0; i < postCount; i++) {
    const s = ((closed ? i : i + 0.5) / postCount) * totalLen;
    const foot = point(s, 0, RAMP_OUT + RAMP_WIDTH / 2, -0.3);
    const head = point(s, 1, RAMP_OUT + RAMP_WIDTH / 2, 0.9);
    posts.push(slabMatrix(foot, head, 0.32, 0.32));
  }
  const group = new THREE.Group();
  group.name = 'EnvelopeHelicalRamps';
  for (const mesh of [
    instancedBoxes('RampDecks', decks, facadeMat),
    instancedBoxes('RampParapets', parapets, frameMat),
    instancedBoxes('RampPosts', posts, frameMat),
  ]) {
    if (mesh) group.add(mesh);
  }
  return group.children.length > 0 ? group : null;
}

/** Storey height (m) of the stacked balcony strata. */
const STRATA_STOREY = 4.2;

/**
 * Horizontal strata: a balcony slab at every storey projecting from the wall, its depth swelling
 * and receding along the facade, alternately closed by a solid upstand and left open behind a
 * slim rail, so the elevation reads as bands of varied openness.
 */
function buildHorizontalStrata(samples: FacadeRailSample[], closed: boolean, facadeMat: THREE.Material, frameMat: THREE.Material): THREE.Group | null {
  const rail = createRailSampler(samples, closed);
  if (!rail) return null;
  const { totalLen, sampleAtArc } = rail;
  const segs = Math.max(8, Math.round(totalLen / 3));
  const slabs: THREE.Matrix4[] = [];
  const upstands: THREE.Matrix4[] = [];
  const rails: THREE.Matrix4[] = [];
  // Whole waves around a closed ring so the swell meets itself.
  const waves = Math.max(1, Math.round(totalLen / 60));
  const at = (s: number, y: number, out: number) => {
    const pt = sampleAtArc(closed ? s % totalLen : s);
    return new THREE.Vector3(pt.x + pt.nx * out, y, pt.z + pt.nz * out);
  };
  const ref = sampleAtArc(0);
  const levels = Math.max(1, Math.floor((ref.yTop - ref.yBottom - 1) / STRATA_STOREY));
  for (let l = 1; l <= levels; l++) {
    const solid = l % 2 === 0;
    for (let i = 0; i < segs; i++) {
      const s0 = (i / segs) * totalLen;
      const s1 = ((i + 1) / segs) * totalLen;
      const mid = sampleAtArc(closed ? ((s0 + s1) / 2) % totalLen : (s0 + s1) / 2);
      const y = mid.yBottom + l * STRATA_STOREY;
      if (y > mid.yTop - 0.6) continue;
      const depth = 1.4 + 1.1 * Math.sin(((s0 + s1) / 2 / totalLen) * Math.PI * 2 * waves + l * 1.1);
      const out = depth / 2 + 0.3;
      slabs.push(slabMatrix(at(s0, y, out), at(s1, y, out), depth, 0.3));
      const edge = depth + 0.3;
      if (solid) upstands.push(slabMatrix(at(s0, y + 0.6, edge), at(s1, y + 0.6, edge), 0.2, 1.0));
      else rails.push(slabMatrix(at(s0, y + 1.05, edge), at(s1, y + 1.05, edge), 0.08, 0.08));
    }
  }
  const group = new THREE.Group();
  group.name = 'EnvelopeHorizontalStrata';
  for (const mesh of [
    instancedBoxes('StrataSlabs', slabs, facadeMat),
    instancedBoxes('StrataUpstands', upstands, facadeMat),
    instancedBoxes('StrataRails', rails, frameMat),
  ]) {
    if (mesh) group.add(mesh);
  }
  return group.children.length > 0 ? group : null;
}

/** Outward bow (m) of a bulged skin at relative height `f` (0 = bottom, 1 = top). */
function bulgeOffset(bulge: number, f: number): number {
  return Math.max(0, Math.min(1, bulge)) * 6 * Math.sin(Math.PI * f);
}

/**
 * Tiled skins standing proud of the facade: `triangulated_lace` (Jean Bouin) alternates up- and
 * down-pointing triangular panels whose size varies across the skin, and `scales` (La Défense
 * Arena) hangs rows of shingles tilted out at the bottom so each overlaps the row below.
 */
function buildTiledSkin(
  pattern: 'triangulated_lace' | 'scales',
  sampleAtArc: (s: number) => FacadeRailSample,
  totalLen: number,
  closed: boolean,
  density: number,
  depth: number,
  bulge: number,
  mat: THREE.Material,
  group: THREE.Group
): THREE.Group {
  const lace = pattern === 'triangulated_lace';
  const tileW = lace ? Math.max(2.2, 4.6 / density) : Math.max(2.0, 4.2 / density);
  const cols = Math.max(4, Math.min(400, Math.round(totalLen / tileW)));
  const stepS = totalLen / cols;
  const dummy = new THREE.Object3D();
  const matrices: THREE.Matrix4[] = [];
  const probe = sampleAtArc(0);
  const refH = Math.max(4, probe.yTop - probe.yBottom - 0.5);
  const rows = lace
    ? Math.max(2, Math.round(refH / (stepS * 0.87)))
    : Math.max(1, Math.min(5, Math.round(density * 2.4)));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols * (lace ? 2 : 1); c++) {
      // Lace: two triangles per column (pointing up, then down); scales: offset every other row.
      const sCenter = lace ? (c * 0.5 + 0.25 + (r % 2) * 0.5) * stepS : (c + 0.5 + (r % 2) * 0.5) * stepS;
      if (!closed && (sCenter < stepS * 0.3 || sCenter > totalLen - stepS * 0.3)) continue;
      const pt = sampleAtArc(closed ? sCenter % totalLen : sCenter);
      const wallH = pt.yTop - pt.yBottom - 0.5;
      if (wallH < 2.5) continue;
      const rowH = wallH / rows;
      const f = (r + 0.5) / rows;
      const yaw = Math.atan2(pt.nx, pt.nz);
      const out = depth * 0.5 + bulgeOffset(bulge, f);
      dummy.position.set(pt.x + pt.nx * out, pt.yBottom + 0.25 + rowH * (r + 0.5), pt.z + pt.nz * out);
      if (lace) {
        // Panel size breathes across the skin so the openings between panels vary.
        const breathe = 0.72 + 0.22 * Math.sin(sCenter * 0.21 + r * 1.3) * Math.cos(sCenter * 0.07);
        const flip = (c + r) % 2 === 0 ? 0 : Math.PI;
        dummy.rotation.set(0, yaw, flip, 'YXZ');
        dummy.scale.set(stepS * breathe, rowH * breathe, Math.max(0.12, depth * 0.3));
      } else {
        dummy.rotation.set(-0.16, yaw, 0, 'YXZ');
        dummy.scale.set(stepS * 1.04, rowH * 1.12, Math.max(0.2, depth * 0.4));
      }
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    }
  }

  if (matrices.length > 0) {
    let geo: THREE.BufferGeometry;
    if (lace) {
      // Unit triangle (width 1, height 1) pointing up, extruded along +z.
      const tri = new THREE.Shape([
        new THREE.Vector2(-0.5, -0.5),
        new THREE.Vector2(0.5, -0.5),
        new THREE.Vector2(0, 0.5),
      ]);
      geo = new THREE.ExtrudeGeometry(tri, { depth: 1, bevelEnabled: false });
      geo.translate(0, 0, -0.5);
    } else {
      // Shingle: a shallow cylindrical shell, convex outward, 1 x 1 x 1.
      geo = new THREE.CylinderGeometry(0.62, 0.62, 1, 12, 1, true, -Math.PI / 4, Math.PI / 2);
      geo.rotateZ(Math.PI / 2);
      geo.rotateY(Math.PI / 2);
      geo.translate(0, 0, -0.44);
    }
    geo.computeVertexNormals();
    const inst = new THREE.InstancedMesh(geo, mat, matrices.length);
    inst.name = lace ? 'FacadeLacePanels' : 'FacadeScales';
    matrices.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }
  return group;
}

/** A facade cell as a convex polygon unrolled on the rail: `s` = arc length (m), `v` = height share. */
type FacadeCell = { s: number; v: number }[];

/** Share of each cell kept as panel; the rest opens as a joint between neighbours. */
const CELL_FILL = 0.84;

function shrinkCell(cell: FacadeCell): FacadeCell {
  const cs = cell.reduce((a, p) => a + p.s, 0) / cell.length;
  const cv = cell.reduce((a, p) => a + p.v, 0) / cell.length;
  return cell.map((p) => ({ s: cs + (p.s - cs) * CELL_FILL, v: cv + (p.v - cv) * CELL_FILL }));
}

function referenceHeight(sampleAtArc: (s: number) => FacadeRailSample, totalLen: number): number {
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const pt = sampleAtArc(((i + 0.5) / 8) * totalLen);
    sum += Math.max(0, pt.yTop - pt.yBottom - 0.5);
  }
  return Math.max(4, sum / 8);
}

/** Pointy-top hexagons in staggered rows, seamless around a closed rail. */
function honeycombCells(
  totalLen: number,
  closed: boolean,
  density: number,
  sampleAtArc: (s: number) => FacadeRailSample
): FacadeCell[] {
  const refH = referenceHeight(sampleAtArc, totalLen);
  const radius = Math.max(1.1, 2.4 / density);
  const cols = Math.max(4, Math.min(360, Math.round(totalLen / (Math.sqrt(3) * radius))));
  const w = totalLen / cols;
  const rows = Math.max(2, Math.round(refH / (1.5 * radius)));
  const dv = 1 / rows;
  // Hexagon height spans 4/3 of the row pitch so rows interlock.
  const hv = (dv * 4) / 3;
  const cells: FacadeCell[] = [];
  for (let r = 0; r <= rows; r++) {
    const cv = r * dv;
    for (let c = 0; c < cols + (closed ? 0 : 1); c++) {
      const cs = (c + (r % 2) * 0.5) * w;
      const cell: FacadeCell = [];
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 2 + (k * Math.PI) / 3;
        cell.push({ s: cs + Math.cos(a) * w * 0.5 * (2 / Math.sqrt(3)), v: cv + Math.sin(a) * hv * 0.5 });
      }
      const clipped = closed ? cell : clipCell(cell, 's', 0, totalLen);
      const inBand = clipCell(clipped, 'v', 0, 1);
      if (inBand.length >= 3) cells.push(shrinkCell(inBand));
    }
  }
  return cells;
}

/** Deterministic pseudo-random in `[0, 1)`. */
function hash01(a: number, b: number): number {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Clips a convex cell to `lo <= p[key] <= hi`. */
function clipCell(cell: FacadeCell, key: 's' | 'v', lo: number, hi: number): FacadeCell {
  let out = clipHalfPlane(cell, (p) => p[key] - lo);
  out = clipHalfPlane(out, (p) => hi - p[key]);
  return out;
}

/** Keeps the part of `cell` where `side(p) >= 0` (side is affine in the point). */
function clipHalfPlane(cell: FacadeCell, side: (p: { s: number; v: number }) => number): FacadeCell {
  const out: FacadeCell = [];
  for (let i = 0; i < cell.length; i++) {
    const a = cell[i];
    const b = cell[(i + 1) % cell.length];
    const da = side(a);
    const db = side(b);
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push({ s: a.s + (b.s - a.s) * t, v: a.v + (b.v - a.v) * t });
    }
  }
  return out;
}

/**
 * Voronoi cells of jittered seeds, rows packed tighter toward the top so the cells get finer as
 * the facade rises. Each cell is the seed's square neighbourhood clipped by the bisectors of the
 * nearby seeds (in metres, so cells keep their proportions on a tall or low wall).
 */
function voronoiCells(
  totalLen: number,
  closed: boolean,
  density: number,
  sampleAtArc: (s: number) => FacadeRailSample
): FacadeCell[] {
  const refH = referenceHeight(sampleAtArc, totalLen);
  const size = Math.max(2.2, 4.8 / density);
  const cols = Math.max(4, Math.min(240, Math.round(totalLen / size)));
  const w = totalLen / cols;
  const rows = Math.max(2, Math.round(refH / size));
  // Row lines warped so the upper rows are thinner.
  const rowV = (r: number) => 1 - Math.pow(1 - r / rows, 1.45);
  const seeds: { s: number; y: number; c: number; r: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const v0 = rowV(r);
    const v1 = rowV(r + 1);
    for (let c = 0; c < cols; c++) {
      const v = v0 + (v1 - v0) * (0.2 + 0.6 * hash01(c, r + 7));
      seeds.push({ s: (c + 0.15 + 0.7 * hash01(c + 3, r)) * w, y: v * refH, c, r });
    }
  }
  const seedAt = (c: number, r: number) => {
    if (r < 0 || r >= rows) return null;
    if (closed) {
      const wrapped = ((c % cols) + cols) % cols;
      const seed = seeds[r * cols + wrapped];
      return { s: seed.s + (c - wrapped) * w, y: seed.y };
    }
    if (c < 0 || c >= cols) return null;
    return seeds[r * cols + c];
  };

  const cells: FacadeCell[] = [];
  for (const seed of seeds) {
    const reach = Math.max(w, refH / rows) * 3;
    let poly: { s: number; v: number }[] = [
      { s: seed.s - reach, v: seed.y - reach },
      { s: seed.s + reach, v: seed.y - reach },
      { s: seed.s + reach, v: seed.y + reach },
      { s: seed.s - reach, v: seed.y + reach },
    ];
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        if (dr === 0 && dc === 0) continue;
        const o = seedAt(seed.c + dc, seed.r + dr);
        if (!o) continue;
        const ms = (seed.s + o.s) / 2;
        const my = (seed.y + o.y) / 2;
        const ds = seed.s - o.s;
        const dy = seed.y - o.y;
        poly = clipHalfPlane(poly, (p) => (p.s - ms) * ds + (p.v - my) * dy);
        if (poly.length < 3) break;
      }
    }
    let cell: FacadeCell = poly.map((p) => ({ s: p.s, v: p.v / refH }));
    if (!closed) cell = clipCell(cell, 's', 0, totalLen);
    cell = clipCell(cell, 'v', 0, 1);
    if (cell.length >= 3) cells.push(shrinkCell(cell));
  }
  return cells;
}

/** Extrudes unrolled cells into panels standing proud of the rail (one merged mesh). */
function extrudeCellsOnRail(
  cells: FacadeCell[],
  sampleAtArc: (s: number) => FacadeRailSample,
  totalLen: number,
  closed: boolean,
  depth: number,
  bulge: number
): THREE.BufferGeometry | null {
  const thickness = Math.max(0.12, depth * 0.35);
  const positions: number[] = [];
  const uvs: number[] = [];
  const toWorld = (p: { s: number; v: number }, front: boolean): THREE.Vector3 | null => {
    const s = closed ? ((p.s % totalLen) + totalLen) % totalLen : p.s;
    const pt = sampleAtArc(s);
    const wallH = pt.yTop - pt.yBottom - 0.5;
    if (wallH < 2.5) return null;
    const out = depth * 0.5 + bulgeOffset(bulge, p.v) + (front ? 0 : -thickness);
    return new THREE.Vector3(pt.x + pt.nx * out, pt.yBottom + 0.25 + p.v * wallH, pt.z + pt.nz * out);
  };
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, flip: boolean) => {
    const [p, q, r] = flip ? [a, c, b] : [a, b, c];
    positions.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
    for (const v of [p, q, r]) uvs.push(v.x * 0.25 + v.z * 0.25, v.y * 0.25);
  };

  for (const cell of cells) {
    const front = cell.map((p) => toWorld(p, true));
    const back = cell.map((p) => toWorld(p, false));
    if (front.some((v) => !v) || back.some((v) => !v)) continue;
    const f = front as THREE.Vector3[];
    const b = back as THREE.Vector3[];
    const cf = f.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(f.length);
    const cb = b.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(b.length);
    // Face the front fan outward, whichever way the rail runs.
    const outward = new THREE.Vector3().subVectors(cf, cb);
    const n = new THREE.Vector3().crossVectors(
      new THREE.Vector3().subVectors(f[0], cf),
      new THREE.Vector3().subVectors(f[1], cf)
    );
    const flip = n.dot(outward) < 0;
    for (let i = 0; i < f.length; i++) {
      const j = (i + 1) % f.length;
      tri(cf, f[i], f[j], flip);
      tri(cb, b[j], b[i], flip);
      tri(f[i], b[i], b[j], flip);
      tri(f[i], b[j], f[j], flip);
    }
  }
  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Generates a real 3D parametric facade relief assembly (`vertical_fins`, `diagrid`, or `cassette_panels`)
 * along a sequence of exterior wall samples (`samples[0..N-1]`).
 * Uses `InstancedMesh` so hundreds of fins, diagrid struts, or faceted cassettes render in 1-2 draw calls.
 */
export function buildParametricFacadeOnRail(params: {
  samples: FacadeRailSample[];
  closed: boolean;
  pattern: FacadePatternId;
  density: number;
  depth: number;
  /** Outward bow of `triangulated_lace` and `scales` skins (`0..1`, up to 6 m at mid-height). */
  bulge?: number;
  primaryMat: THREE.Material;
  accentMat: THREE.Material;
  name?: string;
}): THREE.Group | null {
  const {
    samples,
    closed,
    pattern,
    density,
    depth,
    bulge = 0,
    primaryMat,
    accentMat,
    name = 'ParametricFacadeRelief',
  } = params;

  if (pattern === 'none' || samples.length < 2) {
    return null;
  }

  const safeDensity = Math.max(0.4, Math.min(2.2, density));
  const safeDepth = Math.max(0.15, Math.min(2.4, depth));

  const rail = createRailSampler(samples, closed);
  if (!rail) return null;
  const { totalLen, sampleAtArc } = rail;

  const group = new THREE.Group();
  group.name = name;

  const dummy = new THREE.Object3D();
  const upVec = new THREE.Vector3(0, 1, 0);
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const qOrient = new THREE.Quaternion();

  if (pattern === 'triangulated_lace' || pattern === 'scales') {
    return buildTiledSkin(pattern, sampleAtArc, totalLen, closed, safeDensity, safeDepth, bulge, primaryMat, group);
  }

  if (pattern === 'honeycomb' || pattern === 'voronoi') {
    const cells =
      pattern === 'honeycomb'
        ? honeycombCells(totalLen, closed, safeDensity, sampleAtArc)
        : voronoiCells(totalLen, closed, safeDensity, sampleAtArc);
    const geo = extrudeCellsOnRail(cells, sampleAtArc, totalLen, closed, safeDepth, bulge);
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, primaryMat);
    mesh.name = pattern === 'honeycomb' ? 'FacadeHoneycomb' : 'FacadeVoronoi';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return group;
  }

  if (pattern === 'vertical_fins') {
    const spacing = Math.max(1.1, 2.85 / safeDensity);
    const finCount = Math.max(4, Math.min(480, Math.round(totalLen / spacing)));
    const stepS = totalLen / finCount;
    const finThickness = Math.max(0.08, Math.min(0.22, 0.14 / Math.sqrt(safeDensity)));

    const matrices: THREE.Matrix4[] = [];
    const tieMatrices: THREE.Matrix4[] = [];

    for (let i = 0; i < finCount; i++) {
      const s = closed ? i * stepS : (i + 0.5) * stepS;
      const pt = sampleAtArc(s);
      const h = pt.yTop - pt.yBottom - 0.5;
      if (h < 1.8) continue;

      const yaw = Math.atan2(pt.nx, pt.nz);
      // Slight rhythmic architectural twist (18° sun-shading louver angle)
      const louverTwist = 0.31;
      const outShift = safeDepth * 0.52 + 0.06;

      dummy.position.set(
        pt.x + pt.nx * outShift,
        pt.yBottom + 0.25 + h * 0.5,
        pt.z + pt.nz * outShift
      );
      dummy.rotation.set(0, yaw + louverTwist, 0);
      dummy.scale.set(finThickness, h, safeDepth);
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());

      // Horizontal collector rail segment at mid-height and top
      const bayLen = stepS * 1.03;
      for (const frac of [0.35, 0.72]) {
        dummy.position.set(
          pt.x + pt.nx * 0.16,
          pt.yBottom + 0.25 + h * frac,
          pt.z + pt.nz * 0.16
        );
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.set(bayLen, 0.16, 0.24);
        dummy.updateMatrix();
        tieMatrices.push(dummy.matrix.clone());
      }
    }

    if (matrices.length > 0) {
      const finGeom = new THREE.BoxGeometry(1, 1, 1);
      const finInst = new THREE.InstancedMesh(finGeom, primaryMat, matrices.length);
      finInst.name = 'FacadeVerticalFins';
      for (let i = 0; i < matrices.length; i++) {
        finInst.setMatrixAt(i, matrices[i]);
      }
      finInst.instanceMatrix.needsUpdate = true;
      finInst.castShadow = true;
      finInst.receiveShadow = true;
      group.add(finInst);
    }

    if (tieMatrices.length > 0) {
      const tieGeom = new THREE.BoxGeometry(1, 1, 1);
      const tieInst = new THREE.InstancedMesh(tieGeom, accentMat, tieMatrices.length);
      tieInst.name = 'FacadeFinCollectors';
      for (let i = 0; i < tieMatrices.length; i++) {
        tieInst.setMatrixAt(i, tieMatrices[i]);
      }
      tieInst.instanceMatrix.needsUpdate = true;
      group.add(tieInst);
    }

    return group;
  }

  if (pattern === 'diagrid') {
    const bayWidth = Math.max(3.2, 7.6 / safeDensity);
    const bayCount = Math.max(4, Math.min(220, Math.round(totalLen / bayWidth)));
    const stepS = totalLen / bayCount;
    const courses = Math.max(2, Math.min(6, Math.round(2.4 * safeDensity)));
    const outOffset = safeDepth * 0.55 + 0.12;
    const ribRadius = Math.max(0.11, Math.min(0.36, 0.12 + safeDepth * 0.085));

    const strutMatrices: THREE.Matrix4[] = [];
    const ringMatrices: THREE.Matrix4[] = [];

    for (let i = 0; i < bayCount; i++) {
      const s0 = i * stepS;
      const s1 = (i + 1) * stepS;
      const pt0 = sampleAtArc(s0);
      const pt1 = sampleAtArc(closed && i === bayCount - 1 ? 0 : s1);

      const h0 = pt0.yTop - pt0.yBottom - 0.4;
      const h1 = pt1.yTop - pt1.yBottom - 0.4;
      if (h0 < 2.0 || h1 < 2.0) continue;

      for (let c = 0; c < courses; c++) {
        const fBot = c / courses;
        const fTop = (c + 1) / courses;

        const y0Bot = pt0.yBottom + 0.2 + h0 * fBot;
        const y0Top = pt0.yBottom + 0.2 + h0 * fTop;
        const y1Bot = pt1.yBottom + 0.2 + h1 * fBot;
        const y1Top = pt1.yBottom + 0.2 + h1 * fTop;

        // Rising diagonal: (pt0, bot) -> (pt1, top)
        pA.set(pt0.x + pt0.nx * outOffset, y0Bot, pt0.z + pt0.nz * outOffset);
        pB.set(pt1.x + pt1.nx * outOffset, y1Top, pt1.z + pt1.nz * outOffset);
        dir.subVectors(pB, pA);
        const lenUp = dir.length();
        if (lenUp > 0.25) {
          mid.addVectors(pA, pB).multiplyScalar(0.5);
          qOrient.setFromUnitVectors(upVec, dir.normalize());
          dummy.position.copy(mid);
          dummy.quaternion.copy(qOrient);
          dummy.scale.set(ribRadius, lenUp, safeDepth * 0.55 + ribRadius);
          dummy.updateMatrix();
          strutMatrices.push(dummy.matrix.clone());
        }

        // Falling diagonal: (pt0, top) -> (pt1, bot)
        pA.set(pt0.x + pt0.nx * outOffset, y0Top, pt0.z + pt0.nz * outOffset);
        pB.set(pt1.x + pt1.nx * outOffset, y1Bot, pt1.z + pt1.nz * outOffset);
        dir.subVectors(pB, pA);
        const lenDown = dir.length();
        if (lenDown > 0.25) {
          mid.addVectors(pA, pB).multiplyScalar(0.5);
          qOrient.setFromUnitVectors(upVec, dir.normalize());
          dummy.position.copy(mid);
          dummy.quaternion.copy(qOrient);
          dummy.scale.set(ribRadius, lenDown, safeDepth * 0.55 + ribRadius);
          dummy.updateMatrix();
          strutMatrices.push(dummy.matrix.clone());
        }

        // Horizontal node ring beam at top of course
        pA.set(pt0.x + pt0.nx * (outOffset * 0.78), y0Top, pt0.z + pt0.nz * (outOffset * 0.78));
        pB.set(pt1.x + pt1.nx * (outOffset * 0.78), y1Top, pt1.z + pt1.nz * (outOffset * 0.78));
        dir.subVectors(pB, pA);
        const ringLen = dir.length();
        if (ringLen > 0.2) {
          mid.addVectors(pA, pB).multiplyScalar(0.5);
          qOrient.setFromUnitVectors(upVec, dir.normalize());
          dummy.position.copy(mid);
          dummy.quaternion.copy(qOrient);
          dummy.scale.set(ribRadius * 0.75, ringLen, ribRadius * 0.9);
          dummy.updateMatrix();
          ringMatrices.push(dummy.matrix.clone());
        }
      }
    }

    if (strutMatrices.length > 0) {
      const strutGeom = new THREE.BoxGeometry(1, 1, 1);
      const strutInst = new THREE.InstancedMesh(
        strutGeom,
        accentMat,
        strutMatrices.length
      );
      strutInst.name = 'FacadeDiagridStruts';
      for (let i = 0; i < strutMatrices.length; i++) {
        strutInst.setMatrixAt(i, strutMatrices[i]);
      }
      strutInst.instanceMatrix.needsUpdate = true;
      strutInst.castShadow = true;
      strutInst.receiveShadow = true;
      group.add(strutInst);
    }

    if (ringMatrices.length > 0) {
      const ringGeom = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
      const ringInst = new THREE.InstancedMesh(
        ringGeom,
        primaryMat,
        ringMatrices.length
      );
      ringInst.name = 'FacadeDiagridRings';
      for (let i = 0; i < ringMatrices.length; i++) {
        ringInst.setMatrixAt(i, ringMatrices[i]);
      }
      ringInst.instanceMatrix.needsUpdate = true;
      group.add(ringInst);
    }

    return group;
  }

  // `cassette_panels`: staggered 3D faceted architectural cassettes
  const panelSpan = Math.max(2.4, 5.4 / safeDensity);
  const colCount = Math.max(4, Math.min(260, Math.round(totalLen / panelSpan)));
  const stepS = totalLen / colCount;
  const rowCount = Math.max(3, Math.min(10, Math.round(4.2 * safeDensity)));

  const cassetteMatrices: THREE.Matrix4[] = [];
  for (let r = 0; r < rowCount; r++) {
    const fBot = r / rowCount;
    const fTop = (r + 1) / rowCount;
    const stagger = (r % 2) * 0.5;
    const colsInRow = closed ? colCount : Math.max(2, colCount - (r % 2));

    for (let c = 0; c < colsInRow; c++) {
      const sCenter = (c + 0.5 + stagger) * stepS;
      if (!closed && (sCenter < stepS * 0.35 || sCenter > totalLen - stepS * 0.35)) {
        continue;
      }
      const pt = sampleAtArc(closed ? sCenter % totalLen : sCenter);
      const wallH = pt.yTop - pt.yBottom - 0.5;
      if (wallH < 2.2) continue;

      const panelH = Math.max(0.65, (wallH / rowCount) * 0.86);
      const panelW = Math.max(0.8, stepS * 0.88);
      const yMid = pt.yBottom + 0.25 + wallH * ((fBot + fTop) * 0.5);

      const yaw = Math.atan2(pt.nx, pt.nz);
      // Alternating subtle 3D facet tilt so light & sky reflections play across cassettes
      const checker = (c + r) % 2 === 0 ? 1 : -1;
      const pitchTilt = checker * Math.min(0.18, 0.05 + safeDepth * 0.055);
      const yawTilt = ((c % 3) - 1) * 0.055;
      const outShift = safeDepth * (0.42 + ((c + r) % 2) * 0.16);

      dummy.position.set(
        pt.x + pt.nx * outShift,
        yMid,
        pt.z + pt.nz * outShift
      );
      dummy.rotation.set(pitchTilt, yaw + yawTilt, 0, 'YXZ');
      dummy.scale.set(panelW, panelH, Math.max(0.14, safeDepth * 0.55));
      dummy.updateMatrix();
      cassetteMatrices.push(dummy.matrix.clone());
    }
  }

  if (cassetteMatrices.length > 0) {
    // Beveled 4-sided pyramid/frustum cassette box for crisp light-catching facets
    const baseGeom = new THREE.CylinderGeometry(0.62, 0.72, 1, 4, 1);
    baseGeom.rotateY(Math.PI * 0.25);
    baseGeom.rotateX(Math.PI * 0.5);
    baseGeom.computeVertexNormals();

    const cassetteInst = new THREE.InstancedMesh(
      baseGeom,
      primaryMat,
      cassetteMatrices.length
    );
    cassetteInst.name = 'FacadeCassettePanels';
    for (let i = 0; i < cassetteMatrices.length; i++) {
      cassetteInst.setMatrixAt(i, cassetteMatrices[i]);
    }
    cassetteInst.instanceMatrix.needsUpdate = true;
    cassetteInst.castShadow = true;
    cassetteInst.receiveShadow = true;
    group.add(cassetteInst);
  }

  return group;
}

/**
 * Convenience helper for straight stands in stand-local coordinates:
 * rear exterior wall sits at `z = rearWallZ` with outward normal `(0, 0, +1)` across `x in [-span/2, +span/2]`.
 */
export function buildStraightParametricFacade(params: {
  span: number;
  rearWallZ: number;
  yBottom: number;
  yTop: number;
  pattern: FacadePatternId;
  density: number;
  depth: number;
  /** Outward bow of `triangulated_lace` and `scales` skins (`0..1`, up to 6 m at mid-height). */
  bulge?: number;
  primaryMat: THREE.Material;
  accentMat: THREE.Material;
  name?: string;
}): THREE.Group | null {
  const {
    span,
    rearWallZ,
    yBottom,
    yTop,
    pattern,
    density,
    depth,
    bulge,
    primaryMat,
    accentMat,
    name,
  } = params;
  if (pattern === 'none' || span < 4 || yTop - yBottom < 2.0) return null;

  const samples: FacadeRailSample[] = [
    {
      x: -span * 0.49,
      z: rearWallZ,
      nx: 0,
      nz: 1,
      yBottom,
      yTop,
    },
    {
      x: span * 0.49,
      z: rearWallZ,
      nx: 0,
      nz: 1,
      yBottom,
      yTop,
    },
  ];

  return buildParametricFacadeOnRail({
    samples,
    closed: false,
    pattern,
    density,
    depth,
    bulge,
    primaryMat,
    accentMat,
    name,
  });
}

import * as THREE from 'three';
import { sampleCornerQuadrantPoint } from '../bowlRing';
import { createStrut } from '../meshKit';
import { cornerEnds, type CornerStructureContext } from './kit';

/** Rise (m) of the ramp per full turn, and its width. */
const RAMP_RISE_PER_TURN = 7;
const RAMP_WIDTH = 3;

/**
 * Band swept along a helix: radii `radiusIn`/`radiusOut` and offsets `y0`/`y1` above the helix
 * give a horizontal deck (equal offsets) or an upright parapet (equal radii).
 */
function helixBand(
  radiusIn: number,
  radiusOut: number,
  turns: number,
  height: number,
  y0: number,
  y1: number,
  mat: THREE.Material
): THREE.Mesh {
  const segs = Math.max(48, Math.round(turns * 64));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = t * turns * Math.PI * 2;
    const y = t * height;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pos.push(c * radiusIn, y + y0, s * radiusIn, c * radiusOut, y + y1, s * radiusOut);
    uv.push(t * turns * 8, 0, t * turns * 8, 1);
    if (i < segs) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat2 = mat.clone();
  mat2.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, mat2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Helical access tower (`spiral_tower`): a ribbed cylindrical core rising a little above the
 * stands, wound by an open pedestrian ramp with its parapet on slender posts, crowned by a glazed
 * lantern under a flat cap. Stands on the corner's bisector.
 */
export function buildCornerSpiralTower(ctx: CornerStructureContext): THREE.Group {
  const { corner, concreteMat, structureMat, facadeMat } = ctx;
  const ends = cornerEnds(ctx);
  const crest = Math.max(ends.a.height, ends.b.height);
  const reach = Math.min(ends.a.depth, ends.b.depth);
  const coreR = THREE.MathUtils.clamp(reach * 0.22, 4.5, 8);
  const height = crest + 4;
  const rampTop = height - 1.2;
  const turns = Math.max(1.5, rampTop / RAMP_RISE_PER_TURN);
  const rampOuter = coreR + RAMP_WIDTH;

  const local = new THREE.Group();

  // Core in the facade material, ribbed by slender piers.
  const core = new THREE.Mesh(new THREE.CylinderGeometry(coreR, coreR, height, 40), facadeMat);
  core.position.y = height / 2;
  core.castShadow = true;
  core.receiveShadow = true;
  local.add(core);
  const ribs = Math.max(12, Math.round((coreR * Math.PI * 2) / 2.4));
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2;
    const x = Math.cos(a) * (coreR + 0.15);
    const z = Math.sin(a) * (coreR + 0.15);
    local.add(createStrut(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, height, z), 0.16, 0.2, structureMat));
  }

  // The ramp: deck, edge fascia and parapet, held by posts at its outer edge.
  local.add(
    helixBand(coreR + 0.2, rampOuter, turns, rampTop, 0.3, 0.3, concreteMat),
    helixBand(rampOuter, rampOuter, turns, rampTop, -0.1, 0.3, concreteMat),
    helixBand(rampOuter - 0.1, rampOuter - 0.1, turns, rampTop, 0.3, 1.4, structureMat)
  );
  const posts = Math.max(8, Math.round(turns * 10));
  for (let i = 0; i < posts; i++) {
    const t = (i + 0.5) / posts;
    const a = t * turns * Math.PI * 2;
    const x = Math.cos(a) * (rampOuter - 0.3);
    const z = Math.sin(a) * (rampOuter - 0.3);
    local.add(createStrut(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, t * rampTop, z), 0.14, 0.16, structureMat));
  }

  // Glazed lantern under a flat cap, on a round plinth.
  const lanternMat = new THREE.MeshPhysicalMaterial({
    color: 0xdbeafe,
    roughness: 0.08,
    metalness: 0.2,
    transparent: true,
    opacity: 0.55,
    emissive: new THREE.Color(ctx.doc.lighting === 'day' ? 0x000000 : 0xfbbf24),
    emissiveIntensity: 0.5,
  });
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(coreR * 0.92, coreR * 0.92, 3, 32), lanternMat);
  lantern.position.y = height + 1.5;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(coreR + 1.2, coreR + 1.2, 0.5, 40), structureMat);
  cap.position.y = height + 3.25;
  cap.castShadow = true;
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(rampOuter + 0.6, rampOuter + 0.8, 0.5, 40), concreteMat);
  plinth.position.y = 0.25;
  plinth.receiveShadow = true;
  local.add(lantern, cap, plinth);

  // On the corner's bisector, halfway back through the stands' depth.
  const centre = sampleCornerQuadrantPoint(corner, 0.5, Math.max(rampOuter + 2, reach * 0.55));
  local.position.set(centre.x, 0, centre.z);
  const group = new THREE.Group();
  group.name = `CornerSpiralTower_${corner.id.toUpperCase()}`;
  group.add(local);
  return group;
}

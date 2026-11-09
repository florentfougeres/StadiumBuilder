import * as THREE from 'three';
import { sampleCornerQuadrantPoint } from '../bowlRing';
import { createStrut } from '../meshKit';
import { cornerEnds, type CornerStructureContext } from './kit';

/** Storey height (m) of the clubhouse. */
const STOREY = 4.2;

const brickMat = () => new THREE.MeshStandardMaterial({ color: 0x9a4a33, roughness: 0.92 });
const slateMat = () => new THREE.MeshStandardMaterial({ color: 0x39404c, roughness: 0.78, metalness: 0.08 });
const trimMat = () => new THREE.MeshStandardMaterial({ color: 0xf2eee4, roughness: 0.6 });
const windowMat = () => new THREE.MeshStandardMaterial({ color: 0x1b2533, roughness: 0.2, metalness: 0.4 });

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Gable roof `span` across its slopes, `length` along its ridge (local Z), ridge `rise` above the eaves. */
function gableRoof(span: number, length: number, rise: number, eave: number, mat: THREE.Material): THREE.Mesh {
  const hw = span / 2 + eave;
  const drop = eave * (rise / (span / 2));
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -drop);
  shape.lineTo(hw, -drop);
  shape.lineTo(0, rise);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: length + eave * 2, bevelEnabled: false });
  geo.translate(0, 0, -(length / 2 + eave));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Historic brick clubhouse (`pavilion`), after the pavilions set in the corner of old English
 * grounds: brick storeys under a slate roof whose ridge runs along the pitch-facing front, a
 * central cross gable with a clock, a white timber veranda on the ground floor carrying a balcony,
 * sash windows and chimneys. Built facing local +Z, then turned onto the corner's bisector.
 */
export function buildCornerPavilion(ctx: CornerStructureContext): THREE.Group {
  const { corner } = ctx;
  const ends = cornerEnds(ctx);
  const reach = Math.min(ends.a.depth, ends.b.depth);
  const depth = THREE.MathUtils.clamp(reach * 0.62, 10, 17);
  const verandaD = 3.2;
  // Width the corner leaves at the building's depth, clear of the stands' ends.
  const mid = sampleCornerQuadrantPoint(corner, 0.5, 2.5 + verandaD + depth / 2);
  const edge = sampleCornerQuadrantPoint(corner, 0.08, 2.5 + verandaD + depth / 2);
  const width = THREE.MathUtils.clamp(Math.hypot(mid.x - edge.x, mid.z - edge.z) * 2, 14, 30);
  const storeys = Math.max(2, Math.min(3, Math.round(Math.max(ends.a.height, ends.b.height) / 10)));
  const wallH = storeys * STOREY + 0.6;

  const brick = brickMat();
  const slate = slateMat();
  const trim = trimMat();
  const glass = windowMat();
  const local = new THREE.Group();

  // Brick body on a stone plinth, a cornice at the eaves.
  local.add(
    box(width + 0.4, 0.6, depth + 0.4, ctx.concreteMat, 0, 0.3, 0),
    box(width, wallH, depth, brick, 0, 0.6 + wallH / 2, 0),
    box(width + 0.5, 0.35, depth + 0.5, trim, 0, 0.6 + wallH, 0)
  );

  // Slate roof with its ridge along the front, and a central cross gable with a clock.
  const roofY = 0.6 + wallH + 0.17;
  const roof = gableRoof(depth, width, depth * 0.42, 0.7, slate);
  roof.rotation.y = Math.PI / 2;
  roof.position.y = roofY;
  local.add(roof);
  const gableW = Math.min(8, width * 0.34);
  const gableRise = gableW * 0.55;
  const cross = gableRoof(gableW, depth / 2, gableRise, 0.5, slate);
  cross.position.set(0, roofY, depth / 4);
  local.add(cross);
  const pediment = new THREE.Shape();
  pediment.moveTo(-gableW / 2, 0);
  pediment.lineTo(gableW / 2, 0);
  pediment.lineTo(0, gableRise);
  pediment.closePath();
  const pedimentMesh = new THREE.Mesh(new THREE.ShapeGeometry(pediment), brick);
  pedimentMesh.position.set(0, roofY, depth / 2 + 0.02);
  const clockR = gableW * 0.13;
  const clock = new THREE.Mesh(new THREE.CircleGeometry(clockR, 24), trim);
  clock.position.set(0, roofY + gableRise * 0.38, depth / 2 + 0.05);
  const clockRim = new THREE.Mesh(new THREE.RingGeometry(clockR * 0.85, clockR, 24), glass);
  clockRim.position.set(0, roofY + gableRise * 0.38, depth / 2 + 0.06);
  local.add(pedimentMesh, clock, clockRim);

  // Chimney stacks near both ends of the ridge.
  for (const sx of [-1, 1]) {
    local.add(box(1.1, 3, 1.6, brick, sx * (width / 2 - 1.6), roofY + depth * 0.3, -depth * 0.1));
  }

  // White-framed sash windows on all four sides of every storey (the back faces the street).
  const bays = Math.max(3, Math.round(width / 3.4));
  for (let f = 0; f < storeys; f++) {
    const y = 0.6 + f * STOREY + STOREY * 0.55;
    for (let i = 0; i < bays; i++) {
      const x = -width / 2 + ((i + 0.5) * width) / bays;
      for (const sz of [1, -1]) {
        local.add(
          box(1.5, 2.1, 0.08, trim, x, y, sz * (depth / 2 + 0.02)),
          box(1.2, 1.8, 0.1, glass, x, y, sz * (depth / 2 + 0.05))
        );
      }
    }
    for (const sx of [-1, 1]) {
      for (const z of [-depth / 4, depth / 4]) {
        local.add(box(0.1, 1.8, 1.2, glass, sx * (width / 2 + 0.05), y, z));
      }
    }
  }

  // Ground-floor veranda: white posts under its deck, which is the first floor's balcony.
  const verandaZ = depth / 2 + verandaD;
  const posts = Math.max(4, Math.round(width / 3.2));
  for (let i = 0; i <= posts; i++) {
    const x = -width / 2 + (i * width) / posts;
    local.add(createStrut(new THREE.Vector3(x, 0.6, verandaZ), new THREE.Vector3(x, 0.6 + STOREY, verandaZ), 0.16, 0.18, trim, 8));
  }
  local.add(
    box(width + 0.6, 0.3, verandaD + 0.6, trim, 0, 0.6 + STOREY + 0.15, depth / 2 + verandaD / 2),
    box(width + 0.4, 0.2, verandaD + 0.4, ctx.concreteMat, 0, 0.7, depth / 2 + verandaD / 2)
  );
  const railY = 0.6 + STOREY + 0.3;
  local.add(box(width + 0.4, 0.12, 0.14, trim, 0, railY + 1.0, verandaZ));
  const balusters = Math.round(width / 0.6);
  for (let i = 0; i <= balusters; i++) {
    local.add(box(0.07, 1.0, 0.07, trim, -width / 2 + (i * width) / balusters, railY + 0.5, verandaZ));
  }

  // Onto the corner: centred on its bisector, the veranda facing the pitch.
  const anchor = sampleCornerQuadrantPoint(corner, 0.5, 2.5 + verandaD + depth / 2);
  local.position.set(anchor.x, 0, anchor.z);
  local.rotation.y = Math.atan2(-anchor.nx, -anchor.nz);
  const group = new THREE.Group();
  group.name = `CornerPavilion_${corner.id.toUpperCase()}`;
  group.add(local);
  return group;
}

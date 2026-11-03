import * as THREE from 'three';
import { CYCLING_TRACK_WIDTH_M, getCyclingTrackGeometry, PitchConfig } from './schema';

/** Length of the transition (m) over which straights ramp up to the full bend banking. */
const BANK_TRANSITION_M = 18;
/** Banking of the straights (degrees). */
const STRAIGHT_BANKING_DEG = 12;

/**
 * Lateral colour bands of the riding surface, from the inner edge outward: the blue apron
 * ("côte d'azur"), then the black measuring line, red sprinters' line and blue stayers' line.
 */
const BANDS: { from: number; to: number; color: number }[] = [
  { from: 0, to: 0.1, color: 0x3b6fb6 },
  { from: 0.12, to: 0.135, color: 0x111111 },
  { from: 0.2, to: 0.215, color: 0xc0392b },
  { from: 0.45, to: 0.465, color: 0x3b6fb6 },
];
const SURFACE_COLOR = 0xcfc8bb;

/** Point, outward normal and bend factor (0 on straights, 1 in bends) at arc length `s`. */
function stadiumPoint(sh: number, r: number, s: number) {
  const straight = 2 * sh;
  const bend = Math.PI * r;
  const perimeter = 2 * straight + 2 * bend;
  const u = ((s % perimeter) + perimeter) % perimeter;
  const bendFactor = (distIntoStraight: number) =>
    Math.max(0, 1 - Math.min(distIntoStraight, straight - distIntoStraight) / BANK_TRANSITION_M);
  if (u < straight) {
    return { x: -sh + u, z: r, nx: 0, nz: 1, bend: bendFactor(u) };
  }
  if (u < straight + bend) {
    const th = Math.PI / 2 - (u - straight) / r;
    return { x: sh + r * Math.cos(th), z: r * Math.sin(th), nx: Math.cos(th), nz: Math.sin(th), bend: 1 };
  }
  if (u < 2 * straight + bend) {
    const d = u - straight - bend;
    return { x: sh - d, z: -r, nx: 0, nz: -1, bend: bendFactor(d) };
  }
  const th = -Math.PI / 2 - (u - 2 * straight - bend) / r;
  return { x: -sh + r * Math.cos(th), z: r * Math.sin(th), nx: Math.cos(th), nz: Math.sin(th), bend: 1 };
}

/**
 * Banked concrete cycling track: the riding surface rises outward at the banking angle (gentle on
 * the straights, steep in the bends), with painted lines, an outer retaining wall down to the
 * ground and a safety balustrade on top.
 */
export function buildVelodrome(pitch: PitchConfig, crossSectionClip: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Velodrome';
  const g = getCyclingTrackGeometry(pitch);
  const sh = g.straightHalfLength;
  const r = g.innerRadius;
  const perimeter = 4 * sh + 2 * Math.PI * r;
  const segs = Math.max(160, Math.round(perimeter / 2));

  // Lateral stations: band edges duplicated so colours change sharply.
  const lateral: { f: number; color: number }[] = [];
  let f = 0;
  for (const band of BANDS) {
    if (band.from > f) lateral.push({ f, color: SURFACE_COLOR }, { f: band.from, color: SURFACE_COLOR });
    lateral.push({ f: band.from, color: band.color }, { f: band.to, color: band.color });
    f = band.to;
  }
  lateral.push({ f, color: SURFACE_COLOR }, { f: 1, color: SURFACE_COLOR });

  const height = (bend: number, w: number) => {
    const deg = STRAIGHT_BANKING_DEG + (g.banking - STRAIGHT_BANKING_DEG) * bend;
    return 0.06 + w * Math.tan((deg * Math.PI) / 180);
  };

  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const wallPos: number[] = [];
  const wallIdx: number[] = [];
  const color = new THREE.Color();
  const cols = lateral.length;
  // The cross-section keeps the north half (z <= 0).
  const visible = (z: number) => !crossSectionClip || z <= 0.01;
  for (let k = 0; k <= segs; k++) {
    const p = stadiumPoint(sh, r, (k / segs) * perimeter);
    for (const { f: lf, color: c } of lateral) {
      const w = lf * CYCLING_TRACK_WIDTH_M;
      pos.push(p.x + p.nx * w, height(p.bend, w), p.z + p.nz * w);
      color.setHex(c);
      col.push(color.r, color.g, color.b);
    }
    const top = height(p.bend, CYCLING_TRACK_WIDTH_M);
    const ox = p.x + p.nx * CYCLING_TRACK_WIDTH_M;
    const oz = p.z + p.nz * CYCLING_TRACK_WIDTH_M;
    wallPos.push(ox, 0, oz, ox, top + 1.1, oz);
    if (k < segs && visible(p.z)) {
      for (let c = 0; c < cols - 1; c++) {
        const a = k * cols + c;
        const b = a + cols;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
      wallIdx.push(k * 2, k * 2 + 2, k * 2 + 1, k * 2 + 1, k * 2 + 2, k * 2 + 3);
    }
  }

  const surfGeo = new THREE.BufferGeometry();
  surfGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  surfGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  surfGeo.setIndex(idx);
  surfGeo.computeVertexNormals();
  const surface = new THREE.Mesh(
    surfGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, side: THREE.DoubleSide })
  );
  surface.name = 'VelodromeSurface';
  surface.receiveShadow = true;
  surface.castShadow = true;

  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wallPos, 3));
  wallGeo.setIndex(wallIdx);
  wallGeo.computeVertexNormals();
  const wall = new THREE.Mesh(
    wallGeo,
    new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 0.9, side: THREE.DoubleSide })
  );
  wall.name = 'VelodromeRetainingWall';
  wall.castShadow = true;
  group.add(surface, wall);
  return group;
}

/**
 * Movable pitch tray over an arena floor: `half_lift` raises the east half and slides it over the
 * west half; `slide_out` rolls the whole pitch out past the east end. The turf texture rides on
 * the tray, so lines and stripes move with it.
 */
export function buildMovablePitch(
  pitch: PitchConfig,
  turfMap: THREE.Texture,
  totalLength: number,
  totalWidth: number
): THREE.Group | null {
  const mode = pitch.movablePitch ?? 'none';
  const state = Math.max(0, Math.min(1, pitch.movablePitchState ?? 0));
  if (mode === 'none' || state <= 0) return null;
  const group = new THREE.Group();
  group.name = 'MovablePitch';

  const half = mode === 'half_lift';
  const floorL = half ? totalLength / 2 : totalLength;
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(floorL, 0.5, totalWidth),
    new THREE.MeshStandardMaterial({ color: 0x5b6470, roughness: 0.85 })
  );
  floor.name = 'ArenaFloor';
  floor.position.set(half ? totalLength / 4 : 0, 0.25, 0);
  floor.receiveShadow = true;
  group.add(floor);

  const map = turfMap.clone();
  map.needsUpdate = true;
  if (half) {
    map.repeat.set(0.5, 1);
    map.offset.set(0.5, 0);
  }
  const tray = new THREE.Group();
  tray.name = 'PitchTray';
  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(floorL, totalWidth).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map, roughness: 0.95 })
  );
  top.position.y = 1.21;
  top.receiveShadow = true;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(floorL, 1.2, totalWidth),
    new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.6, metalness: 0.4 })
  );
  body.position.y = 0.6;
  body.castShadow = true;
  tray.add(body, top);

  if (half) {
    // Lift to 6 m during the first half of the move, then slide over the west half.
    const lift = 6 * Math.min(1, state * 2);
    const slide = (-totalLength / 2) * Math.max(0, state * 2 - 1);
    tray.position.set(totalLength / 4 + slide, lift, 0);
  } else {
    tray.position.set(state * (totalLength + 60), 0, 0);
  }
  group.add(tray);
  return group;
}

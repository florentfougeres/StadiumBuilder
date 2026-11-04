import * as THREE from 'three';
import { PitchConfig } from './schema';

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

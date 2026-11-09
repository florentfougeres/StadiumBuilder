import * as THREE from 'three';
import type { LightingMode } from './schema';

/**
 * Themed landmarks set on the forecourt or in an end zone: a lighthouse with an observation bridge
 * stub, and a three-masted galleon. Generic forms, sized like the ones that stand in stadiums.
 */

/** Lighthouse 42 m tall: banded tapering tower, gallery, glazed lantern lit at night, domed cap. */
export function buildLighthouse(lighting: LightingMode, color?: string): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Lighthouse';
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f0ea, roughness: 0.7 });
  const band = new THREE.MeshStandardMaterial({ color: color ?? '#b91c1c', roughness: 0.6 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x1f2933, roughness: 0.4, metalness: 0.7 });
  const towerH = 34;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 7.2, 3, 24), new THREE.MeshStandardMaterial({ color: 0x8b8a84, roughness: 0.9 }));
  base.position.y = 1.5;
  group.add(base);
  // Tower in stacked rings so the bands follow the taper.
  const rings = 6;
  for (let i = 0; i < rings; i++) {
    const h = towerH / rings;
    const r0 = 5 - (i / rings) * 2.2;
    const r1 = 5 - ((i + 1) / rings) * 2.2;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, 28), i % 2 === 1 ? band : white);
    ring.position.y = 3 + h * (i + 0.5);
    ring.castShadow = true;
    ring.receiveShadow = true;
    group.add(ring);
  }
  const topY = 3 + towerH;
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 3.2, 0.8, 28), iron);
  gallery.position.y = topY + 0.4;
  group.add(gallery);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(4.1, 0.08, 6, 40), iron);
  rail.rotation.x = Math.PI / 2;
  rail.position.y = topY + 1.9;
  group.add(rail);
  const night = lighting !== 'day';
  const lantern = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.4, 3.6, 12),
    new THREE.MeshStandardMaterial({
      color: 0xfff7d6,
      emissive: new THREE.Color(0xffe9a8),
      emissiveIntensity: night ? 2.2 : 0.25,
      transparent: true,
      opacity: 0.75,
      roughness: 0.1,
    })
  );
  lantern.position.y = topY + 2.6;
  group.add(lantern);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.6, 0.12), iron);
    mullion.position.set(Math.cos(a) * 2.45, topY + 2.6, Math.sin(a) * 2.45);
    group.add(mullion);
  }
  const cap = new THREE.Mesh(new THREE.SphereGeometry(2.7, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), band);
  cap.position.y = topY + 4.4;
  group.add(cap);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.25, 2.2, 8), iron);
  spire.position.y = topY + 8;
  group.add(spire);
  // Observation bridge leaving the tower at mid-height toward local +x (the stadium).
  const deck = new THREE.Mesh(new THREE.BoxGeometry(22, 1.2, 4.5), iron);
  deck.position.set(14, 18, 0);
  deck.castShadow = true;
  group.add(deck);
  for (const z of [-2.2, 2.2]) {
    const parapet = new THREE.Mesh(new THREE.BoxGeometry(22, 1.2, 0.1), iron);
    parapet.position.set(14, 19.2, z);
    group.add(parapet);
  }
  return group;
}

/** Galleon 32 m long along local x (bow toward +x): curved hull, castles, three masts with sails. */
export function buildGalleon(color?: string): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Galleon';
  const hullMat = new THREE.MeshStandardMaterial({ color: color ?? '#5b3a22', roughness: 0.75 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.8 });
  const sailMat = new THREE.MeshStandardMaterial({ color: 0xefe6cf, roughness: 0.9, side: THREE.DoubleSide });
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x4a3324, roughness: 0.8 });
  const L = 32;
  const beam = 8;
  // Side profile: low waist, raised stern castle, rising bow.
  const profile = new THREE.Shape();
  profile.moveTo(-L / 2, 1.2);
  profile.quadraticCurveTo(-L / 2 + 2, -0.2, 0, 0);
  profile.quadraticCurveTo(L / 2 - 4, 0, L / 2, 4.2);
  profile.lineTo(L / 2 - 3, 6.2);
  profile.lineTo(-L / 2 + 9, 5.6);
  profile.lineTo(-L / 2 + 8, 9.4);
  profile.lineTo(-L / 2 - 0.6, 9.8);
  profile.lineTo(-L / 2, 1.2);
  const hullGeo = new THREE.ExtrudeGeometry(profile, { depth: beam, bevelEnabled: true, bevelThickness: 1.4, bevelSize: 0.8, bevelSegments: 3 });
  hullGeo.translate(0, 0, -beam / 2);
  // Pinch the hull toward bow and keel.
  const pos = hullGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const bow = Math.max(0, (x - L * 0.15) / (L * 0.35));
    const keel = 1 - Math.max(0, 1 - y / 3) * 0.45;
    pos.setZ(i, pos.getZ(i) * Math.max(0.15, 1 - bow * bow * 0.85) * keel);
  }
  hullGeo.computeVertexNormals();
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.castShadow = true;
  hull.receiveShadow = true;
  group.add(hull);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(L - 12, 0.3, beam - 0.6), trim);
  deck.position.set(1, 5.4, 0);
  group.add(deck);
  // Bowsprit.
  const sprit = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 11, 8), mastMat);
  sprit.rotation.z = -Math.PI / 2 + 0.35;
  sprit.position.set(L / 2 + 3.5, 6.8, 0);
  group.add(sprit);
  for (const [x, h, sails] of [
    [9, 22, 2],
    [0, 28, 3],
    [-9, 20, 2],
  ] as const) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, h, 10), mastMat);
    mast.position.set(x, 5.4 + h / 2, 0);
    mast.castShadow = true;
    group.add(mast);
    for (let k = 0; k < sails; k++) {
      const w = 11 - k * 2.2;
      const sh = (h - 5) / sails - 0.8;
      const y = 5.4 + 3.5 + k * (sh + 0.8) + sh / 2;
      // Billowed square sail across the ship.
      const sg = new THREE.PlaneGeometry(w, sh, 8, 6);
      const sp = sg.attributes.position;
      for (let i = 0; i < sp.count; i++) {
        const u = sp.getX(i) / (w / 2);
        const v = sp.getY(i) / (sh / 2);
        sp.setZ(i, (1 - u * u) * (1 - v * v * 0.5) * 1.3);
      }
      sg.computeVertexNormals();
      const sail = new THREE.Mesh(sg, sailMat);
      sail.rotation.y = Math.PI / 2;
      sail.position.set(x + 0.6, y, 0);
      sail.castShadow = true;
      group.add(sail);
      const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, w + 1, 6), mastMat);
      yard.rotation.x = Math.PI / 2;
      yard.position.set(x + 0.3, y + sh / 2, 0);
      group.add(yard);
    }
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.4), new THREE.MeshStandardMaterial({ color: 0x111111, side: THREE.DoubleSide }));
    flag.position.set(x - 1.2, 5.4 + h + 0.4, 0);
    group.add(flag);
  }
  return group;
}

/**
 * Free-standing tower 50 m tall (Florence marathon tower, Berlin bell tower): a slender square
 * shaft in concrete or stone with thin vertical slots, an open belvedere on four piers, a flat cap
 * and a flagpole.
 */
export function buildTower(color?: string): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Tower';
  const stone = new THREE.MeshStandardMaterial({ color: color ?? '#d9d4c7', roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6 });
  const shaftH = 42;
  const w = 6;
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(w, shaftH, w), stone);
  shaft.position.y = shaftH / 2;
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  group.add(shaft);
  // Tall narrow slots up each face.
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2;
    for (const off of [-1.4, 0, 1.4]) {
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.45, shaftH * 0.7, 0.1), dark);
      slot.position.set(Math.sin(a) * (w / 2 + 0.02) + Math.cos(a) * off, shaftH * 0.52, Math.cos(a) * (w / 2 + 0.02) - Math.sin(a) * off);
      slot.rotation.y = a;
      group.add(slot);
    }
  }
  // Belvedere: four corner piers carrying a projecting cap.
  const belvH = 5;
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(1.1, belvH, 1.1), stone);
    pier.position.set(x * (w / 2 - 0.55), shaftH + belvH / 2, z * (w / 2 - 0.55));
    pier.castShadow = true;
    group.add(pier);
  }
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 1.6, 1, w + 1.6), stone);
  cap.position.y = shaftH + belvH + 0.5;
  cap.castShadow = true;
  group.add(cap);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 9, 6), dark);
  pole.position.y = shaftH + belvH + 1 + 4.5;
  group.add(pole);
  return group;
}

/**
 * Footbridge 60 m long crossing an old bank or a moat to the stadium: a steel deck 5 m wide,
 * glass parapets and a shallow arch underneath, on piers at both ends. Its local +x points at
 * the stadium.
 */
export function buildFootbridge(color?: string): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Footbridge';
  const steel = new THREE.MeshStandardMaterial({ color: color ?? '#e5e7eb', roughness: 0.4, metalness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xbfdbfe, roughness: 0.1, transparent: true, opacity: 0.4 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.9 });
  const len = 60;
  const deckY = 9;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.7, 5), steel);
  deck.position.y = deckY;
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);
  for (const z of [-2.45, 2.45]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 1.1, 0.06), glass);
    rail.position.set(0, deckY + 0.9, z);
    group.add(rail);
    // Shallow arch under each edge of the deck.
    const pts = Array.from({ length: 17 }, (_, i) => {
      const x = -len / 2 + (len * i) / 16;
      return new THREE.Vector3(x, deckY - 0.4 - 3.5 * (1 - Math.pow((2 * x) / len, 2)) + 3.5, z);
    });
    const arch = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.25, 6), steel);
    group.add(arch);
  }
  for (const x of [-len / 2 + 1.5, len / 2 - 1.5]) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(3, deckY - 0.35, 5.6), concrete);
    pier.position.set(x, (deckY - 0.35) / 2, 0);
    pier.castShadow = true;
    group.add(pier);
  }
  return group;
}

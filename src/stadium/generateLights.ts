import * as THREE from 'three';
import {
  computeRectangularCornerLayout,
  CornerQuadrantId,
  sampleCornerQuadrantPoint,
  sampleRoundedBowlRing,
} from './bowlRing';
import { getTrackRadialOffset } from './capacity';
import { computeStadiumRingBounds } from './generateRoof';
import {
  createConcreteBowlMaterial,
  createFacadePbrMaterial,
  createPlazaDetailNormalAndRoughness,
  createRoofPbrMaterial,
  createStructurePbrMaterial,
  resolveStadiumMaterials,
} from './materials';
import {
  clampPitchToTrack,
  DEFAULT_STADIUM_MATERIALS,
  getEffectiveSunkenDepth,
  isContinuousBowlShape,
  LightingMode,
  PlacedObject,
  resolveAllCorners,
  resolveFloodlightRig,
  StadiumDocument,
  StadiumMaterialsConfig,
} from './schema';

/**
 * Generates a live scoreboard canvas texture for giant stadium LED screens.
 */
function createScoreboardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 512, 256);
  grad.addColorStop(0, '#091122');
  grad.addColorStop(1, '#0f2942');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  ctx.fillStyle = '#10b981';
  ctx.fillRect(0, 0, 512, 34);
  ctx.fillStyle = '#022c22';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('MATCHDAY LIVE  ·  74:18', 256, 24);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 78px monospace';
  ctx.fillText('2  -  1', 256, 138);

  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText('DOM', 92, 130);
  ctx.fillStyle = '#f43f5e';
  ctx.fillText('EXT', 420, 130);

  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(24, 188, 464, 44);
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '18px monospace';
  ctx.fillText('DIRECT HD  ·  CHRONO OFFICIEL', 256, 216);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Composite procedural PBR 3D model generator for placeable stadium assets.
 */
export function generatePlacedObjectGroup(
  obj: PlacedObject,
  lighting: LightingMode,
  isSelected: boolean,
  materials?: StadiumMaterialsConfig,
  maxAnisotropy: number = 4
): THREE.Group {
  const mats: StadiumMaterialsConfig = {
    ...DEFAULT_STADIUM_MATERIALS,
    ...(materials ?? {}),
  };

  const group = new THREE.Group();
  group.name = `Object_${obj.id}`;
  group.userData = { placedObjectId: obj.id, placedObjectType: obj.type };

  const darkSteel = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.34,
    metalness: 0.82,
  });
  const structMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const concrete = createConcreteBowlMaterial(maxAnisotropy);
  if (obj.color) {
    concrete.color.set(obj.color);
  }

  switch (obj.type) {
    case 'floodlight': {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.1, 2.2, 8), concrete);
      base.position.y = 1.1;
      base.castShadow = true;
      group.add(base);

      const mastH = 38;
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 1.25, mastH, 12),
        structMat
      );
      mast.position.y = 2.2 + mastH / 2;
      mast.castShadow = true;
      group.add(mast);

      const catwalk = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.35, 2.2), darkSteel);
      catwalk.position.set(0, mastH + 1.2, 0.4);
      group.add(catwalk);

      const headGroup = new THREE.Group();
      headGroup.position.set(0, mastH + 4.2, 0.8);
      headGroup.rotation.x = 0.42;

      const frame = new THREE.Mesh(new THREE.BoxGeometry(8.2, 4.8, 0.45), darkSteel);
      headGroup.add(frame);

      const isNight = lighting !== 'day';
      const bulbMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: new THREE.Color(isNight ? 0xfef9c3 : 0xe2e8f0),
        emissiveIntensity: isNight ? 2.6 : 0.4,
        roughness: 0.15,
      });

      const podGeo = new THREE.BoxGeometry(1.5, 1.0, 0.4);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          const pod = new THREE.Mesh(podGeo, bulbMat);
          pod.position.set(-2.7 + c * 1.8, -1.4 + r * 1.4, 0.35);
          headGroup.add(pod);
        }
      }

      if (isNight) {
        const coneGeo = new THREE.ConeGeometry(16, 46, 16, 1, true);
        coneGeo.translate(0, -23, 0);
        coneGeo.rotateX(-Math.PI / 2);
        const coneMat = new THREE.MeshBasicMaterial({
          color: 0xfef9c3,
          transparent: true,
          opacity: lighting === 'night' ? 0.085 : 0.045,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const beam = new THREE.Mesh(coneGeo, coneMat);
        beam.position.set(0, 0, 0.6);
        headGroup.add(beam);
      }

      group.add(headGroup);
      break;
    }

    case 'screen': {
      const scoreTex = createScoreboardTexture();
      const w = 13.5;
      const h = 7.2;

      const casing = new THREE.Mesh(new THREE.BoxGeometry(w + 0.9, h + 0.9, 0.9), darkSteel);
      casing.position.y = h / 2;
      casing.castShadow = true;
      group.add(casing);

      const displayMat = new THREE.MeshStandardMaterial({
        map: scoreTex,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: scoreTex,
        emissiveIntensity: lighting === 'night' ? 1.15 : 0.65,
        roughness: 0.22,
      });
      const display = new THREE.Mesh(new THREE.PlaneGeometry(w, h), displayMat);
      display.position.set(0, h / 2, 0.48);
      group.add(display);

      for (const sx of [-w * 0.32, w * 0.32]) {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.5, h + 2.5, 0.6), structMat);
        strut.position.set(sx, h / 2 - 0.8, -0.6);
        group.add(strut);
      }
      break;
    }

    case 'dugout': {
      const seatMat = new THREE.MeshPhysicalMaterial({
        color: obj.color ? new THREE.Color(obj.color) : 0x1e293b,
        roughness: 0.42,
        metalness: 0.08,
        clearcoat: 0.3,
      });
      const canopyMat = new THREE.MeshPhysicalMaterial({
        color: 0xe2e8f0,
        roughness: 0.08,
        metalness: 0.1,
        clearcoat: 0.95,
        transparent: true,
        opacity: 0.46,
        depthWrite: false,
      });

      for (const sideOffset of [-9.5, 9.5]) {
        const shelter = new THREE.Group();
        shelter.position.x = sideOffset;

        const floor = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.18, 2.2), darkSteel);
        floor.position.y = 0.09;
        shelter.add(floor);

        const shell = new THREE.Mesh(
          new THREE.CylinderGeometry(1.25, 1.25, 9.0, 14, 1, true, 0, Math.PI * 0.85),
          canopyMat
        );
        shell.rotation.z = Math.PI / 2;
        shell.rotation.x = -Math.PI * 0.15;
        shell.position.set(0, 1.15, -0.2);
        shelter.add(shell);

        const bucketGeo = new THREE.BoxGeometry(0.58, 0.72, 0.55);
        for (let i = 0; i < 11; i++) {
          const seat = new THREE.Mesh(bucketGeo, seatMat);
          seat.position.set(-3.8 + i * 0.76, 0.54, -0.35);
          seat.castShadow = true;
          shelter.add(seat);
        }
        group.add(shelter);
      }

      const officialDesk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 1.0), darkSteel);
      officialDesk.position.set(0, 0.45, 0);
      group.add(officialDesk);
      break;
    }

    case 'locker_room': {
      const facadeClad = createFacadePbrMaterial(mats.facade, lighting, false, maxAnisotropy);
      const mainBody = new THREE.Mesh(new THREE.BoxGeometry(28, 7.2, 17), facadeClad);
      mainBody.position.y = 3.6;
      mainBody.castShadow = true;
      mainBody.receiveShadow = true;
      group.add(mainBody);

      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0x0ea5e9,
        roughness: 0.1,
        metalness: 0.35,
        clearcoat: 0.95,
        transparent: true,
        opacity: 0.68,
      });
      const lobby = new THREE.Mesh(new THREE.BoxGeometry(12, 5.2, 3.2), glassMat);
      lobby.position.set(0, 2.6, 9.2);
      group.add(lobby);

      const canopy = new THREE.Mesh(new THREE.BoxGeometry(15, 0.4, 5.4), structMat);
      canopy.position.set(0, 5.4, 9.8);
      canopy.castShadow = true;
      group.add(canopy);

      for (const hx of [-7, 0, 7]) {
        const hvac = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 2.6), darkSteel);
        hvac.position.set(hx, 7.9, -2);
        group.add(hvac);
      }
      break;
    }

    case 'shop': {
      const facadeClad = createFacadePbrMaterial(mats.facade, lighting, false, maxAnisotropy);
      const body = new THREE.Mesh(new THREE.BoxGeometry(20, 6.4, 15), facadeClad);
      body.position.y = 3.2;
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const storefrontMat = new THREE.MeshPhysicalMaterial({
        color: 0x38bdf8,
        emissive: new THREE.Color(lighting !== 'day' ? 0xfbbf24 : 0x000000),
        emissiveIntensity: lighting !== 'day' ? 0.55 : 0,
        roughness: 0.1,
        metalness: 0.35,
        clearcoat: 0.95,
      });
      const windowWall = new THREE.Mesh(new THREE.BoxGeometry(17.5, 4.2, 0.3), storefrontMat);
      windowWall.position.set(0, 2.2, 7.55);
      group.add(windowWall);

      const awning = new THREE.Mesh(new THREE.BoxGeometry(19, 0.6, 3.2), structMat);
      awning.position.set(0, 4.6, 8.6);
      awning.castShadow = true;
      group.add(awning);

      const totem = new THREE.Mesh(new THREE.BoxGeometry(1.8, 9.5, 0.9), darkSteel);
      totem.position.set(11.8, 4.75, 6.5);
      totem.castShadow = true;
      group.add(totem);
      break;
    }

    case 'parking': {
      const asphaltDetail = createPlazaDetailNormalAndRoughness('urban_asphalt', maxAnisotropy);
      const asphaltMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        normalMap: asphaltDetail.normalMap,
        roughnessMap: asphaltDetail.roughnessMap,
        roughness: 0.9,
        metalness: 0.05,
      });
      const pad = new THREE.Mesh(new THREE.BoxGeometry(58, 0.18, 40), asphaltMat);
      pad.position.y = 0.09;
      pad.receiveShadow = true;
      group.add(pad);

      const stripeMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
      const stripeGeo = new THREE.PlaneGeometry(0.22, 5.2);
      stripeGeo.rotateX(-Math.PI / 2);
      for (const rowZ of [-12, 0, 12]) {
        for (let bx = -24; bx <= 24; bx += 3) {
          const st = new THREE.Mesh(stripeGeo, stripeMat);
          st.position.set(bx, 0.2, rowZ);
          group.add(st);
        }
      }

      const solarMat = new THREE.MeshPhysicalMaterial({
        color: 0x172554,
        roughness: 0.14,
        metalness: 0.65,
        clearcoat: 0.9,
      });
      const solarDeck = new THREE.Mesh(new THREE.BoxGeometry(48, 0.25, 6.5), solarMat);
      solarDeck.position.set(0, 3.6, 0);
      solarDeck.rotation.x = 0.12;
      solarDeck.castShadow = true;
      group.add(solarDeck);

      const busMat = new THREE.MeshPhysicalMaterial({
        color: 0xf8fafc,
        roughness: 0.22,
        metalness: 0.3,
        clearcoat: 0.85,
      });
      for (const bz of [-13.5, 13.5]) {
        const bus = new THREE.Mesh(new THREE.BoxGeometry(13.5, 3.6, 2.7), busMat);
        bus.position.set(-14, 1.9, bz);
        bus.castShadow = true;
        group.add(bus);
      }
      break;
    }

    case 'esplanade': {
      const stoneDetail = createPlazaDetailNormalAndRoughness(mats.plazaSurface, maxAnisotropy);
      const stoneMat = new THREE.MeshStandardMaterial({
        color: mats.plazaSurface === 'sandstone_esplanade' ? 0xd6d3d1 : 0x94a3b8,
        normalMap: stoneDetail.normalMap,
        roughnessMap: stoneDetail.roughnessMap,
        roughness: 0.82,
        metalness: 0.05,
      });
      const plaza = new THREE.Mesh(new THREE.BoxGeometry(52, 0.22, 32), stoneMat);
      plaza.position.y = 0.11;
      plaza.receiveShadow = true;
      group.add(plaza);

      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.92 });
      const foliageMat = new THREE.MeshStandardMaterial({ color: 0x286436, roughness: 0.85 });

      const treeCoords: [number, number][] = [
        [-18, -9],
        [-6, -9],
        [6, -9],
        [18, -9],
        [-18, 9],
        [18, 9],
      ];
      for (const [tx, tz] of treeCoords) {
        const planter = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.65, 3.4), concrete);
        planter.position.set(tx, 0.45, tz);
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 3.2, 7), trunkMat);
        trunk.position.set(tx, 2.1, tz);
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 1), foliageMat);
        crown.position.set(tx, 4.6, tz);
        crown.castShadow = true;
        group.add(planter, trunk, crown);
      }
      break;
    }

    case 'fence': {
      const fenceLen = 36;
      const postCount = 13;
      for (let i = 0; i < postCount; i++) {
        const px = -fenceLen / 2 + (i * fenceLen) / (postCount - 1);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.8, 0.22), darkSteel);
        post.position.set(px, 1.4, 0);
        post.castShadow = true;
        group.add(post);
      }
      const railTop = new THREE.Mesh(new THREE.BoxGeometry(fenceLen, 0.14, 0.14), darkSteel);
      railTop.position.set(0, 2.65, 0);
      const meshPanel = new THREE.Mesh(
        new THREE.BoxGeometry(fenceLen, 2.5, 0.06),
        new THREE.MeshStandardMaterial({
          color: 0x475569,
          transparent: true,
          opacity: 0.45,
          wireframe: true,
        })
      );
      meshPanel.position.set(0, 1.35, 0);

      const portalRoof = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.55, 3.2), structMat);
      portalRoof.position.set(0, 3.4, 0);
      portalRoof.castShadow = true;
      group.add(railTop, meshPanel, portalRoof);
      break;
    }

    case 'custom_roof': {
      const roofPbr = createRoofPbrMaterial(mats.roof, 0.92, lighting, false, maxAnisotropy, 4, 2);
      const canopyDeck = new THREE.Mesh(new THREE.BoxGeometry(26, 0.45, 16), roofPbr);
      canopyDeck.position.set(0, 14, 0);
      canopyDeck.rotation.x = -0.08;
      canopyDeck.castShadow = true;
      group.add(canopyDeck);

      for (const mx of [-10, 10]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.65, 14.2, 10), structMat);
        col.position.set(mx, 7.1, 6.5);
        col.castShadow = true;
        group.add(col);
      }
      break;
    }
  }

  if (isSelected) {
    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const helperGeo = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(size.x + 0.8, size.y + 0.8, size.z + 0.8)
    );
    const helperMat = new THREE.LineBasicMaterial({ color: 0x10b981 });
    const wire = new THREE.LineSegments(helperGeo, helperMat);
    wire.position.copy(center);
    wire.name = 'SelectionHighlight';
    group.add(wire);
  }

  group.position.set(obj.position[0], obj.position[1], obj.position[2]);
  group.rotation.set(obj.rotation[0], obj.rotation[1], obj.rotation[2]);
  group.scale.set(obj.scale[0], obj.scale[1], obj.scale[2]);

  return group;
}

function createMastStrut(
  pA: THREE.Vector3,
  pB: THREE.Vector3,
  rTop: number,
  rBot: number,
  mat: THREE.Material
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(pB, pA);
  const len = Math.max(0.05, dir.length());
  const mid = new THREE.Vector3().addVectors(pA, pB).multiplyScalar(0.5);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBot, len, 6),
    mat
  );
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true;
  return mesh;
}

function buildSingleCornerFloodlightMast(
  id: CornerQuadrantId,
  worldX: number,
  worldZ: number,
  groundY: number,
  mastHeight: number,
  lighting: LightingMode,
  structMat: THREE.Material,
  concreteMat: THREE.Material
): THREE.Group {
  const mastGroup = new THREE.Group();
  mastGroup.name = `CornerFloodlightMast_${id.toUpperCase()}`;
  mastGroup.position.set(worldX, groundY, worldZ);

  // Orient local +Z directly toward pitch center `(0, 0, 0)`
  const horizDist = Math.max(20, Math.hypot(worldX, worldZ));
  mastGroup.rotation.y = Math.atan2(-worldX, -worldZ);

  const darkSteel = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.36,
    metalness: 0.84,
  });

  // 1. Reinforced concrete octagonal foundation plinth + anchor gussets
  const plinthH = 2.8;
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(2.05, 2.65, plinthH, 8),
    concreteMat
  );
  plinth.position.y = plinthH * 0.5;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  mastGroup.add(plinth);

  const shaftH = Math.max(28, mastHeight - plinthH);
  // Slight forward lean toward the pitch (`+Z` local) like classic iconic floodlight pylons
  const topForwardLean = 3.2;
  const pFoot = new THREE.Vector3(0, plinthH - 0.2, 0);
  const pHead = new THREE.Vector3(0, plinthH + shaftH, topForwardLean);

  // Main tapered tubular mast spine + twin rear tension/compression A-legs
  mastGroup.add(createMastStrut(pFoot, pHead, 0.58, 1.38, structMat));
  for (const sx of [-1.75, 1.75]) {
    const pRearFoot = new THREE.Vector3(sx, 0.6, -2.4);
    const pMidJoin = new THREE.Vector3(sx * 0.28, plinthH + shaftH * 0.58, topForwardLean * 0.52 - 0.55);
    mastGroup.add(
      createMastStrut(pRearFoot, pMidJoin, 0.24, 0.36, structMat),
      createMastStrut(pMidJoin, pHead, 0.18, 0.24, structMat)
    );
    const rearBlock = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 1.8), concreteMat);
    rearBlock.position.set(sx, 0.6, -2.4);
    rearBlock.castShadow = true;
    mastGroup.add(rearBlock);
  }

  // Maintenance rest platforms along the shaft
  for (const frac of [0.34, 0.68]) {
    const platY = plinthH + shaftH * frac;
    const platZ = topForwardLean * frac;
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(1.65 - frac * 0.35, 1.65 - frac * 0.35, 0.22, 12),
      darkSteel
    );
    ring.position.set(0, platY, platZ);
    mastGroup.add(ring);
  }

  // 2. Head-frame maintenance catwalk + multi-row broadcast LED projector bank
  const headPivot = new THREE.Group();
  headPivot.position.set(0, plinthH + shaftH + 0.4, topForwardLean + 0.55);

  const aimPitchAngle = Math.min(0.68, Math.max(0.28, Math.atan2(mastHeight * 0.92, horizDist)));
  headPivot.rotation.x = aimPitchAngle;

  const frameW = 10.6;
  const frameH = 6.2;
  const rows = 4;
  const cols = 6;

  // Space-frame horizontal & vertical bars
  for (let r = 0; r <= rows; r++) {
    const ry = -frameH * 0.5 + (r * frameH) / rows;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(frameW + 0.6, 0.22, 0.32), darkSteel);
    bar.position.set(0, ry, -0.18);
    bar.castShadow = true;
    headPivot.add(bar);
  }
  for (const cx of [-frameW * 0.46, -frameW * 0.16, frameW * 0.16, frameW * 0.46]) {
    const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.24, frameH + 0.6, 0.36), darkSteel);
    vBar.position.set(cx, 0, -0.22);
    vBar.castShadow = true;
    headPivot.add(vBar);
  }

  // Rear service catwalk behind projector bank
  const catwalk = new THREE.Mesh(new THREE.BoxGeometry(frameW + 1.2, 0.2, 1.45), darkSteel);
  catwalk.position.set(0, -frameH * 0.5 - 0.35, -0.85);
  headPivot.add(catwalk);

  const isLit = lighting !== 'day';
  const projectorBodyMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.35,
    metalness: 0.78,
  });
  const lensMat = new THREE.MeshStandardMaterial({
    color: isLit ? 0xffffff : 0xe2e8f0,
    emissive: new THREE.Color(isLit ? 0xfef9c3 : 0x000000),
    emissiveIntensity: lighting === 'night' ? 3.1 : lighting === 'dusk' ? 2.1 : 0,
    roughness: 0.12,
    metalness: 0.45,
  });

  const podCount = rows * cols;
  const housingInst = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.32, 0.92, 0.48),
    projectorBodyMat,
    podCount
  );
  const lensInst = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1.18, 0.78),
    lensMat,
    podCount
  );
  const dummy = new THREE.Object3D();
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const py = -frameH * 0.5 + ((r + 0.5) * frameH) / rows;
    for (let c = 0; c < cols; c++) {
      const px = -frameW * 0.5 + ((c + 0.5) * frameW) / cols;
      dummy.position.set(px, py, 0.12);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      housingInst.setMatrixAt(idx, dummy.matrix);

      dummy.position.set(px, py, 0.37);
      dummy.updateMatrix();
      lensInst.setMatrixAt(idx, dummy.matrix);
      idx++;
    }
  }
  housingInst.instanceMatrix.needsUpdate = true;
  lensInst.instanceMatrix.needsUpdate = true;
  housingInst.computeBoundingSphere();
  lensInst.computeBoundingSphere();
  headPivot.add(housingInst, lensInst);

  // Subtle volumetric stadium light beam in dusk / night (ignored by raycaster!)
  if (isLit) {
    const coneLen = Math.min(82, horizDist * 0.78);
    const coneGeo = new THREE.ConeGeometry(21, coneLen, 18, 1, true);
    coneGeo.translate(0, -coneLen * 0.5, 0);
    coneGeo.rotateX(-Math.PI * 0.5);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xfef9c3,
      transparent: true,
      opacity: lighting === 'night' ? 0.075 : 0.04,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const beam = new THREE.Mesh(coneGeo, coneMat);
    beam.position.set(0, 0, 0.6);
    beam.raycast = () => {};
    headPivot.add(beam);
  }

  mastGroup.add(headPivot);
  return mastGroup;
}

/**
 * Generates the 4 monumental corner floodlight pylons when `resolveFloodlightRig(doc)`
 * is `'corner_masts'` or `'both'`. Automatically clears all stands, corner pavilions,
 * concourses, and roofs.
 */
export function generateFloodlightRigGroup(
  doc: StadiumDocument,
  crossSectionClip: boolean = false,
  maxAnisotropy: number = 4
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'FloodlightRigAssembly';

  const rig = resolveFloodlightRig(doc);
  if (rig !== 'corner_masts' && rig !== 'both') {
    return root;
  }

  const mats = resolveStadiumMaterials(doc);
  const structMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const concreteMat = createConcreteBowlMaterial(maxAnisotropy);
  const bounds = computeStadiumRingBounds(doc);
  const sunkenDepth = getEffectiveSunkenDepth(doc);
  const groundY = sunkenDepth > 0.5 ? sunkenDepth : 0;
  const concourseW = Math.max(0, doc.concourse?.width ?? 0);

  const roofExtra =
    doc.roof.style !== 'none' ? Math.max(4.5, doc.roof.heightOffset) + 15.5 : 14.0;
  const mastHeight = Math.max(40, bounds.maxStandH + roofExtra - groundY);

  const safePitch = clampPitchToTrack(doc.pitch);
  const cornerModes = resolveAllCorners(doc);
  const trackOffsets = getTrackRadialOffset(doc);
  const rectLayout = computeRectangularCornerLayout({
    shape: doc.shape,
    cornerFill: doc.cornerFill,
    cornerModes,
    crossSectionClip,
    pitchLength: safePitch.length,
    pitchWidth: safePitch.width,
    endTrackOffset: trackOffsets.endOffset,
    sideTrackOffset: trackOffsets.sideOffset,
    stands: doc.stands,
  });

  const cornerList: { id: CornerQuadrantId; tBowl: number }[] = [
    { id: 'se', tBowl: 0.125 },
    { id: 'sw', tBowl: 0.375 },
    { id: 'nw', tBowl: 0.625 },
    { id: 'ne', tBowl: 0.875 },
  ];

  for (const item of cornerList) {
    if (crossSectionClip && (item.id === 'se' || item.id === 'sw')) {
      continue;
    }

    let wx = 0;
    let wz = 0;
    const cMode = cornerModes[item.id];

    if (isContinuousBowlShape(doc.shape)) {
      const openCustom = doc.corners?.[item.id] !== undefined && cMode === 'open';
      const radOff = openCustom
        ? Math.max(8.5, bounds.avgDepth * 0.45)
        : bounds.avgDepth + concourseW + 7.5;
      const pt = sampleRoundedBowlRing(bounds.ring, item.tBowl, radOff);
      wx = pt.x;
      wz = pt.z;
    } else {
      const cSpec = rectLayout.corners[item.id];
      const radOff =
        cMode === 'open'
          ? Math.max(8.5, bounds.avgDepth * 0.42)
          : bounds.avgDepth + concourseW + 7.2;
      const pt = sampleCornerQuadrantPoint(cSpec, 0.5, radOff);
      wx = pt.x;
      wz = pt.z;
    }

    root.add(
      buildSingleCornerFloodlightMast(
        item.id,
        wx,
        wz,
        groundY,
        mastHeight,
        doc.lighting,
        structMat,
        concreteMat
      )
    );
  }

  return root;
}

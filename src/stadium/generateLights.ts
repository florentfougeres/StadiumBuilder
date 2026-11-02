import * as THREE from 'three';
import {
  createConcreteBowlMaterial,
  createFacadePbrMaterial,
  createPlazaDetailNormalAndRoughness,
  createRoofPbrMaterial,
  createStructurePbrMaterial,
} from './materials';
import {
  DEFAULT_STADIUM_MATERIALS,
  LightingMode,
  PlacedObject,
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

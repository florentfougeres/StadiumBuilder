import * as THREE from 'three';
import { sampleCornerQuadrantPoint } from '../bowlRing';
import { createStrut } from '../meshKit';
import { cornerEnds, type CornerStructureContext } from './kit';
import { createScreenFeedTexture } from '../screenContent';

/**
 * Giant LED scoreboard on a four-legged steel lattice gantry (`screen`), set on the corner's
 * bisector clear of the pitch and facing its centre.
 */
export function buildCornerScreen(ctx: CornerStructureContext): THREE.Group {
  const { doc, corner, concreteMat, structureMat } = ctx;
  const wrapper = new THREE.Group();
  wrapper.name = `CornerScreen_${corner.id.toUpperCase()}`;

  const ends = cornerEnds(ctx);
  const refH = Math.max(15.5, (ends.a.height + ends.b.height) * 0.5);

  const anchor = sampleCornerQuadrantPoint(corner, 0.5, 6.8);
  const assembly = new THREE.Group();
  assembly.position.set(anchor.x, 0, anchor.z);
  // Orient local +Z directly toward pitch center `(0, 0, 0)`
  assembly.rotation.y = Math.atan2(-anchor.x, -anchor.z);

  const screenW = 15.8;
  const screenH = 8.9;
  const screenCenterY = Math.max(12.2, refH * 0.66);
  const gantryTopY = screenCenterY + screenH * 0.5 + 1.65;
  const legHalfX = screenW * 0.42;
  const frontLegZ = -0.35;
  const rearLegZ = -3.45;

  // Concrete foundation pedestals + 4 vertical lattice legs
  for (const lx of [-legHalfX, legHalfX]) {
    for (const lz of [frontLegZ, rearLegZ]) {
      const plinth = new THREE.Mesh(
        new THREE.BoxGeometry(1.65, 1.8, 1.65),
        concreteMat
      );
      plinth.position.set(lx, 0.9, lz);
      plinth.castShadow = true;
      plinth.receiveShadow = true;
      assembly.add(plinth);

      assembly.add(
        createStrut(
          new THREE.Vector3(lx, 1.5, lz),
          new THREE.Vector3(lx, gantryTopY, lz),
          0.26,
          0.34,
          structureMat,
          8
        )
      );
    }

    // Transverse & K-bracing between front & rear legs
    const levels = 5;
    for (let lv = 1; lv <= levels; lv++) {
      const y0 = 1.6 + ((lv - 1) * (gantryTopY - 2.0)) / levels;
      const y1 = 1.6 + (lv * (gantryTopY - 2.0)) / levels;
      assembly.add(
        createStrut(
          new THREE.Vector3(lx, y1, frontLegZ),
          new THREE.Vector3(lx, y1, rearLegZ),
          0.14,
          0.14,
          structureMat,
          5
        ),
        createStrut(
          new THREE.Vector3(lx, y0, frontLegZ),
          new THREE.Vector3(lx, y1, rearLegZ),
          0.11,
          0.11,
          structureMat,
          5
        )
      );
    }
  }

  // Horizontal portal cross-beams & X-bracing across the gantry width
  for (const by of [
    screenCenterY - screenH * 0.5 - 0.65,
    screenCenterY,
    gantryTopY - 0.25,
  ]) {
    assembly.add(
      createStrut(
        new THREE.Vector3(-legHalfX - 0.9, by, frontLegZ),
        new THREE.Vector3(legHalfX + 0.9, by, frontLegZ),
        0.2,
        0.2,
        structureMat,
        6
      ),
      createStrut(
        new THREE.Vector3(-legHalfX - 0.9, by, rearLegZ),
        new THREE.Vector3(legHalfX + 0.9, by, rearLegZ),
        0.18,
        0.18,
        structureMat,
        6
      )
    );
  }
  assembly.add(
    createStrut(
      new THREE.Vector3(-legHalfX, 2.0, rearLegZ),
      new THREE.Vector3(legHalfX, screenCenterY - screenH * 0.5 - 0.65, rearLegZ),
      0.13,
      0.13,
      structureMat,
      5
    ),
    createStrut(
      new THREE.Vector3(legHalfX, 2.0, rearLegZ),
      new THREE.Vector3(-legHalfX, screenCenterY - screenH * 0.5 - 0.65, rearLegZ),
      0.13,
      0.13,
      structureMat,
      5
    )
  );

  // Rear maintenance catwalks
  const catwalkMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.5,
    metalness: 0.72,
  });
  for (const cy of [screenCenterY - screenH * 0.32, screenCenterY + screenH * 0.28]) {
    const walk = new THREE.Mesh(
      new THREE.BoxGeometry(screenW - 0.8, 0.16, 2.4),
      catwalkMat
    );
    walk.position.set(0, cy, (frontLegZ + rearLegZ) * 0.5);
    assembly.add(walk);
  }

  // Dark anodized LED cabinet housing + top architectural visor hood + line-array audio pods
  const cabinetMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.36,
    metalness: 0.68,
  });
  const cabinet = new THREE.Mesh(
    new THREE.BoxGeometry(screenW + 0.75, screenH + 0.75, 0.88),
    cabinetMat
  );
  cabinet.position.set(0, screenCenterY, 0.22);
  cabinet.castShadow = true;
  cabinet.receiveShadow = true;
  assembly.add(cabinet);

  const sunHood = new THREE.Mesh(
    new THREE.BoxGeometry(screenW + 0.95, 0.26, 1.35),
    cabinetMat
  );
  sunHood.position.set(0, screenCenterY + screenH * 0.5 + 0.32, 0.48);
  sunHood.castShadow = true;
  assembly.add(sunHood);

  const scoreTex = createScreenFeedTexture();
  const screenMat = new THREE.MeshStandardMaterial({
    map: scoreTex,
    emissive: new THREE.Color(0xffffff),
    emissiveMap: scoreTex,
    emissiveIntensity: doc.lighting === 'day' ? 0.62 : 1.25,
    roughness: 0.16,
    metalness: 0.08,
  });
  const ledFace = new THREE.Mesh(new THREE.PlaneGeometry(screenW, screenH), screenMat);
  ledFace.position.set(0, screenCenterY, 0.68);
  assembly.add(ledFace);

  // Line-array stadium loudspeaker clusters suspended beneath the cabinet
  for (const sx of [-screenW * 0.28, screenW * 0.28]) {
    const arrayPod = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 2.1, 0.95),
      cabinetMat
    );
    arrayPod.position.set(sx, screenCenterY - screenH * 0.5 - 1.35, 0.35);
    arrayPod.rotation.x = 0.22;
    arrayPod.castShadow = true;
    assembly.add(arrayPod);
  }

  wrapper.add(assembly);
  return wrapper;
}

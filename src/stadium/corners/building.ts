import * as THREE from 'three';
import { sampleCornerQuadrantPoint } from '../bowlRing';
import { buildStandEnvelope, facadeGradeY } from '../envelopes';
import { resolveStadiumMaterials } from '../materials';
import { createStrut } from '../meshKit';
import { getEffectiveSunkenDepth } from '../schema';
import { cornerEnds, type CornerStructureContext } from './kit';

/**
 * Glazed multi-storey corner building for hospitality, club offices or media (`building`): a
 * panoramic glass front facing the pitch with balconies at every floor, the stadium's own envelope
 * on its back. It follows the depth and height of the stands it joins, or of the one the corner
 * join keeps.
 */
export function buildCornerBuilding(ctx: CornerStructureContext): THREE.Group {
  const { doc, corner, concreteMat, facadeMat, structureMat, turnstileTex } = ctx;
  const group = new THREE.Group();
  group.name = `CornerBuilding_${corner.id.toUpperCase()}`;

  const isNight = doc.lighting !== 'day';
  const sunkenDepth = getEffectiveSunkenDepth(doc);
  const ends = cornerEnds(ctx);

  const segs = corner.facetedThreeBay ? 15 : 22;
  const frontOff = 1.45;
  // The pitch-facing glass front runs as one straight chamfer across the corner: swept around
  // the tight corner radius it pinched into a thin, warped cylinder.
  const frontZone = frontOff + 1.5;
  const at = (u: number, r: number) => {
    if (r > frontZone) return sampleCornerQuadrantPoint(corner, u, r);
    const p0 = sampleCornerQuadrantPoint(corner, 0, r);
    const p1 = sampleCornerQuadrantPoint(corner, 1, r);
    const mid = sampleCornerQuadrantPoint(corner, 0.5, r);
    return { x: p0.x + (p1.x - p0.x) * u, z: p0.z + (p1.z - p0.z) * u, nx: mid.nx, nz: mid.nz };
  };
  const sliceSpecs: { outerD: number; topH: number; gradeY: number }[] = [];

  for (let s = 0; s <= segs; s++) {
    const u = s / segs;
    const w = u * u * (3 - 2 * u);
    const outerD = Math.max(frontOff + 10.5, ends.a.depth + (ends.b.depth - ends.a.depth) * w);
    const topH = Math.max(10.5, ends.a.height + (ends.b.height - ends.a.height) * w);
    const gradeY = facadeGradeY(sunkenDepth, topH);
    sliceSpecs.push({ outerD, topH, gradeY });
  }

  const buildSweptWall = (
    radFn: (s: number) => number,
    yBotFn: (s: number) => number,
    yTopFn: (s: number) => number,
    mat: THREE.Material,
    uRep: number = 4,
    vRep: number = 2
  ) => {
    const pos = new Float32Array((segs + 1) * 2 * 3);
    const uvs = new Float32Array((segs + 1) * 2 * 2);
    const idx: number[] = [];
    for (let s = 0; s <= segs; s++) {
      const pt = at(s / segs, radFn(s));
      const b = s * 6;
      pos[b] = pt.x;
      pos[b + 1] = yBotFn(s);
      pos[b + 2] = pt.z;
      pos[b + 3] = pt.x;
      pos[b + 4] = yTopFn(s);
      pos[b + 5] = pt.z;

      const u = (s / segs) * uRep;
      uvs[s * 4] = u;
      uvs[s * 4 + 1] = 0;
      uvs[s * 4 + 2] = u;
      uvs[s * 4 + 3] = vRep;
    }
    for (let s = 0; s < segs; s++) {
      const a = s * 2;
      const b = (s + 1) * 2;
      const c = b + 1;
      const d = a + 1;
      idx.push(a, d, b, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  const buildSweptDeck = (
    radInFn: (s: number) => number,
    radOutFn: (s: number) => number,
    yFn: (s: number) => number,
    mat: THREE.Material
  ) => {
    const pos = new Float32Array((segs + 1) * 2 * 3);
    const uvs = new Float32Array((segs + 1) * 2 * 2);
    const idx: number[] = [];
    for (let s = 0; s <= segs; s++) {
      const pIn = at(s / segs, radInFn(s));
      const pOut = at(s / segs, radOutFn(s));
      const py = yFn(s);
      const b = s * 6;
      pos[b] = pIn.x;
      pos[b + 1] = py;
      pos[b + 2] = pIn.z;
      pos[b + 3] = pOut.x;
      pos[b + 4] = py;
      pos[b + 5] = pOut.z;
      uvs[s * 4] = (s / segs) * 4;
      uvs[s * 4 + 1] = 0;
      uvs[s * 4 + 2] = (s / segs) * 4;
      uvs[s * 4 + 3] = 1;
    }
    for (let s = 0; s < segs; s++) {
      const a = s * 2;
      const b = (s + 1) * 2;
      const c = b + 1;
      const d = a + 1;
      idx.push(a, b, d, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  const vipTex = createCurtainWallTexture(isNight);
  const curtainGlassMat = new THREE.MeshPhysicalMaterial({
    map: vipTex,
    emissive: new THREE.Color(isNight ? 0xf59e0b : 0x0ea5e9),
    emissiveMap: vipTex,
    emissiveIntensity: isNight ? 0.72 : 0.14,
    roughness: 0.08,
    metalness: 0.32,
    clearcoat: 0.94,
    side: THREE.DoubleSide,
  });

  const balconyGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xdbeafe,
    roughness: 0.08,
    metalness: 0.12,
    clearcoat: 0.95,
    transparent: true,
    opacity: 0.56,
    side: THREE.DoubleSide,
  });

  // 1. Pitch-facing panoramic glazed curtain wall (`radialOffset = frontOff + 1.15`, recessed behind balconies)
  group.add(
    buildSweptWall(
      () => frontOff + 1.15,
      () => 0,
      (s) => sliceSpecs[s].topH - 0.35,
      curtainGlassMat,
      5,
      4
    )
  );

  // 2. Ground plinth wall facing pitch + multi-level cantilevered panoramic VIP terrace slabs & glass railings
  group.add(
    buildSweptWall(
      () => frontOff,
      () => 0,
      () => 2.6,
      concreteMat,
      3,
      1
    )
  );

  const avgTopH = sliceSpecs[Math.floor(segs / 2)].topH;
  const floorStep = 3.85;
  const floorCount = Math.max(2, Math.floor((avgTopH - 2.4) / floorStep));

  for (let f = 1; f <= floorCount; f++) {
    const frac = f / (floorCount + 0.35);
    // Floor slab fascia + balcony deck + glass balustrade
    group.add(
      buildSweptDeck(
        () => frontOff,
        (s) => sliceSpecs[s].outerD,
        (s) => 1.8 + frac * (sliceSpecs[s].topH - 2.2),
        concreteMat
      ),
      buildSweptWall(
        () => frontOff,
        (s) => 1.8 + frac * (sliceSpecs[s].topH - 2.2) - 0.32,
        (s) => 1.8 + frac * (sliceSpecs[s].topH - 2.2) + 0.05,
        structureMat,
        4,
        1
      ),
      buildSweptWall(
        () => frontOff + 0.06,
        (s) => 1.8 + frac * (sliceSpecs[s].topH - 2.2) + 0.05,
        (s) => 1.8 + frac * (sliceSpecs[s].topH - 2.2) + 1.1,
        balconyGlassMat,
        4,
        1
      )
    );
  }

  // 3. Rooftop slab, penthouse mechanical volume & overhang cornice
  group.add(
    buildSweptDeck(
      () => frontOff - 0.2,
      (s) => sliceSpecs[s].outerD + 0.45,
      (s) => sliceSpecs[s].topH,
      concreteMat
    ),
    buildSweptWall(
      () => frontOff - 0.2,
      (s) => sliceSpecs[s].topH - 0.48,
      (s) => sliceSpecs[s].topH + 0.45,
      structureMat,
      4,
      1
    ),
  );

  // 4. Vertical structural mullions on pitch-facing curtain wall + flank end-walls
  const mullionCount = 7;
  for (let m = 0; m <= mullionCount; m++) {
    const u = m / mullionCount;
    const sIdx = Math.min(segs, Math.round(u * segs));
    const pt = at(u, frontOff + 1.05);
    group.add(
      createStrut(
        new THREE.Vector3(pt.x, 0, pt.z),
        new THREE.Vector3(pt.x, sliceSpecs[sIdx].topH, pt.z),
        0.16,
        0.18,
        structureMat,
        6
      )
    );
  }

  for (const endIdx of [0, segs]) {
    const uEnd = endIdx / segs;
    const spec = sliceSpecs[endIdx];
    const pIn = sampleCornerQuadrantPoint(corner, uEnd, frontOff);
    const pOut = sampleCornerQuadrantPoint(corner, uEnd, spec.outerD);
    const spanD = Math.hypot(pOut.x - pIn.x, pOut.z - pIn.z);
    const flankWall = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, spec.topH, spanD),
      concreteMat
    );
    flankWall.position.set(
      (pIn.x + pOut.x) * 0.5,
      spec.topH * 0.5,
      (pIn.z + pOut.z) * 0.5
    );
    flankWall.rotation.y = Math.atan2(pOut.x - pIn.x, pOut.z - pIn.z);
    flankWall.castShadow = true;
    flankWall.receiveShadow = true;
    group.add(flankWall);
  }

  // 5. Rear facade: the stadium's envelope continues around the building like behind the stands
  //    (raker frames aside: a building has floors, so an exposed structure gets the plain skin).
  const envelopeDoc =
    resolveStadiumMaterials(doc).envelopeStyle === 'exposed_structure'
      ? { ...doc, materials: { ...resolveStadiumMaterials(doc), envelopeStyle: 'enveloping_skin' as const } }
      : doc;
  group.add(
    buildStandEnvelope({
      doc: envelopeDoc,
      rail: sliceSpecs.map((sp, s) => {
        const pt = at(s / segs, sp.outerD);
        return { ...pt, yBottom: sp.gradeY, yTop: sp.topH, depth: sp.outerD - frontOff };
      }),
      closed: false,
      facadeMat,
      structureMat,
      concreteMat,
      turnstileTex,
      name: 'CornerBuildingEnvelope',
    })
  );

  return group;
}

/** Backlit curtain-wall texture of the corner building's glazed front. */
function createCurtainWallTexture(isNight: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  if (isNight) {
    grad.addColorStop(0, '#78350f');
    grad.addColorStop(0.35, '#fef3c7');
    grad.addColorStop(1, '#f59e0b');
  } else {
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(0.5, '#1e3a5f');
    grad.addColorStop(1, '#38bdf8');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 128);

  ctx.fillStyle = '#0f172a';
  for (let x = 0; x <= 512; x += 64) {
    ctx.fillRect(x - 2, 0, 4, 128);
  }
  ctx.fillRect(0, 0, 512, 8);
  ctx.fillRect(0, 120, 512, 8);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(6, 1);
  tex.needsUpdate = true;
  return tex;
}

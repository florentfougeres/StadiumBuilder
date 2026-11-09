import * as THREE from 'three';
import { getBowlArcRange, sampleRoundedBowlRing } from '../bowlRing';
import { createConcreteBowlMaterial, createStructurePbrMaterial, resolveStadiumMaterials } from '../materials';
import { getEffectiveSunkenDepth, resolveCornerPylonFrame, resolveCounterweightTrusses, resolveSuspendedMasts, StadiumDocument, RoofStyle } from '../schema';
import { beamGeometry, mergedMesh } from './roofBeams';
import { computeStadiumRingBounds } from './ringBounds';
import { RoofBuilder, buildAnnularCanopyMesh, buildAnnularCatwalkFloodlights, buildCanopyMaterialBundle, buildPerimeterCanopyCrown, createStrutBetween, hasRoofGantryLights, insideXZ, warrenTrussParts } from './roofKit';

/**
 * 2. SUSPENDED NEEDLE MASTS (`suspended_masts`)
 */
function buildSuspendedMastsRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const {
    ring,
    maxStandH,
    avgDepth,
    canopyOuterOffsetAt,
    exteriorSupportMinOffsetAt,
    standHeightAtNormal,
    standDepthAtNormal,
  } = computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const sunkenDepth = getEffectiveSunkenDepth(doc);
  const groundY = Math.min(sunkenDepth, maxStandH * 0.6);
  const roofY = maxStandH + Math.max(4.5, doc.roof.heightOffset);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const outerOffsetFn = (nx: number, nz: number) => canopyOuterOffsetAt(nx, nz, 6.5);

  const { surfaceMat: canopyMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy
  );

  group.add(
    buildAnnularCanopyMesh(
      ring,
      doc.shape,
      innerOffset,
      outerOffsetFn,
      roofY - 0.3,
      roofY + 0.4,
      crossSectionClip,
      canopyMat,
      shadowDepthMat
    ),
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerOffset,
      roofY - 0.55,
      doc.lighting,
      crossSectionClip,
      hasRoofGantryLights(doc)
    )
  );

  const mastStructureMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const cableMat = new THREE.MeshStandardMaterial({
    color: 0xdbeafe,
    roughness: 0.24,
    metalness: 0.9,
  });
  const concretePedestalMat = createConcreteBowlMaterial(maxAnisotropy);

  const masts = resolveSuspendedMasts(doc.roof);
  const mastCount = Math.max(3, Math.round(masts.mastCount * arcFraction));
  for (let i = 0; i < mastCount; i++) {
    const frac = closed ? i / mastCount : i / Math.max(1, mastCount - 1);
    const t = tStart + frac * (tEnd - tStart);

    const baseSample = sampleRoundedBowlRing(ring, t, 0);
    const localStandD = standDepthAtNormal(baseSample.nx, baseSample.nz);
    const localStandH = standHeightAtNormal(baseSample.nx, baseSample.nz);
    const localOuter = outerOffsetFn(baseSample.nx, baseSample.nz);
    const extMin = exteriorSupportMinOffsetAt(baseSample.nx, baseSample.nz);
    const mastGroundOff = Math.max(extMin + 1.8, localOuter + 1.6);
    const mastTopOff = Math.max(extMin + 1.0, localOuter + 0.8);

    const mastGroundPt = sampleRoundedBowlRing(ring, t, mastGroundOff);
    const mastTopPt = sampleRoundedBowlRing(ring, t, mastTopOff);
    const innerAnchor = sampleRoundedBowlRing(ring, t, innerOffset + 2.2);
    const midAnchor = sampleRoundedBowlRing(ring, t, (innerOffset + localOuter) * 0.48);
    const backstayGround = sampleRoundedBowlRing(ring, t, mastGroundOff + 9.5);
    const standCrestPt = sampleRoundedBowlRing(ring, t, localStandD - 0.4);

    const pBase = new THREE.Vector3(mastGroundPt.x, groundY, mastGroundPt.z);
    const pTip = new THREE.Vector3(mastTopPt.x, roofY + masts.mastHeight, mastTopPt.z);
    const pRoofPierce = new THREE.Vector3(
      (mastGroundPt.x + mastTopPt.x) * 0.5,
      roofY + 0.2,
      (mastGroundPt.z + mastTopPt.z) * 0.5
    );

    const pier = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.45, 3.2, 8),
      concretePedestalMat
    );
    pier.position.set(pBase.x, groundY + 1.6, pBase.z);
    pier.castShadow = true;
    group.add(pier);

    group.add(createStrutBetween(pBase, pRoofPierce, 0.72, 0.55, mastStructureMat, 8));
    group.add(createStrutBetween(pRoofPierce, pTip, 0.16, 0.72, mastStructureMat, 8));

    group.add(
      createStrutBetween(
        new THREE.Vector3(standCrestPt.x, localStandH - 0.5, standCrestPt.z),
        pRoofPierce,
        0.28,
        0.28,
        mastStructureMat,
        6
      )
    );

    group.add(
      createStrutBetween(
        pTip,
        new THREE.Vector3(innerAnchor.x, roofY - 0.2, innerAnchor.z),
        0.075,
        0.075,
        cableMat,
        5
      ),
      createStrutBetween(
        pTip,
        new THREE.Vector3(midAnchor.x, roofY + 0.1, midAnchor.z),
        0.075,
        0.075,
        cableMat,
        5
      ),
      createStrutBetween(
        pTip,
        new THREE.Vector3(backstayGround.x, groundY + 0.8, backstayGround.z),
        0.09,
        0.09,
        cableMat,
        5
      )
    );

    const anchorBlock = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 1.6, 1.8),
      concretePedestalMat
    );
    anchorBlock.position.set(backstayGround.x, groundY + 0.8, backstayGround.z);
    group.add(anchorBlock);
  }

  return group;
}

/**
 * CORNER MEGA-PYLONS (`corner_pylons`), after Lens Bollaert-Delelis and the Marseille Vélodrome:
 * four corner pylons carry four mega-girders framing the pitch above the canopy's front edge;
 * the canopy hangs from them at the front and rests on the stand crests at the rear. Optional
 * `spaceFrame` adds a two-layer lattice over the canopy, and `crownRise` domes it toward the pitch.
 */
function buildCornerPylonsRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const frame = resolveCornerPylonFrame(doc.roof, computeStadiumRingBounds(doc).maxStandH);
  const { group, bounds, innerOffset, outerOffsetFn, primaryStructMat, surface } =
    buildPerimeterCanopyCrown(doc, crossSectionClip, maxAnisotropy, {
      segments: 160,
      surface:
        ({ roofY }) =>
        (_t, f) =>
          roofY + 1.8 * (1 - f) + frame.crownRise * Math.pow(1 - f, 1.6),
    });
  const { ring } = bounds;
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const zMax = crossSectionClip ? 0 : Infinity;

  // Girder rectangle over the front quarter of the canopy depth.
  const lineOffset = innerOffset + (bounds.avgDepth - innerOffset) * 0.25;
  let gx = 0;
  let gz = 0;
  const innerPoly: { x: number; z: number }[] = [];
  const outerPoly: { x: number; z: number }[] = [];
  for (let s = 0; s < 128; s++) {
    const t = s / 128;
    const p = sampleRoundedBowlRing(ring, t, lineOffset);
    gx = Math.max(gx, Math.abs(p.x));
    gz = Math.max(gz, Math.abs(p.z));
    const n = sampleRoundedBowlRing(ring, t, 0);
    innerPoly.push(sampleRoundedBowlRing(ring, t, innerOffset));
    outerPoly.push(sampleRoundedBowlRing(ring, t, outerOffsetFn(n.nx, n.nz)));
  }
  const coversPoint = (x: number, z: number) =>
    insideXZ(outerPoly, x, z) && !insideXZ(innerPoly, x, z);
  const corners = [
    new THREE.Vector3(gx, 0, gz),
    new THREE.Vector3(-gx, 0, gz),
    new THREE.Vector3(-gx, 0, -gz),
    new THREE.Vector3(gx, 0, -gz),
  ];

  const pylonParts: THREE.BufferGeometry[] = [];
  const steelParts: THREE.BufferGeometry[] = [];
  const cableParts: THREE.BufferGeometry[] = [];
  for (const c of corners) {
    if (c.z > zMax) continue;
    // Tapered lattice pylon: four legs converging toward the head, braced every ~8 m.
    const baseHalf = 3.2;
    const topHalf = 1.6;
    const legs = [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ].map(([sx, sz]) => ({
      bot: new THREE.Vector3(c.x + sx * baseHalf, 0, c.z + sz * baseHalf),
      top: new THREE.Vector3(c.x + sx * topHalf, frame.pylonTopY, c.z + sz * topHalf),
    }));
    for (const leg of legs) pylonParts.push(beamGeometry(leg.bot, leg.top, 1.1, 1.1));
    const levels = Math.max(3, Math.round(frame.pylonTopY / 8));
    for (let l = 1; l <= levels; l++) {
      const cur = legs.map((leg) => new THREE.Vector3().lerpVectors(leg.bot, leg.top, l / levels));
      const prev = legs.map((leg) =>
        new THREE.Vector3().lerpVectors(leg.bot, leg.top, (l - 1) / levels)
      );
      for (let k = 0; k < 4; k++) {
        pylonParts.push(beamGeometry(cur[k], cur[(k + 1) % 4], 0.5, 0.5));
        pylonParts.push(beamGeometry(prev[k], cur[(k + 1) % 4], 0.35, 0.35));
      }
    }
  }

  // Four mega-girders: Warren trusses between the pylon centrelines.
  for (let i = 0; i < 4; i++) {
    const a = corners[i].clone().setY(frame.girderBotY);
    const b = corners[(i + 1) % 4].clone().setY(frame.girderBotY);
    if (a.z > zMax && b.z > zMax) continue;
    a.z = Math.min(a.z, zMax);
    b.z = Math.min(b.z, zMax);
    const span = a.distanceTo(b);
    if (span < 1) continue;
    steelParts.push(
      ...warrenTrussParts(
        a,
        b,
        frame.girderTopY - frame.girderBotY,
        Math.max(6, Math.round(span / 8)),
        1.6,
        0.6
      )
    );
    // Hangers down to the canopy wherever the girder runs over it.
    const hangers = Math.max(4, Math.round(span / 10));
    for (let k = 1; k < hangers; k++) {
      const p = new THREE.Vector3().lerpVectors(a, b, k / hangers);
      if (!coversPoint(p.x, p.z)) continue;
      cableParts.push(beamGeometry(p, new THREE.Vector3(p.x, frame.canopyY + 1.0, p.z), 0.22, 0.22));
    }
    // Stays from pylon heads standing well above the girders down to their third points.
    if (frame.pylonTopY > frame.girderTopY + 4) {
      for (const [end, f] of [
        [corners[i], 0.3],
        [corners[(i + 1) % 4], 0.7],
      ] as const) {
        if (end.z > zMax) continue;
        const head = end.clone().setY(frame.pylonTopY - 0.5);
        const anchor = new THREE.Vector3().lerpVectors(a, b, f).setY(frame.girderTopY);
        cableParts.push(beamGeometry(head, anchor, 0.25, 0.25));
      }
    }
  }

  if (doc.roof.spaceFrame) {
    // Two-layer lattice following the canopy: bottom nodes on the deck, top nodes 3.5 m above.
    const along = Math.max(24, Math.round(72 * Math.max(0.25, tEnd - tStart)));
    const across = 4;
    const node = (s: number, c: number, top: boolean): THREE.Vector3 => {
      const t = tStart + (s / along) * (tEnd - tStart);
      const n = sampleRoundedBowlRing(ring, t, 0);
      const outer = outerOffsetFn(n.nx, n.nz);
      const f = c / across;
      const p = sampleRoundedBowlRing(ring, t, innerOffset + (outer - innerOffset) * f);
      return new THREE.Vector3(p.x, surface(t, f) + (top ? 3.5 : 0.35), p.z);
    };
    const stations = closed ? along : along + 1;
    for (let s = 0; s < stations; s++) {
      const next = closed ? (s + 1) % along : s + 1;
      const last = !closed && s === along;
      for (let c = 0; c <= across; c++) {
        steelParts.push(beamGeometry(node(s, c, false), node(s, c, true), 0.22, 0.22));
        if (c < across) {
          steelParts.push(beamGeometry(node(s, c, true), node(s, c + 1, true), 0.32, 0.32));
          steelParts.push(beamGeometry(node(s, c, false), node(s, c + 1, true), 0.2, 0.2));
        }
        if (!last) {
          steelParts.push(beamGeometry(node(s, c, true), node(next, c, true), 0.32, 0.32));
          steelParts.push(beamGeometry(node(s, c, false), node(next, c, true), 0.2, 0.2));
        }
      }
    }
  }

  const named: [THREE.BufferGeometry[], string][] = [
    [pylonParts, 'CornerMegaPylons'],
    [steelParts, 'CornerMegaGirders'],
    [cableParts, 'CornerRoofHangers'],
  ];
  for (const [parts, name] of named) {
    const mesh = mergedMesh(parts, primaryStructMat, name);
    if (mesh) group.add(mesh);
  }
  return group;
}

/**
 * COUNTERWEIGHTED CANTILEVER (`counterweighted_cantilever`), after the Groupama Stadium: radial
 * steel trusses pivot on a post at the stand crest; the front arm carries the canopy over the
 * seats, and the shorter back-span is tied down to a pier behind the stands.
 */
function buildCounterweightedCantileverRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, innerOffset, outerOffsetFn, primaryStructMat, surface } =
    buildPerimeterCanopyCrown(doc, crossSectionClip, maxAnisotropy);
  const { ring, standDepthAtNormal, standHeightAtNormal } = bounds;
  const { trussCount, backspanRatio } = resolveCounterweightTrusses(doc.roof);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const stations = Math.max(4, Math.round(trussCount * Math.max(0.25, tEnd - tStart)));

  const trussParts: THREE.BufferGeometry[] = [];
  const tieParts: THREE.BufferGeometry[] = [];
  const pierParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < stations; i++) {
    const t = tStart + ((closed ? i : i + 0.5) / stations) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const outer = outerOffsetFn(n.nx, n.nz);
    const pivotOff = Math.max(innerOffset + 4, standDepthAtNormal(n.nx, n.nz) - 0.5);
    const frontLen = pivotOff - innerOffset;
    const backOff = pivotOff + frontLen * backspanRatio;
    const maxDepth = Math.max(3, Math.min(8, frontLen * 0.12));
    // Bottom chord follows the canopy (held flat past its rear edge); the top chord peaks at the pivot.
    const deckY = (off: number) => {
      const f = Math.max(0, Math.min(1, (off - innerOffset) / Math.max(1, outer - innerOffset)));
      return surface(t, f) + 0.35;
    };
    const depthAt = (off: number) =>
      off <= pivotOff
        ? 0.8 + (maxDepth - 0.8) * ((off - innerOffset) / frontLen)
        : maxDepth - (maxDepth - 1.2) * ((off - pivotOff) / (backOff - pivotOff));
    const nodes = Math.max(6, Math.round((backOff - innerOffset) / 4));
    const bottom: THREE.Vector3[] = [];
    const top: THREE.Vector3[] = [];
    for (let k = 0; k <= nodes; k++) {
      const off = innerOffset + ((backOff - innerOffset) * k) / nodes;
      const p = sampleRoundedBowlRing(ring, t, off);
      const y = deckY(Math.min(off, outer));
      bottom.push(new THREE.Vector3(p.x, y, p.z));
      top.push(new THREE.Vector3(p.x, y + depthAt(off), p.z));
    }
    for (let k = 0; k < nodes; k++) {
      trussParts.push(beamGeometry(bottom[k], bottom[k + 1], 0.55, 0.55));
      trussParts.push(beamGeometry(top[k], top[k + 1], 0.6, 0.6));
      const [d0, d1] = k % 2 === 0 ? [bottom[k], top[k + 1]] : [top[k], bottom[k + 1]];
      trussParts.push(beamGeometry(d0, d1, 0.28, 0.28));
      trussParts.push(beamGeometry(bottom[k + 1], top[k + 1], 0.24, 0.24));
    }

    // Fulcrum post from the stand crest up to the truss.
    const pivot = sampleRoundedBowlRing(ring, t, pivotOff);
    trussParts.push(
      beamGeometry(
        new THREE.Vector3(pivot.x, standHeightAtNormal(n.nx, n.nz) - 0.5, pivot.z),
        new THREE.Vector3(pivot.x, deckY(pivotOff), pivot.z),
        1.1,
        1.1
      )
    );

    // Vertical tie rod from the back-span end down to a concrete pier behind the stands.
    const tail = bottom[nodes];
    const anchor = sampleRoundedBowlRing(ring, t, backOff);
    tieParts.push(beamGeometry(tail, new THREE.Vector3(anchor.x, 1.6, anchor.z), 0.3, 0.3));
    const pier = new THREE.BoxGeometry(2.4, 1.6, 2.4);
    pier.translate(anchor.x, 0.8, anchor.z);
    pierParts.push(pier);
  }

  const named: [THREE.BufferGeometry[], string, THREE.Material][] = [
    [trussParts, 'CounterweightTrusses', primaryStructMat],
    [tieParts, 'CounterweightTieRods', primaryStructMat],
    [pierParts, 'CounterweightPiers', createConcreteBowlMaterial(maxAnisotropy)],
  ];
  for (const [parts, name, mat] of named) {
    const mesh = mergedMesh(parts, mat, name);
    if (mesh) group.add(mesh);
  }
  return group;
}

/**
 * 4. MONUMENTAL TWIN ARCHES (`twin_arch`):
 * Annular canopy hung from two parallel lattice arches, with a suspended centre-hung scoreboard.
 */
function buildTwinArchRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, roofY, primaryStructMat } = buildPerimeterCanopyCrown(
    doc,
    crossSectionClip,
    maxAnisotropy
  );
  const { innerHalfX, innerHalfZ, avgDepth, concourseWidth } = bounds;
  const cableSteelMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.3,
    metalness: 0.84,
  });
  const concreteMat = createConcreteBowlMaterial(maxAnisotropy);

  const archHalfSpanX = innerHalfX + avgDepth + concourseWidth + 24;
  const archApexY = roofY + 26;
  const archZPos = Math.max(24, innerHalfZ * 0.58);
  const archZOffsets = crossSectionClip ? [-archZPos] : [-archZPos, archZPos];

  for (const zArch of archZOffsets) {
    for (const xSign of [-1, 1] as const) {
      const abut = new THREE.Mesh(
        new THREE.BoxGeometry(9.5, 6.5, 5.2),
        concreteMat
      );
      abut.position.set(xSign * archHalfSpanX, 3.25, zArch);
      abut.rotation.z = xSign * 0.32;
      abut.castShadow = true;
      group.add(abut);
    }

    const upperPts: THREE.Vector3[] = [];
    const lowerPts: THREE.Vector3[] = [];
    const archSegs = 44;
    for (let s = 0; s <= archSegs; s++) {
      const u = s / archSegs;
      const x = -archHalfSpanX + u * (archHalfSpanX * 2);
      const parabola = 1 - Math.pow(x / archHalfSpanX, 2);
      const yLow = 2.0 + parabola * (archApexY - 4.5);
      const yHigh = yLow + 3.2;
      lowerPts.push(new THREE.Vector3(x, yLow, zArch));
      upperPts.push(new THREE.Vector3(x, yHigh, zArch));
    }

    group.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(upperPts), 56, 0.68, 8, false),
        primaryStructMat
      ),
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lowerPts), 56, 0.68, 8, false),
        primaryStructMat
      )
    );

    for (let s = 1; s < archSegs; s++) {
      group.add(createStrutBetween(lowerPts[s], upperPts[s], 0.22, 0.22, primaryStructMat, 5));
      if (s < archSegs - 1) {
        group.add(
          createStrutBetween(lowerPts[s], upperPts[s + 1], 0.16, 0.16, primaryStructMat, 5)
        );
      }
      if (s % 3 === 0 && lowerPts[s].y > roofY + 2.2) {
        group.add(
          createStrutBetween(
            lowerPts[s],
            new THREE.Vector3(lowerPts[s].x, roofY + 1.8, zArch),
            0.09,
            0.09,
            cableSteelMat,
            5
          )
        );
      }
    }
  }

  if (!crossSectionClip) {
    for (let x = -72; x <= 72; x += 24) {
      const parabola = 1 - Math.pow(x / archHalfSpanX, 2);
      const yTie = 2.0 + parabola * (archApexY - 4.5) + 1.6;
      group.add(
        createStrutBetween(
          new THREE.Vector3(x, yTie, -archZPos),
          new THREE.Vector3(x, yTie, archZPos),
          0.36,
          0.36,
          primaryStructMat,
          6
        )
      );
    }

    const jumboY = Math.max(24, roofY - 7.5);
    const jumboBody = new THREE.Mesh(
      new THREE.BoxGeometry(34, 9.5, 13),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4, metalness: 0.6 })
    );
    jumboBody.position.set(0, jumboY, 0);
    jumboBody.castShadow = true;
    group.add(jumboBody);

    const screenGlowMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      emissive: new THREE.Color(0x38bdf8),
      emissiveIntensity: doc.lighting === 'day' ? 0.45 : 1.15,
      roughness: 0.18,
    });
    for (const zSign of [-1, 1] as const) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(32.5, 8.2), screenGlowMat);
      face.position.set(0, jumboY, zSign * 6.56);
      if (zSign === -1) face.rotation.y = Math.PI;
      group.add(face);
    }
    for (const sx of [-14, 14]) {
      for (const sz of [-6, 6]) {
        const archZ = sz < 0 ? -archZPos : archZPos;
        const parabola = 1 - Math.pow(sx / archHalfSpanX, 2);
        const archY = 2.0 + parabola * (archApexY - 4.5);
        group.add(
          createStrutBetween(
            new THREE.Vector3(sx, archY, archZ),
            new THREE.Vector3(sx, jumboY + 4.75, sz),
            0.08,
            0.08,
            cableSteelMat,
            5
          )
        );
      }
    }
  }

  return group;
}

/**
 * 5. ICONIC GIANT SINGLE ARCH (`giant_arch`):
 * Monumental 3-chord spatial lattice steel arch spanning ~275m across the entire stadium
 * at a tilted architectural angle, suspending the roof canopy via fan stay cables!
 */
function buildGiantArchRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const {
    ring,
    innerHalfX,
    innerHalfZ,
    maxStandH,
    avgDepth,
    concourseWidth,
    canopyOuterOffsetAt,
    standHeightAtNormal,
    standDepthAtNormal,
  } = computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);

  const roofY = maxStandH + Math.max(4.0, doc.roof.heightOffset);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const outerOffsetFn = (nx: number, nz: number) => canopyOuterOffsetAt(nx, nz, 3.6);

  const { surfaceMat: canopyMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy
  );

  group.add(
    buildAnnularCanopyMesh(
      ring,
      doc.shape,
      innerOffset,
      outerOffsetFn,
      roofY - 0.4,
      roofY + 0.5,
      crossSectionClip,
      canopyMat,
      shadowDepthMat
    ),
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerOffset,
      roofY - 0.72,
      doc.lighting,
      crossSectionClip,
      hasRoofGantryLights(doc)
    )
  );

  const primaryStructMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const cableMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.22,
    metalness: 0.9,
  });
  const concreteMat = createConcreteBowlMaterial(maxAnisotropy);

  // Rear perimeter struts connecting stand crest to outer roof ring
  const perimCols = Math.max(12, Math.round(40 * arcFraction));
  for (let i = 0; i < perimCols; i++) {
    const frac = closed ? i / perimCols : i / Math.max(1, perimCols - 1);
    const t = tStart + frac * (tEnd - tStart);
    const s0 = sampleRoundedBowlRing(ring, t, 0);
    const d0 = standDepthAtNormal(s0.nx, s0.nz);
    const h0 = standHeightAtNormal(s0.nx, s0.nz);
    const localOuter = outerOffsetFn(s0.nx, s0.nz);
    const wallPt = sampleRoundedBowlRing(ring, t, d0 - 0.2);
    const roofPt = sampleRoundedBowlRing(ring, t, localOuter - 0.6);
    group.add(
      createStrutBetween(
        new THREE.Vector3(wallPt.x, h0 - 0.5, wallPt.z),
        new THREE.Vector3(roofPt.x, roofY + 0.4, roofPt.z),
        0.32,
        0.38,
        primaryStructMat,
        6
      )
    );
  }

  // Monumental 125m-class tilted 3-chord tubular lattice arch spanning East-to-West!
  const archHalfSpanX = innerHalfX + avgDepth + concourseWidth + 32;
  const archApexY = roofY + 46;
  const archBaseZ = -Math.max(16, innerHalfZ * 0.36);
  const archTiltZ = 14.5; // Tilts gracefully southward toward center pitch at apex

  for (const xSign of [-1, 1] as const) {
    const thrustBlock = new THREE.Mesh(
      new THREE.BoxGeometry(11, 7.5, 8.5),
      concreteMat
    );
    thrustBlock.position.set(xSign * archHalfSpanX, 3.75, archBaseZ);
    thrustBlock.rotation.z = xSign * 0.35;
    thrustBlock.castShadow = true;
    group.add(thrustBlock);
  }

  const archSegs = 48;
  const topChord: THREE.Vector3[] = [];
  const botLeftChord: THREE.Vector3[] = [];
  const botRightChord: THREE.Vector3[] = [];

  for (let s = 0; s <= archSegs; s++) {
    const u = s / archSegs;
    const x = -archHalfSpanX + u * (archHalfSpanX * 2);
    const parabola = Math.max(0, 1 - Math.pow(x / archHalfSpanX, 2));
    const centerY = 2.5 + parabola * (archApexY - 2.5);
    const centerZ = archBaseZ + parabola * archTiltZ;
    // Lenticular basket diameter widens at mid-span (~6.5m) and tapers to pins at thrust blocks!
    const spread = 0.8 + parabola * 2.8;

    topChord.push(new THREE.Vector3(x, centerY + spread * 1.15, centerZ));
    botLeftChord.push(new THREE.Vector3(x, centerY - spread * 0.85, centerZ - spread));
    botRightChord.push(new THREE.Vector3(x, centerY - spread * 0.85, centerZ + spread));
  }

  for (const chordPts of [topChord, botLeftChord, botRightChord]) {
    group.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(chordPts), 64, 0.62, 8, false),
        primaryStructMat
      )
    );
  }

  // Diaphragm rings + diagonal lattice lacing along the giant arch + fan stay cables to North & South roofs!
  for (let s = 1; s < archSegs; s++) {
    group.add(
      createStrutBetween(topChord[s], botLeftChord[s], 0.18, 0.18, primaryStructMat, 5),
      createStrutBetween(topChord[s], botRightChord[s], 0.18, 0.18, primaryStructMat, 5),
      createStrutBetween(botLeftChord[s], botRightChord[s], 0.18, 0.18, primaryStructMat, 5)
    );
    if (s < archSegs - 1) {
      group.add(
        createStrutBetween(topChord[s], botLeftChord[s + 1], 0.13, 0.13, primaryStructMat, 4),
        createStrutBetween(topChord[s], botRightChord[s + 1], 0.13, 0.13, primaryStructMat, 4)
      );
    }

    // Forest of diagonal suspension cables fanning down to North roof edge & South roof edge
    if (s % 3 === 0 && topChord[s].y > roofY + 6) {
      const xPos = topChord[s].x;
      if (Math.abs(xPos) < innerHalfX + avgDepth * 0.65) {
        const northTargetZ = -(innerHalfZ + innerOffset + 3.5);
        group.add(
          createStrutBetween(
            botLeftChord[s],
            new THREE.Vector3(xPos, roofY - 0.1, northTargetZ),
            0.085,
            0.085,
            cableMat,
            5
          )
        );
        if (!crossSectionClip) {
          const southTargetZ = innerHalfZ + innerOffset + 3.5;
          group.add(
            createStrutBetween(
              botRightChord[s],
              new THREE.Vector3(xPos, roofY - 0.1, southTargetZ),
              0.085,
              0.085,
              cableMat,
              5
            )
          );
        }
      }
    }
  }

  return group;
}

/**
 * 5. BOWSTRING LENTICULAR MEGA-TRUSSES (`bowstring_arch`)
 */
function buildBowstringArchRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const {
    ring,
    innerHalfX,
    innerHalfZ,
    maxStandH,
    avgDepth,
    canopyOuterOffsetAt,
    standHeightAtNormal,
    standDepthAtNormal,
  } = computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);

  const roofY = maxStandH + Math.max(3.8, doc.roof.heightOffset);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const outerOffsetFn = (nx: number, nz: number) => canopyOuterOffsetAt(nx, nz, 3.4);

  const { surfaceMat: canopyMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy
  );

  group.add(
    buildAnnularCanopyMesh(
      ring,
      doc.shape,
      innerOffset,
      outerOffsetFn,
      roofY - 0.5,
      roofY + 0.5,
      crossSectionClip,
      canopyMat,
      shadowDepthMat
    ),
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerOffset,
      roofY - 0.78,
      doc.lighting,
      crossSectionClip,
      hasRoofGantryLights(doc)
    )
  );

  const tubularStructMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const pylonConcreteMat = createConcreteBowlMaterial(maxAnisotropy);

  const perimCols = Math.max(12, Math.round(40 * arcFraction));
  for (let i = 0; i < perimCols; i++) {
    const frac = closed ? i / perimCols : i / Math.max(1, perimCols - 1);
    const t = tStart + frac * (tEnd - tStart);
    const s0 = sampleRoundedBowlRing(ring, t, 0);
    const d0 = standDepthAtNormal(s0.nx, s0.nz);
    const h0 = standHeightAtNormal(s0.nx, s0.nz);
    const localOuter = outerOffsetFn(s0.nx, s0.nz);
    const wallPt = sampleRoundedBowlRing(ring, t, d0 - 0.2);
    const roofPt = sampleRoundedBowlRing(ring, t, localOuter - 0.6);
    group.add(
      createStrutBetween(
        new THREE.Vector3(wallPt.x, h0 - 0.5, wallPt.z),
        new THREE.Vector3(roofPt.x, roofY + 0.4, roofPt.z),
        0.34,
        0.4,
        tubularStructMat,
        6
      )
    );
  }

  const spanHalfX = innerHalfX + avgDepth * 0.65;
  const trussZPositions = crossSectionClip
    ? [-(innerHalfZ + innerOffset + 3)]
    : [-(innerHalfZ + innerOffset + 3), innerHalfZ + innerOffset + 3];

  for (const zPos of trussZPositions) {
    for (const xSign of [-1, 1] as const) {
      const pylon = new THREE.Mesh(
        new THREE.BoxGeometry(4.2, roofY + 2.2, 4.2),
        pylonConcreteMat
      );
      pylon.position.set(xSign * spanHalfX, (roofY + 2.2) / 2, zPos);
      pylon.castShadow = true;
      pylon.receiveShadow = true;
      group.add(pylon);
    }

    const topPts: THREE.Vector3[] = [];
    const botPts: THREE.Vector3[] = [];
    const segs = 32;
    for (let s = 0; s <= segs; s++) {
      const u = s / segs;
      const x = -spanHalfX + u * (spanHalfX * 2);
      const lens = Math.sin(u * Math.PI);
      topPts.push(new THREE.Vector3(x, roofY + 1.2 + lens * 11.5, zPos));
      botPts.push(new THREE.Vector3(x, roofY + 0.6 + lens * 1.8, zPos));
    }

    group.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(topPts), 40, 0.58, 8, false),
        tubularStructMat
      ),
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(botPts), 40, 0.42, 8, false),
        tubularStructMat
      )
    );

    for (let s = 1; s < segs; s++) {
      group.add(
        createStrutBetween(botPts[s], topPts[s], 0.16, 0.16, tubularStructMat, 5)
      );
      if (s % 2 === 0) {
        group.add(
          createStrutBetween(botPts[s], topPts[s + 1], 0.12, 0.12, tubularStructMat, 5)
        );
      }
    }
  }

  return group;
}

/**
 * 6. BICYCLE-WHEEL CABLE ROOF ON V-COLONNADE (`bicycle_wheel`)
 */
function buildBicycleWheelCableRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const {
    ring,
    maxStandH,
    avgDepth,
    canopyOuterOffsetAt,
    standHeightAtNormal,
    standDepthAtNormal,
  } = computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const roofY = maxStandH + Math.max(3.6, doc.roof.heightOffset);

  const innerDripOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const outerRingOffsetFn = (nx: number, nz: number) => canopyOuterOffsetAt(nx, nz, 3.2);

  const { surfaceMat: canopyMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy
  );

  group.add(
    buildAnnularCanopyMesh(
      ring,
      doc.shape,
      innerDripOffset,
      outerRingOffsetFn,
      roofY - 0.55,
      roofY + 0.35,
      crossSectionClip,
      canopyMat,
      shadowDepthMat
    ),
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerDripOffset,
      roofY - 0.85,
      doc.lighting,
      crossSectionClip,
      hasRoofGantryLights(doc)
    )
  );

  const ringStructMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const cableMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.22,
    metalness: 0.92,
  });

  const segments = doc.shape === 'octagonal_arena' ? 160 : 128;
  const activeSegs = Math.max(32, Math.round(segments * arcFraction));

  const outerRingPts: THREE.Vector3[] = [];
  const innerUpperPts: THREE.Vector3[] = [];
  const innerLowerPts: THREE.Vector3[] = [];

  for (let s = 0; s <= activeSegs; s++) {
    const t = tStart + (s / activeSegs) * (tEnd - tStart);
    const inPt = sampleRoundedBowlRing(ring, t, innerDripOffset + 0.5);
    const outPt = sampleRoundedBowlRing(ring, t, outerRingOffsetFn(inPt.nx, inPt.nz));

    outerRingPts.push(new THREE.Vector3(outPt.x, roofY + 0.4, outPt.z));
    innerUpperPts.push(new THREE.Vector3(inPt.x, roofY + 2.0, inPt.z));
    innerLowerPts.push(new THREE.Vector3(inPt.x, roofY - 2.3, inPt.z));
  }

  group.add(
    new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(outerRingPts, closed), 112, 0.72, 8, closed),
      ringStructMat
    ),
    new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(innerUpperPts, closed), 112, 0.22, 6, closed),
      cableMat
    ),
    new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(innerLowerPts, closed), 112, 0.22, 6, closed),
      cableMat
    )
  );

  const bayCount = Math.max(14, Math.round(44 * arcFraction));
  for (let i = 0; i < bayCount; i++) {
    const fMid = (i + 0.5) / bayCount;
    const fL = i / bayCount;
    const fR = (i + 1) / bayCount;
    const tMid = tStart + fMid * (tEnd - tStart);
    const tLeft = tStart + fL * (tEnd - tStart);
    const tRight = tStart + fR * (tEnd - tStart);

    const sL = sampleRoundedBowlRing(ring, tLeft, 0);
    const sR = sampleRoundedBowlRing(ring, tRight, 0);
    const sMid = sampleRoundedBowlRing(ring, tMid, 0);
    const dL = standDepthAtNormal(sL.nx, sL.nz);
    const dR = standDepthAtNormal(sR.nx, sR.nz);
    const hL = standHeightAtNormal(sL.nx, sL.nz);
    const hR = standHeightAtNormal(sR.nx, sR.nz);

    const wallFootL = sampleRoundedBowlRing(ring, tLeft, dL - 0.1);
    const wallFootR = sampleRoundedBowlRing(ring, tRight, dR - 0.1);
    const outApex = sampleRoundedBowlRing(
      ring,
      tMid,
      outerRingOffsetFn(sMid.nx, sMid.nz)
    );
    const inAnchor = sampleRoundedBowlRing(ring, tMid, innerDripOffset + 0.5);

    const pOut = new THREE.Vector3(outApex.x, roofY + 0.4, outApex.z);
    const pFootL = new THREE.Vector3(wallFootL.x, hL - 0.6, wallFootL.z);
    const pFootR = new THREE.Vector3(wallFootR.x, hR - 0.6, wallFootR.z);

    group.add(
      createStrutBetween(pFootL, pOut, 0.34, 0.4, ringStructMat, 6),
      createStrutBetween(pFootR, pOut, 0.34, 0.4, ringStructMat, 6)
    );

    const pInTop = new THREE.Vector3(inAnchor.x, roofY + 2.0, inAnchor.z);
    const pInBot = new THREE.Vector3(inAnchor.x, roofY - 2.3, inAnchor.z);
    group.add(
      createStrutBetween(pInBot, pInTop, 0.13, 0.13, ringStructMat, 6),
      createStrutBetween(pOut, pInTop, 0.075, 0.075, cableMat, 5),
      createStrutBetween(pOut, pInBot, 0.075, 0.075, cableMat, 5)
    );
  }

  return group;
}

/**
 * 7. TENSILE CABLE-NET & SADDLE MEMBRANE PEAKS (`tensile_net`):
 * Sweeping anticlastic peaks & catenary valleys in PTFE/ETFE suspended from inclined masts
 * with ridge cables, valley tie-downs, and perimeter ground anchors!
 */
function buildTensileNetMembraneRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const { ring, maxStandH, avgDepth, canopyOuterOffsetAt, exteriorSupportMinOffsetAt } =
    computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const sunkenDepth = getEffectiveSunkenDepth(doc);
  const groundY = Math.min(sunkenDepth, maxStandH * 0.6);

  const baseRoofY = maxStandH + Math.max(3.5, doc.roof.heightOffset);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const outerOffsetFn = (nx: number, nz: number) => canopyOuterOffsetAt(nx, nz, 5.5);

  const peakTotalFull = 12;
  const activePeaks = Math.max(4, Math.round(peakTotalFull * arcFraction));
  const uSegs = activePeaks * 12;
  const vSegs = 8;
  const ringCount = closed ? uSegs : uSegs + 1;

  const positions = new Float32Array(ringCount * (vSegs + 1) * 3);
  const uvs = new Float32Array(ringCount * (vSegs + 1) * 2);
  const indices: number[] = [];

  for (let s = 0; s < ringCount; s++) {
    const frac = s / uSegs;
    const t = tStart + frac * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const localOuter = outerOffsetFn(n.nx, n.nz);
    const wavePhase = frac * activePeaks * Math.PI * 2;
    const peakWave = Math.pow(0.5 + 0.5 * Math.cos(wavePhase), 1.8); // 1 at mast peaks, 0 in valleys

    for (let v = 0; v <= vSegs; v++) {
      const vf = v / vSegs; // 0 = inner edge, 1 = outer edge
      const radOff = innerOffset + vf * (localOuter - innerOffset);
      // Saddle-cone anticlastic height: peaks sharply near v=0.68 at mast stations, dips in valleys
      const radialCone = Math.exp(-Math.pow((vf - 0.65) / 0.34, 2));
      const catenarySag = Math.sin(vf * Math.PI) * -1.4;
      const py =
        baseRoofY +
        peakWave * radialCone * 11.5 -
        (1 - peakWave) * 2.2 +
        catenarySag;

      const pt = sampleRoundedBowlRing(ring, t, radOff);
      const base = (s * (vSegs + 1) + v) * 3;
      positions[base] = pt.x;
      positions[base + 1] = py;
      positions[base + 2] = pt.z;

      const uvBase = (s * (vSegs + 1) + v) * 2;
      uvs[uvBase] = frac * 16 * arcFraction;
      uvs[uvBase + 1] = vf;
    }
  }

  for (let s = 0; s < uSegs; s++) {
    const nextS = closed ? (s + 1) % ringCount : s + 1;
    for (let v = 0; v < vSegs; v++) {
      const a = s * (vSegs + 1) + v;
      const b = nextS * (vSegs + 1) + v;
      const c = nextS * (vSegs + 1) + v + 1;
      const d = s * (vSegs + 1) + v + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const netGeo = new THREE.BufferGeometry();
  netGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  netGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  netGeo.setIndex(indices);
  netGeo.computeVertexNormals();

  const { surfaceMat: membraneMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy,
    14,
    3,
    1,
    0.92
  );
  const netMesh = new THREE.Mesh(netGeo, membraneMat);
  netMesh.name = 'RoofCanopySurface';
  netMesh.customDepthMaterial = shadowDepthMat;
  netMesh.castShadow = true;
  netMesh.receiveShadow = true;
  netMesh.renderOrder = 2;
  group.add(netMesh);

  const mastMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const cableMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.22,
    metalness: 0.92,
  });
  const concreteMat = createConcreteBowlMaterial(maxAnisotropy);

  // Catenary inner edge cable ring
  const innerEdgePts: THREE.Vector3[] = [];
  for (let s = 0; s < ringCount; s++) {
    const idx = s * (vSegs + 1) * 3;
    innerEdgePts.push(
      new THREE.Vector3(positions[idx], positions[idx + 1], positions[idx + 2])
    );
  }
  group.add(
    new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(innerEdgePts, closed),
        uSegs,
        0.18,
        6,
        closed
      ),
      cableMat
    )
  );

  // Inclined perimeter tubular masts + flying peak struts + backstay cables at each peak!
  const mastLimit = closed ? activePeaks : activePeaks + 1;
  for (let p = 0; p < mastLimit; p++) {
    const frac = p / activePeaks;
    const t = tStart + frac * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const localOuter = outerOffsetFn(n.nx, n.nz);
    const mastFootOff = Math.max(
      localOuter + 3.2,
      exteriorSupportMinOffsetAt(n.nx, n.nz) + 1.6
    );
    const mastFoot = sampleRoundedBowlRing(ring, t, mastFootOff);
    const mastHead = sampleRoundedBowlRing(
      ring,
      t,
      innerOffset + 0.65 * (localOuter - innerOffset)
    );
    const anchorOut = sampleRoundedBowlRing(ring, t, mastFootOff + 11.3);
    const inEdge = sampleRoundedBowlRing(ring, t, innerOffset);

    const pFoot = new THREE.Vector3(mastFoot.x, groundY, mastFoot.z);
    const pPeak = new THREE.Vector3(mastHead.x, baseRoofY + 11.2, mastHead.z);
    const pMastTip = new THREE.Vector3(mastHead.x, baseRoofY + 19.5, mastHead.z);
    const pAnchor = new THREE.Vector3(anchorOut.x, groundY + 0.7, anchorOut.z);

    group.add(
      createStrutBetween(pFoot, pMastTip, 0.24, 0.65, mastMat, 8),
      createStrutBetween(pMastTip, pPeak, 0.09, 0.09, cableMat, 5),
      createStrutBetween(pMastTip, pAnchor, 0.1, 0.1, cableMat, 5),
      createStrutBetween(
        pMastTip,
        new THREE.Vector3(inEdge.x, baseRoofY - 0.2, inEdge.z),
        0.08,
        0.08,
        cableMat,
        5
      )
    );

    const block = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 2.2), concreteMat);
    block.position.copy(pAnchor);
    group.add(block);

    // Valley tie-down cable halfway to next peak
    if (p < activePeaks) {
      const tVal = tStart + ((p + 0.5) / activePeaks) * (tEnd - tStart);
      const nVal = sampleRoundedBowlRing(ring, tVal, 0);
      const valOuter = outerOffsetFn(nVal.nx, nVal.nz);
      const valGroundOff = Math.max(
        valOuter + 6.5,
        exteriorSupportMinOffsetAt(nVal.nx, nVal.nz) + 4.5
      );
      const valOut = sampleRoundedBowlRing(ring, tVal, valOuter);
      const valGround = sampleRoundedBowlRing(ring, tVal, valGroundOff);
      group.add(
        createStrutBetween(
          new THREE.Vector3(valOut.x, baseRoofY - 2.2, valOut.z),
          new THREE.Vector3(valGround.x, groundY + 0.5, valGround.z),
          0.08,
          0.08,
          cableMat,
          5
        )
      );
    }
  }

  return group;
}

/** Apex height (m) of the touchline arches of `crossed_arches` above the canopy. */
const CROSSED_ARCH_RISE = 20;

/**
 * CROSSED ARCHES (`crossed_arches`): four tubular arches over the canopy, two along the
 * touchlines and two behind the goals, crossing near the corners, with a zigzag of hangers down
 * to the roof (Estádio da Luz).
 */
function buildCrossedArchesRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, roofY, innerOffset } = buildPerimeterCanopyCrown(
    doc,
    crossSectionClip,
    maxAnisotropy
  );
  const mats = resolveStadiumMaterials(doc);
  const { innerHalfX, innerHalfZ, nominalOuterOffset } = bounds;
  const outer = nominalOuterOffset(3.8);
  const mid = (innerOffset + outer) / 2;
  const deckY = roofY + 1;
  const tubes: THREE.BufferGeometry[] = [];
  const hangers: THREE.BufferGeometry[] = [];
  // Parabolic arch along `axis` at `offset`, springing from the ground at `±foot`.
  const arch = (axis: 'x' | 'z', offset: number, foot: number, apexY: number) => {
    const end = axis === 'z' && crossSectionClip ? 0 : foot;
    const at = (u: number) => {
      const s = -foot + (foot + end) * u;
      const y = apexY * (1 - (s / foot) ** 2);
      return axis === 'x' ? new THREE.Vector3(s, y, offset) : new THREE.Vector3(offset, y, s);
    };
    const pts = Array.from({ length: 41 }, (_, k) => at(k / 40));
    tubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 1.1, 10, false));
    // Zigzag hangers wherever the arch rides well above the deck.
    for (let k = 1; k < 40; k++) {
      const p = at(k / 40);
      if (p.y < deckY + 3) continue;
      const q = at((k + (k % 2 === 0 ? 1 : -1)) / 40);
      hangers.push(
        beamGeometry(p, new THREE.Vector3(p.x, deckY, p.z), 0.3, 0.3),
        beamGeometry(p, new THREE.Vector3(q.x, deckY, q.z), 0.3, 0.3)
      );
    }
  };
  for (const sign of crossSectionClip ? [-1] : [-1, 1]) {
    arch('x', sign * (innerHalfZ + mid), innerHalfX + outer + 8, roofY + CROSSED_ARCH_RISE);
  }
  for (const sign of [-1, 1]) {
    arch('z', sign * (innerHalfX + mid), innerHalfZ + outer + 8, roofY + CROSSED_ARCH_RISE * 0.7);
  }
  const steelMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const archMesh = mergedMesh(tubes, steelMat, 'CrossedArchTubes');
  if (archMesh) group.add(archMesh);
  const hangerMesh = mergedMesh(hangers, steelMat, 'CrossedArchHangers');
  if (hangerMesh) group.add(hangerMesh);
  return group;
}

/** Open canopies hung from or carried by a megastructure: masts, arches, pylons, cables. */
export const STRUCTURE_ROOF_BUILDERS: Partial<Record<RoofStyle, RoofBuilder>> = {
  suspended_masts: buildSuspendedMastsRoof,
  twin_arch: buildTwinArchRoof,
  counterweighted_cantilever: buildCounterweightedCantileverRoof,
  corner_pylons: buildCornerPylonsRoof,
  giant_arch: buildGiantArchRoof,
  bowstring_arch: buildBowstringArchRoof,
  bicycle_wheel: buildBicycleWheelCableRoof,
  tensile_net: buildTensileNetMembraneRoof,
  crossed_arches: buildCrossedArchesRoof,
};

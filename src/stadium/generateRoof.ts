import * as THREE from 'three';
import { resolveCornerFollow } from './generateStand';
import { CornerQuadrantId, getBowlArcRange, sampleCornerQuadrantPoint, sampleRoundedBowlRing } from './bowlRing';
import { calculateStandMetrics, resolveStandRoofStyle, stadiumCornerLayout } from './capacity';
import { createRoofShadowDepthMaterial, createStructurePbrMaterial, resolveStadiumMaterials } from './materials';
import { getEffectiveSunkenDepth, isContinuousBowlShape, RoofStyle, StadiumDocument, StandSide } from './schema';
import { CANOPY_ROOF_BUILDERS } from './roofs/canopyRoofs';
import { CLOSED_ROOF_BUILDERS } from './roofs/closedRoofs';
import { buildForecourtCanopy } from './roofs/forecourtCanopy';
import { computeStadiumRingBounds, withOuterOverhang } from './roofs/ringBounds';
import { applyRoofRelief } from './roofs/roofRelief';
import { calibrateRoofTextures } from './roofs/roofTextureScale';
import { RoofBuilder, addColumnDownpipes, addSlabDeckDetail, buildAnnularCanopyMesh, buildAnnularCatwalkFloodlights, buildCanopyMaterialBundle, createStrutBetween, hasRoofGantryLights } from './roofs/roofKit';
import { SHELL_ROOF_BUILDERS } from './roofs/shellRoofs';
import { buildContinuousColumnOrGoalpostRoof, buildSingleStandRoofGroup } from './roofs/standRoofs';
import { STRUCTURE_ROOF_BUILDERS } from './roofs/structureRoofs';
import { dimensionRoofColumns } from './roofs/structuralSizing';

/**
 * Whole-arena roofs, by family. A style missing here is built stand by stand on separate stands, or
 * as the spine cantilever canopy on continuous bowls.
 */
export const ARENA_ROOF_BUILDERS: Partial<Record<RoofStyle, RoofBuilder>> = {
  ...SHELL_ROOF_BUILDERS,
  ...CANOPY_ROOF_BUILDERS,
  ...STRUCTURE_ROOF_BUILDERS,
  ...CLOSED_ROOF_BUILDERS,
};

function clipRoofToSides(doc: StadiumDocument, roof: THREE.Group, sides: StandSide[]): THREE.Group {
  const { innerHalfX, innerHalfZ } = computeStadiumRingBounds(doc);
  const ax = 1 / innerHalfX;
  const az = 1 / innerHalfZ;
  // Each sector keeps points where its axis coordinate dominates: e.g. south is z/hz ≥ |x|/hx.
  const sectorPlanes: Record<StandSide, THREE.Plane[]> = {
    south: [new THREE.Vector3(-ax, 0, az), new THREE.Vector3(ax, 0, az)].map(
      (n) => new THREE.Plane(n.normalize(), 0)
    ),
    north: [new THREE.Vector3(-ax, 0, -az), new THREE.Vector3(ax, 0, -az)].map(
      (n) => new THREE.Plane(n.normalize(), 0)
    ),
    east: [new THREE.Vector3(ax, 0, -az), new THREE.Vector3(ax, 0, az)].map(
      (n) => new THREE.Plane(n.normalize(), 0)
    ),
    west: [new THREE.Vector3(-ax, 0, -az), new THREE.Vector3(-ax, 0, az)].map(
      (n) => new THREE.Plane(n.normalize(), 0)
    ),
  };

  const result = new THREE.Group();
  result.name = roof.name;
  for (const side of sides) {
    const sector = roof.clone(true);
    const clones = new Map<THREE.Material, THREE.Material>();
    sector.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const clipped = mats.map((m) => {
        let c = clones.get(m);
        if (!c) {
          c = m.clone();
          c.clippingPlanes = sectorPlanes[side];
          c.clipShadows = true;
          clones.set(m, c);
        }
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? clipped : clipped[0];
      if (mesh.customDepthMaterial) {
        let cd = clones.get(mesh.customDepthMaterial);
        if (!cd) {
          cd = mesh.customDepthMaterial.clone();
          cd.clippingPlanes = sectorPlanes[side];
          cd.clipShadows = true;
          clones.set(mesh.customDepthMaterial, cd);
        }
        mesh.customDepthMaterial = cd;
      }
    });
    result.add(sector);
  }
  return result;
}

export function generateRoofGroup(
  doc: StadiumDocument,
  crossSectionClip: boolean = false,
  maxAnisotropy: number = 4
): THREE.Group {
  const built = buildRoofAssembly(doc, crossSectionClip, maxAnisotropy);
  if (isWholeRingRoof(doc)) applyRoofRelief(doc, built);
  const covered = doc.roof.coveredSides;
  const roof =
    !isContinuousBowlShape(doc.shape) || !covered || covered.length >= 4 ? built : clipRoofToSides(doc, built, covered);
  const forecourt = buildForecourtCanopy(doc, roof, maxAnisotropy);
  if (forecourt) roof.add(forecourt);
  dimensionRoofColumns(roof);
  addColumnDownpipes(roof);
  calibrateRoofTextures(roof);
  return roof;
}

const SIDES: StandSide[] = ['north', 'south', 'east', 'west'];

/** Separate stands with a roof style of their own: each stand is roofed apart. */
function hasPerStandRoofOverrides(doc: StadiumDocument): boolean {
  return (
    !isContinuousBowlShape(doc.shape) &&
    SIDES.some(
      (s) =>
        doc.stands[s].enabled &&
        doc.stands[s].roofStyleOverride &&
        doc.stands[s].roofStyleOverride !== 'inherit'
    )
  );
}

/**
 * The roof is one piece around the whole ring, set over the tallest stand (so `roof.followStands`
 * applies); otherwise each stand carries its own roof at its own height.
 */
export function isWholeRingRoof(doc: StadiumDocument): boolean {
  if (doc.roof.style === 'none' || hasPerStandRoofOverrides(doc)) return false;
  return Boolean(ARENA_ROOF_BUILDERS[doc.roof.style]) || isContinuousBowlShape(doc.shape);
}

function buildRoofAssembly(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'RoofAssembly';

  const sides = SIDES;
  const hasPerStandOverrides = hasPerStandRoofOverrides(doc);

  if (doc.roof.style === 'none' && !hasPerStandOverrides) {
    return root;
  }

  // Whole-arena roof systems (when no heterogeneous per-stand overrides are active)
  if (!hasPerStandOverrides) {
    const arenaBuilder = ARENA_ROOF_BUILDERS[doc.roof.style];
    if (arenaBuilder) {
      root.add(arenaBuilder(doc, crossSectionClip, maxAnisotropy));
      return root;
    }

    if (
      isContinuousBowlShape(doc.shape) &&
      (doc.roof.style === 'column_supported' || doc.roof.style === 'goalpost_truss')
    ) {
      root.add(
        buildContinuousColumnOrGoalpostRoof(
          doc,
          doc.roof.style,
          crossSectionClip,
          maxAnisotropy
        )
      );
      return root;
    }
  }

  const mats = resolveStadiumMaterials(doc);
  const isContShape = isContinuousBowlShape(doc.shape);
  const { surfaceMat: membraneMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy,
    isContShape ? 10 : 4,
    2,
    isContShape ? 1 : 4
  );
  const primaryStructMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const secondarySteelMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.34,
    metalness: 0.82,
  });

  // Continuous Bowl / Octagon / Horseshoe External Spine Cantilever (or Truss fallback on continuous bowl)
  if (isContShape) {
    const {
      ring,
      maxStandH,
      avgDepth,
      hasConcourse,
      overConcourse,
      standHeightAtNormal,
      canopyOuterOffsetAt,
      exteriorSupportMinOffsetAt,
    } = computeStadiumRingBounds(doc);
    const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
    const arcFraction = Math.max(0.25, tEnd - tStart);
    const sunkenDepth = getEffectiveSunkenDepth(doc);
    const groundY = Math.min(sunkenDepth, maxStandH * 0.6);
    const roofY = maxStandH + Math.max(2.2, doc.roof.heightOffset * 0.75);
    const innerOff = avgDepth * (1 - doc.roof.coverageRatio);
    const outerOffFn = (nx: number, nz: number) => canopyOuterOffsetAt(nx, nz, 3.2);
    const crestAnchored = hasConcourse && !overConcourse;

    root.add(
      buildAnnularCanopyMesh(
        ring,
        doc.shape,
        innerOff,
        outerOffFn,
        roofY + 0.9,
        roofY - 0.2,
        crossSectionClip,
        membraneMat,
        shadowDepthMat
      ),
      buildAnnularCatwalkFloodlights(
        ring,
        doc.shape,
        innerOff,
        roofY + 0.55,
        doc.lighting,
        crossSectionClip,
        hasRoofGantryLights(doc)
      )
    );

    const frameCount = Math.max(12, Math.round(40 * arcFraction));
    for (let i = 0; i < frameCount; i++) {
      const frac = closed ? i / frameCount : i / Math.max(1, frameCount - 1);
      const t = tStart + frac * (tEnd - tStart);
      const s0 = sampleRoundedBowlRing(ring, t, 0);
      const localOuter = outerOffFn(s0.nx, s0.nz);
      const minExt = exteriorSupportMinOffsetAt(s0.nx, s0.nz);

      const footOff = crestAnchored
        ? localOuter + 0.35
        : Math.max(localOuter + 1.2, minExt);
      const kneeOff = crestAnchored
        ? localOuter + 0.2
        : Math.max(localOuter + 0.5, minExt - 0.4);
      const footY = crestAnchored
        ? Math.max(groundY, standHeightAtNormal(s0.nx, s0.nz) - 2.0)
        : groundY;

      const pGround = sampleRoundedBowlRing(ring, t, footOff);
      const pKnee = sampleRoundedBowlRing(ring, t, kneeOff);
      const pMid = sampleRoundedBowlRing(ring, t, (innerOff + localOuter) * 0.52);
      const pTip = sampleRoundedBowlRing(ring, t, innerOff + 1.2);

      const spineCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(pGround.x, footY, pGround.z),
        new THREE.Vector3(pKnee.x, footY + (roofY - footY) * 0.72, pKnee.z),
        new THREE.Vector3(pKnee.x, roofY + 3.2, pKnee.z),
        new THREE.Vector3(pMid.x, roofY + 2.6, pMid.z),
        new THREE.Vector3(pTip.x, roofY + 1.1, pTip.z),
      ]);
      root.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(spineCurve, 20, 0.34, 6, false),
          primaryStructMat
        )
      );

      root.add(
        createStrutBetween(
          new THREE.Vector3(pMid.x, roofY + 2.5, pMid.z),
          new THREE.Vector3(pMid.x, roofY + 0.35, pMid.z),
          0.12,
          0.12,
          secondarySteelMat,
          5
        )
      );
    }

    return root;
  }

  // Stand-by-Stand Anchored Roofs (`cantilever`, `truss`, `column_supported`, `goalpost_truss`)
  const concourseWidth = Math.max(0, doc.concourse?.width ?? 0);
  const hasConcourse = concourseWidth > 0.5;
  const overConcourse = doc.roof.overConcourse !== false;
  const rectLayout = stadiumCornerLayout(doc, crossSectionClip, resolveCornerFollow(doc));


  const standRoofBounds: Partial<
    Record<
      StandSide,
      {
        style: RoofStyle;
        frontZ: number;
        rearZ: number;
        standBackZ: number;
        standTopY: number;
        roofHeight: number;
      }
    >
  > = {};

  for (const side of sides) {
    if (crossSectionClip && side === 'south') continue;

    const stand = doc.stands[side];
    if (!stand.enabled || stand.rows <= 0) continue;

    const effectiveStyle = resolveStandRoofStyle(doc, side);
    if (effectiveStyle === 'none') continue;

    const metrics = calculateStandMetrics(doc, side);
    const spanSpec = rectLayout.straight[side];
    const roofSpan = spanSpec.span;

    const standTopY = metrics.maxHeight;
    const roofHeight = standTopY + Math.max(2.4, doc.roof.heightOffset * 0.72);
    const standBackZ = metrics.totalDepth;
    const baseRearZ = standBackZ + 2.8;
    const frontZ =
      baseRearZ - Math.max(12, standBackZ * doc.roof.coverageRatio + 3.6);
    const rearZ = withOuterOverhang(
      doc,
      standBackZ,
      !hasConcourse ? baseRearZ : overConcourse ? standBackZ + concourseWidth + 0.45 : standBackZ + 0.8
    );
    const roofDepth = Math.max(8, rearZ - frontZ);

    standRoofBounds[side] = {
      style: effectiveStyle,
      frontZ,
      rearZ,
      standBackZ,
      standTopY,
      roofHeight,
    };

    const standRoofGroup = buildSingleStandRoofGroup(
      effectiveStyle,
      roofSpan,
      roofDepth,
      frontZ,
      rearZ,
      standBackZ,
      concourseWidth,
      standTopY,
      roofHeight,
      doc,
      stand,
      membraneMat,
      shadowDepthMat,
      primaryStructMat,
      secondarySteelMat,
      spanSpec.capNegLocalX,
      spanSpec.capPosLocalX
    );
    addSlabDeckDetail(standRoofGroup);

    if (side === 'south') {
      standRoofGroup.position.set(spanSpec.centerCoord, 0, spanSpec.frontDist);
    } else if (side === 'north') {
      standRoofGroup.position.set(spanSpec.centerCoord, 0, -spanSpec.frontDist);
      standRoofGroup.rotation.y = Math.PI;
    } else if (side === 'east') {
      standRoofGroup.position.set(spanSpec.frontDist, 0, spanSpec.centerCoord);
      standRoofGroup.rotation.y = Math.PI / 2;
    } else if (side === 'west') {
      standRoofGroup.position.set(-spanSpec.frontDist, 0, spanSpec.centerCoord);
      standRoofGroup.rotation.y = -Math.PI / 2;
    }

    root.add(standRoofGroup);
  }

  // Seamless 3D Corner Roof Canopy Quadrants + Hip Cantilever Rafters on `filled` & `building` corners
  const cornerRoofShadowDepth = createRoofShadowDepthMaterial(
    mats.roof,
    doc.roof.opacity,
    doc.roof.skylightMode ?? 'none',
    doc.roof.skylightRatio ?? 0,
    1,
    1
  );
  const cornerOrder: CornerQuadrantId[] = ['se', 'sw', 'nw', 'ne'];
  for (const cId of cornerOrder) {
    const corner = rectLayout.corners[cId];
    if (!corner.active || (corner.mode !== 'filled' && corner.mode !== 'building')) {
      continue;
    }

    // A corner keeping one stand's section is as tall as that stand all along: so is its roof.
    const bA = standRoofBounds[corner.follow ?? corner.sideA];
    const bB = standRoofBounds[corner.follow ?? corner.sideB];
    if (!bA && !bB) continue;

      const boundA = bA ?? bB!;
      const boundB = bB ?? bA!;
      const segs = corner.facetedThreeBay ? 15 : 18;
      const cornerRoofGroup = new THREE.Group();
      cornerRoofGroup.name = `CornerRoof_${cId.toUpperCase()}`;

      const pos = new Float32Array((segs + 1) * 2 * 3);
      const uvs = new Float32Array((segs + 1) * 2 * 2);
      const idx: number[] = [];
      const catwalkPts: THREE.Vector3[] = [];

      const sliceBounds: {
        frontD: number;
        rearD: number;
        standBackD: number;
        frontY: number;
        rearY: number;
        standTopY: number;
      }[] = [];

      for (let s = 0; s <= segs; s++) {
        const u = s / segs;
        const w = u * u * (3 - 2 * u);

        const frontD = boundA.frontZ + (boundB.frontZ - boundA.frontZ) * w;
        const rearD = boundA.rearZ + (boundB.rearZ - boundA.rearZ) * w;
        const standBackD =
          boundA.standBackZ + (boundB.standBackZ - boundA.standBackZ) * w;
        const baseRoofH = boundA.roofHeight + (boundB.roofHeight - boundA.roofHeight) * w;
        const standTopY = boundA.standTopY + (boundB.standTopY - boundA.standTopY) * w;

        const frontY = baseRoofH + 0.65;
        const rearY = baseRoofH + 0.05;
        sliceBounds.push({ frontD, rearD, standBackD, frontY, rearY, standTopY });

        const pIn = sampleCornerQuadrantPoint(corner, u, frontD);
        const pOut = sampleCornerQuadrantPoint(corner, u, rearD);
        const pCat = sampleCornerQuadrantPoint(corner, u, frontD + 1.1);
        catwalkPts.push(new THREE.Vector3(pCat.x, frontY - 0.38, pCat.z));

        const b = s * 6;
        pos[b] = pIn.x;
        pos[b + 1] = frontY;
        pos[b + 2] = pIn.z;
        pos[b + 3] = pOut.x;
        pos[b + 4] = rearY;
        pos[b + 5] = pOut.z;

        const uCoord = u * 3.5;
        uvs[s * 4] = uCoord;
        uvs[s * 4 + 1] = 0;
        uvs[s * 4 + 2] = uCoord;
        uvs[s * 4 + 3] = 1;
      }

      for (let s = 0; s < segs; s++) {
        const a = s * 2;
        const b = (s + 1) * 2;
        const c = b + 1;
        const d = a + 1;
        idx.push(a, b, d, b, c, d);
      }

      const canopyGeo = new THREE.BufferGeometry();
      canopyGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      canopyGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      canopyGeo.setIndex(idx);
      canopyGeo.computeVertexNormals();
      const canopyMesh = new THREE.Mesh(canopyGeo, membraneMat);
      canopyMesh.name = 'RoofCanopySurface';
      canopyMesh.customDepthMaterial = cornerRoofShadowDepth;
      canopyMesh.castShadow = true;
      canopyMesh.receiveShadow = true;
      canopyMesh.renderOrder = 2;
      cornerRoofGroup.add(canopyMesh);

      // Radial Hip Cantilever Frames & Rear Structural Columns
      const cornerCrestAnchored = hasConcourse && !overConcourse;
      const hipCount = corner.facetedThreeBay ? 4 : 5;
      for (let h = 0; h < hipCount; h++) {
        const u = corner.facetedThreeBay ? h / 3 : (h + 0.5) / hipCount;
        const sIdx = Math.min(segs, Math.round(u * segs));
        const sb = sliceBounds[sIdx];
        const groundFootOff = cornerCrestAnchored
          ? sb.rearD - 0.1
          : Math.max(sb.rearD + 0.3, sb.standBackD + concourseWidth + 0.8);
        const rearFootY = cornerCrestAnchored ? Math.max(0, sb.standTopY - 2.2) : 0;
        const crestOff = Math.min(sb.rearD - 0.8, sb.standBackD - 0.6);
        const pRearFoot = sampleCornerQuadrantPoint(corner, u, groundFootOff);
        const pRearCrest = sampleCornerQuadrantPoint(corner, u, crestOff);
        const pMid = sampleCornerQuadrantPoint(corner, u, (sb.frontD + sb.rearD) * 0.5);
        const pFront = sampleCornerQuadrantPoint(corner, u, sb.frontD + 1.8);

        cornerRoofGroup.add(
          createStrutBetween(
            new THREE.Vector3(pRearFoot.x, rearFootY, pRearFoot.z),
            new THREE.Vector3(pRearFoot.x, sb.rearY + 3.0, pRearFoot.z),
            0.32,
            0.44,
            primaryStructMat,
            6
          ),
          createStrutBetween(
            new THREE.Vector3(pRearCrest.x, Math.max(0, sb.standTopY - 1.2), pRearCrest.z),
            new THREE.Vector3(pRearCrest.x, sb.rearY, pRearCrest.z),
            0.24,
            0.26,
            secondarySteelMat,
            6
          ),
          createStrutBetween(
            new THREE.Vector3(pRearFoot.x, sb.rearY + 2.9, pRearFoot.z),
            new THREE.Vector3(pFront.x, sb.frontY + 0.75, pFront.z),
            0.18,
            0.32,
            primaryStructMat,
            6
          ),
          createStrutBetween(
            new THREE.Vector3(pMid.x, sb.rearY + 1.85, pMid.z),
            new THREE.Vector3(pMid.x, (sb.frontY + sb.rearY) * 0.5 + 0.1, pMid.z),
            0.12,
            0.12,
            secondarySteelMat,
            5
          )
        );
      }

      // Corner Catwalk Gantry + Floodlight Pods
      if (hasRoofGantryLights(doc) && catwalkPts.length >= 3) {
        const gantryMat = new THREE.MeshStandardMaterial({
          color: 0x1e293b,
          roughness: 0.38,
          metalness: 0.82,
        });
        cornerRoofGroup.add(
          new THREE.Mesh(
            new THREE.TubeGeometry(
              new THREE.CatmullRomCurve3(catwalkPts, false),
              segs,
              0.22,
              6,
              false
            ),
            gantryMat
          )
        );

        const isLit = doc.lighting !== 'day';
        const podMat = new THREE.MeshStandardMaterial({
          color: isLit ? 0xffffff : 0xcbd5e1,
          emissive: new THREE.Color(isLit ? 0xfef9c3 : 0x000000),
          emissiveIntensity:
            doc.lighting === 'night' ? 2.6 : doc.lighting === 'dusk' ? 1.8 : 0,
          roughness: 0.2,
          metalness: 0.6,
        });
        const podGeo = new THREE.BoxGeometry(1.9, 0.55, 0.45);
        for (const uPod of [0.22, 0.5, 0.78]) {
          const sIdx = Math.min(segs, Math.round(uPod * segs));
          const sb = sliceBounds[sIdx];
          const pp = sampleCornerQuadrantPoint(corner, uPod, sb.frontD + 0.9);
          const pod = new THREE.Mesh(podGeo, podMat);
          pod.position.set(pp.x, sb.frontY - 0.65, pp.z);
          pod.lookAt(0, 0, 0);
          cornerRoofGroup.add(pod);
        }
      }

      root.add(cornerRoofGroup);
  }

  return root;
}

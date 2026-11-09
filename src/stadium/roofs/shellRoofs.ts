import * as THREE from 'three';
import { getBowlArcRange, ringSamplesT, sampleRoundedBowlRing } from '../bowlRing';
import { createFacadePbrMaterial, createStructurePbrMaterial, resolveStadiumMaterials } from '../materials';
import { getEffectiveSunkenDepth, PROW_LIFT, PROW_REACH, resolveProwRise, resolveWaveAmplitude, StadiumDocument, RoofStyle } from '../schema';
import { arenaRoofY } from '../roofCatalog';
import { beamGeometry, mergedMesh } from './roofBeams';
import { computeStadiumRingBounds } from './ringBounds';
import { RoofBuilder, RingProfile, buildAnnularCatwalkFloodlights, buildCanopyMaterialBundle, buildCanopyRib, buildPerimeterCanopyCrown, buildRingLoft, hasRoofGantryLights } from './roofKit';

/**
 * 1. ENVELOPING SHELL (`enveloping_shell`):
 * Continuous curved envelope rising from foundations (`gradeY`) and folding over the seating bowl.
 */
function buildEnvelopingShellRoof(
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
    hasConcourse,
    overConcourse,
    canopyOuterOffsetAt,
    standHeightAtNormal,
  } = computeStadiumRingBounds(doc);
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const arcFraction = Math.max(0.25, tEnd - tStart);
  const sunkenDepth = getEffectiveSunkenDepth(doc);
  const baseY = Math.min(sunkenDepth, maxStandH * 0.6);
  const roofTopY = maxStandH + doc.roof.heightOffset;
  const innerDripOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const spanH = Math.max(4, roofTopY - baseY);

  const shellProfileAt = (nx: number, nz: number): [number, number][] => {
    const localOuter = canopyOuterOffsetAt(nx, nz, 3.2);
    if (hasConcourse && !overConcourse) {
      const crestH = standHeightAtNormal(nx, nz);
      const midY = (crestH + roofTopY) * 0.5;
      return [
        [localOuter, Math.max(baseY, crestH - 0.6)],
        [localOuter + 0.15, crestH + (roofTopY - crestH) * 0.3],
        [localOuter + 0.25, midY],
        [localOuter + 0.15, roofTopY - 0.8],
        [localOuter, roofTopY - 0.4],
        [avgDepth * 0.62, roofTopY + 1.4],
        [avgDepth * 0.28, roofTopY + 0.9],
        [innerDripOffset, roofTopY - 0.15],
      ];
    }
    const outerBaseOffset = hasConcourse ? localOuter + 0.2 : avgDepth + 3.2;
    const outerBellyOffset = hasConcourse ? localOuter + 2.8 : avgDepth + 8.6;
    return [
      [outerBaseOffset, baseY],
      [outerBellyOffset * 0.96, baseY + spanH * 0.25],
      [outerBellyOffset, baseY + spanH * 0.56],
      [outerBellyOffset * 0.95, baseY + spanH * 0.84],
      [localOuter, roofTopY - 0.5],
      [avgDepth * 0.62, roofTopY + 1.4],
      [avgDepth * 0.28, roofTopY + 0.9],
      [innerDripOffset, roofTopY - 0.15],
    ];
  };

  const segments = doc.shape === 'octagonal_arena' ? 160 : 128;
  const activeSegs = Math.max(32, Math.round(segments * arcFraction));
  const ringCount = closed ? activeSegs : activeSegs + 1;
  const pCount = 8;

  const positions = new Float32Array(ringCount * pCount * 3);
  const uvs = new Float32Array(ringCount * pCount * 2);
  const indices: number[] = [];

  const ringTs = ringSamplesT(ring, tStart, tEnd, closed, activeSegs);
  for (let s = 0; s < ringCount; s++) {
    const t = ringTs[s];
    const n = sampleRoundedBowlRing(ring, t, 0);
    const sliceProfile = shellProfileAt(n.nx, n.nz);
    for (let p = 0; p < pCount; p++) {
      const [radOff, py] = sliceProfile[p];
      const pt = sampleRoundedBowlRing(ring, t, radOff);
      const base = (s * pCount + p) * 3;
      positions[base] = pt.x;
      positions[base + 1] = py;
      positions[base + 2] = pt.z;

      const uvBase = (s * pCount + p) * 2;
      uvs[uvBase] = (s / activeSegs) * 14 * arcFraction;
      uvs[uvBase + 1] = 1 - p / (pCount - 1);
    }
  }

  for (let s = 0; s < activeSegs; s++) {
    const nextS = closed ? (s + 1) % ringCount : s + 1;
    for (let p = 0; p < pCount - 1; p++) {
      const a = s * pCount + p;
      const b = nextS * pCount + p;
      const c = nextS * pCount + (p + 1);
      const d = s * pCount + (p + 1);
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const shellGeo = new THREE.BufferGeometry();
  shellGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  shellGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  shellGeo.setIndex(indices);
  shellGeo.computeVertexNormals();

  const { surfaceMat: shellMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy,
    12,
    4,
    1
  );

  const shellMesh = new THREE.Mesh(shellGeo, shellMat);
  shellMesh.name = 'RoofCanopySurface';
  shellMesh.customDepthMaterial = shadowDepthMat;
  shellMesh.castShadow = true;
  shellMesh.receiveShadow = true;
  shellMesh.renderOrder = 2;
  group.add(shellMesh);

  const structureMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);

  const ribCount = Math.max(12, Math.round(36 * arcFraction));
  for (let i = 0; i < ribCount; i++) {
    const frac = closed ? i / ribCount : i / Math.max(1, ribCount - 1);
    const t = tStart + frac * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const ribProfile = shellProfileAt(n.nx, n.nz);
    const ribPts = ribProfile.map(([rOff, ry]) => {
      const p = sampleRoundedBowlRing(ring, t, rOff - 0.28);
      return new THREE.Vector3(p.x, ry, p.z);
    });
    const curve = new THREE.CatmullRomCurve3(ribPts);
    group.add(
      new THREE.Mesh(new THREE.TubeGeometry(curve, 18, 0.28, 6, false), structureMat)
    );
  }

  group.add(
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerDripOffset,
      roofTopY - 0.45,
      doc.lighting,
      crossSectionClip,
      hasRoofGantryLights(doc)
    )
  );

  return group;
}

/**
 * TIMBER LATTICE (`timber_lattice`), after the Allianz Riviera: a diamond lattice of glulam
 * members rises from the ground outside the facade, bows outward, then arches over the canopy to
 * its front edge, so skin and roof read as one timber structure.
 */
function buildTimberLatticeRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, innerOffset, outerOffsetFn, surface } = buildPerimeterCanopyCrown(
    doc,
    crossSectionClip,
    maxAnisotropy,
    undefined,
    false
  );
  const { ring } = bounds;
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const along = Math.max(16, Math.round(80 * Math.max(0.25, tEnd - tStart)));
  const across = 14;
  const wallShare = 0.55;

  const node = (i: number, j: number): THREE.Vector3 => {
    const t = tStart + ((closed ? i % along : i) / along) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const rOut = outerOffsetFn(n.nx, n.nz) + 1.5;
    const eaveY = surface(t, 1) + 3;
    const f = j / across;
    let r: number;
    let y: number;
    if (f <= wallShare) {
      const s = f / wallShare;
      r = rOut + 2.5 * Math.sin(Math.PI * s);
      y = eaveY * s;
    } else {
      const s = (f - wallShare) / (1 - wallShare);
      r = rOut + (innerOffset - rOut) * s;
      y = eaveY + (surface(t, 0) + 1.2 - eaveY) * s + 4 * Math.sin(Math.PI * s);
    }
    const p = sampleRoundedBowlRing(ring, t, r);
    return new THREE.Vector3(p.x, y, p.z);
  };

  const members: THREE.BufferGeometry[] = [];
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < across; j++) {
      members.push(beamGeometry(node(i, j), node(i + 1, j + 1), 0.45, 0.7));
      members.push(beamGeometry(node(i + 1, j), node(i, j + 1), 0.45, 0.7));
    }
  }
  const lattice = mergedMesh(
    members,
    createStructurePbrMaterial('glulam_timber', maxAnisotropy),
    'TimberLattice'
  );
  if (lattice) group.add(lattice);
  return group;
}

/**
 * UNDULATING LACE CANOPY (`wave_canopy`), after Stade Jean-Bouin: roof and facade form one skin of
 * perforated UHPC whose height undulates around the bowl (two crests per side), carried by steel
 * cantilever arms under the canopy.
 */
function buildWaveCanopyRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const amp = resolveWaveAmplitude(doc.roof);
  const wave = (t: number) => amp * (0.5 + 0.5 * Math.cos(4 * Math.PI * t + 0.6));
  const { group, bounds, innerOffset, outerOffsetFn, primaryStructMat, surface } =
    buildPerimeterCanopyCrown(
      doc,
      crossSectionClip,
      maxAnisotropy,
      {
        segments: 192,
        surface:
          ({ roofY }) =>
          (t, f) =>
            roofY + 1.8 * (1 - f) + wave(t),
      },
      false
    );
  const { ring } = bounds;
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);

  // Lace skin from the ground up to the canopy's rear edge.
  const segs = Math.max(48, Math.round(192 * Math.max(0.25, tEnd - tStart)));
  const count = closed ? segs : segs + 1;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const laceTs = ringSamplesT(ring, tStart, tEnd, closed, segs);
  for (let s = 0; s < count; s++) {
    const t = laceTs[s];
    const n = sampleRoundedBowlRing(ring, t, 0);
    const p = sampleRoundedBowlRing(ring, t, outerOffsetFn(n.nx, n.nz) + 0.4);
    pos.push(p.x, 0, p.z, p.x, surface(t, 1) + 0.2, p.z);
    uv.push(s / 4, 0, s / 4, 1);
  }
  for (let s = 0; s < segs; s++) {
    const a = s * 2;
    const b = ((s + 1) % count) * 2;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const skinGeo = new THREE.BufferGeometry();
  skinGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  skinGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  skinGeo.setIndex(idx);
  skinGeo.computeVertexNormals();
  const skin = new THREE.Mesh(
    skinGeo,
    createFacadePbrMaterial('uhpc_lace_panels', doc.lighting, false, maxAnisotropy)
  );
  skin.name = 'WaveCanopyLaceSkin';
  skin.castShadow = true;
  skin.receiveShadow = true;
  group.add(skin);

  // Steel cantilever arms under the canopy.
  const arms = Math.max(12, Math.round(74 * Math.max(0.25, tEnd - tStart)));
  for (let i = 0; i < arms; i++) {
    const t = tStart + ((closed ? i : i + 0.5) / arms) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    group.add(
      buildCanopyRib(ring, t, innerOffset, outerOffsetFn(n.nx, n.nz), surface, 0.28, primaryStructMat)
    );
  }
  return group;
}

/** Extra eave height (m) of a `saddle_vault` along the touchlines over the goal ends. */
const SADDLE_RISE = 9;

/**
 * SADDLE VAULT (`saddle_vault`): one translucent shell rising from the ground in a curved
 * facade and vaulting over the stands, higher along the touchlines than behind the goals, so
 * the roof line dips like a saddle (Panathinaikos project, Stade Vélodrome).
 */
function buildSaddleVaultRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const { ring, maxStandH, avgDepth, canopyOuterOffsetAt } = computeStadiumRingBounds(doc);
  const { surfaceMat, shadowDepthMat } = buildCanopyMaterialBundle(doc, maxAnisotropy, 24, 6, 1);
  const roofY = arenaRoofY(doc.roof, maxStandH);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const shell: RingProfile = (_t, nx, nz) => {
    const outer = canopyOuterOffsetAt(nx, nz, 3.8) + 2;
    const eaveY = roofY + 2 + SADDLE_RISE * nz * nz;
    const pts: { r: number; y: number }[] = [];
    // Quarter-ellipse facade from the ground, leaning out, up to the eave.
    for (let k = 0; k <= 6; k++) {
      const a = (k / 6) * (Math.PI / 2);
      pts.push({ r: outer - 6 + 6 * Math.cos(a), y: eaveY * Math.sin(a) });
    }
    // Vault over the stands, falling gently to a thin lip at the front edge.
    for (let k = 1; k <= 8; k++) {
      const f = k / 8;
      pts.push({
        r: outer - 6 + (innerOffset - (outer - 6)) * f,
        y: eaveY + 3 * Math.sin(Math.PI * f * 0.8) - 2.5 * f * f,
      });
    }
    return pts;
  };
  const skin = buildRingLoft(ring, doc.shape, crossSectionClip, 192, shell, surfaceMat, 'RoofCanopySurface');
  skin.customDepthMaterial = shadowDepthMat;
  skin.renderOrder = 2;
  group.add(skin);

  // Meridian ribs following the shell, and a ring beam along the front lip.
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const ribs = Math.max(16, Math.round(72 * Math.max(0.25, tEnd - tStart)));
  const parts: THREE.BufferGeometry[] = [];
  const lip: THREE.Vector3[] = [];
  for (let i = 0; i < (closed ? ribs : ribs + 1); i++) {
    const t = tStart + (i / ribs) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const pts = shell(t, n.nx, n.nz, i).map((pt) => {
      const p = sampleRoundedBowlRing(ring, t, pt.r);
      return new THREE.Vector3(p.x, pt.y - 0.25, p.z);
    });
    for (let k = 0; k < pts.length - 1; k++) parts.push(beamGeometry(pts[k], pts[k + 1], 0.35, 0.5));
    lip.push(pts[pts.length - 1]);
  }
  for (let i = 0; i < lip.length - (closed ? 0 : 1); i++) {
    parts.push(beamGeometry(lip[i], lip[(i + 1) % lip.length], 0.9, 1.2));
  }
  const frame = mergedMesh(parts, createStructurePbrMaterial(mats.structure, maxAnisotropy), 'SaddleVaultRibs');
  if (frame) group.add(frame);
  return group;
}

/**
 * FACETED SHELL (`faceted_shell`): roof and facade wrapped in one angular metal shell of
 * triangular facets that alternately bulge and recede around the stadium (Aspmyra project).
 */
function buildFacetedShellRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const { ring, maxStandH, avgDepth, canopyOuterOffsetAt } = computeStadiumRingBounds(doc);
  const roofY = arenaRoofY(doc.roof, maxStandH);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  // An even number of facets so the alternation closes around the bowl; ~30 m facets keep the
  // straight chords close to the bowl outline, so the shell hugs it instead of spiking at corners.
  const facets = 2 * Math.max(10, Math.round(ring.perimeter / 60));
  // Ring step between facet vertices, as `buildRingLoft` spaces them.
  const { tStart, tEnd } = getBowlArcRange(doc.shape, crossSectionClip);
  const span = tEnd - tStart;
  const dt = span / Math.max(8, Math.round(facets * Math.max(0.25, span)));
  const radialAt = (t: number, r: number) => {
    const n = sampleRoundedBowlRing(ring, t, 0);
    return { ...sampleRoundedBowlRing(ring, t, r), nx: n.nx, nz: n.nz };
  };
  // Long straight facets cut the corners: take the widest stand footprint between the facet
  // midpoints and push the vertex out by the chord sag, so the shell always clears the bowl.
  const shellOuterAt = (t: number) => {
    let outer = 0;
    for (let k = -4; k <= 4; k++) {
      const n = sampleRoundedBowlRing(ring, t + (k / 8) * dt, 0);
      outer = Math.max(outer, canopyOuterOffsetAt(n.nx, n.nz, 3.8));
    }
    let sag = 0;
    for (const side of [-1, 1]) {
      const a = radialAt(t, outer);
      const b = radialAt(t + side * dt, outer);
      const m = radialAt(t + side * dt * 0.5, outer);
      sag = Math.max(sag, (m.x - (a.x + b.x) / 2) * m.nx + (m.z - (a.z + b.z) / 2) * m.nz);
    }
    return outer + Math.max(0, sag);
  };
  const shell: RingProfile = (t, _nx, _nz, s) => {
    const odd = s % 2 === 1;
    const outer = shellOuterAt(t);
    // Facets fold in and out by ~1.5 m: enough to catch the light, never a spike.
    return [
      { r: outer + (odd ? 2.5 : 1.2), y: 0 },
      { r: outer + (odd ? 1.4 : 3), y: roofY * 0.55 },
      { r: outer - 0.5, y: roofY + 1.5 + (odd ? 1.2 : 0) },
      { r: innerOffset, y: roofY + 1 + (odd ? 0 : 1.2) },
    ];
  };
  const metal = createFacadePbrMaterial('black_zinc_cladding', doc.lighting, false, maxAnisotropy);
  const mesh = buildRingLoft(ring, doc.shape, crossSectionClip, facets, shell, metal, 'RoofCanopySurface', true);
  group.add(mesh);

  // Seams along every facet edge.
  const pos = mesh.geometry.getAttribute('position');
  const parts: THREE.BufferGeometry[] = [];
  const v = (i: number) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
  for (let i = 0; i < pos.count; i += 3) {
    parts.push(beamGeometry(v(i), v(i + 1), 0.18, 0.18), beamGeometry(v(i + 1), v(i + 2), 0.18, 0.18));
  }
  const seams = mergedMesh(
    parts,
    createStructurePbrMaterial('galvanized_steel', maxAnisotropy),
    'FacetedShellSeams'
  );
  if (seams) group.add(seams);
  return group;
}

/** Radial depth (m) of a `pleated_crown` fold. */
const PLEAT_DEPTH = 2.6;

/**
 * PLEATED CROWN (`pleated_crown`): a glazed ring roof framed by a metal facade folded into tall
 * diamond pleats that run from the ground to the roof edge (Generali Stadium project).
 */
function buildPleatedCrownRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, outerOffsetFn, surface } = buildPerimeterCanopyCrown(
    doc,
    crossSectionClip,
    maxAnisotropy,
    { segments: 160, surface: ({ roofY }) => (_t, f) => roofY + 0.8 * (1 - f) },
    false
  );
  const pleats = 2 * Math.max(24, Math.round(bounds.ring.perimeter / 14));
  const pleat: RingProfile = (t, nx, nz, s) => {
    const base = outerOffsetFn(nx, nz) + 1;
    const out = s % 2 === 0 ? PLEAT_DEPTH : 0;
    const top = surface(t, 1) + 1.2;
    return [
      { r: base + out, y: 0 },
      { r: base + PLEAT_DEPTH - out, y: top / 2 },
      { r: base + out, y: top },
      { r: base - 1, y: top },
    ];
  };
  group.add(
    buildRingLoft(
      bounds.ring,
      doc.shape,
      crossSectionClip,
      pleats,
      pleat,
      createFacadePbrMaterial('brushed_steel_mesh', doc.lighting, false, maxAnisotropy),
      'PleatedCrownFacade',
      true
    )
  );
  return group;
}

/**
 * PROW SHELL (`prow_shell`): one dark faceted shell whose roof is a single slope, low on the
 * south and climbing to a ridge along the north, the west end of the ridge thrusting out over
 * the forecourt as a prow; the middle of the slope is a translucent ETFE field (U.S. Bank
 * Stadium).
 */
function buildProwShellRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const { ring, maxStandH, avgDepth, canopyOuterOffsetAt } = computeStadiumRingBounds(doc);
  const roofY = arenaRoofY(doc.roof, maxStandH);
  const rise = resolveProwRise(roofY);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  // Widest footprint around each normal, plus margin: straight facets must clear every facade.
  const shellOuter = (nx: number, nz: number) => {
    const a = Math.atan2(nz, nx);
    let outer = 0;
    for (let k = -3; k <= 3; k++) outer = Math.max(outer, canopyOuterOffsetAt(Math.cos(a + k * 0.06), Math.sin(a + k * 0.06), 3.8));
    return outer + 4;
  };
  let halfX = 1;
  let halfZ = 1;
  for (let i = 0; i < 64; i++) {
    const n = sampleRoundedBowlRing(ring, i / 64, 0);
    const p = sampleRoundedBowlRing(ring, i / 64, shellOuter(n.nx, n.nz));
    halfX = Math.max(halfX, Math.abs(p.x));
    halfZ = Math.max(halfZ, Math.abs(p.z));
  }
  // The roof plane: low eave on the south (+z), ridge on the north (-z).
  const slopeY = (z: number) => roofY + 2 + rise * (0.5 - 0.5 * Math.max(-1, Math.min(1, z / halfZ)));
  // Prow weight: grows toward the north-west end of the ridge.
  const prowAt = (x: number, z: number) =>
    Math.max(0, -x / halfX) ** 5 * Math.min(1, Math.max(0, 0.5 - 0.5 * (z / halfZ)) * 1.6);
  const facets = 2 * Math.max(16, Math.round(ring.perimeter / 24));
  const shell: RingProfile = (t, nx, nz, s) => {
    const outer = shellOuter(nx, nz);
    const e = sampleRoundedBowlRing(ring, t, outer);
    const p = prowAt(e.x, e.z);
    const eaveY = slopeY(e.z) + PROW_LIFT * p;
    const fold = s % 2 === 0 ? 1.6 : 0;
    const inner = sampleRoundedBowlRing(ring, t, innerOffset);
    return [
      { r: outer + 2, y: 0 },
      { r: outer + 3 + fold + 2 * p, y: eaveY * 0.42 },
      { r: outer + 1 + PROW_REACH * p, y: eaveY },
      { r: innerOffset, y: slopeY(inner.z) },
    ];
  };
  const zinc = createFacadePbrMaterial('black_zinc_cladding', doc.lighting, false, maxAnisotropy);
  const mesh = buildRingLoft(ring, doc.shape, crossSectionClip, facets, shell, zinc, 'RoofCanopySurface', true);
  group.add(mesh);

  // Facet seams.
  const pos = mesh.geometry.getAttribute('position');
  const seams: THREE.BufferGeometry[] = [];
  const v = (i: number) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
  for (let i = 0; i < pos.count; i += 3) {
    seams.push(beamGeometry(v(i), v(i + 1), 0.2, 0.2), beamGeometry(v(i + 1), v(i + 2), 0.2, 0.2));
  }
  const steel = createStructurePbrMaterial('galvanized_steel', maxAnisotropy);
  const seamMesh = mergedMesh(seams, steel, 'ProwShellSeams');
  if (seamMesh) group.add(seamMesh);

  // ETFE field closing the opening, on the same slope, with purlins across it.
  const { tStart, tEnd } = getBowlArcRange(doc.shape, crossSectionClip);
  const contour = Array.from({ length: 160 }, (_, i) => {
    const p = sampleRoundedBowlRing(ring, tStart + (i / 160) * (tEnd - tStart), innerOffset);
    return new THREE.Vector2(p.x, p.z);
  });
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const capPos = contour.flatMap((p) => [p.x, slopeY(p.y) - 0.1, p.y]);
  const capGeo = new THREE.BufferGeometry();
  capGeo.setAttribute('position', new THREE.Float32BufferAttribute(capPos, 3));
  capGeo.setAttribute(
    'uv',
    new THREE.Float32BufferAttribute(contour.flatMap((p) => [p.x / 12, p.y / 12]), 2)
  );
  capGeo.setIndex(tris.flat());
  capGeo.computeVertexNormals();
  const { surfaceMat, shadowDepthMat } = buildCanopyMaterialBundle(doc, maxAnisotropy, 1, 1, 1);
  surfaceMat.side = THREE.DoubleSide;
  const cap = new THREE.Mesh(capGeo, surfaceMat);
  cap.name = 'ProwShellEtfe';
  cap.customDepthMaterial = shadowDepthMat;
  cap.castShadow = true;
  cap.receiveShadow = true;
  cap.renderOrder = 2;
  group.add(cap);

  const purlins: THREE.BufferGeometry[] = [];
  const zs = contour.map((p) => p.y);
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs);
  for (let z = zMin + 8; z < zMax - 2; z += 10) {
    const xs: number[] = [];
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      if ((a.y - z) * (b.y - z) < 0) xs.push(a.x + ((z - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const y = slopeY(z) - 0.9;
      purlins.push(beamGeometry(new THREE.Vector3(xs[k], y, z), new THREE.Vector3(xs[k + 1], y, z), 0.9, 1.6));
    }
  }
  const purlinMesh = mergedMesh(purlins, steel, 'ProwShellPurlins');
  if (purlinMesh) group.add(purlinMesh);
  return group;
}

/** Integral shells: one skin forms the facade and the roof (offered with the envelopes). */
export const SHELL_ROOF_BUILDERS: Partial<Record<RoofStyle, RoofBuilder>> = {
  enveloping_shell: buildEnvelopingShellRoof,
  timber_lattice: buildTimberLatticeRoof,
  wave_canopy: buildWaveCanopyRoof,
  saddle_vault: buildSaddleVaultRoof,
  faceted_shell: buildFacetedShellRoof,
  pleated_crown: buildPleatedCrownRoof,
  prow_shell: buildProwShellRoof,
};

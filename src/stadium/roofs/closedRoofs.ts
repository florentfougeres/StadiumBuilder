import * as THREE from 'three';
import { sampleRoundedBowlRing } from '../bowlRing';
import { createConcreteBowlMaterial, createStructurePbrMaterial, resolveStadiumMaterials } from '../materials';
import { resolveSpanningGirderCount, StadiumDocument, RoofStyle } from '../schema';
import { buildRetractablePanels } from './retractablePanels';
import { beamGeometry, chordAt, mergedMesh, tubeGeometry } from './roofBeams';
import { computeStadiumRingBounds } from './ringBounds';
import { RoofBuilder, buildCanopyMaterialBundle, buildPerimeterCanopyCrown, contourDome, createStrutBetween, warrenTrussParts } from './roofKit';

/**
 * 3. RETRACTABLE ROOF (`retractable`, `petal_iris`):
 * Perimeter canopy whose central opening is covered by movable panels (see
 * `generateRetractableRoof.ts` for the nine motions and `doc.roof.retractable` for settings).
 */
function buildRetractableRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, roofY, innerOffset, outerOffset, primaryStructMat } =
    buildPerimeterCanopyCrown(doc, crossSectionClip, maxAnisotropy);

  // The open end of a horseshoe leaves no closed opening for the panels to cover.
  if (doc.shape === 'horseshoe') {
    return group;
  }

  group.add(
    buildRetractablePanels(doc, {
      ring: bounds.ring,
      roofY,
      innerOffset,
      outerOffset,
      primaryStructMat,
      crossSectionClip,
      maxAnisotropy,
    })
  );
  return group;
}

/**
 * ARCHED RETRACTABLE (`arched_retractable`): a convex fixed roof whose opening is closed by
 * panels sliding along two longitudinal lattice arches; each arch springs from a pair of
 * concrete towers outside the facade, capped by round platforms (Johan Cruijff ArenA).
 */
function buildArchedRetractableRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, roofY, innerOffset, outerOffset, primaryStructMat } =
    buildPerimeterCanopyCrown(doc, crossSectionClip, maxAnisotropy, {
      segments: 192,
      // Convex shell rolling down from the opening to the eave.
      surface:
        ({ roofY: y }) =>
        (_t, f) =>
          y + 1.2 + 4.5 * Math.cos((Math.PI / 2) * f),
    });
  const { ring } = bounds;
  if (doc.shape !== 'horseshoe') {
    group.add(
      buildRetractablePanels(doc, {
        ring,
        roofY: roofY + 4,
        innerOffset,
        outerOffset,
        primaryStructMat,
        crossSectionClip,
        maxAnisotropy,
      })
    );
  }

  // The arches run along the long (x) axis above the long edges of the opening.
  let openHalfZ = 0;
  let outerHalfX = 0;
  for (let i = 0; i < 64; i++) {
    openHalfZ = Math.max(openHalfZ, Math.abs(sampleRoundedBowlRing(ring, i / 64, innerOffset).z));
    outerHalfX = Math.max(outerHalfX, Math.abs(sampleRoundedBowlRing(ring, i / 64, outerOffset).x));
  }
  const towerX = outerHalfX + 6;
  const springY = roofY + 7;
  const rise = Math.min(22, towerX * 0.16);
  const depth = 4.5;
  const white = createStructurePbrMaterial('white_steel', maxAnisotropy);
  const concrete = createConcreteBowlMaterial(maxAnisotropy);
  const archParts: THREE.BufferGeometry[] = [];
  const towerParts: THREE.BufferGeometry[] = [];
  const bays = 36;
  for (const zSign of crossSectionClip ? [-1] : [-1, 1]) {
    const z = zSign * (openHalfZ + 2);
    const at = (u: number, top: boolean, side: number) => {
      const x = -towerX + 2 * towerX * u;
      const y = springY + rise * (1 - (x / towerX) ** 2) + (top ? depth : 0);
      // Triangular section: two bottom chords, one top chord.
      return new THREE.Vector3(x, y, z + (top ? 0 : side * 1.8));
    };
    for (let k = 0; k < bays; k++) {
      const u0 = k / bays;
      const u1 = (k + 1) / bays;
      archParts.push(beamGeometry(at(u0, true, 0), at(u1, true, 0), 0.9, 0.9));
      for (const side of [-1, 1]) {
        archParts.push(beamGeometry(at(u0, false, side), at(u1, false, side), 0.8, 0.8));
        archParts.push(beamGeometry(at(k % 2 ? u1 : u0, false, side), at(k % 2 ? u0 : u1, true, 0), 0.35, 0.35));
      }
      archParts.push(beamGeometry(at(u0, false, -1), at(u0, false, 1), 0.3, 0.3));
    }
    // Towers: concrete shaft, white column cage and a round platform at the springing.
    for (const xSign of [-1, 1]) {
      const x = xSign * towerX;
      const shaft = new THREE.CylinderGeometry(3, 3.4, springY - 6, 20);
      shaft.translate(x, (springY - 6) / 2, z);
      towerParts.push(shaft);
      for (let c = 0; c < 4; c++) {
        const a = (c / 4) * Math.PI * 2 + Math.PI / 4;
        const cx = x + Math.cos(a) * 2.2;
        const cz = z + Math.sin(a) * 2.2;
        archParts.push(beamGeometry(new THREE.Vector3(cx, springY - 7, cz), new THREE.Vector3(cx, springY + 2, cz), 0.6, 0.6));
      }
      const disk = new THREE.CylinderGeometry(4.6, 4.6, 0.8, 28);
      disk.translate(x, springY + 2.4, z);
      archParts.push(disk);
    }
  }
  const arches = mergedMesh(archParts, white, 'ArchedRetractableArches');
  if (arches) group.add(arches);
  const towers = mergedMesh(towerParts, concrete, 'ArchedRetractableTowers');
  if (towers) group.add(towers);
  return group;
}

/**
 * CLOSED ROOF ON MEGA-GIRDERS (`spanning_girders`), after Paris La Défense Arena: a slightly
 * cambered deck closes the whole bowl out to the eaves, carried by transverse Warren mega-girders
 * resting on the perimeter walls; a skirt closes the gap between stands and deck.
 */
function buildSpanningGirdersRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const { ring, maxStandH, canopyOuterOffsetAt, standHeightAtNormal, standDepthAtNormal } =
    computeStadiumRingBounds(doc);
  const primaryStructMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);
  const { surfaceMat, shadowDepthMat } = buildCanopyMaterialBundle(doc, maxAnisotropy, 14, 4, 1);

  const girderDepth = 7;
  const springY = maxStandH + Math.max(2.8, doc.roof.heightOffset * 0.7);
  const deckY = springY + girderDepth + 0.4;
  const camber = 2.5;

  // Eave outline over the concourse; the cross-section keeps the north half (z <= 0).
  const segs = 128;
  const eave: { x: number; z: number; h: number }[] = [];
  // Girders bear on the rear wall of the stands, inside the facade.
  const crest: { x: number; z: number; h: number }[] = [];
  for (let s = 0; s < segs; s++) {
    const n = sampleRoundedBowlRing(ring, s / segs, 0);
    const h = standHeightAtNormal(n.nx, n.nz);
    const clipZ = (z: number) => (crossSectionClip ? Math.min(0, z) : z);
    const p = sampleRoundedBowlRing(ring, s / segs, canopyOuterOffsetAt(n.nx, n.nz, 3.2));
    eave.push({ x: p.x, z: clipZ(p.z), h });
    const c = sampleRoundedBowlRing(ring, s / segs, standDepthAtNormal(n.nx, n.nz) - 1.5);
    crest.push({ x: c.x, z: clipZ(c.z), h });
  }

  // Deck: concentric copies of the eave shrinking to the centre, cambered up toward it.
  const rings = 10;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let s = 0; s < segs; s++) {
    for (let r = 0; r <= rings; r++) {
      const k = 1 - r / rings;
      pos.push(eave[s].x * k, deckY + camber * (1 - k * k), eave[s].z * k);
      uv.push((s / segs) * 16, r / rings);
    }
  }
  for (let s = 0; s < segs; s++) {
    const a0 = s * (rings + 1);
    const b0 = ((s + 1) % segs) * (rings + 1);
    for (let r = 0; r < rings; r++) {
      idx.push(a0 + r, a0 + r + 1, b0 + r, b0 + r, a0 + r + 1, b0 + r + 1);
    }
  }
  const deckGeo = new THREE.BufferGeometry();
  deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  deckGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  deckGeo.setIndex(idx);
  deckGeo.computeVertexNormals();
  const deck = new THREE.Mesh(deckGeo, surfaceMat);
  deck.name = 'RoofCanopySurface';
  deck.customDepthMaterial = shadowDepthMat;
  deck.castShadow = true;
  deck.receiveShadow = true;
  deck.renderOrder = 2;
  group.add(deck);

  // Eave skirt from the stand crest up to the deck edge.
  const skirtPos: number[] = [];
  const skirtIdx: number[] = [];
  for (let s = 0; s < segs; s++) {
    skirtPos.push(eave[s].x, eave[s].h - 0.5, eave[s].z, eave[s].x, deckY + 0.6, eave[s].z);
    const a = s * 2;
    const b = ((s + 1) % segs) * 2;
    skirtIdx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtPos, 3));
  skirtGeo.setIndex(skirtIdx);
  skirtGeo.computeVertexNormals();
  const skirt = new THREE.Mesh(skirtGeo, primaryStructMat);
  skirt.name = 'RoofEaveSkirt';
  skirt.castShadow = true;
  group.add(skirt);

  // Transverse mega-girders across the short axis, evenly spaced along the pitch.
  const count = resolveSpanningGirderCount(doc.roof);
  const halfX = Math.max(...crest.map((p) => p.x));
  const steel: THREE.BufferGeometry[] = [];
  for (let g = 0; g < count; g++) {
    const x = -halfX * 0.72 + (1.44 * halfX * g) / Math.max(1, count - 1);
    const chord = chordAt(crest, 'x', x);
    if (!chord || chord[1] - chord[0] < 4) continue;
    const a = new THREE.Vector3(x, springY, chord[0]);
    const b = new THREE.Vector3(x, springY, chord[1]);
    steel.push(...warrenTrussParts(a, b, girderDepth, Math.max(8, Math.round((b.z - a.z) / 7)), 1.8, 0.7));
    // Bearing columns down to the stand crest at both ends.
    for (const end of crossSectionClip ? [a] : [a, b]) {
      const nearest = crest.reduce((best, p) =>
        Math.hypot(p.x - end.x, p.z - end.z) < Math.hypot(best.x - end.x, best.z - end.z) ? p : best
      );
      steel.push(
        beamGeometry(
          new THREE.Vector3(end.x, nearest.h - 1, end.z),
          end,
          2.2,
          2.2
        )
      );
    }
  }
  // Longitudinal purlin trusses tying the girders together under the deck.
  for (const zf of crossSectionClip ? [-0.45] : [-0.45, 0.45]) {
    const mid = chordAt(eave, 'z', 0) ?? [-halfX, halfX];
    const zHalf = Math.max(...eave.map((p) => Math.abs(p.z)));
    steel.push(
      ...warrenTrussParts(
        new THREE.Vector3(mid[0] * 0.8, springY + girderDepth * 0.45, zf * zHalf),
        new THREE.Vector3(mid[1] * 0.8, springY + girderDepth * 0.45, zf * zHalf),
        girderDepth * 0.5,
        16,
        0.7,
        0.35
      )
    );
  }
  const girders = mergedMesh(steel, primaryStructMat, 'SpanningMegaGirders');
  if (girders) group.add(girders);
  return group;
}

/**
 * 8. FULL PERMANENT CLIMATIC DOME (`fixed_dome`):
 * Complete elliptical geodesic/lamella spatial dome enclosing 100% of the bowl & pitch,
 * with zenithal daylight oculus, steel rib arches, and central 360° halo scoreboard!
 */
function buildFixedDomeRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const { ring, maxStandH, canopyOuterOffsetAt, standHeightAtNormal, standDepthAtNormal } =
    computeStadiumRingBounds(doc);

  const springY = maxStandH + Math.max(2.8, doc.roof.heightOffset * 0.7);
  const domeRise = 23.5;

  // Dome surface point: the eave follows the bowl/concourse contour, and each higher course is that
  // contour scaled toward the centre, so the sides hug the stadium outline instead of an ellipse.
  const domePoint = (t: number, theta: number, yAdjust = 0): THREE.Vector3 => {
    const n = sampleRoundedBowlRing(ring, t, 0);
    const eave = sampleRoundedBowlRing(ring, t, canopyOuterOffsetAt(n.nx, n.nz, 3.2));
    const scale = Math.cos(theta);
    return new THREE.Vector3(
      eave.x * scale,
      springY + Math.sin(theta) * domeRise + yAdjust,
      eave.z * scale
    );
  };

  const uSegs = crossSectionClip ? 48 : 96;
  const vSegs = 16;
  // The dome always closes the full contour (even over a horseshoe's open end).
  const tStart = crossSectionClip ? 0.5 : 0;
  const tSpan = crossSectionClip ? 0.5 : 1;
  const uCount = crossSectionClip ? uSegs + 1 : uSegs;

  // Main outer dome shell (`v` from `0` = perimeter eaves to `0.84` = zenithal oculus edge)
  const positions = new Float32Array(uCount * (vSegs + 1) * 3);
  const uvs = new Float32Array(uCount * (vSegs + 1) * 2);
  const indices: number[] = [];

  for (let u = 0; u < uCount; u++) {
    const t = tStart + (u / uSegs) * tSpan;

    for (let v = 0; v <= vSegs; v++) {
      const theta = (v / vSegs) * (Math.PI * 0.43); // Leaves central glazed skylight oculus (`theta > 0.43*PI`)
      const p = domePoint(t, theta);

      const idx = (u * (vSegs + 1) + v) * 3;
      positions[idx] = p.x;
      positions[idx + 1] = p.y;
      positions[idx + 2] = p.z;

      const uvIdx = (u * (vSegs + 1) + v) * 2;
      uvs[uvIdx] = (u / uSegs) * (crossSectionClip ? 8 : 16);
      uvs[uvIdx + 1] = 1 - v / vSegs;
    }
  }

  for (let u = 0; u < uSegs; u++) {
    const nextU = crossSectionClip ? u + 1 : (u + 1) % uCount;
    for (let v = 0; v < vSegs; v++) {
      const a = u * (vSegs + 1) + v;
      const b = nextU * (vSegs + 1) + v;
      const c = nextU * (vSegs + 1) + v + 1;
      const d = u * (vSegs + 1) + v + 1;
      indices.push(a, d, b, b, d, c);
    }
  }

  const domeGeo = new THREE.BufferGeometry();
  domeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  domeGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  domeGeo.setIndex(indices);
  domeGeo.computeVertexNormals();

  const { surfaceMat: domeMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy,
    14,
    4,
    1
  );
  const domeMesh = new THREE.Mesh(domeGeo, domeMat);
  domeMesh.name = 'RoofCanopySurface';
  domeMesh.customDepthMaterial = shadowDepthMat;
  domeMesh.castShadow = true;
  domeMesh.receiveShadow = true;
  domeMesh.renderOrder = 2;
  group.add(domeMesh);

  // Translucent Zenithal Skylight Crown Cap: a low cone fanned over the contour-shaped oculus
  const oculusTheta = Math.PI * 0.43;
  const capSegs = crossSectionClip ? 48 : 96;
  const capRimCount = crossSectionClip ? capSegs + 1 : capSegs;
  const capPositions: number[] = [];
  for (let s = 0; s < capRimCount; s++) {
    const p = domePoint(tStart + (s / capSegs) * tSpan, oculusTheta, -0.15);
    capPositions.push(p.x, p.y, p.z);
  }
  const capApexY = springY + Math.sin(oculusTheta) * domeRise + 2.25;
  capPositions.push(0, capApexY, 0);
  const capIndices: number[] = [];
  for (let s = 0; s < capSegs; s++) {
    capIndices.push(capRimCount, (s + 1) % capRimCount, s);
  }
  const skylightGeo = new THREE.BufferGeometry();
  skylightGeo.setAttribute('position', new THREE.Float32BufferAttribute(capPositions, 3));
  skylightGeo.setIndex(capIndices);
  skylightGeo.computeVertexNormals();
  const skylightMat = new THREE.MeshPhysicalMaterial({
    color: 0xe0f2fe,
    roughness: 0.08,
    metalness: 0.1,
    clearcoat: 0.95,
    transparent: true,
    opacity: 0.58,
    side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(skylightGeo, skylightMat));

  const structMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);

  // Radial spatial arch ribs + circumferential purlin rings
  const ribCount = crossSectionClip ? 13 : 24;
  for (let r = 0; r < ribCount; r++) {
    const t =
      tStart + (r / (crossSectionClip ? Math.max(1, ribCount - 1) : ribCount)) * tSpan;
    const ribPts: THREE.Vector3[] = [];
    for (let v = 0; v <= 12; v++) {
      ribPts.push(domePoint(t, (v / 12) * (Math.PI * 0.43), -0.25));
    }
    group.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ribPts), 20, 0.42, 6, false),
        structMat
      )
    );
  }

  for (const ringFrac of [0.0, 0.28, 0.56, 0.84]) {
    const th = ringFrac * (Math.PI * 0.43);
    const purlinPts: THREE.Vector3[] = [];
    const segN = crossSectionClip ? 36 : 72;
    for (let s = 0; s <= segN; s++) {
      purlinPts.push(domePoint(tStart + (s / segN) * tSpan, th, -0.2));
    }
    const closedRing = !crossSectionClip;
    group.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(purlinPts, closedRing),
          segN,
          ringFrac === 0 ? 0.68 : 0.34,
          6,
          closedRing
        ),
        structMat
      )
    );
  }

  // V-struts connecting stand crest to dome perimeter compression ring
  const vBayCount = crossSectionClip ? 18 : 36;
  for (let i = 0; i < vBayCount; i++) {
    const frac = crossSectionClip ? i / Math.max(1, vBayCount - 1) : i / vBayCount;
    const t = tStart + frac * tSpan;
    const s0 = sampleRoundedBowlRing(ring, t, 0);
    const d0 = standDepthAtNormal(s0.nx, s0.nz);
    const h0 = standHeightAtNormal(s0.nx, s0.nz);
    const wallPt = sampleRoundedBowlRing(ring, t, d0 - 0.3);
    const domeEdge = domePoint(t, 0);

    group.add(
      createStrutBetween(
        new THREE.Vector3(wallPt.x, h0 - 0.5, wallPt.z),
        domeEdge,
        0.34,
        0.4,
        structMat,
        6
      )
    );
  }

  // Suspended 360° Halo LED Scoreboard & Catwalk Ring under the dome crown!
  if (!crossSectionClip) {
    const haloY = springY + domeRise * 0.45;
    const haloRing = new THREE.Mesh(
      new THREE.CylinderGeometry(19, 19, 4.6, 48, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x0284c7,
        emissive: new THREE.Color(0x38bdf8),
        emissiveIntensity: doc.lighting === 'day' ? 0.55 : 1.35,
        roughness: 0.2,
        side: THREE.DoubleSide,
      })
    );
    haloRing.position.y = haloY;
    group.add(haloRing);
  }

  return group;
}

/** Rise (m) of the very flat air-supported membrane over its span. */
const AIR_DOME_RISE = 11;
/** Spacing (m) of the diagonal cable net restraining it. */
const AIR_DOME_CABLE_SPACING = 14;

/**
 * AIR-SUPPORTED DOME (`air_dome`): a low membrane held up by a slight overpressure inside the
 * bowl, restrained by a diagonal net of steel cables anchored in a concrete compression ring;
 * between the cables the membrane pillows up.
 */
function buildAirDomeRoof(doc: StadiumDocument, crossSectionClip: boolean, maxAnisotropy: number): THREE.Group {
  const group = new THREE.Group();
  const dome = contourDome(doc, crossSectionClip);
  const base = (s: number) => dome.springY + AIR_DOME_RISE * (1 - s * s);
  const pillow = (s: number, x: number, z: number) => {
    const a = Math.sin((Math.PI * (x + z)) / (AIR_DOME_CABLE_SPACING * Math.SQRT2));
    const b = Math.sin((Math.PI * (x - z)) / (AIR_DOME_CABLE_SPACING * Math.SQRT2));
    return 0.9 * Math.abs(a * b) * (1 - Math.pow(s, 6));
  };
  const { surfaceMat, shadowDepthMat } = buildCanopyMaterialBundle(doc, maxAnisotropy, 16, 4, 1);
  const membrane = new THREE.Mesh(
    dome.shell(crossSectionClip ? 96 : 192, 28, (s, _u, x, z) => base(s) + pillow(s, x, z)),
    surfaceMat
  );
  membrane.name = 'RoofCanopySurface';
  membrane.customDepthMaterial = shadowDepthMat;
  membrane.castShadow = true;
  membrane.receiveShadow = true;
  membrane.renderOrder = 2;
  group.add(membrane);

  // Diagonal cable net: lines x ± z = c, sampled across the plan and kept inside the eave.
  const cables: THREE.BufferGeometry[] = [];
  const reach = Math.max(...Array.from({ length: 16 }, (_, i) => Math.hypot(dome.eaveAt(i / 16).x, dome.eaveAt(i / 16).z)));
  const spacing = AIR_DOME_CABLE_SPACING * Math.SQRT2;
  for (const dir of [1, -1]) {
    // Cables lie in the pillows' valleys: x ± z on whole multiples of the spacing.
    const lines = Math.ceil((reach * 1.5) / spacing);
    for (let n = -lines; n <= lines; n++) {
      const c = n * spacing;
      let run: THREE.Vector3[] = [];
      const flush = () => {
        if (run.length >= 2) cables.push(tubeGeometry(run, 0.16));
        run = [];
      };
      for (let w = -reach * 1.5; w <= reach * 1.5; w += 3) {
        const x = (c + w) / 2;
        const z = dir * (c - w) / 2;
        const s = dome.planShare(x, z);
        if (s > 0.995 || (crossSectionClip && z > 0)) {
          flush();
          continue;
        }
        run.push(new THREE.Vector3(x, base(s) + 0.05, z));
      }
      flush();
    }
  }
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x3b4048, metalness: 0.85, roughness: 0.35 });
  const net = mergedMesh(cables, cableMat, 'AirDomeCableNet');
  if (net) group.add(net);

  const ringPts = Array.from({ length: crossSectionClip ? 49 : 96 }, (_, i) => {
    const e = dome.eaveAt(dome.tStart + (i / (crossSectionClip ? 48 : 96)) * dome.tSpan);
    return new THREE.Vector3(e.x, dome.springY - 0.4, e.z);
  });
  const ringMesh = new THREE.Mesh(
    tubeGeometry(ringPts, 1.1, !crossSectionClip),
    createStructurePbrMaterial('reinforced_concrete', maxAnisotropy)
  );
  ringMesh.name = 'AirDomeCompressionRing';
  ringMesh.castShadow = true;
  group.add(ringMesh);
  return group;
}

/** Cable dome (Geiger type): radial ridge lines, hoop rings, rise (m), post length (m). */
const CABLE_DOME_RIDGES = 24;
const CABLE_DOME_HOOPS = [0.78, 0.55, 0.32];
const CABLE_DOME_RISE = 14;
const CABLE_DOME_POST = 5.5;

/**
 * CABLE DOME (`cable_dome`): a tensegrity dome closed by fabric. Radial ridge cables run from the
 * compression ring to a central tension ring; at each hoop a short flying post stands on a ring of
 * hoop cables, and diagonals tie each post's foot to the ridge further out. The fabric drapes in
 * alternating ridges and valleys between the radials.
 */
function buildCableDomeRoof(doc: StadiumDocument, crossSectionClip: boolean, maxAnisotropy: number): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const dome = contourDome(doc, crossSectionClip);
  const base = (s: number) => dome.springY + CABLE_DOME_RISE * (1 - s * s);
  const ridges = crossSectionClip ? CABLE_DOME_RIDGES / 2 : CABLE_DOME_RIDGES;
  const valley = (s: number, u: number) => {
    const phase = (u * ridges) % 1;
    return 1.5 * Math.sin(Math.PI * phase) ** 2 * Math.min(1, s * 2.5);
  };
  const { surfaceMat, shadowDepthMat } = buildCanopyMaterialBundle(doc, maxAnisotropy, 16, 4, 1);
  const fabric = new THREE.Mesh(
    dome.shell(ridges * 8, 24, (s, u) => base(s) - valley(s, u)),
    surfaceMat
  );
  fabric.name = 'RoofCanopySurface';
  fabric.customDepthMaterial = shadowDepthMat;
  fabric.castShadow = true;
  fabric.receiveShadow = true;
  fabric.renderOrder = 2;
  group.add(fabric);

  const cables: THREE.BufferGeometry[] = [];
  const posts: THREE.BufferGeometry[] = [];
  const node = (k: number, s: number, dy = 0) => {
    const e = dome.eaveAt(dome.tStart + (k / ridges) * dome.tSpan);
    return new THREE.Vector3(e.x * s, base(s) + 0.1 + dy, e.z * s);
  };
  const shares = [1, ...CABLE_DOME_HOOPS, 0.1];
  const radials = crossSectionClip ? ridges + 1 : ridges;
  for (let k = 0; k < radials; k++) {
    for (let h = 0; h < shares.length - 1; h++) {
      cables.push(beamGeometry(node(k, shares[h]), node(k, shares[h + 1]), 0.12, 0.12));
    }
    CABLE_DOME_HOOPS.forEach((s, h) => {
      const top = node(k, s);
      const foot = node(k, s, -CABLE_DOME_POST);
      posts.push(beamGeometry(top, foot, 0.32, 0.32));
      cables.push(beamGeometry(foot, node(k, shares[h]), 0.08, 0.08));
      const nextK = k + 1;
      if (crossSectionClip ? nextK <= ridges : true) {
        cables.push(beamGeometry(foot, node(nextK % (crossSectionClip ? Infinity : ridges), s, -CABLE_DOME_POST), 0.1, 0.1));
      }
    });
  }
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x3b4048, metalness: 0.85, roughness: 0.35 });
  const net = mergedMesh(cables, cableMat, 'CableDomeCables');
  if (net) group.add(net);
  const postMesh = mergedMesh(posts, createStructurePbrMaterial(mats.structure, maxAnisotropy), 'CableDomePosts');
  if (postMesh) group.add(postMesh);

  const ringPts = Array.from({ length: crossSectionClip ? 49 : 96 }, (_, i) => {
    const e = dome.eaveAt(dome.tStart + (i / (crossSectionClip ? 48 : 96)) * dome.tSpan);
    return new THREE.Vector3(e.x, dome.springY - 0.4, e.z);
  });
  const ringMesh = new THREE.Mesh(
    tubeGeometry(ringPts, 1.2, !crossSectionClip),
    createStructurePbrMaterial('reinforced_concrete', maxAnisotropy)
  );
  ringMesh.name = 'CableDomeCompressionRing';
  ringMesh.castShadow = true;
  group.add(ringMesh);
  return group;
}

/** Roofs that close over the pitch, fixed or movable. */
export const CLOSED_ROOF_BUILDERS: Partial<Record<RoofStyle, RoofBuilder>> = {
  arched_retractable: buildArchedRetractableRoof,
  petal_iris: buildRetractableRoof,
  spanning_girders: buildSpanningGirdersRoof,
  fixed_dome: buildFixedDomeRoof,
  retractable: buildRetractableRoof,
  air_dome: buildAirDomeRoof,
  cable_dome: buildCableDomeRoof,
};

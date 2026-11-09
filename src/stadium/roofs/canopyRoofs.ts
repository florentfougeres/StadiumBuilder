import * as THREE from 'three';
import { getBowlArcRange, ringSamplesT, sampleRoundedBowlRing } from '../bowlRing';
import { createConcreteBowlMaterial, createStructurePbrMaterial, resolveStadiumMaterials } from '../materials';
import { resolvePortalCount, StadiumDocument, RoofStyle } from '../schema';
import { arenaRoofY } from '../roofCatalog';
import { beamGeometry, chordAt, mergedMesh } from './roofBeams';
import { computeStadiumRingBounds } from './ringBounds';
import { RoofBuilder, RingProfile, buildAnnularCatwalkFloodlights, buildCanopyMaterialBundle, buildCanopyRib, buildPerimeterCanopyCrown, buildRingLoft, cornerWeight, hasRoofGantryLights, warrenTrussParts } from './roofKit';

/**
 * VAULTED RING (`vaulted_ring`): a canopy whose cross-section is an arch springing from the rear
 * and dipping to a thin front edge, carried by arched ribs at regular bays.
 */
function buildVaultedRingRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, innerOffset, outerOffsetFn, primaryStructMat, surface } =
    buildPerimeterCanopyCrown(doc, crossSectionClip, maxAnisotropy, {
      segments: 160,
      surface:
        ({ roofY, depth }) =>
        (_t, f) =>
          roofY + 1.2 * (1 - f) + Math.min(9, depth * 0.2) * Math.sin(Math.PI * f),
    });
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const ribs = Math.max(12, Math.round(48 * Math.max(0.25, tEnd - tStart)));
  for (let i = 0; i < ribs; i++) {
    const t = tStart + (closed ? i / ribs : i / Math.max(1, ribs - 1)) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(bounds.ring, t, 0);
    group.add(
      buildCanopyRib(
        bounds.ring,
        t,
        innerOffset,
        outerOffsetFn(n.nx, n.nz),
        surface,
        0.32,
        primaryStructMat
      )
    );
  }
  return group;
}

/**
 * FOLDED PLATE (`folded_plate`): a zigzag canopy whose ridges and valleys alternate around the
 * bowl like a sawtooth crown, with a steel ridge beam on every fold.
 */
function buildFoldedPlateRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  let folds = 0;
  const { group, bounds, innerOffset, outerOffsetFn, primaryStructMat, surface } =
    buildPerimeterCanopyCrown(doc, crossSectionClip, maxAnisotropy, {
      segments: 320,
      surface: ({ roofY, perimeter }) => {
        folds = Math.max(16, Math.round(perimeter / 16));
        return (t, f) => {
          const phase = (((t * folds) % 1) + 1) % 1;
          const ridge = 1 - Math.abs(2 * phase - 1);
          return roofY + 1.6 * (1 - f) + ridge * (1.2 + 3.2 * f);
        };
      },
    });
  const { tStart, tEnd } = getBowlArcRange(doc.shape, crossSectionClip);
  for (let k = 0; k < folds; k++) {
    const t = (k + 0.5) / folds;
    if (t < tStart || t > tEnd) continue;
    const n = sampleRoundedBowlRing(bounds.ring, t, 0);
    group.add(
      buildCanopyRib(
        bounds.ring,
        t,
        innerOffset,
        outerOffsetFn(n.nx, n.nz),
        surface,
        0.22,
        primaryStructMat
      )
    );
  }
  return group;
}

/** Highest point of a `concrete_portals` rib above the canopy deck (m). */
const PORTAL_MAX_RISE = 10;

/**
 * PRESTRESSED CONCRETE PORTALS (`concrete_portals`), after the Parc des Princes: ribs stand
 * outside the facade, rise past the stands and cantilever inward over them, carrying the canopy
 * with no column in the bowl. Their crests undulate around the perimeter, two waves per side.
 */
function buildConcretePortalsRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, roofY, innerOffset, outerOffsetFn, surface } = buildPerimeterCanopyCrown(
    doc,
    crossSectionClip,
    maxAnisotropy,
    undefined,
    false
  );
  const { ring } = bounds;
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const stations = Math.max(
    6,
    Math.round(resolvePortalCount(doc.roof) * Math.max(0.25, tEnd - tStart))
  );
  const ribWidth = 0.9;
  const parts: THREE.BufferGeometry[] = [];

  for (let i = 0; i < stations; i++) {
    const t = tStart + ((closed ? i : i + 0.5) / stations) * (tEnd - tStart);
    const base = sampleRoundedBowlRing(ring, t, 0);
    const rOut = outerOffsetFn(base.nx, base.nz);
    const crestY = roofY + 4 + (PORTAL_MAX_RISE - 4) * (0.5 + 0.5 * Math.cos(4 * Math.PI * t));
    const tipY = surface(t, 0) + 0.3;
    // Rib profile in (radial offset, height): an outer leg leaning in, a crest, and a cantilever
    // whose underside runs from the deck's rear edge to a slender tip at the canopy front.
    const profile = new THREE.Shape([
      new THREE.Vector2(rOut + 4.2, 0),
      new THREE.Vector2(rOut + 2.4, crestY),
      new THREE.Vector2(rOut - 2, crestY + 0.6),
      new THREE.Vector2(innerOffset, tipY + 0.9),
      new THREE.Vector2(innerOffset, tipY),
      new THREE.Vector2(rOut - 1, surface(t, 1) + 0.4),
      new THREE.Vector2(rOut + 0.8, Math.max(4, crestY - 12)),
      new THREE.Vector2(rOut + 1.2, 0),
    ]);
    const geo = new THREE.ExtrudeGeometry(profile, { depth: ribWidth, bevelEnabled: false });
    // Map (radial offset, height, width) onto the ring normal and tangent at `t`.
    const tx = -base.nz;
    const tz = base.nx;
    const pos = geo.getAttribute('position');
    for (let v = 0; v < pos.count; v++) {
      const r = pos.getX(v);
      const w = pos.getZ(v) - ribWidth / 2;
      pos.setXYZ(v, base.x + base.nx * r + tx * w, pos.getY(v), base.z + base.nz * r + tz * w);
    }
    geo.computeVertexNormals();
    parts.push(geo);
  }

  const ribs = mergedMesh(parts, createConcreteBowlMaterial(maxAnisotropy), 'ConcretePortalRibs');
  if (ribs) {
    ribs.receiveShadow = true;
    group.add(ribs);
  }
  return group;
}

/**
 * DISHED CANOPY (`dished_canopy`): a concave canopy, raised at both its front and rear edges and
 * sagging between them, whose eaves flare up at the corners, finished with a deep fascia (new
 * Romareda).
 */
function buildDishedCanopyRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { ring } = computeStadiumRingBounds(doc);
  const flareAt = (t: number) => {
    const n = sampleRoundedBowlRing(ring, t, 0);
    return 2 + 6 * cornerWeight(n.nx, n.nz) ** 2;
  };
  const { group, outerOffsetFn, primaryStructMat, surface } = buildPerimeterCanopyCrown(
    doc,
    crossSectionClip,
    maxAnisotropy,
    {
      segments: 192,
      surface:
        ({ roofY }) =>
        (t, f) =>
          roofY + 2.2 * (1 - f) - 2.4 * Math.sin(Math.PI * f) + flareAt(t) * f ** 3,
    }
  );
  // Deep fascia hanging from the eave.
  const fascia = buildRingLoft(
    ring,
    doc.shape,
    crossSectionClip,
    192,
    (t, nx, nz) => {
      const r = outerOffsetFn(nx, nz);
      const top = surface(t, 1) + 0.3;
      return [
        { r, y: top - 3.2 },
        { r: r + 0.4, y: top - 1.6 },
        { r: r + 0.4, y: top },
      ];
    },
    primaryStructMat,
    'DishedCanopyFascia'
  );
  group.add(fascia);
  return group;
}

/** Overhang (m) of a `serrated_canopy` fold tip beyond the canopy rear edge. */
const SERRATED_TIP = 6;

/**
 * SERRATED CANOPY (`serrated_canopy`): a translucent membrane folded into deep pleats running
 * from the pitch to the outside, their ridges cantilevering past the facade in a saw-toothed rim
 * propped by a zigzag of white inclined struts (new Nicosia stadium project).
 */
function buildSerratedCanopyRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const { ring, maxStandH, avgDepth, canopyOuterOffsetAt } = computeStadiumRingBounds(doc);
  const { surfaceMat, shadowDepthMat } = buildCanopyMaterialBundle(doc, maxAnisotropy, 24, 4, 1);
  const roofY = arenaRoofY(doc.roof, maxStandH);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  // ~5 m between a ridge and the next valley; even, so the folds close around the bowl.
  const folds = 2 * Math.max(24, Math.round(ring.perimeter / 10));
  // The fold deepens outward: a flat front edge, 2.6 m deep pleats at the rim.
  const pleat: RingProfile = (_t, nx, nz, s) => {
    const ridge = s % 2 === 0;
    const outer = canopyOuterOffsetAt(nx, nz, 3.8);
    const pts: { r: number; y: number }[] = [];
    for (let k = 0; k <= 6; k++) {
      const f = k / 6;
      pts.push({
        r: innerOffset + (outer - innerOffset) * f,
        y: roofY + 0.8 + 1.4 * f + (ridge ? 0.3 + 2.3 * f : 0),
      });
    }
    pts.push(
      ridge
        ? { r: outer + SERRATED_TIP, y: roofY + 5.3 }
        : { r: outer + 1.2, y: roofY + 2.3 }
    );
    return pts;
  };
  const skin = buildRingLoft(ring, doc.shape, crossSectionClip, folds, pleat, surfaceMat, 'RoofCanopySurface', true);
  skin.customDepthMaterial = shadowDepthMat;
  skin.renderOrder = 2;
  group.add(skin);
  group.add(
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerOffset,
      roofY + 0.5,
      doc.lighting,
      crossSectionClip,
      hasRoofGantryLights(doc)
    )
  );

  // Ridge beams, a front fascia, and the zigzag of struts from a ring beam on the facade top to
  // every fold tip.
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const segs = Math.max(8, Math.round(folds * Math.max(0.25, tEnd - tStart)));
  const count = closed ? segs : segs + 1;
  const footY = Math.max(4, roofY - 8);
  const foldTs = ringSamplesT(ring, tStart, tEnd, closed, segs);
  const samples = Array.from({ length: count }, (_, s) => {
    const t = foldTs[s];
    const n = sampleRoundedBowlRing(ring, t, 0);
    const line = pleat(t, n.nx, n.nz, s).map((pt) => {
      const p = sampleRoundedBowlRing(ring, t, pt.r);
      return new THREE.Vector3(p.x, pt.y - 0.2, p.z);
    });
    const f = sampleRoundedBowlRing(ring, t, canopyOuterOffsetAt(n.nx, n.nz, 3.8) + 0.6);
    return { line, foot: new THREE.Vector3(f.x, footY, f.z) };
  });
  const frame: THREE.BufferGeometry[] = [];
  const struts: THREE.BufferGeometry[] = [];
  for (let s = 0; s < count; s++) {
    const { line, foot } = samples[s];
    const next = closed ? samples[(s + 1) % count] : samples[s + 1];
    if (next) {
      frame.push(beamGeometry(line[0], next.line[0], 0.6, 0.9));
      if (s % 2 === 1) frame.push(beamGeometry(foot, next.foot, 0.7, 0.7));
    }
    if (s % 2 !== 0) continue;
    for (let k = 0; k < line.length - 1; k++) frame.push(beamGeometry(line[k], line[k + 1], 0.3, 0.45));
    const tip = line[line.length - 1];
    for (const side of [-1, 1]) {
      const v = samples[closed ? (s + side + count) % count : s + side];
      if (v) struts.push(beamGeometry(v.foot, tip, 0.55, 0.55));
    }
  }
  const white = createStructurePbrMaterial('white_steel', maxAnisotropy);
  const frameMesh = mergedMesh(frame, white, 'SerratedCanopyRidges');
  if (frameMesh) group.add(frameMesh);
  const strutMesh = mergedMesh(struts, white, 'SerratedCanopyStruts');
  if (strutMesh) group.add(strutMesh);
  return group;
}

/** Rise (m) of a `saucer_dome` from its rim to its front edge. */
const SAUCER_CROWN = 6;

/**
 * SAUCER DOME (`saucer_dome`): a thick convex roof, highest at its front edge and rolling over a
 * rounded rim, carried on a ring of inclined V-columns standing outside the facade (new Roma
 * stadium project).
 */
function buildSaucerDomeRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const group = new THREE.Group();
  const mats = resolveStadiumMaterials(doc);
  const { ring, maxStandH, avgDepth, canopyOuterOffsetAt } = computeStadiumRingBounds(doc);
  const { surfaceMat, shadowDepthMat } = buildCanopyMaterialBundle(doc, maxAnisotropy, 24, 4, 1);
  const roofY = arenaRoofY(doc.roof, maxStandH);
  const innerOffset = avgDepth * (1 - doc.roof.coverageRatio);
  const rimAt = (nx: number, nz: number) => canopyOuterOffsetAt(nx, nz, 3.8) + 3;
  const saucer: RingProfile = (_t, nx, nz) => {
    const rim = rimAt(nx, nz);
    const pts: { r: number; y: number }[] = [];
    for (let k = 0; k <= 8; k++) {
      const f = k / 8;
      pts.push({ r: innerOffset + (rim - innerOffset) * f, y: roofY + 1.5 + SAUCER_CROWN * (1 - f * f) });
    }
    // Rounded rim rolling under to the soffit.
    pts.push({ r: rim + 1.6, y: roofY + 0.4 }, { r: rim + 1.2, y: roofY - 1.6 }, { r: rim - 1, y: roofY - 2.4 });
    return pts;
  };
  const shell = buildRingLoft(ring, doc.shape, crossSectionClip, 192, saucer, surfaceMat, 'RoofCanopySurface');
  shell.customDepthMaterial = shadowDepthMat;
  shell.renderOrder = 2;
  group.add(shell);

  // Inclined V-columns: pairs springing from one foot outside the facade up to the soffit.
  const { tStart, tEnd, closed } = getBowlArcRange(doc.shape, crossSectionClip);
  const fullBays = Math.max(12, Math.round(ring.perimeter / 11));
  const bays = Math.max(4, Math.round(fullBays * Math.max(0.25, tEnd - tStart)));
  const dt = 0.5 / fullBays;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < bays; i++) {
    const t = tStart + ((closed ? i : i + 0.5) / bays) * (tEnd - tStart);
    const n = sampleRoundedBowlRing(ring, t, 0);
    const foot = sampleRoundedBowlRing(ring, t, rimAt(n.nx, n.nz) + 4);
    const base = new THREE.Vector3(foot.x, 0, foot.z);
    for (const side of [-1, 1]) {
      const tt = t + side * dt;
      const m = sampleRoundedBowlRing(ring, tt, 0);
      const head = sampleRoundedBowlRing(ring, tt, rimAt(m.nx, m.nz) - 0.5);
      parts.push(beamGeometry(base, new THREE.Vector3(head.x, roofY - 2.2, head.z), 0.8, 0.8));
    }
  }
  const columns = mergedMesh(parts, createStructurePbrMaterial(mats.structure, maxAnisotropy), 'SaucerVColumns');
  if (columns) group.add(columns);
  return group;
}

/** Height (m) the `rising_canopy` gains from its eave to its front edge. */
const RISING_CANOPY_RISE = 8;

/**
 * RISING CANOPY (`rising_canopy`): a canopy climbing steadily from the eave toward the pitch, its
 * high front edge stiffened by a lattice compression ring around the opening (new Jan Breydel
 * project).
 */
function buildRisingCanopyRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, innerOffset, primaryStructMat, surface } = buildPerimeterCanopyCrown(
    doc,
    crossSectionClip,
    maxAnisotropy,
    {
      segments: 160,
      surface:
        ({ roofY }) =>
        (_t, f) =>
          roofY + RISING_CANOPY_RISE * (1 - f) ** 1.3,
    }
  );
  const { ring } = bounds;
  const { tStart, tEnd } = getBowlArcRange(doc.shape, crossSectionClip);
  const nodes = Math.max(24, Math.round((ring.perimeter / 6) * Math.max(0.25, tEnd - tStart)));
  const at = (i: number, r: number, dy: number) => {
    const t = tStart + (i / nodes) * (tEnd - tStart);
    const p = sampleRoundedBowlRing(ring, t, innerOffset + r);
    return new THREE.Vector3(p.x, surface(t, 0) + dy, p.z);
  };
  // Triangular lattice ring: two bottom chords and a top chord, braced by diagonals.
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < nodes; i++) {
    const j = i + 1;
    parts.push(
      beamGeometry(at(i, 0.3, 0), at(j, 0.3, 0), 0.5, 0.5),
      beamGeometry(at(i, 3.5, -0.6), at(j, 3.5, -0.6), 0.5, 0.5),
      beamGeometry(at(i, 1.8, 3), at(j, 1.8, 3), 0.6, 0.6),
      beamGeometry(at(i, 0.3, 0), at(j, 1.8, 3), 0.25, 0.25),
      beamGeometry(at(i, 3.5, -0.6), at(j, 1.8, 3), 0.25, 0.25),
      beamGeometry(at(i, 0.3, 0), at(i, 3.5, -0.6), 0.25, 0.25)
    );
  }
  const truss = mergedMesh(parts, primaryStructMat, 'RisingCanopyCompressionRing');
  if (truss) group.add(truss);
  return group;
}

/**
 * GIRDER GRID (`girder_grid`): two primary trusses along the touchlines and two behind the goals
 * cross over the canopy's front edge in a « # », resting on cores beyond the corners; secondary
 * trusses run from them out to the eaves, so the roof is carried both ways (Emirates Stadium).
 */
function buildGirderGridRoof(
  doc: StadiumDocument,
  crossSectionClip: boolean,
  maxAnisotropy: number
): THREE.Group {
  const { group, bounds, roofY, innerOffset, primaryStructMat } = buildPerimeterCanopyCrown(
    doc,
    crossSectionClip,
    maxAnisotropy
  );
  const { ring, innerHalfX, innerHalfZ, canopyOuterOffsetAt } = bounds;
  const eave = Array.from({ length: 128 }, (_, s) => {
    const n = sampleRoundedBowlRing(ring, s / 128, 0);
    const p = sampleRoundedBowlRing(ring, s / 128, canopyOuterOffsetAt(n.nx, n.nz, 3.8));
    return { x: p.x, z: p.z };
  });
  const lineX = innerHalfX + innerOffset + 1;
  const lineZ = innerHalfZ + innerOffset + 1;
  const springY = roofY + 2;
  const steel: THREE.BufferGeometry[] = [];
  const primary = (a: THREE.Vector3, b: THREE.Vector3) => {
    steel.push(...warrenTrussParts(a, b, 5, Math.max(8, Math.round(a.distanceTo(b) / 6)), 1.2, 0.5));
    for (const end of [a, b]) {
      if (crossSectionClip && end.z > 0) continue;
      steel.push(beamGeometry(new THREE.Vector3(end.x, 0, end.z), end, 3, 3));
    }
  };
  // Primary girders overshoot the eave to cores beyond the corners.
  const halfX = Math.max(...eave.map((p) => p.x)) + 4;
  const halfZ = Math.max(...eave.map((p) => p.z)) + 4;
  for (const z of crossSectionClip ? [-lineZ] : [-lineZ, lineZ]) {
    primary(new THREE.Vector3(-halfX, springY, z), new THREE.Vector3(halfX, springY, z));
  }
  for (const x of [-lineX, lineX]) {
    primary(new THREE.Vector3(x, springY, -halfZ), new THREE.Vector3(x, springY, crossSectionClip ? 0 : halfZ));
  }
  // Secondary trusses from the primaries out to the eaves, every 10 m.
  const secondary = (axis: 'x' | 'z', along: number, from: number, sign: number) => {
    const chord = chordAt(eave, axis, along);
    if (!chord) return;
    const to = sign > 0 ? chord[1] : chord[0];
    if ((to - from) * sign < 3) return;
    const a = axis === 'x' ? new THREE.Vector3(along, springY, from) : new THREE.Vector3(from, springY, along);
    const b = axis === 'x' ? new THREE.Vector3(along, springY - 1.2, to) : new THREE.Vector3(to, springY - 1.2, along);
    steel.push(...warrenTrussParts(a, b, 2.2, Math.max(3, Math.round(a.distanceTo(b) / 4)), 0.45, 0.22));
  };
  for (let x = -lineX + 8; x < lineX - 4; x += 10) {
    secondary('x', x, -lineZ, -1);
    if (!crossSectionClip) secondary('x', x, lineZ, 1);
  }
  for (let z = -lineZ + 8; z < (crossSectionClip ? 0 : lineZ - 4); z += 10) {
    secondary('z', z, -lineX, -1);
    secondary('z', z, lineX, 1);
  }
  const grid = mergedMesh(steel, primaryStructMat, 'GirderGridTrusses');
  if (grid) group.add(grid);
  return group;
}

/** Open canopies swept around the ring over the stands. */
export const CANOPY_ROOF_BUILDERS: Partial<Record<RoofStyle, RoofBuilder>> = {
  concrete_portals: buildConcretePortalsRoof,
  vaulted_ring: buildVaultedRingRoof,
  folded_plate: buildFoldedPlateRoof,
  girder_grid: buildGirderGridRoof,
  dished_canopy: buildDishedCanopyRoof,
  serrated_canopy: buildSerratedCanopyRoof,
  saucer_dome: buildSaucerDomeRoof,
  rising_canopy: buildRisingCanopyRoof,
};

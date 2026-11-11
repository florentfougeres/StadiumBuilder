import * as THREE from 'three';
import { getBowlArcRange, sampleRoundedBowlRing } from '../bowlRing';
import { createStructurePbrMaterial, resolveStadiumMaterials } from '../materials';
import { RoofStyle, StadiumDocument, StandConfig } from '../schema';
import { standTreadHeightAt } from '../sightlines';
import { beamGeometry, gridSurfaceGeometry, mergedMesh } from './roofBeams';
import { computeStadiumRingBounds } from './ringBounds';
import { cantileverMastRise, trussDepthFor } from './structuralSizing';
import { buildAnnularCanopyMesh, buildAnnularCatwalkFloodlights, buildCanopyMaterialBundle, buildStraightCatwalkFloodlights, createOrientedRoofBoxGeometry, createStrutBetween, hasRoofGantryLights, treadHeightAtNormal } from './roofKit';

/**
 * Continuous-bowl implementations of `column_supported` and `goalpost_truss`
 */
export function buildContinuousColumnOrGoalpostRoof(
  doc: StadiumDocument,
  style: 'column_supported' | 'goalpost_truss',
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

  const roofY = maxStandH + Math.max(2.6, doc.roof.heightOffset * 0.78);
  const innerOff = avgDepth * (1 - doc.roof.coverageRatio);
  const outerOffFn = (nx: number, nz: number) => canopyOuterOffsetAt(nx, nz, 3.2);

  const { surfaceMat: membraneMat, shadowDepthMat } = buildCanopyMaterialBundle(
    doc,
    maxAnisotropy
  );
  const primaryStructMat = createStructurePbrMaterial(mats.structure, maxAnisotropy);

  group.add(
    buildAnnularCanopyMesh(
      ring,
      doc.shape,
      innerOff,
      outerOffFn,
      roofY + (style === 'column_supported' ? -0.4 : 0.4),
      roofY + 0.3,
      crossSectionClip,
      membraneMat,
      shadowDepthMat
    ),
    buildAnnularCatwalkFloodlights(
      ring,
      doc.shape,
      innerOff,
      roofY - 0.65,
      doc.lighting,
      crossSectionClip,
      hasRoofGantryLights(doc)
    )
  );

  // Rear perimeter columns
  const rearCols = Math.max(14, Math.round(40 * arcFraction));
  for (let i = 0; i < rearCols; i++) {
    const frac = closed ? i / rearCols : i / Math.max(1, rearCols - 1);
    const t = tStart + frac * (tEnd - tStart);
    const s0 = sampleRoundedBowlRing(ring, t, 0);
    const d0 = standDepthAtNormal(s0.nx, s0.nz);
    const h0 = standHeightAtNormal(s0.nx, s0.nz);
    const localOuter = outerOffFn(s0.nx, s0.nz);
    const pRear = sampleRoundedBowlRing(ring, t, d0 - 0.3);
    const pRoof = sampleRoundedBowlRing(ring, t, localOuter - 0.6);
    group.add(
      createStrutBetween(
        new THREE.Vector3(pRear.x, h0 - 0.6, pRear.z),
        new THREE.Vector3(pRoof.x, roofY + 0.25, pRoof.z),
        0.3,
        0.34,
        primaryStructMat,
        6
      )
    );
  }

  if (style === 'column_supported') {
    // Slender stanchion columns planted directly inside the upper third of the seating bowl!
    const stanchionCount = Math.max(12, Math.round(32 * arcFraction));
    for (let i = 0; i < stanchionCount; i++) {
      const frac = closed ? i / stanchionCount : i / Math.max(1, stanchionCount - 1);
      const t = tStart + frac * (tEnd - tStart);
      const s0 = sampleRoundedBowlRing(ring, t, 0);
      const d0 = standDepthAtNormal(s0.nx, s0.nz);
      const plantOff = Math.max(innerOff + 2.2, d0 * 0.58);
      const pStand = sampleRoundedBowlRing(ring, t, plantOff);
      const footY = treadHeightAtNormal(doc, s0.nx, s0.nz, plantOff / Math.max(1, d0)) - 0.1;
      group.add(
        createStrutBetween(
          new THREE.Vector3(pStand.x, footY, pStand.z),
          new THREE.Vector3(pStand.x, roofY - 0.15, pStand.z),
          0.16,
          0.18,
          primaryStructMat,
          6
        )
      );
    }
  } else {
    // `goalpost_truss`: 4 corner steel lattice pylons carrying monumental full-length box-girders!
    const cornerX = innerHalfX + avgDepth * 0.55;
    const cornerZ = innerHalfZ + innerOff + 2.5;
    // The girder is as deep as its span asks: about a fourteenth of it.
    const girderDepth = trussDepthFor(cornerX * 2, 4, 14);
    const girderBotY = roofY + 3.8;
    const girderTopY = girderBotY + girderDepth;
    const webR = Math.max(0.16, girderDepth * 0.025);

    const zList = crossSectionClip ? [-cornerZ] : [-cornerZ, cornerZ];
    for (const gz of zList) {
      for (const xSign of [-1, 1] as const) {
        const tower = new THREE.Mesh(
          new THREE.BoxGeometry(3.4, girderTopY + 1.2, 3.4),
          primaryStructMat
        );
        tower.position.set(xSign * cornerX, (girderTopY + 1.2) / 2, gz);
        tower.castShadow = true;
        group.add(tower);
      }
      // Top & bottom chords of the monumental goalpost box-truss
      for (const cy of [girderBotY, girderTopY]) {
        const chord = new THREE.Mesh(
          new THREE.BoxGeometry(cornerX * 2, 0.52, 2.2),
          primaryStructMat
        );
        chord.position.set(0, cy, gz);
        chord.castShadow = true;
        group.add(chord);
      }
      const bays = Math.max(8, Math.round((cornerX * 2) / Math.max(7, girderDepth * 1.2)));
      const bw = (cornerX * 2) / bays;
      for (let b = 0; b < bays; b++) {
        const x0 = -cornerX + b * bw;
        const x1 = x0 + bw;
        const xm = (x0 + x1) * 0.5;
        group.add(
          createStrutBetween(
            new THREE.Vector3(x0, girderBotY, gz),
            new THREE.Vector3(x1, girderTopY, gz),
            webR,
            webR,
            primaryStructMat,
            5
          ),
          createStrutBetween(
            new THREE.Vector3(x1, girderBotY, gz),
            new THREE.Vector3(x0, girderTopY, gz),
            webR,
            webR,
            primaryStructMat,
            5
          ),
          // Vertical hanger rod down to canopy
          createStrutBetween(
            new THREE.Vector3(xm, girderBotY, gz),
            new THREE.Vector3(xm, roofY + 0.3, gz),
            0.1,
            0.1,
            primaryStructMat,
            5
          )
        );
      }
    }
  }

  return group;
}

/**
 * Stand-by-stand roof builder supporting `cantilever`, `truss`, `column_supported`,
 * and `goalpost_truss` (including per-stand heterogeneity on English / 4-stand grounds!).
 */
export function buildSingleStandRoofGroup(
  style: RoofStyle,
  roofSpan: number,
  roofDepth: number,
  frontZ: number,
  rearZ: number,
  standBackZ: number,
  concourseWidth: number,
  standTopY: number,
  roofHeight: number,
  doc: StadiumDocument,
  stand: StandConfig,
  membraneMat: THREE.Material,
  shadowDepthMat: THREE.MeshDepthMaterial,
  primaryStructMat: THREE.Material,
  secondarySteelMat: THREE.Material,
  openNegEnd: boolean = true,
  openPosEnd: boolean = true
): THREE.Group {
  const standRoofGroup = new THREE.Group();
  const midZ = (rearZ + frontZ) / 2;
  const gantryLights = hasRoofGantryLights(doc);
  const crestSupportZ = Math.min(rearZ - 0.8, standBackZ - 0.6);
  const groundSupportZ = Math.max(rearZ + 0.6, standBackZ + concourseWidth + 1.0);

  if (style === 'none') {
    return standRoofGroup;
  }

  if (style === 'column_supported') {
    // Classic British / historic roof resting on slender columns planted in the upper rows!
    const deck = new THREE.Mesh(
      createOrientedRoofBoxGeometry(roofSpan, 0.32, roofDepth),
      membraneMat
    );
    deck.name = 'RoofCanopySurface';
    deck.customDepthMaterial = shadowDepthMat;
    deck.position.set(0, roofHeight - 0.2, midZ);
    deck.rotation.x = 0.035; // Slight pitched marquee slope
    deck.castShadow = true;
    deck.receiveShadow = true;
    standRoofGroup.add(deck);

    // Front lattice valance fascia girder
    const valance = new THREE.Mesh(
      new THREE.BoxGeometry(roofSpan, 1.15, 0.28),
      primaryStructMat
    );
    valance.position.set(0, roofHeight - 0.55, frontZ + 0.5);
    standRoofGroup.add(valance);

    standRoofGroup.add(
      buildStraightCatwalkFloodlights(
        roofSpan,
        frontZ,
        roofHeight - 0.25,
        doc.lighting,
        gantryLights
      )
    );

    const colCount = Math.max(6, Math.floor(roofSpan / 13.5));
    const stanchionZ = frontZ + Math.min(3.4, roofDepth * 0.22);
    // Feet stand on the tread they pierce (slightly sunk so no gap shows at the base).
    const terraceFootY = standTreadHeightAt(stand, stanchionZ) - 0.1;

    for (let i = 0; i < colCount; i++) {
      const cx =
        -roofSpan / 2 + 3.5 + (i * (roofSpan - 7)) / Math.max(1, colCount - 1);
      standRoofGroup.add(
        // Slender steel stanchion column planted right inside the seating rows!
        createStrutBetween(
          new THREE.Vector3(cx, terraceFootY, stanchionZ),
          new THREE.Vector3(cx, roofHeight - 0.2, stanchionZ),
          0.16,
          0.19,
          primaryStructMat,
          6
        ),
        // Knee braces from stanchion top to front valance
        createStrutBetween(
          new THREE.Vector3(cx, roofHeight - 1.5, stanchionZ),
          new THREE.Vector3(cx - 1.4, roofHeight - 0.35, stanchionZ),
          0.08,
          0.08,
          secondarySteelMat,
          4
        ),
        createStrutBetween(
          new THREE.Vector3(cx, roofHeight - 1.5, stanchionZ),
          new THREE.Vector3(cx + 1.4, roofHeight - 0.35, stanchionZ),
          0.08,
          0.08,
          secondarySteelMat,
          4
        ),
        // Rear support column on stand crest -> rear roof
        createStrutBetween(
          new THREE.Vector3(cx, Math.max(0, standTopY - 2.0), crestSupportZ),
          new THREE.Vector3(cx, roofHeight + 0.1, rearZ - 1.0),
          0.26,
          0.3,
          primaryStructMat,
          6
        )
      );
    }

    return standRoofGroup;
  }

  if (style === 'historic_gable') {
    // Pre-war pitched roof: two slopes on exposed king-post trusses and riveted columns,
    // with a pediment facing the pitch at mid-span.
    const rise = Math.max(2.5, roofDepth * 0.16);
    const eaveY = roofHeight - 0.4;
    const ridgeY = eaveY + rise;
    const slopeLen = Math.hypot(roofDepth / 2, rise);
    const tilt = Math.atan2(rise, roofDepth / 2);
    for (const side of [-1, 1] as const) {
      const slope = new THREE.Mesh(createOrientedRoofBoxGeometry(roofSpan, 0.18, slopeLen), membraneMat);
      slope.name = 'RoofCanopySurface';
      slope.customDepthMaterial = shadowDepthMat;
      slope.position.set(0, (eaveY + ridgeY) / 2, midZ + (side * roofDepth) / 4);
      slope.rotation.x = side * tilt;
      slope.castShadow = true;
      slope.receiveShadow = true;
      standRoofGroup.add(slope);
    }

    const parts: THREE.BufferGeometry[] = [];
    const bays = Math.max(4, Math.round(roofSpan / 6));
    for (let b = 0; b <= bays; b++) {
      const x = -roofSpan / 2 + (b * roofSpan) / bays;
      const front = new THREE.Vector3(x, eaveY - 0.2, frontZ);
      const back = new THREE.Vector3(x, eaveY - 0.2, rearZ);
      const ridge = new THREE.Vector3(x, ridgeY - 0.25, midZ);
      const foot = new THREE.Vector3(x, eaveY - 0.2, midZ);
      parts.push(
        beamGeometry(front, back, 0.22, 0.3),
        beamGeometry(front, ridge, 0.22, 0.3),
        beamGeometry(back, ridge, 0.22, 0.3),
        beamGeometry(foot, ridge, 0.16, 0.16)
      );
      if (b % 2 === 0) {
        // Riveted columns: one in the upper rows, one on the stand crest.
        const footY = Math.max(1.8, standTopY * 0.55);
        const colZ = frontZ + Math.min(3.4, roofDepth * 0.22);
        parts.push(beamGeometry(new THREE.Vector3(x, footY, colZ), new THREE.Vector3(x, eaveY - 0.2, colZ), 0.32, 0.32));
        parts.push(
          beamGeometry(
            new THREE.Vector3(x, Math.max(0, standTopY - 2), crestSupportZ),
            new THREE.Vector3(x, eaveY - 0.2, crestSupportZ),
            0.36,
            0.36
          )
        );
      }
    }
    const frame = mergedMesh(parts, primaryStructMat, 'HistoricGableTrusses');
    if (frame) standRoofGroup.add(frame);

    // Pediment over the centre of the front slope.
    const pedW = Math.min(22, roofSpan * 0.3);
    const pedH = rise + 3.2;
    const pediment = new THREE.Mesh(
      new THREE.ExtrudeGeometry(
        new THREE.Shape([
          new THREE.Vector2(-pedW / 2, 0),
          new THREE.Vector2(pedW / 2, 0),
          new THREE.Vector2(0, pedH),
        ]),
        { depth: 0.5, bevelEnabled: false }
      ),
      membraneMat
    );
    pediment.name = 'HistoricGablePediment';
    pediment.position.set(0, eaveY, frontZ - 0.25);
    pediment.castShadow = true;
    standRoofGroup.add(pediment);

    standRoofGroup.add(
      buildStraightCatwalkFloodlights(roofSpan, frontZ, eaveY - 0.25, doc.lighting, gantryLights)
    );
    return standRoofGroup;
  }

  if (style === 'sawtooth') {
    // Shed roof of north-light teeth: each bay slopes up along the stand, then drops back to the
    // valley through a glazed vertical face. Ridges run front to back, so the front fascia reads
    // as a zigzag from the pitch. Valley girders sit on columns in the upper rows and the crest.
    const teeth = Math.max(3, Math.round(roofSpan / 11));
    const toothW = roofSpan / teeth;
    const rise = Math.max(2.2, Math.min(4.5, toothW * 0.32));
    const valleyY = roofHeight - 0.3;
    const slopeLen = Math.hypot(toothW, rise);
    const tilt = Math.atan2(rise, toothW);
    const glazingMat = new THREE.MeshPhysicalMaterial({
      color: 0xd6ecf5,
      roughness: 0.08,
      metalness: 0.15,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
    });
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < teeth; i++) {
      const x0 = -roofSpan / 2 + i * toothW;
      const slope = new THREE.Mesh(createOrientedRoofBoxGeometry(slopeLen, 0.18, roofDepth), membraneMat);
      slope.name = 'RoofCanopySurface';
      slope.customDepthMaterial = shadowDepthMat;
      slope.position.set(x0 + toothW / 2, valleyY + rise / 2, midZ);
      slope.rotation.z = tilt;
      slope.castShadow = true;
      slope.receiveShadow = true;
      standRoofGroup.add(slope);

      const glass = new THREE.Mesh(new THREE.PlaneGeometry(roofDepth, rise), glazingMat);
      glass.position.set(x0 + toothW, valleyY + rise / 2, midZ);
      glass.rotation.y = Math.PI / 2;
      standRoofGroup.add(glass);

      // Ridge and valley girders front to back, with raking mullions in each glazed face.
      const ridgeX = x0 + toothW;
      parts.push(
        beamGeometry(new THREE.Vector3(ridgeX, valleyY + rise, frontZ), new THREE.Vector3(ridgeX, valleyY + rise, rearZ), 0.2, 0.26),
        beamGeometry(new THREE.Vector3(x0, valleyY - 0.25, frontZ), new THREE.Vector3(x0, valleyY - 0.25, rearZ), 0.3, 0.5)
      );
      for (const z of [frontZ + 0.2, midZ, rearZ - 0.2]) {
        parts.push(beamGeometry(new THREE.Vector3(ridgeX, valleyY, z), new THREE.Vector3(ridgeX, valleyY + rise, z), 0.12, 0.12));
      }
    }
    // Last valley girder closing the far end.
    parts.push(
      beamGeometry(
        new THREE.Vector3(roofSpan / 2, valleyY - 0.25, frontZ),
        new THREE.Vector3(roofSpan / 2, valleyY - 0.25, rearZ),
        0.3,
        0.5
      )
    );
    const footY = Math.max(1.8, standTopY * 0.55);
    const colZ = frontZ + Math.min(3.4, roofDepth * 0.22);
    for (let i = 0; i <= teeth; i++) {
      const x = -roofSpan / 2 + i * toothW;
      if (i % 2 === 0) {
        parts.push(beamGeometry(new THREE.Vector3(x, footY, colZ), new THREE.Vector3(x, valleyY - 0.5, colZ), 0.3, 0.3));
      }
      parts.push(
        beamGeometry(
          new THREE.Vector3(x, Math.max(0, standTopY - 2), crestSupportZ),
          new THREE.Vector3(x, valleyY - 0.5, crestSupportZ),
          0.34,
          0.34
        )
      );
    }
    const frame = mergedMesh(parts, primaryStructMat, 'SawtoothFrame');
    if (frame) standRoofGroup.add(frame);

    standRoofGroup.add(
      buildStraightCatwalkFloodlights(roofSpan, frontZ, valleyY - 0.25, doc.lighting, gantryLights)
    );
    return standRoofGroup;
  }

  if (style === 'butterfly') {
    // Butterfly: two slopes falling to a central valley gutter, so the front edge kicks up toward
    // the pitch and the rear rises again over the crest. Rafters follow the V on each bay, the
    // gutter girder rests on columns in the upper rows, and the crest columns carry the back.
    const valleyY = roofHeight - 1.2;
    const valleyZ = frontZ + roofDepth * 0.55;
    const frontY = valleyY + Math.max(3, roofDepth * 0.22);
    const rearY = valleyY + Math.max(1.6, roofDepth * 0.12);
    const surface = gridSurfaceGeometry(
      8,
      2,
      (u, v) => {
        const x = -roofSpan / 2 + u * roofSpan;
        return v <= 0.5
          ? new THREE.Vector3(x, frontY + (valleyY - frontY) * (v * 2), frontZ + (valleyZ - frontZ) * (v * 2))
          : new THREE.Vector3(x, valleyY + (rearY - valleyY) * (v * 2 - 1), valleyZ + (rearZ - valleyZ) * (v * 2 - 1));
      },
      [roofSpan / 8, 2]
    );
    const wings = new THREE.Mesh(surface, membraneMat);
    wings.name = 'RoofCanopySurface';
    wings.customDepthMaterial = shadowDepthMat;
    wings.castShadow = true;
    wings.receiveShadow = true;
    standRoofGroup.add(wings);

    const parts: THREE.BufferGeometry[] = [];
    const bays = Math.max(4, Math.round(roofSpan / 8));
    const colZ = frontZ + Math.min(roofDepth * 0.5, Math.max(3, roofDepth * 0.4));
    const footY = Math.max(1.8, standTopY * 0.6);
    for (let b = 0; b <= bays; b++) {
      const x = -roofSpan / 2 + (b * roofSpan) / bays;
      const f = new THREE.Vector3(x, frontY - 0.3, frontZ);
      const v = new THREE.Vector3(x, valleyY - 0.3, valleyZ);
      const r = new THREE.Vector3(x, rearY - 0.3, rearZ);
      parts.push(beamGeometry(f, v, 0.22, 0.5), beamGeometry(v, r, 0.22, 0.5));
      if (b % 2 === 0) {
        parts.push(
          beamGeometry(new THREE.Vector3(x, footY, colZ), new THREE.Vector3(x, valleyY - 0.5, colZ), 0.34, 0.34),
          beamGeometry(
            new THREE.Vector3(x, Math.max(0, standTopY - 2), crestSupportZ),
            new THREE.Vector3(x, valleyY + (rearY - valleyY) * ((crestSupportZ - valleyZ) / Math.max(0.1, rearZ - valleyZ)) - 0.5, crestSupportZ),
            0.38,
            0.38
          )
        );
      }
    }
    // Gutter girder along the valley.
    parts.push(
      beamGeometry(
        new THREE.Vector3(-roofSpan / 2, valleyY - 0.6, valleyZ),
        new THREE.Vector3(roofSpan / 2, valleyY - 0.6, valleyZ),
        0.6,
        0.9
      )
    );
    const frame = mergedMesh(parts, primaryStructMat, 'ButterflyFrame');
    if (frame) standRoofGroup.add(frame);
    standRoofGroup.add(buildStraightCatwalkFloodlights(roofSpan, frontZ, frontY - 0.4, doc.lighting, gantryLights));
    return standRoofGroup;
  }

  if (style === 'barrel_vault') {
    // Barrel vault along the stand: one cylindrical shell whose axis runs the length of the stand,
    // springing from a front edge beam to the crest, stiffened by arched ribs every bay and held by
    // tie rods between its springings.
    const rise = Math.max(2.8, roofDepth * 0.2);
    const springY = roofHeight - 0.6;
    const chord = roofDepth / 2;
    const radius = (chord * chord + rise * rise) / (2 * rise);
    const half = Math.asin(Math.min(1, chord / radius));
    const centreY = springY + rise - radius;
    const arcPoint = (a: number, r: number) =>
      new THREE.Vector3(0, centreY + Math.cos(a) * r, midZ + Math.sin(a) * r);
    const shell = new THREE.Mesh(
      gridSurfaceGeometry(
        Math.max(6, Math.round(roofSpan / 6)),
        16,
        (u, v) => {
          const p = arcPoint(-half + v * 2 * half, radius);
          p.x = -roofSpan / 2 + u * roofSpan;
          return p;
        },
        [roofSpan / 6, 4]
      ),
      membraneMat
    );
    shell.name = 'RoofCanopySurface';
    shell.customDepthMaterial = shadowDepthMat;
    shell.castShadow = true;
    shell.receiveShadow = true;
    standRoofGroup.add(shell);

    const parts: THREE.BufferGeometry[] = [];
    const bays = Math.max(4, Math.round(roofSpan / 9));
    const footY = Math.max(1.8, standTopY * 0.6);
    for (let b = 0; b <= bays; b++) {
      const x = -roofSpan / 2 + (b * roofSpan) / bays;
      for (let k = 0; k < 12; k++) {
        const a0 = arcPoint(-half + (k / 12) * 2 * half, radius - 0.35);
        const a1 = arcPoint(-half + ((k + 1) / 12) * 2 * half, radius - 0.35);
        a0.x = x;
        a1.x = x;
        parts.push(beamGeometry(a0, a1, 0.3, 0.55));
      }
      const front = arcPoint(-half, radius);
      const back = arcPoint(half, radius);
      front.x = back.x = x;
      parts.push(beamGeometry(front, back, 0.08, 0.08));
      if (b % 2 === 0) {
        parts.push(
          beamGeometry(new THREE.Vector3(x, footY, frontZ + 0.4), new THREE.Vector3(x, springY - 0.2, frontZ + 0.4), 0.32, 0.32),
          beamGeometry(
            new THREE.Vector3(x, Math.max(0, standTopY - 2), crestSupportZ),
            new THREE.Vector3(x, springY - 0.2, crestSupportZ),
            0.36,
            0.36
          )
        );
      }
    }
    for (const z of [frontZ, rearZ]) {
      parts.push(
        beamGeometry(new THREE.Vector3(-roofSpan / 2, springY - 0.3, z), new THREE.Vector3(roofSpan / 2, springY - 0.3, z), 0.5, 0.7)
      );
    }
    const frame = mergedMesh(parts, primaryStructMat, 'BarrelVaultRibs');
    if (frame) standRoofGroup.add(frame);
    standRoofGroup.add(buildStraightCatwalkFloodlights(roofSpan, frontZ, springY - 0.4, doc.lighting, gantryLights));
    return standRoofGroup;
  }

  if (style === 'hypar_shells') {
    // Row of thin concrete hyperbolic-paraboloid shells cantilevered from the crest: each unit is a
    // twisted (saddle) surface between straight edges, its corners alternately raised and lowered
    // so neighbouring units meet in a scalloped front edge. A rear column and a backstay hold each.
    const units = Math.max(3, Math.round(roofSpan / 13));
    const unitW = roofSpan / units;
    const twist = Math.max(1.4, unitW * 0.16);
    const rearY = roofHeight - 0.4;
    const frontY = rearY + Math.max(1.2, roofDepth * 0.06);
    // Thin shells are seen from above and below.
    const concreteMat = createStructurePbrMaterial('reinforced_concrete', 4);
    concreteMat.side = THREE.DoubleSide;
    const shells: THREE.BufferGeometry[] = [];
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < units; i++) {
      const x0 = -roofSpan / 2 + i * unitW;
      const flip = i % 2 === 0 ? 1 : -1;
      // Bilinear patch: front corners twisted up/down, rear corners the other way.
      const corner = (u: number, v: number) => {
        const sign = (u < 0.5 ? 1 : -1) * (v < 0.5 ? 1 : -1) * flip;
        const base = frontY + (rearY - frontY) * v;
        return base + sign * twist * 0.5;
      };
      const at = (u: number, v: number) => {
        const y00 = corner(0, 0);
        const y10 = corner(1, 0);
        const y01 = corner(0, 1);
        const y11 = corner(1, 1);
        const y = (1 - u) * (1 - v) * y00 + u * (1 - v) * y10 + (1 - u) * v * y01 + u * v * y11;
        return new THREE.Vector3(x0 + u * unitW, y, frontZ + v * roofDepth);
      };
      shells.push(gridSurfaceGeometry(10, 10, at, [unitW / 4, roofDepth / 4]));
      // Thickened edge beams and the column with its backstay at the rear middle.
      for (const [a, b] of [
        [at(0, 0), at(1, 0)],
        [at(0, 0), at(0, 1)],
      ] as const) {
        parts.push(beamGeometry(a.clone().setY(a.y - 0.25), b.clone().setY(b.y - 0.25), 0.35, 0.5));
      }
      const head = at(0.5, 0.82);
      const xMid = x0 + unitW / 2;
      parts.push(
        beamGeometry(new THREE.Vector3(xMid, Math.max(0, standTopY - 2), crestSupportZ), head.clone().setY(head.y - 0.3), 0.7, 0.7),
        beamGeometry(head, new THREE.Vector3(xMid, 0, groundSupportZ + 2), 0.12, 0.12)
      );
    }
    parts.push(beamGeometry(new THREE.Vector3(roofSpan / 2, frontY, frontZ), new THREE.Vector3(roofSpan / 2, rearY, rearZ), 0.35, 0.5));
    const shellMesh = mergedMesh(shells, concreteMat, 'RoofCanopySurface');
    if (shellMesh) {
      shellMesh.castShadow = true;
      shellMesh.receiveShadow = true;
      standRoofGroup.add(shellMesh);
    }
    const frame = mergedMesh(parts, concreteMat, 'HyparShellEdges');
    if (frame) standRoofGroup.add(frame);
    standRoofGroup.add(buildStraightCatwalkFloodlights(roofSpan, frontZ, frontY - twist, doc.lighting, gantryLights));
    return standRoofGroup;
  }

  if (style === 'stand_arch') {
    // One tubular arch over the stand, its feet on the ground past each end; the roof hangs from it
    // on cables and follows its curve, so the stand reads as a crescent from the side.
    const rise = Math.max(4, roofSpan * 0.05);
    const deckY = (x: number) => roofHeight + rise * (1 - Math.pow((2 * x) / roofSpan, 2));
    const segs = Math.max(12, Math.round(roofSpan / 6));
    const deckParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < segs; i++) {
      const x0 = -roofSpan / 2 + (i * roofSpan) / segs;
      const x1 = x0 + roofSpan / segs;
      const a = new THREE.Vector3(x0, deckY(x0), midZ);
      const b = new THREE.Vector3(x1, deckY(x1), midZ);
      deckParts.push(beamGeometry(a, b, roofDepth, 0.28));
    }
    const deck = mergedMesh(deckParts, membraneMat, 'RoofCanopySurface');
    if (deck) {
      deck.customDepthMaterial = shadowDepthMat;
      standRoofGroup.add(deck);
    }

    // The arch: feet on the ground behind the stand ends, within its length so neighbouring
    // stands keep clear; it leans forward to a crown over the front third of the roof.
    const archZ = frontZ + roofDepth * 0.35;
    const footX = roofSpan / 2 - 1.5;
    const footZ = groundSupportZ + 2;
    const crownY = roofHeight + rise + Math.max(14, roofSpan * 0.16);
    const archAt = (u: number) =>
      new THREE.Vector3(u * footX, crownY * (1 - u * u), archZ + (footZ - archZ) * u * u);
    const archPts = Array.from({ length: 41 }, (_, i) => archAt(-1 + i / 20));
    const arch = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(archPts), 80, 1.1, 10, false),
      primaryStructMat
    );
    arch.name = 'StandArch';
    arch.castShadow = true;
    standRoofGroup.add(arch);

    // Hangers from the arch to the front and rear edges of the deck.
    const hangers: THREE.BufferGeometry[] = [];
    const hangerCount = Math.max(6, Math.round(roofSpan / 9));
    for (let i = 1; i < hangerCount; i++) {
      const x = -roofSpan / 2 + (i * roofSpan) / hangerCount;
      const top = archAt(x / footX);
      if (top.y <= deckY(x) + 1) continue;
      for (const z of [frontZ + 0.5, rearZ - 0.5]) {
        hangers.push(beamGeometry(top, new THREE.Vector3(x, deckY(x), z), 0.12, 0.12));
      }
    }
    const hangerMesh = mergedMesh(hangers, secondarySteelMat, 'StandArchHangers');
    if (hangerMesh) standRoofGroup.add(hangerMesh);
    standRoofGroup.add(buildStraightCatwalkFloodlights(roofSpan, frontZ, roofHeight, doc.lighting, gantryLights));
    return standRoofGroup;
  }

  if (style === 'tree_columns') {
    // Flat canopy on branching "tree" columns: each trunk rises from the crest, forks into three
    // limbs, and each limb into twigs that pick up the deck at spread points, so the canopy needs
    // no front support and the tree spreads its load like a crown.
    const deckY = roofHeight;
    const deck = new THREE.Mesh(createOrientedRoofBoxGeometry(roofSpan, 0.3, roofDepth), membraneMat);
    deck.name = 'RoofCanopySurface';
    deck.customDepthMaterial = shadowDepthMat;
    deck.position.set(0, deckY, midZ);
    deck.rotation.x = 0.03;
    deck.castShadow = true;
    deck.receiveShadow = true;
    standRoofGroup.add(deck);

    const parts: THREE.BufferGeometry[] = [];
    const trees = Math.max(2, Math.round(roofSpan / 18));
    const pitchX = roofSpan / trees;
    const soffit = deckY - 0.35;
    const trunkFoot = Math.max(0, standTopY - 2);
    const forkY = trunkFoot + (soffit - trunkFoot) * 0.45;
    for (let i = 0; i < trees; i++) {
      const x = -roofSpan / 2 + (i + 0.5) * pitchX;
      const fork = new THREE.Vector3(x, forkY, crestSupportZ - 0.5);
      parts.push(beamGeometry(new THREE.Vector3(x, trunkFoot, crestSupportZ), fork, 0.9, 0.9));
      const limbTargets = [
        new THREE.Vector3(x - pitchX * 0.25, soffit - 2.4, midZ),
        new THREE.Vector3(x + pitchX * 0.25, soffit - 2.4, midZ),
        new THREE.Vector3(x, soffit - 2.0, frontZ + roofDepth * 0.22),
      ];
      for (const node of limbTargets) {
        parts.push(beamGeometry(fork, node, 0.5, 0.5));
        for (const [dx, dz] of [
          [-pitchX * 0.14, -roofDepth * 0.12],
          [pitchX * 0.14, -roofDepth * 0.12],
          [0, roofDepth * 0.14],
        ]) {
          const tip = new THREE.Vector3(node.x + dx, soffit, Math.min(rearZ - 0.5, Math.max(frontZ + 0.5, node.z + dz)));
          parts.push(beamGeometry(node, tip, 0.24, 0.24));
        }
      }
    }
    const frame = mergedMesh(parts, primaryStructMat, 'TreeColumns');
    if (frame) standRoofGroup.add(frame);
    standRoofGroup.add(buildStraightCatwalkFloodlights(roofSpan, frontZ, deckY - 0.3, doc.lighting, gantryLights));
    return standRoofGroup;
  }

  if (style === 'goalpost_truss') {
    // Monumental "Poutre-portique" (Goalpost) box-girder resting on 2 corner mega-pylons!
    const deck = new THREE.Mesh(
      createOrientedRoofBoxGeometry(roofSpan, 0.38, roofDepth),
      membraneMat
    );
    deck.name = 'RoofCanopySurface';
    deck.customDepthMaterial = shadowDepthMat;
    deck.position.set(0, roofHeight, midZ);
    deck.castShadow = true;
    deck.receiveShadow = true;
    standRoofGroup.add(deck);

    standRoofGroup.add(
      buildStraightCatwalkFloodlights(roofSpan, frontZ, roofHeight, doc.lighting, gantryLights)
    );

    const pylonX = roofSpan / 2 + 1.8;
    const girderDepth = trussDepthFor(pylonX * 2, 4, 12);
    const girderBotY = roofHeight + 3.6;
    const girderTopY = girderBotY + girderDepth;
    const webR = Math.max(0.14, girderDepth * 0.025);
    const girderZ = frontZ + Math.min(4.2, roofDepth * 0.24);

    // 2 Corner Mega-Pylons: planted at front girder ONLY on open ends; shifted behind rear wall on closed corners!
    for (const sSign of [-1, 1] as const) {
      const isOpenEnd = sSign === -1 ? openNegEnd : openPosEnd;
      const px = sSign * (isOpenEnd ? pylonX : roofSpan * 0.5 - 0.6);
      const pylonZ = isOpenEnd ? girderZ : groundSupportZ + 0.6;
      const pylon = new THREE.Mesh(
        new THREE.BoxGeometry(3.0, girderTopY + 1.4, 3.2),
        primaryStructMat
      );
      pylon.position.set(px, (girderTopY + 1.4) / 2, pylonZ);
      pylon.castShadow = true;
      standRoofGroup.add(pylon);

      standRoofGroup.add(
        createStrutBetween(
          new THREE.Vector3(
            px,
            isOpenEnd ? 0 : standTopY,
            isOpenEnd ? groundSupportZ + 0.9 : crestSupportZ
          ),
          new THREE.Vector3(px, girderTopY, girderZ),
          0.38,
          0.48,
          primaryStructMat,
          6
        )
      );
    }

    // Horizontal 4-chord spatial goalpost box-girder spanning the full stand!
    for (const cy of [girderBotY, girderTopY]) {
      for (const czOff of [-1.1, 1.1]) {
        const chord = new THREE.Mesh(
          new THREE.BoxGeometry(pylonX * 2 + 1.2, 0.44, 0.44),
          primaryStructMat
        );
        chord.position.set(0, cy, girderZ + czOff);
        chord.castShadow = true;
        standRoofGroup.add(chord);
      }
    }

    const bayCount = Math.max(6, Math.round((pylonX * 2) / Math.max(7.5, girderDepth * 1.2)));
    const bayW = (pylonX * 2) / bayCount;
    for (let b = 0; b < bayCount; b++) {
      const x0 = -pylonX + b * bayW;
      const x1 = x0 + bayW;
      const xm = (x0 + x1) * 0.5;
      standRoofGroup.add(
        createStrutBetween(
          new THREE.Vector3(x0, girderBotY, girderZ - 1.1),
          new THREE.Vector3(x1, girderTopY, girderZ - 1.1),
          webR,
          webR,
          primaryStructMat,
          5
        ),
        createStrutBetween(
          new THREE.Vector3(x1, girderBotY, girderZ + 1.1),
          new THREE.Vector3(x0, girderTopY, girderZ + 1.1),
          webR,
          webR,
          primaryStructMat,
          5
        ),
        // Vertical hanger rod suspending roof rafter from goalpost girder
        createStrutBetween(
          new THREE.Vector3(xm, girderBotY, girderZ),
          new THREE.Vector3(xm, roofHeight + 0.15, girderZ),
          0.11,
          0.11,
          secondarySteelMat,
          5
        ),
        // Transverse roof rafter back to rear canopy edge
        createStrutBetween(
          new THREE.Vector3(xm, roofHeight + 0.2, frontZ + 0.5),
          new THREE.Vector3(xm, roofHeight + 0.2, rearZ - 0.5),
          0.18,
          0.18,
          secondarySteelMat,
          5
        ),
        createStrutBetween(
          new THREE.Vector3(xm, Math.max(0, standTopY - 1.8), crestSupportZ),
          new THREE.Vector3(xm, roofHeight + 0.2, rearZ - 1.0),
          0.26,
          0.3,
          primaryStructMat,
          6
        )
      );
    }

    return standRoofGroup;
  }

  if (style === 'truss') {
    const deck = new THREE.Mesh(
      createOrientedRoofBoxGeometry(roofSpan, 0.36, roofDepth),
      membraneMat
    );
    deck.name = 'RoofCanopySurface';
    deck.customDepthMaterial = shadowDepthMat;
    deck.position.set(0, roofHeight, midZ);
    deck.castShadow = true;
    deck.receiveShadow = true;
    standRoofGroup.add(deck);

    standRoofGroup.add(
      buildStraightCatwalkFloodlights(roofSpan, frontZ, roofHeight, doc.lighting, gantryLights)
    );

    const rearCols = Math.max(6, Math.floor(roofSpan / 13));
    for (let c = 0; c < rearCols; c++) {
      const cx = -roofSpan / 2 + 2 + (c * (roofSpan - 4)) / Math.max(1, rearCols - 1);
      standRoofGroup.add(
        createStrutBetween(
          new THREE.Vector3(cx, Math.max(0, standTopY - 2.2), crestSupportZ),
          new THREE.Vector3(cx, roofHeight + 0.2, rearZ - 1.0),
          0.28,
          0.32,
          primaryStructMat,
          6
        ),
        createStrutBetween(
          new THREE.Vector3(cx, roofHeight - 0.25, rearZ - 0.4),
          new THREE.Vector3(cx, roofHeight - 0.25, frontZ + 0.4),
          0.2,
          0.2,
          secondarySteelMat,
          5
        )
      );
    }

    const gableGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0xcbd5e1,
      roughness: 0.14,
      metalness: 0.15,
      clearcoat: 0.9,
      transparent: true,
      opacity: 0.52,
      side: THREE.DoubleSide,
    });

    const girderH = trussDepthFor(roofSpan, 2.8, 9);
    const chord = Math.max(0.34, girderH * 0.085);
    const webR = Math.max(0.1, girderH * 0.028);
    for (const sSign of [-1, 1] as const) {
      const isOpenEnd = sSign === -1 ? openNegEnd : openPosEnd;
      if (!isOpenEnd) continue;

      const gx = sSign * (roofSpan / 2 - 0.6);
      standRoofGroup.add(
        createStrutBetween(
          new THREE.Vector3(gx, 0, frontZ + 1.4),
          new THREE.Vector3(gx, roofHeight + girderH, frontZ + 0.8),
          0.42,
          0.52,
          primaryStructMat,
          6
        ),
        createStrutBetween(
          new THREE.Vector3(gx, 0, groundSupportZ - 0.4),
          new THREE.Vector3(gx, roofHeight + 0.4, rearZ - 0.6),
          0.42,
          0.52,
          primaryStructMat,
          6
        )
      );

      const gableH = Math.max(3.5, roofHeight - standTopY * 0.55);
      const gable = new THREE.Mesh(
        new THREE.PlaneGeometry(roofDepth * 0.88, gableH),
        gableGlassMat
      );
      gable.rotation.y = Math.PI / 2;
      gable.position.set(gx, roofHeight - gableH / 2, midZ);
      standRoofGroup.add(gable);
    }

    for (const yOff of [0.25, girderH]) {
      const chordMesh = new THREE.Mesh(
        new THREE.BoxGeometry(roofSpan, chord, chord * 1.25),
        primaryStructMat
      );
      chordMesh.position.set(0, roofHeight + yOff, frontZ + 0.6);
      chordMesh.castShadow = true;
      standRoofGroup.add(chordMesh);
    }

    const bayCount = Math.max(6, Math.round(roofSpan / Math.max(6, girderH * 1.3)));
    const bayW = roofSpan / bayCount;
    for (let b = 0; b < bayCount; b++) {
      const x0 = -roofSpan / 2 + b * bayW;
      const x1 = x0 + bayW;
      standRoofGroup.add(
        createStrutBetween(
          new THREE.Vector3(x0, roofHeight + 0.25, frontZ + 0.6),
          new THREE.Vector3(x1, roofHeight + girderH, frontZ + 0.6),
          webR,
          webR,
          primaryStructMat,
          5
        ),
        createStrutBetween(
          new THREE.Vector3(x1, roofHeight + 0.25, frontZ + 0.6),
          new THREE.Vector3(x0, roofHeight + girderH, frontZ + 0.6),
          webR,
          webR,
          primaryStructMat,
          5
        )
      );
    }

    return standRoofGroup;
  }

  // Default stand roof: `cantilever` (rear-anchored cantilever frames without front columns)
  const tiltAngle = -0.055;
  const deckSlab = new THREE.Mesh(
    createOrientedRoofBoxGeometry(roofSpan, 0.42, roofDepth),
    membraneMat
  );
  deckSlab.name = 'RoofCanopySurface';
  deckSlab.customDepthMaterial = shadowDepthMat;
  deckSlab.position.set(0, roofHeight + 0.4, midZ);
  deckSlab.rotation.x = tiltAngle;
  deckSlab.castShadow = true;
  deckSlab.receiveShadow = true;
  standRoofGroup.add(deckSlab);

  standRoofGroup.add(
    buildStraightCatwalkFloodlights(roofSpan, frontZ, roofHeight + 0.4, doc.lighting, gantryLights)
  );

  const anchorOnStandCrest = concourseWidth > 0.5 && doc.roof.overConcourse === false;
  // The tie mast rises with the reach it holds back: about a sixth of the cantilever.
  const mastRise = cantileverMastRise(roofDepth, 3.4, 8);
  const frameCount = Math.max(7, Math.floor(roofSpan / 11));
  for (let i = 0; i < frameCount; i++) {
    const rx = -roofSpan / 2 + 2.5 + (i * (roofSpan - 5)) / Math.max(1, frameCount - 1);
    const rearPostFootY = anchorOnStandCrest ? Math.max(0, standTopY - 2.2) : 0;
    const rearPostFootZ = anchorOnStandCrest ? rearZ - 0.1 : groundSupportZ;

    standRoofGroup.add(
      createStrutBetween(
        new THREE.Vector3(rx, rearPostFootY, rearPostFootZ),
        new THREE.Vector3(rx, roofHeight + mastRise, rearZ - 0.2),
        0.34,
        0.46,
        primaryStructMat,
        6
      ),
      createStrutBetween(
        new THREE.Vector3(rx, standTopY - 1.2, crestSupportZ),
        new THREE.Vector3(rx, roofHeight + 0.3, crestSupportZ),
        0.26,
        0.26,
        secondarySteelMat,
        6
      ),
      createStrutBetween(
        new THREE.Vector3(rx, roofHeight + mastRise - 0.1, rearZ - 0.2),
        new THREE.Vector3(rx, roofHeight + 1.25, frontZ + 2.5),
        0.18,
        0.34,
        primaryStructMat,
        6
      ),
      createStrutBetween(
        new THREE.Vector3(rx, roofHeight + (mastRise + 1.15) / 2, midZ),
        new THREE.Vector3(rx, roofHeight + 0.55, midZ),
        0.12,
        0.12,
        secondarySteelMat,
        5
      )
    );
  }

  return standRoofGroup;
}

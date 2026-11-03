import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildStadiumSceneGraph, disposeObject3D } from '../buildStadiumScene';
import {
  calculateStadiumMetrics,
  calculateStandMetrics,
  computeKopWallStandPatch,
  getTrackRadialOffset,
} from '../capacity';
import { generateFloodlightRigGroup } from '../generateLights';
import { generateConcourseGroup } from '../generateConcourse';
import { generateRoofGroup } from '../generateRoof';
import { generateStandsGroup } from '../generateStand';
import {
  CORNER_MODE_CATALOG,
  createFacadePbrMaterial,
  createRoofPbrMaterial,
  createRoofShadowDepthMaterial,
  createSeatTerracePbrMaterial,
  createStructurePbrMaterial,
  createTrackPbrMaterial,
  ENVELOPE_STYLE_CATALOG,
  FACADE_MATERIAL_CATALOG,
  FACADE_PATTERN_CATALOG,
  FLOODLIGHT_RIG_CATALOG,
  PLAZA_MATERIAL_CATALOG,
  ROOF_MATERIAL_CATALOG,
  SEAT_MATERIAL_CATALOG,
  SKYLIGHT_MODE_CATALOG,
  STRUCTURE_MATERIAL_CATALOG,
  TRACK_MATERIAL_CATALOG,
  TURF_MATERIAL_CATALOG,
} from '../materials';
import { createPresetDocument, STADIUM_PRESETS } from '../presets';
import {
  clampPitchToTrack,
  EnvelopeStyle,
  getMaxPitchLengthForTrack,
  getTrackGeometry,
  riserFromSlopeDeg,
  RoofStyle,
  STADIUM_SHAPE_LABELS,
  StadiumShape,
  TRACK_KERB_RADIUS_M,
  TRACK_LANE1_MEASUREMENT_OFFSET_M,
  TRACK_LANE_WIDTH_M,
  TRACK_MAX_PITCH_WIDTH_M,
  TRACK_STRAIGHT_LENGTH_M,
} from '../schema';
import {
  computeRowCValueMm,
  computeStandSection,
  computeStandSightlines,
  DEFAULT_TIER_OVERHANG_M,
  OVERHANG_HEADROOM_M,
  resolveStandTiers,
} from '../sightlines';
import { normalizeStadiumDocument } from '../../state/useStadiumStore';

function ensureCanvasMock() {
  if (typeof document === 'undefined') {
    (globalThis as Record<string, unknown>).document = {
      createElement: () => ({
        width: 1024,
        height: 512,
        getContext: () => ({
          fillStyle: '',
          strokeStyle: '',
          lineWidth: 1,
          globalAlpha: 1,
          font: '',
          textAlign: 'center',
          fillRect: () => {},
          clearRect: () => {},
          strokeRect: () => {},
          fillText: () => {},
          beginPath: () => {},
          closePath: () => {},
          moveTo: () => {},
          lineTo: () => {},
          arc: () => {},
          ellipse: () => {},
          fill: () => {},
          stroke: () => {},
          save: () => {},
          restore: () => {},
          translate: () => {},
          scale: () => {},
          setLineDash: () => {},
          createLinearGradient: () => ({
            addColorStop: () => {},
          }),
          createRadialGradient: () => ({
            addColorStop: () => {},
          }),
        }),
      }),
    };
  }
}

/**
 * Budget for tests that build every preset or synthesise every catalogue texture: about 2 s on a
 * desktop, three times that on a shared CI runner.
 */
const FULL_SCENE_TIMEOUT_MS = 30_000;

describe('StadiumForge 11 Morphologies, 15 Roofs, 4 Envelopes & Full-Height Kop Wall', () => {
  const forbiddenNameRe =
    /emirates|stade de france|at&t|marvingt|roazhon|bernab|allianz|olimpico|rome|beşiktaş|besiktas|villa park|tottenham|havre|wembley|dortmund|südtribüne|sudtribune|bordeaux|matmut|munich|maracan|francfort|amsterdam|cardiff|gelsenkirchen|mauroy/i;

  it('guarantees zero real-world stadium names in templates and supports all 11 morphologies without pitch intrusion', () => {
    ensureCanvasMock();

    for (const preset of STADIUM_PRESETS) {
      expect(forbiddenNameRe.test(preset.label)).toBe(false);
      expect(forbiddenNameRe.test(preset.subtitle)).toBe(false);
      const doc = preset.createDocument();
      expect(forbiddenNameRe.test(doc.name)).toBe(false);
    }

    const shapes = Object.keys(STADIUM_SHAPE_LABELS) as StadiumShape[];
    expect(shapes.length).toBe(12);

    const countWorldIntrusions = (docToTest: ReturnType<typeof createPresetDocument>) => {
      const bowlGroup = generateStandsGroup(docToTest, false);
      bowlGroup.updateMatrixWorld(true);

      const halfPitchX = docToTest.pitch.length / 2;
      const halfPitchZ = docToTest.pitch.width / 2;
      const vWorld = new THREE.Vector3();
      const instMat = new THREE.Matrix4();

      let intruding = 0;
      bowlGroup.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
        const pos = mesh.geometry.attributes.position;
        const instMesh = obj as THREE.InstancedMesh;

        if (instMesh.isInstancedMesh) {
          for (let inst = 0; inst < instMesh.count; inst++) {
            instMesh.getMatrixAt(inst, instMat);
            for (let i = 0; i < pos.count; i++) {
              vWorld
                .fromBufferAttribute(pos, i)
                .applyMatrix4(instMat)
                .applyMatrix4(mesh.matrixWorld);
              if (
                Math.abs(vWorld.x) < halfPitchX + 2.0 &&
                Math.abs(vWorld.z) < halfPitchZ + 2.0
              ) {
                intruding++;
              }
            }
          }
        } else {
          for (let i = 0; i < pos.count; i++) {
            vWorld.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
            if (
              Math.abs(vWorld.x) < halfPitchX + 2.0 &&
              Math.abs(vWorld.z) < halfPitchZ + 2.0
            ) {
              intruding++;
            }
          }
        }
      });
      return intruding;
    };

    // Test every single one of the 8 morphologies for 0 pitch intrusions and valid 3D geometry!
    for (const shape of shapes) {
      const doc = createPresetDocument('bowl_bowstring_60k');
      doc.shape = shape;
      if (shape === 'horseshoe') {
        doc.stands.east.enabled = false;
      }
      expect(countWorldIntrusions(doc)).toBe(0);
    }

    // Verify multi-material stepped seats are exposed on swept bowls
    const bowlDoc = createPresetDocument('bowl_bowstring_60k');
    const bowlGroup = generateStandsGroup(bowlDoc, false);
    let foundSteppedMultiMatBowl = false;
    bowlGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && Array.isArray(mesh.material) && mesh.material.length === 2) {
        const groups = mesh.geometry.groups;
        if (groups.length === 2 && groups[0].count > 0 && groups[1].count > 0) {
          foundSteppedMultiMatBowl = true;
        }
      }
    });
    expect(foundSteppedMultiMatBowl).toBe(true);
  }, FULL_SCENE_TIMEOUT_MS);

  it('builds all 15 covered structural roof typologies plus retractable closed state across bowls and discrete stands', () => {
    ensureCanvasMock();
    const styles: RoofStyle[] = [
      'column_supported',
      'cantilever',
      'goalpost_truss',
      'truss',
      'suspended_masts',
      'giant_arch',
      'bowstring_arch',
      'bicycle_wheel',
      'tensile_net',
      'enveloping_shell',
      'twin_arch',
      'vaulted_ring',
      'folded_plate',
      'retractable',
      'petal_iris',
      'corner_pylons',
      'counterweighted_cantilever',
      'spanning_girders',
      'fixed_dome',
    ];

    for (const style of styles) {
      const doc = createPresetDocument(
        style === 'truss' || style === 'column_supported' || style === 'goalpost_truss'
          ? 'traditional_four_stands_42k'
          : 'bowl_bowstring_60k'
      );
      doc.roof.style = style;
      if (style === 'retractable') {
        doc.roof.retractableClosed = true;
      }
      const roofGroup = generateRoofGroup(doc, false);
      expect(roofGroup.children.length).toBeGreaterThan(0);
      disposeObject3D(roofGroup);
    }

    // Verify horseshoe open-U roof generation
    const hsDoc = createPresetDocument('horseshoe_amphitheatre_38k');
    const hsRoof = generateRoofGroup(hsDoc, false);
    expect(hsRoof.children.length).toBeGreaterThan(0);
    expect(calculateStandMetrics(hsDoc, 'east').capacity).toBe(0);
    disposeObject3D(hsRoof);
  });

  it('supports full-height 1-tier Kop Wall matching 3-tier stands, safe-standing, telescopic modules, sunken berm, and all 4 envelopes', () => {
    ensureCanvasMock();
    const kopDoc = createPresetDocument('english_kop_wall_48k');
    const south3Tier = calculateStandMetrics(kopDoc, 'south');
    const east1TierKop = calculateStandMetrics(kopDoc, 'east');

    expect(south3Tier.tiers).toBe(3);
    expect(east1TierKop.tiers).toBe(1);
    // 1-tier Kop Wall reaches the exact same architectural crest height as the 3-tier Main Stand!
    expect(Math.abs(east1TierKop.maxHeight - south3Tier.maxHeight)).toBeLessThan(0.5);

    // Safe standing boosts spectator density vs seated on identical geometry
    const seatedClone = createPresetDocument('english_kop_wall_48k');
    seatedClone.stands.east.seatingType = 'seated';
    expect(east1TierKop.capacity).toBeGreaterThan(
      calculateStandMetrics(seatedClone, 'east').capacity
    );

    // Dynamic computeKopWallStandPatch aligns any stand to the stadium's tallest multi-tier stand
    const bowlDoc = createPresetDocument('urban_cathedral_84k');
    const targetH = calculateStandMetrics(bowlDoc, 'south').maxHeight;
    bowlDoc.stands.east = {
      ...bowlDoc.stands.east,
      ...computeKopWallStandPatch(bowlDoc, 'east', 'safe_standing'),
    };
    const alignedKop = calculateStandMetrics(bowlDoc, 'east');
    expect(alignedKop.tiers).toBe(1);
    expect(Math.abs(alignedKop.maxHeight - targetH)).toBeLessThan(0.6);

    // Column-supported roof applies sightline obstruction penalty on upper rows
    const colSight = computeStandSightlines(kopDoc.stands.west, 0, 'column_supported');
    const clearSight = computeStandSightlines(kopDoc.stands.west, 0, 'cantilever');
    expect(colSight.avgCValueMm).toBeLessThan(clearSight.avgCValueMm);

    // All 4 envelope styles + sunken amphitheatre + telescopic stands generate valid 3D geometry with 0 pitch intrusions
    const envelopes: EnvelopeStyle[] = [
      'exposed_structure',
      'enveloping_skin',
      'colonnade_forest',
      'louver_curtain',
    ];
    for (const env of envelopes) {
      const envDoc = createPresetDocument('sunken_colonnade_44k');
      envDoc.materials = { ...envDoc.materials!, envelopeStyle: env };
      const standsGrp = generateStandsGroup(envDoc, false);
      expect(standsGrp.children.length).toBeGreaterThan(0);
      disposeObject3D(standsGrp);
    }

    const domeDoc = createPresetDocument('climatic_dome_72k');
    const domeStands = generateStandsGroup(domeDoc, false);
    domeStands.updateMatrixWorld(true);
    let domeIntrusions = 0;
    const vW = new THREE.Vector3();
    domeStands.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
      const pos = mesh.geometry.attributes.position;
      // Instanced meshes (seats) are checked at every instance, not at their template origin.
      const instanced = obj as THREE.InstancedMesh;
      const instanceMatrices: THREE.Matrix4[] = instanced.isInstancedMesh
        ? Array.from({ length: instanced.count }, (_, k) => {
            const m = new THREE.Matrix4();
            instanced.getMatrixAt(k, m);
            return m.premultiply(mesh.matrixWorld);
          })
        : [mesh.matrixWorld];
      for (const m of instanceMatrices) {
        for (let i = 0; i < pos.count; i++) {
          vW.fromBufferAttribute(pos, i).applyMatrix4(m);
          if (Math.abs(vW.x) < 54.5 && Math.abs(vW.z) < 36.0) {
            domeIntrusions++;
          }
        }
      }
    });
    expect(domeIntrusions).toBe(0);
    disposeObject3D(domeStands);
  });

  it('calibrates realistic capacities across all 14 generic architectural templates', () => {
    expect(STADIUM_PRESETS.length).toBe(16);

    const getCap = (id: string) =>
      calculateStadiumMetrics(createPresetDocument(id)).totalCapacity;

    expect(getCap('octagonal_cantilever_26k')).toBeGreaterThan(22000);
    expect(getCap('octagonal_cantilever_26k')).toBeLessThan(31000);

    expect(getCap('asymmetric_modular_30k')).toBeGreaterThan(26000);
    expect(getCap('asymmetric_modular_30k')).toBeLessThan(35000);

    expect(getCap('horseshoe_amphitheatre_38k')).toBeGreaterThan(31000);
    expect(getCap('horseshoe_amphitheatre_38k')).toBeLessThan(45000);

    expect(getCap('traditional_four_stands_42k')).toBeGreaterThan(38000);
    expect(getCap('traditional_four_stands_42k')).toBeLessThan(48000);

    expect(getCap('bowl_bowstring_60k')).toBeGreaterThan(56000);
    expect(getCap('bowl_bowstring_60k')).toBeLessThan(67000);

    expect(getCap('olympic_masts_80k')).toBeGreaterThan(75000);
    expect(getCap('olympic_masts_80k')).toBeLessThan(90000);

    expect(getCap('urban_cathedral_84k')).toBeGreaterThan(78000);
    expect(getCap('urban_cathedral_84k')).toBeLessThan(92000);

    expect(getCap('mega_retractable_88k')).toBeGreaterThan(80000);
    expect(getCap('mega_retractable_88k')).toBeLessThan(98000);
  });

  it('supports 1 to 5 tiers, FIFA C-values, and distinct four_stands vs compact_urban geometry', () => {
    ensureCanvasMock();
    expect(computeRowCValueMm(20, 6.0, 0.48, 0.8)).toBeGreaterThan(
      computeRowCValueMm(20, 6.0, 0.28, 0.85)
    );

    const doc = createPresetDocument('traditional_four_stands_42k');
    doc.stands.south.tiers = 5;
    doc.stands.south.rows = 76;
    doc.stands.south.slopeAngleDeg = 35;
    doc.stands.south.riserHeight = riserFromSlopeDeg(35, doc.stands.south.rowDepth);

    const metrics = calculateStandMetrics(doc, 'south');
    expect(metrics.tiers).toBe(5);
    expect(metrics.slopeDegrees).toBe(35);

    const sightlines = computeStandSightlines(doc.stands.south, 0);
    expect(Math.max(...sightlines.points.map((p) => p.tier))).toBe(5);

    const fourStandsGroup = generateStandsGroup(
      createPresetDocument('traditional_four_stands_42k'),
      false
    );
    const urbanGroup = generateStandsGroup(
      createPresetDocument('urban_cathedral_84k'),
      false
    );
    expect(fourStandsGroup.children.length).toBe(4);
    expect(urbanGroup.children.length).toBe(8);
  });

  it('generates full PBR normalMap and roughnessMap across all facade, roof, structure, seat, turf, track, and plaza catalogs', () => {
    ensureCanvasMock();
    const allCatalogEntries = [
      ...ENVELOPE_STYLE_CATALOG,
      ...FACADE_MATERIAL_CATALOG,
      ...ROOF_MATERIAL_CATALOG,
      ...STRUCTURE_MATERIAL_CATALOG,
      ...SEAT_MATERIAL_CATALOG,
      ...TURF_MATERIAL_CATALOG,
      ...TRACK_MATERIAL_CATALOG,
      ...PLAZA_MATERIAL_CATALOG,
    ];
    for (const item of allCatalogEntries) {
      expect(forbiddenNameRe.test(item.label)).toBe(false);
      expect(forbiddenNameRe.test(item.subtitle)).toBe(false);
    }

    for (const f of FACADE_MATERIAL_CATALOG) {
      const mat = createFacadePbrMaterial(f.id, 'night', false, 4);
      expect(mat.map).toBeTruthy();
      expect(mat.normalMap).toBeTruthy();
      expect(mat.roughnessMap).toBeTruthy();
      disposeObject3D(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));
    }

    for (const r of ROOF_MATERIAL_CATALOG) {
      const mat = createRoofPbrMaterial(r.id, 0.9, 'night', false, 4);
      expect(mat.map).toBeTruthy();
      expect(mat.normalMap).toBeTruthy();
      expect(mat.roughnessMap).toBeTruthy();
      disposeObject3D(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));
    }

    for (const s of STRUCTURE_MATERIAL_CATALOG) {
      const mat = createStructurePbrMaterial(s.id, 4);
      expect(mat.map).toBeTruthy();
      expect(mat.normalMap).toBeTruthy();
      expect(mat.roughnessMap).toBeTruthy();
      disposeObject3D(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));
    }

    for (const seat of SEAT_MATERIAL_CATALOG) {
      const mat = createSeatTerracePbrMaterial(seat.id, '#dc2626', '#f8fafc', 8, 4, true);
      expect(mat.map).toBeTruthy();
      expect(mat.normalMap).toBeTruthy();
      expect(mat.roughnessMap).toBeTruthy();
      disposeObject3D(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));
    }

    for (const tr of TRACK_MATERIAL_CATALOG) {
      const mat = createTrackPbrMaterial(tr.id, 4);
      expect(mat.map).toBeTruthy();
      expect(mat.normalMap).toBeTruthy();
      expect(mat.roughnessMap).toBeTruthy();
      disposeObject3D(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));
    }

    // Build and cleanly dispose full stadium scene graphs across multiple PBR presets
    for (const preset of STADIUM_PRESETS) {
      const doc = preset.createDocument();
      expect(doc.materials).toBeDefined();
      const { rootGroup } = buildStadiumSceneGraph(doc, {
        selectedObjectId: null,
        crossSectionClip: false,
        maxAnisotropy: 4,
      });
      expect(rootGroup.children.length).toBeGreaterThanOrEqual(3);
      disposeObject3D(rootGroup);
    }
  }, FULL_SCENE_TIMEOUT_MS);

  it('builds upward-facing stepped 3D corner seating bowls and matching corner roofs for compact_urban and english_rectangular', () => {
    ensureCanvasMock();

    const shapesToVerify: StadiumShape[] = ['compact_urban', 'english_rectangular'];

    for (const shape of shapesToVerify) {
      const doc = createPresetDocument(
        shape === 'compact_urban' ? 'urban_cathedral_84k' : 'asymmetric_modular_30k'
      );
      doc.shape = shape;
      doc.cornerFill = true;
      doc.sunkenDepth = 0;
      doc.roof.style = 'cantilever';

      // Stress-test C1 Hermite lofting across asymmetric stands (3-tier South meeting 1-tier Kop East)
      doc.stands.south.tiers = 3;
      doc.stands.south.rows = 46;
      doc.stands.east = {
        ...doc.stands.east,
        ...computeKopWallStandPatch(doc, 'east'),
      };

      const standsGroup = generateStandsGroup(doc, false, 4);
      const cornerIds = ['CornerVirage_SE', 'CornerVirage_SW', 'CornerVirage_NW', 'CornerVirage_NE'];

      for (const cid of cornerIds) {
        const cornerGroup = standsGroup.getObjectByName(cid) as THREE.Group | undefined;
        expect(cornerGroup).toBeDefined();

        // Find the multi-material stepped corner bowl mesh ([concreteMat, seatMat])
        let cornerBowlMesh: THREE.Mesh | null = null;
        let instancedBackrests = 0;

        cornerGroup!.traverse((child) => {
          if (child instanceof THREE.InstancedMesh) {
            instancedBackrests += child.count;
          } else if (child instanceof THREE.Mesh && Array.isArray(child.material)) {
            cornerBowlMesh = child;
          }
        });

        expect(cornerBowlMesh).not.toBeNull();
        expect(instancedBackrests).toBeGreaterThan(20);

        const geom = (cornerBowlMesh as unknown as THREE.Mesh).geometry;
        const pos = geom.getAttribute('position') as THREE.BufferAttribute;
        const nrm = geom.getAttribute('normal') as THREE.BufferAttribute;
        const idx = geom.getIndex()!;
        const seatGroup = geom.groups.find((g) => g.materialIndex === 1);
        expect(seatGroup).toBeDefined();
        expect(seatGroup!.count).toBeGreaterThan(60);

        // Verify seat-group triangles face UPWARD (+Y > 0.35) and TOWARD THE PITCH, never inverted (-Y)
        let avgSeatNormalY = 0;
        let inwardDotSum = 0;
        const triCount = seatGroup!.count / 3;
        for (let t = 0; t < triCount; t++) {
          const ia = idx.getX(seatGroup!.start + t * 3);
          const ib = idx.getX(seatGroup!.start + t * 3 + 1);
          const ic = idx.getX(seatGroup!.start + t * 3 + 2);

          const ny = (nrm.getY(ia) + nrm.getY(ib) + nrm.getY(ic)) / 3;
          const nx = (nrm.getX(ia) + nrm.getX(ib) + nrm.getX(ic)) / 3;
          const nz = (nrm.getZ(ia) + nrm.getZ(ib) + nrm.getZ(ic)) / 3;
          const cx = (pos.getX(ia) + pos.getX(ib) + pos.getX(ic)) / 3;
          const cz = (pos.getZ(ia) + pos.getZ(ib) + pos.getZ(ic)) / 3;

          avgSeatNormalY += ny;
          // Vector from corner vertex toward pitch center (0,0) has sign (-cx, -cz)
          inwardDotSum += nx * -cx + nz * -cz;

          // Zero intrusion onto the 105x68m playing field
          expect(Math.abs(cx) < 52.0 && Math.abs(cz) < 33.5).toBe(false);
        }
        avgSeatNormalY /= triCount;
        expect(avgSeatNormalY).toBeGreaterThan(0.45);
        expect(inwardDotSum).toBeGreaterThan(0);
      }

      // Verify stand-by-stand discrete roof includes 4 matching CornerRoof hip canopies
      const roofGroup = generateRoofGroup(doc, false, 4);
      expect(roofGroup.getObjectByName('CornerRoof_SE')).toBeDefined();
      expect(roofGroup.getObjectByName('CornerRoof_SW')).toBeDefined();
      expect(roofGroup.getObjectByName('CornerRoof_NW')).toBeDefined();
      expect(roofGroup.getObjectByName('CornerRoof_NE')).toBeDefined();

      disposeObject3D(standsGroup);
      disposeObject3D(roofGroup);
    }
  });

  it('guarantees PitchTurf is unobstructed with zero overlapping dark ground/apron planes across all 14 presets', () => {
    ensureCanvasMock();
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const samplePoints: [number, number][] = [
      [0, 0],
      [-35, -20],
      [35, 20],
      [-35, 20],
      [35, -20],
      [0, -28],
      [0, 28],
      [-45, 0],
      [45, 0],
    ];

    for (const preset of STADIUM_PRESETS) {
      const doc = preset.createDocument();
      const { rootGroup } = buildStadiumSceneGraph(doc, {
        selectedObjectId: null,
        crossSectionClip: false,
        maxAnisotropy: 4,
      });
      rootGroup.updateMatrixWorld(true);

      // Verify no ground/apron material uses negative polygonOffsetFactor that could bleed over the turf
      rootGroup.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (m.polygonOffset) {
            expect(m.polygonOffsetFactor).toBeGreaterThanOrEqual(0);
          }
        }
      });

      // Cast vertical rays from Y = 10m straight down through Y = -5m across 9 field coordinates:
      // ONLY `PitchTurf` may exist in that column — zero `TechnicalPitApron`, `SiteSurroundGround`, or `ExteriorContactShadow`!
      for (const [px, pz] of samplePoints) {
        raycaster.set(new THREE.Vector3(px, 10, pz), down);
        raycaster.near = 0.1;
        raycaster.far = 15;
        const hits = raycaster.intersectObject(rootGroup, true);
        expect(hits.length).toBeGreaterThanOrEqual(1);
        for (const h of hits) {
          expect(
            h.object.name,
            `Unexpected mesh "${h.object.name}" (parent="${h.object.parent?.name}") at (${px}, ${h.point.y.toFixed(3)}, ${pz}) in preset "${preset.id}"`
          ).toBe('PitchTurf');
          const hitNormalY = h.face?.normal.y ?? 0;
          expect(hitNormalY).toBeGreaterThan(0.95);
        }
      }

      disposeObject3D(rootGroup);
    }
  }, FULL_SCENE_TIMEOUT_MS);

  it('carves real 3D vomitory openings and stepped radial stair aisles with adjustable count and position', () => {
    ensureCanvasMock();
    const docZero = createPresetDocument('traditional_four_stands_42k');
    docZero.stands.south.vomitoryCount = 0;
    docZero.stands.south.aisleCount = 4;
    docZero.stands.south.aisleWidth = 1.4;

    const docCarved = createPresetDocument('traditional_four_stands_42k');
    docCarved.stands.south.vomitoryCount = 6;
    docCarved.stands.south.vomitoryRowRatio = 0.55;
    docCarved.stands.south.vomitoryOffsetRatio = 0.08;
    docCarved.stands.south.aisleCount = 4;
    docCarved.stands.south.aisleWidth = 1.4;

    const docMoreStairs = createPresetDocument('traditional_four_stands_42k');
    docMoreStairs.stands.south.vomitoryCount = 6;
    docMoreStairs.stands.south.aisleCount = 8;
    docMoreStairs.stands.south.aisleWidth = 1.8;

    const grpZero = generateStandsGroup(docZero, false);
    const grpCarved = generateStandsGroup(docCarved, false);
    const grpMoreStairs = generateStandsGroup(docMoreStairs, false);

    const southZero = grpZero.getObjectByName('Stand_SOUTH')!;
    const southCarved = grpCarved.getObjectByName('Stand_SOUTH')!;
    const southMoreStairs = grpMoreStairs.getObjectByName('Stand_SOUTH')!;

    const countMeshStats = (root: THREE.Object3D) => {
      let terraceIndices = 0;
      let terraceVerts = 0;
      let seatInstances = 0;
      let portals = 0;
      let stairSteps = 0;
      root.traverse((obj) => {
        if (obj.name === 'VomitoryOpeningPortal') portals++;
        const inst = obj as THREE.InstancedMesh;
        if (inst.isInstancedMesh) {
          if (obj.name === 'RadialStairSteps') {
            stairSteps += inst.count;
          } else {
            seatInstances += inst.count;
          }
        } else {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh && Array.isArray(mesh.material) && mesh.geometry.index) {
            terraceIndices += mesh.geometry.index.count;
            terraceVerts += mesh.geometry.attributes.position.count;
          }
        }
      });
      return { terraceIndices, terraceVerts, seatInstances, portals, stairSteps };
    };

    const statsZero = countMeshStats(southZero);
    const statsCarved = countMeshStats(southCarved);
    const statsMoreStairs = countMeshStats(southMoreStairs);

    // Straight stand subdivides into longitudinal bays at each vomitory cheek and omits hole triangles & 3D seats
    const singleBayVerts = statsZero.terraceVerts / 2;
    const carvedBayCount = Math.round(statsCarved.terraceVerts / singleBayVerts) - 1;
    expect(statsZero.portals).toBe(0);
    expect(statsCarved.portals).toBeGreaterThanOrEqual(6);
    expect(statsCarved.terraceIndices).toBeLessThan(carvedBayCount * statsZero.terraceIndices);
    expect(statsCarved.seatInstances).toBeLessThan(statsZero.seatInstances);
    expect(statsMoreStairs.stairSteps).toBeGreaterThan(statsCarved.stairSteps);

    // On a fixed-segment continuous bowl, carving vomitories strictly reduces total terrace indices & seats
    const bowlZero = createPresetDocument('bowl_bowstring_60k');
    const bowlCarved = createPresetDocument('bowl_bowstring_60k');
    for (const side of ['north', 'south', 'east', 'west'] as const) {
      bowlZero.stands[side].vomitoryCount = 0;
      bowlCarved.stands[side].vomitoryCount = 6;
    }
    const bowlGrpZero = generateStandsGroup(bowlZero, false);
    const bowlGrpCarved = generateStandsGroup(bowlCarved, false);
    const bowlStatsZero = countMeshStats(bowlGrpZero);
    const bowlStatsCarved = countMeshStats(bowlGrpCarved);
    expect(bowlStatsCarved.portals).toBeGreaterThanOrEqual(16);
    expect(bowlStatsCarved.terraceIndices).toBeLessThan(bowlStatsZero.terraceIndices);
    expect(bowlStatsCarved.seatInstances).toBeLessThan(bowlStatsZero.seatInstances);

    disposeObject3D(grpZero);
    disposeObject3D(grpCarved);
    disposeObject3D(grpMoreStairs);
    disposeObject3D(bowlGrpZero);
    disposeObject3D(bowlGrpCarved);
  });

  it('models cantilevered upper tiers (tribunes en encorbellement) and updates C-value sightlines & distance to pitch', () => {
    const shallowDoc = createPresetDocument('traditional_four_stands_42k');
    shallowDoc.stands.south.tiers = 3;
    shallowDoc.stands.south.tierOverhang = 0.5;

    const deepCantileverDoc = createPresetDocument('traditional_four_stands_42k');
    deepCantileverDoc.stands.south.tiers = 3;
    deepCantileverDoc.stands.south.tierOverhang = 5.8;

    const sightShallow = computeStandSightlines(shallowDoc.stands.south, 0);
    const sightDeep = computeStandSightlines(deepCantileverDoc.stands.south, 0);

    // Deeper cantilever overhang brings upper spectators significantly closer to the touchline
    expect(sightDeep.avgDistanceM).toBeLessThan(sightShallow.avgDistanceM - 1.5);
    expect(sightDeep.avgCValueMm).not.toBe(sightShallow.avgCValueMm);

    const metricsShallow = calculateStandMetrics(shallowDoc, 'south');
    const metricsDeep = calculateStandMetrics(deepCantileverDoc, 'south');
    expect(metricsDeep.totalDepth).toBeLessThan(metricsShallow.totalDepth - 6.0);
  });

  it('supports asymmetric per-tier grading (rows, slope angle, and overhang per level)', () => {
    ensureCanvasMock();
    const doc = createPresetDocument('traditional_four_stands_42k');
    doc.stands.south.tiers = 3;
    doc.stands.south.tierConfigs = [
      { rows: 14, slopeAngleDeg: 22 },
      { rows: 18, slopeAngleDeg: 31, overhang: 3.8 },
      { rows: 24, slopeAngleDeg: 37, overhang: 5.2 },
    ];

    const resolved = resolveStandTiers(doc.stands.south);
    expect(resolved.length).toBe(3);
    expect(resolved[0].rows).toBe(14);
    expect(resolved[0].slopeAngleDeg).toBe(22);
    expect(resolved[1].rows).toBe(18);
    expect(resolved[1].overhang).toBe(3.8);
    expect(resolved[2].rows).toBe(24);
    expect(resolved[2].slopeAngleDeg).toBe(37);
    expect(resolved[2].overhang).toBe(5.2);

    const metrics = calculateStandMetrics(doc, 'south');
    expect(metrics.totalRows).toBe(56);

    const sight = computeStandSightlines(doc.stands.south, 0);
    expect(sight.points.length).toBe(56);

    const standsGrp = generateStandsGroup(doc, false);
    expect(standsGrp.getObjectByName('Stand_SOUTH')).toBeDefined();
    disposeObject3D(standsGrp);
  });

  it('supports custom per-corner modes (open, filled, building, screen) on both rectangular and continuous bowls with zero pitch intrusions', () => {
    ensureCanvasMock();
    const rectDoc = createPresetDocument('urban_cathedral_84k');
    rectDoc.shape = 'compact_urban';
    rectDoc.corners = {
      nw: 'open',
      ne: 'filled',
      sw: 'building',
      se: 'screen',
    };

    const rectStands = generateStandsGroup(rectDoc, false);
    rectStands.updateMatrixWorld(true);

    expect(rectStands.getObjectByName('CornerVirage_NW')).toBeUndefined();
    expect(rectStands.getObjectByName('CornerBuilding_NW')).toBeUndefined();
    expect(rectStands.getObjectByName('CornerScreen_NW')).toBeUndefined();

    expect(rectStands.getObjectByName('CornerVirage_NE')).toBeDefined();
    expect(rectStands.getObjectByName('CornerBuilding_SW')).toBeDefined();
    expect(rectStands.getObjectByName('CornerScreen_SE')).toBeDefined();

    // Verify discrete roof covers filled & building corners while leaving open & screen corners clear
    rectDoc.roof.style = 'cantilever';
    const rectRoof = generateRoofGroup(rectDoc, false);
    expect(rectRoof.getObjectByName('CornerRoof_NE')).toBeDefined();
    expect(rectRoof.getObjectByName('CornerRoof_SW')).toBeDefined();
    expect(rectRoof.getObjectByName('CornerRoof_NW')).toBeUndefined();
    expect(rectRoof.getObjectByName('CornerRoof_SE')).toBeUndefined();

    // Zero pitch intrusion check on custom corners
    const halfX = rectDoc.pitch.length / 2;
    const halfZ = rectDoc.pitch.width / 2;
    const vW = new THREE.Vector3();
    let intruding = 0;
    rectStands.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
      const pos = mesh.geometry.attributes.position;
      const inst = obj as THREE.InstancedMesh;
      if (inst.isInstancedMesh) {
        const m = new THREE.Matrix4();
        for (let k = 0; k < inst.count; k++) {
          inst.getMatrixAt(k, m);
          for (let i = 0; i < pos.count; i++) {
            vW.fromBufferAttribute(pos, i).applyMatrix4(m).applyMatrix4(mesh.matrixWorld);
            if (Math.abs(vW.x) < halfX + 2.0 && Math.abs(vW.z) < halfZ + 2.0) intruding++;
          }
        }
      } else {
        for (let i = 0; i < pos.count; i++) {
          vW.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
          if (Math.abs(vW.x) < halfX + 2.0 && Math.abs(vW.z) < halfZ + 2.0) intruding++;
        }
      }
    });
    expect(intruding).toBe(0);

    // Continuous bowl also supports per-corner open/building/screen sector cutouts & inserts
    const bowlDoc = createPresetDocument('bowl_bowstring_60k');
    bowlDoc.corners = { nw: 'open', ne: 'filled', sw: 'building', se: 'screen' };
    const bowlStands = generateStandsGroup(bowlDoc, false);
    expect(bowlStands.getObjectByName('CornerBuilding_SW')).toBeDefined();
    expect(bowlStands.getObjectByName('CornerScreen_SE')).toBeDefined();

    disposeObject3D(rectStands);
    disposeObject3D(rectRoof);
    disposeObject3D(bowlStands);
  });

  it('modulates roof shadow depth alphaMap with roof translucency (ETFE/glass) and skylight openings', () => {
    ensureCanvasMock();
    const countOpaqueShadowTexels = (depthMat: THREE.MeshDepthMaterial): number => {
      const alphaMap = depthMat.alphaMap as THREE.DataTexture;
      expect(alphaMap).toBeDefined();
      const data = alphaMap.image.data as Uint8Array;
      let solid = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 1] >= 128) solid++;
      }
      return solid;
    };

    const opaqueMetalShadow = createRoofShadowDepthMaterial(
      'standing_seam_zinc',
      0.98,
      'none',
      0
    );
    const translucentEtfeShadow = createRoofShadowDepthMaterial(
      'etfe_cushions',
      0.35,
      'none',
      0
    );
    const skylightEtfeShadow = createRoofShadowDepthMaterial(
      'etfe_cushions',
      0.35,
      'radial_slots',
      0.48
    );

    const solidMetal = countOpaqueShadowTexels(opaqueMetalShadow);
    const solidEtfe = countOpaqueShadowTexels(translucentEtfeShadow);
    const solidSkylight = countOpaqueShadowTexels(skylightEtfeShadow);

    expect(solidEtfe).toBeLessThan(solidMetal * 0.45);
    expect(solidSkylight).toBeLessThan(solidEtfe * 0.75);

    // Verify generated 3D roof meshes attach `customDepthMaterial`
    const doc = createPresetDocument('bowl_bowstring_60k');
    doc.materials = { ...doc.materials!, roof: 'polycarbonate_glass' };
    doc.roof.opacity = 0.32;
    doc.roof.skylightMode = 'grid_oculi';
    doc.roof.skylightRatio = 0.42;

    const roofGrp = generateRoofGroup(doc, false);
    let customDepthCount = 0;
    roofGrp.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.customDepthMaterial instanceof THREE.MeshDepthMaterial) {
        customDepthCount++;
      }
    });
    expect(customDepthCount).toBeGreaterThan(0);

    disposeObject3D(roofGrp);
    opaqueMetalShadow.alphaMap?.dispose();
    opaqueMetalShadow.dispose();
    translucentEtfeShadow.alphaMap?.dispose();
    translucentEtfeShadow.dispose();
    skylightEtfeShadow.alphaMap?.dispose();
    skylightEtfeShadow.dispose();
  });

  it('generates 3D parametric facade relief (vertical_fins, diagrid, cassette_panels) scaling with density and depth', () => {
    ensureCanvasMock();
    for (const item of [
      ...FACADE_PATTERN_CATALOG,
      ...SKYLIGHT_MODE_CATALOG,
      ...CORNER_MODE_CATALOG,
      ...FLOODLIGHT_RIG_CATALOG,
    ]) {
      expect(forbiddenNameRe.test(item.label)).toBe(false);
      expect(forbiddenNameRe.test(item.subtitle)).toBe(false);
    }

    const countFacadeInstances = (
      pattern: 'vertical_fins' | 'diagrid' | 'cassette_panels',
      density: number,
      depth: number
    ) => {
      const doc = createPresetDocument('bowl_bowstring_60k');
      doc.concourse = { width: 14, heightRatio: 0.9 };
      doc.materials = {
        ...doc.materials!,
        facadePattern: pattern,
        facadeDensity: density,
        facadeDepth: depth,
      };
      const concourseGrp = generateConcourseGroup(doc, false, 4);
      let instances = 0;
      concourseGrp.traverse((obj) => {
        if (
          (obj.parent?.name === 'ConcourseParametricFacade' ||
            obj.parent?.name === 'ParametricFacadeRelief') &&
          obj instanceof THREE.InstancedMesh
        ) {
          instances += obj.count;
        }
      });
      disposeObject3D(concourseGrp);
      return instances;
    };

    const lowFins = countFacadeInstances('vertical_fins', 0.5, 0.4);
    const highFins = countFacadeInstances('vertical_fins', 1.8, 1.4);
    expect(lowFins).toBeGreaterThan(20);
    expect(highFins).toBeGreaterThan(lowFins * 2);

    expect(countFacadeInstances('diagrid', 1.1, 0.9)).toBeGreaterThan(40);
    expect(countFacadeInstances('cassette_panels', 1.1, 0.7)).toBeGreaterThan(40);
  });

  it('switches cleanly between 4 corner floodlight masts and roof-edge projector gantry', () => {
    ensureCanvasMock();
    const doc = createPresetDocument('traditional_four_stands_42k');
    doc.lighting = 'night';

    // 1. `corner_masts`: 4 corner pylons, 0 roof gantry projectors
    doc.floodlightRig = 'corner_masts';
    const mastsGrp = generateFloodlightRigGroup(doc);
    const roofNoGantry = generateRoofGroup(doc, false);
    expect(mastsGrp.getObjectByName('CornerFloodlightMast_SE')).toBeDefined();
    expect(mastsGrp.getObjectByName('CornerFloodlightMast_SW')).toBeDefined();
    expect(mastsGrp.getObjectByName('CornerFloodlightMast_NW')).toBeDefined();
    expect(mastsGrp.getObjectByName('CornerFloodlightMast_NE')).toBeDefined();
    expect(roofNoGantry.getObjectByName('RoofFloodlightCatwalk')).toBeUndefined();

    // 2. `roof_gantry`: 0 corner pylons, active roof gantry projectors
    doc.floodlightRig = 'roof_gantry';
    const emptyMasts = generateFloodlightRigGroup(doc);
    const roofWithGantry = generateRoofGroup(doc, false);
    expect(emptyMasts.children.length).toBe(0);
    expect(roofWithGantry.getObjectByName('RoofFloodlightCatwalk')).toBeDefined();

    // 3. `both`: both corner pylons AND roof gantry projectors
    doc.floodlightRig = 'both';
    const bothMasts = generateFloodlightRigGroup(doc);
    const bothRoof = generateRoofGroup(doc, false);
    expect(bothMasts.children.length).toBe(4);
    expect(bothRoof.getObjectByName('RoofFloodlightCatwalk')).toBeDefined();

    disposeObject3D(mastsGrp);
    disposeObject3D(roofNoGantry);
    disposeObject3D(emptyMasts);
    disposeObject3D(roofWithGantry);
    disposeObject3D(bothMasts);
    disposeObject3D(bothRoof);
  });

  it('enforces official World Athletics 400 m track dimensions (84.39 m straights, 36.50 m kerb, 1.22 m lanes)', () => {
    const track = getTrackGeometry(8);
    expect(track.straightLength).toBe(84.39);
    expect(track.straightHalfLength).toBeCloseTo(42.195, 4);
    expect(track.innerRadius).toBe(36.5);
    expect(track.laneWidth).toBe(1.22);
    expect(TRACK_STRAIGHT_LENGTH_M).toBe(84.39);
    expect(TRACK_KERB_RADIUS_M).toBe(36.5);
    expect(TRACK_LANE_WIDTH_M).toBe(1.22);
    expect(TRACK_LANE1_MEASUREMENT_OFFSET_M).toBe(0.3);

    // Lane 1 measured 30 cm outside the kerb equals 400.001 m (official 400 m lap)
    expect(track.innerRadius + TRACK_LANE1_MEASUREMENT_OFFSET_M).toBeCloseTo(36.8, 4);
    expect(track.lane1Length).toBeGreaterThan(399.99);
    expect(track.lane1Length).toBeLessThan(400.01);

    // 8 lanes: running width = 9.76 m, outer running line = 46.26 m, outer apron edge = 47.76 m
    expect(track.lanesWidth).toBeCloseTo(9.76, 4);
    expect(track.innerRadius + track.lanesWidth).toBeCloseTo(46.26, 4);
    expect(track.outerRadius).toBeCloseTo(47.76, 4);
  });

  it('keeps FIFA 105x68 pitch unchanged inside the 400 m track, clamps oversized pitches, and normalizes saved projects', () => {
    // Standard 105 x 68 m pitch passes without any modification
    const fifa = clampPitchToTrack({
      length: 105,
      width: 68,
      marginSide: 5.5,
      marginEnd: 6.5,
      hasTrack: true,
      trackLanes: 8,
      grassPattern: 'stripes',
      adBoards: true,
    });
    expect(fifa.length).toBe(105);
    expect(fifa.width).toBe(68);
    // Verify 105 x 68 corner stays inside the 36.5 m kerb!
    const dxFifa = Math.max(0, fifa.length * 0.5 - TRACK_STRAIGHT_LENGTH_M * 0.5);
    expect(Math.hypot(dxFifa, fifa.width * 0.5)).toBeLessThan(TRACK_KERB_RADIUS_M);

    // Oversized 115 x 75 m pitch with track enabled is clamped to max 70 m width and inside kerb
    const oversized = clampPitchToTrack({
      ...fifa,
      length: 115,
      width: 75,
      hasTrack: true,
    });
    expect(oversized.width).toBe(TRACK_MAX_PITCH_WIDTH_M);
    expect(oversized.length).toBeLessThanOrEqual(getMaxPitchLengthForTrack(oversized.width));
    const dxClamped = Math.max(0, oversized.length * 0.5 - TRACK_STRAIGHT_LENGTH_M * 0.5);
    expect(Math.hypot(dxClamped, oversized.width * 0.5)).toBeLessThan(TRACK_KERB_RADIUS_M);

    // Saved projects with oversized pitch + track are normalized on open
    const legacySaved = createPresetDocument('olympic_masts_80k');
    legacySaved.pitch.length = 114;
    legacySaved.pitch.width = 74;
    delete legacySaved.roof.overConcourse;
    const normalized = normalizeStadiumDocument(legacySaved);
    expect(normalized.pitch.width).toBeLessThanOrEqual(70);
    const dxNorm = Math.max(0, normalized.pitch.length * 0.5 - TRACK_STRAIGHT_LENGTH_M * 0.5);
    expect(Math.hypot(dxNorm, normalized.pitch.width * 0.5)).toBeLessThan(TRACK_KERB_RADIUS_M);
    expect(normalized.roof.overConcourse).toBe(true);
  });

  it('prevents stands from overlapping the 400 m track and applies distinct touchline vs curve sightline offsets', () => {
    ensureCanvasMock();
    const oly = createPresetDocument('olympic_masts_80k');
    const track = getTrackGeometry(oly.pitch);
    const offsets = getTrackRadialOffset(oly);

    // Goal-end curves sit much farther from the pitch goal line than touchline stands
    expect(offsets.endOffset).toBeGreaterThan(offsets.sideOffset + 20);
    expect(oly.pitch.width * 0.5 + offsets.sideOffset).toBeCloseTo(track.outerHalfWidthZ, 3);
    expect(oly.pitch.length * 0.5 + offsets.endOffset).toBeCloseTo(track.outerHalfLengthX, 3);

    const sideSight = computeStandSightlines(oly.stands.south, offsets.sideOffset, 'suspended_masts');
    const curveSight = computeStandSightlines(oly.stands.east, offsets.endOffset, 'suspended_masts');
    expect(curveSight.avgDistanceM).toBeGreaterThan(sideSight.avgDistanceM + 20);

    // Verify 3D stands vertices never encroach inside the outer running lane (R = 46.26 m)
    for (const shape of ['olympic_oval', 'modern_bowl', 'octagonal_arena', 'four_stands'] as StadiumShape[]) {
      const doc = createPresetDocument('olympic_masts_80k');
      doc.shape = shape;
      doc.pitch.hasTrack = true;
      const standsGrp = generateStandsGroup(doc, false);
      standsGrp.updateMatrixWorld(true);

      let minTrackClearance = Infinity;
      const v = new THREE.Vector3();
      standsGrp.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const pos = obj.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
        if (!pos) return;
        const count = obj instanceof THREE.InstancedMesh ? obj.count : 1;
        const m = new THREE.Matrix4();
        for (let inst = 0; inst < count; inst++) {
          if (obj instanceof THREE.InstancedMesh) obj.getMatrixAt(inst, m);
          for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 64))) {
            v.fromBufferAttribute(pos, i);
            if (obj instanceof THREE.InstancedMesh) v.applyMatrix4(m);
            v.applyMatrix4(obj.matrixWorld);
            if (v.y < 0.05) continue;
            const dx = Math.max(0, Math.abs(v.x) - track.straightHalfLength);
            const radialFromCentre = Math.hypot(dx, v.z);
            minTrackClearance = Math.min(minTrackClearance, radialFromCentre - track.outerRadius);
          }
        }
      });

      expect(
        minTrackClearance,
        `Stand intruded onto 400 m track in shape "${shape}"`
      ).toBeGreaterThan(1.0);
      disposeObject3D(standsGrp);
    }
  });

  it('extends all roof outer edges to the concourse facade when overConcourse is enabled (default)', () => {
    ensureCanvasMock();

    const measureCanopyOuterExtent = (grp: THREE.Object3D): number => {
      grp.updateMatrixWorld(true);
      let maxExtent = 0;
      const v = new THREE.Vector3();
      const m = new THREE.Matrix4();
      grp.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh) || obj.name !== 'RoofCanopySurface') return;
        const pos = obj.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
        if (!pos) return;
        const isInst = obj instanceof THREE.InstancedMesh;
        const instCount = isInst ? obj.count : 1;
        for (let inst = 0; inst < instCount; inst++) {
          if (isInst) obj.getMatrixAt(inst, m);
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i);
            if (isInst) v.applyMatrix4(m);
            v.applyMatrix4(obj.matrixWorld);
            maxExtent = Math.max(maxExtent, Math.abs(v.z));
          }
        }
      });
      return maxExtent;
    };

    // 1. All continuous bowl roof styles
    for (const style of [
      'cantilever',
      'vaulted_ring',
      'bicycle_wheel',
      'enveloping_shell',
      'folded_plate',
      'fixed_dome',
      'suspended_masts',
      'twin_arch',
      'giant_arch',
      'bowstring_arch',
      'tensile_net',
      'retractable',
      'column_supported',
      'goalpost_truss',
    ] as RoofStyle[]) {
      const docOver = createPresetDocument('bowl_bowstring_60k');
      docOver.roof.style = style;
      docOver.concourse = { width: 14, heightRatio: 0.5 };
      docOver.roof.overConcourse = true;

      const docShort = createPresetDocument('bowl_bowstring_60k');
      docShort.roof.style = style;
      docShort.concourse = { width: 14, heightRatio: 0.5 };
      docShort.roof.overConcourse = false;

      const grpOver = generateRoofGroup(docOver, false);
      const grpShort = generateRoofGroup(docShort, false);

      const extentOver = measureCanopyOuterExtent(grpOver);
      const extentShort = measureCanopyOuterExtent(grpShort);

      expect(
        extentOver - extentShort,
        `Expected roof "${style}" canopy to extend over 14 m concourse`
      ).toBeGreaterThan(10);

      disposeObject3D(grpOver);
      disposeObject3D(grpShort);
    }

    // 2. Discrete stand-by-stand roof styles (including corners)
    for (const style of ['cantilever', 'truss', 'column_supported', 'goalpost_truss'] as RoofStyle[]) {
      const docOver = createPresetDocument('urban_cathedral_84k');
      docOver.roof.style = style;
      docOver.concourse = { width: 12, heightRatio: 0.5 };
      docOver.roof.overConcourse = true;

      const docShort = createPresetDocument('urban_cathedral_84k');
      docShort.roof.style = style;
      docShort.concourse = { width: 12, heightRatio: 0.5 };
      docShort.roof.overConcourse = false;

      const grpOver = generateRoofGroup(docOver, false);
      const grpShort = generateRoofGroup(docShort, false);

      const extentOver = measureCanopyOuterExtent(grpOver);
      const extentShort = measureCanopyOuterExtent(grpShort);

      expect(
        extentOver - extentShort,
        `Expected discrete roof "${style}" canopy to extend over 12 m concourse`
      ).toBeGreaterThan(9);

      disposeObject3D(grpOver);
      disposeObject3D(grpShort);
    }
  });
});




describe('cantilevered upper tiers', () => {
  const base = createPresetDocument('bowl_bowstring_60k');

  it('keeps standing headroom over every sheltered row, with or without VIP loggias', () => {
    for (const vipLoges of [true, false]) {
      for (const tierOverhang of [0, DEFAULT_TIER_OVERHANG_M, 2.5, 5, 7.5]) {
        const stand = { ...base.stands.south, tiers: 2 as const, rows: 40, vipLoges, tierOverhang };
        const section = computeStandSection(stand);
        expect(section.breaks).toHaveLength(1);
        const brk = section.breaks[0];
        const sheltered = section.rows.filter(
          (r) => r.tierIdx === 0 && r.d + stand.rowDepth > brk.frontD
        );
        expect(sheltered.length).toBe(brk.shelteredRows);
        for (const row of sheltered) {
          expect(brk.soffitY - row.y).toBeGreaterThanOrEqual(OVERHANG_HEADROOM_M - 1e-9);
        }
        // The balcony really projects by the requested amount over the lower tier.
        expect(brk.fromD - brk.frontD).toBeCloseTo(tierOverhang, 5);
      }
    }
  });

  it('gives the 3D profile, the capacity and the sightlines the same section', () => {
    const stand = { ...base.stands.south, tiers: 3 as const, rows: 54, tierOverhang: 4 };
    const doc = { ...base, stands: { ...base.stands, south: stand } };
    const section = computeStandSection(stand);
    const metrics = calculateStandMetrics(doc, 'south');
    expect(metrics.totalDepth).toBeCloseTo(section.totalDepth, 1);
    expect(metrics.maxHeight).toBeCloseTo(section.topHeight, 1);

    const lines = computeStandSightlines(stand, 0);
    const baseDist = Math.max(2, stand.distanceToPitch);
    section.rows.forEach((row, i) => {
      expect(lines.points[i].distanceX).toBeCloseTo(baseDist + row.d - 0.34, 1);
    });
  });

  it('brings the upper tier closer to the pitch as the overhang grows', () => {
    const at = (tierOverhang: number) => {
      const stand = { ...base.stands.south, tiers: 2 as const, rows: 40, tierOverhang };
      const first = computeStandSightlines(stand, 0).points.find((p) => p.tier === 2)!;
      return first.distanceX;
    };
    expect(at(5)).toBeLessThan(at(1.15));
    expect(at(1.15) - at(5)).toBeCloseTo(5 - 1.15, 5);
  });

  it('keeps the original projection when no overhang is set', () => {
    const tiers = resolveStandTiers({ ...base.stands.south, tiers: 2, tierOverhang: undefined });
    expect(tiers[1].overhang).toBe(1.15);
  });

  it('reports an evacuation time that falls as vomitories are added', () => {
    const withCount = (vomitoryCount: number) =>
      calculateStandMetrics(
        { ...base, stands: { ...base.stands, south: { ...base.stands.south, vomitoryCount } } },
        'south'
      ).evacuationMinutes;
    expect(withCount(4)).toBeGreaterThan(withCount(8));
    expect(withCount(8)).toBeGreaterThan(0);
  });
  it('seats a crowd sized by attendance and lays terraces on a grass bank', () => {
    const base = createPresetDocument('asymmetric_modular_30k');
    const crowdOf = (attendance: number) => {
      const doc = { ...base, materials: { ...base.materials!, crowd: true, crowdAttendance: attendance } };
      let count = 0;
      generateStandsGroup(doc, false).traverse((o) => {
        if (o.name === 'CrowdBodies') count += (o as THREE.InstancedMesh).count;
      });
      return count;
    };
    // Off by default: existing grounds keep their empty seats
    let defaultCrowd = 0;
    generateStandsGroup(base, false).traverse((o) => {
      if (o.name.startsWith('Crowd')) defaultCrowd++;
    });
    expect(defaultCrowd).toBe(0);
    expect(crowdOf(0)).toBe(0);
    const half = crowdOf(0.5);
    const full = crowdOf(1);
    expect(half).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(half * 1.5);

    const banked = {
      ...base,
      stands: { ...base.stands, east: { ...base.stands.east, embankment: true } },
    };
    const east = generateStandsGroup(banked, false).getObjectByName('Stand_EAST')!;
    const bank = east.getObjectByName('GrassEmbankment') as THREE.Mesh;
    expect(bank).toBeDefined();
    bank.geometry.computeBoundingBox();
    expect(bank.geometry.boundingBox!.max.y).toBeGreaterThan(1);
    expect(generateStandsGroup(base, false).getObjectByName('GrassEmbankment')).toBeUndefined();
  });

  it('synthesises the ceramic, corrugated and new lacquer finishes', () => {
    for (const id of ['ceramic_tile_mosaic', 'corrugated_steel_sheet'] as const) {
      const mat = createFacadePbrMaterial(id, 'day', false, 1);
      expect(mat.map).toBeTruthy();
      expect(mat.normalMap).toBeTruthy();
    }
    for (const id of ['yellow_lacquer_steel', 'sky_blue_lacquer_steel'] as const) {
      const mat = createStructurePbrMaterial(id, 1);
      expect(mat.map).toBeTruthy();
    }
  });
  it('dresses kops with standing fans, tifos and banners, and lights ETFE in the club colour', () => {
    const base = createPresetDocument('traditional_four_stands_42k');
    const doc = {
      ...base,
      materials: { ...base.materials!, crowd: true },
      stands: {
        ...base.stands,
        south: { ...base.stands.south, seatingType: 'safe_standing' as const, banners: true },
        east: { ...base.stands.east, tifo: true },
      },
    };
    const stands = generateStandsGroup(doc, false);
    const south = stands.getObjectByName('Stand_SOUTH')!;
    let standing = 0;
    south.traverse((o) => {
      if (o.name === 'CrowdBodies') standing += (o as THREE.InstancedMesh).count;
    });
    expect(standing).toBeGreaterThan(500);
    expect(south.getObjectByName('SupporterBanners')).toBeDefined();
    expect(stands.getObjectByName('Stand_NORTH')!.getObjectByName('SupporterBanners')).toBeUndefined();

    // A tifo fills every seat in two club colours only
    const east = stands.getObjectByName('Stand_EAST')!;
    const colours = new Set<string>();
    east.traverse((o) => {
      const mesh = o as THREE.InstancedMesh;
      if (o.name !== 'CrowdBodies' || !mesh.instanceColor) return;
      const c = new THREE.Color();
      for (let i = 0; i < mesh.count; i++) colours.add(mesh.getColorAt(i, c).getHexString());
    });
    expect(colours.size).toBe(2);

    const glow = createFacadePbrMaterial('etfe_cushions_facade', 'night', false, 1, '#dc2626');
    expect(glow.emissive.getHexString()).toBe(new THREE.Color('#dc2626').getHexString());
    expect(createFacadePbrMaterial('etfe_cushions_facade', 'day', false, 1, '#dc2626').emissive.getHex()).toBe(0);
  });
  it('shapes a continuous bowl skin as a calabash or a tent, with their textile and mosaic finishes', () => {
    const base = createPresetDocument('bowl_bowstring_60k');
    const skinReach = (profile: 'straight' | 'bulging' | 'tent') => {
      const doc = {
        ...base,
        concourse: { width: 0, heightRatio: 0.5 },
        materials: { ...base.materials!, envelopeStyle: 'enveloping_skin' as const, envelopeProfile: profile },
      };
      const box = new THREE.Box3().setFromObject(generateStandsGroup(doc, false));
      return box.max.x - box.min.x;
    };
    const straight = skinReach('straight');
    expect(skinReach('bulging')).toBeGreaterThan(straight + 4);
    expect(skinReach('tent')).toBeGreaterThan(skinReach('bulging'));

    for (const id of ['sadu_textile', 'calabash_mosaic', 'woven_glassfibre_mesh'] as const) {
      const mat = createFacadePbrMaterial(id, 'day', false, 1);
      expect(mat.map).toBeTruthy();
      expect(mat.normalMap).toBeTruthy();
    }
  });
});

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildStadiumSceneGraph, disposeObject3D } from '../buildStadiumScene';
import {
  calculateStadiumMetrics,
  calculateStandMetrics,
  computeKopWallStandPatch,
} from '../capacity';
import { generateRoofGroup } from '../generateRoof';
import { generateStandsGroup } from '../generateStand';
import {
  createFacadePbrMaterial,
  createRoofPbrMaterial,
  createSeatTerracePbrMaterial,
  createStructurePbrMaterial,
  createTrackPbrMaterial,
  ENVELOPE_STYLE_CATALOG,
  FACADE_MATERIAL_CATALOG,
  PLAZA_MATERIAL_CATALOG,
  ROOF_MATERIAL_CATALOG,
  SEAT_MATERIAL_CATALOG,
  STRUCTURE_MATERIAL_CATALOG,
  TRACK_MATERIAL_CATALOG,
  TURF_MATERIAL_CATALOG,
} from '../materials';
import { createPresetDocument, STADIUM_PRESETS } from '../presets';
import {
  EnvelopeStyle,
  riserFromSlopeDeg,
  RoofStyle,
  STADIUM_SHAPE_LABELS,
  StadiumShape,
} from '../schema';
import { computeRowCValueMm, computeStandSightlines } from '../sightlines';

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

describe('StadiumForge 10 Morphologies, 15 Roofs, 4 Envelopes & Full-Height Kop Wall', () => {
  const forbiddenNameRe =
    /emirates|stade de france|at&t|marvingt|roazhon|bernab|allianz|olimpico|rome|beşiktaş|besiktas|villa park|tottenham|havre|wembley|dortmund|südtribüne|sudtribune|bordeaux|matmut|munich|maracan|francfort|amsterdam|cardiff|gelsenkirchen|mauroy/i;

  it('guarantees zero real-world stadium names in templates and supports all 10 morphologies without pitch intrusion', () => {
    ensureCanvasMock();

    for (const preset of STADIUM_PRESETS) {
      expect(forbiddenNameRe.test(preset.label)).toBe(false);
      expect(forbiddenNameRe.test(preset.subtitle)).toBe(false);
      const doc = preset.createDocument();
      expect(forbiddenNameRe.test(doc.name)).toBe(false);
    }

    const shapes = Object.keys(STADIUM_SHAPE_LABELS) as StadiumShape[];
    expect(shapes.length).toBe(10);

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
  });

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
  });

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
  });
});



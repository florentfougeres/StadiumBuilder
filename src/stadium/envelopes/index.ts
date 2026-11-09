import * as THREE from 'three';
import { ENVELOPE_STYLE_CATALOG, resolveStadiumMaterials } from '../materials';
import { buildParametricFacadeOnRail } from '../parametricFacade';
import type { EnvelopeStyle, StadiumDocument, StructureMaterialId } from '../schema';
import { colonnadeForest } from './colonnadeForest';
import { exposedStructure } from './exposedStructure';
import { helicalRamps } from './helicalRamps';
import { horizontalStrata } from './horizontalStrata';
import { louverCurtain } from './louverCurtain';
import { mediaMesh } from './mediaMesh';
import { type FacadeRailSample, lobbyHeight, loftAlongRail, slab } from './rail';
import { envelopingSkin } from './skin';
import { stackedArcades } from './stackedArcades';
import type { EnvelopeDrawer, EnvelopeDressingParams, EnvelopeStandContext } from './types';

/**
 * Exterior envelope of the stadium. Every style is drawn in two situations from the same drawer:
 * the whole facade behind the stands (straight stand, corner or continuous bowl alike, each only
 * describing its outer line as a rail whose samples carry `depth`), and a dressing hung in front
 * of an existing wall (outer concourse, band under an arena roof).
 *
 * Adding a facade: one entry in `ENVELOPE_STYLE_CATALOG` (materials.ts) and one drawer here, in
 * its own file under `envelopes/`.
 */
export const ENVELOPE_DRAWERS: Record<EnvelopeStyle, EnvelopeDrawer> = {
  enveloping_skin: envelopingSkin,
  exposed_structure: exposedStructure,
  colonnade_forest: colonnadeForest,
  louver_curtain: louverCurtain,
  stacked_arcades: stackedArcades,
  media_mesh: mediaMesh,
  helical_ramps: helicalRamps,
  horizontal_strata: horizontalStrata,
};

/** Ground level (m) of the facade: the berm of a sunken bowl, never above two thirds of the crest. */
export function facadeGradeY(sunkenDepth: number, crestY: number): number {
  return Math.min(sunkenDepth, Math.max(0, crestY * 0.68));
}

/**
 * Stands whose underside is left open to view (an envelope that shows it, or a steel or timber
 * frame of their own), so the stand is built as a hollow raked slab rather than a solid block.
 */
export function isHollowStand(doc: StadiumDocument, ownStructure?: StructureMaterialId | 'inherit'): boolean {
  if (doc.roof.style === 'enveloping_shell') return false;
  const envelope = resolveStadiumMaterials(doc).envelopeStyle ?? 'enveloping_skin';
  return (
    ENVELOPE_STYLE_CATALOG.find((e) => e.id === envelope)?.hollowStands === true ||
    (ownStructure !== undefined && ownStructure !== 'inherit' && ownStructure !== 'reinforced_concrete')
  );
}

/** The chosen envelope hung in front of an existing wall. */
export function buildEnvelopeDressing(params: EnvelopeDressingParams & { style: EnvelopeStyle }): THREE.Group | null {
  return ENVELOPE_DRAWERS[params.style].dressing(params);
}

export interface StandEnvelopeParams {
  doc: StadiumDocument;
  /** Outer facade line of the stands; every sample needs `depth`. */
  rail: FacadeRailSample[];
  closed: boolean;
  facadeMat: THREE.Material;
  structureMat: THREE.Material;
  concreteMat: THREE.Material;
  turnstileTex: THREE.Texture;
  /** Accent of an upright plain skin instead of pilasters (bowl shapes with their own elevation). */
  skinAccent?: 'piers' | 'bands';
  name?: string;
}

/** Draws the envelope chosen in `doc.materials` along the outer facade of the stands. */
export function buildStandEnvelope(params: StandEnvelopeParams): THREE.Group {
  const { doc, rail, closed, facadeMat, structureMat, concreteMat, turnstileTex, skinAccent } = params;
  const group = new THREE.Group();
  group.name = params.name ?? 'StandEnvelope';
  if (doc.roof.style === 'enveloping_shell' || rail.length < 2) return group;

  const mats = resolveStadiumMaterials(doc);
  const envelope: EnvelopeStyle = mats.envelopeStyle ?? 'enveloping_skin';
  const drawer = ENVELOPE_DRAWERS[envelope];
  const night = doc.lighting !== 'day';
  const wallMat = facadeMat.clone();
  wallMat.side = THREE.DoubleSide;
  const add = (...objs: (THREE.Object3D | null)[]) => objs.forEach((o) => o && group.add(o));
  const loft: EnvelopeStandContext['loft'] = (profile, mat, uTileM) => loftAlongRail(rail, closed, profile, mat, uTileM);
  const ctx: EnvelopeStandContext = {
    doc,
    mats,
    rail,
    closed,
    night,
    facadeMat,
    wallMat,
    structureMat,
    concreteMat,
    skinAccent,
    add,
    loft,
    wall: (out, topInset) =>
      loft(
        (pt) => [
          [out, pt.yBottom],
          [out, pt.yTop - topInset],
        ],
        wallMat
      ),
  };
  drawer.stand(ctx);

  // Ground-floor entrance band with turnstiles, under a canopy.
  const lobby = drawer.lobby !== false;
  if (lobby) {
    const lobbyMat = new THREE.MeshPhysicalMaterial({
      map: turnstileTex,
      emissive: new THREE.Color(night ? 0xfbbf24 : 0x000000),
      emissiveMap: turnstileTex,
      emissiveIntensity: night ? 0.55 : 0,
      roughness: 0.18,
      metalness: 0.35,
      clearcoat: 0.85,
      side: THREE.DoubleSide,
    });
    add(
      loft(
        (pt) => [
          [1.05, pt.yBottom],
          [1.05, pt.yBottom + lobbyHeight(pt)],
        ],
        lobbyMat,
        24
      ),
      loft(slab(0.2, 3.4, 0.45, (pt) => pt.yBottom + lobbyHeight(pt)), structureMat)
    );
  }

  // Parametric relief, unless an outer concourse wraps the stands (it carries the relief then).
  const pattern = mats.facadePattern ?? 'none';
  if (pattern !== 'none' && (doc.concourse?.width ?? 0) <= 0.5) {
    add(
      buildParametricFacadeOnRail({
        samples: rail.map((pt) => ({
          ...pt,
          x: pt.x + pt.nx * 1.05,
          z: pt.z + pt.nz * 1.05,
          yBottom: pt.yBottom + (lobby ? lobbyHeight(pt) + 0.35 : 0.2),
          yTop: Math.max(pt.yBottom + 2, pt.yTop - 0.15),
        })),
        closed,
        pattern,
        density: mats.facadeDensity ?? 1.0,
        depth: mats.facadeDepth ?? 0.85,
        bulge: mats.facadeBulge ?? 0,
        primaryMat: facadeMat,
        accentMat: structureMat,
      })
    );
  }
  return group;
}

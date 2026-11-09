import * as THREE from 'three';
import { ENVELOPE_STYLE_CATALOG, resolveFacadePalette, resolveStadiumMaterials } from '../materials';
import { buildParametricFacadeOnRail } from '../parametricFacade';
import type { EnvelopeStyle, FacadeMaterialId, StadiumDocument, StandConfig } from '../schema';
import { colonnadeForest } from './colonnadeForest';
import { exposedStructure } from './exposedStructure';
import { externalStairs } from './externalStairs';
import { helicalRamps } from './helicalRamps';
import { horizontalStrata } from './horizontalStrata';
import { louverCurtain } from './louverCurtain';
import { mediaMesh } from './mediaMesh';
import {
  createRailSampler,
  FACADE_WALL_OFFSET,
  type FacadeRailSample,
  lobbyHeight,
  loftAlongRail,
  railStations,
  slab,
  verticals,
} from './rail';

/** How far (m) the envelope steps out over a glazed plinth. */
const PLINTH_RECESS = 3;
import { envelopingSkin, skinSilhouette } from './skin';
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
  external_stairs: externalStairs,
};

/** Ground level (m) of the facade: the berm of a sunken bowl, never above two thirds of the crest. */
export function facadeGradeY(sunkenDepth: number, crestY: number): number {
  return Math.min(sunkenDepth, Math.max(0, crestY * 0.68));
}

/** Envelope style and cladding of `stand`'s facade: its own overrides, else the stadium's. */
export function resolveStandFacade(
  doc: StadiumDocument,
  stand?: StandConfig
): { envelopeStyle: EnvelopeStyle; facade: FacadeMaterialId } {
  const mats = resolveStadiumMaterials(doc);
  const ownStyle = stand?.envelopeStyleOverride;
  const ownFacade = stand?.facadeMaterialOverride;
  return {
    envelopeStyle: ownStyle && ownStyle !== 'inherit' ? ownStyle : (mats.envelopeStyle ?? 'enveloping_skin'),
    facade: ownFacade && ownFacade !== 'inherit' ? ownFacade : mats.facade,
  };
}

/** Whether `stand` (or, without one, the stadium) overrides the stadium's envelope or cladding. */
export function hasOwnFacade(stand: StandConfig): boolean {
  return (
    (stand.envelopeStyleOverride !== undefined && stand.envelopeStyleOverride !== 'inherit') ||
    (stand.facadeMaterialOverride !== undefined && stand.facadeMaterialOverride !== 'inherit')
  );
}

/**
 * Stands whose underside is left open to view (an envelope that shows it, or a steel or timber
 * frame of their own), so the stand is built as a hollow raked slab rather than a solid block.
 */
export function isHollowStand(doc: StadiumDocument, stand?: StandConfig): boolean {
  if (doc.roof.style === 'enveloping_shell') return false;
  const envelope = resolveStandFacade(doc, stand).envelopeStyle;
  const ownStructure = stand?.structureMaterialOverride;
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
  /** The stand this facade belongs to, for its own envelope style (none for shared corners). */
  stand?: StandConfig;
  name?: string;
}

/** Draws the envelope chosen in `doc.materials` along the outer facade of the stands. */
export function buildStandEnvelope(params: StandEnvelopeParams): THREE.Group {
  const { doc, rail, closed, facadeMat, structureMat, concreteMat, turnstileTex, skinAccent } = params;
  const group = new THREE.Group();
  group.name = params.name ?? 'StandEnvelope';
  if (doc.roof.style === 'enveloping_shell' || rail.length < 2) return group;

  const own = resolveStandFacade(doc, params.stand);
  const mats = { ...resolveStadiumMaterials(doc), envelopeStyle: own.envelopeStyle, facade: own.facade };
  const envelope = own.envelopeStyle;
  const drawer = ENVELOPE_DRAWERS[envelope];
  const night = doc.lighting !== 'day';
  const wallMat = facadeMat.clone();
  wallMat.side = THREE.DoubleSide;
  const add = (...objs: (THREE.Object3D | null)[]) => objs.forEach((o) => o && group.add(o));
  // A recessed glazed plinth lifts the envelope off the ground where the facade is tall enough.
  const plinthH = Math.max(0, mats.plinthHeight ?? 0);
  const plinthAt = (pt: FacadeRailSample) => (plinthH >= 3 && pt.yTop - pt.yBottom > plinthH + 4 ? plinthH : 0);
  // The envelope steps out over the plinth, which stays against the back of the stands.
  const skinRail =
    plinthH >= 3
      ? rail.map((pt) => {
          const lift = plinthAt(pt);
          const out = lift > 0 ? PLINTH_RECESS : 0;
          return { ...pt, x: pt.x + pt.nx * out, z: pt.z + pt.nz * out, yBottom: pt.yBottom + lift };
        })
      : rail;
  const loft: EnvelopeStandContext['loft'] = (profile, mat, uTileM) => loftAlongRail(skinRail, closed, profile, mat, uTileM);
  const ctx: EnvelopeStandContext = {
    doc,
    mats,
    rail: skinRail,
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
  // Accents over a plain skin: they follow its silhouette.
  if (envelope === 'enveloping_skin') {
    const silhouette = skinSilhouette(mats) ?? (() => FACADE_WALL_OFFSET);
    add(
      facadeStripes(skinRail, closed, mats.facadeStripeSpacing ?? 0, silhouette),
      facadeBaseGlow(skinRail, closed, mats.facadeBaseGlow === true, night, silhouette)
    );
  }

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
  const lobby = drawer.lobby !== false;
  if (plinthH >= 3) {
    // Glazed hall set back under the envelope, its soffit carried by a row of slender columns.
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xbcd3e0,
      roughness: 0.08,
      metalness: 0.2,
      transparent: true,
      opacity: 0.55,
      emissive: new THREE.Color(night ? 0xfde68a : 0x000000),
      emissiveIntensity: night ? 0.35 : 0,
      side: THREE.DoubleSide,
    });
    const raw = (profile: (pt: FacadeRailSample) => [number, number][], mat: THREE.Material, uTileM?: number) =>
      loftAlongRail(rail, closed, profile, mat, uTileM);
    add(
      raw((pt) => [[0.15, pt.yBottom], [0.15, pt.yBottom + Math.min(lobbyHeight(pt), plinthAt(pt))]], lobbyMat, 24),
      raw((pt) => [[0.15, pt.yBottom + Math.min(lobbyHeight(pt), plinthAt(pt))], [0.15, pt.yBottom + plinthAt(pt)]], glass),
      // Soffit under the stepped-out envelope, and its cap at the crest.
      raw(
        (pt) => [
          [PLINTH_RECESS + 0.6, pt.yBottom + plinthAt(pt)],
          [0, pt.yBottom + plinthAt(pt)],
        ],
        structureMat
      ),
      raw(
        (pt) => [
          [0, pt.yTop],
          [PLINTH_RECESS + 0.6, pt.yTop],
        ],
        structureMat
      ),
      verticals(
        railStations(rail, closed, 9, 0.5)
          .filter((pt) => plinthAt(pt) > 0)
          .map((pt) => ({ ...pt, yTop: pt.yBottom + plinthAt(pt) })),
        PLINTH_RECESS - 0.4,
        new THREE.CylinderGeometry(0.32, 0.38, 1, 12),
        structureMat,
        'EnvelopePlinthColumns'
      )
    );
  } else if (lobby) {
    // Ground-floor entrance band with turnstiles, under a canopy.
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
        samples: skinRail.map((pt) => ({
          ...pt,
          x: pt.x + pt.nx * 1.05,
          z: pt.z + pt.nz * 1.05,
          yBottom: pt.yBottom + (lobby && plinthH < 3 ? lobbyHeight(pt) + 0.35 : 0.2),
          yTop: Math.max(pt.yBottom + 2, pt.yTop - 0.15),
        })),
        closed,
        pattern,
        density: mats.facadeDensity ?? 1.0,
        depth: mats.facadeDepth ?? 0.85,
        bulge: mats.facadeBulge ?? 0,
        primaryMat: facadeMat,
        accentMat: structureMat,
        palette: resolveFacadePalette(doc),
      })
    );
  }
  return group;
}

type Silhouette = (h: number, vf: number) => number;

/** Profile of a strip lying on the skin between height fractions `v0` and `v1`, a little proud of it. */
function onSkin(silhouette: Silhouette, v0: number, v1: number, proud: number) {
  return (pt: FacadeRailSample): [number, number][] => {
    const h = pt.yTop - pt.yBottom;
    return Array.from({ length: 9 }, (_, b) => {
      const vf = v0 + ((v1 - v0) * b) / 8;
      return [silhouette(h, vf) + proud, pt.yBottom + vf * h] as [number, number];
    });
  };
}

/** Dark vertical stripes `spacing` metres apart running up the skin. */
export function facadeStripes(rail: FacadeRailSample[], closed: boolean, spacing: number, silhouette: Silhouette): THREE.Group | null {
  if (spacing < 4) return null;
  const sampler = createRailSampler(rail, closed);
  if (!sampler) return null;
  const { totalLen, sampleAtArc } = sampler;
  const mat = new THREE.MeshStandardMaterial({ color: 0x1c1917, roughness: 0.7, side: THREE.DoubleSide });
  const group = new THREE.Group();
  group.name = 'FacadeStripes';
  const count = Math.max(1, Math.round(totalLen / spacing));
  const width = Math.min(2.4, spacing * 0.25);
  for (let i = 0; i < count; i++) {
    const mid = ((i + 0.5) / count) * totalLen;
    const strip = [mid - width / 2, mid, mid + width / 2].map((sArc) => sampleAtArc(Math.max(0, Math.min(totalLen, sArc))));
    const mesh = loftAlongRail(strip, false, onSkin(silhouette, 0.04, 0.98, 0.12), mat, 4);
    if (mesh) group.add(mesh);
  }
  return group.children.length ? group : null;
}

/** Warm glowing band along the foot of the skin, brighter at dusk and night. */
export function facadeBaseGlow(rail: FacadeRailSample[], closed: boolean, on: boolean, night: boolean, silhouette: Silhouette): THREE.Mesh | null {
  if (!on) return null;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xf97316,
    emissive: new THREE.Color(0xf97316),
    emissiveIntensity: night ? 2.2 : 0.45,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  const mesh = loftAlongRail(rail, closed, onSkin(silhouette, 0, 0.07, 0.18), mat);
  if (mesh) mesh.name = 'FacadeBaseGlow';
  return mesh;
}

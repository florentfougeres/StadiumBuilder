import * as THREE from 'three';
import type { resolveStadiumMaterials } from '../materials';
import type { FacadeMaterialId, StadiumDocument } from '../schema';
import type { FacadeRailSample } from './rail';

/** Everything a style needs to draw the whole facade behind the stands. */
export interface EnvelopeStandContext {
  doc: StadiumDocument;
  mats: ReturnType<typeof resolveStadiumMaterials>;
  /** Outer facade line of the stands; every sample carries `depth`. */
  rail: FacadeRailSample[];
  closed: boolean;
  night: boolean;
  facadeMat: THREE.Material;
  /** The facade material, double-sided, for walls seen from both faces. */
  wallMat: THREE.Material;
  structureMat: THREE.Material;
  concreteMat: THREE.Material;
  /** Accent of an upright plain skin instead of pilasters (bowl shapes with their own elevation). */
  skinAccent?: 'piers' | 'bands';
  add: (...objs: (THREE.Object3D | null)[]) => void;
  /** Lofts a cross-section `(outward offset, height)[]` along the rail. */
  loft: (profile: (pt: FacadeRailSample) => [number, number][], mat: THREE.Material, uTileM?: number) => THREE.Mesh | null;
  /** Upright facade wall `out` metres outward of the back of the stands, stopping `topInset` below the crest. */
  wall: (out: number, topInset: number) => THREE.Mesh | null;
}

/** Dressing hung in front of an existing wall: the outer concourse, or the band under an arena roof. */
export interface EnvelopeDressingParams {
  samples: FacadeRailSample[];
  closed: boolean;
  frameMat: THREE.Material;
  facadeMaterial?: FacadeMaterialId;
  /** Slab-edge bands at each storey; off for a screen with no floors behind it. */
  storeys?: boolean;
  /** Masonry or cladding of the heavier dressings (falls back to `frameMat`). */
  facadeMat?: THREE.Material;
  /** `media_mesh`: the two colours the LED skin animates between. */
  ledColors?: [string, string];
  /** `media_mesh`: brighter pixels at dusk and night. */
  night?: boolean;
  /** `louver_curtain`: colour of the lights washing the blades at dusk and night (none = unlit). */
  glowHex?: string;
}

/**
 * One envelope style. Adding a facade is one entry in `ENVELOPE_STYLE_CATALOG` (label, cost) and
 * one drawer in `envelopes/index.ts`.
 */
export interface EnvelopeDrawer {
  /** The whole facade behind the stands, its wall included. */
  stand(ctx: EnvelopeStandContext): void;
  /** The same style hung in front of an existing wall. */
  dressing(params: EnvelopeDressingParams): THREE.Group | null;
  /** Ground-floor entrance band with turnstiles under a canopy (default true). */
  lobby?: boolean;
}

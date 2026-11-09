import * as THREE from 'three';
import type { FacadeMaterialId, StadiumMaterialsConfig } from '../schema';
import {
  createRailSampler,
  FACADE_WALL_OFFSET,
  type FacadeRailSample,
  lobbyHeight,
  railStations,
  verticals,
} from './rail';
import type { EnvelopeDrawer, EnvelopeDressingParams, EnvelopeStandContext } from './types';

/** Curtain-wall module: mullion spacing, primary mullion rhythm and storey height (m). */
const MULLION_SPACING = 1.5;

const PRIMARY_EVERY = 6;

const STOREY_HEIGHT = 4.5;

/**
 * Base articulation of a glazed or clad envelope: slim mullions on a 1.5 m module with a deeper
 * primary mullion every 9 m, and a slab-edge band at every storey. This is what makes a facade
 * read at building scale (the reference renders' fine vertical rhythm) rather than as a flat skin.
 */
export function buildCurtainWallArticulation(params: {
  samples: FacadeRailSample[];
  closed: boolean;
  frameMat: THREE.Material;
  facadeMaterial?: FacadeMaterialId;
  /** How far the frame stands proud of the facade surface (m). */
  offset?: number;
  /** Slab-edge bands at each storey; off for a screen with no floors behind it. */
  storeys?: boolean;
}): THREE.Group | null {
  const {
    samples,
    closed,
    frameMat,
    facadeMaterial = 'glass_curtain',
    offset = 0.05,
    storeys = true,
  } = params;
  // Only glazed curtain-wall facades wear the dense 1.5 m × 4.5 m aluminum mullion/transom grid;
  // masonry, concrete, stone, Corten, ETFE cushions, zinc, composite, timber & green walls read through their own material!
  if (facadeMaterial !== 'glass_curtain') return null;
  const rail = createRailSampler(samples, closed);
  if (!rail) return null;
  const { totalLen, sampleAtArc } = rail;

  const count = Math.max(4, Math.round(totalLen / MULLION_SPACING));
  const step = totalLen / count;
  const dummy = new THREE.Object3D();
  const mullions: THREE.Matrix4[] = [];
  const slabs: THREE.Matrix4[] = [];

  for (let i = 0; i < count; i++) {
    const s = closed ? i * step : (i + 0.5) * step;
    const pt = sampleAtArc(s);
    const h = pt.yTop - pt.yBottom;
    if (h < (storeys ? 2.5 : 0.8)) continue;
    const yaw = Math.atan2(pt.nx, pt.nz);
    const primary = i % PRIMARY_EVERY === 0;
    const depth = primary ? 0.85 : 0.32;
    const out = offset + depth * 0.5;
    dummy.position.set(pt.x + pt.nx * out, pt.yBottom + h * 0.5, pt.z + pt.nz * out);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(primary ? 0.24 : 0.09, h, depth);
    dummy.updateMatrix();
    mullions.push(dummy.matrix.clone());

    // Slab-edge band at each storey, one module long, standing slightly proud of the mullions.
    for (let y = pt.yBottom + STOREY_HEIGHT; storeys && y < pt.yTop - 1; y += STOREY_HEIGHT) {
      dummy.position.set(pt.x + pt.nx * (offset + 0.3), y, pt.z + pt.nz * (offset + 0.3));
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(step * 1.02, 0.42, 0.6);
      dummy.updateMatrix();
      slabs.push(dummy.matrix.clone());
    }
  }

  const group = new THREE.Group();
  group.name = 'CurtainWallArticulation';
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (const [name, list] of [
    ['CurtainWallMullions', mullions],
    ['CurtainWallSlabEdges', slabs],
  ] as const) {
    if (list.length === 0) continue;
    const inst = new THREE.InstancedMesh(box, frameMat, list.length);
    inst.name = name;
    list.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
  }
  return group.children.length > 0 ? group : null;
}

/** Outward offset (m) of a plain skin at height fraction `vf` for the chosen silhouette, or null when upright. */
export function skinSilhouette(mats: StadiumMaterialsConfig): ((h: number, vf: number) => number) | null {
  const profile = mats.envelopeProfile ?? 'straight';
  if (profile === 'bulging') return (h, vf) => FACADE_WALL_OFFSET + Math.sin(vf * Math.PI) * Math.min(7, h * 0.17);
  if (profile === 'tent') return (h, vf) => FACADE_WALL_OFFSET + Math.pow(1 - vf, 1.5) * Math.min(16, h * 0.55);
  // Glazed foot set back under the stands, the skin flaring out to the roof edge like a saucer.
  if (profile === 'saucer') return (h, vf) => FACADE_WALL_OFFSET - 1.5 + Math.pow(vf, 1.4) * Math.min(12, h * 0.4);
  if (mats.facade === 'etfe_cushions_facade') return (_h, vf) => Math.sin(vf * Math.PI) * 3.8 + vf * 0.8;
  return null;
}


/**
 * Finish of a plain upright skin: the curtain-wall grid when glazed, otherwise pilasters, piers or
 * bands, so a long wall never reads as a blank strip.
 */
function plainSkinFinish(ctx: EnvelopeStandContext): void {
  const { rail, closed, structureMat, mats, skinAccent, loft, add } = ctx;
  const glazed = buildCurtainWallArticulation({
    samples: rail.map((pt) => ({ ...pt, yBottom: pt.yBottom + lobbyHeight(pt) })),
    closed,
    frameMat: structureMat,
    facadeMaterial: mats.facade,
    offset: 0.2,
  });
  if (glazed) {
    add(glazed);
    return;
  }
  if (skinAccent === 'bands') {
    for (const f of [0.34, 0.66, 0.96]) {
      add(
        loft((pt) => {
          const y = pt.yBottom + f * (pt.yTop - pt.yBottom);
          return [
            [0.2, y - 0.45],
            [0.6 + f * 1.3, y],
            [0.2, y + 0.45],
            [0.2, y - 0.45],
          ];
        }, structureMat)
      );
    }
    return;
  }
  const piers = skinAccent === 'piers';
  add(
    verticals(
      railStations(rail, closed, piers ? 9 : 7.5),
      piers ? 1.1 : 0.58,
      new THREE.BoxGeometry(piers ? 1.45 : 0.62, 1, piers ? 2.6 : 2.2),
      structureMat,
      'EnvelopePilasters'
    )
  );
}

/** `enveloping_skin`: one continuous skin, upright or shaped (bulging, tent, ETFE cushions). */
export const envelopingSkin: EnvelopeDrawer = {
  stand(ctx) {
    const silhouette = skinSilhouette(ctx.mats);
    if (silhouette) {
      ctx.add(
        ctx.loft((pt) => {
          const h = pt.yTop - pt.yBottom;
          return Array.from({ length: 9 }, (_, b) => [silhouette(h, b / 8), pt.yBottom + (b / 8) * h] as [number, number]);
        }, ctx.wallMat)
      );
      return;
    }
    ctx.add(ctx.wall(FACADE_WALL_OFFSET, 0.25));
    plainSkinFinish(ctx);
  },
  dressing: (p) =>
    buildCurtainWallArticulation({
      samples: p.samples,
      closed: p.closed,
      frameMat: p.frameMat,
      facadeMaterial: p.facadeMaterial,
      storeys: p.storeys,
    }),
};

/**
 * A style that is a dressing hung in front of the plain facade wall: behind the stands it is the
 * wall plus that dressing, set a little proud of it, or the plain skin's finish where the dressing
 * has no room (a band too low for an arcade storey).
 */
export function dressedSkin(dressing: (p: EnvelopeDressingParams) => THREE.Group | null): EnvelopeDrawer {
  return {
    stand(ctx) {
      ctx.add(ctx.wall(FACADE_WALL_OFFSET, 0.25));
      const hung = dressing({
        samples: ctx.rail.map((pt) => ({ ...pt, x: pt.x + pt.nx * 0.55, z: pt.z + pt.nz * 0.55 })),
        closed: ctx.closed,
        frameMat: ctx.structureMat,
        facadeMat: ctx.facadeMat,
        ledColors: [ctx.doc.colors.seatsPrimary, ctx.doc.colors.seatsSecondary],
        night: ctx.night,
      });
      if (hung) ctx.add(hung);
      else plainSkinFinish(ctx);
    },
    dressing,
  };
}

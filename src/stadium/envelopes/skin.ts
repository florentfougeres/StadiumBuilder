import * as THREE from 'three';
import type { FacadeMaterialId, StadiumMaterialsConfig } from '../schema';
import {
  createRailSampler,
  FACADE_WALL_OFFSET,
  type FacadeRailSample,
  instancedBoxes,
  lobbyHeight,
  loftAlongRail,
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


/** Claddings that are a solid wall, so the floors behind it show as openings punched through it. */
const WALLED_FACADES = new Set<FacadeMaterialId>([
  'architectural_concrete',
  'weathered_corten',
  'heritage_brick',
  'limestone_travertine',
  'terracotta_baguettes',
  'gold_anodized_panels',
  'white_composite_panels',
  'black_zinc_cladding',
  'ceramic_tile_mosaic',
  'corrugated_steel_sheet',
  'precast_concrete_scales',
]);

/**
 * What each storey of a walled facade is, from the ground up: offices and stores behind punched
 * windows, the hospitality level behind a ribbon of glazing, plant rooms behind louvres at the top.
 */
export function storeyUses(storeys: number): ('windows' | 'ribbon' | 'louvres')[] {
  return Array.from({ length: storeys }, (_, k) => {
    if (storeys >= 3 && k === storeys - 1) return 'louvres';
    if (storeys === 2 ? k === 1 : storeys >= 3 && k === Math.floor((storeys - 1) / 2)) return 'ribbon';
    return 'windows';
  });
}

/**
 * Openings of a walled facade, bay by bay between its pilasters, so the building behind the stand
 * reads floor by floor: a string course at every slab, and per storey the openings of its use
 * (`storeyUses`). Each opening is a dark pane set in a projecting frame with a sill.
 */
export function storeyFenestration(params: {
  rail: FacadeRailSample[];
  closed: boolean;
  /** Spacing (m) of the pilasters the openings sit between. */
  baySpacing: number;
  facade: FacadeMaterialId;
  /** A relief pattern covers the wall: no openings. */
  relief?: boolean;
  structureMat: THREE.Material;
  concreteMat: THREE.Material;
  night: boolean;
}): THREE.Group | null {
  const { rail, closed, baySpacing, structureMat, concreteMat, night } = params;
  if (!WALLED_FACADES.has(params.facade) || params.relief) return null;
  const sampler = createRailSampler(rail, closed);
  if (!sampler) return null;
  const { totalLen, sampleAtArc } = sampler;
  // Same bays as the pilasters (`railStations`): one opening group between two of them.
  const count = Math.max(2, Math.round(totalLen / baySpacing));
  const step = totalLen / count;
  const firstFloor = (pt: FacadeRailSample) => pt.yBottom + lobbyHeight(pt) + 0.9;
  const storeysAt = (pt: FacadeRailSample) => Math.max(0, Math.floor((pt.yTop - 1 - firstFloor(pt)) / STOREY_HEIGHT));

  const panes: THREE.Matrix4[] = [];
  const litPanes: THREE.Matrix4[] = [];
  const frames: THREE.Matrix4[] = [];
  const blades: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();
  const box = (pt: FacadeRailSample, out: number, y: number, w: number, h: number, d: number) => {
    dummy.position.set(pt.x + pt.nx * out, y, pt.z + pt.nz * out);
    dummy.rotation.set(0, Math.atan2(pt.nx, pt.nz), 0);
    dummy.scale.set(w, h, d);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  };
  const wall = FACADE_WALL_OFFSET;
  /** One framed opening `w × h` centred at arc `s`, its sill at `y`. */
  const opening = (s: number, y: number, w: number, h: number, list: THREE.Matrix4[]) => {
    const pt = sampleAtArc(s);
    // Under a raking top (a gable), the opening must clear the wall's edge at both jambs.
    if (y + h > Math.min(sampleAtArc(s - w / 2).yTop, sampleAtArc(s + w / 2).yTop) - 0.7) return;
    list.push(box(pt, wall + 0.03, y + h / 2, w, h, 0.06));
    frames.push(
      box(pt, wall + 0.1, y + h + 0.06, w + 0.24, 0.12, 0.2),
      box(pt, wall + 0.14, y - 0.07, w + 0.34, 0.14, 0.3),
      box(sampleAtArc(s - w / 2 - 0.06), wall + 0.1, y + h / 2, 0.12, h, 0.2),
      box(sampleAtArc(s + w / 2 + 0.06), wall + 0.1, y + h / 2, 0.12, h, 0.2)
    );
  };

  // One use per floor along the whole elevation, read from its tallest part; where the wall
  // stops lower (a gable, a dipping crest) it simply has fewer floors.
  const maxStoreys = Math.max(...rail.map(storeysAt));
  const uses = storeyUses(maxStoreys);
  const bays = closed ? count : count - 1;
  const clear = baySpacing - 2.2;
  for (let i = 0; i < bays; i++) {
    const mid = (i + (closed ? 0.5 : 1)) * step;
    const pt = sampleAtArc(mid);
    uses.slice(0, storeysAt(pt)).forEach((use, k) => {
      const floor = firstFloor(pt) + k * STOREY_HEIGHT;
      if (use === 'windows') {
        const w = clear / 2 - 0.5;
        for (const side of [-1, 1]) opening(mid + side * (w / 2 + 0.4), floor + 1.15, w, 1.9, panes);
      } else if (use === 'ribbon') {
        // Floor-to-ceiling glazing in panes of a mullion module, so it follows a curved wall.
        const n = Math.max(2, Math.round(clear / 1.6));
        const w = clear / n - 0.12;
        for (let j = 0; j < n; j++) opening(mid + ((j + 0.5) / n - 0.5) * clear, floor + 0.55, w, 3.1, litPanes);
      } else {
        const lpt = sampleAtArc(mid);
        if (floor + 3.2 > Math.min(sampleAtArc(mid - clear / 2).yTop, sampleAtArc(mid + clear / 2).yTop) - 0.5) return;
        frames.push(box(lpt, wall + 0.08, floor + 2.1, clear + 0.2, 2.1, 0.12));
        for (let b = 0; b < 7; b++) blades.push(box(lpt, wall + 0.2, floor + 1.2 + b * 0.3, clear, 0.05, 0.22));
      }
    });
  }
  if (panes.length + litPanes.length + blades.length === 0) return null;

  const group = new THREE.Group();
  group.name = 'FacadeFenestration';
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x24323f, roughness: 0.08, metalness: 0.55, clearcoat: 1 });
  // The hospitality level is lit from within once the daylight goes.
  const litGlass = glass.clone();
  if (night) {
    litGlass.emissive = new THREE.Color(0xfde2a4);
    litGlass.emissiveIntensity = 0.7;
  }
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x5b6269, roughness: 0.5, metalness: 0.7 });
  for (const [name, list, mat] of [
    ['FacadeWindowPanes', panes, glass],
    ['FacadeRibbonPanes', litPanes, litGlass],
    ['FacadeWindowFrames', frames, structureMat],
    ['FacadeLouvreBlades', blades, bladeMat],
  ] as const) {
    const inst = instancedBoxes(name, list, mat);
    if (inst) group.add(inst);
  }
  // String course at every slab the wall is tall enough to hold.
  for (let k = 0; k <= maxStoreys; k++) {
    const course = loftAlongRail(rail, closed, (pt) => {
      const y = firstFloor(pt) + k * STOREY_HEIGHT;
      // Folded flat into the wall where this part of the facade stops lower.
      const on = k <= storeysAt(pt) && y < pt.yTop - 0.6;
      const proud = on ? 0.16 : 0;
      const yy = on ? y : pt.yBottom + 0.5;
      return [
        [wall, yy - 0.16],
        [wall + proud, yy - 0.16],
        [wall + proud, yy + 0.16],
        [wall, yy + 0.16],
      ];
    }, concreteMat);
    if (course) {
      course.name = 'FacadeStringCourse';
      group.add(course);
    }
  }
  return group;
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
    storeyFenestration({
      rail,
      closed,
      baySpacing: piers ? 9 : 7.5,
      facade: mats.facade,
      // A relief pattern over the wall is its own elevation.
      relief: (mats.facadePattern ?? 'none') !== 'none' && (ctx.doc.concourse?.width ?? 0) <= 0.5,
      structureMat,
      concreteMat: ctx.concreteMat,
      night: ctx.night,
    })
  );
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

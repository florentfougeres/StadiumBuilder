import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D } from '../buildStadiumScene';
import { generateRoofGroup } from '../generateRoof';
import { createPresetDocument, STADIUM_PRESETS } from '../presets';
import { calculateStadiumMetrics } from '../capacity';
import { RoofStyle } from '../schema';

/**
 * Every roof style with the name of a mesh it must build. Typed as a full record so that adding a
 * style to `RoofStyle` without a builder fails type-checking here.
 */
const SIGNATURE: Record<RoofStyle, string | null> = {
  none: null,
  column_supported: 'RoofCanopySurface',
  cantilever: 'RoofCanopySurface',
  goalpost_truss: 'RoofCanopySurface',
  truss: 'RoofCanopySurface',
  suspended_masts: 'RoofCanopySurface',
  giant_arch: 'RoofCanopySurface',
  bowstring_arch: 'RoofCanopySurface',
  bicycle_wheel: 'RoofCanopySurface',
  tensile_net: 'RoofCanopySurface',
  enveloping_shell: 'RoofCanopySurface',
  twin_arch: 'RoofCanopySurface',
  retractable: 'RetractableRoofLeaf',
  vaulted_ring: 'RoofCanopySurface',
  folded_plate: 'RoofCanopySurface',
  fixed_dome: 'RoofCanopySurface',
  corner_pylons: 'CornerMegaPylons',
  counterweighted_cantilever: 'CounterweightTrusses',
  spanning_girders: 'SpanningMegaGirders',
  concrete_portals: 'ConcretePortalRibs',
  timber_lattice: 'TimberLattice',
  wave_canopy: 'WaveCanopyLaceSkin',
  petal_iris: 'RetractableRoofIrisPin',
  historic_gable: 'HistoricGableTrusses',
  sawtooth: 'SawtoothFrame',
  butterfly: 'ButterflyFrame',
  barrel_vault: 'BarrelVaultRibs',
  hypar_shells: 'HyparShellEdges',
  tree_columns: 'TreeColumns',
  air_dome: 'AirDomeCableNet',
  cable_dome: 'CableDomeCables',
  girder_grid: 'GirderGridTrusses',
  saddle_vault: 'SaddleVaultRibs',
  dished_canopy: 'DishedCanopyFascia',
  faceted_shell: 'FacetedShellSeams',
  pleated_crown: 'PleatedCrownFacade',
  saucer_dome: 'SaucerVColumns',
  rising_canopy: 'RisingCanopyCompressionRing',
  crossed_arches: 'CrossedArchTubes',
};

const PER_STAND = new Set<RoofStyle>(['historic_gable', 'sawtooth', 'butterfly', 'barrel_vault', 'hypar_shells', 'tree_columns', 'truss', 'column_supported', 'goalpost_truss']);

describe('every roof style has a builder', () => {
  for (const [style, signature] of Object.entries(SIGNATURE) as [RoofStyle, string | null][]) {
    if (!signature) continue;
    it(`builds ${style}`, () => {
      // Per-stand styles are checked on a four-stand ground, whole-arena styles on a bowl.
      const doc = createPresetDocument(
        PER_STAND.has(style) ? 'traditional_four_stands_42k' : 'bowl_bowstring_60k'
      );
      doc.roof.style = style;
      doc.roof.retractable = { openRatio: 0.3 };
      const roof = generateRoofGroup(doc);
      expect(roof.getObjectByName(signature)).toBeInstanceOf(THREE.Object3D);
      disposeObject3D(roof);
    });
  }

  it('lets one stand of a four-stand ground take the historic gable roof', () => {
    const doc = createPresetDocument('traditional_four_stands_42k');
    doc.roof.style = 'cantilever';
    doc.stands.west.roofStyleOverride = 'historic_gable';
    const roof = generateRoofGroup(doc);
    expect(roof.getObjectByName('HistoricGablePediment')).toBeDefined();
    disposeObject3D(roof);
  });

  it('raises the wave canopy crests with the amplitude', () => {
    const top = (amp: number) => {
      const doc = createPresetDocument('bowl_bowstring_60k');
      doc.roof.style = 'wave_canopy';
      doc.roof.waveAmplitude = amp;
      const roof = generateRoofGroup(doc);
      const y = new THREE.Box3().setFromObject(roof.getObjectByName('RoofCanopySurface')!).max.y;
      disposeObject3D(roof);
      return y;
    };
    expect(top(12) - top(2)).toBeGreaterThan(8);
  });

  for (const preset of STADIUM_PRESETS) {
    it(`builds the ${preset.id} preset`, () => {
      const doc = createPresetDocument(preset.id);
      const capacity = calculateStadiumMetrics(doc).totalCapacity;
      expect(capacity).toBeGreaterThan(8000);
      // Ids ending in a capacity (`..._50k`) must land within 12 % of it.
      const k = /_(\d+)k$/.exec(preset.id);
      if (k) expect(Math.abs(capacity / (Number(k[1]) * 1000) - 1)).toBeLessThan(0.12);
      const roof = generateRoofGroup(doc);
      disposeObject3D(roof);
    });
  }
});

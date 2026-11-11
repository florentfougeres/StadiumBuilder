import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { terraceHeightAt } from '../envelopes/gable';
import { storeyUses } from '../envelopes/skin';
import { generateRoofGroup } from '../generateRoof';
import { generateStandsGroup } from '../generateStand';
import { createPresetDocument } from '../presets';
import { cantileverMastRise, columnRadiusFor, dimensionRoofColumns, trussDepthFor } from '../roofs/structuralSizing';

/** Textures are drawn on a canvas: any 2D call is a no-op here. */
if (typeof document === 'undefined') {
  const noop = () => ({ addColorStop: () => {} });
  const context = new Proxy({}, { get: () => noop, set: () => true });
  (globalThis as Record<string, unknown>).document = {
    createElement: () => ({ width: 1024, height: 512, getContext: () => context }),
  };
}

function instances(root: THREE.Object3D, name: string): number {
  let n = 0;
  root.traverse((o) => {
    if (o.name === name && o instanceof THREE.InstancedMesh) n += o.count;
  });
  return n;
}

function named(root: THREE.Object3D, name: string): number {
  let n = 0;
  root.traverse((o) => {
    if (o.name === name) n++;
  });
  return n;
}

const column = (height: number, radius: number, x: number, footY = 0) => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 6), new THREE.MeshStandardMaterial());
  mesh.position.set(x, footY + height / 2, 40);
  return mesh;
};

describe('roof frame sized to what it carries', () => {
  it('follows the span and the reach, within its bounds', () => {
    expect(trussDepthFor(140, 4, 14)).toBeCloseTo(10);
    expect(trussDepthFor(20, 4, 14)).toBe(4);
    expect(trussDepthFor(400, 4, 14)).toBe(14);
    expect(cantileverMastRise(36, 3.4, 8)).toBeCloseTo(6);
    expect(columnRadiusFor(30)).toBeCloseTo(0.5);
  });

  it('thickens a column too slender for its height and leaves a stocky one alone', () => {
    const roof = new THREE.Group();
    const slender = column(30, 0.2, 0);
    const stocky = column(8, 0.4, 9);
    roof.add(slender, stocky);
    dimensionRoofColumns(roof);
    expect(slender.scale.x * 0.2).toBeCloseTo(Math.min(0.2 * 2.4, columnRadiusFor(30)));
    expect(slender.scale.z).toBe(slender.scale.x);
    expect(slender.scale.y).toBe(1);
    expect(stocky.scale.x).toBe(1);
  });

  it('gives ground columns a footing and a base plate, but not columns standing on a stand', () => {
    const roof = new THREE.Group();
    roof.add(column(12, 0.3, 0), column(12, 0.3, 9), column(6, 0.3, 18, 14));
    dimensionRoofColumns(roof);
    expect(instances(roof, 'RoofColumnFootings')).toBe(2);
    expect(instances(roof, 'RoofColumnBasePlates')).toBe(2);
  });

  it('cross-braces one bay in four along a row of ground columns', () => {
    const roof = new THREE.Group();
    for (let i = 0; i < 12; i++) roof.add(column(14, 0.3, (i - 5.5) * 9));
    dimensionRoofColumns(roof);
    const rods = instances(roof, 'RoofColumnBracing');
    // Eleven bays in a row: two or three of them braced, each an X per panel.
    expect(rods).toBeGreaterThanOrEqual(4);
    expect(rods % 2).toBe(0);
    expect(instances(roof, 'RoofColumnBracingTies')).toBe(rods / 2);
  });

  it('builds a deeper goalpost girder over a longer stand', () => {
    const top = (span: number) => {
      const doc = createPresetDocument('traditional_four_stands_42k');
      doc.objects = [];
      doc.roof.style = 'goalpost_truss';
      for (const stand of Object.values(doc.stands)) stand.roofStyleOverride = 'inherit';
      doc.pitch.length = span;
      return new THREE.Box3().setFromObject(generateRoofGroup(doc)).max.y;
    };
    expect(top(125)).toBeGreaterThan(top(95) + 1);
  });
});

describe('facade read floor by floor', () => {
  it('puts hospitality in the middle and plant at the top', () => {
    expect(storeyUses(0)).toEqual([]);
    expect(storeyUses(1)).toEqual(['windows']);
    expect(storeyUses(2)).toEqual(['windows', 'ribbon']);
    expect(storeyUses(4)).toEqual(['windows', 'ribbon', 'windows', 'louvres']);
    expect(storeyUses(5)).toEqual(['windows', 'windows', 'ribbon', 'windows', 'louvres']);
  });

  it('opens a walled facade with windows, a glazed ribbon and louvres', () => {
    const doc = createPresetDocument('traditional_four_stands_42k');
    doc.objects = [];
    const stands = generateStandsGroup(doc);
    expect(instances(stands, 'FacadeWindowPanes')).toBeGreaterThan(40);
    expect(instances(stands, 'FacadeRibbonPanes')).toBeGreaterThan(20);
    expect(instances(stands, 'FacadeLouvreBlades')).toBeGreaterThan(20);
    expect(named(stands, 'FacadeStringCourse')).toBeGreaterThan(4);
  });

  it('leaves a glazed curtain wall to its own mullion grid', () => {
    const doc = createPresetDocument('traditional_four_stands_42k');
    doc.objects = [];
    doc.materials!.facade = 'glass_curtain';
    for (const stand of Object.values(doc.stands)) stand.facadeMaterialOverride = 'inherit';
    expect(instances(generateStandsGroup(doc), 'FacadeWindowPanes')).toBe(0);
  });
});

describe('gables of stands left open by their corners', () => {
  it('reads the height of the rows from the stand outline', () => {
    const outline: [number, number][] = [
      [0, 0],
      [0, 1],
      [10, 6],
      [10, 9],
      [20, 14],
      [20, 0],
    ];
    expect(terraceHeightAt(outline, 5)).toBeCloseTo(3.5);
    // At a balcony front, the tier above.
    expect(terraceHeightAt(outline, 10)).toBeCloseTo(9);
    expect(terraceHeightAt(outline, 15)).toBeCloseTo(11.5);
  });

  it('finishes a solid stand on both ends like its facade, with exit doors', () => {
    const doc = createPresetDocument('traditional_four_stands_42k');
    doc.objects = [];
    const stands = generateStandsGroup(doc);
    expect(named(stands, 'StandGable')).toBe(8);
    expect(instances(stands, 'GableExitDoors')).toBeGreaterThanOrEqual(8);
    expect(named(stands, 'StandGableFrame')).toBe(0);
  });

  it('shows the end frame of a hollow stand instead', () => {
    const doc = createPresetDocument('traditional_four_stands_42k');
    doc.objects = [];
    doc.materials!.envelopeStyle = 'exposed_structure';
    for (const stand of Object.values(doc.stands)) stand.envelopeStyleOverride = 'inherit';
    const stands = generateStandsGroup(doc);
    expect(named(stands, 'StandGable')).toBe(0);
    expect(named(stands, 'StandGableFrame')).toBe(8);
    expect(instances(stands, 'EnvelopeRakers')).toBeGreaterThan(20);
    expect(instances(stands, 'EnvelopeFootings')).toBeGreaterThan(40);
  });

  it('has no gable where the corners are filled', () => {
    const doc = createPresetDocument('traditional_four_stands_42k');
    doc.objects = [];
    doc.cornerFill = true;
    doc.corners = { nw: 'filled', ne: 'filled', sw: 'filled', se: 'filled' };
    expect(named(generateStandsGroup(doc), 'StandGable')).toBe(0);
  });
});

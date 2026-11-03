import { jsPDF } from 'jspdf';
import { calculateStadiumMetrics, getTrackRadialOffset } from '../stadium/capacity';
import {
  clampPitchToTrack,
  getTrackGeometry,
  isContinuousBowlShape,
  STADIUM_SHAPE_LABELS,
  StadiumDocument,
  StandSide,
} from '../stadium/schema';
import { sanitizeFilename } from './exportPng';

/**
 * Generates an architectural A4 Landscape PDF technical blueprint containing:
 * - Scaled 2D Masterplan of the pitch, athletics track, 4 stands, roof outline, and placed objects
 * - Scale bar & North compass
 * - Architectural Cartouche / Title Block with capacity, C-value sightlines, surface, and budget
 */
export function exportArchitecturalPlanPdf(doc: StadiumDocument): void {
  const metrics = calculateStadiumMetrics(doc);
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageW = 297;
  const pageH = 210;

  // Blueprint sheet background & double architectural border
  pdf.setFillColor(248, 250, 252);
  pdf.rect(0, 0, pageW, pageH, 'F');

  pdf.setDrawColor(30, 41, 59);
  pdf.setLineWidth(0.6);
  pdf.rect(8, 8, pageW - 16, pageH - 16);
  pdf.setLineWidth(0.2);
  pdf.rect(10, 10, pageW - 20, pageH - 20);

  // Plan viewport area on left (195 x 182 mm)
  const planX = 14;
  const planY = 14;
  const planW = 190;
  const planH = 182;

  pdf.setFillColor(255, 255, 255);
  pdf.setDrawColor(203, 213, 225);
  pdf.rect(planX, planY, planW, planH, 'FD');

  // Subtle CAD grid
  pdf.setDrawColor(241, 245, 249);
  pdf.setLineWidth(0.15);
  for (let gx = planX + 10; gx < planX + planW; gx += 10) {
    pdf.line(gx, planY, gx, planY + planH);
  }
  for (let gy = planY + 10; gy < planY + planH; gy += 10) {
    pdf.line(planX, gy, planX + planW, gy);
  }

  // Compute meter-to-mm scale (fit ~280m width into 175mm => ~0.62 mm/m)
  const cx = planX + planW / 2;
  const cy = planY + planH / 2;
  const scale = 0.56; // 1 meter = 0.56 mm

  const safePitch = clampPitchToTrack(doc.pitch);
  const track = getTrackGeometry(safePitch);
  const trackOffsets = getTrackRadialOffset(doc);

  // 1. Draw Stands / Bowl in 2D Plan
  pdf.setFillColor(226, 232, 240);
  pdf.setDrawColor(71, 85, 105);
  pdf.setLineWidth(0.35);

  if (isContinuousBowlShape(doc.shape)) {
    const rxInner =
      (safePitch.length / 2 + doc.stands.east.distanceToPitch + trackOffsets.endOffset) *
      scale;
    const ryInner =
      (safePitch.width / 2 + doc.stands.south.distanceToPitch + trackOffsets.sideOffset) *
      scale;
    const depthMm = Math.max(metrics.stands.south.totalDepth, 16) * scale;
    const cornerInnerMm = Math.max(
      8 * scale,
      safePitch.hasTrack
        ? (ryInner - (doc.stands.south.distanceToPitch > 0 ? 0 : 0)) -
            Math.max(0, rxInner - ryInner - (track.straightHalfLength * scale - 0))
        : Math.min(
            doc.stands.east.distanceToPitch + trackOffsets.endOffset,
            doc.stands.south.distanceToPitch + trackOffsets.sideOffset
          ) * scale
    );
    const clampedCornerInnerMm = safePitch.hasTrack
      ? Math.min(ryInner, (track.outerRadius + doc.stands.south.distanceToPitch) * scale)
      : cornerInnerMm;
    const cornerOuterMm = clampedCornerInnerMm + depthMm;

    pdf.setFillColor(203, 213, 225);
    pdf.roundedRect(
      cx - (rxInner + depthMm),
      cy - (ryInner + depthMm),
      (rxInner + depthMm) * 2,
      (ryInner + depthMm) * 2,
      cornerOuterMm,
      cornerOuterMm,
      'FD'
    );
    pdf.setFillColor(248, 250, 252);
    pdf.roundedRect(
      cx - rxInner,
      cy - ryInner,
      rxInner * 2,
      ryInner * 2,
      clampedCornerInnerMm,
      clampedCornerInnerMm,
      'FD'
    );
    if (doc.shape === 'horseshoe') {
      // Clear open East end in 2D blueprint
      pdf.setFillColor(255, 255, 255);
      pdf.rect(
        cx + rxInner * 0.82,
        cy - (ryInner + depthMm + 2),
        depthMm + rxInner * 0.4,
        (ryInner + depthMm + 2) * 2,
        'F'
      );
    }
  } else {
    // North Stand
    if (doc.stands.north.enabled) {
      const m = metrics.stands.north;
      const dist =
        (safePitch.width / 2 + doc.stands.north.distanceToPitch + trackOffsets.sideOffset) *
        scale;
      const w = m.effectiveLength * scale;
      const d = m.totalDepth * scale;
      pdf.rect(cx - w / 2, cy - dist - d, w, d, 'FD');
    }
    // South Stand
    if (doc.stands.south.enabled) {
      const m = metrics.stands.south;
      const dist =
        (safePitch.width / 2 + doc.stands.south.distanceToPitch + trackOffsets.sideOffset) *
        scale;
      const w = m.effectiveLength * scale;
      const d = m.totalDepth * scale;
      pdf.rect(cx - w / 2, cy + dist, w, d, 'FD');
    }
    // East Stand
    if (doc.stands.east.enabled) {
      const m = metrics.stands.east;
      const dist =
        (safePitch.length / 2 + doc.stands.east.distanceToPitch + trackOffsets.endOffset) *
        scale;
      const h = m.effectiveLength * scale;
      const d = m.totalDepth * scale;
      pdf.rect(cx + dist, cy - h / 2, d, h, 'FD');
    }
    // West Stand
    if (doc.stands.west.enabled) {
      const m = metrics.stands.west;
      const dist =
        (safePitch.length / 2 + doc.stands.west.distanceToPitch + trackOffsets.endOffset) *
        scale;
      const h = m.effectiveLength * scale;
      const d = m.totalDepth * scale;
      pdf.rect(cx - dist - d, cy - h / 2, d, h, 'FD');
    }
  }

  // 2. Official 400 m World Athletics Track (84.39 m straights, 36.50 m inner kerb radius)
  if (safePitch.hasTrack) {
    const outerHalfX = (track.straightHalfLength + track.outerRadius) * scale;
    const outerHalfZ = track.outerRadius * scale;
    pdf.setFillColor(217, 119, 6);
    pdf.setDrawColor(146, 64, 14);
    pdf.setLineWidth(0.3);
    pdf.roundedRect(
      cx - outerHalfX,
      cy - outerHalfZ,
      outerHalfX * 2,
      outerHalfZ * 2,
      outerHalfZ,
      outerHalfZ,
      'FD'
    );

    // Mid-lane reference line
    const midR = (track.innerRadius + track.lanesWidth * 0.5) * scale;
    const midHalfX = track.straightHalfLength * scale + midR;
    pdf.setDrawColor(254, 243, 199);
    pdf.setLineWidth(0.15);
    pdf.roundedRect(cx - midHalfX, cy - midR, midHalfX * 2, midR * 2, midR, midR, 'S');

    // Inner kerb ("à la corde" R = 36.50 m) + grass D-zones
    const kerbR = track.innerRadius * scale;
    const kerbHalfX = track.infieldHalfLengthX * scale;
    pdf.setFillColor(42, 138, 68);
    pdf.setDrawColor(255, 255, 255);
    pdf.setLineWidth(0.3);
    pdf.roundedRect(
      cx - kerbHalfX,
      cy - kerbR,
      kerbHalfX * 2,
      kerbR * 2,
      kerbR,
      kerbR,
      'FD'
    );
  }

  // 3. FIFA Pitch & Markings
  const pw = safePitch.length * scale;
  const ph = safePitch.width * scale;
  pdf.setFillColor(34, 128, 62);
  pdf.setDrawColor(255, 255, 255);
  pdf.setLineWidth(0.35);
  pdf.rect(cx - pw / 2, cy - ph / 2, pw, ph, 'FD');

  // Halfway & Center Circle
  pdf.line(cx, cy - ph / 2, cx, cy + ph / 2);
  pdf.circle(cx, cy, 9.15 * scale, 'S');

  // Penalty Boxes
  const penD = 16.5 * scale;
  const penW = 40.32 * scale;
  pdf.rect(cx - pw / 2, cy - penW / 2, penD, penW, 'S');
  pdf.rect(cx + pw / 2 - penD, cy - penW / 2, penD, penW, 'S');

  // 4. Placed Infrastructure Objects
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6);
  for (const obj of doc.objects) {
    const ox = cx + obj.position[0] * scale;
    const oy = cy + obj.position[2] * scale;
    if (
      ox > planX + 4 &&
      ox < planX + planW - 4 &&
      oy > planY + 4 &&
      oy < planY + planH - 4
    ) {
      pdf.setFillColor(14, 165, 233);
      pdf.setDrawColor(15, 23, 42);
      pdf.circle(ox, oy, 1.8, 'FD');
      pdf.setTextColor(30, 41, 59);
      pdf.text(obj.name.slice(0, 18), ox + 2.5, oy + 1);
    }
  }

  // 5. North Arrow & Graphic Scale Bar
  pdf.setDrawColor(15, 23, 42);
  pdf.setLineWidth(0.4);
  const scale50m = 50 * scale;
  pdf.line(planX + 8, planY + planH - 8, planX + 8 + scale50m, planY + planH - 8);
  pdf.line(planX + 8, planY + planH - 10, planX + 8, planY + planH - 6);
  pdf.line(
    planX + 8 + scale50m,
    planY + planH - 10,
    planX + 8 + scale50m,
    planY + planH - 6
  );
  pdf.setFontSize(7.5);
  pdf.setTextColor(15, 23, 42);
  pdf.text('Échelle graphique : 50 m', planX + 8, planY + planH - 11.5);
  pdf.text('N ▲', planX + planW - 14, planY + 8);

  // 6. Right-hand Architectural Cartouche / Specification Table
  const colX = 209;
  const colW = 74;

  pdf.setFillColor(15, 23, 42);
  pdf.rect(colX, 14, colW, 22, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.text('STADIUMFORGE', colX + 5, 23);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(148, 163, 184);
  pdf.text('DOSSIER TECHNIQUE ARCHITECTURAL', colX + 5, 30);

  let yCursor = 45;
  const addRow = (label: string, val: string) => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    pdf.text(label, colX + 2, yCursor);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(15, 23, 42);
    pdf.text(val, colX + colW - 2, yCursor, { align: 'right' });
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.2);
    pdf.line(colX + 2, yCursor + 2, colX + colW - 2, yCursor + 2);
    yCursor += 7.5;
  };

  addRow('Projet', doc.name.slice(0, 26));
  addRow('Morphologie', STADIUM_SHAPE_LABELS[doc.shape].slice(0, 24));
  addRow('Terrain FIFA', `${safePitch.length} × ${safePitch.width} m`);
  addRow(
    'Piste Athlétisme',
    safePitch.hasTrack ? `Oui (${safePitch.trackLanes} couloirs · 400 m)` : 'Non'
  );
  addRow('Capacité Totale', `${metrics.totalCapacity.toLocaleString('fr-FR')} places`);
  addRow('Hauteur Toiture', `${metrics.maxRoofHeight} m`);
  addRow('Emprise Bâtie', `${metrics.builtFootprintM2.toLocaleString('fr-FR')} m²`);
  addRow('Surface Plancher', `${metrics.totalGrossFloorAreaM2.toLocaleString('fr-FR')} m²`);
  addRow('Qualité C-Value Moy.', `${metrics.avgCValueMm} mm`);
  addRow('Budget Estimatif', `${metrics.estimatedBudgetMillionsEur} M€`);
  addRow('Coût / Siège', `${metrics.costPerSeatEur.toLocaleString('fr-FR')} €`);

  yCursor += 5;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(15, 23, 42);
  pdf.text('DÉTAIL DES TRIBUNES', colX + 2, yCursor);
  yCursor += 6;

  const sideLabels: Record<StandSide, string> = {
    north: 'Nord',
    south: 'Sud',
    east: 'Est',
    west: 'Ouest',
  };

  (['north', 'south', 'east', 'west'] as StandSide[]).forEach((side) => {
    const sm = metrics.stands[side];
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(51, 65, 85);
    const desc = sm.enabled
      ? `${sm.totalRows} rg · ${sm.slopeDegrees}° · ${sm.capacity.toLocaleString('fr-FR')} pl.`
      : 'Désactivée';
    pdf.text(`Tribune ${sideLabels[side]}`, colX + 2, yCursor);
    pdf.text(desc, colX + colW - 2, yCursor, { align: 'right' });
    yCursor += 6;
  });

  // Footer date stamp
  pdf.setFontSize(7);
  pdf.setTextColor(148, 163, 184);
  pdf.text(
    `Généré le ${new Date().toLocaleDateString('fr-FR')} · Échelle 1:${Math.round(1000 / scale)}`,
    colX + 2,
    193
  );

  pdf.save(`${sanitizeFilename(doc.name)}-plan-2d.pdf`);
}

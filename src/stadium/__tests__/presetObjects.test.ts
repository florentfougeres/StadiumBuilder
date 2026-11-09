import { describe, expect, it } from 'vitest';
import { calculateStandMetrics, stadiumCornerLayout } from '../capacity';
import { createPresetDocument, STADIUM_PRESETS } from '../presets';
import { isContinuousBowlShape } from '../schema';

describe('preset shops', () => {
  for (const preset of STADIUM_PRESETS) {
    const doc = createPresetDocument(preset.id);
    const shops = doc.objects.filter((o) => o.type === 'shop');
    if (!shops.length || isContinuousBowlShape(doc.shape)) continue;
    it(`${preset.id}: shops stand clear of the stands`, () => {
      const layout = stadiumCornerLayout(doc);
      const southBack = layout.southZ + calculateStandMetrics(doc, 'south').totalDepth;
      const northBack = -layout.northZ + calculateStandMetrics(doc, 'north').totalDepth;
      for (const shop of shops) {
        const z = shop.position[2];
        const back = z >= 0 ? southBack : northBack;
        // Half the shop's 15 m depth, plus the facade and its entrance canopy.
        expect(Math.abs(z) - 7.5, shop.id).toBeGreaterThan(back + 3.7);
      }
    });
  }
});

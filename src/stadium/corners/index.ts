import type { CornerMode } from '../schema';
import { buildCornerBuilding } from './building';
import type { CornerStructureBuilder } from './kit';
import { buildCornerPavilion } from './pavilion';
import { buildCornerScreen } from './screen';
import { buildCornerSpiralTower } from './spiralTower';

export type { CornerStructureContext } from './kit';

/**
 * What stands in a corner instead of seats, by corner mode (`open` leaves it empty and `filled`
 * carries on the stands' rows, built with them). Adding a corner structure is one entry in
 * `CORNER_MODE_CATALOG` (materials.ts) and one builder here, in its own file under `corners/`.
 */
export const CORNER_STRUCTURES: Partial<Record<CornerMode, CornerStructureBuilder>> = {
  building: buildCornerBuilding,
  pavilion: buildCornerPavilion,
  spiral_tower: buildCornerSpiralTower,
  screen: buildCornerScreen,
};

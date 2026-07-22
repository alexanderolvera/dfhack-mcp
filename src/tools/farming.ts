import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface SeasonCrop {
  season: 'SPRING' | 'SUMMER' | 'AUTUMN' | 'WINTER';
  crop?: string;
  seeds_available?: number;
}

export interface FarmPlot {
  id: number;
  size: number;
  surface: boolean;
  seasons: SeasonCrop[];
  no_crop_assigned: boolean;
}

export interface SeedTotal {
  plant: string;
  count: number;
}

export interface Farming {
  plots: FarmPlot[];
  seed_totals: SeedTotal[];
}

export function farming(): Promise<Farming | { error: string }> {
  return runJsonScript<Farming>('farming', [], ['plots', 'seed_totals']);
}

export const farmingDef: ToolDef = {
  name: 'farming',
  title: 'Farming',
  description:
    "The fort's farm plots and seed stock as facts — the early-survival pipeline " +
    'that stocks (food OUTPUTS) and game_data (what is plantable, in the abstract) ' +
    "don't cover. Each plot's tile size, whether it's on the surface or " +
    'underground, its crop assignment for each of the 4 seasons (SPRING/SUMMER/' +
    'AUTUMN/WINTER; crop is the plant token or absent if that season is fallow), ' +
    "and how many seeds of that season's crop are currently in stock. " +
    'no_crop_assigned flags a plot with no crop assigned in ANY season — a plot ' +
    'doing nothing. seed_totals[] sums seed counts by plant across the whole fort ' +
    '(forbidden/dumped/rotten/trader-bound seeds excluded), independent of which ' +
    'plots use them. Returns {"error":"no fort loaded"} if no fort is active.',
  run: farming,
};

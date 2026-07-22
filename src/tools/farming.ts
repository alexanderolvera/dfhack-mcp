import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface SeasonCrop {
  season: 'SPRING' | 'SUMMER' | 'AUTUMN' | 'WINTER';
  crop?: string;
  eligible?: boolean;
  seeds_available?: number;
}

export interface FarmPlot {
  id: number;
  size: number;
  surface: boolean;
  seasons: SeasonCrop[];
  no_crop_assigned: boolean;
  no_eligible_crop: boolean;
}

export interface SeedTotal {
  plant: string;
  count: number;
}

export interface Farming {
  plots: FarmPlot[];
  plots_total: number;
  plots_truncated: boolean;
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
    'whether that crop is eligible to grow in that season (the plant raw\'s own ' +
    'season flag — absent when the season is fallow), and how many seeds of that ' +
    "season's crop are currently in stock. no_crop_assigned flags a plot with no " +
    'crop assigned in ANY season; no_eligible_crop flags a plot with no season ' +
    'holding BOTH an assigned crop AND eligibility (a strict superset of ' +
    'no_crop_assigned — a plot can have crops assigned yet still qualify if none of ' +
    'them are actually eligible for their season). seed_totals[] sums seed counts ' +
    'by plant across the whole fort (forbidden/dumped/rotten/trader-bound seeds ' +
    'excluded), independent of which plots use them. plots[] is capped at 200 ' +
    '(plots_total/plots_truncated track the real count and any overflow). Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  run: farming,
};

import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface SeasonCrop {
  season: 'SPRING' | 'SUMMER' | 'AUTUMN' | 'WINTER';
  crop?: string;
  eligible?: boolean;
}

export interface FarmPlot {
  id: number;
  size: number;
  open_to_sky: boolean;
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
  seed_totals_count: number;
  seed_totals_truncated: boolean;
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
    "don't cover. Each plot's tile size, whether it's open to the sky right now " +
    '(open_to_sky — light/weather exposure, NOT a surface-vs-underground fact: a ' +
    'roofed surface plot is open_to_sky:false, indistinguishable here from a ' +
    'genuinely underground one), its crop assignment for each of the 4 seasons ' +
    '(SPRING/SUMMER/AUTUMN/WINTER; crop is the plant token or absent if that ' +
    'season is fallow), whether that crop is eligible to grow in that season (the ' +
    'plant raw\'s own season flag — absent when the season is fallow). ' +
    'no_crop_assigned flags a plot with no crop assigned in ANY season; ' +
    'no_eligible_crop flags a plot with no season holding BOTH an assigned crop ' +
    'AND eligibility (a strict superset of no_crop_assigned — a plot can have ' +
    'crops assigned yet still qualify if none of them are actually eligible for ' +
    'their season). seed_totals[]/seed_totals_count/seed_totals_truncated sums ' +
    'seed counts by plant across the whole fort (forbidden/dumped/rotten/trader-' +
    'bound seeds excluded, capped at 100 distinct plants) — the single source for ' +
    'seed stock; join a plot season\'s crop token against it rather than looking ' +
    'for a per-plot seed count, which would just repeat the same fort-wide number ' +
    'under every plot growing that crop. plots[] is capped at 200 (plots_total/' +
    'plots_truncated track the real count and any overflow). Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  run: farming,
};

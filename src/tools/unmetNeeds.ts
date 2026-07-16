// unmet_needs(): the needs system aggregated into the fort's top stressors.
// Thin wrapper over the UNMET_NEEDS Lua query.

import { runJsonQuery } from '../query.ts';
import { UNMET_NEEDS } from '../dfhack-queries/unmetNeeds.ts';

export interface NeedRow {
  need: string;
  dwarves: number;
  worst_focus: number;
  suggestion?: string;
}

export interface UnmetNeeds {
  population: number;
  dwarves_with_unmet_need: number;
  top_needs: NeedRow[];
  alerts: string[];
}

export function unmetNeeds(): Promise<UnmetNeeds | { error: string }> {
  return runJsonQuery<UnmetNeeds>(UNMET_NEEDS, ['top_needs', 'alerts']);
}

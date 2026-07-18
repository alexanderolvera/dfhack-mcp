// unmet_needs(): the needs system aggregated into the fort's top stressors.
// Thin wrapper over the UNMET_NEEDS Lua query.

import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface NeedRow {
  need: string;
  dwarves: number;
  worst_focus: number;
}

export interface UnmetNeeds {
  population: number;
  dwarves_with_unmet_need: number;
  top_needs: NeedRow[];
  alerts: string[];
}

export function unmetNeeds(): Promise<UnmetNeeds | { error: string }> {
  return runJsonScript<UnmetNeeds>('unmetNeeds', [], ['top_needs', 'alerts']);
}

export const unmetNeedsDef: ToolDef = {
  name: 'unmet_needs',
  title: 'Unmet needs',
  description:
    'Why the fort is stressed: the dwarven needs system aggregated across all ' +
    'citizens. Returns the top unmet needs (e.g. prayer, drink, socializing) ' +
    'ranked by how many dwarves are distracted, each with the worst focus level ' +
    '(how starved the need is), plus how many dwarves have at least one unmet ' +
    'need. Reports which needs are unmet, not how to fix them (look that up or ' +
    'reason from the need type). Complements fort_status happiness. Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  run: unmetNeeds,
};

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
    "need. Reading worst_focus: it is DF's raw focus_level — 0 is neutral, " +
    'positive means recently satisfied (caps at 400), negative means starved. ' +
    'There is NO single floor: the minimum is -16320 x that dwarf\'s need_level ' +
    'for that need, so a level-1 need bottoms out at -16320, a level-2 need at ' +
    '-32640, a level-5 need at -81600. An identical worst_focus repeating across ' +
    'several needs is therefore normal — those needs share a need_level and are ' +
    'all fully starved — not a clamp or a quantization artifact; and a larger ' +
    'magnitude on one need does not by itself mean it is more starved than ' +
    'another, since the two may have different floors. Compare against the floor, ' +
    'not against zero. Reports which needs are unmet, not how to fix them (look that up or ' +
    'reason from the need type). Complements fort_status happiness. Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  run: unmetNeeds,
};

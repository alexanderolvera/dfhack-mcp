// threats(): dangerous units on the map, grouped and classified.
// Thin wrapper over the THREATS Lua query.

import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface ThreatGroup {
  name: string;
  count: number;
  contained: boolean;
  invader: boolean;
  undead: boolean;
  crazed: boolean;
  great_danger: boolean;
  // Tactical intel resolved from the group's representative unit's creature.
  token: string | null; // creature_id (a direct game_data handle), e.g. "DEMON_4"
  traits: string[]; // curated decisive traits: trapavoid, flier, fire, webber, building_destroyer, ranged
  ranged_attacks: string[]; // ranged/breath adv_names, e.g. ["Hurl fireball","Spray jet of fire"]
}

export interface Threats {
  active_hostiles: number;
  contained: number;
  groups: ThreatGroup[];
  alerts: string[];
}

export async function threats(): Promise<Threats | { error: string }> {
  const res = await runJsonScript<Threats>('threats', [], ['groups', 'alerts']);
  if ('error' in res) return res;
  // Per-group traits/ranged_attacks are nested, so the top-level list-field
  // normalization can't reach them: an empty Lua table encodes as {} not [].
  // Coerce each group's list fields to real arrays so consumers can iterate.
  for (const g of res.groups) {
    if (!Array.isArray(g.traits)) g.traits = [];
    if (!Array.isArray(g.ranged_attacks)) g.ranged_attacks = [];
  }
  return res;
}

export const threatsDef: ToolDef = {
  name: 'threats',
  title: 'Threats',
  description:
    'Dangerous units currently on the map, grouped by creature type. Separates ' +
    'ACTIVE hostiles from CONTAINED ones (caged/chained), flags great-danger ' +
    'creatures (megabeasts, titans, demons, forgotten beasts), invaders, and ' +
    'the undead, and returns a pre-triaged alerts list. Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  run: threats,
};

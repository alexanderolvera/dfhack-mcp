import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';
import { FOG_OF_WAR_NOTE, fogArgs, revealHiddenParam, type FogReport } from '../fog.ts';

export interface ThreatGroup {
  name: string;
  count: number;
  contained: boolean;
  invader: boolean;
  undead: boolean;
  crazed: boolean;
  great_danger: boolean;
  token: string | null;
  traits: string[];
  ranged_attacks: string[];
}

export interface Threats extends FogReport {
  active_hostiles: number;
  contained: number;
  groups: ThreatGroup[];
}

export async function threats(revealHidden?: boolean): Promise<Threats | { error: string }> {
  const res = await runJsonScript<Threats>('threats', fogArgs(revealHidden), ['groups']);
  if ('error' in res) return res;
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
    'the undead. Returns ' +
    '{"error":"no fort loaded"} if no fort is active. ' +
    FOG_OF_WAR_NOTE,
  shape: { reveal_hidden: revealHiddenParam },
  run: ({ reveal_hidden }) => threats(reveal_hidden),
};

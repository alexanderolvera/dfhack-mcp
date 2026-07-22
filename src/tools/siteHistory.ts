import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface NameEtymon {
  word: string;
  part?: string;
}

export interface SiteBattle {
  year?: number;
  type: string;
  attacker?: string;
  defender?: string;
  attacker_general?: string;
  defender_general?: string;
  outcome?: string;
}

export interface SiteDeath {
  name: string;
  year?: number;
  race?: string;
  cause?: string;
  slain_by?: string;
}

export interface Founding {
  year?: number;
  date?: string;
  civ_id: number;
  civ?: string;
  civ_english?: string;
  builder?: string;
}

export interface SiteHistory {
  site_id: number;
  site_name?: string;
  site_name_english?: string;
  site_type: string;
  pos: { x: number; y: number };
  current_year: number;
  age_years?: number;
  founding: Founding;
  name_etymology: NameEtymon[];
  battles: SiteBattle[];
  battles_truncated?: boolean;
  battles_total?: number;
  notable_deaths: SiteDeath[];
  notable_deaths_truncated?: boolean;
  notable_deaths_total?: number;
}

export function siteHistory(): Promise<SiteHistory | { error: string }> {
  return runJsonScript<SiteHistory>('siteHistory', [], [
    'name_etymology',
    'battles',
    'notable_deaths',
  ]);
}

export const siteHistoryDef: ToolDef = {
  name: 'site_history',
  title: 'Site history',
  description:
    "This fort's entry in the PERMANENT world saga (the durable history event log, " +
    'not the pruned live report stream). Returns the founding (year, in-game date, ' +
    'and owning civilization in both Dwarven and English), the fort name in Dwarven ' +
    'and English with a word-by-word etymology, prior sieges/battles fought AT this ' +
    'site (attacker/defender civ and general, capped at 20, most-recent-first), and ' +
    'the notable historical figures who died here (name, race, cause, slayer, capped ' +
    'at 25). Scoped strictly to the loaded site. A young fort with no war history ' +
    'degrades to empty battle/death lists (not an error). Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  run: siteHistory,
};

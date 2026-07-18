// site_history: this fort's entry in the PERMANENT world saga — founding (year,
// date, owning civ), the fort name in Dwarven + English with a word etymology,
// prior sieges/battles fought AT this site, and the notable historical figures
// who died here. Reads the durable event log (df.global.world.history.events),
// scoped strictly to the loaded site. Thin wrapper over the SITE_HISTORY Lua query.

import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

/** One word of the site name, glossed to its English root + part of speech. */
export interface NameEtymon {
  word: string; // English root, e.g. "FORTRESS"
  part?: string; // part of speech, e.g. "Noun" / "NounPlural"
}

/** A prior siege/battle fought AT this site (a site-scoped war event). */
export interface SiteBattle {
  year?: number;
  type: string; // WAR_ATTACKED_SITE | WAR_DESTROYED_SITE | WAR_SITE_NEW_LEADER
  attacker?: string; // attacking civ (English name)
  defender?: string; // defending civ (English name)
  attacker_general?: string; // attacking general (historical figure)
  defender_general?: string; // defending general (historical figure)
  outcome?: string; // set when the saga records one (e.g. "site destroyed")
}

/** A notable historical figure who died at this site. */
export interface SiteDeath {
  name: string; // English name
  year?: number;
  race?: string; // creature token, e.g. "DWARF"
  cause?: string; // df.death_type token, e.g. "BLEED"
  slain_by?: string; // killer's name, present only when slain by a figure
}

export interface Founding {
  year?: number;
  date?: string; // e.g. "15th Granite, Year 5"
  civ_id: number;
  civ?: string; // owning civ, Dwarven form
  civ_english?: string; // owning civ, English form
  builder?: string; // founder's name, present only when the saga records one
}

export interface SiteHistory {
  site_id: number;
  site_name?: string; // Dwarven form, e.g. "Geshud Nåzom"
  site_name_english?: string; // English form, e.g. "Fortress of Dreams"
  site_type: string; // df.world_site_type token, e.g. "PlayerFortress"
  pos: { x: number; y: number };
  current_year: number;
  age_years?: number;
  founding: Founding;
  name_etymology: NameEtymon[];
  battles: SiteBattle[]; // capped at 20, most-recent-first
  battles_truncated?: boolean;
  battles_total?: number; // full count, present only when truncated
  notable_deaths: SiteDeath[]; // capped at 25, most-recent-first
  notable_deaths_truncated?: boolean;
  notable_deaths_total?: number; // full count, present only when truncated
}

export function siteHistory(): Promise<SiteHistory | { error: string }> {
  // Normalize the list fields: an empty Lua table can encode as {} rather than [].
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

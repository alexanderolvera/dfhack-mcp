import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface DeathCause {
  cause: string;
  count: number;
}

export interface RecentDeaths {
  since_year: number;
  citizens: number;
  citizens_slain_by_citizen: number;
  outsiders_at_site: number;
  citizen_causes: DeathCause[];
}

export interface FortStatus {
  fort_name: string;
  date: string;
  season: string;
  population: number;
  wealth: number;
  happiness: { miserable: number; unhappy: number; content: number; happy: number };
  recent_deaths: RecentDeaths;
  alerts: string[];
}

export async function fortStatus(): Promise<FortStatus | { error: string }> {
  const data = await runJsonScript<FortStatus>('fortStatus', [], ['alerts']);
  if ('error' in data) return data;
  if (data.recent_deaths && !Array.isArray(data.recent_deaths.citizen_causes)) {
    data.recent_deaths.citizen_causes = [];
  }
  return data;
}

export const fortStatusDef: ToolDef = {
  name: 'fort_status',
  title: 'Fort status',
  description:
    'One-call situational overview of the currently loaded Dwarf Fortress fort: ' +
    'name, in-game date and season, population, created wealth, a happiness ' +
    'breakdown (miserable/unhappy/content/happy), recent_deaths, and a pre-triaged ' +
    'list of alerts worth attention. recent_deaths covers deaths recorded AT THIS ' +
    'SITE within the last game year: how many were the fort\'s own citizens, what ' +
    'killed them (citizen_causes, e.g. THIRST/STARVATION/STRUCK_DOWN), how many of ' +
    'those citizens were slain BY another citizen (the murder/loyalty-cascade ' +
    'signal, which no other tool reports), and how many of the dead were outsiders ' +
    'rather than fort members. Citizenship is the victim\'s membership in the fort ' +
    "group, so another civilization's dwarves killed at your gate count as " +
    'outsiders, not as your losses. Returns {"error":"no fort loaded"} if no fort is active.',
  run: fortStatus,
};

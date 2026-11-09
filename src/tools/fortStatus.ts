import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';
import { normalizeIdentity, type Identity } from './gameState.ts';

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
  identity: Identity | null;
  population: number;
  wealth: number;
  happiness: { miserable: number; unhappy: number; content: number; happy: number };
  recent_deaths: RecentDeaths;
  hostiles_on_map: number;
}

export async function fortStatus(): Promise<FortStatus | { error: string }> {
  const data = await runJsonScript<FortStatus>('fortStatus');
  if ('error' in data) return data;
  if (data.recent_deaths && !Array.isArray(data.recent_deaths.citizen_causes)) {
    data.recent_deaths.citizen_causes = [];
  }
  data.identity = normalizeIdentity(data.identity);
  return data;
}

export const fortStatusDef: ToolDef = {
  name: 'fort_status',
  title: 'Fort status',
  description:
    'One-call situational overview of the currently loaded Dwarf Fortress fort: ' +
    'name, in-game date and season, identity (world_name, save_folder, site_id/site_name, ' +
    'civ_id/civ_name; names as {dwarven, english}), population, created wealth, a happiness ' +
    'breakdown (miserable/unhappy/content/happy), recent_deaths, and ' +
    'hostiles_on_map (discovered, non-citizen dangerous units, caged/chained ones ' +
    'included). recent_deaths covers deaths recorded AT THIS ' +
    'SITE within the last game year: how many were the fort\'s own citizens, what ' +
    'killed them (citizen_causes, e.g. THIRST/STARVATION/STRUCK_DOWN), how many of ' +
    'those citizens were slain BY another citizen (the murder/loyalty-cascade ' +
    'signal, which no other tool reports), and how many of the dead were outsiders ' +
    'rather than fort members. Citizenship is the victim\'s membership in the fort ' +
    "group, so another civilization's dwarves killed at your gate count as " +
    'outsiders, not as your losses. Returns {"error":"no fort loaded"} if no fort is active.',
  run: fortStatus,
};

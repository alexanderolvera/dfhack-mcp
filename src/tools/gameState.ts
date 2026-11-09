import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface NamePair {
  dwarven: string | null;
  english: string | null;
}

export interface Identity {
  world_name: NamePair | null;
  save_folder: string | null;
  site_id: number | null;
  site_name: NamePair | null;
  civ_id: number | null;
  civ_name: NamePair | null;
}

export interface GameClock {
  year: number;
  year_tick: number;
  date: string;
  season: string;
}

export interface GameState {
  dfhack_version: string;
  df_version: string;
  mode: 'title' | 'fortress' | 'adventure' | 'other';
  world_loaded: boolean;
  map_loaded: boolean;
  paused: boolean | null;
  clock: GameClock | null;
  identity: Identity | null;
}

function normalizeNamePair(raw: Partial<NamePair> | null | undefined): NamePair | null {
  if (!raw) return null;
  return { dwarven: raw.dwarven ?? null, english: raw.english ?? null };
}

/**
 * Fills the fields Lua's JSON encoder drops when nil, so every identity key is present.
 * @param raw The identity object as decoded from a query script, if any.
 * @returns The identity with absent fields set to null, or null if there was none.
 */
export function normalizeIdentity(raw: Partial<Identity> | null | undefined): Identity | null {
  if (!raw) return null;
  return {
    world_name: normalizeNamePair(raw.world_name),
    save_folder: raw.save_folder || null,
    site_id: raw.site_id ?? null,
    site_name: normalizeNamePair(raw.site_name),
    civ_id: raw.civ_id ?? null,
    civ_name: normalizeNamePair(raw.civ_name),
  };
}

export async function gameState(): Promise<GameState | { error: string }> {
  const data = await runJsonScript<GameState>('gameState');
  if ('error' in data) return data;
  return {
    ...data,
    paused: data.paused ?? null,
    clock: data.clock ?? null,
    identity: normalizeIdentity(data.identity),
  };
}

export const gameStateDef: ToolDef = {
  name: 'game_state',
  title: 'Game state',
  description:
    'What DFHack and Dwarf Fortress are doing right now, readable at ANY screen — the one ' +
    'tool that works with no fort loaded (every other game tool answers {"error":"no fort ' +
    'loaded"} at the title screen). Reports dfhack_version and df_version; mode ' +
    '(title/fortress/adventure/other); world_loaded and map_loaded; and, once a world is ' +
    'loaded, paused, the raw clock (year, year_tick — 403,200 ticks per year — plus the ' +
    'formatted date and season fort_status prints) and identity: world_name, save_folder and, ' +
    'in fortress mode, site_id/site_name and civ_id/civ_name (names as {dwarven, english}). ' +
    'Before a world loads, paused/clock/identity are null. Small fixed-size payload, cheap ' +
    'enough to poll.',
  run: gameState,
};

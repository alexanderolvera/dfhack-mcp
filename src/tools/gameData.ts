// game_data(query, kind?): look up the loaded world's raws (ground truth for
// THIS world) and return curated, labeled facts. MVP implements the CREATURE
// kind; other kinds report "not yet implemented". The Lua is centralized in
// src/lua/queries.ts (gameDataQuery) with a per-kind dispatch so adding kinds
// later never adds a tool. See that file for the confirmed field paths.

import { runJsonQuery } from '../query.ts';
import { gameDataQuery } from '../lua/queries.ts';

export type GameDataKind = 'creature' | 'material' | 'plant' | 'reaction' | 'item' | 'building';

export interface CreatureAttack {
  name: string;
  verb?: string;
}

export interface CreatureInteraction {
  name: string;      // human breath-weapon label, e.g. "Hurl fireball"
  material?: string; // emitted material token, e.g. CREATURE_MAT:DEMON_4:POISON
}

/** A single strong hit: the full curated creature dossier. */
export interface CreatureDossier {
  kind: 'creature';
  token: string;             // creature_id, e.g. "DEMON_4"
  name: string;              // singular name, e.g. "flame phantom"
  plural?: string;
  caste_count: number;
  size: number;              // body volume, cm^3
  size_label: string;        // tiny|small|medium|large|huge|gigantic
  flags: string[];           // curated advisor-relevant caste flags
  attacks: CreatureAttack[];
  interactions: CreatureInteraction[];
  description?: string;
  blurb?: string;
  unit_id?: number;          // set when resolved via a live unit_id query
  unit_name?: string;
}

export interface GameDataStub {
  kind: 'creature';
  token: string;
  name: string;
  blurb: string;
}

/** Several hits (or none): a disambiguation list, mirroring find_unit. */
export interface GameDataMatches {
  query: string;
  match_count: number;
  truncated?: boolean;
  matches: GameDataStub[];
}

export type GameData = CreatureDossier | GameDataMatches;

export async function gameData(
  query: string,
  kind?: GameDataKind
): Promise<GameData | { error: string }> {
  const data = await runJsonQuery<GameData>(gameDataQuery(query, kind), []);
  if ('error' in data) return data;

  // Normalize list fields per shape (an empty Lua table encodes as {} not []).
  const d = data as any;
  if ('match_count' in d) {
    if (!Array.isArray(d.matches)) d.matches = [];
  } else {
    for (const f of ['flags', 'attacks', 'interactions']) {
      if (!Array.isArray(d[f])) d[f] = [];
    }
  }
  return data;
}

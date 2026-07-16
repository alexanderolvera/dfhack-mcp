// military(): squads, soldier headcount, and readiness vs. live threats.
// Thin wrapper over the MILITARY Lua query.

import { runJsonQuery } from '../query.ts';
import { MILITARY } from '../dfhack-queries/military.ts';

export interface SquadRow {
  name: string;
  filled: number;
  positions: number;
}

export interface Military {
  squad_count: number;
  soldiers: number;
  assigned_positions: number;
  adults: number;
  hostiles_on_map: number;
  great_danger_on_map: number;
  squads: SquadRow[];
  alerts: string[];
}

export function military(): Promise<Military | { error: string }> {
  return runJsonQuery<Military>(MILITARY, ['squads', 'alerts']);
}

// find_unit(query): dossier on citizens matching a name or profession.
// One of the two parameterized tools — passes the search term as native argv to
// the mcp_findUnit.lua script (no escaping; the term is just data).

import { runJsonScript } from '../query.ts';

export interface UnitMatch {
  name: string;
  profession: string;
  age: number;
  stress: string;
  current_job: string;
  squad?: string;
  wounded: boolean;
  patient: boolean;
  unconscious: boolean;
}

export interface FindUnit {
  query: string;
  match_count: number;
  truncated: boolean;
  matches: UnitMatch[];
}

export function findUnit(query: string): Promise<FindUnit | { error: string }> {
  return runJsonScript<FindUnit>('findUnit', [query], ['matches']);
}

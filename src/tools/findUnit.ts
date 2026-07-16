// find_unit(query): dossier on citizens matching a name or profession.
// The one parameterized tool — builds the Lua per call.

import { runJsonQuery } from '../query.ts';
import { findUnitQuery } from '../dfhack-queries/findUnit.ts';

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
  return runJsonQuery<FindUnit>(findUnitQuery(query), ['matches']);
}

// find_unit(query): dossier on citizens matching a name or profession.
// One of the two parameterized tools — passes the search term as native argv to
// the mcp_findUnit.lua script (no escaping; the term is just data).

import { runJsonScript } from '../query.ts';
import { z } from 'zod';
import type { ToolDef } from '../register.ts';

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

export const findUnitDef: ToolDef = {
  name: 'find_unit',
  title: 'Find unit',
  description:
    'Look up citizens by a name fragment or profession (case-insensitive, ' +
    'matches either). Returns a compact dossier per match: profession, age, ' +
    'stress level, current job, squad, and health flags (wounded/patient/' +
    'unconscious). Useful for questions like "how is the chief medical dwarf" ' +
    'or "find Urist". Each match carries a unit_id — pass it to citizen() for a ' +
    'deep dossier (personality, the walkable social graph, worship, skills, ' +
    'preferences, recent thoughts). Returns {"error":"no fort loaded"} if no ' +
    'fort is active.',
  shape: { query: z.string().min(1).describe('Name fragment or profession to search for') },
  run: ({ query }) => findUnit(query),
};

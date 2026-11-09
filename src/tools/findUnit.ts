import { runJsonScript } from '../query.ts';
import { readSnapshot, snapshotEnabled, type Snapshot } from '../snapshot.ts';
import { z } from 'zod';
import type { ToolDef } from '../register.ts';

export interface UnitMatch {
  unit_id: number;
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

const MAX_MATCHES = 8;
const STRESS = ['miserable', 'unhappy', 'unhappy', 'content', 'content', 'happy', 'ecstatic'];

const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * Builds find_unit's payload from a publisher snapshot, matching the Lua query's output.
 * @param snap A complete snapshot from `readSnapshot`.
 * @param query Name fragment or profession, matched case-insensitively (ASCII, as Lua's `string.lower`).
 * @returns The same shape `mcp_findUnit.lua` emits.
 */
export function projectFindUnit(snap: Snapshot, query: string): FindUnit {
  const q = asciiLower(query);
  const squadName = new Map(snap.squads.map((s) => [s.id, s.name]));
  const hits = snap.units.filter(
    (u) =>
      u.citizen &&
      !u.error &&
      (asciiLower(u.name).includes(q) || asciiLower(u.profession).includes(q))
  );
  const matches = hits.slice(0, MAX_MATCHES).map((u): UnitMatch => {
    const sc = u.stress_category;
    const squad = u.squad_id === undefined ? undefined : squadName.get(u.squad_id);
    return {
      unit_id: u.id,
      name: u.name,
      profession: u.profession,
      age: u.age,
      stress: sc === undefined ? 'nil' : (STRESS[sc] ?? String(sc)),
      current_job: u.job_type ?? 'idle',
      ...(squad === undefined ? {} : { squad }),
      wounded: u.wound_count > 0,
      patient: u.needs_healthcare,
      unconscious: u.unconscious > 0,
    };
  });
  return { query, match_count: hits.length, truncated: hits.length > matches.length, matches };
}

export async function findUnit(query: string): Promise<FindUnit | { error: string }> {
  if (!snapshotEnabled()) return runJsonScript<FindUnit>('findUnit', [query], ['matches']);
  const snap = await readSnapshot();
  return 'error' in snap ? snap : projectFindUnit(snap, query);
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
    'preferences, recent thoughts). Lists at most 8 matches; match_count is ' +
    'always the full total and truncated flags when capped, so narrow the ' +
    'query to see the rest. Returns {"error":"no fort loaded"} if no ' +
    'fort is active.',
  shape: { query: z.string().min(1).describe('Name fragment or profession to search for') },
  run: ({ query }) => findUnit(query),
};

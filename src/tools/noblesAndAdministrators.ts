import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface PositionHolder {
  histfig_id: number;
  unit_id?: number;
  name: string;
}

export interface PositionRow {
  code: string;
  name: string;
  vacant: boolean;
  holders: PositionHolder[];
  superseded_by?: string;
}

export interface NoblesAndAdministrators {
  positions: PositionRow[];
  bookkeeper_precision_level: number;
  mayor_election_pending: boolean;
  monarch: { arrived: boolean; hasty: boolean };
}

export async function noblesAndAdministrators(): Promise<NoblesAndAdministrators | { error: string }> {
  const data = await runJsonScript<NoblesAndAdministrators>('noblesAndAdministrators', [], ['positions']);
  if ('error' in data) return data;
  for (const row of data.positions ?? []) {
    if (!Array.isArray(row.holders)) row.holders = [];
  }
  return data;
}

export const noblesAndAdministratorsDef: ToolDef = {
  name: 'nobles_and_administrators',
  title: 'Nobles and administrators',
  description:
    "The fort's appointed positions (manager, bookkeeper, broker, chief medical " +
    'dwarf, sheriff, expedition leader/mayor, militia commander/captain, hammerer, ' +
    'and any higher noble the site has grown into) as facts: each position\'s ' +
    'holder(s) or vacancy — each holder always carries histfig_id, plus unit_id ' +
    'when that historical figure has a loaded unit on this map (a holder living ' +
    'off-map still has no unit_id). A vacant position is a common, otherwise-invisible ' +
    'cause of "why won\'t this validate" — work_order_create needs a manager, ' +
    'trade needs a broker, mandates_and_justice punishments need a hammerer. ' +
    'superseded_by names the position a role hands its responsibilities to once ' +
    'filled (e.g. sheriff -> captain of the guard, expedition leader -> mayor) — a ' +
    'vacancy there is often expected, not a problem. Also reports the bookkeeper\'s ' +
    'precision level (0-4, higher = more accurate stock counts, set on the Nobles ' +
    'screen), whether a mayoral election is currently forced/pending, and whether ' +
    "the civilization's monarch has arrived at the site (and if so, hastily). " +
    'Returns {"error":"no fort loaded"} if no fort is active.',
  run: noblesAndAdministrators,
};

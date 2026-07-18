// fort_status: one-call situational overview of the loaded fort.
// Thin wrapper over the FORT_STATUS Lua query.

import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface FortStatus {
  fort_name: string;
  date: string;
  season: string;
  population: number;
  wealth: number;
  happiness: { miserable: number; unhappy: number; content: number; happy: number };
  alerts: string[];
}

export function fortStatus(): Promise<FortStatus | { error: string }> {
  return runJsonScript<FortStatus>('fortStatus', [], ['alerts']);
}

export const fortStatusDef: ToolDef = {
  name: 'fort_status',
  title: 'Fort status',
  description:
    'One-call situational overview of the currently loaded Dwarf Fortress fort: ' +
    'name, in-game date and season, population, created wealth, a happiness ' +
    'breakdown (miserable/unhappy/content/happy), and a pre-triaged list of ' +
    'alerts worth attention. Returns {"error":"no fort loaded"} if no fort is active.',
  run: fortStatus,
};

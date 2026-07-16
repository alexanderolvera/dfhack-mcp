// fort_status: one-call situational overview of the loaded fort.
// Thin wrapper over the FORT_STATUS Lua query.

import { runJsonQuery } from '../query.ts';
import { FORT_STATUS } from '../dfhack-queries/fortStatus.ts';

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
  return runJsonQuery<FortStatus>(FORT_STATUS, ['alerts']);
}

// injuries_and_health(): the fort's medical picture — patients and care needs.
// Thin wrapper over the INJURIES_AND_HEALTH Lua query.

import { runJsonScript } from '../query.ts';

export interface CareRow {
  care: string;
  count: number;
}

export interface InjuriesAndHealth {
  population: number;
  wounded: number;
  patients: number;
  bedridden: number;
  unconscious: number;
  care_needs: CareRow[];
  alerts: string[];
}

export function injuriesAndHealth(): Promise<InjuriesAndHealth | { error: string }> {
  return runJsonScript<InjuriesAndHealth>('injuriesAndHealth', [], ['care_needs', 'alerts']);
}

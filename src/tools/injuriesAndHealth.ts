// injuries_and_health(): the fort's medical picture — patients and care needs.
// Thin wrapper over the INJURIES_AND_HEALTH Lua query.

import { runJsonQuery } from '../query.ts';
import { INJURIES_AND_HEALTH } from '../dfhack-queries/injuriesAndHealth.ts';

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
  return runJsonQuery<InjuriesAndHealth>(INJURIES_AND_HEALTH, ['care_needs', 'alerts']);
}

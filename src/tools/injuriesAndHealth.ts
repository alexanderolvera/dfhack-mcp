import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

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

export const injuriesAndHealthDef: ToolDef = {
  name: 'injuries_and_health',
  title: 'Injuries and health',
  description:
    "The fort's medical picture: how many dwarves are wounded, in the care " +
    'queue (patients), bedridden, or unconscious, plus a breakdown of what ' +
    'care is needed (diagnosis, surgery, suture, dressing, ...) so gaps in ' +
    'medical coverage are visible. Returns {"error":"no fort loaded"} if no ' +
    'fort is active.',
  run: injuriesAndHealth,
};

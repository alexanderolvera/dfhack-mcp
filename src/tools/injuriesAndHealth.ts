import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface CareRow {
  care: string;
  count: number;
}

export interface InjuriesAndHealth {
  population: number;
  wounded: number;
  old_wounds_only: number;
  patients: number;
  bedridden: number;
  unconscious: number;
  asleep: number;
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
    "The fort's medical picture, counted on CURRENT condition rather than on " +
    'history. wounded = dwarves carrying at least one wound with live damage ' +
    '(bleeding, pain, swelling, an unset fracture, a severed part, infection). ' +
    'old_wounds_only = dwarves whose every wound has resolved to a scar or to an ' +
    'inert record — DF never deletes a healed wound, so these keep a wound entry ' +
    'forever and are NOT casualties. patients = dwarves the game itself flags as ' +
    'needing healthcare, bedridden = flagged should-not-move. unconscious counts ' +
    'only genuine unconsciousness: a normally SLEEPING dwarf also carries a ' +
    "nonzero unconscious counter, so sleepers are excluded and reported as " +
    'asleep instead. care_needs breaks down what care the game is asking for ' +
    '(diagnosis, surgery, suture, dressing, crutch, ...) so gaps in medical ' +
    'coverage are visible; it is empty when no dwarf currently needs care. ' +
    'Returns {"error":"no fort loaded"} if no fort is active.',
  run: injuriesAndHealth,
};

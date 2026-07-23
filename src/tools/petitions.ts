import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface LocationPetition {
  agreement_id: number;
  building: 'TEMPLE' | 'GUILDHALL';
  tier: 1 | 2;
  petitioner: string;
  deity?: string;
  guild_profession?: string;
  agreed_year: number;
  age_days: number;
  warned_ready: boolean;
  awaiting_decision: boolean;
  status: 'outstanding' | 'satisfied' | 'denied' | 'expired';
}

export interface ResidencyPetition {
  agreement_id: number;
  kind: 'Residency' | 'Citizenship';
  petitioner: string;
  agreed_year: number;
  age_days: number;
  deadline_days: number | null;
  awaiting_decision: boolean;
  status: 'outstanding' | 'satisfied' | 'denied' | 'expired';
}

export interface Petitions {
  location_petitions: LocationPetition[];
  location_petitions_truncated: boolean;
  residency_petitions: ResidencyPetition[];
  residency_petitions_truncated: boolean;
  awaiting_decision_count: number;
  alerts: string[];
}

export function petitions(): Promise<Petitions | { error: string }> {
  return runJsonScript<Petitions>(
    'petitions',
    [],
    ['location_petitions', 'residency_petitions', 'alerts']
  );
}

export const petitionsDef: ToolDef = {
  name: 'petitions',
  title: 'Petitions',
  description:
    "The fort's outstanding agreements as facts: location petitions (temple/guildhall " +
    "requests from a deity's worshippers or a guild) and residency/citizenship petitions " +
    '(a migrant or visitor asking to join the fort), each with its petitioner, agreed date, ' +
    'and resolution status. location_petitions[] carries building (TEMPLE/GUILDHALL), tier ' +
    '(1 = temple/guildhall, 2 = complex/grand), the petitioning deity (temple) or guild ' +
    'profession (guildhall) when one was named, age_days since the petition was raised, and ' +
    'warned_ready (the fort has already been told the location can be established — a ' +
    'still-outstanding petition with warned_ready true is the classic silent-failure case: ' +
    'agreed to but never actually zoned). residency_petitions[] carries kind ' +
    '(Residency/Citizenship), age_days, and deadline_days (days left before the petitioner\'s ' +
    'patience runs out, null if no timeout is tracked). Both carry awaiting_decision (true if ' +
    "the petition sits in the fort's pending decision queue right now) and status " +
    '(outstanding/satisfied/denied/expired, derived from the agreement\'s own flags — see the ' +
    'doc for how this maps to DFHack fields). This is the demand-fulfillment counterpart to ' +
    "rooms_and_zones's temple/guildhall inventory (needed_by_worshippers there is inferred " +
    'from citizen worship with no formal petition yet; a row here is an actual agreement DF ' +
    'is tracking) — compose the two rather than expecting either to duplicate the other. ' +
    'Lists are capped at 50 each (see the *_truncated flags). Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  run: petitions,
};

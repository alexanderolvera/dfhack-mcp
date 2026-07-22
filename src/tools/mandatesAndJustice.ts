import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface NobleRow {
  position: string;
  noble: string;
  can_mandate: number;
  can_demand: number;
}

export interface MandateRow {
  noble: string;
  kind: 'make';
  item: string;
  count: number;
  remaining: number;
  deadline_days: number | null;
}

export interface GuildDemand {
  noble: string;
  item: string;
}

export interface DemandRow {
  noble: string;
  position: string;
  demand: 'office' | 'bedroom' | 'dining' | 'tomb';
  required_value: number;
  met: false;
}

export interface Justice {
  active: boolean;
  open_cases: number;
  pending_punishments: number;
  prison_sentences: number;
  scheduled_beatings: number;
  scheduled_hammerstrikes: number;
  restraints_built: number;
  restraints_free: number;
}

export interface MandatesAndJustice {
  population: number;
  nobles: NobleRow[];
  mandates: MandateRow[];
  mandates_truncated: boolean;
  export_bans: string[];
  export_bans_truncated: boolean;
  guild_demands: GuildDemand[];
  demands: DemandRow[];
  demands_truncated: boolean;
  justice: Justice;
  alerts: string[];
}

export function mandatesAndJustice(): Promise<MandatesAndJustice | { error: string }> {
  return runJsonScript<MandatesAndJustice>(
    'mandatesAndJustice',
    [],
    ['nobles', 'mandates', 'export_bans', 'guild_demands', 'demands', 'alerts']
  );
}

export const mandatesAndJusticeDef: ToolDef = {
  name: 'mandates_and_justice',
  title: 'Mandates and justice',
  description:
    "The fort's nobility overhead as facts. Active production mandates (a noble's " +
    'make-N-of-an-item quota with its remaining count and days to deadline) and ' +
    'export bans, listed by item. Unmet noble room demands (an appointed noble ' +
    'holds no room zone of a type their position requires: office, bedroom, ' +
    'dining, tomb). Justice state: open criminal cases, convictions awaiting ' +
    'punishment (prison sentences, scheduled beatings and hammerstrikes), and ' +
    'restraint capacity (chains + cages built vs. how many are free) so you can ' +
    'see whether a sentence can be served. Reports what the nobles demand and ' +
    'the justice backlog, not what to build about it; threshold restatements are ' +
    'in alerts. Lists are capped (see the *_truncated flags). Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  run: mandatesAndJustice,
};

import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface DepotState {
  exists: boolean;
  accessible: boolean;
  complete: boolean;
  trader_requested: boolean;
}

export interface CaravanCiv {
  name?: string;
  race?: string;
}

export interface CaravanRow {
  state: 'None' | 'Approaching' | 'AtDepot' | 'Leaving' | 'Stuck' | string;
  civ?: CaravanCiv;
  leaving_in_days?: number;
}

export interface BrokerState {
  assigned: boolean;
  at_depot: boolean;
  name?: string;
  present?: boolean;
  current_job?: string;
}

export interface Trade {
  depot: DepotState;
  goods_at_depot: { count: number; approx_value: number };
  caravans: CaravanRow[];
  caravan_count: number;
  caravans_truncated: boolean;
  broker: BrokerState;
  alerts: string[];
}

export function trade(): Promise<Trade | { error: string }> {
  return runJsonScript<Trade>('trade', [], ['caravans', 'alerts']);
}

export const tradeDef: ToolDef = {
  name: 'trade',
  title: 'Trade and caravans',
  description:
    'The trade picture right now: whether a trade depot exists, is complete, and ' +
    "is wagon-accessible (DF's own pathability check, not merely built); which " +
    'caravans are present and their lifecycle state (none / approaching / at ' +
    'depot / leaving, with days remaining where knowable) and civ; whether a ' +
    'broker is assigned, present, at the depot, and their current job; and the ' +
    'count and approximate value of goods staged in the depot. Reports the state, ' +
    'not what to trade. Returns {"error":"no fort loaded"} if no fort is active.',
  run: trade,
};

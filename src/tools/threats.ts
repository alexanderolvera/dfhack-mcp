// threats(): dangerous units on the map, grouped and classified.
// Thin wrapper over the THREATS Lua query.

import { runJsonQuery } from '../query.ts';
import { THREATS } from '../lua/queries.ts';

export interface ThreatGroup {
  name: string;
  count: number;
  contained: boolean;
  invader: boolean;
  undead: boolean;
  crazed: boolean;
  great_danger: boolean;
}

export interface Threats {
  active_hostiles: number;
  contained: number;
  groups: ThreatGroup[];
  alerts: string[];
}

export function threats(): Promise<Threats | { error: string }> {
  return runJsonQuery<Threats>(THREATS, ['groups', 'alerts']);
}

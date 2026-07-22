import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface SquadRow {
  name: string;
  filled: number;
  positions: number;
}

export interface Military {
  squad_count: number;
  soldiers: number;
  assigned_positions: number;
  adults: number;
  hostiles_on_map: number;
  great_danger_on_map: number;
  squads: SquadRow[];
  alerts: string[];
}

export function military(): Promise<Military | { error: string }> {
  return runJsonScript<Military>('military', [], ['squads', 'alerts']);
}

export const militaryDef: ToolDef = {
  name: 'military',
  title: 'Military',
  description:
    "The fort's military: number of squads, how many living present dwarves are " +
    'actually enlisted (soldiers), filled squad positions, and readiness read ' +
    'against hostiles currently on the map (great-danger split out). Warns if ' +
    'the fort is undefended. Returns {"error":"no fort loaded"} if no fort is active.',
  run: military,
};

import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface UniformSlotRow {
  item_type: string;
  assigned_count: number;
  missing_count: number;
}

export interface RosterRow {
  unit_id: number;
  name: string;
  uniform: UniformSlotRow[];
  uniform_complete: boolean;
}

export interface AmmoSpecRow {
  item_type: string;
  target_amount: number;
  assigned_count: number;
}

export interface SquadAmmo {
  specs: AmmoSpecRow[];
  ammo_items_assigned: number;
}

export interface SquadTraining {
  cur_routine_idx: number;
  month: number;
  sleep_mode?: string;
  uniform_mode?: string;
  active_orders: string[];
}

export interface SquadRow {
  name: string;
  filled: number;
  positions: number;
  roster: RosterRow[];
  ammo: SquadAmmo;
  training: SquadTraining;
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

export async function military(): Promise<Military | { error: string }> {
  const data = await runJsonScript<Military>('military', [], ['squads', 'alerts']);
  if ('error' in data) return data;
  for (const sq of data.squads) {
    if (!Array.isArray(sq.roster)) sq.roster = [];
    if (!Array.isArray(sq.ammo?.specs)) sq.ammo.specs = [];
    if (!Array.isArray(sq.training?.active_orders)) sq.training.active_orders = [];
    for (const row of sq.roster) {
      if (!Array.isArray(row.uniform)) row.uniform = [];
    }
  }
  return data;
}

export const militaryDef: ToolDef = {
  name: 'military',
  title: 'Military',
  description:
    "The fort's military: number of squads, how many living present dwarves are " +
    'actually enlisted (soldiers), filled squad positions, and readiness read ' +
    'against hostiles currently on the map (great-danger split out). Each squad also ' +
    'reports: roster[] — one row per FILLED position whose occupant is a LIVING, ' +
    'PRESENT unit (a dead or off-map holder still counts toward filled but is omitted ' +
    "here, so gear sitting on a corpse never generates a false alert) — that soldier's " +
    'uniform_complete flag, and (only when incomplete) uniform[], aggregated by item ' +
    'type (ARMOR/HELM/PANTS/GLOVES/SHOES/SHIELD/WEAPON/...) into assigned_count ' +
    '(items the uniform calls for — a required-but-never-found item still counts as 1) ' +
    "vs missing_count (of those, how many are not currently worn/wielded — DF's own " +
    'uniform-unstick logic, or never assigned at all) — this is the tool-API spec\'s ' +
    'originally-promised "equipment_gaps" (e.g. "8 of them have no armor"), previously ' +
    "unfulfilled; a fully-equipped soldier's uniform[] is empty (uniform_complete says " +
    'so already) to keep the payload proportional to actual gaps, not fort size. ammo — ' +
    "the squad's configured ammunition specs (item type, target_amount — the squad's " +
    'shared configured total, NOT per-soldier — and how many are currently assigned) ' +
    'and ammo_items_assigned, the total ammo items currently carried by the squad; ' +
    "training — the active training-schedule month's sleep_mode, uniform_mode, and " +
    'active_orders (both undefined/empty when the fort has never customized that ' +
    "routine's month). alerts also flags any roster member with an incomplete uniform " +
    'by name. Returns {"error":"no fort loaded"} if no fort is active.',
  run: military,
};

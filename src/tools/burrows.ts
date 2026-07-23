import { z } from 'zod';
import { runJsonScript } from '../query.ts';
import { defineActuator, isQueryError, type PlanResult, type ApplyResult } from '../actuator.ts';
import type { ToolDef } from '../register.ts';

function normalizeListField(obj: unknown, key: string): void {
  if (obj && typeof obj === 'object' && !Array.isArray((obj as Record<string, unknown>)[key])) {
    (obj as Record<string, unknown>)[key] = [];
  }
}

export interface BurrowRow {
  id: number;
  name: string;
  tile_count: number;
  assigned_units: number[];
  assigned_units_total: number;
  assigned_units_truncated: boolean;
  civilian_alert_linked: boolean;
}

export interface CivilianAlertState {
  configured: boolean;
  active: boolean;
  burrows: number[];
}

export interface Burrows {
  count: number;
  burrows: BurrowRow[];
  civilian_alert: CivilianAlertState;
}

export async function burrows(): Promise<Burrows | { error: string }> {
  const data = await runJsonScript<Burrows>('burrows', ['list'], ['burrows']);
  if ('error' in data) return data;
  normalizeListField(data.civilian_alert, 'burrows');
  for (const b of data.burrows) normalizeListField(b, 'assigned_units');
  return data;
}

export const burrowsDef: ToolDef = {
  name: 'burrows',
  title: 'Burrows',
  description:
    "The fort's burrows as facts: each burrow's id, name, exact tile_count " +
    '(dfhack.burrows.isAssignedBlockTile summed over every assigned block — the ' +
    'precise painted area, not a bounding box), assigned_units (citizens/animals ' +
    'manually confined to it, id-sorted and capped at 200 — assigned_units_total is ' +
    'always the full count and assigned_units_truncated flags when capped), and ' +
    'civilian_alert_linked — whether this burrow is currently one of the safety ' +
    'burrows for the civilian alert (see civilian_alert). civilian_alert reports the ' +
    "alert's own state: configured (has the fort ever set up a civilian-alert slot — " +
    'false on a fresh fort), active (is it sounding right now — civilians already ' +
    'fleeing to the linked burrow(s)), and burrows (the linked burrow ids). Pairs with ' +
    'the civilian_alert actuator, which toggles a named burrow in or out of this set. ' +
    'Returns {"error":"no fort loaded"} if no fort is active.',
  run: burrows,
};

const s = (v: unknown): string => (v === undefined || v === null || v === '' ? '' : String(v));

interface CivilianAlertArgs {
  burrow?: string;
  burrow_id?: number;
  enabled: boolean;
  confirm_token?: string;
}

function alertArgv(kind: 'plan_alert' | 'apply_alert', a: CivilianAlertArgs): string[] {
  return [kind, s(a.burrow), a.enabled ? 'true' : 'false', s(a.burrow_id)];
}

export const civilianAlertDef = defineActuator<CivilianAlertArgs>({
  name: 'civilian_alert',
  title: 'Civilian alert',
  description:
    'Toggle a burrow in or out of the fort\'s civilian-alert safety set — the same ' +
    'mechanism as DFHack\'s "gui/civ-alert" and the vanilla Squads panel\'s alert ' +
    'button. EXECUTE-NEVER-DECIDE: you name the burrow (by burrow_id — preferred, ' +
    'unambiguous — or by exact burrow name; a burrow with no custom name can ONLY be ' +
    'targeted by burrow_id) and whether it should be part of the alert (enabled ' +
    'true=add, false=remove); the tool toggles exactly that. enabled=true adds the ' +
    'burrow to the alert set AND sounds the alarm (civilians immediately path to a ' +
    'linked burrow) if it wasn\'t already sounding. enabled=false removes the burrow; ' +
    'the alarm is only silenced once the alert set becomes fully empty — removing one ' +
    'of several linked burrows leaves the others (and the alarm) active. Dry-run (no ' +
    'confirm_token) previews currently_in_civilian_alert, ' +
    'civilian_alert_currently_sounding, resulting_civilian_alert_burrows, and ' +
    'resulting_sounding as FACTS; an already-satisfied request previews as a no-op. Pass ' +
    "the returned confirm_token to apply; the token is bound to the resolved burrow id " +
    "and is void if the alert's burrow set or sounding state changes in between. " +
    'Reversal: the same call with enabled inverted. Verify with burrows.',
  tokenPrefix: 'ca',
  shape: {
    burrow: z
      .string()
      .min(1)
      .optional()
      .describe(
        'exact burrow name (from burrows()), e.g. "Inside+" — ignored when burrow_id is given'
      ),
    burrow_id: z
      .number()
      .int()
      .optional()
      .describe('burrow id (from burrows()) — preferred over burrow; required for an unnamed burrow'),
    enabled: z
      .boolean()
      .describe(
        'true = add this burrow to the civilian alert and sound it; false = remove it'
      ),
  },
  plan: async (a): Promise<PlanResult | { error: string }> => {
    const r = await runJsonScript<PlanResult>('burrows', alertArgv('plan_alert', a));
    if (isQueryError(r)) return r;
    normalizeListField(r.preview, 'resulting_civilian_alert_burrows');
    return r;
  },
  apply: async (a): Promise<ApplyResult | { error: string }> => {
    const r = await runJsonScript<ApplyResult>('burrows', alertArgv('apply_alert', a));
    if (isQueryError(r)) return r;
    normalizeListField(r.changes, 'civilian_alert_burrows');
    const readback = r.readback as { burrow?: unknown; civilian_alert?: unknown } | undefined;
    normalizeListField(readback?.burrow, 'assigned_units');
    normalizeListField(readback?.civilian_alert, 'burrows');
    return r;
  },
});

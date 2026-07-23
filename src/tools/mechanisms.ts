import { z } from 'zod';
import { runJsonScript } from '../query.ts';
import { defineActuator, isQueryError, type PlanResult, type ApplyResult } from '../actuator.ts';
import type { ToolDef } from '../register.ts';

export interface Pos {
  x: number;
  y: number;
  z: number;
}

export interface LinkedTarget {
  building_id: number;
  type: string;
  pos: Pos;
  /** Bridge: 'raised'/'lowered'/'raising'/'lowering'. Weapon spike: 'retracted'/
   *  'unretracted'/'retracting'/'unretracting'. Floodgate: 'closed'/'open'/
   *  'closing'/'opening'. Door/Hatch (door_flags, not gate_flags): 'closed'/'open'
   *  only, no transitional state. Absent for a target exposing neither (e.g. Support). */
  state?: string;
}

export interface PendingPullJob {
  id: number;
  do_now: boolean;
  repeating: boolean;
  suspended: boolean;
}

export interface LeverRow {
  building_id: number;
  name: string;
  pos: Pos;
  state: number;
  linked_targets: LinkedTarget[];
  pending_pull_jobs: PendingPullJob[];
}

export interface PlateTriggers {
  citizens: boolean;
  creatures: boolean;
  creature_weight_min: number;
  creature_weight_max: number;
  minecart_track: boolean;
  minecart_weight_min: number;
  minecart_weight_max: number;
  water: boolean;
  water_depth_min: number;
  water_depth_max: number;
  magma: boolean;
  magma_depth_min: number;
  magma_depth_max: number;
}

export interface PressurePlateRow {
  building_id: number;
  name: string;
  pos: Pos;
  linked_targets: LinkedTarget[];
  triggers: PlateTriggers;
}

export interface Mechanisms {
  lever_count: number;
  levers: LeverRow[];
  plate_count: number;
  pressure_plates: PressurePlateRow[];
  unlinked_levers: number[];
  bridge_count: number;
  unlinked_bridges: number[];
}

export async function mechanisms(): Promise<Mechanisms | { error: string }> {
  const data = await runJsonScript<Mechanisms>('mechanisms', ['list'], [
    'levers',
    'pressure_plates',
    'unlinked_levers',
    'unlinked_bridges',
  ]);
  if ('error' in data) return data;
  for (const lv of data.levers) {
    if (!Array.isArray(lv.linked_targets)) lv.linked_targets = [];
    if (!Array.isArray(lv.pending_pull_jobs)) lv.pending_pull_jobs = [];
  }
  for (const pl of data.pressure_plates) {
    if (!Array.isArray(pl.linked_targets)) pl.linked_targets = [];
  }
  return data;
}

export const mechanismsDef: ToolDef = {
  name: 'mechanisms',
  title: 'Mechanisms',
  description:
    "The fort's lever/pressure-plate wiring as facts — players (and an AI co-pilot) " +
    'routinely forget which lever raises which bridge; this makes it legible. ' +
    'levers[] lists every lever with its position, current state (0/1 — the physical ' +
    'orientation, NOT which way any linked gate is), linked_targets (every building its ' +
    'mechanism items connect to — bridge/door/floodgate/hatch/support/weapon-trap — with ' +
    'that target\'s id, type, position, and a state string (raised/lowered/raising/' +
    'lowering for a Bridge, closed/open/closing/opening for a Floodgate, closed/open ' +
    '(no transitional state) for a Door/Hatch, retracted/unretracted/retracting/' +
    'unretracting for a Weapon spike) when the target exposes one), and ' +
    'pending_pull_jobs (PullLever jobs already queued on it, so a caller can ' +
    'see a pull is already in flight before queuing another). pressure_plates[] lists ' +
    'every plate\'s linked_targets the same way, plus triggers — the configured trip ' +
    'conditions (citizens, creatures with a weight range, a minecart-weight range on ' +
    'track, or water/magma depth ranges). unlinked_levers is the ids of levers wired to ' +
    'nothing (dead ends); unlinked_bridges is bridges no lever or plate in the fort ' +
    'currently operates (must be hand-opened/closed, or are permanently fixed). Pairs ' +
    'with the pull_lever actuator. Returns {"error":"no fort loaded"} if no fort is active.',
  run: mechanisms,
};

const s = (v: unknown): string => (v === undefined || v === null || v === '' ? '' : String(v));

/** Lua's empty table encodes as `{}`, not `[]`; coerce a nested list field on an
 *  object in-place so callers always see an array, even when empty. */
function normalizeListField(obj: unknown, key: string): void {
  if (obj && typeof obj === 'object' && !Array.isArray((obj as Record<string, unknown>)[key])) {
    (obj as Record<string, unknown>)[key] = [];
  }
}

interface PullLeverArgs {
  lever_id: number;
  urgent?: boolean;
  confirm_token?: string;
}

function pullArgv(kind: 'plan_pull' | 'apply_pull', a: PullLeverArgs): string[] {
  return [kind, s(a.lever_id), a.urgent === false ? 'false' : 'true'];
}

export const pullLeverDef = defineActuator<PullLeverArgs>({
  name: 'pull_lever',
  title: 'Pull lever',
  description:
    'Queue a job for a dwarf to walk to and pull a named lever — the same action as ' +
    'DFHack\'s "lever pull" command. EXECUTE-NEVER-DECIDE: you name the lever; the tool ' +
    'queues exactly one pull job on it. This QUEUES a job, it does not instantly flip the ' +
    'lever or its linked target(s) — the physical toggle (and any bridge/door/spike/' +
    'support actually moving) happens once a dwarf reaches the lever and completes the ' +
    'job. Dry-run (no confirm_token) previews current_state, linked_targets, and any ' +
    'pending_pull_jobs already queued on it, as FACTS — queuing a second pull while one ' +
    'is already in flight is allowed (each pull toggles once more) but the preview lets ' +
    'the caller see that before doing so. Pass the returned confirm_token to apply; the ' +
    "token is void if the lever's state, linked targets, or queued-job set changes in " +
    'between. urgent (default true) sets the job\'s do-now priority, jumping the work ' +
    'queue — appropriate for an emergency response, but optional false for a routine ' +
    'pull. Reversal: call again on the same lever_id — a second pull toggles it back. ' +
    'Verify with mechanisms.',
  tokenPrefix: 'pl',
  shape: {
    lever_id: z.number().int().describe('building id of the lever (from mechanisms())'),
    urgent: z
      .boolean()
      .optional()
      .describe('true (default) = do-now priority; false = queue normally'),
  },
  plan: async (a): Promise<PlanResult | { error: string }> => {
    const r = await runJsonScript<PlanResult>('mechanisms', pullArgv('plan_pull', a));
    if (isQueryError(r)) return r;
    normalizeListField(r.preview, 'linked_targets');
    normalizeListField(r.preview, 'pending_pull_jobs');
    return r;
  },
  apply: async (a): Promise<ApplyResult | { error: string }> => {
    const r = await runJsonScript<ApplyResult>('mechanisms', pullArgv('apply_pull', a));
    if (isQueryError(r)) return r;
    normalizeListField(r.readback, 'linked_targets');
    normalizeListField(r.readback, 'pending_pull_jobs');
    return r;
  },
});

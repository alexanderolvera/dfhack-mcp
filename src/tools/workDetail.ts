// A3 — labor via work details. Two tools backed by mcp_workDetail.lua:
//   work_details        read-only sensor (always available) — every work detail with
//                       the labors it enables and its (bounded) membership, doubling
//                       as the Q1 labor view and the readback for assign.
//   assign_work_detail  gated actuator — add/remove one citizen to/from one detail.
//
// The actuator is thin: the §A0 dry-run/confirm/apply/undo loop is the shared
// defineActuator wrapper (src/actuator.ts); it supplies only plan()/apply(), which
// forward to the Lua subcommands. Version-fragile struct access stays in the .lua.

import { z } from 'zod';
import { runJsonScript } from '../query.ts';
import { defineActuator, type PlanResult, type ApplyResult } from '../actuator.ts';
import type { ToolDef } from '../register.ts';

export interface DetailFacts {
  name: string;
  mode: string; // Default | EverybodyDoesThis | NobodyDoesThis | OnlySelectedDoesThis
  no_modify: boolean; // a default detail the in-game UI won't let you rename/delete
  icon: number;
  allowed_labors: string[]; // df.unit_labor names this detail enables
  members: number[]; // assigned citizen unit ids, id-sorted, capped at MEMBER_CAP
  member_names: string[]; // parallel to members: readable names (bounded by the cap)
  member_count: number; // FULL count, even when members is truncated/paged
  members_truncated: boolean; // members list capped below the remaining tail
  members_cursor?: number; // ONLY when truncated: last listed id — pass as members_after to continue
}

export interface WorkDetailList {
  count: number; // number of details LISTED (the fort total when unfiltered)
  details: DetailFacts[];
  members_after?: number; // echo of the cursor arg; absent when none was passed
}

// ---- shared arg coercion ---------------------------------------------------
const s = (v: unknown): string => (v === undefined || v === null || v === '' ? '' : String(v));

// ---- work_details (read-only sensor) ---------------------------------------
export async function workDetails(
  args: { detail?: string; members_after?: number } = {}
): Promise<WorkDetailList | { error: string }> {
  const argv = ['list', s(args.detail), s(args.members_after)];
  return runJsonScript<WorkDetailList>('workDetail', argv, ['details']);
}

export const workDetailsDef: ToolDef = {
  name: 'work_details',
  title: 'Work details',
  description:
    'List the fort’s work details (the labor-management groups) as facts: each ' +
    'detail’s name, mode (OnlySelectedDoesThis / EverybodyDoesThis / NobodyDoesThis ' +
    '/ Default), the labor tokens it enables, and its assigned citizens. The member ' +
    'list is id-sorted and capped at 200 per detail — member_count is always the ' +
    'full count and members_truncated flags when the list is capped; member_names ' +
    'gives readable names parallel to members. Both parameters are OPTIONAL ' +
    'narrowing: detail (exact name) returns ONLY that detail; members_after (a unit ' +
    'id) starts each member list after that id — a truncated detail carries ' +
    'members_cursor (its last listed id) to pass back as members_after for the next ' +
    'page. READ-ONLY and always available (not behind the actuator gate); also the ' +
    'readback sensor for assign_work_detail.',
  shape: {
    detail: z
      .string()
      .min(1)
      .optional()
      .describe('exact work detail name — return ONLY that detail, e.g. "Miners"'),
    members_after: z.coerce
      .number()
      .int()
      .optional()
      .describe(
        'member-list cursor: list members with id AFTER this (use members_cursor from a truncated response)'
      ),
  },
  run: (args) => workDetails(args),
};

// ---- assign_work_detail (actuator) -----------------------------------------
interface AssignArgs {
  unit_id: number;
  detail: string;
  enabled: boolean;
  confirm_token?: string;
}

function assignArgv(kind: 'plan_assign' | 'apply_assign', a: AssignArgs): string[] {
  return [kind, s(a.unit_id), s(a.detail), a.enabled ? 'true' : 'false'];
}

export const assignWorkDetailDef = defineActuator<AssignArgs>({
  name: 'assign_work_detail',
  title: 'Assign work detail',
  description:
    'Add or remove ONE fort citizen to/from ONE work detail (the game’s labor ' +
    'groups). EXECUTE-NEVER-DECIDE: you name the unit, the detail, and whether they ' +
    'should be a member (enabled true=add, false=remove); the tool toggles exactly ' +
    'that and, because assigned_units is the durable source of truth, mirrors the ' +
    'detail’s labors onto the unit immediately (the game otherwise reconciles them ' +
    'only on a frame advance). Dry-run (no confirm_token) previews the change and ' +
    'flags currently_member, resulting_members_count, only_member (removing the ' +
    'detail’s sole member), and resulting_details (every detail the unit would ' +
    'belong to AFTER the change) as FACTS; an already-satisfied request previews as ' +
    'a no-op. Pass the returned confirm_token to apply; the token is void if the ' +
    'detail’s membership, mode, or labor set changes in between. Reversal: the same ' +
    'call with enabled inverted. Verify with work_details.',
  tokenPrefix: 'wd',
  shape: {
    unit_id: z.number().int().describe('id of the fort citizen (from find_unit / work_details)'),
    detail: z.string().min(1).describe('exact work detail name (from work_details), e.g. "Miners"'),
    enabled: z.boolean().describe('true = add the unit to the detail, false = remove it'),
  },
  plan: async (a): Promise<PlanResult | { error: string }> => {
    const r = await runJsonScript<PlanResult>('workDetail', assignArgv('plan_assign', a));
    return r as PlanResult | { error: string };
  },
  apply: async (a): Promise<ApplyResult | { error: string }> => {
    const r = await runJsonScript<ApplyResult>('workDetail', assignArgv('apply_assign', a));
    return r as ApplyResult | { error: string };
  },
});

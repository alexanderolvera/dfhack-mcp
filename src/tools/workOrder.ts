// A1 — manager (work) orders. Three tools backed by mcp_workOrder.lua:
//   work_order_list    read-only sensor (always available) — active manager orders,
//                      doubling as the Q1 manager-screen view and the readback for
//                      create/cancel.
//   work_order_create  gated actuator — queue a new manager order.
//   work_order_cancel  gated actuator — remove one order by id.
//
// The two actuators are thin: the §A0 dry-run/confirm/apply/undo loop is the shared
// defineActuator wrapper (src/actuator.ts); each supplies only plan()/apply(), which
// forward to the Lua subcommands. Version-fragile struct access stays in the .lua.

import { z } from 'zod';
import { runJsonScript } from '../query.ts';
import { defineActuator, type PlanResult, type ApplyResult } from '../actuator.ts';
import type { ToolDef } from '../register.ts';

export interface OrderFacts {
  id: number;
  job_type: string;
  item_type: string | null;
  material: string | null;
  amount_total: number;
  amount_left: number;
  frequency: string;
  workshop_id?: number;
  conditions: number;
}

export interface WorkOrderList {
  count: number;
  orders: OrderFacts[];
  truncated: boolean;
  manager_present: boolean;
}

// ---- work_order_list (read-only sensor) ------------------------------------
export async function workOrderList(): Promise<WorkOrderList | { error: string }> {
  return runJsonScript<WorkOrderList>('workOrder', ['list'], ['orders']);
}

export const workOrderListDef: ToolDef = {
  name: 'work_order_list',
  title: 'Work order list',
  description:
    'List the fort’s active manager (work) orders as facts: id, job type, output ' +
    'item/material tokens, amount total/left, repeat frequency, bound workshop, and ' +
    'condition count, plus whether a manager noble is assigned (orders are not ' +
    'validated without one). Sorted by id, capped at 256 with truncated:true. ' +
    'Read-only; also the readback sensor for work_order_create / work_order_cancel.',
  run: () => workOrderList(),
};

// ---- shared arg coercion ---------------------------------------------------
const s = (v: unknown): string => (v === undefined || v === null || v === '' ? '' : String(v));

// ---- work_order_create (actuator) ------------------------------------------
interface CreateArgs {
  job_type: string;
  amount: number;
  frequency?: string;
  material?: string;
  item_type?: string;
  conditions?: unknown[];
  confirm_token?: string;
}

function createArgv(kind: 'plan_create' | 'apply_create', a: CreateArgs): string[] {
  return [
    kind,
    s(a.job_type),
    s(a.amount),
    s(a.frequency),
    s(a.material),
    s(a.item_type),
    a.conditions && a.conditions.length ? JSON.stringify(a.conditions) : '',
  ];
}

export const workOrderCreateDef = defineActuator<CreateArgs>({
  name: 'work_order_create',
  title: 'Create work order',
  description:
    'Queue a new manager (work) order. EXECUTE-NEVER-DECIDE: you specify the job ' +
    'type, count, repeat frequency, and optionally an output material and/or item ' +
    'type; the tool queues exactly that. Dry-run (no confirm_token) previews the ' +
    'order and flags would_duplicate if an identical active order exists and ' +
    'manager_present; pass the returned confirm_token to apply. Reversal: ' +
    'work_order_cancel with the returned order id. v1 scope: advanced order ' +
    'prerequisite conditions are rejected (specify material/item_type directly).',
  tokenPrefix: 'wo',
  shape: {
    job_type: z.string().describe('df.job_type name, e.g. "ConstructBed", "MakeTable"'),
    amount: z.number().int().positive().describe('number of items to produce'),
    frequency: z
      .enum(['OneTime', 'Daily', 'Monthly', 'Seasonally', 'Yearly'])
      .optional()
      .describe('repeat frequency (default OneTime)'),
    material: z
      .string()
      .optional()
      .describe('material token, e.g. "INORGANIC:IRON", "PLANT_MAT:..."'),
    item_type: z.string().optional().describe('df.item_type name to constrain the output item'),
    conditions: z
      .array(z.unknown())
      .optional()
      .describe('advanced prerequisite conditions — rejected in v1 (use material/item_type)'),
  },
  plan: async (a): Promise<PlanResult | { error: string }> => {
    const r = await runJsonScript<PlanResult>('workOrder', createArgv('plan_create', a));
    return r as PlanResult | { error: string };
  },
  apply: async (a): Promise<ApplyResult | { error: string }> => {
    const r = await runJsonScript<ApplyResult>('workOrder', createArgv('apply_create', a));
    return r as ApplyResult | { error: string };
  },
});

// ---- work_order_cancel (actuator) ------------------------------------------
interface CancelArgs {
  order_id: number;
  confirm_token?: string;
}

export const workOrderCancelDef = defineActuator<CancelArgs>({
  name: 'work_order_cancel',
  title: 'Cancel work order',
  description:
    'Remove one active manager (work) order by its id. Dry-run (no confirm_token) ' +
    'previews the exact order that will be cancelled; pass the returned ' +
    'confirm_token to apply. The token is void if that order changed or completed ' +
    'in the meantime. Reversal: the apply response returns a recreate spec for ' +
    'work_order_create. Verify with work_order_list.',
  tokenPrefix: 'wo',
  shape: {
    order_id: z.number().int().describe('id of the order to cancel (from work_order_list)'),
  },
  plan: async (a): Promise<PlanResult | { error: string }> => {
    const r = await runJsonScript<PlanResult>('workOrder', ['plan_cancel', s(a.order_id)]);
    return r as PlanResult | { error: string };
  },
  apply: async (a): Promise<ApplyResult | { error: string }> => {
    const r = await runJsonScript<ApplyResult>('workOrder', ['apply_cancel', s(a.order_id)]);
    return r as ApplyResult | { error: string };
  },
});

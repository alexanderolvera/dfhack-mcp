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
  // item_type / material are the constrained output spec; the key is OMITTED when
  // unconstrained (the DFHack encoder can't emit null), hence optional.
  item_type?: string;
  material?: string;
  amount_total: number;
  amount_left: number;
  frequency: string;
  workshop_id?: number;
  conditions: number;
  // Per-order validation state: active in the queue, and validated (false on an
  // active order means it can't currently be fulfilled, e.g. missing materials).
  active: boolean;
  validated: boolean;
}

export interface WorkOrderList {
  count: number; // total active orders in the fort (unfiltered by the cursor)
  orders: OrderFacts[];
  truncated: boolean;
  next_cursor?: number; // pass as after_id to fetch the next page (present iff truncated)
  manager_present: boolean;
}

// ---- work_order_list (read-only sensor) ------------------------------------
export async function workOrderList(args: {
  after_id?: number;
}): Promise<WorkOrderList | { error: string }> {
  return runJsonScript<WorkOrderList>('workOrder', ['list', s(args?.after_id)], ['orders']);
}

export const workOrderListDef: ToolDef = {
  name: 'work_order_list',
  title: 'Work order list',
  description:
    'List the fort’s active manager (work) orders as facts: id, job type, output ' +
    'item/material tokens, amount total/left, repeat frequency, bound workshop, ' +
    'condition count, and per-order validation state (active + validated; validated:' +
    'false means the order cannot currently be fulfilled). Also reports whether a ' +
    'manager noble is assigned. `count` is the fort total; the page is sorted by id ' +
    'and capped at 256 — when capped, truncated:true and next_cursor gives the ' +
    'after_id for the next page. READ-ONLY and always available (not behind the ' +
    'actuator gate); also the readback sensor for work_order_create / _cancel.',
  shape: {
    after_id: z
      .number()
      .int()
      .optional()
      .describe(
        'pagination cursor: return only orders with id greater than this (from next_cursor)'
      ),
  },
  run: (args) => workOrderList(args),
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

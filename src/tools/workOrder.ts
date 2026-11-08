import { z } from 'zod';
import { runJsonScript } from '../query.ts';
import { defineActuator, type PlanResult, type ApplyResult } from '../actuator.ts';
import type { ToolDef } from '../register.ts';

const itemConditionShape = {
  condition: z
    .enum(['AtLeast', 'AtMost', 'GreaterThan', 'LessThan', 'Exactly', 'Not'])
    .describe('how the matching stock count compares to value'),
  value: z.number().int().describe('the stock count threshold'),
  item_type: z.string().optional().describe('df.item_type name, e.g. "BAR", "DRINK", "TOOL"'),
  item_subtype: z
    .string()
    .optional()
    .describe('item subtype token, e.g. "ITEM_TOOL_HONEYCOMB" (needs item_type)'),
  material: z.string().optional().describe('material token, e.g. "INORGANIC:IRON"'),
  flags: z
    .array(z.string())
    .optional()
    .describe('job_item_flags1/2/3 names, e.g. ["unrotten", "cookable"]'),
  reaction_class: z.string().optional().describe('material reaction class, e.g. "FAT"'),
  reaction_product: z.string().optional().describe('material reaction product, e.g. "DRINK_MAT"'),
  bearing: z.string().optional().describe('inorganic id the item must bear, e.g. "IRON"'),
  tool: z.string().optional().describe('df.tool_uses name, e.g. "LIQUID_CONTAINER"'),
  min_dimension: z.number().int().optional().describe('minimum item dimension'),
  reaction: z.string().optional().describe('reaction code whose reagents `contains` names'),
  contains: z
    .array(z.string())
    .optional()
    .describe('reagent codes within `reaction` the item must contain'),
};

const orderConditionShape = {
  order_id: z.coerce.number().int().describe('id of the manager order this one waits on'),
  condition: z.enum(['Activated', 'Completed']).describe('which state of that order to wait for'),
};

const itemConditionSchema = z.object(itemConditionShape).strict();
const orderConditionSchema = z.object(orderConditionShape).strict();

export type ItemCondition = z.infer<typeof itemConditionSchema>;
export type OrderCondition = z.infer<typeof orderConditionSchema>;

export interface ItemConditionFacts extends ItemCondition {
  flags4?: number;
  flags5?: number;
  dye_color?: number;
}

export interface OrderConditionFacts extends OrderCondition {
  satisfied: boolean;
}

export interface OrderFacts {
  id: number;
  job_type: string;
  item_type?: string;
  material?: string;
  meal_ingredients?: number;
  amount_total: number;
  amount_left: number;
  frequency: string;
  workshop_id?: number;
  conditions: number;
  item_conditions: ItemConditionFacts[];
  order_conditions: OrderConditionFacts[];
  active: boolean;
  validated: boolean;
}

export interface WorkOrderList {
  count: number;
  orders: OrderFacts[];
  truncated: boolean;
  next_cursor?: number;
  manager_present: boolean;
}

export function withConditionLists<T>(order: T): T {
  if (order && typeof order === 'object') {
    const o = order as Record<string, unknown>;
    if (!Array.isArray(o.item_conditions)) o.item_conditions = [];
    if (!Array.isArray(o.order_conditions)) o.order_conditions = [];
  }
  return order;
}

export async function workOrderList(args: {
  after_id?: number;
}): Promise<WorkOrderList | { error: string }> {
  const r = await runJsonScript<WorkOrderList>(
    'workOrder',
    ['list', s(args?.after_id)],
    ['orders']
  );
  if ('error' in r) return r;
  r.orders.forEach(withConditionLists);
  return r;
}

export const workOrderListDef: ToolDef = {
  name: 'work_order_list',
  title: 'Work order list',
  description:
    'List every manager (work) order in the fort as facts: id, job type, output ' +
    'item/material tokens (meal_ingredients in place of material for PrepareMeal), ' +
    'amount total/left, repeat frequency, bound workshop, ' +
    'per-order validation state (active + validated; validated:false means the ' +
    'order cannot currently be fulfilled), and its conditions: item_conditions ' +
    '(stock-threshold triggers — comparator, value, and the item filter counted) ' +
    'and order_conditions (waits on another order being Activated/Completed). ' +
    'Also reports whether a manager noble is assigned. `count` is the fort total ' +
    'of orders, whatever their active/validated state; the page is sorted by id ' +
    'and capped at 256 — when capped, truncated:true and next_cursor gives the ' +
    'after_id for the next page. READ-ONLY and always available (not behind the ' +
    'actuator gate); also the readback sensor for work_order_create / _cancel.',
  shape: {
    after_id: z.coerce
      .number()
      .int()
      .optional()
      .describe(
        'pagination cursor: return only orders with id greater than this (from next_cursor)'
      ),
  },
  run: (args) => workOrderList(args),
};

const s = (v: unknown): string => (v === undefined || v === null || v === '' ? '' : String(v));
const jsonArg = (v: unknown[] | undefined): string => (v && v.length ? JSON.stringify(v) : '');

interface CreateArgs {
  job_type: string;
  amount: number;
  frequency?: string;
  material?: string;
  meal_ingredients?: number;
  item_type?: string;
  item_conditions?: ItemCondition[];
  order_conditions?: OrderCondition[];
  conditions?: unknown[];
  confirm_token?: string;
}

export function createArgv(kind: 'plan_create' | 'apply_create', a: CreateArgs): string[] {
  return [
    kind,
    s(a.job_type),
    s(a.amount),
    s(a.frequency),
    s(a.material),
    s(a.item_type),
    jsonArg(a.conditions),
    jsonArg(a.item_conditions),
    jsonArg(a.order_conditions),
    s(a.meal_ingredients),
  ];
}

export const workOrderCreateDef = defineActuator<CreateArgs>({
  name: 'work_order_create',
  title: 'Create work order',
  description:
    'Queue a new manager (work) order. EXECUTE-NEVER-DECIDE: you specify the job ' +
    'type, count, repeat frequency, optionally an output material and/or item ' +
    'type (for PrepareMeal, meal_ingredients in place of material), and ' +
    'optionally its conditions — item_conditions (stock-threshold ' +
    'triggers, e.g. activate only when BAR stock is AtMost 10) and order_conditions (wait ' +
    'for another order to be Activated/Completed). The tool queues exactly that, ' +
    'with the same condition shape work_order_list reports. Dry-run (no ' +
    'confirm_token) previews the order and flags would_duplicate if an order with ' +
    'the identical output spec exists and manager_present; pass the returned ' +
    'confirm_token to apply. Reversal: work_order_cancel with the returned order id.',
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
      .describe('material token, e.g. "INORGANIC:IRON", "PLANT_MAT:..."; not for PrepareMeal'),
    meal_ingredients: z
      .number()
      .int()
      .optional()
      .describe('PrepareMeal only: ingredient count, 2 (easy), 3 (fine) or 4 (lavish)'),
    item_type: z.string().optional().describe('df.item_type name to constrain the output item'),
    item_conditions: z
      .array(itemConditionSchema)
      .optional()
      .describe('stock-threshold triggers; the order activates only when every one holds'),
    order_conditions: z
      .array(orderConditionSchema)
      .optional()
      .describe('other orders this one waits on'),
    conditions: z
      .array(z.unknown())
      .optional()
      .describe('replaced by item_conditions / order_conditions; non-empty is blocked'),
  },
  plan: async (a): Promise<PlanResult | { error: string }> => {
    const r = await runJsonScript<PlanResult>('workOrder', createArgv('plan_create', a));
    return r as PlanResult | { error: string };
  },
  apply: async (a): Promise<ApplyResult | { error: string }> => {
    const r = await runJsonScript<ApplyResult>('workOrder', createArgv('apply_create', a));
    if (!('error' in r)) withConditionLists(r.readback);
    return r as ApplyResult | { error: string };
  },
});

interface CancelArgs {
  order_id: number;
  confirm_token?: string;
}

export const workOrderCancelDef = defineActuator<CancelArgs>({
  name: 'work_order_cancel',
  title: 'Cancel work order',
  description:
    'Remove one manager (work) order by its id. Dry-run (no confirm_token) ' +
    'previews the exact order that will be cancelled, plus depended_on_by: the ids ' +
    'of orders whose order_conditions wait on it; pass the returned confirm_token ' +
    'to apply. The token is void if that order changed or completed in the ' +
    'meantime. Reversal: the apply response returns undo.recreate, a ' +
    'work_order_create spec for the REMAINING amount (amount_left, not the ' +
    'original total) carrying the order’s output spec (meal_ingredients included), ' +
    'frequency, and item/order ' +
    'conditions. It cannot restore a workshop binding, an output item_subtype, or ' +
    'other orders’ conditions on this id (a recreated order gets a new id): ' +
    'undo.faithful is false and undo.not_reproduced names each loss. Verify with ' +
    'work_order_list.',
  tokenPrefix: 'wo',
  shape: {
    order_id: z.coerce.number().int().describe('id of the order to cancel (from work_order_list)'),
  },
  plan: async (a): Promise<PlanResult | { error: string }> => {
    const r = await runJsonScript<PlanResult>('workOrder', ['plan_cancel', s(a.order_id)]);
    if (!('error' in r)) withConditionLists(r.preview);
    return r as PlanResult | { error: string };
  },
  apply: async (a): Promise<ApplyResult | { error: string }> => {
    const r = await runJsonScript<ApplyResult>('workOrder', ['apply_cancel', s(a.order_id)]);
    return r as ApplyResult | { error: string };
  },
});

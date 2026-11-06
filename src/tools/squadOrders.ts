import { z } from 'zod';
import { runJsonScript } from '../query.ts';
import { defineActuator, isQueryError, type PlanResult, type ApplyResult } from '../actuator.ts';

const s = (v: unknown): string => (v === undefined || v === null || v === '' ? '' : String(v));

function normalizeListField(obj: unknown, key: string): void {
  if (obj && typeof obj === 'object' && !Array.isArray((obj as Record<string, unknown>)[key])) {
    (obj as Record<string, unknown>)[key] = [];
  }
}

interface SquadOrdersArgs {
  squad_id: number;
  order: 'move' | 'kill' | 'cancel';
  x?: number;
  y?: number;
  z?: number;
  target_unit_ids?: number[];
  confirm_token?: string;
}

function ordersArgv(kind: 'plan' | 'apply', a: SquadOrdersArgs): string[] {
  return [
    kind,
    s(a.squad_id),
    s(a.order),
    s(a.x),
    s(a.y),
    s(a.z),
    (a.target_unit_ids ?? []).join(','),
  ];
}

export const squadOrdersDef = defineActuator<SquadOrdersArgs>({
  name: 'squad_orders',
  title: 'Squad orders',
  description:
    'Order one of the fort\'s military squads to MOVE to a tile, KILL named ' +
    'units, or CANCEL its current orders. EXECUTE-NEVER-DECIDE: you name the ' +
    'squad (squad_id from military()), the order, and its exact target; the tool ' +
    'issues precisely that and never picks a target itself. This is the ' +
    'highest-stakes actuator in this server — it sends real dwarves into real ' +
    'combat, and dwarves who die carrying out the order stay dead. ' +
    'ORDERS REPLACE, THEY DO NOT STACK: DF treats a squad\'s order list as its ' +
    'whole standing instruction set, so applying any order first clears whatever ' +
    'that squad was already doing (the preview reports how many via ' +
    'replaces_existing_orders, and the apply echoes cleared_previous_orders). ' +
    'Dry-run (no confirm_token) previews the squad name, its living present ' +
    'member_count (the dwarves who would actually go), current_orders, and — for ' +
    'kill — each resolved target\'s name, position and great_danger flag, as ' +
    'FACTS. Pass the returned confirm_token to apply; the token is void if the ' +
    "squad's own order list or living-member set changes in between. " +
    'BLOCKED with no token (nothing partially applies): an unknown squad_id or ' +
    "one belonging to another entity; a squad with no living present members; a " +
    'move target that is off-map or not walkable; a kill target that is dead, ' +
    'off-map, one of your own citizens, or standing on an UNDISCOVERED tile ' +
    '(targeting it would act on knowledge the fort does not have); more than 32 ' +
    'kill targets. Reversal: order="cancel" on the same squad_id, which RELEASES ' +
    'the squad — it does not walk them back to where they were and cannot undo ' +
    'fighting that already happened, so undo.faithful is false whenever the ' +
    'apply cleared pre-existing orders. Note DF itself removes a KILL order once ' +
    'its targets are dead, so a completed order simply disappears from ' +
    "current_orders rather than lingering. Verify with military().",
  tokenPrefix: 'so',
  shape: {
    squad_id: z.number().int().describe('squad id from military().squads[].squad_id'),
    order: z
      .enum(['move', 'kill', 'cancel'])
      .describe(
        'move = go to x,y,z and hold; kill = attack the named target_unit_ids; ' +
          'cancel = clear this squad\'s orders and release it'
      ),
    x: z.number().int().optional().describe('move target x (required for order="move")'),
    y: z.number().int().optional().describe('move target y (required for order="move")'),
    z: z.number().int().optional().describe('move target z-level (required for order="move")'),
    target_unit_ids: z
      .array(z.number().int())
      .max(32)
      .optional()
      .describe(
        'unit ids to kill (required for order="kill"), e.g. from threats(); max 32'
      ),
  },
  plan: async (a): Promise<PlanResult | { error: string }> => {
    const r = await runJsonScript<PlanResult>('squad_orders', ordersArgv('plan', a));
    if (isQueryError(r)) return r;
    normalizeListField(r.preview, 'current_orders');
    // `targets` only exists for a kill order; normalizing it unconditionally
    // would stamp an empty targets[] onto every move/cancel payload.
    if (a.order === 'kill') normalizeListField(r.preview, 'targets');
    return r;
  },
  apply: async (a): Promise<ApplyResult | { error: string }> => {
    const r = await runJsonScript<ApplyResult>('squad_orders', ordersArgv('apply', a));
    if (isQueryError(r)) return r;
    if (a.order === 'kill') normalizeListField(r.changes, 'targets');
    normalizeListField(r.readback, 'orders');
    return r;
  },
});

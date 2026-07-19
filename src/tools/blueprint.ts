// A2 — quickfort blueprint actuators. Two gated tools backed by mcp_blueprint.lua:
//   blueprint_apply  designate dig/zone from a quickfort CSV at an explicit anchor.
//   blueprint_undo   revert that designation (quickfort's native undo).
//
// The highest-value actuator: an agent drafts a quickfort CSV and applies it. Both
// tools are thin — the §A0 dry-run/confirm/apply/undo loop is the shared
// defineActuator wrapper (src/actuator.ts); each supplies only plan()/apply(),
// which forward to the Lua subcommands. There is NO separate read sensor:
// blueprint_apply WITHOUT a confirm_token IS the preview (the foundation's
// single-tool preview→apply model), and its dry-run parses quickfort's own stats.
//
// v1 scope: dig + zone. build/place are rejected in plan() (blocked, NO token) so
// nothing partially applies. The malformed-CSV gate (spike #11) lives in Lua: a bad
// blueprint does NOT error in quickfort — it PARTIALLY applies — so the dry-run
// blocks whenever it reports invalid key sequences or undesignatable tiles.

import { z } from 'zod';
import { runJsonScript } from '../query.ts';
import { defineActuator, type PlanResult, type ApplyResult } from '../actuator.ts';

// Shared arg coercion: everything crosses to Lua as a native argv string.
const s = (v: unknown): string => (v === undefined || v === null || v === '' ? '' : String(v));

interface BlueprintArgs {
  csv: string;
  anchor_x: number;
  anchor_y: number;
  anchor_z: number;
  mode: string;
  confirm_token?: string;
}

// argv layout mirrors Lua `local a={...}`: a[1]=subcommand, a[2]=csv (multi-line,
// unescaped — verified to survive intact), a[3..5]=anchor, a[6]=mode.
function blueprintArgv(
  kind: 'plan_apply' | 'apply_apply' | 'plan_undo' | 'apply_undo',
  a: BlueprintArgs
): string[] {
  return [kind, s(a.csv), s(a.anchor_x), s(a.anchor_y), s(a.anchor_z), s(a.mode)];
}

const CSV_DESC =
  'a complete quickfort blueprint CSV whose FIRST non-blank line is the #dig or ' +
  '#zone modeline (e.g. "#dig\\nd,d\\nd,d"); the top-left data cell maps to the anchor';
const MODE_DESC =
  'blueprint mode — only "dig" and "zone" are supported in v1 (build/place are ' +
  'rejected with no token so nothing partially applies)';

// ---- blueprint_apply (actuator) --------------------------------------------
export const blueprintApplyDef = defineActuator<BlueprintArgs>({
  name: 'blueprint_apply',
  title: 'Apply blueprint',
  description:
    'Designate dig or zone from a quickfort blueprint CSV at an explicit anchor. ' +
    'EXECUTE-NEVER-DECIDE: you draft the CSV, name the anchor (x,y,z of its ' +
    'top-left cell) and the mode; the tool designates exactly that. Dry-run (no ' +
    'confirm_token) runs quickfort --dry-run and previews mode, anchor, ' +
    'tiles_affected, invalid_key_sequences, could_not_designate, footprint_cells, ' +
    'fog_of_war_tiles (undiscovered tiles under the footprint — reported as a ' +
    'fact, never blocked), pre_existing_designations (footprint tiles that ALREADY ' +
    'carry this designation — undo would clear those too, so the undo handle is ' +
    'flagged unfaithful when any exist), clipped_out_of_bounds, and a bounded ' +
    'structured conflicts list [{x,y,reason}] plus bounded parse_errors lines ' +
    'locating bad cells. A MALFORMED or over-large (>10000 cells) blueprint is ' +
    'BLOCKED with no token (quickfort would otherwise partially apply): the ' +
    'preview reports the reasons and issues no confirm_token. Pass the returned ' +
    'confirm_token to apply. Reversal: blueprint_undo with the same csv/anchor/mode ' +
    '(quickfort native undo). v1 scope: dig + zone only; build/place are rejected.',
  tokenPrefix: 'bp',
  shape: {
    csv: z.string().describe(CSV_DESC),
    anchor_x: z.number().int().describe('world x of the blueprint top-left cell'),
    anchor_y: z.number().int().describe('world y of the blueprint top-left cell'),
    anchor_z: z.number().int().describe('world z-level of the blueprint'),
    mode: z.string().describe(MODE_DESC),
  },
  plan: async (a): Promise<PlanResult | { error: string }> => {
    const r = await runJsonScript<PlanResult>('blueprint', blueprintArgv('plan_apply', a));
    return r as PlanResult | { error: string };
  },
  apply: async (a): Promise<ApplyResult | { error: string }> => {
    const r = await runJsonScript<ApplyResult>('blueprint', blueprintArgv('apply_apply', a));
    return r as ApplyResult | { error: string };
  },
});

// ---- blueprint_undo (actuator) ---------------------------------------------
export const blueprintUndoDef = defineActuator<BlueprintArgs>({
  name: 'blueprint_undo',
  title: 'Undo blueprint',
  description:
    'Revert a dig/zone designation previously made from a quickfort blueprint, using ' +
    "quickfort's native undo. Supply the SAME csv, anchor and mode that were applied. " +
    'Dry-run (no confirm_token) validates the CSV via quickfort undo --dry-run ' +
    '(a MALFORMED blueprint is BLOCKED with no token, with bounded parse_errors ' +
    'locating bad cells) and previews footprint_cells and currently_designated ' +
    '(how many footprint tiles carry the designation right now — what undo would ' +
    'clear); pass the returned confirm_token to apply. The token is void if any ' +
    "footprint tile's designation state changes before you apply. Reversal: " +
    'blueprint_apply with the same csv/anchor/mode. v1 scope: dig + zone only.',
  tokenPrefix: 'bp',
  shape: {
    csv: z.string().describe(CSV_DESC),
    anchor_x: z.number().int().describe('world x of the blueprint top-left cell'),
    anchor_y: z.number().int().describe('world y of the blueprint top-left cell'),
    anchor_z: z.number().int().describe('world z-level of the blueprint'),
    mode: z.string().describe(MODE_DESC),
  },
  plan: async (a): Promise<PlanResult | { error: string }> => {
    const r = await runJsonScript<PlanResult>('blueprint', blueprintArgv('plan_undo', a));
    return r as PlanResult | { error: string };
  },
  apply: async (a): Promise<ApplyResult | { error: string }> => {
    const r = await runJsonScript<ApplyResult>('blueprint', blueprintArgv('apply_undo', a));
    return r as ApplyResult | { error: string };
  },
});

import { z } from 'zod';
import { runJsonScript } from '../query.ts';
import { defineActuator, type PlanResult, type ApplyResult } from '../actuator.ts';

const s = (v: unknown): string => (v === undefined || v === null || v === '' ? '' : String(v));

interface BlueprintArgs {
  csv?: string;
  blueprint_path?: string;
  blueprint_label?: string;
  anchor_x: number;
  anchor_y: number;
  anchor_z: number;
  mode: string;
  confirm_token?: string;
}

function blueprintArgv(
  kind: 'plan_apply' | 'apply_apply' | 'plan_undo' | 'apply_undo',
  a: BlueprintArgs
): string[] {
  return [
    kind,
    s(a.csv),
    s(a.anchor_x),
    s(a.anchor_y),
    s(a.anchor_z),
    s(a.mode),
    s(a.blueprint_path),
    s(a.blueprint_label),
  ];
}

const CSV_DESC =
  'a complete quickfort blueprint CSV whose FIRST non-blank line is the #dig or ' +
  '#zone modeline (e.g. "#dig\\nd,d\\nd,d"); the top-left data cell maps to the ' +
  'anchor. Supply this OR blueprint_path, never both';
const PATH_DESC =
  'path of an on-disk blueprint from blueprint_library().entries[].path (e.g. ' +
  '"library/dreamfort.csv"), applied instead of an inline csv. Supply this OR csv, ' +
  'never both';
const LABEL_DESC =
  'which section of that file to apply — blueprint_library().entries[].label ' +
  '(e.g. "/dig_all", "surface1"). Omit to take the file\'s first blueprint';
const MODE_DESC =
  'blueprint mode — only "dig" and "zone" are supported in v1 (build/place are ' +
  'rejected with no token so nothing partially applies). Must match the ' +
  "blueprint's own modeline";

const SOURCE_SHAPE = {
  csv: z.string().optional().describe(CSV_DESC),
  blueprint_path: z.string().optional().describe(PATH_DESC),
  blueprint_label: z.string().optional().describe(LABEL_DESC),
};

export const blueprintApplyDef = defineActuator<BlueprintArgs>({
  name: 'blueprint_apply',
  title: 'Apply blueprint',
  description:
    'Designate dig or zone from a quickfort blueprint at an explicit anchor. The ' +
    'blueprint comes from ONE of two sources: an inline csv you draft, or a ' +
    'blueprint_path (+ optional blueprint_label) naming an on-disk blueprint ' +
    'listed by blueprint_library() — DFHack\'s shipped library (dreamfort, ' +
    'aquifer_tap, pump_stack, ...) or the user\'s own blueprints dir. Supplying ' +
    'both, or neither, is BLOCKED with no token. ' +
    'EXECUTE-NEVER-DECIDE: you name the source, the anchor (x,y,z the blueprint ' +
    'starts at) and the mode; the tool designates exactly that. Dry-run (no ' +
    'confirm_token) runs quickfort --dry-run and previews source, mode, anchor, ' +
    'tiles_affected, invalid_key_sequences, could_not_designate, footprint_cells, ' +
    'fog_of_war_tiles (undiscovered tiles under the footprint — reported as a ' +
    'fact, never blocked), pre_existing_designations (footprint tiles that ALREADY ' +
    'carry this designation — undo would clear those too, so the undo handle is ' +
    'flagged unfaithful when any exist), clipped_out_of_bounds, and a bounded ' +
    'structured conflicts list [{x,y,z,reason}] plus bounded parse_errors lines ' +
    'locating bad cells. A library blueprint may span several z-levels from the ' +
    'anchor (z_levels/z_levels_spanned report which); an inline csv is single-z. ' +
    'A MALFORMED or over-large (>10000 cells) blueprint is ' +
    'BLOCKED with no token (quickfort would otherwise partially apply): the ' +
    'preview reports the reasons and issues no confirm_token. Pass the returned ' +
    'confirm_token to apply. Reversal: blueprint_undo with the same source/anchor/mode ' +
    '(quickfort native undo). v1 scope: dig + zone only; build/place are rejected, ' +
    'which excludes the build/place phases of multi-phase library blueprints.',
  tokenPrefix: 'bp',
  shape: {
    ...SOURCE_SHAPE,
    anchor_x: z.number().int().describe('world x the blueprint starts at'),
    anchor_y: z.number().int().describe('world y the blueprint starts at'),
    anchor_z: z.number().int().describe('world z-level the blueprint starts at'),
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

export const blueprintUndoDef = defineActuator<BlueprintArgs>({
  name: 'blueprint_undo',
  title: 'Undo blueprint',
  description:
    'Revert a dig/zone designation previously made from a quickfort blueprint, using ' +
    "quickfort's native undo. Supply the SAME source, anchor and mode that were " +
    'applied — either the same csv, or the same blueprint_path (+ blueprint_label) ' +
    'from blueprint_library(). Supplying both, or neither, is BLOCKED with no token. ' +
    'Dry-run (no confirm_token) validates the blueprint via quickfort undo --dry-run ' +
    '(a MALFORMED blueprint is BLOCKED with no token, with bounded parse_errors ' +
    'locating bad cells) and previews footprint_cells and currently_designated ' +
    '(how many footprint tiles carry the designation right now — what undo would ' +
    'clear); pass the returned confirm_token to apply. The token is void if any ' +
    "footprint tile's designation state changes before you apply. Reversal: " +
    'blueprint_apply with the same source/anchor/mode. v1 scope: dig + zone only.',
  tokenPrefix: 'bp',
  shape: {
    ...SOURCE_SHAPE,
    anchor_x: z.number().int().describe('world x the blueprint starts at'),
    anchor_y: z.number().int().describe('world y the blueprint starts at'),
    anchor_z: z.number().int().describe('world z-level the blueprint starts at'),
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

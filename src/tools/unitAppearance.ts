import { runJsonScript } from '../query.ts';
import { z } from 'zod';
import type { ToolDef } from '../register.ts';
import { FOG_OF_WAR_NOTE, fogArgs, revealHiddenParam, type FogReport } from '../fog.ts';

export interface AppearanceFeature {
  feature: string;
  layer?: string;
  modifier: string;
  value: number;
  desc_band: number;
  parts?: string[];
  parts_truncated?: boolean;
}

export interface TissueStyle {
  tissue: string;
  style: string;
  layers: string[];
}

export interface AppearanceColor {
  part: string;
  pattern: string;
  pattern_type: string;
  colors: string[];
  since_age?: number;
  full_at_age?: number;
}

export interface Scar {
  part: string;
  layer?: string;
  kinds: string[];
}

export interface Decoration {
  type: string;
  material?: string;
  quality?: string;
}

export interface InventoryItem {
  item_id: number;
  role: string;
  body_part?: string;
  item?: string;
  type: string;
  material?: string;
  quality?: string;
  wear?: number;
  dye?: { material?: string; color?: string };
  decorations: Decoration[];
  artifact_name?: string;
}

export interface UnitAppearance extends FogReport {
  unit_id: number;
  name: string;
  race?: string;
  caste?: string;
  sex?: string;
  age?: number;
  body_size_cm3?: number;
  features: AppearanceFeature[];
  features_truncated?: boolean;
  tissue_styles: TissueStyle[];
  colors: AppearanceColor[];
  missing_parts: string[];
  missing_parts_truncated?: boolean;
  scars: Scar[];
  scars_truncated?: boolean;
  inventory: InventoryItem[];
  inventory_truncated?: boolean;
}

const LIST_FIELDS = ['features', 'tissue_styles', 'colors', 'missing_parts', 'scars', 'inventory'];

export function unitAppearance(
  unitId: number,
  revealHidden?: boolean
): Promise<UnitAppearance | { error: string }> {
  return runJsonScript<UnitAppearance>(
    'unitAppearance',
    [String(unitId), ...fogArgs(revealHidden)],
    LIST_FIELDS
  );
}

export const unitAppearanceDef: ToolDef = {
  name: 'unit_appearance',
  title: 'Unit appearance',
  description:
    'What ONE unit looks like, chained by unit_id from find_unit — the portrait ' +
    "read. Physical features come as DF's own appearance modifiers " +
    '(features[]: feature noun, tissue layer, modifier token such as LENGTH/' +
    'CLOSE_SET/HIGH_CHEEKBONES, raw value, and desc_band -3..3 placing the ' +
    "value in the caste's description bands, where 0 is the middle band DF's " +
    'own prose leaves undescribed). tissue_styles[] gives hair/beard/moustache/' +
    "sideburns styling (DF's tissue_style token, e.g. PONY_TAIL); colors[] " +
    "gives hair/skin/eyes as DF's descriptor pattern and color names, " +
    'including age-driven replacements (e.g. graying) once the unit is old ' +
    'enough, with since_age/full_at_age. Permanent marks: missing_parts[] ' +
    '(top-most severed part only) and scars[] (healed scar_* wound flags). ' +
    'inventory[] is what the unit is wearing, wielding, and carrying: role ' +
    '(Worn/Weapon/Flask/Hauled/...), body part, material, quality, wear level, ' +
    'dye, decorations, artifact name. Facts only — no prose reconstruction, no ' +
    'judgments. Lists are capped with *_truncated flags. Returns ' +
    '{"error":...} for an unknown unit_id or, with fog of war applied, one standing ' +
    'on an undiscovered tile, or {"error":"no fort loaded"} if no fort is active. ' +
    FOG_OF_WAR_NOTE,
  shape: {
    unit_id: z.coerce
      .number()
      .int()
      .nonnegative()
      .describe('A live unit_id, e.g. from a find_unit match'),
    reveal_hidden: revealHiddenParam,
  },
  run: ({ unit_id, reveal_hidden }) => unitAppearance(unit_id, reveal_hidden),
};

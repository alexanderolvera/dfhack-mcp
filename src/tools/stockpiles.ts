import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export type StockpileCategory =
  | 'animals'
  | 'food'
  | 'furniture'
  | 'corpses'
  | 'refuse'
  | 'stone'
  | 'ammo'
  | 'coins'
  | 'bars_blocks'
  | 'gems'
  | 'finished_goods'
  | 'leather'
  | 'cloth'
  | 'wood'
  | 'weapons'
  | 'armor'
  | 'sheet';

export interface Pile {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  z: number;
  size: number;
  categories: StockpileCategory[];
  barrels_allowed: boolean;
  bins_allowed: boolean;
  max_wheelbarrows: number;
  links_only: boolean;
  give_to: number[];
  give_to_truncated: boolean;
  take_from: number[];
  take_from_truncated: boolean;
  item_count: number;
}

export interface BacklogEntry {
  item_type: string;
  count: number;
}

export interface RottingOutsideStockpiles {
  count: number;
  by_type: BacklogEntry[];
  by_type_truncated: boolean;
}

export interface Stockpiles {
  piles: Pile[];
  piles_total: number;
  piles_truncated: boolean;
  unstored_backlog: BacklogEntry[];
  unstored_backlog_item_count: number;
  unstored_backlog_truncated: boolean;
  rotting_outside_stockpiles: RottingOutsideStockpiles;
  dump_flagged_count: number;
}

export async function stockpiles(): Promise<Stockpiles | { error: string }> {
  const data = await runJsonScript<Stockpiles>('stockpiles', [], ['piles', 'unstored_backlog']);
  if ('error' in data) return data;
  for (const p of data.piles) {
    if (!Array.isArray(p.categories)) p.categories = [];
    if (!Array.isArray(p.give_to)) p.give_to = [];
    if (!Array.isArray(p.take_from)) p.take_from = [];
  }
  if (data.rotting_outside_stockpiles && !Array.isArray(data.rotting_outside_stockpiles.by_type)) {
    data.rotting_outside_stockpiles.by_type = [];
  }
  return data;
}

export const stockpilesDef: ToolDef = {
  name: 'stockpiles',
  title: 'Stockpiles',
  description:
    "The fort's hauling/logistics picture: every stockpile as a fact sheet, plus " +
    "fort-wide backlog signals stockpiles alone don't surface. piles[] is one row " +
    'per stockpile building: id, exact bounds (x1/y1/x2/y2/z — the bounding box; ' +
    'an irregularly-shaped pile\'s real footprint can be smaller, see size), ' +
    'size (the pile\'s real tile count — for an irregular pile this reads its ' +
    'room.extents occupancy map rather than the bounding box, so holes/' +
    'excluded tiles are correctly excluded), categories[] (which of ' +
    "the 17 top-level stockpile groups this pile accepts — animals/food/" +
    'furniture/corpses/refuse/stone/ammo/coins/bars_blocks/gems/finished_goods/' +
    "leather/cloth/wood/weapons/armor/sheet; note Ore has no flag of its own in " +
    "DF's own stockpile_group_set — it rides under stone — and Misc " +
    "(organic/inorganic) is a refuse sub-filter, not a top-level category, so " +
    'neither appears in this list), barrels_allowed/bins_allowed (the pile\'s ' +
    'max_barrels/max_bins > 0 — DF stores 0 there specifically to mean "no ' +
    'containers of this kind," not "unlimited"), max_wheelbarrows (raw count; ' +
    '0 here means no wheelbarrow is assigned so DF queues one haul job per item, ' +
    'NOT "wheelbarrows disallowed" — this one has no allowed/disallowed reading, ' +
    "unlike barrels/bins), links_only (DF's own \"take from links only\" toggle), " +
    'give_to[]/take_from[] (ids of stockpiles this pile explicitly feeds into / ' +
    'pulls from via the g/q-t hauling-route UI, each capped at 50 with its own ' +
    '_truncated flag), item_count (exact count of non-rotten/non-dump/non-' +
    "forbidden/non-construction/non-trader items physically sitting on the pile's " +
    "tiles right now — via each item's resolved position, so items inside a bin " +
    'or barrel parked on the pile count too — regardless of whether the pile\'s ' +
    'own categories[] actually accept that item, since this is a positional fact, ' +
    'not a settings-compliance check). There is no fullness/occupancy percentage: ' +
    'an earlier draft derived one from a placeholder items-per-tile constant, but ' +
    'it produced numbers with no real relationship to the game\'s actual per-tile ' +
    'capacity (which varies by item size and container packing) and was dropped ' +
    'rather than ship a fabricated fact — join item_count against size yourself ' +
    'if you want a rough density signal. Fort-wide: unstored_backlog[] groups ' +
    "loose items (on the ground, not rotten/dump/forbidden/under-construction/" +
    'trader-owned, and not sitting on ANY stockpile\'s tiles) by their raw DF item ' +
    'type token, with unstored_backlog_item_count as the grand total and a 150-' +
    'distinct-type cap; this is the hauling backlog the issue asks for. ' +
    'rotting_outside_stockpiles is the same idea for the ROTTEN subset specifically ' +
    '(food/organic matter that has already decayed while lying outside any ' +
    'stockpile, i.e. hauling arrived too late) — {count, by_type[], ' +
    'by_type_truncated}. dump_flagged_count is an exact, unfiltered count of every ' +
    'item currently designated for dumping, wherever it sits. Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  run: stockpiles,
};

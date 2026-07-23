---
tool: stockpiles
tier: sensor
gated: none
source: src/tools/stockpiles.ts
lua: src/dfhack-queries/mcp_stockpiles.lua
tags: [dfhack-mcp/tool]
---

> **Status: draft, not yet verified against a live fort.** Field paths below follow DFHack 53.15-r2's documented structures but have not been confirmed against a running game. Needs a `verify:t1`/`verify:t2` pass and a committed golden before this ships.

# stockpiles

> Every stockpile as a fact sheet, plus the fort-wide hauling backlog no single pile shows.

## Purpose
Hauling/logistics is a top-3 mid-game sink and, until now, fully invisible to an AI co-pilot: `stocks` reports fort-wide totals but nothing about where goods physically sit, and nothing else reports whether the piles themselves are configured sanely, linked correctly, or falling behind. `stockpiles` closes that gap: one row per stockpile (categories accepted, exact bounds, container permissions, give/take links, and an approximate fullness reading), plus three fort-wide backlog signals — unstored items piling up outside any pile, food/organic matter that has already rotted while sitting unstored, and items currently flagged for dumping. Reports what is true of the piles and the backlog, not what to build or reconfigure.

## Parameters
None.

## Returns
- `piles[]` — one row per stockpile building (capped at 200 — see `piles_total`/`piles_truncated`):
  - `id` — the building's id.
  - `x1, y1, x2, y2, z` — the pile's exact tile bounds (top-left/bottom-right corners) and z-level.
  - `size` — tile count (`(x2-x1+1) * (y2-y1+1)`); also the denominator behind `fullness_pct`.
  - `categories[]` — which of the 17 top-level stockpile groups this pile accepts: `animals`, `food`, `furniture`, `corpses`, `refuse`, `stone`, `ammo`, `coins`, `bars_blocks`, `gems`, `finished_goods`, `leather`, `cloth`, `wood`, `weapons`, `armor`, `sheet`. Sorted, can be empty (a pile with every category unchecked).
  - `barrels_allowed`, `bins_allowed` — whether this pile's container limits (`max_barrels`/`max_bins`) are above zero.
  - `max_wheelbarrows` — the raw wheelbarrow-assist limit (0 through 3).
  - `links_only` — DF's own "take from links only" toggle.
  - `give_to[]` / `give_to_truncated`, `take_from[]` / `take_from_truncated` — ids of other stockpiles this pile explicitly feeds into / pulls from (the hauling-route give/take links), each capped at 50.
  - `item_count` — exact count of items physically sitting on the pile's tiles right now.
  - `fullness_pct` — an approximate, rough fullness reading (see Caveats).
- `piles_total` (number), `piles_truncated` (boolean).
- `unstored_backlog[]` — `{ item_type, count }`, loose items sitting on the ground outside any stockpile, grouped by DF's raw item-type token, sorted by token, capped at 150 distinct types.
- `unstored_backlog_item_count` (number) — the grand total across all of `unstored_backlog[]` (not just the capped rows shown).
- `unstored_backlog_truncated` (boolean).
- `rotting_outside_stockpiles` — `{ count, by_type[], by_type_truncated }`, the same shape as the backlog but for items that have already rotted while lying unstored (capped at 100 distinct types).
- `dump_flagged_count` (number) — exact count of every item currently designated for dumping, regardless of where it sits.

```json
{
  "piles": [
    {
      "id": 412,
      "x1": 40, "y1": 22, "x2": 44, "y2": 26, "z": 120,
      "size": 25,
      "categories": ["food"],
      "barrels_allowed": true,
      "bins_allowed": false,
      "max_wheelbarrows": 0,
      "links_only": false,
      "give_to": [],
      "give_to_truncated": false,
      "take_from": [],
      "take_from_truncated": false,
      "item_count": 88,
      "fullness_pct": 88
    }
  ],
  "piles_total": 12,
  "piles_truncated": false,
  "unstored_backlog": [
    { "item_type": "BOULDER", "count": 14 },
    { "item_type": "WOOD", "count": 3 }
  ],
  "unstored_backlog_item_count": 17,
  "unstored_backlog_truncated": false,
  "rotting_outside_stockpiles": {
    "count": 0,
    "by_type": [],
    "by_type_truncated": false
  },
  "dump_flagged_count": 2
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- **Fullness is a deliberately rough proxy, not the game's real capacity math**: `fullness_pct = round(100 * item_count / (size * 4))`, where `4` is a placeholder "loose items per tile" constant. DF's actual per-tile capacity varies with item size and container packing, so a pile stocked mostly through bins/barrels can legitimately read well over 100%. Treat `fullness_pct` as a directional signal ("this pile is busier than that one"), never a precise percentage — a coarser approximation was chosen deliberately over a more expensive one (walking each tile's real occupancy rules).
- `item_count` (and therefore `fullness_pct`) counts any qualifying item physically located on the pile's tiles right now, resolved through containers, **regardless of whether the pile's own `categories[]` would actually accept that item** — it is a positional fact (what is sitting there), not a settings-compliance check (whether it's supposed to be there).
- `item_count` excludes rotten/dump-designated/forbidden/under-construction/trader-owned items, the same exclusion set `stocks`/`farming` use fort-wide — a decayed item sitting on a stockpile tile is invisible to both `item_count` and `rotting_outside_stockpiles` (the latter only looks outside piles by design).
- Ore has no flag of its own in DF's `stockpile_group_set` — it rides under `stone`'s flag in-game (the Ore stockpile is a sub-tab of Stone). Misc (organic/inorganic material toggle) is a filter inside the Refuse settings, not a top-level category. Neither appears in `categories[]`, which lists only the 17 real top-level bits.
- `barrels_allowed`/`bins_allowed` read `max_barrels`/`max_bins > 0`; DF stores `0` there specifically to mean "no containers of this kind," not "unlimited" (confirmed against the DF wiki's stockpile documentation, not yet against live game state). `max_wheelbarrows` has no such allowed/disallowed reading — `0` means "no wheelbarrow assigned, one haul job per item," not "wheelbarrows disallowed" — so it is reported as a raw count instead of a derived boolean.
- `unstored_backlog[]`/`rotting_outside_stockpiles` group by DF's own raw item-type token (e.g. `BOULDER`, `MEAT`, `WEAPON`), not by stockpile category — the two vocabularies differ (a single stockpile category like `food` spans many item types) and conflating them risked misrepresenting a mapping this draft has not verified live.
- `unstored_backlog`/`rotting_outside_stockpiles` only count items flagged `on_ground` (DF's own "lying loose, not carried/equipped/installed" flag) that are not on any stockpile's tiles — an item mid-haul in a dwarf's hands, equipped, or built into a workshop is not "backlog."
- `give_to[]`/`take_from[]` are the pile's own explicit hauling-route links (the g/q-t UI), not an inference from category overlap — two piles that happen to accept the same category are NOT reported as linked unless a route actually exists.
- **This entire tool is an unverified draft** — every field path below comes from DFHack's public `df-structures` definitions and DF wiki documentation, not from a live read against a running fort. See Implementation notes for exactly what needs live confirmation, in priority order.

## Implementation notes
- Piles come from `df.global.world.buildings.other.STOCKPILE` (`building_stockpilest`, inherits `building` for `id`/`x1`/`y1`/`x2`/`y2`/`z`). `categories[]` reads `sp.settings.flags.<name>` off the `stockpile_group_set` bitfield (`stockpile_settings.flags`) — **not yet confirmed live**: dynamic-key bitfield access (`flags[cat]` in a loop) follows the same idiom this codebase uses for static bitfield fields elsewhere (e.g. `u.flags3.ghostly` in `mcp_roomsAndZones.lua`), but every other tool in this codebase accesses bitfield fields by a static, known name, never a variable — this is the single highest-priority thing to verify against a live fort.
- `barrels_allowed`/`bins_allowed`/`max_wheelbarrows` read `sp.storage.max_barrels`/`max_bins`/`max_wheelbarrows` (`stockpile_storage_infost`, under `building_stockpilest.storage`). `links_only` reads `sp.stockpile_flag.use_links_only` (`building_stockpile_flag` bitfield). `give_to`/`take_from` read `sp.links.give_to_pile[]`/`take_from_pile[]` (`stockpile_links`, vectors of `building_stockpilest` pointers) — each element used directly as a building (`.id`), the same auto-dereferencing pattern `mcp_roomsAndZones.lua` relies on for `z.contained_buildings`.
- `item_count`/backlog/rotting all derive from one pass over `df.global.world.items.other.IN_PLAY`, positioned via `dfhack.items.getPosition(item)` (the same call `mcp_roomsAndZones.lua`'s hospital-supply count uses, which resolves an item's position through its container) and matched against each pile's `(x1..x2, y1..y2, z)` bounding box. This is the same "contained-item count vs. a rough tile-capacity estimate" proxy issue #79 asked for, chosen over walking each tile's real occupancy/stacking rules.
- The exclusion set for `item_count`/`unstored_backlog` (`rotten`/`dump`/`forbid`/`construction`/`trader`/`garbage_collect`) mirrors `mcp_stocks.lua`/`mcp_farming.lua` exactly, for consistency with how this codebase already defines "real, present, uncommitted" items fort-wide.
- Priority order for live verification: (1) the dynamic bitfield-key access for `categories[]` — confirm it returns real booleans and not `nil`/an error; (2) that `max_barrels`/`max_bins == 0` genuinely means "disabled" rather than "uninitialized" on a freshly-placed pile (the DF wiki's account, not yet checked against actual field values); (3) that `dfhack.items.getPosition` resolves contained items (e.g. cloth inside a bin on a stockpile tile) rather than only loose on-ground items, since `item_count`/fullness depend on it; (4) a sanity check of `fullness_pct` against a fixture pile with a known, eyeballed occupancy, to see whether the `4`-per-tile constant is in a remotely plausible range or needs retuning.

## Related
[stocks](stocks.md) (fort-wide material totals this tool locates spatially) · [trade](trade.md) (goods staged at the depot, outside the stockpile system) · [rooms_and_zones](rooms_and_zones.md) (the same building/civzone-derived-facts shape, applied to rooms) · [jobs_and_labor](jobs_and_labor.md) (who would do the hauling this tool's backlog implies is needed)

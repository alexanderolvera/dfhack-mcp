---
tool: stockpiles
tier: sensor
gated: none
source: src/tools/stockpiles.ts
lua: src/dfhack-queries/mcp_stockpiles.lua
tags: [dfhack-mcp/tool]
---

# stockpiles

> Every stockpile as a fact sheet, plus the fort-wide hauling backlog no single pile shows.

## Purpose
Hauling/logistics is a top-3 mid-game sink and, until now, fully invisible to an AI co-pilot: `stocks` reports fort-wide totals but nothing about where goods physically sit, and nothing else reports whether the piles themselves are configured sanely, linked correctly, or falling behind. `stockpiles` closes that gap: one row per stockpile (categories accepted, exact bounds, container permissions, give/take links, and how full it actually is), plus three fort-wide backlog signals — unstored items piling up outside any pile, food/organic matter that has already rotted while sitting unstored, and items currently flagged for dumping. Reports what is true of the piles and the backlog, not what to build or reconfigure.

## Parameters
None.

## Returns
- `piles[]` — one row per stockpile building (capped at 200 — see `piles_total`/`piles_truncated`):
  - `id` — the building's id.
  - `x1, y1, x2, y2, z` — the pile's bounding box (top-left/bottom-right corners) and z-level. For an irregularly-shaped pile this can be larger than the pile's real footprint — see `size`.
  - `size` — the pile's real tile count. For a rectangular pile this is `(x2-x1+1) * (y2-y1+1)`; for an irregular pile (one with holes carved out via the in-game shape editor) this instead counts only the tiles DF's own `room.extents` occupancy map marks as part of the stockpile.
  - `categories[]` — which of the 17 top-level stockpile groups this pile accepts: `animals`, `food`, `furniture`, `corpses`, `refuse`, `stone`, `ammo`, `coins`, `bars_blocks`, `gems`, `finished_goods`, `leather`, `cloth`, `wood`, `weapons`, `armor`, `sheet`. Sorted, can be empty (a pile with every category unchecked).
  - `barrels_allowed`, `bins_allowed` — whether this pile's container limits (`max_barrels`/`max_bins`) are above zero.
  - `max_wheelbarrows` — the raw wheelbarrow-assist limit (unbounded; confirmed live up to 10 on the fixture, not capped at DF UI's usual 3-per-click increment).
  - `links_only` — DF's own "take from links only" toggle.
  - `give_to[]` / `give_to_truncated`, `take_from[]` / `take_from_truncated` — ids of other stockpiles this pile explicitly feeds into / pulls from (the hauling-route give/take links), each capped at 50.
  - `item_count` — exact count of items physically sitting on the pile's tiles right now.
  - `occupied_tiles` — how many of the pile's `size` tiles have at least one qualifying item on them right now. A directly-counted spatial fact, bounded `[0, size]` — NOT a capacity/fullness percentage (see Caveats for why one isn't reported).
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
      "occupied_tiles": 22
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
- `occupied_tiles` is spatial coverage (tiles with something on them), not a capacity/fullness percentage. An earlier draft derived a `fullness_pct` from a placeholder "items per tile" constant, but it had no real relationship to DF's actual per-tile capacity (which varies by item size and container packing) — a bin/barrel-heavy pile read well over 1000% — so it was dropped rather than ship a fabricated fact. `occupied_tiles / size` is a defensible "how much of this pile's footprint is doing something" ratio if you want one, but a fully-packed single tile and an empty one both read the same 1-tile "occupied" — it says nothing about how much is stored on that tile.
- `item_count` counts any qualifying item physically located on the pile's tiles right now, resolved through containers, **regardless of whether the pile's own `categories[]` would actually accept that item** — it is a positional fact (what is sitting there), not a settings-compliance check (whether it's supposed to be there).
- `item_count` excludes rotten/dump-designated/forbidden/under-construction/trader-owned items, the same exclusion set `stocks`/`farming` use fort-wide — a decayed item sitting on a stockpile tile is invisible to both `item_count` and `rotting_outside_stockpiles` (the latter only looks outside piles by design).
- Ore has no flag of its own in DF's `stockpile_group_set` — it rides under `stone`'s flag in-game (the Ore stockpile is a sub-tab of Stone). Misc (organic/inorganic material toggle) is a filter inside the Refuse settings, not a top-level category. Neither appears in `categories[]`, which lists only the 17 real top-level bits.
- `barrels_allowed`/`bins_allowed` read `max_barrels`/`max_bins > 0`; DF stores `0` there specifically to mean "no containers of this kind," not "unlimited" — confirmed live (see Implementation notes). `max_wheelbarrows` has no such allowed/disallowed reading — `0` means "no wheelbarrow assigned, one haul job per item," not "wheelbarrows disallowed" — so it is reported as a raw count instead of a derived boolean.
- `unstored_backlog[]`/`rotting_outside_stockpiles` group by DF's own raw item-type token (e.g. `BOULDER`, `MEAT`, `WEAPON`), not by stockpile category — the two vocabularies differ (a single stockpile category like `food` spans many item types) and conflating them risked misrepresenting the mapping.
- `unstored_backlog`/`rotting_outside_stockpiles` only count items flagged `on_ground` (DF's own "lying loose, not carried/equipped/installed" flag) that are not on any stockpile's tiles — an item mid-haul in a dwarf's hands, equipped, or built into a workshop is not "backlog."
- `give_to[]`/`take_from[]` are the pile's own explicit hauling-route links (the g/q-t UI), not an inference from category overlap — two piles that happen to accept the same category are NOT reported as linked unless a route actually exists.

## Implementation notes
**Confirmed live on DFHack 53.15-r2 against the Dreamfort fixture** (60 stockpiles, [#79](https://github.com/alexanderolvera/dfhack-mcp/issues/79)):
- Piles come from `df.global.world.buildings.other.STOCKPILE` (`building_stockpilest`, inherits `building` for `id`/`x1`/`y1`/`x2`/`y2`/`z`). `categories[]` reads `sp.settings.flags.<name>` off the `stockpile_group_set` bitfield via a dynamic-key loop (`flags[cat]`) — the single highest-risk piece of the original draft, since every other tool in this codebase accesses bitfield fields by a static, known name. Verified directly: enumerating `pairs(sp.settings.flags)` live returns exactly the 17 named tokens this tool checks for (plus unnamed numeric bit indices for the reserved/unused bits, which the loop correctly ignores since it only probes the 17 known names) — no `nil`s, no errors, and the per-pile category distribution across the fixture's 60 piles (27 `food`, 11 `bars_blocks`, 2 `corpses`, etc.) lines up with what those piles visibly hold.
- `barrels_allowed`/`bins_allowed`/`max_wheelbarrows` read `sp.storage.max_barrels`/`max_bins`/`max_wheelbarrows` (`stockpile_storage_infost`, under `building_stockpilest.storage`) — confirmed live: raw `max_barrels`/`max_bins` values on the fixture ranged 0-83 and 0-2 respectively (never negative, never a magic "unlimited" sentinel), and `max_wheelbarrows` varied 0-10 across a handful of piles, so the field is genuinely read, not stuck at a default. `links_only` reads `sp.stockpile_flag.use_links_only` (`building_stockpile_flag` bitfield). `give_to`/`take_from` read `sp.links.give_to_pile[]`/`take_from_pile[]` (`stockpile_links`, vectors of `building_stockpilest` pointers) — each element used directly as a building (`.id`). Cross-checked every reciprocal pair in the fixture's link graph (a `give_to` on one pile always had a matching `take_from` on the target and vice versa); this reciprocity is now also enforced fort-wide by the `stockpiles_wellformed` invariant.
- `item_count`/`occupied_tiles`/backlog/rotting all derive from one pass over `df.global.world.items.other.IN_PLAY`, positioned via `dfhack.items.getPosition(item)` and matched against each pile's footprint — first a cheap `(x1..x2, y1..y2, z)` bounding-box reject, then an exact per-tile membership check against `room.extents` (DFHack's own `df.building.xml` `building_extents_type`: `None`/`Stockpile`/`Wall`/`Interior`/`DistanceBoundary`, row-major over `room.width × room.height` anchored at `room.x`/`room.y`). **Confirmed live, and corrected mid-review**: `room.extents` is populated for every stockpile on the fixture, not only irregular ones as first assumed — all 60 of Dreamfort's piles are plain rectangles with every extents cell reading `Stockpile` (no holes), which the membership check still handles correctly (`size` exactly equals the bounding-box area on all of them). The pointer itself has no Lua `#length` — confirmed live it throws `attempt to get length of a userdata value` — so its element count comes from the sibling `room.width`/`room.height` fields instead, not from `#extents`. The genuinely-irregular-pile case (extents cells actually reading `None` for a carved-out hole) remains unexercised live, since the fixture has none — flagged as the top follow-up item. `occupied_tiles` (distinct tile positions with at least one qualifying item) is confirmed to resolve items sitting inside a container (e.g. a barrel parked on a pile tile), not just loose on-ground items: a 9-tile food pile on the fixture reported `item_count=842` across only `occupied_tiles=3` of its 9 tiles — a real, useful "most of this pile is actually empty despite a huge item count" fact the removed `fullness_pct` heuristic could never have surfaced correctly.
- The exclusion set for `item_count`/`unstored_backlog` (`rotten`/`dump`/`forbid`/`construction`/`trader`/`garbage_collect`) mirrors `mcp_stocks.lua`/`mcp_farming.lua` exactly. Confirmed on the fixture's one rotten item fort-wide: it sits on a refuse pile's own tile, so it is correctly excluded from both `item_count` (rotten items never count) and `rotting_outside_stockpiles` (which only looks *outside* piles) — exactly the documented caveat above, observed live rather than assumed.
- `dump_flagged_count` matched an independent fort-wide count of `item.flags.dump` (both read 0 on the fixture).

## Related
[stocks](stocks.md) (fort-wide material totals this tool locates spatially) · [trade](trade.md) (goods staged at the depot, outside the stockpile system) · [rooms_and_zones](rooms_and_zones.md) (the same building/civzone-derived-facts shape, applied to rooms) · [jobs_and_labor](jobs_and_labor.md) (who would do the hauling this tool's backlog implies is needed)

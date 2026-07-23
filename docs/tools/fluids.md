---
tool: fluids
tier: sensor
gated: none
source: src/tools/fluids.ts
lua: src/dfhack-queries/mcp_fluids.lua
tags: [dfhack-mcp/tool]
---

# fluids

> **Status: draft, not yet verified against a live fort.** Field paths below follow DFHack 53.15-r2's documented structures but have not been confirmed against a running game. Needs a `verify:t1`/`verify:t2` pass and a committed golden before this ships.

> Water and magma engineering facts: aquifers, standing/flowing water, the magma sea, flood exposure at the fort interior, and well water-source depth.

## Purpose
The Earthworks tier (`tile_region`, `geology`, `map_overview`) reads dry terrain and rock layers, but water/magma engineering — wells drying up, aquifer breach planning, flooding exposure, magma-forge feasibility — was blind (issue [#80](https://github.com/alexanderolvera/dfhack-mcp/issues/80)). An AI co-pilot calls this to see which z-levels carry a light vs. heavy aquifer before planning a breach, how much standing water exists and where, whether the magma sea has been struck yet, whether any full-depth water sits right next to the fort's reachable interior, and how deep a well's water source sits below it.

## Parameters
None.

## Returns
- `aquifer_layers[]` — `{ z_top, z_bottom, classification, light_tiles, heavy_tiles }`, one row per contiguous run of revealed z-levels sharing the same classification. `classification` is `"light"`, `"heavy"`, or `"mixed"` (both light and heavy aquifer tiles revealed within that same run of z-levels). Rows are built top-down (highest `z_top` first) and only ever include **revealed** aquifer tiles — an aquifer layer not yet dug into or otherwise discovered contributes nothing. Capped at 50 rows (`aquifer_layers_total`/`aquifer_layers_truncated`).
- `water_layers[]` — `{ z, tiles, salt_tiles, fresh_tiles, stagnant_tiles, flowing_tiles, max_depth }`, one row per z-level with at least one revealed standing/flowing water tile (`flow_size > 0`, non-magma). This is a **per-z-level aggregate**, not a flood-filled list of discrete named bodies — a single lake or river spanning several z-levels (a ramp, a waterfall) shows up as one row per level it touches, with no attempt to tell "this is one lake" from "these are two ponds" at the same depth. `max_depth` is the deepest `flow_size` seen at that level (1..7). Capped at 200 rows (`water_layers_total`/`water_layers_truncated`).
- `magma_sea` — `{ top_z, revealed_tile_count }` or `null`. The highest revealed z-level carrying at least 20 revealed magma tiles (a size floor meant to separate a genuine magma sea/lake from a small magma pool or volcano pipe — see Caveats). `null` if no z-level clears that floor among revealed tiles (including "no magma revealed anywhere yet").
- `flood_risk_tiles[]` — `{ x, y, z, salt, stagnant, footing, from_core }`, revealed **full-depth** water tiles (`flow_size == 7`) that are chebyshev-adjacent (one of the 8 neighboring tiles, same z) to a tile in the same DFHack walkable group as at least one citizen. This is a flood-**exposure** fact — this water is physically next to fort-reachable space right now — not a prediction that it will breach or flood anything; whether it does depends on walls/floodgates this tool doesn't model. `footing` is the terrain glyph/legend entry (from the shared `mcp_readTerrain` legend, see `legend`) for that tile itself; `from_core` mirrors `defenses`' `threats[].from_core` shape (`dist` chebyshev tiles, `dz` z-levels, `dir` compass bearing) from the fort's citizen centroid. Capped at 50, sorted by z descending then x, y (`flood_risk_total`/`flood_risk_truncated` track the real count).
- `wells[]` — `{ x, y, z, source, depth_to_source }`, one row per completed or in-progress well building. Extends `rooms_and_zones`' well read (which reports `z`/`working`/`source` per well but no position) with the well's `x`/`y` and `depth_to_source` — the number of z-levels scanned down from the well before a liquid or frozen-liquid tile was found. `source` is `"water"`, `"magma"`, `"frozen"`, or `"unknown"` (scan exhausted its depth budget, or hit a hidden tile, without finding a source). `depth_to_source` is absent (not `0`) when `source` is `"unknown"`. Capped at 20 (`wells_total`/`wells_truncated`), sorted by z descending then x, y.
- `legend` — the shared `mcp_readTerrain` glyph legend (same object farming/defenses/tile_region use elsewhere), included so `flood_risk_tiles[].footing` is self-describing without a second call.
- `scan` — `{ complete, tiles_scanned, last_z_scanned }`. `complete: false` means the fort-wide tile-budget cap (20,000,000 tiles) was hit before the scan reached `z = 0`; `last_z_scanned` is where it stopped. Every field above is still fog-of-war-safe when this happens — a truncated scan only means some deep layers weren't examined, never that a hidden tile's real state leaked.

```json
{
  "aquifer_layers": [
    { "z_top": 88, "z_bottom": 84, "classification": "light", "light_tiles": 412, "heavy_tiles": 0 }
  ],
  "aquifer_layers_total": 1,
  "aquifer_layers_truncated": false,
  "water_layers": [
    { "z": 95, "tiles": 63, "salt_tiles": 0, "fresh_tiles": 63, "stagnant_tiles": 12, "flowing_tiles": 51, "max_depth": 7 }
  ],
  "water_layers_total": 1,
  "water_layers_truncated": false,
  "magma_sea": { "top_z": 12, "revealed_tile_count": 340 },
  "flood_risk_tiles": [
    { "x": 101, "y": 88, "z": 95, "salt": false, "stagnant": false, "footing": "~",
      "from_core": { "dist": 6, "dz": 0, "dir": "NE" } }
  ],
  "flood_risk_total": 1,
  "flood_risk_truncated": false,
  "wells": [
    { "x": 99, "y": 90, "z": 95, "source": "water", "depth_to_source": 3 }
  ],
  "wells_total": 1,
  "wells_truncated": false,
  "legend": { "~": "brook bed", "#": "wall / solid rock" },
  "scan": { "complete": true, "tiles_scanned": 4128768, "last_z_scanned": 0 }
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- **Revealed-only, always.** Every tile visited is gated on `designation.hidden` before it can contribute to any field; an undiscovered aquifer, water body, or magma tile is invisible here exactly as it is to the player. This tool `reqscript`s `mcp_readTerrain` (see `CONTRIBUTING.md` "Shared internals: fog-of-war safety") for the shared terrain glyph/legend convention rather than inventing a second one.
- **`water_layers[]` is not body detection.** There is no flood-fill/connectivity pass — two disconnected ponds at the same z-level are indistinguishable from one lake at that z-level; a single lake spanning multiple z-levels (common with ramps/waterfalls) appears as multiple rows, one per level. Treat each row as "how much revealed water is at this depth", not "here is lake #1".
- **`magma_sea`'s 20-tile floor is a heuristic, unverified live.** It exists to avoid reporting a small magma pool or a volcano's pipe as "the magma sea". The threshold itself (20 revealed tiles) has not been tuned against a real fort — a live pass should check it against both a genuine magma sea and a known small magma feature and adjust if it either under- or over-fires.
- **`flood_risk_tiles[]` is exposure, not a leak prediction.** "Adjacent to the fort's interior" means chebyshev-adjacent to a tile sharing a citizen's walkable group — it does not know whether a wall, a floodgate, or solid rock separates the water from that space (a full-depth water tile next to a completed, sealed wall is still reported). It is the same kind of raw proximity fact `defenses`' `threats[].nearest_bridge` is — a distance, not a verdict.
- **Aquifer heaviness is genuinely per-tile**, not per-block or per-region: DFHack's own `Maps::isTileHeavyAquifer` reads `occupancy.heavy_aquifer` per tile (confirmed against `df-structures`' `df.d_basics.xml` and DFHack's `Maps.cpp` — see Implementation notes). `classification: "mixed"` is a real, expected case wherever a layer has both.
- **Performance is unverified.** The scan walks every 16x16 map block from `z_count-1` down to `0` (skipping only what fog-of-war gates cheaply per-tile once each block is fetched), capped at a 20,000,000-tile budget (`scan.complete`/`scan.tiles_scanned`/`scan.last_z_scanned`). This has not been timed against a live fort of any size. A large embark with a tall map could be slow enough to matter for an interactive RPC call; this is the single most important thing to check in the live T1/T2 pass, and the budget constant may need to shrink (or the scan may need a bounding box/z-range parameter) if it is.
- `wells[]`'s scan mirrors `rooms_and_zones`' `well_source` field-for-field (same `flow_size`/`liquid_type`/`FROZEN_LIQUID`-material lookup, same 40-z-level search depth) rather than a different algorithm, extended here with `x`/`y` and `depth_to_source` — that function is a private local in `mcp_roomsAndZones.lua` with no module boundary to `reqscript`, so the two copies are a real (small) duplication risk; if they ever need to change, change both. A follow-up could extract a shared `well_water_source` into a reusable module.
- `aquifer_layers[]`, `water_layers[]`, `flood_risk_tiles[]`, and `wells[]` are all capped (50 / 200 / 50 / 20 respectively); each has a `_total` and `_truncated` pair to detect overflow.

## Implementation notes
Per-tile fluid facts come from `map_block.designation` (`df.d_basics.xml`'s `tile_designation` bitfield): `flow_size` (0..7, liquid amount), `liquid_type` (0=Water/1=Magma, read the same truthy way `rooms_and_zones`' `well_source` and `tile_region` already do: `des.liquid_type and 'magma' or 'water'`), `water_salt`, `water_stagnant`, and `water_table` (comment in the structure file: "aquifer"). Aquifer heaviness comes from the **sibling** `map_block.occupancy` array's `tile_occupancy` bitfield field `heavy_aquifer` (`original-name='DES_HEAVY_WATER_TABLE'`, `since='v0.47.01'`, comment "Light/Heavy aquifer flag") — confirmed via DFHack's own `Maps::isTileHeavyAquifer` (`library/modules/Maps.cpp`), which reads exactly this field, alongside `Maps::isTileAquifer` reading `designation.water_table`. Both were cross-checked against `df-structures` (`df.d_basics.xml`) and DFHack's `Maps.cpp` source directly (tag/branch matching 53.15-r2 era), not inferred — light/heavy is a genuine per-tile flag, not a per-block or per-region property, resolving the open question from issue #80.

The block-level `has_aquifer`/`check_aquifer` flags noted in `df.block.xml` (`block_flags` bitfield) were intentionally **not** used as a scan pre-filter here — they're bay12-internal aggregate/cache flags rather than a value this tool needed to special-case, and folding aquifer/water/magma detection into one single per-tile pass (rather than a separate has_aquifer-gated pass) kept the scan to one traversal instead of two. `magma_by_z`'s companion block flags (`has_magma_close`/`has_magma_far`, and the third one which is genuinely misspelled `mas_magma_low` in the upstream structure file, not a typo introduced here) were considered as a cheaper magma pre-filter but not used, for the same one-pass-is-simpler reason; a live perf pass may want to revisit this if the full scan proves too slow.

Fort interior (for `flood_risk_tiles[]`'s adjacency test) reuses the exact `dfhack.maps.getWalkableGroup(xyz2pos(...))`-over-citizen-positions pattern `defenses` already uses for its own `threats[].location`/`interior` fields — not re-derived differently, just the same small pattern inlined (there's no shared module for it to `reqscript`, unlike the terrain/unit-visibility fog-of-war checks).

None of this has been run against a live fort or DFHack process — every field path above is a documented-structure read, not a confirmed-live one. See the draft-status callout at the top of this page.

## Related
[rooms_and_zones](rooms_and_zones.md) · [tile_region](tile_region.md) · [geology](geology.md) · [defenses](defenses.md) · [environment](environment.md)

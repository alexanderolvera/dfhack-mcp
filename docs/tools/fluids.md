---
tool: fluids
tier: sensor
gated: none
source: src/tools/fluids.ts
lua: src/dfhack-queries/mcp_fluids.lua
tags: [dfhack-mcp/tool]
---

# fluids

> **Status: verified live against DFHack 53.15-r2 and the Dreamfort fixture** ([#80](https://github.com/alexanderolvera/dfhack-mcp/issues/80)). `aquifer_layers` and `wells` were cross-checked against `geology` and `rooms_and_zones` on the same fixture and agree (see Implementation notes); `water_table`/`flow_size`/`liquid_type` field reads are confirmed correct on live data. Dreamfort's fixture never revealed magma or salt water, so `magma_sea` and the `water_salt`/`salt_tiles` paths are still unexercised on live data — see Caveats.

> Water and magma engineering facts: aquifers, standing/flowing water, the magma sea, flood exposure at the fort interior, and well water-source depth.

## Purpose
The Earthworks tier (`tile_region`, `geology`, `map_overview`) reads dry terrain and rock layers, but water/magma engineering — wells drying up, aquifer breach planning, flooding exposure, magma-forge feasibility — was blind (issue [#80](https://github.com/alexanderolvera/dfhack-mcp/issues/80)). An AI co-pilot calls this to see which z-levels carry a light vs. heavy aquifer before planning a breach, how much standing water exists and where, whether the magma sea has been struck yet, whether any full-depth water sits right next to the fort's reachable interior, and how deep a well's water source sits below it.

## Parameters
None.

## Returns
- `aquifer_layers[]` — `{ z_top, z_bottom, classification, light_tiles, heavy_tiles }`, one row per contiguous run of revealed z-levels sharing the same classification. `classification` is `"light"`, `"heavy"`, or `"mixed"` (both light and heavy aquifer tiles revealed within that same run of z-levels). Rows are built top-down (highest `z_top` first) and only ever include **revealed** aquifer tiles — an aquifer layer not yet dug into or otherwise discovered contributes nothing. Capped at 50 rows (`aquifer_layers_total`/`aquifer_layers_truncated`).
- `water_layers[]` — `{ z, tiles, salt_tiles, fresh_tiles, stagnant_tiles, flowing_tiles, max_depth }`, one row per z-level with at least one revealed standing/flowing water tile (`flow_size > 0`, non-magma). This is a **per-z-level aggregate**, not a flood-filled list of discrete named bodies — a single lake or river spanning several z-levels (a ramp, a waterfall) shows up as one row per level it touches, with no attempt to tell "this is one lake" from "these are two ponds" at the same depth. `max_depth` is the deepest `flow_size` seen at that level (1..7). Capped at 200 rows (`water_layers_total`/`water_layers_truncated`).
- `magma_sea` — `{ top_z, revealed_tile_count }`, or **absent from the response entirely** when no z-level clears the floor (including "no magma revealed anywhere yet") — DFHack's Lua `json` encoder has no null sentinel, so an unset field is omitted, not emitted as JSON `null` (confirmed live; same convention as `wells[].depth_to_source`). The highest revealed z-level carrying at least 20 revealed magma tiles (a size floor meant to separate a genuine magma sea/lake from a small magma pool or volcano pipe — see Caveats).
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

(The `magma_sea` row above is illustrative — the Dreamfort golden fixture never revealed magma anywhere, so its `fluids.json` has no `"magma_sea"` key at all, not a `null` one; see Caveats.)

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- **Revealed-only, always.** Every tile visited is gated on `designation.hidden` before it can contribute to any field; an undiscovered aquifer, water body, or magma tile is invisible here exactly as it is to the player. This tool `reqscript`s `mcp_readTerrain` (see `CONTRIBUTING.md` "Shared internals: fog-of-war safety") for the shared terrain glyph/legend convention rather than inventing a second one. Confirmed live: the fixture's `aquifer_layers` (revealed `z_top`/`z_bottom` 128/127) is a proper subset of `geology`'s full-knowledge aquifer read (`z_top`/`z_bottom` 128/125, same `light` classification) — exactly the "revealed is a subset of real" relationship this design promises, not a coincidence.
- **`water_layers[]` is not body detection.** There is no flood-fill/connectivity pass — two disconnected ponds at the same z-level are indistinguishable from one lake at that z-level; a single lake spanning multiple z-levels (common with ramps/waterfalls) appears as multiple rows, one per level. Treat each row as "how much revealed water is at this depth", not "here is lake #1".
- **`magma_sea`'s 20-tile floor is still an untuned heuristic — the fixture doesn't exercise it.** Dreamfort's fixture (`geology`'s `magma_reached: false`, `caverns_discovered: []`) hasn't revealed any magma yet, so the live pass could confirm the *code path* runs cleanly (the field is correctly omitted, never a stray `0`/`null`/crash) but could not confirm the 20-tile floor itself against a real magma sea or a real small magma pool/volcano pipe. Treat the threshold as still a reasonable, unvalidated guess.
- **`flood_risk_tiles[]` is exposure, not a leak prediction.** "Adjacent to the fort's interior" means chebyshev-adjacent to a tile sharing a citizen's walkable group — it does not know whether a wall, a floodgate, or solid rock separates the water from that space (a full-depth water tile next to a completed, sealed wall is still reported). It is the same kind of raw proximity fact `defenses`' `threats[].nearest_bridge` is — a distance, not a verdict. The fixture reports zero flood-risk tiles (no full-depth water currently sits next to the fort's walkable interior), so this pass confirmed the field/adjacency reads execute correctly but not a nonzero-result row's shape.
- **Aquifer heaviness is genuinely per-tile**, not per-block or per-region: DFHack's own `Maps::isTileHeavyAquifer` reads `occupancy.heavy_aquifer` per tile (confirmed against `df-structures`' `df.d_basics.xml` and DFHack's `Maps.cpp` — see Implementation notes). `classification: "mixed"` is a real, expected case wherever a layer has both, though the fixture only ever showed `"light"` (no heavy aquifer revealed).
- **`water_salt` is unexercised on live data.** Dreamfort is an inland embark; every one of the 881 revealed water tiles across all 9 water layers read `water_salt = false`. The field resolves and behaves plausibly (never spuriously true on fresh water), but no live tile with `water_salt = true` was observed, so the `salt_tiles` accumulation branch itself is still unconfirmed on real salt water. `water_stagnant`/`flow_size`/`liquid_type`/`water_table`, by contrast, all had both states genuinely exercised (stagnant *and* flowing water both present; `water_table` cross-checked against `geology` above).
- **Performance: measured, not a blocker, but real.** Against the Dreamfort fixture (a ~144-z-level map, 3,048,192 revealed+unrevealed tiles visited, well under the 20,000,000-tile budget, `scan.complete: true`), the scan itself takes roughly 9-11 seconds of actual Lua execution on top of the harness's fixed ~10s connect/handshake overhead — comparable to `geology`'s own full-column scan (also tens of seconds) and slower than the windowed `tile_region`/`defenses` reads, which don't walk the whole map. It's slow enough to matter for a synchronous RPC call on a larger or taller embark, but the block-cache pattern (one `getTileBlock` per 16x16 block, not per tile) is already in use — confirmed by inspection and by the measured cost being proportional to tiles visited, not blocks fetched twice. No further optimization was made this pass since there's no cheaper live primitive to skip whole hidden blocks (`has_aquifer`/`has_magma_*` block flags don't cover the water/flow_size path); a future pass could add a bounding-box/z-range parameter if a larger embark proves this too slow in practice.
- `wells[]`'s scan mirrors `rooms_and_zones`' `well_source` field-for-field (same `flow_size`/`liquid_type`/`FROZEN_LIQUID`-material lookup, same 40-z-level search depth) rather than a different algorithm, extended here with `x`/`y` and `depth_to_source` — that function is a private local in `mcp_roomsAndZones.lua` with no module boundary to `reqscript`, so the two copies are a real (small) duplication risk; if they ever need to change, change both. A follow-up could extract a shared `well_water_source` into a reusable module. Confirmed live: the fixture's 6 wells agree with `rooms_and_zones`' well read on count, z-level (all `z=124`), and source (all `"water"`) — the invariant `fluids_wellformed_and_wells_agree_with_rooms` in `test/invariants.mjs` now pins this cross-tool agreement for any fort.
- `aquifer_layers[]`, `water_layers[]`, `flood_risk_tiles[]`, and `wells[]` are all capped (50 / 200 / 50 / 20 respectively); each has a `_total` and `_truncated` pair to detect overflow. None of the caps were hit on the fixture (6 wells, 9 water layers, 1 aquifer layer, 0 flood-risk tiles), so truncation itself is untested live — only its arithmetic is (covered by the invariant above).

## Implementation notes
Per-tile fluid facts come from `map_block.designation` (`df.d_basics.xml`'s `tile_designation` bitfield): `flow_size` (0..7, liquid amount), `liquid_type` (0=Water/1=Magma, read the same truthy way `rooms_and_zones`' `well_source` and `tile_region` already do: `des.liquid_type and 'magma' or 'water'`), `water_salt`, `water_stagnant`, and `water_table` (comment in the structure file: "aquifer"). Aquifer heaviness comes from the **sibling** `map_block.occupancy` array's `tile_occupancy` bitfield field `heavy_aquifer` (`original-name='DES_HEAVY_WATER_TABLE'`, `since='v0.47.01'`, comment "Light/Heavy aquifer flag") — confirmed via DFHack's own `Maps::isTileHeavyAquifer` (`library/modules/Maps.cpp`), which reads exactly this field, alongside `Maps::isTileAquifer` reading `designation.water_table`. Both were cross-checked against `df-structures` (`df.d_basics.xml`) and DFHack's `Maps.cpp` source directly (tag/branch matching 53.15-r2 era), not inferred — light/heavy is a genuine per-tile flag, not a per-block or per-region property, resolving the open question from issue #80. All of this is now also confirmed **live**: `water_table` produced a real aquifer layer that nests inside `geology`'s full-knowledge range (see Caveats), so the field path itself, not just the structure-file documentation, is correct.

The block-level `has_aquifer`/`check_aquifer` flags noted in `df.block.xml` (`block_flags` bitfield) were intentionally **not** used as a scan pre-filter here — they're bay12-internal aggregate/cache flags rather than a value this tool needed to special-case, and folding aquifer/water/magma detection into one single per-tile pass (rather than a separate has_aquifer-gated pass) kept the scan to one traversal instead of two. `magma_by_z`'s companion block flags (`has_magma_close`/`has_magma_far`, and the third one which is genuinely misspelled `mas_magma_low` in the upstream structure file, not a typo introduced here) were considered as a cheaper magma pre-filter but not used, for the same one-pass-is-simpler reason; the live perf pass (see Caveats) found the measured cost acceptable enough that this wasn't revisited.

Fort interior (for `flood_risk_tiles[]`'s adjacency test) reuses the exact `dfhack.maps.getWalkableGroup(xyz2pos(...))`-over-citizen-positions pattern `defenses` already uses for its own `threats[].location`/`interior` fields — not re-derived differently, just the same small pattern inlined (there's no shared module for it to `reqscript`, unlike the terrain/unit-visibility fog-of-war checks).

`magma_sea` (and any other single-value field that can be legitimately absent) is omitted from the JSON entirely when unset, never emitted as a literal `null` — confirmed live: DFHack's bundled Lua `json` module has no `json.null` sentinel (`type(json.null) == 'nil'`), so assigning Lua `nil` to a table field simply removes the key before `json.encode` ever sees it. `fluids.ts` types `magma_sea` as an optional field (`magma_sea?: MagmaSea`) to match, the same convention `wells[].depth_to_source` already used.

## Related
[rooms_and_zones](rooms_and_zones.md) · [tile_region](tile_region.md) · [geology](geology.md) · [defenses](defenses.md) · [environment](environment.md)

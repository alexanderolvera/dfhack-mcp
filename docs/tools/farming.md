---
tool: farming
tier: sensor
gated: none
source: src/tools/farming.ts
lua: src/dfhack-queries/mcp_farming.lua
tags: [dfhack-mcp/tool]
---

# farming

> The fort's farm plots and seed stock as facts: the early-survival pipeline between "what's plantable" and "what's in stock."

## Purpose
`stocks` sees food *outputs* (meals, drink) and `game_data` knows what's plantable *in the abstract* (a plant raw's `farm_plantable` flag), but nothing saw the pipeline in between: which plots exist, what's actually assigned to grow in them each season, and whether there's seed on hand to plant it. An AI co-pilot calls this to catch an idle plot (no crop assigned in any season) or a crop assigned with zero seed in stock before it becomes a food crisis, and to compose with `game_data`'s plant dossiers for a full picture of what a crop needs.

## Parameters
None.

## Returns
- `plots[]` — one row per farm plot: `{ id, size, surface, seasons[], no_crop_assigned }`.
  - `size` — tile count (`width * height`).
  - `surface` — true if the plot's tile is open to the sky, false if underground.
  - `seasons[]` — always 4 entries, one per `SPRING`/`SUMMER`/`AUTUMN`/`WINTER`: `{ season, crop?, seeds_available? }`. `crop` (a plant token, e.g. `"MUSHROOM_HELMET_PLUMP"`) and `seeds_available` are both absent when that season is fallow (no crop assigned).
  - `no_crop_assigned` — true iff every season is fallow — a plot doing nothing.
- `seed_totals[]` — `{ plant, count }`, fort-wide seed counts by plant, sorted by plant token. Only plants with at least one seed in stock are listed. Excludes forbidden/dumped/rotten/under-construction/trader-bound seed items.

```json
{
  "plots": [
    {
      "id": 100,
      "size": 3,
      "surface": false,
      "no_crop_assigned": false,
      "seasons": [
        { "season": "SPRING", "crop": "POD_SWEET", "seeds_available": 50 },
        { "season": "SUMMER", "crop": "GRASS_TAIL_PIG", "seeds_available": 33 },
        { "season": "AUTUMN", "crop": "MUSHROOM_CUP_DIMPLE", "seeds_available": 19 },
        { "season": "WINTER", "crop": "MUSHROOM_HELMET_PLUMP", "seeds_available": 62 }
      ]
    }
  ],
  "seed_totals": [
    { "plant": "MUSHROOM_HELMET_PLUMP", "count": 62 },
    { "plant": "POD_SWEET", "count": 50 }
  ]
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- `no_crop_assigned` reports a plot with literally nothing assigned in any season — it does NOT evaluate whether an assigned crop is actually eligible for that plot's biome/depth (that agronomic eligibility check is out of scope; compose with `game_data`'s plant dossier `surface`/`depth_min`/`depth_max`/`biomes` fields for that).
- `seeds_available` on a season entry is the SAME fort-wide count as that plant's `seed_totals[]` entry, not seed reserved for that specific plot — DF doesn't reserve seed per plot.
- `surface` is read from the plot's own anchor tile's map designation, not inferred from a fort-wide surface z-level — accurate per-plot even in a fort with plots at mixed depths.

## Implementation notes
Plots come from `df.global.world.buildings.other.FARM_PLOT`; each plot's `plant_id[0..3]` indexes `df.global.world.raws.plants.all[]` and maps to season by DF's standard farm-plot convention (index 0-3 = spring/summer/autumn/winter), `-1` meaning fallow. Seed counts come from `df.global.world.items.other.SEEDS`, summed by `mat_index` (the same raw index as `plant_id`) with the same forbidden/dump/rotten/construction/trader/garbage_collect exclusion `stocks` uses. `surface` reads `dfhack.maps.getTileBlock(...).designation[lx][ly].outside` at the plot's `(x1, y1, z)`. Confirmed live on DFHack 53.15-r2 against the Dreamfort fixture (all 30 plots underground, `outside=false`).

## Related
[stocks](stocks.md) · [game_data](game_data.md) · [environment](environment.md)

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
`stocks` sees food *outputs* (meals, drink) and `game_data` knows what's plantable *in the abstract* (a plant raw's `farm_plantable` flag), but nothing saw the pipeline in between: which plots exist, what's actually assigned to grow in them each season, and whether there's seed on hand to plant it. An AI co-pilot calls this to catch an idle plot (no crop assigned in any season) or, by joining a plot's `crop` against `seed_totals[]`, a crop assigned with zero seed in stock — before either becomes a food crisis — and to compose with `game_data`'s plant dossiers for a full picture of what a crop needs.

## Parameters
None.

## Returns
- `plots[]` — one row per farm plot (capped at 200 — see `plots_total`/`plots_truncated`): `{ id, size, open_to_sky, seasons[], no_crop_assigned, no_eligible_crop }`.
  - `size` — tile count (`width * height`).
  - `open_to_sky` — true if the plot's tile currently has open sky above it (light/weather exposure). This is NOT a surface-vs-underground fact: a roofed plot built on the actual surface also reads `open_to_sky: false`, indistinguishable here from a genuinely underground plot.
  - `seasons[]` — always 4 entries, one per `SPRING`/`SUMMER`/`AUTUMN`/`WINTER`: `{ season, crop?, eligible? }`. `crop` (a plant token, e.g. `"MUSHROOM_HELMET_PLUMP"`) and `eligible` are both absent when that season is fallow (no crop assigned). When a crop IS assigned, `eligible` is whether the plant raw's own season flag allows it to grow in that season. Seed stock for `crop` is NOT repeated here — look it up in `seed_totals[]`, the single source for that fact.
  - `no_crop_assigned` — true iff every season is fallow — a plot doing nothing.
  - `no_eligible_crop` — true iff no season holds BOTH an assigned crop AND `eligible: true` — a strict superset of `no_crop_assigned` (a plot can have every season "filled" and still trip this if none of the assignments are actually eligible for their season).
- `plots_total` (number), `plots_truncated` (boolean) — the real plot count and whether the 200-row cap dropped any.
- `seed_totals[]` / `seed_totals_count` / `seed_totals_truncated` — `{ plant, count }`, fort-wide seed counts by plant, sorted by plant token, capped at 100 distinct plants. Only plants with at least one seed in stock are listed. Excludes forbidden/dumped/rotten/under-construction/trader-bound seed items. This is the ONLY place seed counts appear — join a season's `crop` token against it rather than expecting a per-plot count.

```json
{
  "plots": [
    {
      "id": 100,
      "size": 3,
      "open_to_sky": false,
      "no_crop_assigned": false,
      "no_eligible_crop": false,
      "seasons": [
        { "season": "SPRING", "crop": "POD_SWEET", "eligible": true },
        { "season": "SUMMER", "crop": "GRASS_TAIL_PIG", "eligible": true },
        { "season": "AUTUMN", "crop": "MUSHROOM_CUP_DIMPLE", "eligible": true },
        { "season": "WINTER", "crop": "MUSHROOM_HELMET_PLUMP", "eligible": true }
      ]
    }
  ],
  "plots_total": 30,
  "plots_truncated": false,
  "seed_totals": [
    { "plant": "MUSHROOM_HELMET_PLUMP", "count": 62 },
    { "plant": "POD_SWEET", "count": 50 }
  ],
  "seed_totals_count": 19,
  "seed_totals_truncated": false
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- `eligible` checks ONLY the plant raw's own season flag (`SPRING`/`SUMMER`/`AUTUMN`/`WINTER` — does DF consider this plant plantable in this season at all). It does NOT check surface/underground depth compatibility: live verification found a plant flagged surface-only via `underground_depth_min == underground_depth_max == 0` (`REED_ROPE`) successfully planted in an underground plot in the fixture — `underground_depth_min`/`max` describe where a plant grows WILD, not farm-plot eligibility, so asserting a depth/surface rule here would have been actively wrong rather than merely incomplete. Compose with `game_data`'s plant dossier `surface`/`depth_min`/`depth_max`/`biomes` fields if you need those facts directly, without this tool implying they gate plantability.
- Seed counts live ONLY in `seed_totals[]` — a season's `crop` is not paired with a per-plot count (an earlier revision repeated the fort-wide `seed_totals[]` figure under every matching plot/season, which was pure duplication of a fact already in the same payload, not new information).
- `open_to_sky` is read from the plot's own anchor tile's map designation (`designation.outside`, i.e. "is this tile exposed to light/weather"), not a surface-vs-underground classification and not inferred from a fort-wide surface z-level — accurate per-plot even in a fort with plots at mixed depths, but a roofed surface plot and a genuinely underground one both read `false`.
- `plots[]` is capped at 200 rows (`plots_total`/`plots_truncated`); `seed_totals[]` is capped at 100 distinct plants (`seed_totals_count`/`seed_totals_truncated`).

## Implementation notes
Plots come from `df.global.world.buildings.other.FARM_PLOT`; each plot's `plant_id[0..3]` indexes `df.global.world.raws.plants.all[]` and maps to season by DF's standard farm-plot convention (index 0-3 = spring/summer/autumn/winter), `-1` meaning fallow. `eligible` reads that plant raw's `flags[SEASON]` boolean directly — confirmed live against every crop this fixture had already assigned (all matched their season flag). Seed counts come from `df.global.world.items.other.SEEDS`, summed by `mat_index` (the same raw index as `plant_id`) with the same forbidden/dump/rotten/construction/trader/garbage_collect exclusion `stocks` uses. `open_to_sky` reads `dfhack.maps.getTileBlock(...).designation[lx][ly].outside` at the plot's `(x1, y1, z)` — deliberately named for exactly what that field means (sky exposure), not renamed to imply a surface/underground fact it doesn't carry. Confirmed live on DFHack 53.15-r2 against the Dreamfort fixture (all 30 plots underground, `outside=false`).

## Related
[stocks](stocks.md) · [game_data](game_data.md) · [environment](environment.md)

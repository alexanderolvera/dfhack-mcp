---
tool: environment
tier: sensor
gated: none
source: src/tools/environment.ts
lua: src/dfhack-queries/mcp_environment.lua
tags: [dfhack-mcp/tool]
---

# environment

> The fort's ambient conditions right now: current season and dominant weather, surface temperature, biome alignment, and breached-cavern status.

## Purpose
Reports the fort's ambient state at call time: season, dominant weather (none/rain/snow), surface temperature and whether exposed water is currently frozen, the alignment of the biomes visible at embark (evil/good/reanimating), and — for each cavern the fort has ALREADY breached — whether it is open to fort pathing or sealed off. A small fixed-size payload suited to frequent polling.

## Parameters
None.

## Returns
Top-level fields:
- `season` (0-3), `season_name` (spring/summer/autumn/winter)
- `surface` — `temperature` (DF units; 10000 = water's freezing point; null if fully roofed/hidden), `water_frozen` (null when temperature is unknown), `weather` (dominant cell over the weather grid), `raining`, `snowing`
- `biome` — `{evil, good, reanimating}` booleans
- `caverns[]` — ONLY caverns the fort has discovered: `{cavern (1-3), open_to_fort}` (a revealed cavern tile shares a citizen walk group)
- `caverns_discovered` — count
- `alerts[]`

```json
{
  "alerts": [],
  "biome": {
    "evil": false,
    "good": false,
    "reanimating": false
  },
  "caverns": [],
  "caverns_discovered": 0,
  "season": 3,
  "season_name": "winter",
  "surface": {
    "raining": true,
    "snowing": false,
    "temperature": 10042,
    "water_frozen": false,
    "weather": "rain"
  }
}
```

## Caveats & limits
- Fog-of-war honest: reports NOTHING about undiscovered cavern layers — a fort that has breached none returns an empty `caverns` list.
- `surface.temperature` and `water_frozen` are null when no surface tile could be sampled (fully roofed/hidden); the DFHack Lua encoder cannot emit JSON null, so the TS wrapper normalizes the omitted scalars to explicit null.
- Per-tile savagery is unavailable in this DFHack build, so no savage flag is reported.
- The freeze fact is CURRENT temperature; geology() carries the will-it-freeze-in-winter fact — the two compose.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
Field paths confirmed live on DFHack 53.15:
- **Season** comes straight from `df.global.cur_season` (0-3).
- **Weather** samples the 5x5 `df.global.current_weather` grid of `df.weather_type` (0 None / 1 Rain / 2 Snow) and reports whichever value is most common across the grid.
- **Surface temperature** is read from `block.temperature_1[lx][ly]` at each sampled surface tile, in DF's internal units where 10000 is water's melting/freezing point (`plotinfo.hi_temp`/`lo_temp` read back a 60001 sentinel on this build and are not usable). The reported value is the median of all sampled tiles rather than the first or an average, so a single sun-warmed construction tile can't skew the reading.
- **Biome alignment** resolves the true surface biome per sampled column: `dfhack.maps.getTileBiomeRgn(pos)` gives a world region coordinate, matched against `world_data.regions[].region_coords` to read `evil`/`good`/`reanimating`. `getTileBiomeRgn` collapses to the site region when called underground, so the sample must be taken at each column's actual outside surface tile.
- **Cavern discovery** walks `block.global_feature` to `dfhack.maps.getGlobalInitFeature(idx)`; a `feature_init_subterranean_from_layerst` is a cavern, numbered `start_depth + 1` (1-3). `flags.Discovered` gates disclosure.
- **Open vs. sealed** reuses the citizen-walkability-group approach from `defenses`: DF precomputes a 3D walk group per walkable tile, and a cavern is "open" when one of its revealed tiles shares a nonzero walk group with a citizen. Only tiles carrying the per-tile `designation.feature_global` flag count as belonging to the cavern — the block-level `global_feature` flag only says the 16x16 block contains cavern tiles, not which ones, and without the per-tile check a stray citizen-reachable tunnel tile sharing the block could misreport a sealed cavern as open.
- Per-tile savagery lives in `world_data.region_map`, which hard-crashes this DFHack build on any access — it's omitted entirely rather than guessed at.

## Related
- [geology](geology.md) — freeze-in-winter and layer facts that compose with the surface temperature.
- [map_overview](map_overview.md) — the spatial picture the ambient conditions overlay.
- [defenses](defenses.md) — cavern open/sealed state matters as an approach vector.
- [fort_status](fort_status.md) — the companion one-call population/wealth overview.

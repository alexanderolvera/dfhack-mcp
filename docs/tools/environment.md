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
- `surface` — `temperature` (DF units; 10000 = water's freezing point; null if fully roofed/hidden), `temperature_band` (freezing / above_freezing / unknown), `water_frozen` (null when temperature is unknown), `weather` (dominant cell over the weather grid), `raining`, `snowing`
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
    "temperature_band": "above_freezing",
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

## Related
- [geology](geology.md) — freeze-in-winter and layer facts that compose with the surface temperature.
- [map_overview](map_overview.md) — the spatial picture the ambient conditions overlay.
- [defenses](defenses.md) — cavern open/sealed state matters as an approach vector.
- [fort_status](fort_status.md) — the companion one-call population/wealth overview.

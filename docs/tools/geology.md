---
tool: geology
tier: sensor
gated: none
source: src/tools/geology.ts
lua: src/dfhack-queries/mcp_geology.lua
tags: [dfhack-mcp/tool]
---

# geology

> A one-call geological survey of the embark, REVEALED-INFO ONLY by default.

## Purpose
Reports the geological substrate of the loaded embark: the surface z-level, the layer stack the fort has actually exposed (banded by z-range, kind, and in-game material names), the aquifer, discovered caverns, whether the magma sea has been reached, and surface water facts. An AI co-pilot calls it to orient before digging-related reasoning or before fusing material names with `game_data`/`wiki_lookup`. Fog of war is honored by default: undiscovered caverns and an unreached magma sea are omitted entirely, never leaked as z-ranges. It reports what is there, not where to dig.

## Parameters
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| reveal_hidden | boolean | No | `false` | Bypass fog of war: also report undiscovered caverns (`caverns_hidden`) and the magma-sea z-range (`magma_hidden`) regardless of discovery. A debug/spoiler switch. |

## Returns
- `surface_z` (number) — highest open-to-sky ground z-level.
- `layers[]` — bands of consecutive z-levels sharing a material set: `{ z_top, z_bottom, kind, materials[] }`. `kind` is one of `soil | sedimentary | metamorphic | igneous_extrusive | igneous_intrusive | mixed | unknown`; `materials` are in-game names (e.g. "limestone") that `game_data`/`wiki_lookup` resolve.
- `aquifer` — `{ present }` plus, when present, `type` (`light`/`heavy`), `z_top`, `z_bottom`.
- `caverns_discovered[]` — `{ layer, z_top, z_bottom, water }` (layer 1 = first cavern); only caverns whose Discovered flag is set.
- `magma_reached` (boolean) — the magma-SEA discovery flag alone, never a volcano/pool/hauled magma.
- `surface_water` — `{ brook, river, murky_pools, permanent_freeze }`. `murky_pools` counts connected stagnant-water bodies; `permanent_freeze` means the biome base temperature is at/below freezing (glacier/tundra), not a seasonal-winter claim.
- `alerts[]` — factual restatements only (e.g. aquifer range, magma reached).
- Only with `reveal_hidden=true`: `reveal_hidden: true`, `caverns_hidden[]`, and `magma_hidden { z_top, z_bottom }` (the latter only when the sea is undiscovered).

```json
{
  "alerts": ["light aquifer at z125-128"],
  "aquifer": { "present": true, "type": "light", "z_bottom": 125, "z_top": 128 },
  "caverns_discovered": [],
  "layers": [
    {
      "kind": "soil",
      "materials": ["red sand", "sandy clay"],
      "z_bottom": 140,
      "z_top": 140
    },
    {
      "kind": "sedimentary",
      "materials": ["chert", "claystone"],
      "z_bottom": 110,
      "z_top": 111
    }
  ],
  "magma_reached": false,
  "surface_water": {
    "brook": false,
    "murky_pools": 20,
    "permanent_freeze": false,
    "river": false
  },
  "surface_z": 140
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- Layer depth is fog-gated: bands stop at the deepest revealed z by default (`reveal_hidden` shows the full column). Layer sampling uses full map data (embark-survey knowledge) on a coarse 4x4 stride.
- The aquifer is a survey fact known at embark, so it is NOT fog-gated.
- `caverns_hidden`/`magma_hidden` appear only under `reveal_hidden=true`; the default payload carries no tell about undiscovered depths.
- `permanent_freeze` is base-temperature derived; a warm biome that freezes only in deep winter is honestly NOT flagged (DF 53.15 does not reliably expose a per-biome winter minimum — plotinfo hi/lo temps read back as sentinels). The true/frozen path is untested on the current fixture (biomes 77-81F).
- Cavern water is scoped to each cavern's own tiles (via `designation.feature_global`), so a cistern or aquifer seep sharing the z-band is not miscredited.
- Payload is bounded: layer bands and cavern rows are O(depth); no per-tile output.

## Related
[map_overview](map_overview.md) · [tile_region](tile_region.md) · [environment](environment.md) · [game_data](game_data.md) · [wiki_lookup](wiki_lookup.md)

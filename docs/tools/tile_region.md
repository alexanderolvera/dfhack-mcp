---
tool: tile_region
tier: sensor
gated: none
source: src/tools/tileRegion.ts
lua: src/dfhack-queries/mcp_tileRegion.lua
tags: [dfhack-mcp/tool]
---

# tile_region

> A bounded window of ONE z-level rendered as an ASCII character grid plus a self-describing legend.

## Purpose
Renders the "earthworks" view of one z-level: terrain shape (dug/undug, soil vs stone, ramps, stairs, fortifications, trees), constructed floors, liquids, and building footprints collapsed to four classes (workshop/furnace `W`, stockpile `S`, machine `M`, furniture `n`) — never per-building detail. It composes on the fog-of-war-safe `mcp_readTerrain` substrate: undiscovered tiles are `?` and are never painted over, so the `?` count always equals `hidden_tiles`. An AI co-pilot calls it to see the physical layout of an area; it renders the map, it does not design or suggest layouts. This was the first parameterized MCP tool.

## Parameters
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `z` | integer (coerced) | no | busiest citizen z-level | z-level to render |
| `x0` | integer (coerced) | no | centered window | window corner X (with y0,x1,y1 for an explicit rectangle) |
| `y0` | integer (coerced) | no | centered window | window corner Y |
| `x1` | integer (coerced) | no | centered window | opposite window corner X |
| `y1` | integer (coerced) | no | centered window | opposite window corner Y |

With no arguments: a fixed DEFAULT 60x40 window centered on the fort core (busiest citizen z-level and that level's citizen centroid). Passing `z` alone recenters on THAT level's own citizen centroid (falls back to the busiest level's centroid, then map center). All five give an explicit rectangle (corner order is normalized).

## Returns
| Field | Meaning |
|---|---|
| `z` | z-level rendered (clamped into map range) |
| `origin` | window top-left `[x, y]` in DF map space (+x east, +y south) |
| `size` | `[width, height]`, each hard-capped at 100 |
| `legend` | glyph → meaning, for exactly the glyphs present in `grid` |
| `grid` | `size[1]` row strings, each `size[0]` chars wide |
| `liquids[]` | sparse per-tile flow depth `{x, y, type: "water"\|"magma", depth: 1..7}` (the grid glyph is depth-blind) |
| `liquids_truncated` | the liquids list hit its cap (400) |
| `hidden_tiles` | count of `?` fog-of-war tiles in the grid |
| `truncated` | an oversized request was clamped to the 100x100 cap |
| `requested` | present only when truncated: the original `[w, h]` |

Full glyph set: `?` fog, `#` undug stone/wall, `,` undug soil, `F` fortification, `.` dug floor, `r` ramp, `v` ramp top, `<` `>` `x` stairs, `T` tree, `~` water/brook, ` ` open space, `+` constructed floor, `%` magma, `W` `S` `M` `n` building classes.

```json
{
  "grid": [
    "??????????????????#################################?????????",
    "??????????????????#nnn#nnn#nnn#n n#n n#n n#n n#n n#?????????",
    "???????????????####nnn#nnn#nnn#nnS#nnS#nnS#nnS#nnS#?????????",
    "???????????????#~##...#...#...#SSS#SSS#SSS#SSS#SSS#?????????"
  ],
  "hidden_tiles": 1501,
  "legend": {
    "#": "undug stone / wall",
    ".": "dug floor / walkable ground",
    "?": "undiscovered (fog of war)",
    "S": "stockpile",
    "n": "furniture (bed/chair/table/door/etc)",
    "~": "water / brook"
  },
  "liquids": [{ "depth": 7, "type": "water", "x": 65, "y": 40 }],
  "liquids_truncated": false,
  "origin": [49, 31],
  "size": [60, 40],
  "truncated": false,
  "z": 124
}
```
*(grid and legend trimmed; a real response has 40 rows and every present glyph.)*

## Caveats & limits
- Window hard-capped at 100x100 per side; an oversized request is CLAMPED, never errored — `truncated: true` with the original size echoed in `requested`. The window also never exceeds the map, and the origin is clamped so it fits.
- Fog of war is honest: hidden tiles stay `?`, are never overwritten by overlays, and are never read for liquid depth.
- Building detail is collapsed to exactly four classes; anything unlisted (bridges, floodgates, traps, farm plots, wells, trade depot) renders as its underlying terrain, not a building glyph.
- The grid liquid glyph collapses flow depth; per-tile depth lives only in the sparse `liquids` list (capped at 400 entries, `liquids_truncated` when hit).
- Parameters accept numbers or numeric strings (coerced) — the CLI test path passes strings.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Related
[map_overview](map_overview.md) (whole-map z-level summary), [geology](geology.md) (what the stone is), [rooms_and_zones](rooms_and_zones.md) (the facility inventory this map deliberately omits), [defenses](defenses.md) (per-structure defensive detail), [blueprint_apply](blueprint_apply.md) (acting on a drafted layout).

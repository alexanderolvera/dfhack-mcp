---
tool: defenses
tier: sensor
gated: none
source: src/tools/defenses.ts
lua: src/dfhack-queries/mcp_defenses.lua
tags: [dfhack-mcp/tool]
---

# defenses

> Where the threats are versus what you have to fight them with.

## Purpose
Reports active hostiles with map positions and their geometry to the fort core and the nearest drawbridge, plus an inventory of controllable defensive structures. Terrain-aware: each threat is classified inside/outside the fort's walled perimeter by walkability-group connectivity, and a `perimeter_terrain` window renders the busiest citizen level as an ASCII grid. Facts only — the tactics are the caller's to decide.

## Parameters
None.

## Returns
Top-level fields:
- `fort_core` — `{x, y, z, citizens}` or null: the citizen-densest point
- `interior` — the fort's connected walkable interior(s): `groups[]` (`{group, citizens}`), `primary_group`, `citizens`
- `threats[]` — each: `name`, `token`, `pos {x,y,z}`, `walk_group` (0 = no walkable footing, e.g. a flier over open air), `location` ("inside" = shares a citizen walk group), `footing` (`discovered`, and only when discovered: `symbol`, `terrain`, `open_to_sky`), `from_core?` and `nearest_bridge?` geometry (`dist` = Chebyshev tile distance, `dz` = z-levels with + meaning the other point is above the threat, `dir` = compass bearing or "here")
- `structures` — `bridges[]` (`{x, y, z, tiles, direction}`), `levers`, `floodgates`, `hatches`, `cage_traps`, `doors {total, forbidden}`
- `perimeter_terrain` — single-z window on the busiest citizen level: `z`, `citizens_on_level`, `center`, `origin`, `w`, `h`, `exposure {open_to_sky, covered, undiscovered}`, `fortifications[]` (positions), `distinct` (glyph → count), `legend` (glyph → meaning), `grid` (ASCII rows)

```json
{
  "fort_core": { "citizens": 78, "x": 79, "y": 54, "z": 122 },
  "interior": {
    "citizens": 78,
    "groups": [ { "citizens": 78, "group": 22 } ],
    "primary_group": 22
  },
  "perimeter_terrain": {
    "citizens_on_level": 15,
    "exposure": { "covered": 907, "open_to_sky": 0, "undiscovered": 774 },
    "grid": [
      "????????#################################",
      "????????#...#...#...#. .#. .#. .#. .#. .#",
      "?????####...#...#...#...#...#...#...#...#"
    ],
    "legend": {
      "#": "wall / solid rock",
      ".": "floor / walkable ground",
      "?": "undiscovered (fog of war)"
    },
    "origin": { "x": 59, "y": 31, "z": 124 },
    "w": 41, "h": 41, "z": 124
  },
  "structures": {
    "bridges": [ { "direction": "1", "tiles": 2, "x": 80, "y": 64, "z": 131 } ]
  }
}
```

## Caveats & limits
- Inside/outside is WALKING connectivity: a FLIER or BUILDING_DESTROYER can reach the fort while reported "outside" — cross-reference the creature's traits via identify()/game_data() (e.g. cage traps do not hold a TRAPAVOID creature).
- `perimeter_terrain` is a single z-level and does not synthesize a multi-z approach vector.
- Fog of war is honest: undiscovered tiles render as "?" and a threat's `footing` carries no shape when `discovered: false` — the substrate never leaks an undiscovered tile's type.
- Which lever raises which bridge is not recorded in the raws, so bridges and levers are reported separately, not linked.
- `walk_group` 0 means no walkable footing at the threat's tile.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Related
- [threats](threats.md) — the hostile roster this composes with; [identify](identify.md) for a creature's trait facts.
- [military](military.md) — the fort's own fighting force.
- [tile_region](tile_region.md) / [map_overview](map_overview.md) — deeper terrain reads around a threat.
- [environment](environment.md) — cavern open/sealed state, another approach vector.

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
- `threats[]` — DISCOVERED hostiles only. Each: `name`, `token`, `pos {x,y,z}`, `walk_group` (0 = no walkable footing, e.g. a flier over open air), `location` ("inside" = shares a citizen walk group), `footing` (`symbol`, `terrain`, `open_to_sky`), `from_core?` and `nearest_bridge?` geometry (`dist` = Chebyshev tile distance, `dz` = z-levels with + meaning the other point is above the threat, `dir` = compass bearing or "here")
- `structures` — `bridges[]` (`{x, y, z, tiles, direction}`), `levers`, `floodgates`, `hatches`, `cage_traps`, `doors {total, forbidden}`
- `perimeter_terrain` — single-z window on the busiest citizen level: `z`, `citizens_on_level`, `center`, `origin`, `w`, `h`, `exposure {open_to_sky, covered, undiscovered}`, `fortifications[]` (positions), `distinct` (glyph → count), `legend` (glyph → meaning, pruned to exactly the glyphs in `grid`, so it always has the same keys as `distinct`), `grid` (ASCII rows)

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
- Fog of war is honest on BOTH axes. Terrain: undiscovered tiles render as "?" and never leak their real type. Units: `threats[]` is filtered through `mcp_unitVisibility`, so a hostile standing on an undiscovered tile is absent entirely — no name, no creature token, no coordinates. This is why `footing` has no `discovered` field: a listed threat is a discovered threat by construction.
- `threats[]` therefore reports the same population as `threats()`' `active_hostiles` and `military()`'s `hostiles_on_map`. All three share one predicate: active, living, dangerous, non-citizen, not caged/chained, not fog-of-war hidden.
- Which lever raises which bridge is not recorded in the raws, so bridges and levers are reported separately, not linked.
- `walk_group` 0 means no walkable footing at the threat's tile.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
- `footing.open_to_sky` mirrors the tile's `designation.outside` flag.
- Empty Lua tables encode as `{}` rather than `[]`; the TS wrapper coerces the nested list fields (`structures.bridges`, `interior.groups`, `perimeter_terrain.fortifications`/`grid`) back to arrays.
- Field paths, verified live on DFHack 53.15-r2: `df.global.world.buildings.all` + `b:getType()` (`df.building_type` Bridge/Trap/Door/Floodgate/Hatch); a bridge's `x1`/`y1`/`x2`/`y2`/`z`/`centerx`/`centery`/`direction`; a trap's `b.trap_type` (`df.trap_type` CageTrap/Lever/...); a door's `door_flags.forbidden`; a unit's `u.pos`; `dfhack.maps.getWalkableGroup(xyz2pos(...))` for walk-group membership.
- The "walled perimeter" is DF's own walkability-group graph: the engine precomputes a walk group per walkable tile (3D, stairs/ramps included), and two tiles are mutually walk-reachable iff they share one nonzero group. `interior` is anchored on the walk groups citizens actually stand in, rather than the fort's geometric centroid, because the centroid can land inside solid rock (which has no walk group) on an irregular layout.
- `interior.groups` is built as an explicit array (`{group, citizens}` pairs) rather than an integer-keyed map, because DFHack's JSON encoder would otherwise null-pad an integer-keyed Lua table into a sparse array. Walk-group ids are computed fresh per call and are not stable identifiers across calls.
- `bearing()`'s `dir` uses `+x = east, +y = south` as the axis convention when comparing two positions.
- `nearest_bridge` is selected on 3D Chebyshev distance, `max(|dx|, |dy|, |dz|)`. Selecting on the horizontal distance alone (the pre-1.4.1 behaviour) let a bridge directly overhead but 142 z-levels up beat one a few levels away, because `z` never entered the comparison. The emitted `dist` stays the horizontal Chebyshev count, with `dz` reported alongside it as before — only the choice of which bridge is "nearest" changed.
- `perimeter_terrain`'s window is centered on the primary level's citizen centroid, then clamped so the window stays within the map bounds.

## Related
- [threats](threats.md) — the hostile roster this composes with; [identify](identify.md) for a creature's trait facts.
- [military](military.md) — the fort's own fighting force.
- [tile_region](tile_region.md) / [map_overview](map_overview.md) — deeper terrain reads around a threat.
- [environment](environment.md) — cavern open/sealed state, another approach vector.

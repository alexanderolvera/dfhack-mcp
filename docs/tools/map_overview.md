---
tool: map_overview
tier: sensor
gated: none
source: src/tools/mapOverview.ts
lua: src/dfhack-queries/mcp_mapOverview.lua
tags: [dfhack-mcp/tool]
---

# map_overview

> Cheap spatial orientation to run BEFORE any per-tile terrain read: map extents, the fort-core anchor, the surface z, activity z-levels, and stair columns.

## Purpose
Answers "how big is this map, where is the fort, and which z-levels is the player actually working on?" so an agent can aim its expensive `tile_region` grid reads instead of sweeping ~147 z-levels blind. Reports map extents, the fort-core coordinate (the same 3D citizen centroid `defenses` uses), the surface z above the fort center, the z-levels carrying construction and pending digging, and stairways collapsed to traversable single-column vertical runs. The payload is fixed-size regardless of fort size.

## Parameters
None.

## Returns
- `extents` — `{ x, y, z }` tile counts.
- `fort_core` — `{ x, y, z, citizens }` 3D citizen centroid, or `null` on a loaded map with no citizens.
- `surface_z` (number | null) — highest non-hidden, open-to-sky ground tile at the fort-core (x,y); `null` when the core column is never open to sky.
- `activity` — `{ z_levels[], construction_z[], digging_z[] }`; `z_levels` is the sorted union of the other two.
- `stair_columns[]` — `{ x, y, z_top, z_bottom }` traversable vertical runs; two vertically-adjacent stair tiles connect only by DF's real stair rule (lower offers up-access AND upper offers down-access), so a helical shaft splits into its climbable segments. Ranked by run height, tallest first.
- `stair_columns_total` (number) — full count before capping.
- `stair_columns_truncated` (boolean) — true when the cap dropped runs.
- `alerts[]` — e.g. "fort core column is not open to sky (surface_z unknown)".

```json
{
  "activity": {
    "construction_z": [124, 127, 128, 131, 132],
    "digging_z": [111],
    "z_levels": [111, 124, 127, 128, 131, 132]
  },
  "alerts": [],
  "extents": { "x": 144, "y": 144, "z": 147 },
  "fort_core": { "citizens": 78, "x": 79, "y": 54, "z": 122 },
  "stair_columns": [
    { "x": 65, "y": 40, "z_bottom": 121, "z_top": 127 },
    { "x": 82, "y": 38, "z_bottom": 121, "z_top": 123 }
  ],
  "stair_columns_total": 56,
  "stair_columns_truncated": true,
  "surface_z": 132
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- `stair_columns` cap is 40; ranking by height (then x, y, z_top for determinism) means the tallest, most orientation-salient shafts survive and only trivial 2-level fragments get dropped.
- Fog-of-war honest: the surface probe and stair scan skip hidden tiles. Pending DIG designations are counted regardless of the hidden flag — they are the player's own markers, not sensed terrain.
- `fort_core` equals `defenses().fort_core` byte-for-byte (same centroid computation).
- The TS wrapper backfills `surface_z`/`fort_core` to `null` when the Lua encoder omits them, and coerces empty nested activity lists to `[]` — the contract is nullable fields, never sometimes-missing ones.
- Version note (53.15): `world.constructions` is GONE on this build; constructions come from `df.construction.get_vector()`.

## Related
[tile_region](tile_region.md) · [geology](geology.md) · [defenses](defenses.md) · [environment](environment.md)

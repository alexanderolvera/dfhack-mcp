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
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| reveal_hidden | boolean | No | `false` | Bypass [fog of war](../../CONTRIBUTING.md#fog-of-war-the-reveal_hidden-opt-in): also read what stands on undiscovered tiles. The response reports the mode as `fog_of_war`. |
| source | `"snapshot"` \| `"live"` | No | `DFHACK_MCP_READ_SOURCE`, else `snapshot` where the snapshot layer is on | Which read path to use. See [the read-source contract](../snapshot.md#the-read-source-contract). |

## Returns
- `source` — `"snapshot"` or `"live"`, the path that served this payload.
- `snapshot` — on a snapshot read only: `{ entities: {...}, map: {...} }`, each `{ seq, age_ms, captured }`. Both walkers contribute: the census supplies extents, stairs and activity, the entity snapshot the citizen centroid, and the census is the older of the two by roughly an order of magnitude.
- `extents` — `{ x, y, z }` tile counts.
- `fort_core` — `{ x, y, z, citizens }` 3D citizen centroid, or `null` on a loaded map with no citizens.
- `surface_z_at_core` (number | null) — highest non-hidden, open-to-sky ground tile in the fort-core (x,y) COLUMN; `null` when the core column is never open to sky. Distinct from [geology](geology.md)'s `surface_z_max`, the embark-wide maximum; on a sloped embark the two differ by however much relief the map has. Both were called `surface_z` before 1.4.1.
- `activity` — `{ z_levels[], construction_z[], digging_z[] }`; `z_levels` is the sorted union of the other two.
- `stair_columns[]` — `{ x, y, z_top, z_bottom }` traversable vertical runs; two vertically-adjacent stair tiles connect only by DF's real stair rule (lower offers up-access AND upper offers down-access), so a helical shaft splits into its climbable segments. Ranked by run height, tallest first.
- `stair_columns_total` (number) — full count before capping.
- `stair_columns_truncated` (boolean) — true when the cap dropped runs.
- `fog_of_war` — `"applied"` (the default) or `"bypassed"` (with `reveal_hidden=true`).

```json
{
  "activity": {
    "construction_z": [124, 127, 128, 131, 132],
    "digging_z": [111],
    "z_levels": [111, 124, 127, 128, 131, 132]
  },
  "extents": { "x": 144, "y": 144, "z": 147 },
  "fort_core": { "citizens": 78, "x": 79, "y": 54, "z": 122 },
  "stair_columns": [
    { "x": 65, "y": 40, "z_bottom": 121, "z_top": 127 },
    { "x": 82, "y": 38, "z_bottom": 121, "z_top": 123 }
  ],
  "source": "live",
  "stair_columns_total": 56,
  "stair_columns_truncated": true,
  "surface_z_at_core": 132
}
```

A snapshot read replaces `"source": "live"` with both walkers' provenance:

```json
{
  "source": "snapshot",
  "snapshot": {
    "entities": { "seq": 41, "age_ms": 2310, "captured": { "year": 251, "year_tick": 149760 } },
    "map": { "seq": 7, "age_ms": 48120, "captured": { "year": 251, "year_tick": 142080 } }
  }
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- `stair_columns` cap is 40; ranking by height (then x, y, z_top for determinism) means the tallest, most orientation-salient shafts survive and only trivial 2-level fragments get dropped.
- Fog-of-war honest: the surface probe and stair scan skip hidden tiles. Pending DIG designations are counted regardless of the hidden flag — they are the player's own markers, not sensed terrain.
- **Fog-of-war bypass**: with `reveal_hidden=true`, `surface_z_at_core` and `stair_columns` also read undiscovered tiles.
- **`reveal_hidden=true` always reads live**, whatever `source` asks for: the map census classifies revealed tiles only, so a bypassed overview cannot be projected from it. The response reports `source: "live"`, so the fallback is never silent.
- **A snapshot read draws on two walkers at different cadences.** `fort_core` ages with the entity snapshot (seconds); `extents`, `stair_columns` and `activity` age with the census (~60 s between passes plus a ~24 s pass), so a stairway dug a minute ago may not be in it yet. Read each walker's `age_ms`, or ask for `source: "live"`.
- `fort_core` equals `defenses().fort_core` byte-for-byte (same centroid computation).
- The TS wrapper backfills `surface_z_at_core`/`fort_core` to `null` when the Lua encoder omits them, and coerces empty nested activity lists to `[]` — the contract is nullable fields, never sometimes-missing ones.
- Version note (53.15): `world.constructions` is GONE on this build; constructions come from `df.construction.get_vector()`.

## Implementation notes
The snapshot projection is `projectMapOverview` in `src/tools/mapOverview.ts`: `extents`, `stair_columns` and `activity` come from the census's own counts and rare-feature coordinates, `fort_core` from the entity snapshot's captured unit positions, and `surface_z_at_core` from the census's packed `surface_hex` column map. Its parity against the live path is asserted by [`test/parity.mjs`](../../test/parity.mjs); see [read-source parity](../snapshot.md#read-source-parity). Live, this call measured a **1,047 ms frame gap** on a 253-unit fort — the freeze the census exists to remove.

Stair tiletypes only ever exist where the player carved or built them — DF has no natural stairs — so every reported `stair_columns` entry is discovered space by construction, on top of the explicit hidden-tile check. The dig-designation scan is gated on `block.flags.designated` before touching individual tiles, keeping it to the handful of blocks that actually carry a designation (validated at 54 of 11907 blocks on a live 78-pop fort) rather than a full-map sweep.

## Related
[tile_region](tile_region.md) · [geology](geology.md) · [defenses](defenses.md) · [environment](environment.md)

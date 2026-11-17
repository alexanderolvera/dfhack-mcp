---
tool: z_levels
tier: sensor
gated: snapshot
source: src/tools/snapshotQuery.ts
lua: src/dfhack-queries/mcp_snapshot.lua
tags: [dfhack-mcp/tool]
---

# z_levels

> One row per revealed z-level: tile counts by class, and what stands there.

## Purpose

The map's shape at a glance, one row per z-level, surface first. It answers "where is
this fort" before you spend a call on terrain: which levels are dug out, which hold the
workshops, which are solid rock, which have water. Run it first, then pull detail for
the levels it points at with [tile_region](tile_region.md) or
[snapshot_query](snapshot_query.md).

The payload is fixed-size regardless of map size: a map is 100–200 levels, each one row,
and fully unrevealed levels collapse into ranges rather than taking a row each.

## Parameters

| Name  | Type    | Required | Default | Description                |
| ----- | ------- | -------- | ------- | -------------------------- |
| z_min | integer | No       | —       | Lowest z-level to report.  |
| z_max | integer | No       | —       | Highest z-level to report. |

Both scope which rows come back. Neither changes `unrevealed_z`, which always describes
the whole map — so scoping to a range never makes you think a level is unexplored when
it is simply outside your window.

## Returns

Columnar, not one object per level:

- `source` — `"snapshot"`, with `snapshot.{entities,map}.{seq, age_ms, captured}`
- `columns` — the column names, in order
- `levels[]` — one array per revealed level, in the same order as `columns`
- `unrevealed_z[]` — `[[lo, hi], ...]`, inclusive ranges of fully unexplored levels

Read each row against `columns` rather than by position: the order is the contract the
response states, so it is safe to index, but only after reading it from `columns`.

### Census columns

Counted over **revealed tiles only**.

| Column         | Notes                                            |
| -------------- | ------------------------------------------------ |
| `z`            | the z-level this row describes                   |
| `revealed`     | discovered tiles on the level                    |
| `hidden`       | undiscovered tiles, counted but never classified |
| `open`         |                                                  |
| `floor`        |                                                  |
| `constructed`  | built floor or wall, not natural                 |
| `stair`        |                                                  |
| `ramp`         |                                                  |
| `tree`         |                                                  |
| `wall_stone`   |                                                  |
| `wall_mineral` | ore veins                                        |
| `wall_soil`    |                                                  |
| `wall_other`   |                                                  |
| `liquid`       | tiles holding water or magma                     |

### Entity columns

What stands on the level, from the entity walker rather than the census.

| Column             | Notes                          |
| ------------------ | ------------------------------ |
| `citizens`         |                                |
| `other_units`      |                                |
| `workshops`        | workshops and furnaces         |
| `stockpiles`       |                                |
| `zones`            | all civzones                   |
| `bedrooms`         | zones of type Bedroom          |
| `bedrooms_unowned` | bedrooms with no assigned unit |
| `other_buildings`  |                                |

`bedrooms` and `bedrooms_unowned` are both subsets of `zones`, so the entity columns do
not sum to a level's building count.

## Caveats & limits

- **The two halves age separately.** Tile counts come from the map census and entity
  counts from the entity walker, whose cadences differ by an order of magnitude — the
  census refreshes in minutes, entities in seconds. That is why the response reports
  `snapshot.map` and `snapshot.entities` provenance separately rather than one `age_ms`.
  A level can show freshly-placed workshops against tile counts from minutes ago.
- **Fog-of-war honest.** A hidden tile is counted in `hidden` and classified nowhere
  else, so the class columns never leak what is behind undiscovered rock. A level that is
  entirely unexplored does not appear in `levels` at all; it is in `unrevealed_z`.
- **Dead and hidden units are not counted** in `citizens` or `other_units`.
- **There is no live path.** The census exists only in the publisher, so this tool takes
  no `source` parameter and is not registered with the snapshot layer off.

## Implementation notes

The column reference in this page and in the tool's description both come from
`CENSUS_COLUMNS` and `ENTITY_COLUMNS` in `src/snapshotSchema.ts`. The census half mirrors
what `mcp_snapshot.lua` publishes, and `test/snapshotSchema.test.mjs` asserts the
documented names and their order are exactly `census.columns` in the committed capture,
and that every census row carries one value per column. The entity half is computed
server-side in `src/tools/snapshotQuery.ts` from the same list that names it, so the
counting and the documentation cannot disagree.

`unrevealed_z` is built by the walker as it runs, which is why scoping with
`z_min`/`z_max` cannot narrow it: it describes the map, not the window.

## Related

- [snapshot_query](snapshot_query.md) — the rows behind the entity columns
- [tile_region](tile_region.md) — the actual tile grid for one level
- [map_overview](map_overview.md) — extents, fort core and stairways, also census-backed
- [the publisher](../snapshot.md) — cadence, `seq` and provenance

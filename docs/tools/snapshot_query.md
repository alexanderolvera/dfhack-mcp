---
tool: snapshot_query
tier: sensor
gated: snapshot
source: src/tools/snapshotQuery.ts
lua: src/dfhack-queries/mcp_snapshot.lua
tags: [dfhack-mcp/tool]
---

# snapshot_query

> Filter, project, group and count any entity class from the in-game snapshot.

## Purpose

The general read over the publisher's entity capture. Where the other sensors answer
one fixed question each, this one hands the caller the capture's own rows and lets them
ask their own: every unit with a wound, items by type, buildings on one z-level, how
many citizens are unsquadded. It costs no game time once the snapshot is warm, because
it never touches DF — it filters a payload already in the server's memory.

Use it when no sensor asks your question, or when you want raw rows rather than a
curated view. Reach for [z_levels](z_levels.md) first if the question is "where should
I look", and for [tile_region](tile_region.md) if it is about terrain shape.

## Parameters

| Name          | Type                                                                 | Required | Default | Description                                                                |
| ------------- | -------------------------------------------------------------------- | -------- | ------- | -------------------------------------------------------------------------- |
| class         | `"units"` \| `"items"` \| `"buildings"` \| `"reports"` \| `"squads"` | Yes      | —       | Which class of the capture to read.                                        |
| where         | object                                                               | No       | —       | Field path → condition. A bare value matches exactly; an object takes ops. |
| fields        | string[]                                                             | No       | all     | Paths to return per row.                                                   |
| group_by      | string[]                                                             | No       | —       | Group and count instead of returning rows.                                 |
| count_only    | boolean                                                              | No       | `false` | Return only `matched`.                                                     |
| sort_by       | string                                                               | No       | —       | Field path to sort rows by.                                                |
| desc          | boolean                                                              | No       | `false` | Sort descending.                                                           |
| limit         | integer > 0                                                          | No       | —       | Scope how many rows come back. Does not change `matched`.                  |
| reveal_hidden | boolean                                                              | No       | `false` | Include rows on undiscovered tiles.                                        |

Paths are dotted, so `pos.z` and `where: {"pos.z": {"lt": 140}}` both work.

### where ops

`eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `contains`, `exists`.

`contains` is case-insensitive and string-only. `lt`/`lte`/`gt`/`gte` are number-only and
never match a missing or non-numeric value. `exists` tests presence: many fields are
absent rather than null when they do not apply, so `{"squad_id": {"exists": true}}` is how
you ask for squadded units.

## Returns

- `source` — `"snapshot"`, with `snapshot.entities.{seq, age_ms, captured}` provenance
- `class` — echo of the class read
- `fog_of_war` — `"applied"` or `"bypassed"`
- `matched` — how many rows matched, **always the full count**
- `returned` — how many rows came back; present only when `limit` scoped them
- `rows[]` — the matched rows, or the projection of them named by `fields`
- `groups[]` — with `group_by`: `[{<field>: value, ..., n}]`, sorted by `n` descending

`count_only` returns `matched` with no `rows`. `group_by` returns `groups` with no `rows`.

### limit is scoping, not truncation

The server never truncates; the caller scopes ([#144](https://github.com/alexanderolvera/dfhack-mcp/issues/144)).
`limit` honors that because it never hides how much there was: `matched` is the full
number of matching rows whether or not a limit was given, and the scoped count comes
back as `returned`. So `matched: 11574, returned: 3` says plainly that three of 11,574
rows were handed over. There is no cursor and no `truncated` flag, because nothing was
cut off behind the caller's back — ask again with a larger `limit`, or none at all.

## Classes and fields

A field marked **always** is emitted for every row. Every other field is **absent** when
it does not apply, not null — use `exists` to test for it.

### units

Every unit on the map, citizens and others alike.

| Field              | Always | Notes                                                                       |
| ------------------ | ------ | --------------------------------------------------------------------------- |
| `id`               | yes    |                                                                             |
| `name`             | yes    |                                                                             |
| `profession`       | yes    |                                                                             |
| `citizen`          | yes    |                                                                             |
| `dead`             | yes    |                                                                             |
| `age`              | yes    | whole years                                                                 |
| `wound_count`      | yes    |                                                                             |
| `needs_healthcare` | yes    |                                                                             |
| `unconscious`      | yes    | counter, 0 when awake                                                       |
| `pos`              | yes    | `{x,y,z}`; `x` is negative for a unit off the map                           |
| `race`             |        | creature token, e.g. `DWARF`                                                |
| `stress_category`  |        | 0 miserable .. 6 ecstatic                                                   |
| `job_type`         |        | absent when the unit has no current job                                     |
| `squad_id`         |        | absent when unsquadded                                                      |
| `hidden`           |        | true on an undiscovered tile; absent where there is no map position to test |

### items

Every item, on the ground or held.

| Field          | Always | Notes                                                               |
| -------------- | ------ | ------------------------------------------------------------------- |
| `id`           | yes    |                                                                     |
| `type`         | yes    | df `item_type`, e.g. `BED`, `DOOR`, `BOX`, `BOULDER`, `BAR`         |
| `subtype`      | yes    | `-1` when the type has none                                         |
| `mat_type`     | yes    |                                                                     |
| `mat_index`    | yes    |                                                                     |
| `quality`      | yes    | 0 ordinary .. 5 artifact                                            |
| `wear`         | yes    |                                                                     |
| `stack`        | yes    |                                                                     |
| `forbid`       | yes    |                                                                     |
| `in_job`       | yes    |                                                                     |
| `dump`         | yes    |                                                                     |
| `on_ground`    | yes    |                                                                     |
| `in_building`  | yes    | installed as furniture                                              |
| `in_inventory` | yes    |                                                                     |
| `rotten`       | yes    |                                                                     |
| `trader`       | yes    |                                                                     |
| `construction` | yes    |                                                                     |
| `material`     |        | token, e.g. `INORGANIC:GRANITE`, `PLANT:WILLOW:WOOD`                |
| `pos`          |        | absent for an item with no map position, i.e. one held or contained |
| `container`    |        | item id of the container holding it                                 |
| `holder`       |        | unit id carrying it                                                 |
| `desc`         |        | DF's own rendered description                                       |
| `hidden`       |        | as above                                                            |

### buildings

Every building, including stockpiles and zones.

| Field                   | Always | Notes                                                             |
| ----------------------- | ------ | ----------------------------------------------------------------- |
| `id`                    | yes    |                                                                   |
| `type`                  | yes    | `Bed`, `Door`, `Workshop`, `Furnace`, `Stockpile`, `Civzone`, ... |
| `subtype`               | yes    | `-1` when the type has none                                       |
| `custom`                | yes    | custom building type index, `-1` when not custom                  |
| `x1` `y1` `x2` `y2` `z` | yes    | footprint rectangle and level                                     |
| `stage`                 | yes    | build stage reached                                               |
| `max_stage`             | yes    | stage at which it is complete                                     |
| `zone_type`             |        | Civzone only: `Bedroom`, `DiningHall`, `Pen`, `Barracks`, ...     |
| `owner`                 |        | assigned unit id, absent when unassigned                          |
| `name`                  |        | absent when the building is unnamed                               |
| `items`                 |        | count of contained items                                          |
| `jobs`                  |        | count of jobs posted at it                                        |
| `hidden`                |        | as above                                                          |

An unfinished building has `stage` < `max_stage`.

### reports

The fort's recent announcements and combat log.

| Field          | Always | Notes                                          |
| -------------- | ------ | ---------------------------------------------- |
| `id`           | yes    |                                                |
| `type`         | yes    | df `announcement_type`, e.g. `COMBAT_PARRY`    |
| `text`         | yes    |                                                |
| `year`         | yes    |                                                |
| `time`         | yes    | tick within the year                           |
| `pos`          | yes    |                                                |
| `continuation` | yes    | true when this line continues the previous one |

A multi-line combat exchange arrives as several rows; only the first has
`continuation: false`.

### squads

Military squads, for resolving a unit's `squad_id`.

| Field  | Always | Notes |
| ------ | ------ | ----- |
| `id`   | yes    |       |
| `name` | yes    |       |

## Examples

```sh
npm run call snapshot_query class=units 'where={"citizen":{"eq":true},"wound_count":{"gt":0}}'
npm run call snapshot_query class=items 'group_by=["type"]'
npm run call snapshot_query class=units 'where={"squad_id":{"exists":false}}' count_only
npm run call snapshot_query class=buildings 'where={"zone_type":{"eq":"Bedroom"},"owner":{"exists":false}}'
```

## Caveats & limits

- **Rows are as old as the capture.** `snapshot.entities.age_ms` says how old. Positions
  and `job_type` move fastest; ids, names and professions are stable. See
  [the read-source contract](../snapshot.md#the-read-source-contract).
- **There is no live path.** The capture is the only source, so this tool takes no
  `source` parameter. With the snapshot layer off it is not registered at all.
- **Fog of war is applied by default**, so rows on undiscovered tiles are omitted. A row
  with no map position cannot be fog-tested and is therefore never omitted — an item in a
  container is reported wherever its holder is.
- **`where` compares what the capture holds**, not what DF would compute now. A derived
  question ("is this dwarf unhappy") is the caller's to compose from `stress_category`.

## Implementation notes

The field reference in this page, in the tool's description and in the `class` enum all
come from one place: `SNAPSHOT_CLASSES` in `src/snapshotSchema.ts`. That list mirrors
what `mcp_snapshot.lua` emits, and `test/snapshotSchema.test.mjs` proves the mirror
honest against the committed capture in both directions — a field the walker emits but
the schema omits fails the suite, and so does a schema field the walker never emits. The
`always` flags follow the Lua emitter's own contract (a field assigned unconditionally),
not what one fort happened to contain, and the suite checks every `always` field really
is present on every captured row.

## Related

- [z_levels](z_levels.md) — where to look, before querying rows
- [find_unit](find_unit.md) — the curated unit lookup, also snapshot-backed
- [the publisher](../snapshot.md) — cadence, `seq`, provenance and off-game development

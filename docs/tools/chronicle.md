---
tool: chronicle
tier: sensor
gated: none
source: src/tools/chronicle.ts
lua: src/dfhack-queries/mcp_chronicle.lua
tags: [dfhack-mcp/tool]
---

# chronicle

> The fort's announcement/report stream (combat, deaths, moods, artifacts, sieges, migrants, ...) as triaged, cursor-addressable events.

## Purpose
Reads DF's rolling, front-pruned report window and returns it as id-addressable events with a save/load-stable cursor. Events are triaged into categories (death, birth, marriage, battle, siege, mood, artifact, migrants, diplomacy, cave-in, megabeast, other) and combat spam is tamed via repeat counts, continuation-line folding, and battle-run collapse. An AI co-pilot polls it with the cursor to learn what happened since it last looked.

## Parameters
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| since | number (int) | No | — | Cursor: return only events with id greater than this (from a prior `cursor`). |
| categories | array of category enums (or comma-joined string) | No | all | Subset to return: death, birth, marriage, battle, siege, mood, artifact, migrants, diplomacy, cave-in, megabeast, other. |
| limit | number (int) | No | 50 | Max events to return (capped at 200); newest are kept. |

## Returns
Top-level fields:
- `cursor` — highest retained id; pass back as `since` to resume
- `oldest_retained_id?`, `newest_retained_id?`, `next_report_id?`, `window_size` — window bookkeeping
- `since?` (echo), `pruned` (true when `since` predates the retained window — earlier events are gone, not silently omitted), `pruned_note?`
- `limit`, `count`, `more?` (older matching events exist beyond `limit`), `omitted_by_limit?`
- `battle_collapsed` — combat reports folded into collapse markers
- `filtered_categories?`, `order` (always "ascending"), `note?`
- `events[]` — each: `id` (monotonic, save/load-stable), `category`, `type` (announcement_type token), `text?` (continuation lines folded in), `color?`, `date`, `year?`, `time?` (tick-of-year), `repeat_count?` (only when > 0), `continuation_lines?`, `collapsed?`/`collapsed_count?` (a battle-run collapse marker, not a single report), `pos?` `{x,y,z}` tile anchor, `speaker?` `{id, name?}` (only when the report names a speaker)

```json
{
  "battle_collapsed": 2619,
  "count": 50,
  "cursor": 11606,
  "events": [
    {
      "category": "battle",
      "color": 3,
      "date": "25th Opal, Year 7",
      "id": 11031,
      "pos": { "x": 76, "y": 60, "z": 131 },
      "text": "The militia commander hacks the axedwarf in the left lower arm with his steel battle axe, lightly tapping the target!",
      "time": 365133,
      "type": "COMBAT_STRIKE_DETAILS",
      "year": 7
    },
    {
      "category": "battle",
      "collapsed": true,
      "collapsed_count": 76,
      "date": "25th Opal, Year 7",
      "id": 11033,
      "text": "consecutive combat reports collapsed to keep the window readable",
      "type": "COMBAT_COLLAPSED"
    }
  ]
}
```

## Caveats & limits
- Limit defaults to 50, hard cap 200; omitting `since` returns the most recent `limit` events, oldest-to-newest.
- The report window is rolling and front-pruned by DF: if `since` predates it, `pruned: true` — the earlier events are unrecoverable.
- Consecutive battle runs collapse after 6 kept events; the overflow becomes ONE marker event (`collapsed: true` with `collapsed_count`) so a siege cannot flood the window.
- Unit references appear only when a report names a speaker (`speaker_id != -1`); combat reports carry no reliable unit id in DF 53.x (spike #9 finding: per-report `unit_id` does not exist), so they get a `pos` tile anchor instead.
- Event `id` is monotonic and save/load-stable — safe to persist as a long-lived cursor.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
- The TS wrapper passes a native argv to `mcp_chronicle.lua`: `[since, categories (comma-joined), limit]`. The Lua reads the rolling, front-pruned `df.global.world.status.reports` window.
- Any `announcement_type` that doesn't map to a specific category falls back to `other`.
- `repeat_count` mirrors DF's own native "(xN)" report-collapsing notation.
- Field paths, verified live on DFHack 53.15 (spike #9): `df.global.world.status.reports` is a vector of `report`, id-ascending; `df.global.world.status.next_report_id` is a persisted monotonic counter; each `report` exposes `{id, type, text, color, year, time, repeat_count, speaker_id, pos}` and `flags.{continuation, announcement}`; `df.announcement_type[report.type]` resolves the stable category token. Every field read is defensive (pcall-guarded).
- `report.group_id`/`pool_id` are not usable for grouping combat spam: `group_id` is absent on DF 53.x and `pool_id` is 1:1 with the report index. Collapsing instead relies on `repeat_count`, continuation-line folding, and the battle-run cap.
- `pruned` compares `since + 1` against the oldest retained id, not `since` itself: the caller's next wanted id is `since + 1`, so `since == oldest_retained_id - 1` means nothing was actually lost even though `since` itself predates the window.
- The category map is a static, hand-authored table over the full `announcement_type` enum, not a live sample — most categories may have zero live occurrences on a given fort but still need a category. Exact-token overrides in `EXACT` are checked before the family `PREFIX` rules (e.g. `COMBAT_` → battle).
- `categories` filtering matches against a set built from the requested tokens; a token that doesn't correspond to any known category is kept in the set but never matches anything, so a typo yields an empty `events[]` rather than an error.

## Related
- [site_history](site_history.md) — the deep past (historical events), where chronicle is the live stream.
- [citizen](citizen.md) — dossier on a unit named by a speaker reference.
- [threats](threats.md) ↔ [defenses](defenses.md) — the live tactical picture behind battle/siege events.
- [moods](moods.md) — details behind `mood` category events.

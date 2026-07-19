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

## Related
- [site_history](site_history.md) — the deep past (historical events), where chronicle is the live stream.
- [citizen](citizen.md) — dossier on a unit named by a speaker reference.
- [threats](threats.md) ↔ [defenses](defenses.md) — the live tactical picture behind battle/siege events.
- [moods](moods.md) — details behind `mood` category events.

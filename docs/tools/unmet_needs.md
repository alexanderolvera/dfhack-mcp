---
tool: unmet_needs
tier: sensor
gated: none
source: src/tools/unmetNeeds.ts
lua: src/dfhack-queries/mcp_unmetNeeds.lua
tags: [dfhack-mcp/tool]
---

# unmet_needs

> Why the fort is stressed: the dwarven needs system aggregated across all citizens.

## Purpose
Companion to `fort_status`'s happiness buckets: those say HOW MANY dwarves are unhappy; this says WHICH needs are starving them and how badly. It scans every citizen's `personality.needs`, counts each dwarf at most once per need type (using their worst focus for that type), and ranks need types by how many dwarves are meaningfully distracted. Reports which needs are unmet, not how to fix them — the co-pilot looks that up or reasons from the need type.

## Parameters
None.

## Returns
| Field | Meaning |
|---|---|
| `population` | citizen count |
| `dwarves_with_unmet_need` | dwarves with at least one distracted need |
| `top_needs[]` | up to 8 rows `{need, dwarves, worst_focus}`, sorted by dwarves distracted (desc), then severity |
| `top_needs[].need` | `df.need_type` token, e.g. `PrayOrMeditate`, `DrinkAlcohol`, `Socialize` |
| `top_needs[].worst_focus` | most negative focus_level seen for that need (magnitude = how starved) |
| `alerts[]` | at most one line, only when the top need distracts ≥ 25% of the fort |

```json
{
  "alerts": ["73 of 78 dwarves distracted by unmet need: BeWithFamily"],
  "dwarves_with_unmet_need": 77,
  "population": 78,
  "top_needs": [
    { "dwarves": 73, "need": "BeWithFamily", "worst_focus": -33756 },
    { "dwarves": 68, "need": "BeWithFriends", "worst_focus": -29636 },
    { "dwarves": 44, "need": "PrayOrMeditate", "worst_focus": -134860 }
  ]
}
```
*(top_needs trimmed; a real response carries up to 8 rows.)*

## Caveats & limits
- "Distracted" is a heuristic cut: `focus_level < -1000` (tunable in the Lua). Slightly-unfulfilled needs don't count.
- `top_needs` is capped at 8 — the long tail of 1-2-dwarf needs is dropped as non-actionable.
- Almost every dwarf always carries at least one distracted need, so `dwarves_with_unmet_need` being high is baseline, not news; the alert fires only on REACH (top need distracting ≥ 25% of citizens).
- A dwarf holding several needs of one type (e.g. PrayOrMeditate per deity) counts once for that type, at their worst focus.
- Verified live on DFHack 53.15-r2 (`soul.personality.needs` iterates; `df.need_type[id]` yields readable tokens).
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
Each citizen's soul carries `personality.needs` (an array of `df.need_type` entries). `focus_level` is the signal: `>= 0` means the need is met/neutral, negative means the dwarf is distracted by it, and the magnitude is how starved the need is.

## Related
[fort_status](fort_status.md) (the happiness buckets this explains), [moods](moods.md) (strange moods, a different system), [citizen](citizen.md) (per-dwarf detail), [wiki_lookup](wiki_lookup.md) (what a given need means).

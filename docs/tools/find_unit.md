---
tool: find_unit
tier: sensor
gated: none
source: src/tools/findUnit.ts
lua: src/dfhack-queries/mcp_findUnit.lua
tags: [dfhack-mcp/tool]
---

# find_unit

> Look up citizens by a name fragment or profession (case-insensitive, matches either).

## Purpose
Resolves a name fragment or profession into a compact dossier per matching citizen: profession, age, stress level, current job, squad, and health flags. Useful for questions like "how is the chief medical dwarf" or "find Urist". Each match carries a `unit_id` — the chaining key into citizen() for depth.

## Parameters
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| query | string (min 1) | Yes | — | Name fragment or profession to search for. |

## Returns
Top-level fields:
- `query` — echo of the search term
- `match_count` — total citizens that matched (may exceed the listed matches)
- `truncated` — true when the match list was capped
- `matches[]` — each: `unit_id`, `name`, `profession`, `age`, `stress` (level label), `current_job`, `squad?`, `wounded`, `patient`, `unconscious`

```json
{
  "match_count": 75,
  "matches": [
    {
      "age": 57,
      "current_job": "idle",
      "name": "Tun Lolumavuz \"Woodenmines\", militia commander",
      "patient": false,
      "profession": "militia commander",
      "squad": "The Waxy Tomes",
      "stress": "unhappy",
      "unconscious": false,
      "unit_id": 111,
      "wounded": false
    },
    {
      "age": 85,
      "current_job": "CarveRamp",
      "name": "Atir Rosenastod \"Coalgulfs\", Miner",
      "patient": false,
      "profession": "Miner",
      "stress": "content",
      "unconscious": false,
      "unit_id": 112,
      "wounded": true
    }
  ],
  "query": "a",
  "truncated": true
}
```

## Caveats & limits
- The match list is capped at 8 (Lua `MAX = 8`); `match_count` still reports the full total and `truncated` flags the cap — narrow the query to see the rest.
- Matching is case-insensitive against either the name or the profession.
- `squad` is present only for squad members.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Related
- [citizen](citizen.md) — the deep dossier a match's `unit_id` chains into.
- [work_details](work_details.md) — labor-group membership for a found unit.
- [injuries_and_health](injuries_and_health.md) — details behind the wounded/patient flags.
- [game_data](game_data.md) — a live unit_id also resolves in the creature kind for species facts.

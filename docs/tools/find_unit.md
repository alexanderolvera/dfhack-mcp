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
| source | `"snapshot"` \| `"live"` | No | `DFHACK_MCP_READ_SOURCE`, else `snapshot` where the snapshot layer is on | Which read path to use. See [the read-source contract](../snapshot.md#the-read-source-contract). |

## Returns
Top-level fields:
- `source` — `"snapshot"` or `"live"`, the path that served this payload
- `snapshot` — on a snapshot read only: `{ entities: { seq, age_ms, captured } }`. `age_ms` is how stale the capture is; `current_job` is the fastest-moving field in it
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
  "source": "live",
  "truncated": true
}
```

A snapshot read replaces `"source": "live"` with the provenance envelope:

```json
{
  "source": "snapshot",
  "snapshot": {
    "entities": { "seq": 41, "age_ms": 2310, "captured": { "year": 251, "year_tick": 149760 } }
  },
  "query": "a",
  "match_count": 75,
  "truncated": true,
  "matches": []
}
```

## Caveats & limits
- The match list is capped at 8 (Lua `MAX = 8`); `match_count` still reports the full total and `truncated` flags the cap — narrow the query to see the rest.
- Matching is case-insensitive against either the name or the profession.
- `squad` is present only for squad members.
- **A snapshot read is seconds old.** Identity, age, profession and squad move slowly, but `current_job` is the most staleness-sensitive field in the entity snapshot: on a live fort, 3–5 of the 8 matches shown had changed job at a snapshot age of only 0.6 s. Read `age_ms`, or ask for `source: "live"`, before acting on a job. `wounded`, `patient`, `unconscious` and `stress` also drift, far more slowly.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
The snapshot projection is `projectFindUnit` in `src/tools/findUnit.ts`, which filters the published `units` class on the same citizen/name/profession rule the Lua query applies and resolves `squad` through the snapshot's own `squads` class. Its parity against the live path is asserted by [`test/parity.mjs`](../../test/parity.mjs) — deep-equal on a paused fort, identity spine plus drift reporting on a running one. See [read-source parity](../snapshot.md#read-source-parity).

The search term arrives as native DFHack argv (`args[1]`) rather than through any string-escaping layer, so an apostrophe or backslash in the query is just data — there is nothing to escape and nothing that needs to be.

Confirmed live on DFHack 53.15-r2: `dfhack.units.getReadableName`, `getProfessionName`, `getAge`, and `getStressCategory` are all present on this build. Squad names resolve via `df.global.world.squads.all`, filtered to the fort's own `entity_id` and looked up by each unit's `military.squad_id`.

## Related
- [citizen](citizen.md) — the deep dossier a match's `unit_id` chains into.
- [game_data](game_data.md) — a match's `unit_id` also chains here for the unit's creature dossier (flags, attacks, interactions).
- [work_details](work_details.md) — labor-group membership for a found unit.
- [injuries_and_health](injuries_and_health.md) — details behind the wounded/patient flags.
- [game_data](game_data.md) — a live unit_id also resolves in the creature kind for species facts.

---
tool: threats
tier: sensor
gated: none
source: src/tools/threats.ts
lua: src/dfhack-queries/mcp_threats.lua
tags: [dfhack-mcp/tool]
---

# threats

> Dangerous units currently on the map, grouped by creature type.

## Purpose
Enumerates every dangerous unit on the map (active, not dead, `isDanger`, not a citizen), grouped by creature so "12 goblins" reads as one line. Separates ACTIVE hostiles from CONTAINED ones (caged/chained — a captured beast is a hazard-in-waiting, not a live attack) and classifies each group (invader, undead, crazed, great-danger). Each group also carries tactical intel resolved from the representative unit's creature raws: the creature token, a curated set of decisive traits, and ranged/breath attack labels. An AI co-pilot calls it to know what is on the map before reasoning about defense; the tool reports the facts, not the counter-strategy.

## Parameters
None.

## Returns
| Field | Meaning |
|---|---|
| `active_hostiles` | count of loose dangerous units |
| `contained` | count of caged/chained dangerous units |
| `groups[]` | one entry per (creature name, containment) pair, first-seen order |
| `groups[].name` | readable creature/unit name |
| `groups[].count` | units in the group |
| `groups[].contained` / `invader` / `undead` / `crazed` / `great_danger` | classification flags |
| `groups[].token` | creature raw id (a direct `game_data` handle, e.g. `"DEMON_19"`); `null` if unresolvable |
| `groups[].traits` | curated decisive traits: `trapavoid`, `flier`, `fire`, `webber`, `building_destroyer`, `ranged` |
| `groups[].ranged_attacks` | ranged/breath attack labels (interaction `adv_name`s) |
| `alerts[]` | pre-triaged lines: great-danger first (with unioned traits), then invaders, other hostiles, and a quieter contained mention |

```json
{
  "active_hostiles": 5,
  "alerts": [
    "5 great-danger creatures loose (megabeast/titan/demon/FB); traits: trapavoid, fire, building_destroyer, ranged",
    "2 dangerous creatures caged/chained"
  ],
  "contained": 2,
  "groups": [
    {
      "contained": false,
      "count": 5,
      "crazed": false,
      "great_danger": true,
      "invader": false,
      "name": "Monster Of Vomit",
      "ranged_attacks": ["Spray vapor"],
      "token": "DEMON_19",
      "traits": ["trapavoid", "fire", "building_destroyer", "ranged"],
      "undead": false
    }
  ]
}
```

## Caveats & limits
- Distinct groups per (name, containment): a caged beast never masks a loose one of the same kind.
- Intel comes from the group's first-seen (representative) unit; degrades gracefully — an unresolvable race/caste yields `token: null` and empty `traits`/`ranged_attacks` rather than an error.
- The `fire` trait unions FIREIMMUNE flags with a name-based scan of attack labels for "fire"/"flame"; `webber` unions the WEBBER flag with "web" attacks.
- `building_destroyer` reads `caste.misc.buildingdestroyer` (numeric; > 0) — verified on DFHack 53.15-r2 that there is NO BUILDINGDESTROYER flag bit in this build.
- The TS wrapper coerces each group's `traits` / `ranged_attacks` to real arrays (an empty Lua table would otherwise encode as `{}`).
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Related
[defenses](defenses.md) (per-structure defensive posture), [military](military.md) (the fort's own squads), [identify](identify.md) and [game_data](game_data.md) (deep-dive a creature via its `token`), [wiki_lookup](wiki_lookup.md) (creature background knowledge).

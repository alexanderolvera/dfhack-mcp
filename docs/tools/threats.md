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
| `alerts[]` | pre-triaged lines: great-danger first (with unioned traits), then invaders, then other hostiles — `contained` is already its own field, so a contained count is not separately alerted |

```json
{
  "active_hostiles": 5,
  "alerts": [
    "5 great-danger creatures loose (megabeast/titan/demon/FB); traits: trapavoid, fire, building_destroyer, ranged"
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
- **Fog of war**: a unit standing on an undiscovered tile (`designation.hidden`, or off-map/unloaded) is filtered out entirely — never counted, grouped, or alerted on — whether loose or caged/chained. Only hostiles the fort has actually found are reported.
- Distinct groups per (name, containment): a caged beast never masks a loose one of the same kind.
- Intel comes from the group's first-seen (representative) unit; degrades gracefully — an unresolvable race/caste yields `token: null` and empty `traits`/`ranged_attacks` rather than an error.
- The `fire` trait unions FIREIMMUNE flags with a name-based scan of attack labels for "fire"/"flame"; `webber` unions the WEBBER flag with "web" attacks.
- The TS wrapper coerces each group's `traits` / `ranged_attacks` to real arrays (an empty Lua table would otherwise encode as `{}`).
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
- The base hostile predicate (`active`, not dead, `isDanger`, not a citizen) is shared with `fort_status`; the two should stay in sync if that predicate ever changes.
- The fog-of-war filter (via `mcp_unitVisibility`) exists because an earlier version of this tool, and `fort_status`, could expose undiscovered hostiles — an X-ray leak fixed by gating unit enumeration on fog-of-war before a unit ever reaches a group, count, or alert.
- Creature raws are resolved via `df.global.world.raws.creatures.all[u.race]` (a `creature_raw`); `.creature_id` is the token (e.g. `"DEMON_4"`). Confirmed live on DFHack 53.15-r2: the caste vector is the `caste` field (not `castes`), and the representative caste is `caste[0]`.
- `caste.flags` is a bitfield whose true keys are stable token names. It must be iterated with `pairs()` — indexing it directly by a token name throws "not found" for any bit that isn't set in that build, so a direct lookup isn't safe.
- Ranged/breath attacks resolve via `caste.body_info.interactions[].interaction.adv_name`.
- Building-destroyer capability reads the numeric `caste.misc.buildingdestroyer` field (`> 0` means capable); there is no `BUILDINGDESTROYER` flag bit and no `caste.building_destroyer` field in this build — verified live against TROLL (`= 2`) and the Flame Phantom demons (`= 0`).

## Related
[defenses](defenses.md) (per-structure defensive posture), [military](military.md) (the fort's own squads), [identify](identify.md) and [game_data](game_data.md) (deep-dive a creature via its `token`), [wiki_lookup](wiki_lookup.md) (creature background knowledge), [livestock_and_pastures](livestock_and_pastures.md) (the fort's own TAME animals — this tool only sees hostiles).

---
tool: livestock_and_pastures
tier: sensor
gated: none
source: src/tools/livestockAndPastures.ts
lua: src/dfhack-queries/mcp_livestockAndPastures.lua
tags: [dfhack-mcp/tool]
---

# livestock_and_pastures

> The fort's tame animal economy as facts: the single largest post-v1.0 blind spot — `threats` only sees hostiles, nothing saw a single tame animal.

## Purpose
Every fort manages animals — pets, breeding livestock, war/hunting companions, egg layers, caged wildlife — and none of it was visible. Reports ownership counts (pets vs. collectively-owned livestock), a species/sex/adult breakdown, and the two "silent" failure modes that matter most: a grazer with no pasture assignment (it cannot graze — the classic silent-starvation bug) and an egg layer with no nestbox in reach (eggs go uncollected). Also reports animals marked for slaughter, animals with war/hunting training, occupied cages, and how many tame animals are roaming with no pasture/cage/chain at all.

## Parameters
None.

## Returns
- `tame_total`, `pets`, `livestock` (numbers) — `pets` (`dfhack.units.isPet`, has an assigned owner) + `livestock` (tame but not personally owned) always sum to `tame_total`.
- `by_group[]` — `{ species, sex, adult, count }`, one row per distinct species/sex/adult-or-child combination.
- `grazers` — `{ total, pastured, unpastured[], unpastured_truncated }`. `unpastured[]` lists the actual animals (capped 50) — small enough in practice to be actionable, and urgent (a grazer literally cannot eat without a pasture).
- `egg_layers` — `{ total, nestbox_count, pastured_without_nestbox, unpastured }`. Counts only, not a list — the population is usually large (dozens of birds) and the consequence (missed eggs) is mild, unlike grazer starvation.
- `marked_for_slaughter[]` / `marked_for_slaughter_truncated` — animals with `unit.flags2.slaughter` set (capped 50).
- `trained[]` / `trained_truncated` — animals with a war/hunting training level between `Trained` and `MasterfullyTrained` (capped 50); each row carries `training_level` (the state name).
- `cages[]` — `{ building_id, occupants[] }`, one entry per currently-occupied cage (empty cages are omitted).
- `unassigned_count` (number) — tame animals with no pasture, cage, or chain. DFHack's `zone` tool calls this state "unassigned" (its `-unassigned` filter); reported as a count only, since it's commonly large and often intentional (free-roaming cats, for instance).

Animal rows (`grazers.unpastured[]`, `marked_for_slaughter[]`, `trained[]`, `cages[].occupants[]`) share a shape: `{ unit_id, name, species, sex?, adult, training_level? }`.

```json
{
  "tame_total": 264,
  "pets": 12,
  "livestock": 252,
  "grazers": { "total": 36, "pastured": 17, "unpastured": [ { "unit_id": 128, "name": "Horse (tame)", "species": "HORSE", "sex": "female", "adult": true } ], "unpastured_truncated": false },
  "egg_layers": { "total": 96, "nestbox_count": 14, "pastured_without_nestbox": 1, "unpastured": 83 },
  "marked_for_slaughter_truncated": true,
  "trained_truncated": false,
  "cages": [],
  "unassigned_count": 206
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- `training_level` covers DF's single shared training scale (`SemiWild`→...→`Domesticated`); DF does not persist which discipline (war vs. hunting) an animal was trained under as separate per-animal state, so this tool reports the level only, not the discipline.
- Nestbox coverage is a spatial check: a pen "has a nestbox" if a `NEST_BOX` building's tile falls within the pen's bounds — this mirrors how DFHack's `autonestbox` sets up its zones, but a hand-built pen with a nestbox placed unconventionally is still detected correctly since it's a pure position check, not a naming convention.
- `unassigned_count` doesn't distinguish "problem" from "intentional" — a fort's cats are commonly, deliberately unassigned.
- Caps (50 each, with `*_truncated` flags) apply to `grazers.unpastured`, `marked_for_slaughter`, and `trained` — a large or old fort can exceed these; `by_group[]` and the scalar counts are never capped.

## Implementation notes
Tame animals are every unit in `df.global.world.units.active` where `dfhack.units.isTame(u)` is true. Pasture assignment comes from `Pen`-type civzones (`df.global.world.buildings.other.ACTIVITY_ZONE`, same civzone model `rooms_and_zones` uses) and their `assigned_units[]`. Grazer/egg-layer status is the creature's caste `flags.GRAZER`/`flags.LAYS_EGGS` (caste-specific — e.g. only female birds usually lay). Slaughter marking is `unit.flags2.slaughter`; unassigned is the absence of a pasture plus `unit.flags1.caged`/`.chained` both false. Cage occupants use the documented `dfhack.buildings.getCageOccupants(cage)` (distinct from `cage.assigned_units`, which is who's *assigned*, not who's *inside*). Confirmed live on DFHack 53.15-r2 against the Dreamfort fixture (264 tame animals, 19 unpastured grazers, 14 nestbox-covered pens of 19 total).

## Related
[rooms_and_zones](rooms_and_zones.md) · [mandates_and_justice](mandates_and_justice.md) (restraint capacity) · [stocks](stocks.md) · [threats](threats.md)

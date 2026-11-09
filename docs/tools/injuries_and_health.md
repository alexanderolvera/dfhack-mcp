---
tool: injuries_and_health
tier: sensor
gated: none
source: src/tools/injuriesAndHealth.ts
lua: src/dfhack-queries/mcp_injuriesAndHealth.lua
tags: [dfhack-mcp/tool]
---

# injuries_and_health

> The fort's medical picture: how many dwarves are wounded, in the care queue, bedridden, or unconscious, plus a breakdown of what care is needed.

## Purpose
Counts the citizens who are currently injured, queued for healthcare (patients), bedridden (should-not-move), and genuinely unconscious, and breaks down the outstanding care requests (diagnosis, surgery, suture, dressing, ...) so gaps in medical coverage — a missing diagnostician, surgeon, or supplies — are visible as facts. An AI co-pilot calls it after combat, accidents, or when checking whether the hospital pipeline is keeping up. It reports the demand side of medicine; the hospital's supply side lives in `rooms_and_zones`.

## Parameters
None.

## Returns
- `population` (number) — citizen count.
- `wounded` (number) — citizens carrying at least one wound with LIVE damage: bleeding, pain, swelling, strain, an unset fracture, a severed part, infection, a stuck weapon, or any unhealed per-part damage flag.
- `old_wounds_only` (number) — citizens whose every wound has resolved: healed to a scar, or an inert record with no damage left. DF never deletes a healed wound from `body.wounds`, so these dwarves carry a wound entry permanently. They are not casualties and need no care; they are counted separately rather than folded into `wounded`.
- `patients` (number) — citizens with the `needs_healthcare` flag (in the care queue).
- `bedridden` (number) — citizens flagged `should_not_move`.
- `unconscious` (number) — citizens genuinely out cold. A normally sleeping dwarf ALSO carries a positive `counters.unconscious`, so dwarves running a `Sleep` job are excluded here.
- `asleep` (number) — citizens currently running a `Sleep` job. Reported so the sleepers excluded from `unconscious` are still visible rather than silently dropped.
- `care_needs[]` — `{ care, count }` rows, most-common first. Labels: `diagnosis`, `immobilization`, `dressing`, `cleaning`, `surgery`, `suture`, `bone setting`, `traction`, `crutch`.

```json
{
  "asleep": 6,
  "bedridden": 0,
  "care_needs": [],
  "old_wounds_only": 10,
  "patients": 0,
  "population": 57,
  "unconscious": 0,
  "wounded": 0
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- **`wounded` is a current-condition count, not a wound-history count.** Before 1.4.1 it counted any unit with a non-empty `body.wounds`, which DF never prunes, so long-healed injuries read as casualties forever. That is what produced the tool's signature contradiction: `wounded: 10` next to `patients: 0` with `care_needs: []`. On Torchbristled all 10 turned out to be non-injuries — nine dwarves carrying an identical inert two-part record on the right and left lung (body parts 21/22, every damage flag false, zero bleeding/pain/swelling/strain — DF's inhaled-dust record, consistent with `chronicle`'s `battle_collapsed: 159`), plus one genuine healed `scar_cut`. Zero dwarves actually needed care, and `patients: 0` had been correct all along. The counts are now internally consistent: `wounded: 0`, `old_wounds_only: 10`.
- **A healed wound keeps a descriptive flag.** DF converts an active damage flag to its `scar_*` counterpart on healing (`cut` becomes `scar_cut`) but leaves descriptors in place, so `edged_damage`, `diagnosed`, and `flags2.entire_surface` all persist on a fully-healed scar. Treating "any flag set" as injury misclassifies every scar as an open wound; the classifier excludes those three by name and ignores anything prefixed `scar_`.
- **`unconscious` used to count sleeping dwarves.** `counters.unconscious` is nonzero for ordinary sleep, not just for being knocked out — on Torchbristled all three units reported unconscious were running a `Sleep` job, on the ground, with no wounds and no health flags. Counting sleepers would make any fort where a tenth of the dwarves nap at once look like a mass-casualty event.
- Verified live on DFHack 53.15-r2: the `rq_*` health flag set in the query is the real one (`rq_recover` does NOT exist on this build — do not reintroduce it).
- No caps/pagination: `care_needs` has at most 9 rows by construction.

## Implementation notes
A wound is judged active per-part rather than per-unit. `part_is_active` treats any nonzero `bleeding`/`pain`/`swelling`/`strain` as live, then scans `flags1` DYNAMICALLY — any true flag counts as damage unless it is prefixed `scar_` or named in a small descriptive-flag exclusion set (`edged_damage`, `diagnosed`). The dynamic scan is deliberate: hand-enumerating the ~30 damage flags would silently undercount whenever a build adds one, whereas the scar/descriptor exclusions are a short, stable list. `flags2` is the reverse — it is tiny and mostly non-damage (`entire_surface` is descriptive, `gelded` is permanent), so only `needs_setting` is allowlisted as active. Wound-level state (`severed_part`, `infection`, `stuck_weapon`, `popped_out`) and the wound's own pain/nausea/dizziness/paralysis/numbness/fever counters are checked too. `severed_part` lives on `wound.flags`, NOT on `parts[].flags1` — reading it off a part raises `Cannot read field wound_damage_flags1.severed_part`.

Sleep is detected as `unit.job.current_job.job_type == df.job_type.Sleep`. DFHack exposes no `isConscious`/`isUnconscious` helper in its Lua `dfhack.units` API (checked against the full function list on 53.15-r2), so the job check is the available discriminator.


## Related
[rooms_and_zones](rooms_and_zones.md) · [citizen](citizen.md) · [unmet_needs](unmet_needs.md) · [military](military.md)

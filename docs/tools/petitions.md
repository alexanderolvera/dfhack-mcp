---
tool: petitions
tier: sensor
gated: none
source: src/tools/petitions.ts
lua: src/dfhack-queries/mcp_petitions.lua
tags: [dfhack-mcp/tool]
---

# petitions

> **Status: draft, not yet verified against a live fort.** Field paths below follow DFHack 53.15-r2's documented structures but have not been confirmed against a running game. Needs a `verify:t1`/`verify:t2` pass and a committed golden before this ships.

## Purpose
Location petitions (a deity's worshippers or a guild asking the fort to establish a temple/guildhall) and residency/citizenship petitions (a migrant or visitor asking to join the fort) are both DF `agreement` records — and both are a classic silent-failure source: a location petition can sit agreed-to-but-never-built indefinitely, and a residency/citizenship petition has a real decision window that expires if ignored. This tool reports both kinds as facts: petitioner, agreed date, and resolution status, plus which ones are sitting in the fort's live decision queue right now (`awaiting_decision`). It is the demand-fulfillment counterpart to [rooms_and_zones](rooms_and_zones.md)'s temple/guildhall inventory: that tool's `temples.needed_by_worshippers[]` is an *inferred* need (citizens worship a deity with no dedicated temple, but no petition necessarily exists yet); a row here is an *actual* agreement DF is tracking. Compose the two — don't expect either to duplicate the other.

## Parameters
None.

## Returns
- `location_petitions[]` — one row per outstanding-or-resolved `Location`-type agreement for this fort's site (capped at 50 — see `location_petitions_truncated`):
  - `agreement_id` (number) — the agreement's own id, stable across calls.
  - `building` — `"TEMPLE"` or `"GUILDHALL"`.
  - `tier` — `1` (temple / guildhall) or `2` (temple complex / grand guildhall).
  - `petitioner` (string) — the guild or religious order's name, falling back to `"unknown"` if unresolved.
  - `deity` (string, optional) — present only for a `TEMPLE` petition that named a specific deity or religion; absent for an all-inclusive/unspecified request.
  - `guild_profession` (string, optional) — present only for a `GUILDHALL` petition; the profession the guild organizes (lowercased, e.g. `"weaver"`).
  - `agreed_year` (number) — the in-game year the petition was raised.
  - `age_days` (number) — days elapsed since `agreed_year`/tick, computed against the current game clock.
  - `warned_ready` (boolean) — true if the fort has already been told the location can be established. A row with `warned_ready: true` and `status: "outstanding"` is the silent-failure case this tool exists to catch: agreed to, ready to build, and still not zoned.
  - `awaiting_decision` (boolean) — true if this petition is currently in the fort's pending decision queue (the same queue the game's own petition-response prompt reads from).
  - `status` — `"outstanding"` (not yet resolved), `"satisfied"` (concluded/accepted), `"denied"`, or `"expired"` (see Caveats for how this is derived).
- `location_petitions_truncated` (boolean).
- `residency_petitions[]` — one row per `Residency`- or `Citizenship`-type agreement for this fort's site (capped at 50 — see `residency_petitions_truncated`):
  - `agreement_id` (number).
  - `kind` — `"Residency"` or `"Citizenship"`.
  - `petitioner` (string) — the applicant's name (a live unit's readable name when the applicant resolves to one, else the historical figure's name, else `"unknown"`).
  - `agreed_year` (number), `age_days` (number) — same meaning as above.
  - `deadline_days` (number or `null`) — days remaining before the petition's tracked timeout, clamped at 0 if already past; `null` if no timeout is tracked on this agreement.
  - `awaiting_decision` (boolean), `status` — same meaning as above.
- `residency_petitions_truncated` (boolean).
- `awaiting_decision_count` (number) — total petitions (both arrays combined) currently sitting in the decision queue — the true total, not just what fits under the caps.
- `alerts[]` — a warned-ready-but-still-outstanding location petition; a residency/citizenship petition with `deadline_days <= 7` and `status == "outstanding"`; the total awaiting-decision count when nonzero.

```json
{
  "location_petitions": [
    {
      "agreement_id": 412,
      "building": "TEMPLE",
      "tier": 1,
      "petitioner": "The Order of the Gleaming Coffer",
      "deity": "Ertal",
      "agreed_year": 250,
      "age_days": 34,
      "warned_ready": true,
      "awaiting_decision": false,
      "status": "outstanding"
    }
  ],
  "location_petitions_truncated": false,
  "residency_petitions": [
    {
      "agreement_id": 430,
      "kind": "Residency",
      "petitioner": "Zas Tosidodus",
      "agreed_year": 250,
      "age_days": 2,
      "deadline_days": 5,
      "awaiting_decision": true,
      "status": "outstanding"
    }
  ],
  "residency_petitions_truncated": false,
  "awaiting_decision_count": 1,
  "alerts": [
    "The Order of the Gleaming Coffer's temple petition is ready to establish but still outstanding (34 days)",
    "Zas Tosidodus's residency petition has 5 day(s) left to decide",
    "1 petition(s) awaiting a decision"
  ]
}
```
This example is illustrative — hand-assembled from the field-path research below, not captured from a live fixture (see the Status callout above).

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- **Unverified against a live fort — see the Status callout at the top of this page.** Every field path below is sourced from `df-structures` (tag matching DFHack 53.15/r2) and cross-checked against DFHack's own `list-agreements.lua`/`gui/petitions.lua` scripts and the community `dfremote` petition script, but none of it has been run against a real save. The `verify:t1`/`verify:t2` pass that would confirm it needs a live fort with at least one outstanding petition of each kind — worth prioritizing a fixture save that has a pending location petition, a pending residency petition, and at least one already-resolved agreement of each, since the empty-queue case (no petitions at all) proves the least about correctness.
- Both lists are scoped to agreements whose `site` field matches this fort's own site id (`plotinfo.site_id`) — `world.agreements.all` is a **world-wide** vector spanning every site's agreements, not just this fort's, so the site filter is load-bearing, not cosmetic.
- `status` is derived from the agreement's own flags, mirroring `list-agreements.lua`'s interpretation: `convicted_accepted` → `satisfied`, else `petition_not_accepted` → `denied`, else age ≥ 1 in-game year → `expired`, else `outstanding`. The `petition_not_accepted` flag's own field comment (`NOT_APPROVED`, "gets unset by accepting a petition") reads ambiguously — it may mean "actively denied" or simply "not yet decided," and this has NOT been confirmed live. Treat `denied` as the least-trusted status value until verified; `awaiting_decision` (from the live decision queue, not the flags) is the more reliable "needs an answer" signal.
- `deadline_days` comes from the Residency/Citizenship agreement's own `end_year`/`end_season_tick` fields, which read as a timeout on the offer but this has not been confirmed live either — worth an explicit live check (let a residency petition run down and see whether it actually expires at `deadline_days: 0`).
- `deity`/`guild_profession` are only ever populated for the matching `building` kind; the other is always absent, not `null` (a TEMPLE row has no `guild_profession` key at all).
- Lists capped at 50 rows each (`*_truncated` flags); `alerts[]` is uncapped but bounded by the same 50+50 rows it's built from.

## Implementation notes
Petitions are `df.global.world.agreements.all` (a world-wide vector of `agreement`), each carrying `parties[]` (an `agreement_party` with `entity_ids[]`/`histfig_ids[]`) and `details[]` (an `agreement_details`, in practice always read at index 0). `details[0].type` (`df.agreement_details_type`) selects which union branch of `details[0].data` is populated — `Location` (`agreement_subject_build_locationst`), `Residency` (`agreement_subject_become_residentst`), or `Citizenship` (`agreement_subject_become_citizenst`); every other value of that enum (`JoinParty`, `PlotAssassination`, etc. — worldgen/intrigue agreement kinds) is skipped, out of scope for this tool.

`Location.applicant`/`Residency.applicant`/`Citizenship.applicant` are `agreement_party` ids, resolved by scanning the agreement's own `parties[]` for a matching `id` (not assumed to be a fixed array index, though in practice a two-party agreement's party 0 is consistently the asker). A resolved party's name prefers `histfig_ids[0]` → that historical figure's owning unit's readable name (falling back to the historical figure's own translated name) when present — this is how an individual migrant/visitor resolves — else falls back to `entity_ids[0]`'s historical entity name, which is how a guild or religious order resolves for a Location petition.

A `TEMPLE` petition's deity comes from `Location.deity_type` (`df.religious_practice_type`: `WORSHIP_HFID` or `RELIGION_ENID`) and `Location.deity_data` (a union: `.Deity` a historical-figure id, `.Religion` a historical-entity id) — `WORSHIP_HFID` resolves directly to that historical figure's name; `RELIGION_ENID` resolves the entity, then that entity's own `relations.deities[0]` (its first deity) if it has one, else the entity's own name. This mirrors `rooms_and_zones`'s existing `deity_data.Deity` usage for temple abstract buildings, extended to also cover the `RELIGION_ENID` branch that tool's simpler needs didn't require. A `GUILDHALL` petition's `guild_profession` comes from `Location.profession` (`df.profession`), lowercased.

`age_days`/`deadline_days` convert DF's `(year, year_tick)` pairs to a day count using the same tick arithmetic as `list-agreements.lua`'s `get_petition_age` (1200 ticks/day, 28 days/month, 12 months/year = 403200 ticks/year), compared against `df.global.cur_year`/`cur_year_tick`. `deadline_days` is `null` when `end_year` reads as unset (negative).

`awaiting_decision` cross-references each agreement's id against `df.global.plotinfo.petitions` (`unapproved_agreement_id` in the raw structure) — the same live queue DF's own petition-response prompt draws from, independent of the `status`/flags derivation above.

Field paths and the overall traversal shape were taken from DFHack's own `list-agreements.lua`/`gui/petitions.lua` (github.com/DFHack/scripts) and cross-checked against `df-structures`' `df.agreement.xml`, `df.abstract_building.xml` (for `religious_practice_type`/`religious_practice_data`), and `df.d_basics.xml` (for the `religious_practice_type` enum values) at the tag matching DFHack 53.15-r2.

## Related
[rooms_and_zones](rooms_and_zones.md) (temple/guildhall inventory and the inferred `needed_by_worshippers`) · [mandates_and_justice](mandates_and_justice.md) (another noble/agreement-adjacent facts tool) · [citizen](citizen.md) · [nobles_and_administrators](nobles_and_administrators.md)

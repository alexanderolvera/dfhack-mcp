---
tool: petitions
tier: sensor
gated: none
source: src/tools/petitions.ts
lua: src/dfhack-queries/mcp_petitions.lua
tags: [dfhack-mcp/tool]
---

# petitions

> **Status: verified against a live fort (partial — see Caveats).** `verify:t1`/`verify:t2` pass against the Dreamfort fixture container (DFHack 53.15-r2) with a committed golden. The fixture's only petitions are two already-resolved `GUILDHALL` location petitions, so the `Location`/`satisfied` code path — including the site filter, petitioner-name resolution, tier/profession mapping, and the `age_days` tick arithmetic — is confirmed correct against real data. The fixture has zero `Residency`/`Citizenship` agreements and zero `TEMPLE` petitions, so those branches are shape-verified (field paths confirmed to exist and read without error via direct live probing) but not behaviorally exercised. See Caveats for the exact breakdown.

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
      "agreement_id": 1,
      "building": "GUILDHALL",
      "tier": 1,
      "petitioner": "The Guild of Leaves",
      "guild_profession": "farmer",
      "agreed_year": 6,
      "age_days": 424,
      "warned_ready": false,
      "awaiting_decision": false,
      "status": "satisfied"
    },
    {
      "agreement_id": 2,
      "building": "GUILDHALL",
      "tier": 1,
      "petitioner": "The Hall of Fortresses",
      "guild_profession": "craftsman",
      "agreed_year": 7,
      "age_days": 278,
      "warned_ready": false,
      "awaiting_decision": false,
      "status": "satisfied"
    }
  ],
  "location_petitions_truncated": false,
  "residency_petitions": [],
  "residency_petitions_truncated": false,
  "awaiting_decision_count": 0,
  "alerts": []
}
```
This is the actual output captured live from the Dreamfort fixture (`test/golden/petitions.json`) — both of the fixture's petitions are long-resolved guildhall agreements, so this example does not show a `TEMPLE`, `Residency`/`Citizenship`, `warned_ready: true`, or `awaiting_decision: true` row. See Caveats for what that does and doesn't confirm.

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- **Verified live against the Dreamfort fixture (DFHack 53.15-r2), but only partially exercised — read this before trusting a branch you haven't seen fire.** The fixture's `world.agreements.all` holds exactly 3 agreements: one `DemonicBinding` (correctly skipped, out of scope) and two already-`convicted_accepted` `GUILDHALL` location petitions. That confirmed, against real data: the site filter (`loc.site == plotinfo.site_id`), petitioner-name resolution through `entity_ids[0]` → historical entity → translated name, `building`/`tier`/`guild_profession` field mapping (`df.abstract_building_type`/`df.profession` enum reads), `warned_ready`, `flags.convicted_accepted` → `"satisfied"`, and the `age_days` tick arithmetic (hand-verified against `df.global.cur_year`/`cur_year_tick` to the exact day). It also confirmed the empty-queue path is clean: zero `Residency`/`Citizenship` agreements existed, and `residency_petitions: []` / `awaiting_decision_count: 0` / `alerts: []` came back as correctly-shaped empty arrays, not `nil` or a swallowed error, and `df.global.plotinfo.petitions` (the `awaiting_decision` queue) read as a valid zero-length vector with no error.
- **What that empty queue does NOT confirm — the top priority for the next live check against a fort with real pending petitions:** the `outstanding`/`denied`/`expired` status branches (only `satisfied` fired live — see the flag-ambiguity note below), a `TEMPLE` petition's `deity_type`/`deity_data` resolution (both `WORSHIP_HFID` and `RELIGION_ENID` branches — field names were confirmed to exist and read without error by probing them directly against the live fixture's struct instances, but never against a real deity-bearing petition), `Residency`/`Citizenship` petitions and their `deadline_days` semantics (same story: `applicant`/`site`/`end_year`/`end_season_tick` were confirmed to be real, correctly-spelled fields on the union by direct probing, but the fixture has none, so whether `end_year` actually behaves as a decision-timeout — counting down to `deadline_days: 0` — is unconfirmed), the `histfig_ids[0]`-based petitioner-name path (`unit_name`/`hf_name` — this fixture's two petitioners were both entity-only, so only the `entity_ids[0]` branch fired), `warned_ready: true`, and `awaiting_decision: true`.
- Both lists are scoped to agreements whose `site` field matches this fort's own site id (`plotinfo.site_id`) — `world.agreements.all` is a **world-wide** vector spanning every site's agreements, not just this fort's, so the site filter is load-bearing, not cosmetic. Confirmed live: the fixture's single `DemonicBinding` agreement has no `Location`/`Residency`/`Citizenship` details branch and was correctly excluded before the site filter even applied.
- `status` is derived from the agreement's own flags, mirroring `list-agreements.lua`'s interpretation: `convicted_accepted` → `satisfied` (confirmed live — both fixture petitions hit this branch), else `petition_not_accepted` → `denied`, else age ≥ 1 in-game year → `expired`, else `outstanding`. The `petition_not_accepted` flag's own field comment (`NOT_APPROVED`, "gets unset by accepting a petition") reads ambiguously — it may mean "actively denied" or simply "not yet decided," and this has NOT been confirmed live (no fixture agreement ever had that flag set). Treat `denied` as the least-trusted status value until verified against a real denied petition; `awaiting_decision` (from the live decision queue, not the flags) is the more reliable "needs an answer" signal.
- `deadline_days` comes from the Residency/Citizenship agreement's own `end_year`/`end_season_tick` fields, which read as a timeout on the offer but this has not been confirmed live — the fixture has no Residency/Citizenship agreements to exercise it against. Worth an explicit live check with a real fort (let a residency petition run down and see whether it actually expires at `deadline_days: 0`).
- `deity`/`guild_profession` are only ever populated for the matching `building` kind; the other is always absent, not `null` (a TEMPLE row has no `guild_profession` key at all) — confirmed live for the `GUILDHALL`/`guild_profession` side; the `TEMPLE`/`deity` side is untested (no TEMPLE petitions in the fixture).
- Lists capped at 50 rows each (`*_truncated` flags); `alerts[]` is uncapped but bounded by the same 50+50 rows it's built from. The fixture's 2 rows are far under the cap, so the cap/truncation logic itself is untested live (shape-verified by the `petitions_wellformed` invariant, not exercised against 51+ real rows).

## Implementation notes
Petitions are `df.global.world.agreements.all` (a world-wide vector of `agreement`), each carrying `parties[]` (an `agreement_party` with `entity_ids[]`/`histfig_ids[]`) and `details[]` (an `agreement_details`, in practice always read at index 0). `details[0].type` (`df.agreement_details_type`) selects which union branch of `details[0].data` is populated — `Location`, `Residency`, or `Citizenship`; every other value of that enum (`JoinParty`, `PlotAssassination`, etc. — worldgen/intrigue agreement kinds) is skipped, out of scope for this tool. Confirmed live: the fixture's `DemonicBinding` agreement (id 0) correctly fell through this filter untouched, and its two `Location` agreements (ids 1-2) resolved through the branch cleanly.

`Location.applicant`/`Residency.applicant`/`Citizenship.applicant` are `agreement_party` ids, resolved by scanning the agreement's own `parties[]` for a matching `id` (not assumed to be a fixed array index, though in practice a two-party agreement's party 0 is consistently the asker — confirmed for both fixture petitions). A resolved party's name prefers `histfig_ids[0]` → that historical figure's owning unit's readable name (falling back to the historical figure's own translated name) when present — this is how an individual migrant/visitor resolves, not exercised live (both fixture petitioners are guilds) — else falls back to `entity_ids[0]`'s historical entity name, which is how a guild or religious order resolves for a Location petition; this branch fired for both fixture rows and produced the correct guild names.

A `TEMPLE` petition's deity comes from `Location.deity_type` (`df.religious_practice_type`: `WORSHIP_HFID` or `RELIGION_ENID`) and `Location.deity_data` (a union: `.Deity` a historical-figure id, `.Religion` a historical-entity id) — `WORSHIP_HFID` resolves directly to that historical figure's name; `RELIGION_ENID` resolves the entity, then that entity's own `relations.deities[0]` (its first deity) if it has one, else the entity's own name. This mirrors `rooms_and_zones`'s existing `deity_data.Deity` usage for temple abstract buildings, extended to also cover the `RELIGION_ENID` branch that tool's simpler needs didn't require. Every field name here (`deity_type`, `deity_data.Deity`, `deity_data.Religion`, `relations.deities`) was confirmed to exist and read without a "field not found" error when probed directly against the fixture's own `Location` struct instances (both `GUILDHALL`, so `deity_type` read `-1`/unset as expected) — but no `TEMPLE` petition exists in the fixture, so the deity-resolution *logic* itself is unexercised. A `GUILDHALL` petition's `guild_profession` comes from `Location.profession` (`df.profession`), lowercased — confirmed live: fixture values `41`/`25` correctly mapped to `FARMER`/`CRAFTSMAN` → `"farmer"`/`"craftsman"`.

`age_days`/`deadline_days` convert DF's `(year, year_tick)` pairs to a day count using the same tick arithmetic as `list-agreements.lua`'s `get_petition_age` (1200 ticks/day, 28 days/month, 12 months/year = 403200 ticks/year), compared against `df.global.cur_year`/`cur_year_tick`. Confirmed live by hand: at `cur_year=7`/`cur_year_tick=391869`, agreement 1's `det.year=6`/`det.year_tick=285860` and agreement 2's `det.year=7`/`det.year_tick=57860` both reproduce the tool's reported `age_days` (424 and 278) to the exact day working the formula by hand. `deadline_days` is `null` when `end_year` reads as unset (negative) — the `end_year`/`end_season_tick` field names were confirmed to exist on the Residency/Citizenship union branch by direct probing, but no Residency/Citizenship agreement exists in the fixture to confirm the `null`/countdown behavior itself.

`awaiting_decision` cross-references each agreement's id against `df.global.plotinfo.petitions` (`unapproved_agreement_id` in the raw structure) — the same live queue DF's own petition-response prompt draws from, independent of the `status`/flags derivation above. Confirmed live: the field reads as a valid (empty, in this fixture) vector with no error, and both fixture petitions correctly report `awaiting_decision: false`.

Field paths and the overall traversal shape were taken from DFHack's own `list-agreements.lua`/`gui/petitions.lua` (github.com/DFHack/scripts) and cross-checked against `df-structures`' `df.agreement.xml`, `df.abstract_building.xml` (for `religious_practice_type`/`religious_practice_data`), and `df.d_basics.xml` (for the `religious_practice_type` enum values) at the tag matching DFHack 53.15-r2, then confirmed against the running Dreamfort fixture container (see Caveats for exactly which branches fired live vs. were only shape-checked).

## Related
[rooms_and_zones](rooms_and_zones.md) (temple/guildhall inventory and the inferred `needed_by_worshippers`) · [mandates_and_justice](mandates_and_justice.md) (another noble/agreement-adjacent facts tool) · [citizen](citizen.md) · [nobles_and_administrators](nobles_and_administrators.md)

---
tool: mandates_and_justice
tier: sensor
gated: none
source: src/tools/mandatesAndJustice.ts
lua: src/dfhack-queries/mcp_mandatesAndJustice.lua
tags: [dfhack-mcp/tool]
---

# mandates_and_justice

> The fort's nobility overhead as facts: active mandates, export bans, unmet noble room demands, and the state of the justice system.

## Purpose
Reports what the nobles are forcing on the fort right now — production mandates (make N of an item, with remaining count and days to deadline), export bans, guild demands, and unmet room demands (an appointed noble holds no room zone of a type their position requires) — plus the justice system: open cases, convictions awaiting punishment, and restraint capacity so it is visible whether a sentence can actually be served. An AI co-pilot calls it to see noble pressure and justice backlog as facts; the pairing "2 prison sentences pending, 0 free restraints" is the fact, "build a jail" is the caller's conclusion.

## Parameters
None.

## Returns
- `population` (number) — citizen count.
- `nobles[]` — `{ position, noble, can_mandate, can_demand }` for appointed positions that demand something of the fort.
- `mandates[]` — `{ noble, kind: "make", item, count, remaining, deadline_days }` production quotas; `deadline_days` may be `null`.
- `mandates_truncated` (boolean).
- `export_bans[]` — banned item names (strings), sorted.
- `export_bans_truncated` (boolean).
- `guild_demands[]` — `{ noble, item }` (mandate mode Guild).
- `demands[]` — unmet room demands: `{ noble, position, demand: office|bedroom|dining|tomb, required_value, met: false }`.
- `demands_truncated` (boolean).
- `justice` — `{ active, open_cases, pending_punishments, prison_sentences, scheduled_beatings, scheduled_hammerstrikes, restraints_built, restraints_free }`.
- `alerts[]` — mandate deadlines within 7 days, unmet demand count, prison sentences exceeding free restraints.

```json
{
  "alerts": [],
  "demands": [],
  "demands_truncated": false,
  "export_bans": [],
  "export_bans_truncated": false,
  "guild_demands": [],
  "justice": {
    "active": true,
    "open_cases": 0,
    "pending_punishments": 0,
    "prison_sentences": 0,
    "restraints_built": 21,
    "restraints_free": 21,
    "scheduled_beatings": 0,
    "scheduled_hammerstrikes": 0
  },
  "mandates": [],
  "mandates_truncated": false,
  "nobles": [
    {
      "can_demand": 2,
      "can_mandate": 1,
      "noble": "Zefon Zanosoddom \"Hopefulcloister\", mayor",
      "position": "mayor"
    }
  ],
  "population": 78
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- Caps: mandates 50, export bans 50, unmet demands 50 (each with a `*_truncated` flag). Justice is scalar counts only, never an itemized case list, so an old fort's payload stays flat.
- A room demand is "unmet" on room-TYPE ownership (does the mayor own an office zone?), not on the room-VALUE threshold; `required_value` is emitted as a fact but not compared.
- `scheduled_hammerstrikes` sums total strikes across punishments, while `prison_sentences` and `scheduled_beatings` count convicts — mixed units by design of the underlying fields.
- Restraint capacity counts ALL built chains + cages (a chain/cage is "free" when it has no assigned or chained unit), not only justice-designated ones.
- `open_cases` = crimes discovered but not yet sentenced.
- `deadline_days` alert threshold: unmet mandate with <= 7 days remaining. Verified on 53.15-r2: mandate_type {0=Export, 1=Make, 2=Guild}.

## Implementation notes
Justice data is read from `df.global.world.crimes.all` (open cases) and `df.global.plotinfo.punishments` (convictions awaiting punishment, each entry carrying `prison_counter`/`hammer_strikes`/`beating`). Noble room ownership is read from the noble's `unit.owned_buildings`, keeping only entries whose building type is `Civzone`, then mapping `civzone_type` to office/bedroom/dining/tomb.

`mandates`/`export_bans`/`demands` are capped at 50 even though a fort's noble overhead is normally small — an old or heavily-modded fort can't be trusted to stay small, so the caps (with their `*_truncated` flags) are a payload-size backstop, not an expected ceiling.

## Related
[rooms_and_zones](rooms_and_zones.md) · [stocks](stocks.md) · [work_order_create](work_order_create.md) · [citizen](citizen.md) · [unmet_needs](unmet_needs.md) · [nobles_and_administrators](nobles_and_administrators.md) · [petitions](petitions.md) (another `df.global.world.agreements`-adjacent facts tool, covering location/residency/citizenship petitions rather than mandates)

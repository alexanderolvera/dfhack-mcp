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
Counts the citizens who are wounded (any body wounds), queued for healthcare (patients), bedridden (should-not-move), and unconscious, and breaks down the outstanding care requests (diagnosis, surgery, suture, dressing, ...) so gaps in medical coverage — a missing diagnostician, surgeon, or supplies — are visible as facts. An AI co-pilot calls it after combat, accidents, or when checking whether the hospital pipeline is keeping up. It reports the demand side of medicine; the hospital's supply side lives in `rooms_and_zones`.

## Parameters
None.

## Returns
- `population` (number) — citizen count.
- `wounded` (number) — citizens with at least one body wound.
- `patients` (number) — citizens with the `needs_healthcare` flag (in the care queue).
- `bedridden` (number) — citizens flagged `should_not_move`.
- `unconscious` (number) — citizens with a positive unconscious counter.
- `care_needs[]` — `{ care, count }` rows, most-common first. Labels: `diagnosis`, `immobilization`, `dressing`, `cleaning`, `surgery`, `suture`, `bone setting`, `traction`, `crutch`.
- `alerts[]` — factual restatements: any patients at all; a mass-unconsciousness event; the top care need.

```json
{
  "alerts": ["8 dwarves unconscious (10% of pop)"],
  "bedridden": 0,
  "care_needs": [],
  "patients": 0,
  "population": 78,
  "unconscious": 8,
  "wounded": 16
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- `patients > 0` always alerts (a doctor-requiring event does not scale with population); the unconscious alert requires BOTH >=10% of population AND >=3 out cold, so sparring KOs and naps on a small fort don't fire it.
- `wounded` counts any recorded wound, including healed-over scars-in-progress — expect it to exceed `patients` (golden: 16 wounded, 0 patients).
- Verified live on DFHack 53.15-r2: the `rq_*` health flag set in the query is the real one (`rq_recover` does NOT exist on this build; a code comment warns against reintroducing it).
- No caps/pagination: `care_needs` has at most 9 rows by construction.

## Related
[rooms_and_zones](rooms_and_zones.md) · [citizen](citizen.md) · [unmet_needs](unmet_needs.md) · [military](military.md)

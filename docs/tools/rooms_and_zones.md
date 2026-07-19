---
tool: rooms_and_zones
tier: sensor
gated: none
source: src/tools/roomsAndZones.ts
lua: src/dfhack-queries/mcp_roomsAndZones.lua
tags: [dfhack-mcp/tool]
---

# rooms_and_zones

> The fort's facility inventory, each count paired with its demand-side number where one exists.

## Purpose
Reports what the fort has built: bedrooms (assigned/unassigned vs. adults without one), dining halls and seats, the hospital (beds, traction benches, well-in-zone, and medical supplies physically stocked), wells with working state and water source, temples vs. the deities citizens actually worship, taverns, libraries, guildhalls, and coffin capacity vs. dead awaiting burial. It is the supply-side companion to `unmet_needs`: that says WHO is unfulfilled, this says WHAT exists for them. Reports what the fort has, not what to build.

## Parameters
None.

## Returns
- `bedrooms` — `{ assigned, unassigned, adults_without, dormitories }` (dormitories are communal and counted separately from private bedrooms).
- `dining` — `{ halls, seats }` (seats = chairs inside dining-hall zones).
- `hospital` — `{ zoned }`; when zoned also `beds`, `traction_benches`, `well_in_hospital`, and `supplies { thread, cloth, splints, crutches }` where thread/cloth are levels `none | low | ok` (low = 1-4) and splints/crutches are counts.
- `wells[]` — `{ z, working, source }`; `source` is `water | frozen | magma | unknown` from a fog-of-war-safe downward scan.
- `wells_total` (number), `wells_truncated` (boolean).
- `temples` — `{ dedicated[], all_inclusive, needed_by_worshippers[] }` (deity names; an all-inclusive temple satisfies every worshipper).
- `taverns`, `libraries`, `guildhalls` (numbers).
- `coffins_free`, `coffins_used` (numbers) — occupancy by contained corpse/body items.
- `dead_unburied` (number) — loose corpses of the fort's own race, not interred, not marked for dumping.
- `alerts[]` — adults without a bedroom; dead exceeding free coffins; worshipped deities lacking a temple.

```json
{
  "alerts": [],
  "bedrooms": { "adults_without": 0, "assigned": 78, "dormitories": 1, "unassigned": 53 },
  "coffins_free": 38,
  "coffins_used": 1,
  "dead_unburied": 0,
  "dining": { "halls": 4, "seats": 36 },
  "guildhalls": 3,
  "hospital": {
    "beds": 8,
    "supplies": { "cloth": "ok", "crutches": 5, "splints": 5, "thread": "ok" },
    "traction_benches": 2,
    "well_in_hospital": true,
    "zoned": true
  },
  "libraries": 1,
  "taverns": 1,
  "temples": { "all_inclusive": true, "dedicated": ["Ertal", "Thocit"], "needed_by_worshippers": [] },
  "wells": [
    { "source": "water", "working": true, "z": 124 }
  ],
  "wells_total": 6,
  "wells_truncated": false
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- Wells capped at 20 (`wells_truncated` flags overflow); bedrooms and coffins are aggregated to counts, never itemized.
- `adults_without = max(0, adults - assigned_bedrooms)`; note assigned bedrooms can exceed adults (a dwarf may own multiple rooms), and the golden shows `assigned: 78` against 77 adults.
- Well `source` scans downward up to 40 z-levels and stops at the first hidden tile (fog of war stays honest — reports `unknown` rather than peering below).
- Hospital supplies count items physically inside the hospital zone footprint, resolved THROUGH containers (thread/cloth in a coffer count); it is a fact, not a target.
- Hospital detail fields (`beds`, `supplies`, ...) are absent when `zoned: false`; `supplies` is also absent when the hospital location has no matching civzone.
- A deity "needs" a temple at >= 1 worshipper and no dedicated temple, unless an all-inclusive temple exists.
- Verified live on 53.15-r2 (fort Bustlanterns).

## Related
[unmet_needs](unmet_needs.md) · [injuries_and_health](injuries_and_health.md) · [mandates_and_justice](mandates_and_justice.md) · [citizen](citizen.md) · [fort_status](fort_status.md)

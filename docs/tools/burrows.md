---
tool: burrows
tier: sensor
gated: none
source: src/tools/burrows.ts
lua: src/dfhack-queries/mcp_burrows.lua
tags: [dfhack-mcp/tool]
---

# burrows

> The fort's burrows as facts, plus the civilian-alert safety-burrow set — the deferred "fort alarms" item, now unblocked.

## Purpose
Burrows are DF's mechanism for confining citizens/animals to a region and, combined with the civilian alert, for herding everyone to safety during a siege. This tool reports every burrow's size and membership, and whether it's currently one of the alert's safety burrows — the read half of the `civilian_alert` actuator. An AI co-pilot calls it before sounding the alarm (to name a real burrow) and after (to confirm it stuck).

## Parameters
None.

## Returns
- `count` (number) — burrows defined in the fort.
- `burrows[]` — `{ id, name, tile_count, assigned_units, assigned_units_total, assigned_units_truncated, civilian_alert_linked }` per burrow, id-sorted.
  - `tile_count` — the exact painted area (`dfhack.burrows.isAssignedBlockTile` summed over every assigned block), not a bounding box.
  - `assigned_units[]` — citizens/animals manually confined to the burrow (id-sorted, capped at 200); `assigned_units_total` is always the full count, `assigned_units_truncated` flags when the list is capped.
  - `civilian_alert_linked` — whether this burrow is currently one of the civilian alert's safety burrows.
- `civilian_alert` — `{ configured, active, burrows }`. `configured` is whether the fort has ever set up the civilian-alert slot (false on a fresh fort — this sensor never creates it). `active` is whether the alarm is sounding right now. `burrows[]` is the linked burrow ids.

```json
{
  "count": 2,
  "burrows": [
    { "id": 0, "name": "Inside+", "tile_count": 24367, "assigned_units": [], "assigned_units_total": 0, "assigned_units_truncated": false, "civilian_alert_linked": true },
    { "id": 1, "name": "Clearcutting area", "tile_count": 1668, "assigned_units": [], "assigned_units_total": 0, "assigned_units_truncated": false, "civilian_alert_linked": false }
  ],
  "civilian_alert": { "configured": true, "active": false, "burrows": [0] }
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- `assigned_units` is manual confinement membership, not "everyone currently standing inside the burrow's painted tiles" — most burrows (like a whole-fort "Inside+" safety burrow) have zero explicit assignments and rely on the civilian alert's automatic flee behavior instead.
- The civilian-alert slot is always `alerts.list[1]` by DFHack's own convention (`gui/civ-alert.lua`'s `get_civ_alert()`) — `list[0]` is the built-in "No alert". This sensor reads that exact slot so it always agrees with the in-game Squads panel's alert button; it never creates the slot (that's `civilian_alert`'s job, only on apply).
- No cap on the burrows list itself (fort burrow counts are small in practice); only each burrow's `assigned_units[]` is capped.

## Implementation notes
Tile counting loops every block `dfhack.burrows.listBlocks(b)` returns and checks each of its 256 tiles with `dfhack.burrows.isAssignedBlockTile(b, block, x, y)` — proven live on a 205-block burrow (24,367 tiles) with no timeout. Confirmed live on DFHack 53.15-r2 against the Dreamfort fixture: 2 burrows, one ("Inside+") already linked to a pre-configured civilian alert.

## Related
[civilian_alert](civilian_alert.md) — toggle a burrow in/out of the civilian alert. [military](military.md) · [threats](threats.md) · [mechanisms](mechanisms.md)

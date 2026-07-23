---
tool: military
tier: sensor
gated: none
source: src/tools/military.ts
lua: src/dfhack-queries/mcp_military.lua
tags: [dfhack-mcp/tool]
---

# military

> The fort's military: squads, readiness against hostiles on the map, and — per squad — the roster's actual equipment gaps, ammo, and active training order.

## Purpose
Reports the fort's fighting strength and reads it against what is actually on the map. Two deliberately different counts: `soldiers` is living, present citizens actually in a squad, while `assigned_positions` is filled squad slots — a slot can still hold a member who is dead or off-map, and the gap between the two numbers is the point. Hostile counts use the same predicate as `threats` (great-danger creatures split out). Each squad also carries `roster[]`, `ammo`, and `training` — the tool-API spec's originally-promised `equipment_gaps` ("you have 21 soldiers" vs. "8 of them have no armor"), previously unfulfilled. An AI co-pilot calls it when assessing defense readiness, after `threats` reports contacts, or before a siege to confirm the squad is actually equipped.

## Parameters
None.

## Returns
- `squad_count` (number) — squads belonging to the fortress entity.
- `soldiers` (number) — living, present adult citizens with a squad assignment.
- `assigned_positions` (number) — filled squad slots (may exceed `soldiers`).
- `adults` (number) — adult citizens.
- `hostiles_on_map` (number) — active, living, dangerous non-citizens not caged/chained.
- `great_danger_on_map` (number) — the subset DFHack flags as great danger.
- `squads[]` — `{ name, filled, positions, roster, ammo, training }` per squad (translated name, falling back to alias, then "Squad N").
  - `roster[]` — one row per FILLED position: `{ unit_id, name, uniform, uniform_complete }`. `uniform[]` is `{ item_type, assigned_count, missing_count }`, aggregated by item type (`ARMOR`/`HELM`/`PANTS`/`GLOVES`/`SHOES`/`SHIELD`/`WEAPON`/...) — `assigned_count` is how many items the uniform calls for, `missing_count` is how many of those are not currently worn/wielded (DF's own `uniform-unstick` logic). `uniform_complete` is true iff every `missing_count` is zero. Vacant positions are omitted (already covered by `filled`/`positions`).
  - `ammo` — `{ specs, ammo_items_assigned }`. `specs[]` is `{ item_type, target_amount, assigned_count }`, the squad's configured ammunition (empty for a melee-only squad). `ammo_items_assigned` is the total ammo items currently carried by the squad.
  - `training` — `{ cur_routine_idx, month, sleep_mode?, uniform_mode?, active_orders }`, the active training-schedule month's settings. `sleep_mode`/`uniform_mode`/`active_orders` are absent/empty when the fort has never customized that routine's month (the common case).
- `alerts[]` — "no military squads — the fort is undefended"; a NO-defenders callout when a great-danger creature faces zero soldiers; an incomplete-uniform callout per roster member.

```json
{
  "squad_count": 2,
  "soldiers": 9,
  "assigned_positions": 9,
  "squads": [
    {
      "name": "The Waxy Tomes", "filled": 4, "positions": 10,
      "roster": [
        {
          "unit_id": 111, "name": "Tun Lolumavuz \"Woodenmines\", militia commander",
          "uniform": [
            { "item_type": "ARMOR", "assigned_count": 1, "missing_count": 0 },
            { "item_type": "SHIELD", "assigned_count": 1, "missing_count": 0 }
          ],
          "uniform_complete": true
        }
      ],
      "ammo": { "specs": [], "ammo_items_assigned": 0 },
      "training": { "cur_routine_idx": 2, "month": 11, "sleep_mode": "AnywhereAtWill", "uniform_mode": "Regular", "active_orders": [] }
    },
    {
      "name": "The Torrid Portals", "filled": 5, "positions": 10,
      "ammo": { "specs": [{ "item_type": "AMMO", "target_amount": 250, "assigned_count": 129 }], "ammo_items_assigned": 113 }
    }
  ],
  "alerts": []
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- Caged/chained hostiles are excluded from `hostiles_on_map` (same predicate as `threats`), so a full zoo of caged goblins reads as zero threat.
- `assigned_positions` can overstate strength (dead/off-map members still fill slots); lead with `soldiers`.
- No caps: squad/position/uniform-slot counts are small in practice (DF's own squad-size limit bounds `roster[]`).
- `squad_position.occupant` is a **historical figure id**, resolved to a live unit via `historical_figure.unit_id` — a position holder currently off-map or dead still counts toward `filled` but is omitted from `roster[]` if no live unit resolves.
- `missing_count` counts two distinct shortages the same way: an item assigned to the uniform but not currently worn/wielded (a soldier mid-equip reads as missing until they physically pick it up and equip it), and a required uniform spec with NOTHING assigned yet (no suitable item found at all). Both read as "missing" — the tool doesn't distinguish "en route" from "nothing to route."
- Reports facts; no stationing or tactical advice.

## Related
[threats](threats.md) · [defenses](defenses.md) · [mechanisms](mechanisms.md) · [citizen](citizen.md) · [injuries_and_health](injuries_and_health.md)

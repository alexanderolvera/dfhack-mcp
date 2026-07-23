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
  - `roster[]` — one row per FILLED position **whose occupant is a living, present unit** (see Caveats): `{ unit_id, name, uniform, uniform_complete }`. `uniform_complete` is true iff nothing is missing. `uniform[]` is empty when `uniform_complete` is true — populated ONLY when there's a gap, aggregated by item type (`ARMOR`/`HELM`/`PANTS`/`GLOVES`/`SHOES`/`SHIELD`/`WEAPON`/...) as `{ item_type, assigned_count, missing_count }`: `assigned_count` is how many items the uniform calls for (a required-but-never-found item still counts as 1, so it's never less than `missing_count`), `missing_count` is how many of those are not currently worn/wielded (DF's own `uniform-unstick` logic) or were never found/assigned at all.
  - `ammo` — `{ specs, ammo_items_assigned }`. `specs[]` is `{ item_type, target_amount, assigned_count }` — `target_amount` is the squad's shared configured total (e.g. 250 bolts for the whole squad), **not per soldier**. `assigned_count` is the currently-assigned amount, and `ammo_items_assigned` is the total ammo items currently carried by the squad (empty/zero for a melee-only squad).
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
          "uniform": [],
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

A roster row with a gap (illustrative, not a live capture — the fixture's soldiers are all fully equipped):
```json
{
  "unit_id": 485, "name": "Likot Oshoshnish \"Hermittrades\", Marksdwarf",
  "uniform": [
    { "item_type": "ARMOR", "assigned_count": 1, "missing_count": 1 },
    { "item_type": "SHIELD", "assigned_count": 1, "missing_count": 0 }
  ],
  "uniform_complete": false
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- Caged/chained hostiles are excluded from `hostiles_on_map` (same predicate as `threats`), so a full zoo of caged goblins reads as zero threat.
- `assigned_positions` can overstate strength (dead/off-map members still fill slots); lead with `soldiers`.
- No caps: squad/position/uniform-slot counts are small in practice (DF's own squad-size limit bounds `roster[]`); `uniform[]` is additionally kept empty for any fully-equipped soldier, so payload size tracks actual gaps, not fort size.
- `squad_position.occupant` is a **historical figure id**, resolved to a live unit via `historical_figure.unit_id` — a position holder currently off-map or dead still counts toward `filled` but is excluded from `roster[]` (a dead soldier's gear sitting on their corpse would otherwise read as a false "incomplete uniform" alert).
- `missing_count` counts two distinct shortages the same way: an item assigned to the uniform but not currently worn/wielded (a soldier mid-equip reads as missing until they physically pick it up and equip it), and a required uniform spec with NOTHING assigned yet (no suitable item found at all — counted as 1 assigned, 1 missing, so `missing_count` never exceeds `assigned_count`). Both read as "missing" — the tool doesn't distinguish "en route" from "nothing to route."
- Reports facts; no stationing or tactical advice.

## Implementation notes
`squad_position.occupant` is a historical figure id, not a unit id — resolved via `df.historical_figure.find(occupant).unit_id` then `df.unit.find(...)`, filtered through `dfhack.units.isActive`/`isDead` before being treated as "present" for uniform purposes. `pos.equipment.uniform` is doubly-nested (slot → spec[]), flattened into one `uniform[]` row per distinct item type by aggregating assigned/missing counts across every spec of that type (a position can have more than one spec per type, e.g. two GLOVES specs); each `squad_uniform_spec` carries no explicit required-quantity field, so a spec with zero `.assigned` items (nothing found/allocated yet) is counted as one required-and-missing piece rather than being invisible to the tally. Training orders live at `sq.schedule.routine[cur_routine_idx].month[current_month].orders[i]` — each entry is a `squad_schedule_order` WRAPPER (`{order, min_count, positions}`), not the polymorphic `squad_order` itself; the type name comes from `.order:getType()`, confirmed live (indexing the enum with the wrapper directly silently resolves to `nil`, which is why a naive read makes `active_orders` look permanently empty). Confirmed live on DFHack 53.15-r2 against the Dreamfort fixture: all sampled squads' default schedule carries a real `TRAIN` order for the current month, and `squad_ammo_spec.amount` (250 in the fixture) is shared across the whole squad's ammo assignment (113/129 items actually carried/assigned against that one target), not per soldier.

## Related
[threats](threats.md) · [defenses](defenses.md) · [mechanisms](mechanisms.md) · [citizen](citizen.md) · [injuries_and_health](injuries_and_health.md)

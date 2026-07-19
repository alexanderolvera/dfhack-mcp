---
tool: military
tier: sensor
gated: none
source: src/tools/military.ts
lua: src/dfhack-queries/mcp_military.lua
tags: [dfhack-mcp/tool]
---

# military

> The fort's military: number of squads, how many living present dwarves are actually enlisted, filled squad positions, and readiness read against hostiles currently on the map.

## Purpose
Reports the fort's fighting strength and reads it against what is actually on the map. Two deliberately different counts: `soldiers` is living, present citizens actually in a squad, while `assigned_positions` is filled squad slots — a slot can still hold a member who is dead or off-map, and the gap between the two numbers is the point. Hostile counts use the same predicate as `threats` (great-danger creatures split out). An AI co-pilot calls it when assessing defense readiness or after `threats` reports contacts.

## Parameters
None.

## Returns
- `squad_count` (number) — squads belonging to the fortress entity.
- `soldiers` (number) — living, present adult citizens with a squad assignment.
- `assigned_positions` (number) — filled squad slots (may exceed `soldiers`).
- `adults` (number) — adult citizens.
- `hostiles_on_map` (number) — active, living, dangerous non-citizens not caged/chained.
- `great_danger_on_map` (number) — the subset DFHack flags as great danger.
- `squads[]` — `{ name, filled, positions }` per squad (translated name, falling back to alias, then "Squad N").
- `alerts[]` — "no military squads — the fort is undefended"; hostile-vs-soldier readiness lines, with a NO-defenders callout when a great-danger creature faces zero soldiers.

```json
{
  "adults": 77,
  "alerts": ["5 hostiles on map vs 13 soldiers in 3 squads"],
  "assigned_positions": 13,
  "great_danger_on_map": 5,
  "hostiles_on_map": 5,
  "soldiers": 13,
  "squad_count": 3,
  "squads": [
    { "filled": 4, "name": "The Waxy Tomes", "positions": 10 },
    { "filled": 5, "name": "The Torrid Portals", "positions": 10 },
    { "filled": 4, "name": "The Mischief of Basements", "positions": 10 }
  ]
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- Caged/chained hostiles are excluded from `hostiles_on_map` (same predicate as `threats`), so a full zoo of caged goblins reads as zero threat.
- `assigned_positions` can overstate strength (dead/off-map members still fill slots); lead with `soldiers`.
- No caps: squads list is uncapped (fort squad counts are small in practice).
- Reports facts about readiness; no training/equipment detail and no stationing advice.

## Related
[threats](threats.md) · [defenses](defenses.md) · [citizen](citizen.md) · [injuries_and_health](injuries_and_health.md)

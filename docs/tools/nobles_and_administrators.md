---
tool: nobles_and_administrators
tier: sensor
gated: none
source: src/tools/noblesAndAdministrators.ts
lua: src/dfhack-queries/mcp_noblesAndAdministrators.lua
tags: [dfhack-mcp/tool]
---

# nobles_and_administrators

> The fort's appointed positions as facts: who holds each one, or that it's vacant.

## Purpose
"Why won't my work order validate / why can't I trade / why no diagnoses?" is almost always a vacant position, and until now nothing sensed it. Reports every position the fort's entity currently defines — manager, bookkeeper, broker, chief medical dwarf, sheriff, captain of the guard, expedition leader/mayor, militia commander/captain, hammerer, dungeon master, messenger, champion, and any higher noble (baron+) the site has grown into — with its holder(s) or vacancy. Also reports the bookkeeper's precision setting, whether a mayoral election is pending, and whether the civilization's monarch has arrived. An AI co-pilot calls it before relying on `work_order_create` (needs a manager), `trade` (needs a broker), or a justice punishment (needs a hammerer), and to explain an unexpected-looking vacancy via `superseded_by`.

## Parameters
None.

## Returns
- `positions[]` — one row per entity position: `{ code, name, vacant, holders[], superseded_by? }`.
  - `code` — the position's stable raw token (e.g. `"MANAGER"`, `"BOOKKEEPER"`).
  - `name` — the position's display name (e.g. `"manager"`); falls back to `code` if unset.
  - `vacant` — true iff `holders` is empty.
  - `holders[]` — `{ unit_id, name }` for each dwarf assigned to the position. Almost always 0 or 1 entries; some positions (e.g. `MILITIA_CAPTAIN`) can have more than one filled slot in a fort with multiple squads.
  - `superseded_by` (optional) — the position `code` this role's responsibilities move to once that position is filled (e.g. `SHERIFF` → `CAPTAIN_OF_THE_GUARD`, `EXPEDITION_LEADER` → `MAYOR`). A vacancy here is expected once the successor position is filled, not a problem.
- `bookkeeper_precision_level` (number, 0-4) — the bookkeeper's stock-count precision, set on the Nobles screen; higher is more accurate but needs a better-equipped, more skilled bookkeeper.
- `mayor_election_pending` (boolean) — a mayoral election is currently forced/pending.
- `monarch` — `{ arrived, hasty }`: whether the civilization's monarch has arrived at the site, and if so, whether hastily.

```json
{
  "bookkeeper_precision_level": 4,
  "mayor_election_pending": false,
  "monarch": { "arrived": false, "hasty": false },
  "positions": [
    {
      "code": "BOOKKEEPER",
      "name": "bookkeeper",
      "vacant": false,
      "holders": [{ "unit_id": 421, "name": "Ingish Lorbambecor \"Standardtempted\", bookkeeper" }]
    },
    {
      "code": "SHERIFF",
      "name": "sheriff",
      "vacant": true,
      "holders": [],
      "superseded_by": "CAPTAIN_OF_THE_GUARD"
    }
  ]
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- `positions[]` lists only positions the fort's entity currently *defines* — a small early fort has no `BARON`+ row at all; one appears once the site's rank grows into it. No client-side filtering or hardcoded subset: whatever `ent.positions.own` reports, this reports.
- `MESSENGER` and similar externally-filled positions may show `vacant: true` even though the role is functionally served from outside the fort's own roster — the fort's local assignment list is genuinely empty for them.
- `bookkeeper_precision_level` is the raw `bookkeeper_settings` field (confirmed live, 0-4 matching the Nobles-screen control); a separate `bookkeeper_precision` field exists on the same struct but its semantics couldn't be confirmed live (a large tick-like value, not obviously the setting) and is deliberately not exposed.

## Implementation notes
Positions come from `df.global.plotinfo.main.fortress_entity.positions.own`; holders from `.positions.assignments`, matched by `position_id` and resolved `histfig -> unit` the same way `mandates_and_justice` resolves noble names. `superseded_by` is `pos.replaced_by` (a position id, not a histfig — confirmed live: it points at another entry in the same `positions.own` list, not an inbound successor). `bookkeeper_precision_level`, `mayor_election_pending` (`plotinfo.flags.force_elections`), and `monarch` (`plotinfo.king_arrived`/`king_hasty`) are read directly off `df.global.plotinfo`. All confirmed live on DFHack 53.15-r2 against the Dreamfort fixture.

## Related
[mandates_and_justice](mandates_and_justice.md) · [work_order_create](work_order_create.md) · [trade](trade.md) · [citizen](citizen.md)

---
tool: mechanisms
tier: sensor
gated: none
source: src/tools/mechanisms.ts
lua: src/dfhack-queries/mcp_mechanisms.lua
tags: [dfhack-mcp/tool]
---

# mechanisms

> The fort's lever/pressure-plate wiring as facts — players routinely forget which lever raises which bridge; an AI co-pilot literally cannot know it without this.

## Purpose
Completes the emergency-response trio with `civilian_alert` and the nearest-drawbridge geometry `defenses` already reports. Reports every lever's position, state, and linked target(s); every pressure plate's linked target(s) and trigger conditions; and which levers/bridges are wired to nothing. An AI co-pilot calls it before `pull_lever` to name the right lever, and to spot a defensive bridge with no lever at all.

## Parameters
None.

## Returns
- `lever_count`, `levers[]` — `{ building_id, name, pos, state, linked_targets, pending_pull_jobs }` per lever, id-sorted.
  - `state` — the lever's own physical orientation, 0 or 1 (NOT which way any linked gate is).
  - `linked_targets[]` — `{ building_id, type, pos, state? }`, one per building the lever's mechanism items connect to (bridge/door/floodgate/hatch/support/weapon-trap). `state` (when the target exposes gate flags) is `raised`/`raising`/`lowering` for a Bridge, `closed`/`closing`/`opening` for a Floodgate/Hatch, `retracted`/`retracting`/`unretracting` for a Weapon spike.
  - `pending_pull_jobs[]` — `{ id, do_now, repeating, suspended }`, PullLever jobs already queued on this lever.
- `plate_count`, `pressure_plates[]` — `{ building_id, name, pos, linked_targets, triggers }` per pressure plate, id-sorted. `triggers` is the configured trip conditions: `citizens` (bool), `creatures` (bool) with `creature_weight_min`/`max`, `minecart_track` (bool) with `minecart_weight_min`/`max`, `water`/`magma` (bool) each with a `_depth_min`/`_depth_max` range.
- `unlinked_levers[]` — building ids of levers wired to nothing (dead ends).
- `bridge_count`, `unlinked_bridges[]` — building ids of bridges no lever or plate in the fort currently operates.

```json
{
  "lever_count": 9,
  "levers": [
    {
      "building_id": 359, "name": "Cistern drain", "pos": { "x": 82, "y": 52, "z": 121 },
      "state": 0, "pending_pull_jobs": [],
      "linked_targets": [
        { "building_id": 360, "type": "Floodgate", "pos": { "x": 65, "y": 39, "z": 121 }, "state": "closed" }
      ]
    }
  ],
  "plate_count": 0,
  "pressure_plates": [],
  "unlinked_levers": [],
  "bridge_count": 8,
  "unlinked_bridges": []
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- No caps: lever/plate/bridge counts are small in practice (fort mechanism counts rarely reach the dozens).
- `state` on a linked target is best-effort — only buildings that expose `gate_flags` report it (wrapped in `pcall`); a Support or an unusual target type reports no `state`.
- A lever/plate can have zero, one, or multiple `linked_targets` (multiple mechanisms can be installed on one trap); `unlinked_levers` is exactly the levers with an empty list.

## Implementation notes
Target resolution mirrors DFHack's own `lever.lua` `leverDescribe()`: for each item in `trap.linked_mechanisms`, `dfhack.items.getGeneralRef(m, df.general_ref_type.BUILDING_HOLDER):getBuilding()` resolves the target; gate-flag field names differ per target building type (Bridge uses `raised`/`raising`/`lowering`, Weapon uses `retracted`/`retracting`/`unretracting`, everything else uses `closed`/`closing`/`opening`) — the same `flag_names`-keyed-by-type table `lever.lua` uses. `unlinked_bridges` is computed by set-differencing every bridge's building id against the union of every lever/plate's resolved target ids. Confirmed live on DFHack 53.15-r2 against the Dreamfort fixture: 9 named levers (e.g. "Barracks gate", "Trade depot gate"), each linked to exactly one bridge or the cistern floodgate, all 8 bridges linked, zero unlinked levers/bridges — the fixture has no pressure plates, so that path is verified by code inspection (the same struct/field pattern as levers, and DFHack's own `machine-toggle.lua` overlay) rather than a live positive example.

## Related
[pull_lever](pull_lever.md) — queue a pull job on a named lever. [defenses](defenses.md) · [civilian_alert](civilian_alert.md) · [burrows](burrows.md)

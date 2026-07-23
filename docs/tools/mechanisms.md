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
  - `linked_targets[]` — `{ building_id, type, pos, state? }`, one per building the lever's mechanism items connect to (bridge/door/floodgate/hatch/support/weapon-trap). `state`: `raised`/`lowered`/`raising`/`lowering` for a Bridge, `closed`/`open`/`closing`/`opening` for a Floodgate, `closed`/`open` (no transitional state) for a Door/Hatch, `retracted`/`unretracted`/`retracting`/`unretracting` for a Weapon spike; absent for a target exposing neither `gate_flags` nor `door_flags` (e.g. Support).
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
- `state` on a linked target is best-effort — only buildings that expose `gate_flags` or `door_flags` report it (wrapped in `pcall`); a Support or an unusual target type reports no `state`.
- A lever/plate can have zero, one, or multiple `linked_targets` (multiple mechanisms can be installed on one trap); `unlinked_levers` is exactly the levers with an empty list.

## Implementation notes
Target resolution mirrors DFHack's own `lever.lua` `leverDescribe()`: for each item in `trap.linked_mechanisms`, `dfhack.items.getGeneralRef(m, df.general_ref_type.BUILDING_HOLDER):getBuilding()` resolves the target. Confirmed live which building types expose which flag struct and what their fields actually are (not just guessed from `lever.lua`'s display-label table): Bridge/Floodgate/Weapon expose `gate_flags`, which carries a REAL stable-state bit (`raised` for Bridge, `closed` for Floodgate) in addition to the two transitional bits (`raising`/`lowering` etc.) — read all three, not only the transitional pair, or a stable lowered/open target silently reports the closed/raised label. Door/Hatch expose `door_flags` instead, a plain `{closed: bool, ...}` with no transitional state. `unlinked_bridges` is computed by set-differencing every bridge's building id against the union of every lever/plate's resolved target ids. Confirmed live on DFHack 53.15-r2 against the Dreamfort fixture: 9 named levers (e.g. "Barracks gate", "Trade depot gate"), each linked to exactly one bridge or the cistern floodgate, all 8 bridges linked, zero unlinked levers/bridges — the `gate_flags` path (Bridge/Floodgate) is exercised end to end this way. The committed fixture has no pressure plates and no lever/plate linked to a Door, Hatch, or Weapon spike. The `pressure_plates[]` path (including `plate_info` trigger fields and `linked_targets`) was verified live end to end by constructing a real PressurePlate (`dfhack.buildings.constructBuilding`) and a mechanism item (`dfhack.items.createItem` + a `general_ref_building_holderst` pointing at an existing bridge) directly against the running container — not part of the committed golden fixture (that would require modifying the versioned Dreamfort save/Dockerfile, out of scope here), but it did exercise the real code path with real struct data and confirmed correct output. The Door/Hatch `state` path is verified by directly probing the live struct fields on the fixture's (unlinked) doors and hatches — confirming `door_flags.closed` is real and `gate_flags` is genuinely absent on those types — plus code inspection, since the fixture has no lever/plate actually linked to one. The Weapon-spike path (no weapon traps in the fixture) is code inspection only, by analogy with the confirmed Bridge/Floodgate `gate_flags` pattern.

## Related
[pull_lever](pull_lever.md) — queue a pull job on a named lever. [defenses](defenses.md) · [civilian_alert](civilian_alert.md) · [burrows](burrows.md)

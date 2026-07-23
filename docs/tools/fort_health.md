---
tool: fort_health
tier: sensor
gated: none
source: src/tools/fortHealth.ts
lua: src/dfhack-queries/mcp_fortHealth.lua
tags: [dfhack-mcp/tool]
---

# fort_health

> **Status: draft, not yet verified against a live fort.** Field paths below follow DFHack 53.15-r2's documented structures but have not been confirmed against a running game. Needs a `verify:t1`/`verify:t2` pass and a committed golden before this ships.

> The fort's computational health as facts: FPS/GFPS, item clutter by category, and unit counts.

## Purpose
FPS death is the true endgame boss of Dwarf Fortress, and nothing in this server reported the fort's computational health before this tool. `fort_health` gives an AI co-pilot the raw facts to notice a fort trending toward simulation collapse — the engine's own current frame rates, how many item objects DF is tracking (broken out by the classic clutter candidates: stone, corpses, clothes), and how many units are being simulated (alive vs. dead-but-not-yet-cleaned-up). Judgment about what to do with that ("dump the corpses," "atom-smash the stone") stays with the caller — this tool only reports what is true.

## Parameters
None.

## Returns
- `fps` (number), `gfps` (number) — the engine's currently calculated simulation and graphics frame rates (`df.global.enabler.calculated_fps` / `calculated_gfps`), the same numbers DF's own status bar shows. A single instantaneous reading, not an average or history.
- `items.total` (number) — the fort-wide item-object count (`df.global.world.items.all`, length). Unfiltered — every item DF currently has allocated counts, including forbidden/dumped/in-construction/trader-bound ones, because it's raw object count (not usable stock) that costs simulation time.
- `items.stone` / `items.corpses` / `items.clothes` (number) — the three clutter candidates the issue names, each a subset of `items.total`:
  - `stone` — item type `BOULDER`.
  - `corpses` — item types `CORPSE` + `CORPSEPIECE` + `REMAINS`.
  - `clothes` — the wearable-slot item types `ARMOR` + `SHOES` + `HELM` + `GLOVES` + `PANTS`.
- `units.active` (number) — units in `df.global.world.units.active` that are currently simulated and alive (`dfhack.units.isActive(u)` true, `dfhack.units.isDead(u)` false). Includes citizens, tame animals, wildlife, hostiles, and visitors — everything costing simulation time, not just the fort's own civ.
- `units.dead_on_map` (number) — the same vector's units that are `isActive` but `isDead`: a corpse still represented as a unit record (hasn't yet converted into a `CORPSE`/`CORPSEPIECE` item).

```json
{
  "fps": 47,
  "gfps": 47,
  "items": {
    "total": 18342,
    "stone": 2110,
    "corpses": 6,
    "clothes": 214
  },
  "units": {
    "active": 143,
    "dead_on_map": 1
  }
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active. `fps`/`gfps` are technically readable at the DF title screen too (the render loop runs without a fort), but this tool gates on a loaded fort like every other sensor here, for consistency and because the item/unit facts it also reports genuinely need one.
- `items.*` counts are **raw totals**, not usable-stock counts. They will run higher than `stocks`' `counts.stone` (which excludes forbidden/dumped/rotten/under-construction/trader-bound boulders) — the two tools answer different questions (computational clutter vs. usable stockpile) and are deliberately not the same number.
- `units.active` / `units.dead_on_map` are **not** fog-of-war filtered, unlike `threats`/`fort_status`/`livestock_and_pastures`'s unit enumerations. This is deliberate, not an oversight: those tools filter because they expose *which specific unit* is where (an identity/position fact that must not leak an undiscovered cavern's contents); this tool exposes only an aggregate scalar, and the fact it reports — computational load — is genuinely unaffected by what the fort has discovered. An undiscovered cavern's unrevealed wildlife still costs simulation time, so filtering it out here would misrepresent the metric this tool exists to report.
- **Stray/unassigned animal count is intentionally not included here.** The issue calls for it, but `livestock_and_pastures` already computes it (`unassigned_count`, via its own pasture/cage/chain bookkeeping) and that script isn't structured as a `reqscript`-able module (no `--@ module = true` guard) — recomputing it here would mean a second, drift-prone copy of pasture/cage/chain logic living outside the tool that owns it. Call [`livestock_and_pastures`](livestock_and_pastures.md) and read `unassigned_count` instead.

## Implementation notes
`fps`/`gfps` read `df.global.enabler.calculated_fps` / `calculated_gfps` (both `int32_t`), confirmed present in the [df-structures](https://github.com/DFHack/df-structures) `53.15-r2` tag's `df.g_src.enabler.xml` (sibling fields to the `fps`/`gfps` cap-configuration floats that `scripts/setfps.lua` writes — `calculated_*` are the engine's *measured* rates, not the configured cap). Item type classification uses `item:getType()` against `df.item_type`, the same enum and method `stocks`'s and `farming`'s Lua already use; `BOULDER`/`CORPSE`/`CORPSEPIECE`/`REMAINS`/`ARMOR`/`SHOES`/`HELM`/`GLOVES`/`PANTS` are all confirmed enum members in `df.item.xml` at the same tag. `items.total` walks `df.global.world.items.all` once; `units.active`/`units.dead_on_map` walk `df.global.world.units.active` once, both confirmed as standard DFHack globals (referenced directly in DFHack's own scripts and Lua API docs) but **not yet exercised against a running fort** — see the draft-status callout above. No `reqscript` of `mcp_unitVisibility` here: per CONTRIBUTING.md's carve-out, this tool's unit/item counts are bare aggregate scalars with no per-unit identity or position exposed, so the fog-of-war gate that other unit-enumerating tools require doesn't apply (see Caveats).

## Related
[fort_status](fort_status.md) · [stocks](stocks.md) · [livestock_and_pastures](livestock_and_pastures.md)

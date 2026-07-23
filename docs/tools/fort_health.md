---
tool: fort_health
tier: sensor
gated: none
source: src/tools/fortHealth.ts
lua: src/dfhack-queries/mcp_fortHealth.lua
tags: [dfhack-mcp/tool]
---

# fort_health

> The fort's computational health as facts: FPS/GFPS, item clutter by category, and unit counts.

> **Verified live** against a headless DFHack container running the Dreamfort fixture (`53.15-r2`, [#27](https://github.com/alexanderolvera/dfhack-mcp/issues/27)). All field paths resolve cleanly — no Lua errors, no code changes needed from the original draft. See *Implementation notes* below for the one genuine surprise (`fps`/`gfps` are live, not frozen, even on a paused fort) and how the test harness accounts for it.

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
  "fps": 100,
  "gfps": 8,
  "items": {
    "total": 12038,
    "stone": 2075,
    "corpses": 407,
    "clothes": 1146
  },
  "units": {
    "active": 163,
    "dead_on_map": 0
  }
}
```

*(live call against the Dreamfort fixture, 78-citizen population, year 7; committed golden masks `fps`/`gfps` to `null` — see Implementation notes.)*

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active. `fps`/`gfps` are technically readable at the DF title screen too (the render loop runs without a fort), but this tool gates on a loaded fort like every other sensor here, for consistency and because the item/unit facts it also reports genuinely need one.
- `items.*` counts are **raw totals**, not usable-stock counts, and are not guaranteed to run higher than `stocks`' filtered counts — they're the same or higher, never lower. On the verified fixture `items.stone` (2075) happened to exactly equal `stocks`' `counts.stone` (2075), because this fort had no forbidden/dumped/rotten/under-construction/trader-bound boulders at the moment of the read; a fort with any excluded stone would see `items.stone` run strictly higher. The two tools still answer different questions (computational clutter vs. usable stockpile) and aren't guaranteed to match.
- `units.active` / `units.dead_on_map` **are** fog-of-war filtered (`mcp_unitVisibility`), like every other unit-enumerating tool in this server. An earlier draft left this unfiltered on the theory that a bare aggregate count carries no identity/position to leak — review correctly pointed out that the count itself is still a signal (an anomalously high total hints at an undiscovered population), and CONTRIBUTING.md's rule has no carve-out for aggregates. The tradeoff: an undiscovered cavern's unrevealed wildlife still costs real simulation time but is never counted here, so this metric can genuinely **undercount** true computational load. That's the accepted cost of not leaking.
- **Stray/unassigned animal count is intentionally not included here.** The issue calls for it, but `livestock_and_pastures` already computes it (`unassigned_count`, via its own pasture/cage/chain bookkeeping) and that script isn't structured as a `reqscript`-able module (no `--@ module = true` guard) — recomputing it here would mean a second, drift-prone copy of pasture/cage/chain logic living outside the tool that owns it. Call [`livestock_and_pastures`](livestock_and_pastures.md) and read `unassigned_count` instead.
- **`fps`/`gfps` are a live reading, not a frozen one — unlike everything else this tool (or any other sensor's golden) reports.** See Implementation notes.

## Implementation notes
`fps`/`gfps` read `df.global.enabler.calculated_fps` / `calculated_gfps` (both `int32_t`), confirmed present in the [df-structures](https://github.com/DFHack/df-structures) `53.15-r2` tag's `df.g_src.enabler.xml` (sibling fields to the `fps`/`gfps` cap-configuration floats that `scripts/setfps.lua` writes — `calculated_*` are the engine's *measured* rates, not the configured cap). Item type classification uses `item:getType()` against `df.item_type`, the same enum and method `stocks`'s and `farming`'s Lua already use; `BOULDER`/`CORPSE`/`CORPSEPIECE`/`REMAINS`/`ARMOR`/`SHOES`/`HELM`/`GLOVES`/`PANTS` are all confirmed enum members in `df.item.xml` at the same tag. `items.total` walks `df.global.world.items.all` once; `units.active`/`units.dead_on_map` walk `df.global.world.units.active` once, gated through `reqscript('mcp_unitVisibility').is_hidden(u)` like `threats`/`fort_status`.

**Verified live** against the Dreamfort fixture (headless DFHack container, `53.15-r2`, [#27](https://github.com/alexanderolvera/dfhack-mcp/issues/27)): every field resolved with no Lua error and no code change from the original draft — the field-path research held up. The one real finding, and the biggest unknown the draft flagged: **`fps`/`gfps` are non-zero, plausible-looking, and non-nil even on this paused, headless fixture** (`100`/`8` on one call, `99`/`6` a few seconds later) — but unlike `items.*`/`units.*`, which read byte-identical across repeated calls to the same paused fort, `fps`/`gfps` genuinely change call-to-call. That's expected, not a bug: `calculated_fps`/`calculated_gfps` measure DFHack's own render/tick-loop cadence, which keeps running in real time regardless of whether the *game* is paused — a paused fort still costs a live process its wall-clock frame rate. `gfps` reading low (6-8, well under the `fps` cap of 100) is plausible for a headless container with no real display surface to draw to. Because of this, [`scripts/verify.mjs`](../../scripts/verify.mjs) masks `fps`/`gfps` to `null` before writing/comparing the T2 golden (`VOLATILE_FIELDS`) so the snapshot doesn't flap on wall-clock timing; the real, unmasked values are still shape/bounds-checked live by the `fort_health_wellformed_and_bounds_population` invariant in [`test/invariants.mjs`](../../test/invariants.mjs), which also cross-checks `units.active >= fort_status.population`. `units.active`/`units.dead_on_map` are gated through `mcp_unitVisibility` (see Caveats) after a review round correctly flagged that leaving them unfiltered was a fog-of-war leak of the exact shape CONTRIBUTING.md already warns about, even though only an aggregate count — not per-unit identity — was exposed.

## Related
[fort_status](fort_status.md) · [stocks](stocks.md) · [livestock_and_pastures](livestock_and_pastures.md)

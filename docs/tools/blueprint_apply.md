---
tool: blueprint_apply
tier: actuator
gated: actuator
source: src/tools/blueprint.ts
lua: src/dfhack-queries/mcp_blueprint.lua
tags: [dfhack-mcp/tool]
---

# blueprint_apply

> Designate dig or zone from a quickfort blueprint CSV at an explicit anchor.

## Purpose
Applies a quickfort blueprint the agent drafts itself: the caller supplies the CSV, the world anchor of its top-left cell, and the mode; the tool designates exactly that. There is no separate read sensor — a call WITHOUT a `confirm_token` IS the preview (quickfort `--dry-run`), parsing quickfort's own stats into facts. Execute-never-decide: the tool never chooses where or what to dig.

## Parameters
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| csv | string | Yes | — | A complete quickfort blueprint CSV whose FIRST non-blank line is the #dig or #zone modeline (e.g. `#dig\nd,d\nd,d`); the top-left data cell maps to the anchor. |
| anchor_x | number (int) | Yes | — | World x of the blueprint top-left cell. |
| anchor_y | number (int) | Yes | — | World y of the blueprint top-left cell. |
| anchor_z | number (int) | Yes | — | World z-level of the blueprint. |
| mode | string | Yes | — | Blueprint mode — only "dig" and "zone" are supported in v1 (build/place are rejected with no token). |
| confirm_token | string | No | — | Omit to DRY-RUN; pass the returned token to APPLY. |

## Returns
Two-call protocol (shared actuator envelope from `src/actuator.ts`):

**Dry-run**: `{ mode: "preview", applied: false, preview, confirm_token }` — or `blocked: [...]` with NO token. Preview facts (from the Lua dry-run):
- `mode`, `anchor` ([x, y, z]), `tiles_affected`
- `invalid_key_sequences`, `could_not_designate` — quickfort's own parse/designation stats
- `footprint_cells`, `clipped_out_of_bounds`
- `fog_of_war_tiles` (undiscovered tiles under the footprint — a reported fact, never a block), plus `fog_of_war_sample` / `fog_of_war_truncated` when present
- `pre_existing_designations` — footprint tiles that ALREADY carry this designation (undo would clear those too, so the undo handle is flagged unfaithful when any exist)
- `conflicts` — bounded structured list `[{x, y, reason}]`, with `conflicts_truncated`
- `parse_errors` — bounded diagnostic lines locating bad cells, with `parse_errors_truncated`

**Apply**: `{ mode: "apply", applied: true, changes, undo, readback }` — `changes` carries mode/anchor/tiles_affected plus the run stats; `undo` is the documented reversal handle (same csv/anchor/mode via blueprint_undo, with a faithfulness flag); `readback` reports the footprint's designated-tile count after the run.

No golden fixture exists for this tool (actuators are not golden-tested).

## Caveats & limits
- Gated: registered only when the `DFHACK_MCP_ACTUATORS` env var is set.
- A MALFORMED blueprint is BLOCKED with no token — quickfort would otherwise PARTIALLY apply a bad CSV (spike #11 finding), so the dry-run blocks whenever it reports invalid key sequences or undesignatable tiles.
- Size caps: footprint over 10,000 distinct cells blocks (an expansion-bomb `(WxH)` past the cap blocks too, never expands); CSV over 64 KiB (65,536 bytes) blocks.
- Bounded lists: 64 fog-of-war samples, 50 conflicts, 20 diagnostic lines.
- v1 scope: dig + zone only; build/place are rejected in plan() with no token so nothing partially applies.
- Token is single-use and void if any footprint tile's state drifts between preview and apply (per-cell state digest, not just aggregate counts).
- A dry-run whose `tiles_affected` is 0 is flagged as a would-be noop.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Related
- [blueprint_undo](blueprint_undo.md) — the documented reversal with the same csv/anchor/mode.
- [tile_region](tile_region.md) / [map_overview](map_overview.md) — read the terrain before choosing an anchor.
- [geology](geology.md) — what material a dig footprint would cut through.

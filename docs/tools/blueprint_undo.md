---
tool: blueprint_undo
tier: actuator
gated: actuator
source: src/tools/blueprint.ts
lua: src/dfhack-queries/mcp_blueprint.lua
tags: [dfhack-mcp/tool]
---

# blueprint_undo

> Revert a dig/zone designation previously made from a quickfort blueprint, using quickfort's native undo.

## Purpose
Reverses a designation made by blueprint_apply. The caller supplies the SAME csv, anchor, and mode that were applied; quickfort's native undo clears the matching designations. Its dry-run reports what would be cleared right now, as facts.

## Parameters
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| csv | string | Yes | — | The SAME quickfort CSV that was applied (first non-blank line is the #dig or #zone modeline). |
| anchor_x | number (int) | Yes | — | World x of the blueprint top-left cell. |
| anchor_y | number (int) | Yes | — | World y of the blueprint top-left cell. |
| anchor_z | number (int) | Yes | — | World z-level of the blueprint. |
| mode | string | Yes | — | Blueprint mode — only "dig" and "zone" are supported in v1. |
| confirm_token | string | No | — | Omit to DRY-RUN; pass the returned token to APPLY. |

## Returns
Two-call protocol (shared actuator envelope from `src/actuator.ts`):

**Dry-run**: `{ mode: "preview", applied: false, preview, confirm_token }` — or `blocked: [...]` with NO token on a malformed CSV. Preview facts:
- `mode`, `anchor` ([x, y, z])
- `footprint_cells` — cells the blueprint covers
- `currently_designated` — how many footprint tiles carry the designation right now (what undo would clear)
- `parse_errors` — bounded diagnostic lines locating bad cells, when quickfort reports any

**Apply**: `{ mode: "apply", applied: true, changes, undo, readback }` — `changes` carries `mode`, `anchor`, and `reverted` (tiles undesignated / zones removed); `undo` is the re-apply handle (`reversal: "blueprint_apply"` with the same csv/mode/anchor, `faithful: true`); `readback` re-reads the footprint (designated_tiles should now be 0).

No golden fixture exists for this tool (actuators are not golden-tested).

## Caveats & limits
- Gated: registered only when the `DFHACK_MCP_ACTUATORS` env var is set.
- The dry-run runs `quickfort undo --dry-run`, which validates without mutating: a MALFORMED blueprint is BLOCKED with no token (otherwise apply could partially revert).
- Token is single-use and void if any footprint tile's designation state changes between preview and apply (per-cell digest signature).
- A dry-run with `currently_designated` = 0 is flagged as a would-be noop.
- Same size caps as blueprint_apply: 10,000-cell footprint, 64 KiB CSV.
- v1 scope: dig + zone only.
- Note: if tiles under the footprint were ALREADY designated before the original apply, undo clears them too — blueprint_apply's preview reports this via `pre_existing_designations` and flags the undo handle unfaithful.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Related
- [blueprint_apply](blueprint_apply.md) — the forward operation; its apply result hands back the exact undo arguments.
- [tile_region](tile_region.md) — verify tile state around the footprint after reverting.

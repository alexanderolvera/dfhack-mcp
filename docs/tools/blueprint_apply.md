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

## Implementation notes
- Both blueprint_apply and blueprint_undo pass a native argv to `mcp_blueprint.lua`: `a[1]`=subcommand, `a[2]`=csv (multi-line, unescaped — verified to survive intact across the DFHack RPC boundary), `a[3..5]`=anchor, `a[6]`=mode.
- Quickfort itself is driven over RPC at explicit coordinates, never a cursor: the CSV is written to a uniquely-named temp file under the DFHack blueprints dir, run by basename with `-c x,y,z`, then removed — every subcommand (dry-run or real) goes through this same driver.
- The malformed-CSV gate exists because quickfort does not error on a bad blueprint — it partially applies and reports its "Invalid key sequences" / "could not be designated" counts instead (verified live). Both plan_apply and plan_undo therefore always run a `--dry-run` first (verified live that `quickfort undo --dry-run` also completes without mutating and reports the same stats), parse those counts, and block with no `confirm_token` whenever either is greater than zero. Per-cell diagnostic lines quickfort prints before its "successfully completed" marker are captured, bounded, as `parse_errors`.
- The blueprint's occupied cells are derived by treating the modeline as row -1 and the first data row as the anchor row (verified live: `#dig` / `d,d` at `-c X,Y,Z` designates `X,Y` and `X+1,Y`); a `(WxH)` area-expansion suffix expands down-and-right from the marked cell (verified live), and overlapping cells are de-duplicated. This expansion happens before quickfort ever runs, so an oversized `(WxH)` cell is bounded by the 10,000-cell cap rather than looping through a huge synthetic area.
- The 64 KiB CSV byte cap is separate from the 10,000-cell footprint cap because blank and comment (`#...`) bytes contribute zero cells to the footprint while still being written to the temp file and echoed into the preview/undo handle — an all-blank, oversized CSV would clear the footprint cap yet still be an unbounded payload.
- CSV fields are split with a quote-aware, RFC-4180-ish parser: spreadsheet-exported blueprints quote cells containing commas and escape embedded quotes by doubling them, and quickfort itself unquotes cells the same way (verified live), so a naive comma split would mis-place columns and skew every derived count.
- `validate()` treats the `mode` argument as authoritative and requires the CSV's first non-blank line to be a matching `#dig`/`#zone` modeline; a missing or mismatched modeline blocks rather than falling through, because quickfort silently defaults an unrecognized modeline to `#dig`.
- The per-cell scan (`scan_cells`) makes one pass over the footprint producing: fog-of-war count/sample (a fact, never a block), `pre_existing_designations` (cells that already carried this mode's designation before the operation — since quickfort's undo clears designations on every footprint tile regardless of who made them, verified live, this count is what flags the undo handle unfaithful), the bounded `conflicts` list, and a digest — an md5 over the sorted per-cell `"x,y,state,hidden"` lines. The digest exists because aggregate counts alone can stay unchanged while individual cells drift (one tile designated while another is revealed), so it's what actually voids a stale `confirm_token`.
- `undo_handle`'s `faithful` flag reflects a verified-live quirk: quickfort's native undo does correctly revert the dig/zone designations this apply created (dig flag 0→1→0, zone 0→4→0), but it also clears designations on every footprint tile that was *already* designated before the apply ran — so `faithful` is only true when `pre_existing_designations` was zero.

## Related
- [blueprint_undo](blueprint_undo.md) — the documented reversal with the same csv/anchor/mode.
- [tile_region](tile_region.md) / [map_overview](map_overview.md) — read the terrain before choosing an anchor.
- [geology](geology.md) — what material a dig footprint would cut through.

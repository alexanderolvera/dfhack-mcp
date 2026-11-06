---
tool: blueprint_apply
tier: actuator
gated: actuator
source: src/tools/blueprint.ts
lua: src/dfhack-queries/mcp_blueprint.lua
tags: [dfhack-mcp/tool]
---

# blueprint_apply

> Designate dig or zone from a quickfort blueprint — an inline CSV or one from the on-disk library — at an explicit anchor.

## Purpose
Applies a quickfort blueprint from one of two sources: a CSV the agent drafts itself, or an on-disk blueprint named by path/label from [blueprint_library](blueprint_library.md) (DFHack's shipped library — dreamfort, aquifer_tap, pump_stack — or the user's own `dfhack-config/blueprints/`). The caller supplies the source, the world anchor the blueprint starts at, and the mode; the tool designates exactly that. There is no separate read sensor — a call WITHOUT a `confirm_token` IS the preview (quickfort `--dry-run`), parsing quickfort's own stats into facts. Execute-never-decide: the tool never chooses where or what to dig, and never picks a blueprint.

## Parameters
Exactly one of `csv` or `blueprint_path` must be supplied; both, or neither, is BLOCKED with no token.

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| csv | string | One of | — | A complete quickfort blueprint CSV whose FIRST non-blank line is the #dig or #zone modeline (e.g. `#dig\nd,d\nd,d`); the top-left data cell maps to the anchor. |
| blueprint_path | string | One of | — | An on-disk blueprint from `blueprint_library().entries[].path` (e.g. `library/dreamfort.csv`), applied instead of an inline CSV. |
| blueprint_label | string | No | first blueprint in the file | Which section of that file to apply — `blueprint_library().entries[].label` (e.g. `/dig_all`, `surface1`, or `sheet/label` for an `.xlsx`). |
| anchor_x | number (int) | Yes | — | World x the blueprint starts at. |
| anchor_y | number (int) | Yes | — | World y the blueprint starts at. |
| anchor_z | number (int) | Yes | — | World z-level the blueprint starts at. |
| mode | string | Yes | — | Blueprint mode — only "dig" and "zone" are supported in v1 (build/place are rejected with no token). Must match the blueprint's own modeline. |
| confirm_token | string | No | — | Omit to DRY-RUN; pass the returned token to APPLY. |

## Returns
Two-call protocol (shared actuator envelope from `src/actuator.ts`):

**Dry-run**: `{ mode: "preview", applied: false, preview, confirm_token }` — or `blocked: [...]` with NO token. Preview facts (from the Lua dry-run):
- `source` — `"inline_csv"` or `"library"`; for a library source also `blueprint_path`, `blueprint_label`, `z_levels` (the distinct z-levels the footprint covers) and `z_levels_spanned`
- `mode`, `anchor` ([x, y, z]), `tiles_affected`
- `invalid_key_sequences`, `could_not_designate` — quickfort's own parse/designation stats
- `footprint_cells`, `clipped_out_of_bounds`
- `fog_of_war_tiles` (undiscovered tiles under the footprint — a reported fact, never a block), plus `fog_of_war_sample` / `fog_of_war_truncated` when present
- `pre_existing_designations` — footprint tiles that ALREADY carry this designation (undo would clear those too, so the undo handle is flagged unfaithful when any exist)
- `conflicts` — bounded structured list `[{x, y, z, reason}]`, with `conflicts_truncated`
- `parse_errors` — bounded diagnostic lines locating bad cells, with `parse_errors_truncated`

**Apply**: `{ mode: "apply", applied: true, changes, undo, readback }` — `changes` carries source/mode/anchor/tiles_affected plus the run stats; `undo` is the documented reversal handle (the same source — `csv`, or `blueprint_path`/`blueprint_label` — plus anchor/mode via blueprint_undo, with a faithfulness flag); `readback` reports the footprint's designated-tile count after the run.

No golden fixture exists for this tool (actuators are not golden-tested).

## Caveats & limits
- Gated: registered only when the `DFHACK_MCP_ACTUATORS` env var is set.
- A MALFORMED blueprint is BLOCKED with no token — quickfort would otherwise PARTIALLY apply a bad CSV (spike #11 finding), so the dry-run blocks whenever it reports invalid key sequences or undesignatable tiles.
- Size caps: footprint over 10,000 distinct cells blocks (an expansion-bomb `(WxH)` past the cap blocks too, never expands); CSV over 64 KiB (65,536 bytes) blocks. The footprint cap applies to library blueprints too, and is what stops an unbounded multi-z library phase.
- Bounded lists: 64 fog-of-war samples, 50 conflicts, 20 diagnostic lines.
- v1 scope: dig + zone only; build/place are rejected in plan() with no token so nothing partially applies. For the library that means a multi-phase file's dig phases apply and its build/place/query phases do not — `#meta` phases, which chain other blueprints, are rejected the same way.
- A library blueprint may span several z-levels from the anchor (quickfort's `#>`/`#<` level modifiers); an inline CSV is single-z. `z_levels_spanned` reports how many, and every per-cell fact (fog, conflicts, digest) carries its own z.
- One phase at a time: a `blueprint_label` selects a single phase, and its undo handle reverses that phase alone. Applying a multi-phase blueprint means one apply per phase, each with its own preview and token.
- Token is single-use and void if any footprint tile's state drifts between preview and apply (per-cell state digest, not just aggregate counts).
- A dry-run whose `tiles_affected` is 0 is flagged as a would-be noop.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
- Both blueprint_apply and blueprint_undo pass a native argv to `mcp_blueprint.lua`: `a[1]`=subcommand, `a[2]`=csv (multi-line, unescaped — verified to survive intact across the DFHack RPC boundary), `a[3..5]`=anchor, `a[6]`=mode, `a[7]`=blueprint_path, `a[8]`=blueprint_label. A non-empty `a[7]` selects the library source; the two sources are mutually exclusive and validated as such before anything else runs.
- Quickfort itself is driven over RPC at explicit coordinates, never a cursor. An inline CSV is written to a uniquely-named temp file under the DFHack blueprints dir, run by basename with `-c x,y,z`, then removed. A library blueprint needs no temp file — its path is passed to quickfort directly (`quickfort run <path> -n <label> -c x,y,z`), since quickfort already resolves `library/`-prefixed and mod-prefixed paths itself. Every subcommand (dry-run or real, apply or undo) goes through this same driver.
- Library path/label resolution and footprint derivation reuse quickfort's own internals rather than a second parser: `internal/quickfort/list`'s `get_blueprint_filepath` maps a listed path to a real file, and `internal/quickfort/parse`'s `process_section` returns the phase's parsed grid already in world coordinates (it applies the modeline's own `start(x,y)` offset, and splits multi-z sections into one grid per z-level). A label that doesn't exist makes `process_section` `qerror`, so it is called under `pcall` and the failure becomes a block, not a crash.
- The mode argument stays authoritative for both sources. For a library blueprint the tool does not adopt whatever mode the file declares — it blocks when the resolved modeline's mode differs from the caller's `mode`, the same way a mismatched inline `#dig`/`#zone` modeline blocks. A phase can carry several modelines across its z-levels; every distinct one is checked.
- The malformed-CSV gate exists because quickfort does not error on a bad blueprint — it partially applies and reports its "Invalid key sequences" / "could not be designated" counts instead (verified live). Both plan_apply and plan_undo therefore always run a `--dry-run` first (verified live that `quickfort undo --dry-run` also completes without mutating and reports the same stats), parse those counts, and block with no `confirm_token` whenever either is greater than zero. Per-cell diagnostic lines quickfort prints before its "successfully completed" marker are captured, bounded, as `parse_errors`.
- An inline CSV's occupied cells are derived by treating the modeline as row -1 and the first data row as the anchor row (verified live: `#dig` / `d,d` at `-c X,Y,Z` designates `X,Y` and `X+1,Y`); a `(WxH)` area-expansion suffix expands down-and-right from the marked cell (verified live), and overlapping cells are de-duplicated. This expansion happens before quickfort ever runs, so an oversized `(WxH)` cell is bounded by the 10,000-cell cap rather than looping through a huge synthetic area. A library blueprint's cells come from `process_section`'s grid instead, but run through the same expansion and de-duplication step: `process_section` returns raw cell *text*, and quickfort itself does not expand `(WxH)` until execution, so skipping that step would undercount the footprint of exactly the large library blueprints the cap exists to bound.
- Both sources produce one flat list of `{x, y, z}` world cells, sorted by z then y then x. Sorting is not cosmetic: `process_section`'s grid is a sparse map iterated with `pairs()`, so without it the emitted `fog_of_war_sample` and `conflicts` lists would flap between otherwise-identical calls.
- The 64 KiB CSV byte cap is separate from the 10,000-cell footprint cap because blank and comment (`#...`) bytes contribute zero cells to the footprint while still being written to the temp file and echoed into the preview/undo handle — an all-blank, oversized CSV would clear the footprint cap yet still be an unbounded payload.
- CSV fields are split with a quote-aware, RFC-4180-ish parser: spreadsheet-exported blueprints quote cells containing commas and escape embedded quotes by doubling them, and quickfort itself unquotes cells the same way (verified live), so a naive comma split would mis-place columns and skew every derived count.
- `validate()` treats the `mode` argument as authoritative and requires the CSV's first non-blank line to be a matching `#dig`/`#zone` modeline; a missing or mismatched modeline blocks rather than falling through, because quickfort silently defaults an unrecognized modeline to `#dig`.
- The per-cell scan (`scan_cells`) makes one pass over the footprint producing: fog-of-war count/sample (a fact, never a block), `pre_existing_designations` (cells that already carried this mode's designation before the operation — since quickfort's undo clears designations on every footprint tile regardless of who made them, verified live, this count is what flags the undo handle unfaithful), the bounded `conflicts` list, and a digest — an md5 over the sorted per-cell `"x,y,z,state,hidden"` lines. The digest exists because aggregate counts alone can stay unchanged while individual cells drift (one tile designated while another is revealed), so it's what actually voids a stale `confirm_token`. The signature's source component is an md5 of the CSV for an inline blueprint and of `path\0label` for a library one, so a token minted for one phase cannot be redeemed against another phase of the same file at the same anchor.
- `undo_handle`'s `faithful` flag reflects a verified-live quirk: quickfort's native undo does correctly revert the dig/zone designations this apply created (dig flag 0→1→0, zone 0→4→0), but it also clears designations on every footprint tile that was *already* designated before the apply ran — so `faithful` is only true when `pre_existing_designations` was zero.

## Related
- [blueprint_undo](blueprint_undo.md) — the documented reversal with the same csv/anchor/mode.
- [tile_region](tile_region.md) / [map_overview](map_overview.md) — read the terrain before choosing an anchor.
- [geology](geology.md) — what material a dig footprint would cut through.

---
tool: assign_work_detail
tier: actuator
gated: actuator
source: src/tools/workDetail.ts
lua: src/dfhack-queries/mcp_workDetail.lua
tags: [dfhack-mcp/tool]
---

# assign_work_detail

> Add or remove ONE fort citizen to/from ONE work detail (the game's labor groups).

## Purpose
Toggles one citizen's membership in one work detail. Execute-never-decide: the caller names the unit, the detail, and the desired membership; the tool changes exactly that. Because `assigned_units` is the durable source of truth, the tool also mirrors the detail's labors onto the unit immediately (the game otherwise reconciles them only on a frame advance). An AI co-pilot calls it after deciding a labor change and previewing the effect via the dry-run.

## Parameters
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| unit_id | number (int) | Yes | — | Id of the fort citizen (from find_unit / work_details). |
| detail | string | Yes | — | Exact work detail name (from work_details), e.g. "Miners". |
| enabled | boolean | Yes | — | true = add the unit to the detail, false = remove it. |
| confirm_token | string | No | — | Omit to DRY-RUN (returns a preview + single-use token); pass the token to APPLY. |

## Returns
Two-call protocol (shared actuator envelope from `src/actuator.ts`):

**Dry-run** (no `confirm_token`): `{ mode: "preview", applied: false, preview, confirm_token }` — or `blocked: [...]` with NO token when the op cannot apply, or `would_be_noop: true` when already satisfied. The preview carries facts:
- `unit_id`, `unit_name`, `detail`, `detail_mode`, `enabled`
- `currently_member` — is the unit a member right now
- `resulting_members_count` — member count AFTER the change
- `only_member` — true ONLY when this op removes the detail's sole member (always emitted, never omitted)
- `allowed_labors` — the labor tokens the detail enables
- `resulting_details` — every detail the unit would belong to AFTER the change (capped at 50, `resulting_details_truncated` when over)

**Apply** (valid token): `{ mode: "apply", applied: true, changes, undo, readback }` — changes made, the reversal handle, and a post-apply readback from the work_details sensor. A noop apply short-circuits as `{ mode: "apply", applied: false, noop: true, preview }`.

No golden fixture exists for this tool (actuators are not golden-tested).

## Caveats & limits
- Gated: registered only when the `DFHACK_MCP_ACTUATORS` env var is set; the default server is read-only.
- Tokens are single-use and void if the detail's membership, mode, or labor set changes between preview and apply (target-state signature check), or if the apply call's args differ from the previewed op. The signature includes a digest of the detail's *full* sorted membership (not just this unit's membership and the member count), specifically so a swap — one member replacing another, leaving the count and this unit's own membership unchanged — still invalidates the token; count alone can't detect that kind of change.
- `resulting_details` (the preview field listing every detail the unit would belong to after the change) matches details by index rather than name, so two details that happen to share a name can't be confused with each other.
- Labor mirroring: undo recomputes the labor union under the pre-edit membership; if a labor's cache was already stale (paused game / automatic professions disabled), undo CORRECTS the cache rather than restoring the exact prior byte — the apply result reports stale labors honestly.
- Reversal: the same call with `enabled` inverted.
- Returns `{"error":"no fort loaded"}` if no fort is active (same contract as read-only tools).
- See [work_details](work_details.md)'s Implementation notes for the confirmed field paths and the labor-propagation rationale this mirroring behavior relies on.

## Implementation notes
- The TS actuator is thin: `plan()`/`apply()` just forward to `mcp_workDetail.lua`'s `plan_assign`/`apply_assign` subcommands; the shared dry-run/confirm/apply/undo protocol lives in `src/actuator.ts` (`defineActuator`). Version-fragile DF struct access stays in the Lua query, not the TS wrapper.

## Related
- [work_details](work_details.md) — the read-only listing and the readback sensor for this actuator.
- [find_unit](find_unit.md) — resolve a citizen name to the `unit_id` this tool needs.
- [jobs_and_labor](jobs_and_labor.md) — the wider labor/job picture.

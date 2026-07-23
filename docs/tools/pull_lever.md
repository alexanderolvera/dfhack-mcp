---
tool: pull_lever
tier: actuator
gated: actuator
source: src/tools/mechanisms.ts
lua: src/dfhack-queries/mcp_mechanisms.lua
tags: [dfhack-mcp/tool]
---

# pull_lever

> Queue a job for a dwarf to walk to and pull a named lever — the same action as DFHack's `lever pull`.

## Purpose
Execute-never-decide: the caller names the lever; the tool queues exactly one pull job on it. This QUEUES a job, it does not instantly flip the lever or its linked target(s) — the physical toggle (and any bridge/door/spike/support actually moving) happens once a dwarf reaches the lever and completes the job. An AI co-pilot calls it after `mechanisms()` names the lever wired to the bridge/floodgate it wants operated.

## Parameters
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| lever_id | number (int) | Yes | — | Building id of the lever (from `mechanisms()`). |
| urgent | boolean | No | `true` | Sets the job's do-now priority, jumping the work queue. `false` queues it normally. |
| confirm_token | string | No | — | Omit to DRY-RUN (returns a preview + single-use token); pass the token to APPLY. |

## Returns
Two-call protocol (shared actuator envelope from `src/actuator.ts`):

**Dry-run** (no `confirm_token`): `{ mode: "preview", applied: false, preview, confirm_token }` — or `blocked: [...]` with NO token when `lever_id` doesn't name a real lever. The preview carries `lever_id`, `lever_name`, `pos`, `current_state`, `linked_targets` (same shape as `mechanisms()`), `pending_pull_jobs` (jobs already queued — queuing a second pull while one is in flight is allowed, but the preview surfaces that first), and `urgent`.

**Apply** (valid token): `{ mode: "apply", applied: true, changes, undo, readback }`.

```json
{
  "mode": "apply",
  "applied": true,
  "changes": { "lever_id": 359, "queued": true, "urgent": true },
  "readback": {
    "building_id": 359, "name": "Cistern drain", "state": 0,
    "linked_targets": [{ "building_id": 360, "type": "Floodgate", "state": "closed", "...": "..." }],
    "pending_pull_jobs": [{ "id": 117597, "do_now": true, "repeating": false, "suspended": false }]
  },
  "undo": {
    "reversible": true,
    "reversal": "call pull_lever again on the same lever_id — a second pull toggles it back",
    "note": "this QUEUES a job; the lever only flips once a dwarf completes it — not immediately on apply"
  }
}
```

No golden fixture exists for this tool (actuators are not golden-tested).

## Caveats & limits
- Gated: registered only when `DFHACK_MCP_ACTUATORS` is set; the default server is read-only.
- Tokens are single-use and void if the lever's own state, any linked target's building id OR reported state (e.g. a bridge finishing a raise/lower between preview and apply), or any queued job's id or do-now/repeat/suspend flags change between preview and apply.
- **Queuing, not flipping.** `readback` still shows the pre-pull `state` and `linked_targets` state — the toggle happens later, once a dwarf performs the job. There's no "did it actually happen yet" readback here; call `mechanisms()` again after the job clears to see the result.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
`apply()` calls DFHack's own `reqscript('lever').leverPullJob(lever, urgent)` directly rather than reimplementing job construction — the same code path `lever pull` uses (builds a `general_ref_building_holderst` + a `PullLever` job, `dfhack.job.linkIntoWorld` + `checkBuildingsNow`). Confirmed live on DFHack 53.15-r2 against the Dreamfort fixture: previewed and applied a pull on the cistern-drain lever, readback confirmed the new job queued (`do_now: true`) alongside the correct linked floodgate.

## Related
[mechanisms](mechanisms.md) — the read-only sensor and readback for this actuator. [defenses](defenses.md) · [civilian_alert](civilian_alert.md)

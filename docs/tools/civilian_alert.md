---
tool: civilian_alert
tier: actuator
gated: actuator
source: src/tools/burrows.ts
lua: src/dfhack-queries/mcp_burrows.lua
tags: [dfhack-mcp/tool]
---

# civilian_alert

> Toggle a named burrow in or out of the fort's civilian-alert safety set — "siege spotted -> everyone inside," the single most-wanted emergency capability.

## Purpose
The same mechanism as DFHack's `gui/civ-alert` and the vanilla Squads panel's alert button. Execute-never-decide: the caller names the burrow (by id or name) and whether it should be part of the alert; the tool toggles exactly that. `enabled=true` adds the burrow to the alert set AND sounds the alarm (civilians immediately path to a linked burrow) if it wasn't already sounding. `enabled=false` removes the burrow; the alarm is only silenced once the alert set becomes fully empty — removing one of several linked burrows leaves the others (and the alarm) active. An AI co-pilot calls it the moment `threats` reports a siege, naming a burrow `burrows()` already reported.

## Parameters
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| burrow | string | One of burrow/burrow_id | — | Exact burrow name (from `burrows()`), e.g. "Inside+". Ignored when `burrow_id` is given. Burrow names are user-editable and not guaranteed unique — if more than one burrow shares the name, the call is blocked (no token) asking for `burrow_id` instead, rather than silently picking one. |
| burrow_id | number (int) | One of burrow/burrow_id | — | Burrow id (from `burrows()`) — preferred: unambiguous, and the only way to target a burrow with no custom name (DF allows this; the in-game UI falls back to "Burrow N"). |
| enabled | boolean | Yes | — | true = add this burrow to the civilian alert and sound it; false = remove it. |
| confirm_token | string | No | — | Omit to DRY-RUN (returns a preview + single-use token); pass the token to APPLY. |

## Returns
Two-call protocol (shared actuator envelope from `src/actuator.ts`):

**Dry-run** (no `confirm_token`): `{ mode: "preview", applied: false, preview, confirm_token }` — or `blocked: [...]` with NO token when neither `burrow` nor `burrow_id` resolves to a real burrow (or neither was given). The preview carries facts:
- `burrow_id`, `burrow_name`, `enabled`
- `currently_in_civilian_alert` — is the burrow already part of the alert set
- `civilian_alert_currently_sounding` / `civilian_alert_configured`
- `resulting_civilian_alert_burrows` — the alert's burrow id set AFTER the change
- `resulting_sounding` — whether the alarm will be sounding AFTER the change

An already-satisfied request (e.g. `enabled=true` on a burrow already linked and already sounding) previews as a no-op.

**Apply** (valid token): `{ mode: "apply", applied: true, changes, undo, readback }`.

```json
{
  "mode": "apply",
  "applied": true,
  "changes": {
    "burrow_id": 1, "burrow_name": "Clearcutting area", "enabled": true,
    "civilian_alert_burrows": [0, 1], "civilian_alert_sounding": true
  },
  "readback": {
    "burrow": { "id": 1, "name": "Clearcutting area", "civilian_alert_linked": true, "...": "..." },
    "civilian_alert": { "configured": true, "active": true, "burrows": [0, 1] }
  },
  "undo": {
    "reversible": true,
    "reversal": "call civilian_alert again on the same burrow with enabled inverted",
    "faithful": true,
    "note": "if other burrows remain in the civilian-alert set, removing THIS burrow does not by itself silence the alarm for them"
  }
}
```

`undo.faithful` is computed by simulating the inverse call against the post-apply state and comparing it to the true pre-apply state (both membership and sounding). It's `false` whenever another burrow is also linked at apply time — e.g. enabling a burrow while a different one is already linked-but-silent sounds the alarm for both, but inverting only removes this burrow's own membership, not the other burrow's, so it can't restore the original silent state.

No golden fixture exists for this tool (actuators are not golden-tested).

## Caveats & limits
- Gated: registered only when `DFHACK_MCP_ACTUATORS` is set; the default server is read-only.
- Tokens are single-use and void if the alert's burrow set or sounding state changes between preview and apply (target-state signature over the full sorted burrow-id set + sounding index, not just a count — the same swap-detection discipline as `assign_work_detail`); the signature also binds to the RESOLVED burrow id, so deleting the previewed burrow and renaming a different one to the same name can't retarget an already-minted token.
- The civilian-alert slot is always `alerts.list[1]` (DFHack's own convention); `apply` lazily creates it if the fort has never configured one (`plan()` never mutates — it only reports `civilian_alert_configured: false`).
- This actuator only ever manages ONE burrow's membership per call. Removing a burrow from a multi-burrow alert set leaves the alarm sounding for whichever burrows remain — there's no separate "silence everything" action; call `enabled=false` on every linked burrow to fully clear it.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
The TS actuator is thin: `plan()`/`apply()` forward to `mcp_burrows.lua`'s `plan_alert`/`apply_alert` subcommands, which replicate `gui/civ-alert.lua`'s `get_civ_alert()`/add-remove/sound-clear logic exactly (via `utils.insert_sorted`/`erase_sorted`/`binsearch`) so this actuator and the in-game Squads alert button operate on the identical slot. Confirmed live on DFHack 53.15-r2 against the Dreamfort fixture: previewed and applied both directions (add+sound, remove-with-alarm-still-active-for-the-other-burrow), readback matched `burrows()` exactly.

## Related
[burrows](burrows.md) — the read-only sensor and readback for this actuator. [threats](threats.md) · [military](military.md)

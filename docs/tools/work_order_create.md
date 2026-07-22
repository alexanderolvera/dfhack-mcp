---
tool: work_order_create
tier: actuator
gated: actuator
source: src/tools/workOrder.ts
lua: src/dfhack-queries/mcp_workOrder.lua
tags: [dfhack-mcp/tool]
---

# work_order_create

> Queue a new manager (work) order.

## Purpose
Creates a manager order in `df.global.world.manager_orders` — the same structure the in-game manager screen reads, so the order appears in-game immediately. EXECUTE-NEVER-DECIDE: the caller specifies every field (job type, count, frequency, optional output material and/or item type); the tool queues exactly that, with no strategy in defaults. Follows the shared §A0 two-call actuator protocol: a call WITHOUT `confirm_token` is a dry-run returning a preview and a single-use token; a second call WITH the token applies.

## Parameters
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `job_type` | string | yes | — | `df.job_type` name, e.g. "ConstructBed", "MakeTable" |
| `amount` | positive integer | yes | — | number of items to produce |
| `frequency` | enum `OneTime\|Daily\|Monthly\|Seasonally\|Yearly` | no | `OneTime` | repeat frequency |
| `material` | string | no | unconstrained | material token, e.g. "INORGANIC:IRON" |
| `item_type` | string | no | unconstrained | `df.item_type` name to constrain the output item |
| `conditions` | array | no | — | advanced prerequisite conditions — REJECTED in v1 (use material/item_type) |
| `confirm_token` | string | no | — | omit to DRY-RUN; pass the returned token to APPLY |

## Returns
**Dry-run** (no `confirm_token`): `{mode: "preview", applied: false, preview, confirm_token}` where `preview` carries `{job_type, amount, frequency, material, item_type, would_duplicate, duplicate_of, manager_present}` — `would_duplicate: true` when an active order with the identical output spec already exists (its id in `duplicate_of`). Invalid input (unknown job_type/material/item_type/frequency, non-positive amount, any conditions) returns `blocked: [...]` instead and mints no token.

**Apply** (valid `confirm_token`): `{mode: "apply", applied: true, changes, undo, readback}`:

```json
{
  "mode": "apply",
  "applied": true,
  "changes": {
    "created_order_id": 227,
    "job_type": "ConstructBed",
    "amount": 5,
    "frequency": "OneTime"
  },
  "undo": {
    "order_id": 227,
    "reversal": "work_order_cancel(order_id=227)"
  },
  "readback": {
    "id": 227, "job_type": "ConstructBed", "amount_total": 5, "amount_left": 5,
    "frequency": "OneTime", "conditions": 0, "active": false, "validated": false
  }
}
```
*(illustrative shape from the code paths; no golden exists for actuators.)*

## Caveats & limits
- Gated: registered only when the `DFHACK_MCP_ACTUATORS` env var is set; absent from the default read-only surface.
- Confirm tokens are single-use and void if the operation's own targets change between preview and apply (the signature covers the output identity, amount, frequency, and whether a duplicate exists) or if the apply args differ from the previewed args.
- `would_duplicate` is a fact, not a block — an identical order can still be applied.
- Orders are created unbound (`workshop_id: -1`, `max_workshops: 0`); v1 rejects prerequisite `conditions` outright.
- A missing manager noble doesn't block creation, but the order won't be validated/processed until one is assigned (`manager_present` is surfaced in the preview).
- Returns `{"error":"no fort loaded"}` if no fort is active.
- See [work_order_list](work_order_list.md)'s Implementation notes for the confirmed `manager_orders` field paths and a live-verified create/cancel id example.

## Implementation notes
- Both `work_order_create` and `work_order_cancel` are thin TS actuators: `plan()`/`apply()` just forward to `mcp_workOrder.lua`'s subcommands; the shared dry-run/confirm/apply/undo protocol lives in `src/actuator.ts` (`defineActuator`). Version-fragile DF struct access stays in the Lua query, not the TS wrapper.

## Related
[work_order_list](work_order_list.md) (readback/verification), [work_order_cancel](work_order_cancel.md) (the documented reversal), [game_data](game_data.md) (job_type / material / item_type token discovery), [stocks](stocks.md) (material availability).

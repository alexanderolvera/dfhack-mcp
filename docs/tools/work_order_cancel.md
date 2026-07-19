---
tool: work_order_cancel
tier: actuator
gated: actuator
source: src/tools/workOrder.ts
lua: src/dfhack-queries/mcp_workOrder.lua
tags: [dfhack-mcp/tool]
---

# work_order_cancel

> Remove one active manager (work) order by its id.

## Purpose
Erases one order from `df.global.world.manager_orders` by id — the same structure the in-game manager screen reads, so the removal is visible in-game immediately. Follows the shared §A0 two-call actuator protocol: a call WITHOUT `confirm_token` is a dry-run that previews the exact order that would be cancelled and mints a single-use token; a second call WITH the token applies. The apply response returns a recreate spec so the cancellation is a documented, (mostly) reversible operation via [work_order_create](work_order_create.md).

## Parameters
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `order_id` | integer | yes | — | id of the order to cancel (from [work_order_list](work_order_list.md)) |
| `confirm_token` | string | no | — | omit to DRY-RUN; pass the returned token to APPLY |

## Returns
**Dry-run**: `{mode: "preview", applied: false, preview, confirm_token}` where `preview` is the full order-facts row (same shape as a [work_order_list](work_order_list.md) entry). An unknown id returns `blocked: ["no active manager order with id N"]` and mints no token.

**Apply**: `{mode: "apply", applied: true, changes, undo, readback}`:

```json
{
  "mode": "apply",
  "applied": true,
  "changes": { "cancelled_order_id": 227 },
  "undo": {
    "recreate": {
      "job_type": "ConstructBed",
      "amount": 3,
      "frequency": "OneTime"
    },
    "faithful": true,
    "reversal": "work_order_create with the recreate spec"
  },
  "readback": { "order_id": 227, "present": false }
}
```
*(illustrative shape from the code paths; no golden exists for actuators.)*

## Caveats & limits
- Gated: registered only when the `DFHACK_MCP_ACTUATORS` env var is set; absent from the default read-only surface.
- The confirm token is void if the previewed order changed or completed in the meantime — the signature covers progress (amount_left), frequency, workshop binding, conditions, subtype, and validation state — and after one use.
- The `undo.recreate` amount is the REMAINING work (`amount_left`), not the original total.
- `undo.faithful` is true only when the order carries nothing [work_order_create](work_order_create.md) would drop; otherwise `not_reproduced` names the lost features (workshop binding, order conditions, item_subtype) as facts — the undo is approximate.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Related
[work_order_list](work_order_list.md) (find the id; verify the removal), [work_order_create](work_order_create.md) (the documented reversal path).

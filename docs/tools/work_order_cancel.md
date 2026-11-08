---
tool: work_order_cancel
tier: actuator
gated: actuator
source: src/tools/workOrder.ts
lua: src/dfhack-queries/mcp_workOrder.lua
tags: [dfhack-mcp/tool]
---

# work_order_cancel

> Remove one manager (work) order by its id.

## Purpose
Erases one order from `df.global.world.manager_orders` by id — the same structure the in-game manager screen reads, so the removal is visible in-game immediately. Follows the shared §A0 two-call actuator protocol: a call WITHOUT `confirm_token` is a dry-run that previews the exact order that would be cancelled and mints a single-use token; a second call WITH the token applies. The apply response returns a recreate spec, a [work_order_create](work_order_create.md) argument set. It's an approximate reversal and says exactly where it falls short.

## Parameters
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `order_id` | integer | yes | — | id of the order to cancel (from [work_order_list](work_order_list.md)) |
| `confirm_token` | string | no | — | omit to DRY-RUN; pass the returned token to APPLY |

## Returns
**Dry-run**: `{mode: "preview", applied: false, preview, confirm_token}` where `preview` is the full order-facts row (same shape as a [work_order_list](work_order_list.md) entry, conditions included), plus `depended_on_by`: the sorted ids of other orders whose `order_conditions` wait on this one, present only when there are any. An unknown id returns `blocked: ["no manager order with id N"]` and mints no token.

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
      "frequency": "OneTime",
      "item_conditions": [{ "condition": "AtMost", "value": 10, "item_type": "BED" }]
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
- The confirm token is void if the previewed order changed or completed in the meantime, and after one use. The signature covers progress (amount_left), frequency, workshop binding, subtype, validation state, and every field of every condition.
- `undo.recreate` carries `job_type`, `amount`, `frequency`, `material`, `item_type`, and the order's `item_conditions` / `order_conditions` (the keys only when present), in exactly the shape [work_order_create](work_order_create.md) takes.
- Its `amount` is the REMAINING work (`amount_left`), not the original total. Not reported as a loss: that's the work left to do.
- `undo.faithful` is true only when the recreate spec loses nothing. Otherwise `not_reproduced` lists each loss as a fact, and the undo is approximate:
  - `workshop binding` and `item_subtype`: [work_order_create](work_order_create.md) can't set them.
  - `item_conditions[i].flags4` / `.flags5` / `.dye_color`: raw condition fields create can't set. They're stripped from the spec.
  - `order_conditions on order(s) … that reference this order`: other orders waiting on this id. The recreated order gets a fresh id, so they'd keep pointing at the cancelled one.
- `undo.recreate.order_conditions` name other orders by id. If one of them is gone by the time you recreate, create blocks.
- Returns `{"error":"no fort loaded"}` if no fort is active.
- See [work_order_list](work_order_list.md)'s Implementation notes for the confirmed `manager_orders` field paths and a live-verified create/cancel id example.

## Implementation notes
- The order is erased from `manager_orders.all`, then freed the way DFHack's `orders clear` (`plugins/orders.cpp`, 53.15-r2) frees one: each `item_conditions` / `order_conditions` entry, the `items` requirement list (`job_reqst.elements`) when present, and then the order. A `manager_order` destructor doesn't own those pointers, so a bare `:delete()` would leak them.
- `depended_on_by` scans every order's `order_conditions` for `order_id` equal to the cancelled id.

## Related
[work_order_list](work_order_list.md) (find the id; verify the removal), [work_order_create](work_order_create.md) (the documented reversal path).

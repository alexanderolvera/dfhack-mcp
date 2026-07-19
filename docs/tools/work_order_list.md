---
tool: work_order_list
tier: sensor
gated: none
source: src/tools/workOrder.ts
lua: src/dfhack-queries/mcp_workOrder.lua
tags: [dfhack-mcp/tool]
---

# work_order_list

> List the fort's active manager (work) orders as facts.

## Purpose
Reads `df.global.world.manager_orders.all` — the same structures the in-game manager screen shows: each order's id, job type, output item/material tokens, progress, repeat frequency, workshop binding, condition count, and per-order validation state. Also reports whether a manager noble is assigned (an order created without one is never validated/processed). Doubles as the manager-screen view and as the readback sensor for [work_order_create](work_order_create.md) / [work_order_cancel](work_order_cancel.md). Read-only and always available (not behind the actuator gate).

## Parameters
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `after_id` | integer | no | from the start | pagination cursor: return only orders with id greater than this (from `next_cursor`) |

## Returns
| Field | Meaning |
|---|---|
| `count` | TOTAL active orders in the fort (unfiltered by the cursor) |
| `orders[]` | id-sorted page, capped at 256 |
| `orders[].id` | order id |
| `orders[].job_type` | `df.job_type` name, e.g. `ConstructBed` |
| `orders[].item_type` | constrained output item token — key OMITTED when unconstrained |
| `orders[].material` | constrained material token — key OMITTED when unconstrained |
| `orders[].amount_total` / `amount_left` | ordered vs remaining |
| `orders[].frequency` | `OneTime` \| `Daily` \| `Monthly` \| `Seasonally` \| `Yearly` |
| `orders[].workshop_id` | present only when bound to a workshop |
| `orders[].conditions` | count of item + order prerequisite conditions |
| `orders[].active` / `validated` | validation state; `validated: false` on an active order means it cannot currently be fulfilled (e.g. missing materials) |
| `truncated` | the page hit the 256 cap |
| `next_cursor` | present iff truncated: pass as `after_id` for the next page |
| `manager_present` | a citizen holds a MANAGE_PRODUCTION position |

No golden exists for this tool (the frozen fixture predates the work-order tools).

## Caveats & limits
- Page capped at 256 orders, sorted by id; `count` stays the fort total, `next_cursor` continues the walk.
- `item_type` / `material` keys are omitted (not null) when unconstrained — the DFHack JSON encoder can't emit null.
- `manager_present: false` doesn't block listing or creation, but orders won't be validated/processed until a manager is assigned — reported as a fact.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Related
[work_order_create](work_order_create.md) ↔ [work_order_cancel](work_order_cancel.md) (the actuators this readback verifies), [jobs_and_labor](jobs_and_labor.md) (jobs actually in flight), [stocks](stocks.md) (why an order might not validate).

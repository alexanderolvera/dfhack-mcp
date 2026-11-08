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
Creates a manager order in `df.global.world.manager_orders` — the same structure the in-game manager screen reads, so the order appears in-game immediately. EXECUTE-NEVER-DECIDE: the caller specifies every field (job type, count, frequency, optional output material and/or item type, optional conditions); the tool queues exactly that, with no strategy in defaults. Follows the shared §A0 two-call actuator protocol: a call WITHOUT `confirm_token` is a dry-run returning a preview and a single-use token; a second call WITH the token applies.

## Parameters
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `job_type` | string | yes | — | `df.job_type` name, e.g. "ConstructBed", "MakeTable" |
| `amount` | positive integer | yes | — | number of items to produce |
| `frequency` | enum `OneTime\|Daily\|Monthly\|Seasonally\|Yearly` | no | `OneTime` | repeat frequency |
| `material` | string | no | unconstrained | material token, e.g. "INORGANIC:IRON"; blocked on `PrepareMeal` (use `meal_ingredients`) |
| `meal_ingredients` | integer `2`–`4` | no | unset | `PrepareMeal` only: ingredient count, `2` easy, `3` fine, `4` lavish — the same key [work_order_list](work_order_list.md) reports |
| `item_type` | string | no | unconstrained | `df.item_type` name to constrain the output item |
| `item_conditions` | array | no | none | stock-threshold triggers; the order activates only when every one holds. Same shape [work_order_list](work_order_list.md) reports, minus its list-only keys: `{condition, value, item_type?, item_subtype?, material?, flags?, reaction_class?, reaction_product?, bearing?, tool?, min_dimension?, reaction?, contains?}` |
| `order_conditions` | array | no | none | `{order_id, condition: "Activated"\|"Completed"}`: wait on another existing order |
| `conditions` | array | no | — | replaced by `item_conditions` / `order_conditions`; a non-empty array is blocked |
| `confirm_token` | string | no | — | omit to DRY-RUN; pass the returned token to APPLY |

## Returns
**Dry-run** (no `confirm_token`): `{mode: "preview", applied: false, preview, confirm_token}` where `preview` carries `{job_type, amount, frequency, material, meal_ingredients, item_type, item_conditions, order_conditions, would_duplicate, duplicate_of, manager_present}` (`material` / `meal_ingredients` / `item_type` and the condition keys only when given) — `would_duplicate: true` when an active order with the identical output spec already exists (its id in `duplicate_of`). Invalid input returns `blocked: [...]` instead and mints no token: an unknown job_type/material/item_type/frequency, a non-positive amount, `meal_ingredients` on a job type other than `PrepareMeal` or outside `2`–`4`, `material` on `PrepareMeal`, a non-empty legacy `conditions`, or any condition that doesn't resolve. Condition reasons are prefixed with their position, e.g. `item_conditions[1]: unknown flag nope` or `order_conditions[0]: no manager order with id 999`. A condition with an unknown key is rejected by the input schema before it reaches the game.

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
    "frequency": "OneTime", "conditions": 0, "item_conditions": [], "order_conditions": [],
    "active": false, "validated": false
  }
}
```
*(illustrative shape from the code paths; no golden exists for actuators.)*

## Caveats & limits
- Gated: registered only when the `DFHACK_MCP_ACTUATORS` env var is set; absent from the default read-only surface.
- Confirm tokens are single-use and void if the operation's own targets change between preview and apply (the signature covers the output identity, amount, frequency, and whether a duplicate exists) or if the apply args differ from the previewed args.
- `would_duplicate` is a fact, not a block — an identical order can still be applied.
- Orders are created unbound (`workshop_id: -1`, `max_workshops: 0`).
- `would_duplicate` compares the output spec only (job type, item type/subtype, material or meal_ingredients), not conditions.
- `flags4`, `flags5` and `dye_color` can't be set. They have no documented meaning, and DFHack's own `orders import` doesn't set them either.
- The token's signature doesn't cover the orders an `order_conditions` entry names. If one is cancelled between preview and apply, the apply re-resolves it and returns `blocked`.
- A missing manager noble doesn't block creation, but the order won't be validated/processed until one is assigned (`manager_present` is surfaced in the preview).
- Returns `{"error":"no fort loaded"}` if no fort is active.
- See [work_order_list](work_order_list.md)'s Implementation notes for the confirmed `manager_orders` field paths and a live-verified create/cancel id example.

## Implementation notes
- Conditions are built the way DFHack's `orders import` (`plugins/orders.cpp`, 53.15-r2) builds them: `df.manager_order_condition_item:new()` / `df.manager_order_condition_order:new()`, setting only the fields the caller gave and leaving every other field at the struct's constructed default, then `insert('#', …)` into the order's `item_conditions` / `order_conditions`. Flag names resolve against `df.job_item_flags1/2/3` in that order; a reaction resolves by code in `world.raws.reactions.reactions` and `contains` reagent codes by index within it; `bearing` resolves via `dfhack.matinfo.find('INORGANIC:<id>')`. The field mapping is in [work_order_list](work_order_list.md)'s Implementation notes.
- `meal_ingredients` is written the way DFHack's `orders import` writes it: `mat_type = meal_ingredients`, `mat_index = -1` (see [work_order_list](work_order_list.md)'s Implementation notes for why a meal order has no material). `orders import` takes any integer and ignores `material` when both are given. Here the range is limited to DF's three meal kinds, and `material` on `PrepareMeal` is blocked instead of written: it would land in the same `mat_type` slot and read back as an ingredient count, not the material that was asked for. A `PrepareMeal` order with no `meal_ingredients` is created with `mat_type = -1`, as `orders import` does when the key is absent.
- Both `work_order_create` and `work_order_cancel` are thin TS actuators: `plan()`/`apply()` just forward to `mcp_workOrder.lua`'s subcommands; the shared dry-run/confirm/apply/undo protocol lives in `src/actuator.ts` (`defineActuator`). Version-fragile DF struct access stays in the Lua query, not the TS wrapper.

## Related
[work_order_list](work_order_list.md) (readback/verification), [work_order_cancel](work_order_cancel.md) (the documented reversal), [game_data](game_data.md) (job_type / material / item_type token discovery), [stocks](stocks.md) (material availability).

---
tool: work_order_list
tier: sensor
gated: none
source: src/tools/workOrder.ts
lua: src/dfhack-queries/mcp_workOrder.lua
tags: [dfhack-mcp/tool]
---

# work_order_list

> List every manager (work) order in the fort as facts, including its conditions.

## Purpose
Reads `df.global.world.manager_orders.all` — the same structures the in-game manager screen shows: each order's id, job type, output item/material tokens, progress, repeat frequency, workshop binding, its conditions (the manager screen's Conditions tab), and per-order validation state. Also reports whether a manager noble is assigned (an order created without one is never validated/processed). Doubles as the manager-screen view and as the readback sensor for [work_order_create](work_order_create.md) / [work_order_cancel](work_order_cancel.md). Read-only and always available (not behind the actuator gate).

## Parameters
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `after_id` | integer | no | from the start | pagination cursor: return only orders with id greater than this (from `next_cursor`) |

## Returns
| Field | Meaning |
|---|---|
| `count` | TOTAL manager orders in the fort, whatever their `active`/`validated` state (unfiltered by the cursor) |
| `orders[]` | id-sorted page, capped at 256 |
| `orders[].id` | order id |
| `orders[].job_type` | `df.job_type` name, e.g. `ConstructBed` |
| `orders[].item_type` | constrained output item token — key OMITTED when unconstrained |
| `orders[].material` | constrained material token — key OMITTED when unconstrained |
| `orders[].amount_total` / `amount_left` | ordered vs remaining |
| `orders[].frequency` | `OneTime` \| `Daily` \| `Monthly` \| `Seasonally` \| `Yearly` |
| `orders[].workshop_id` | present only when bound to a workshop |
| `orders[].conditions` | `item_conditions.length + order_conditions.length` |
| `orders[].item_conditions[]` | stock-threshold triggers — the order activates only when every one holds; `[]` when none (shape below) |
| `orders[].order_conditions[]` | `{order_id, condition, satisfied}`: wait for order `order_id` to be `Activated` or `Completed`; `satisfied` is the game's own flag for whether it currently is; `[]` when none |
| `orders[].active` / `validated` | validation state; `validated: false` on an active order means it cannot currently be fulfilled (e.g. missing materials) |
| `truncated` | the page hit the 256 cap |
| `next_cursor` | present iff truncated: pass as `after_id` for the next page |
| `manager_present` | a citizen holds a MANAGE_PRODUCTION position |

Each `item_conditions[]` entry counts the fort's items matching a filter and compares the count to `value`. Every key except `condition`/`value` is OMITTED when that filter is unset:

| Field | Meaning |
|---|---|
| `condition` | `AtLeast` \| `AtMost` \| `GreaterThan` \| `LessThan` \| `Exactly` \| `Not` |
| `value` | the count compared against |
| `item_type` / `item_subtype` | `df.item_type` name / subtype token (e.g. `TOOL` / `ITEM_TOOL_HONEYCOMB`) |
| `material` | material token, e.g. `INORGANIC:IRON` |
| `flags` | set `job_item_flags1/2/3` names, e.g. `["unrotten", "cookable"]` |
| `reaction_class` / `reaction_product` | material reaction class / product the item's material must have |
| `bearing` | inorganic id the item must bear (ore of), e.g. `IRON` |
| `tool` | `df.tool_uses` name the item must have, e.g. `LIQUID_CONTAINER` |
| `min_dimension` | minimum item dimension |
| `reaction` / `contains` | reaction code, and the reagent codes within it the item must contain |
| `flags4` / `flags5` / `dye_color` | raw values, present only when they differ from a fresh condition's defaults; [work_order_create](work_order_create.md) can't set them |

Every key except `satisfied`, `flags4`, `flags5` and `dye_color` is accepted back by [work_order_create](work_order_create.md), so a listed condition can be passed straight back in.

No golden exists for this tool yet: the harness excludes it from T2 (`NO_GOLDEN` in `scripts/verify.mjs`).

## Caveats & limits
- Page capped at 256 orders, sorted by id; `count` stays the fort total, `next_cursor` continues the walk.
- `item_type` / `material` keys are omitted (not null) when unconstrained — the DFHack JSON encoder can't emit null. The same goes for unset item-condition filters.
- A condition token that no longer resolves (a subtype, reaction, or reagent index out of range) is reported as its raw number in string form.
- `manager_present: false` doesn't block listing or creation, but orders won't be validated/processed until a manager is assigned — reported as a fact.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
Manager orders live in `df.global.world.manager_orders.all` (`vector<manager_order*>`), with `.manager_order_next_id` supplying fresh ids — the same structures the in-game manager screen reads, so a created or cancelled order is reflected in-game immediately. Verified live on DFHack 53.15: creating an order assigns the next id (e.g. 226 → 227) and cancelling frees it back (→ 226); orders are built with `df.manager_order:new()` and inserted/removed with `:insert()`/`:erase()` + `:delete()`.

Conditions are the order's two pointer vectors, read field by field against df-structures `4955a64` (the revision DFHack 53.15-r2 pins, `df.workquota.xml`):

- `item_conditions` → `manager_order_condition_item`: `compare_type` (`logic_condition_type`: AtLeast=0, AtMost=1, GreaterThan=2, LessThan=3, Exactly=4, Not=5) → `condition`; `compare_val` → `value`; `item_type`/`item_subtype`; `mat_type`/`mat_index` → `material`; `flags1`/`flags2`/`flags3` (`job_item_flags1/2/3`) → `flags`; `reaction_class`; `has_material_reaction_product` → `reaction_product`; `metal_ore` (an inorganic index) → `bearing`; `has_tool_use` → `tool`; `min_dimension`; `reaction_id` (an index into `world.raws.reactions.reactions`) → `reaction`; `contains` (reagent indices into that reaction's `reagents`) → `contains` as reagent codes; `flags4`, `flags5`, `dye_color` → raw.
- `order_conditions` → `manager_order_condition_order`: `order_id`; `condition` (`workquota_order_condition_type`: Activated=0, Completed=1); `flags.satisfied`.

The wire names (`condition`, `value`, `bearing`, `reaction_product`, `tool`, `contains`) follow DFHack's own `orders export` JSON (`plugins/orders.cpp`), so DFHack's library order files (`hack/data/orders/*.json`) map across almost directly. Two exceptions: DFHack's `reaction_id` (which holds a reaction code) is `reaction` here, and an order condition's `order` is `order_id`. Unset filters use the same sentinels `orders export` checks: `-1` for the indices and `NONE` for the enums, `""` for the strings. `flags4`/`flags5`/`dye_color` have no exported meaning, so they're compared against a freshly constructed `manager_order_condition_item` instead of a guessed default. The three `job_item_flags` groups share no flag names at that revision, so the flat `flags` list is unambiguous.

The issue that introduced this (#94) called the stock-threshold triggers `order_conditions`. In the struct they're `item_conditions`; `order_conditions` are order-to-order dependencies.

`manager_present` checks two independent signals for the MANAGE_PRODUCTION responsibility — the position's `code` containing `"MANAGER"`, or its `responsibilities.MANAGE_PRODUCTION` flag — since either can identify the position depending on how the fort's entity positions were set up.

## Related
[work_order_create](work_order_create.md) ↔ [work_order_cancel](work_order_cancel.md) (the actuators this readback verifies), [jobs_and_labor](jobs_and_labor.md) (jobs actually in flight), [stocks](stocks.md) (why an order might not validate).

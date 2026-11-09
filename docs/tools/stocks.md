---
tool: stocks
tier: sensor
gated: none
source: src/tools/stocks.ts
lua: src/dfhack-queries/mcp_stocks.lua
tags: [dfhack-mcp/tool]
---

# stocks

> Raw usable stock counts, a per-item-type inventory, and the citizen population to normalize them by.

## Purpose
Reports the fort's supply picture as raw facts: the citizen population, exact usable counts of food, drink and key materials (wood, fuel, cloth, tanned hides, stone), and an `inventory` of usable counts for every item type DF tracks. It applies no consumption rates or thresholds: a caller that wants days-of-supply or a low-stock flag computes it from `counts` (or `inventory`) and `population` with its own numbers. Item counting follows DFHack's own `dfstatus` convention (iterate `world.items.other.IN_PLAY`, skip rotten/dump/forbid/construction/trader/garbage items, sum stack sizes). It reports the numbers, not whether they are enough or what to produce.

## Parameters
| Name | Type | Meaning |
|---|---|---|
| `category` | string, optional | A `df.item_type` token (case-insensitive), e.g. `DRINK`, `BAR`, `AMMO`. Narrows `inventory` to that one type; every other field is unaffected. An unknown token returns `{"error":"unknown item type '<TOKEN>' ..."}`. |

## Returns
| Field | Meaning |
|---|---|
| `population` | citizen count (via `dfhack.units.getCitizens(true)`) |
| `counts` | exact raw counts: `food`, `prepared_meals`, `drink`, `wood`, `fuel`, `cloth`, `tanned_hides`, `stone` |
| `inventory` | `{ <ITEM_TYPE>: count }` — usable count (same filter as `counts`) for every `df.item_type` except `NONE`, zeros included; just the one type when `category` is given |
| `clothing` | `{ worn_citizens[], worn_citizens_truncated, no_shoes_count }` — see below |

`clothing.worn_citizens[]` is `{ unit_id, name }` for each citizen wearing at least one worn item (`wear >= 2`) — shoe/armor/pants/glove/helm — capped at 50 (`worn_citizens_truncated` flags overflow). DF's own wear scale has 4 stages as an item degrades: pristine → `x`item`x` (wear 1) → `X`item`X` (wear 2, "heavily worn"/threadbare) → `XX`item`XX` (wear 3, "in tatters"/mangled) → destroyed. `wear >= 2` therefore covers BOTH the `X` and `XX` stages, not tattered alone — hence `worn_citizens`, not "tattered". `clothing.no_shoes_count` is how many citizens currently have no `SHOES`-type item worn at all — reported as a count, not a list, since it's normally the whole fort or nothing.

```json
{
  "counts": {
    "cloth": 209,
    "drink": 3075,
    "food": 2795,
    "fuel": 835,
    "prepared_meals": 1583,
    "stone": 2075,
    "tanned_hides": 956,
    "wood": 305
  },
  "clothing": {
    "worn_citizens": [],
    "worn_citizens_truncated": false,
    "no_shoes_count": 0
  },
  "inventory": {
    "AMMO": 2120,
    "BAR": 1118,
    "BARREL": 21,
    "BOULDER": 2075,
    "DRINK": 3075,
    "ROUGH": 338,
    "…": "one key per df.item_type token"
  },
  "population": 78
}
```

## Caveats & limits
- `food` counts ALL edible item types (FOOD, MEAT, FISH, CHEESE, EGG, PLANT, PLANT_GROWTH); `prepared_meals` is the FOOD subset of that total.
- `fuel` counts only coal/charcoal bars (`BAR` items of material COAL).
- `inventory` counts stack sizes, not item objects: a stack of 25 bolts adds 25 to `AMMO`. Its keys are DF's own item-type tokens, so related goods are not grouped (`ROUGH` gems and cut `SMALLGEM`s are separate; `BAR` mixes metal bars with coal, soap, ash, potash and pearlash).
- `inventory.VERMIN` can be very large: a vermin item's stack size is its creature count, so on the fixture five honey-bee stacks on the ground add up to 68,385.
- `clothing` only checks WORN items (`unit_inventory_item.mode == 2`) of the 5 clothing/armor slot types (SHOES/ARMOR/PANTS/GLOVES/HELM — cloaks and shirts are DF's `ARMOR` item type too, so they ARE covered) — unworn spares sitting in inventory, and slot types outside this list (e.g. a backpack or quiver), aren't part of either fact.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
- Item-type field paths, confirmed live on DF 53.15 / DFHack 53.15-r2 (the `df-headless:53.15` fixture): `df.item_type._first_item` is `-1` (`NONE`) and `_last_item` is `92` (`BOLT_THROWER_PARTS`); `df.item_type[i]` maps index → token and `df.item_type[token]` maps back; `item:getType()` returns the index and `item:getStackSize()` the stack count. `inventory` iterates `0.._last_item`, so a DF bump that adds types picks them up with no code change.
- `df.item_type[token]` also resolves the enum's metadata keys (`_first_item` → `-1`, `_last_item` → `92`), so `category` is accepted only when `df.item_type[df.item_type[token]] == token` and the index is `>= 0`.
- `inventory` is an object; DFHack's `json.encode` (jsonxx, `std::map`-backed) emits object keys in sorted order, so the payload is stable without an explicit sort.
- On the fixture the usable filter drops 963 of 1093 `BLOCKS`, 218 of 324 `REMAINS`, all 23 `EGG`s and a few clothing items, compared with the unfiltered `IN_PLAY` totals.
- `counts` overlaps `inventory`: `drink` = `DRINK`, `wood` = `WOOD`, `cloth` = `CLOTH`, `tanned_hides` = `SKIN_TANNED`, `stone` = `BOULDER`, `prepared_meals` = `FOOD`, and `food` is the sum of the edible types. `fuel` is the one count `inventory` can't give, since it filters `BAR` by material. The `stocks_inventory_consistent` invariant checks these.
- v2.0 (#119) removed `food_days`, `drink_days`, `notable_low` and `notable_high`. They applied fixed rates (2 food and 5 drink per dwarf per 84-day season) and invented cutoffs (14 days, fuel 5, wood 20, cloth 10, stone 500) that belong to the client.

## Related
[fort_status](fort_status.md) (overall dashboard), [trade](trade.md) (goods staged at the depot), [jobs_and_labor](jobs_and_labor.md) (who is producing), [work_order_create](work_order_create.md) (queueing production once a gap is known), [farming](farming.md) (the food pipeline upstream of these counts).

---
tool: stocks
tier: sensor
gated: none
source: src/tools/stocks.ts
lua: src/dfhack-queries/mcp_stocks.lua
tags: [dfhack-mcp/tool]
---

# stocks

> Food and drink as estimated days-of-supply for the current population, plus counts of critical materials.

## Purpose
Reports the fort's supply picture: total edible food and drink converted to days-of-supply for the current population, exact counts of critical materials (wood, fuel, cloth, tanned hides, stone), factual `notable_low` / `notable_high` classifications, and an `inventory` of usable counts for every item type DF tracks. Item counting follows DFHack's own `dfstatus` convention (iterate `world.items.other.IN_PLAY`, skip rotten/dump/forbid/construction/trader/garbage items, sum stack sizes). An AI co-pilot calls it to check whether the fort's stockpiles are adequate; it reports the numbers, not what to produce.

## Parameters
| Name | Type | Meaning |
|---|---|---|
| `category` | string, optional | A `df.item_type` token (case-insensitive), e.g. `DRINK`, `BAR`, `AMMO`. Narrows `inventory` to that one type; every other field is unaffected. An unknown token returns `{"error":"unknown item type '<TOKEN>' ..."}`. |

## Returns
| Field | Meaning |
|---|---|
| `population` | citizen count (via `dfhack.units.getCitizens(true)`) |
| `food_days` | estimated days of food supply (`food * 84 / (pop * 2)`); `-1` when population is 0 |
| `drink_days` | estimated days of drink supply (`drink * 84 / (pop * 5)`); `-1` when population is 0 |
| `notable_low` | materials under a documented floor: food/drink under 14 days, fuel < 5, wood < 20, cloth < 10 |
| `notable_high` | materials over a ceiling: stone > 500 |
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
  "drink_days": 662,
  "food_days": 1505,
  "inventory": {
    "AMMO": 2120,
    "BAR": 1118,
    "BARREL": 21,
    "BOULDER": 2075,
    "DRINK": 3075,
    "ROUGH": 338,
    "…": "one key per df.item_type token"
  },
  "notable_high": ["stone"],
  "notable_low": [],
  "population": 78
}
```

## Caveats & limits
- Days-of-supply are documented estimates (DF wiki consumption rates: ~2 food, ~5 drink per dwarf per 84-day season); the `counts` values are exact.
- `food` counts ALL edible item types (FOOD, MEAT, FISH, CHEESE, EGG, PLANT, PLANT_GROWTH); `prepared_meals` is the FOOD subset of that total.
- `fuel` counts only coal/charcoal bars (`BAR` items of material COAL).
- `inventory` counts stack sizes, not item objects: a stack of 25 bolts adds 25 to `AMMO`. Its keys are DF's own item-type tokens, so related goods are not grouped (`ROUGH` gems and cut `SMALLGEM`s are separate; `BAR` mixes metal bars with coal, soap, ash, potash and pearlash).
- `inventory.VERMIN` can be very large: a vermin item's stack size is its creature count, so on the fixture five honey-bee stacks on the ground add up to 68,385.
- Food/drink low-lines are population-normalized (days-of-supply); the material floors (fuel/wood/cloth/stone) are deliberate absolute working-buffer thresholds, not per-capita.
- With zero population, `food_days` / `drink_days` are `-1`.
- `clothing` only checks WORN items (`unit_inventory_item.mode == 2`) of the 5 clothing/armor slot types (SHOES/ARMOR/PANTS/GLOVES/HELM — cloaks and shirts are DF's `ARMOR` item type too, so they ARE covered) — unworn spares sitting in inventory, and slot types outside this list (e.g. a backpack or quiver), aren't part of either fact.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
- Item-type field paths, confirmed live on DF 53.15 / DFHack 53.15-r2 (the `df-headless:53.15` fixture): `df.item_type._first_item` is `-1` (`NONE`) and `_last_item` is `92` (`BOLT_THROWER_PARTS`); `df.item_type[i]` maps index → token and `df.item_type[token]` maps back; `item:getType()` returns the index and `item:getStackSize()` the stack count. `inventory` iterates `0.._last_item`, so a DF bump that adds types picks them up with no code change.
- `df.item_type[token]` also resolves the enum's metadata keys (`_first_item` → `-1`, `_last_item` → `92`), so `category` is accepted only when `df.item_type[df.item_type[token]] == token` and the index is `>= 0`.
- `inventory` is an object; DFHack's `json.encode` (jsonxx, `std::map`-backed) emits object keys in sorted order, so the payload is stable without an explicit sort.
- On the fixture the usable filter drops 963 of 1093 `BLOCKS` (in constructions) and 218 of 324 `REMAINS`, plus a handful of worn clothing items, compared with `fort_health`'s raw totals.
- The population-normalized vs. absolute-threshold split (food/drink by days-of-supply, materials by a flat count) was a deliberate design decision reviewed under issue #5, not an oversight — a future pass tempted to "normalize everything by population" should treat the absolute material floors as intentional: a fort needs a baseline working reserve to keep forges/looms fed regardless of size, and `notable_low`/`notable_high` are a factual classification, not an alert, so a large fort tripping them is a genuinely thin reserve rather than statistical noise.

## Related
[fort_status](fort_status.md) (overall dashboard), [trade](trade.md) (goods staged at the depot), [jobs_and_labor](jobs_and_labor.md) (who is producing), [work_order_create](work_order_create.md) (queueing production once a gap is known), [farming](farming.md) (the food pipeline upstream of these counts).

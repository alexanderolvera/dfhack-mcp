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
Reports the fort's supply picture: total edible food and drink converted to days-of-supply for the current population, exact counts of critical materials (wood, fuel, cloth, tanned hides, stone), and factual `notable_low` / `notable_high` classifications. Item counting follows DFHack's own `dfstatus` convention (iterate `world.items.other.IN_PLAY`, skip rotten/dump/forbid/construction/trader/garbage items, sum stack sizes). An AI co-pilot calls it to check whether the fort's stockpiles are adequate; it reports the numbers, not what to produce.

## Parameters
None.

## Returns
| Field | Meaning |
|---|---|
| `population` | citizen count (via `dfhack.units.getCitizens(true)`) |
| `food_days` | estimated days of food supply (`food * 84 / (pop * 2)`); `-1` when population is 0 |
| `drink_days` | estimated days of drink supply (`drink * 84 / (pop * 5)`); `-1` when population is 0 |
| `notable_low` | materials under a documented floor: food/drink under 14 days, fuel < 5, wood < 20, cloth < 10 |
| `notable_high` | materials over a ceiling: stone > 500 |
| `counts` | exact raw counts: `food`, `prepared_meals`, `drink`, `wood`, `fuel`, `cloth`, `tanned_hides`, `stone` |
| `clothing` | `{ tattered_citizens[], tattered_citizens_truncated, no_shoes_count }` — see below |

`clothing.tattered_citizens[]` is `{ unit_id, name }` for each citizen wearing at least one worn-out (`wear >= 2`, i.e. "XX" or worse) shoe/armor/pants/glove/helm, capped at 50 (`tattered_citizens_truncated` flags overflow). `clothing.no_shoes_count` is how many citizens currently have no `SHOES`-type item worn at all — reported as a count, not a list, since it's normally the whole fort or nothing.

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
    "tattered_citizens": [],
    "tattered_citizens_truncated": false,
    "no_shoes_count": 0
  },
  "drink_days": 662,
  "food_days": 1505,
  "notable_high": ["stone"],
  "notable_low": [],
  "population": 78
}
```

## Caveats & limits
- Days-of-supply are documented estimates (DF wiki consumption rates: ~2 food, ~5 drink per dwarf per 84-day season); the `counts` values are exact.
- `food` counts ALL edible item types (FOOD, MEAT, FISH, CHEESE, EGG, PLANT, PLANT_GROWTH); `prepared_meals` is the FOOD subset of that total.
- `fuel` counts only coal/charcoal bars (`BAR` items of material COAL).
- Food/drink low-lines are population-normalized (days-of-supply); the material floors (fuel/wood/cloth/stone) are deliberate absolute working-buffer thresholds, not per-capita.
- With zero population, `food_days` / `drink_days` are `-1`.
- `clothing` only checks WORN items (`unit_inventory_item.mode == 2`) of the 5 clothing/armor slot types (SHOES/ARMOR/PANTS/GLOVES/HELM) — cloaks, shirts, and unworn spares in inventory aren't part of either fact.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
- The population-normalized vs. absolute-threshold split (food/drink by days-of-supply, materials by a flat count) was a deliberate design decision reviewed under issue #5, not an oversight — a future pass tempted to "normalize everything by population" should treat the absolute material floors as intentional: a fort needs a baseline working reserve to keep forges/looms fed regardless of size, and `notable_low`/`notable_high` are a factual classification, not an alert, so a large fort tripping them is a genuinely thin reserve rather than statistical noise.

## Related
[fort_status](fort_status.md) (overall dashboard), [trade](trade.md) (goods staged at the depot), [jobs_and_labor](jobs_and_labor.md) (who is producing), [work_order_create](work_order_create.md) (queueing production once a gap is known), [farming](farming.md) (the food pipeline upstream of these counts).

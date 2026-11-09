---
tool: trade
tier: sensor
gated: none
source: src/tools/trade.ts
lua: src/dfhack-queries/mcp_trade.lua
tags: [dfhack-mcp/tool]
---

# trade

> The trade picture right now: depot, caravans, broker, and goods staged at the depot.

## Purpose
Answers "can the fort trade right now, and with whom?" the way a player reads the depot screen: whether a trade depot exists, is complete, and is wagon-accessible (DF's OWN pathability flag, not merely "built"); which caravans are present and their lifecycle state; whether a broker is assigned, present, and standing at the depot; and the count and approximate value of goods physically staged in the depot. Reports the state, not what to trade.

## Parameters
None.

## Returns
| Field | Meaning |
|---|---|
| `depot.exists` / `complete` / `accessible` | depot facts; `accessible` is DF's wagon-pathable flag |
| `depot.trader_requested` | the "bring goods to depot" request flag |
| `goods_at_depot` | `{count, approx_value}` of items staged in the depot footprint (fort goods AND, during a visit, unloaded merchant goods — not split) |
| `caravans[]` | `{state, civ?: {name?, race?}, leaving_in_days?, manifest?, agreements?}`; state is None / Approaching / AtDepot / Leaving / Stuck |
| `caravans[].leaving_in_days` | whole days until the merchants depart; present only while Approaching or AtDepot with time left |
| `caravans[].manifest` | `{count, approx_value, by_category[]: {category, count}, by_category_truncated}` — the caravan's own trade goods wherever they are (still carried, or unloaded into the depot), grouped by DF's `item_type`; `approx_value` is the merchants' appraisal. During a visit these overlap `goods_at_depot` |
| `caravans[].agreements` | `{export[], export_truncated, import[], import_truncated}` — active liaison price agreements, each row `{category, entries, price_pct_min, price_pct_max}` (100 = no markup, 200 = double price) |
| `caravan_count` | total caravans before the cap |
| `caravans_truncated` | list capped (cap = 8) |
| `broker.assigned` / `present` / `at_depot` / `name` / `current_job` | broker facts; `at_depot` = standing within the depot footprint |

```json
{
  "broker": {
    "assigned": true,
    "at_depot": false,
    "current_job": "StoreItemInStockpile",
    "name": "Unib Clenchedshoots",
    "present": true
  },
  "caravan_count": 1,
  "caravans": [
    {
      "state": "AtDepot",
      "civ": { "name": "The Oily Vestibule", "race": "DWARF" },
      "leaving_in_days": 23,
      "manifest": {
        "count": 200,
        "approx_value": 28948,
        "by_category": [
          { "category": "CHEESE", "count": 40 },
          { "category": "FISH", "count": 41 },
          { "category": "MEAT", "count": 32 },
          { "category": "PLANT", "count": 36 },
          { "category": "PLANT_GROWTH", "count": 35 },
          { "category": "SMALLGEM", "count": 16 }
        ],
        "by_category_truncated": false
      },
      "agreements": {
        "export": [
          { "category": "GOBLET", "entries": 1, "price_pct_min": 204, "price_pct_max": 204 }
        ],
        "export_truncated": false,
        "import": [
          { "category": "Ammo", "entries": 1, "price_pct_min": 100, "price_pct_max": 100 },
          { "category": "SmallCutGems", "entries": 110, "price_pct_min": 100, "price_pct_max": 197 }
        ],
        "import_truncated": false
      }
    }
  ],
  "caravans_truncated": false,
  "depot": {
    "accessible": false,
    "complete": true,
    "exists": true,
    "trader_requested": false
  },
  "goods_at_depot": { "approx_value": 17195, "count": 203 }
}
```

Captured from the fixture container with a forced dwarven caravan; `agreements.import` is trimmed to two of its 61 rows.

## Caveats & limits
- With multiple depots, a complete + accessible one is preferred so the summary reflects the depot actually usable for trade.
- `leaving_in_days` is `floor(time_remaining / 120)`, the departure countdown. It is already running while the caravan is Approaching and carries on unbroken into AtDepot. It is omitted in Leaving (the countdown is 0 by then), None and Stuck.
- Caravans are sorted (state, then civ race) for deterministic output, and capped at 8 with `caravans_truncated`.
- `goods_at_depot` counts everything in the depot footprint, fort goods and unloaded merchant goods alike, and sums the one-argument `dfhack.items.getValue(item)` over them. It is never itemized.
- `caravans[].manifest` counts the caravan's goods wherever they are: carried in while Approaching, mostly unloaded into the depot at AtDepot, partly packed up again while Leaving. During a visit it therefore overlaps `goods_at_depot`.
- `caravans[].manifest.approx_value` sums the two-argument `dfhack.items.getValue(item, caravan_state)`, which folds in the visiting civ's appraisal and any active agreements. For an untouched caravan it equals DF's own `caravan_state.import_value`. It is not directly comparable to `goods_at_depot.approx_value`.
- `manifest.by_category` and `agreements.export` both group by DF's raw `item_type` enum (`WEAPON`, `ARMOR`, ~112 values, all-caps); `agreements.import` groups by DF's separate `entity_sell_category` enum (the liaison's "request tab" categories — `Leather`, `Weapons`, `Meat`, ~60 values, title-case). These are two different taxonomies over the same items and will not line up 1:1.
- Both agreement lists are aggregated per category (`entries` + a `price_pct` range), not itemized per material/subtype, because per-entry material/subtype names aren't reliably decodable from the struct alone.
- Both agreement lists cap at 150 rows (`export_truncated`/`import_truncated`), above both source enums, so in practice neither truncates. An earlier 30-row cap silently dropped half of a real dwarven caravan's 61 import categories. Because rows are sorted before capping, it always dropped the same alphabetical tail, which held every above-par markup.
- `manifest`/`agreements` are computed per caravan inside a `pcall`. If one fails, the row still emits (state/civ/leaving_in_days) and carries `manifest_error`/`agreements_error` (the raw Lua error) instead, so a field-path bug can't pass for "nothing to report". The `trade_caravan_rows_wellformed` invariant fails on either error field.
- `broker.present: false` with `assigned: true` means a noble on paper with no live unit on the map (dead/absent).
- The committed golden is the no-caravan fixture. The caravan path is covered by `npm run verify:trade-caravan`, which forces a caravan in a scratch container and checks Approaching, AtDepot and Leaving (see [VERIFY.md](../VERIFY.md#ad-hoc-live-verification-scripts)).
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
Field paths confirmed live on DFHack 53.15-r2 against the fixture container, with a caravan forced through Approaching, AtDepot and Leaving (`scripts/verify-trade-caravan.mjs`):
- Depot: `world.buildings.other.TRADE_DEPOT` (`building_tradedepotst`). `accessible` is DF's own wagon-pathable flag, not merely "is it built". Completeness is `construction_stage >= d:getMaxBuildStage()`. `contained_items` are the items physically in the depot footprint. A caravan still reaches AtDepot and unloads when `accessible` is false: the fixture's depot is not wagon-accessible, and the merchants walk in with pack animals.
- Caravans: `df.global.plotinfo.caravans` is a vector of `caravan_state`; empty means no caravan. `trade_state` is `df.caravan_state.T_trade_state` (0 None, 1 Approaching, 2 AtDepot, 3 Leaving, 4 Stuck). `entity` is the visiting civ's `historical_entity` id.
- `caravan_state.time_remaining` drops by 1 every 10 game ticks, so 120 units make one 1200-tick day; DFHack's own `caravan.lua` divides by 120 too. Measured live: a drop of 67 over 673 ticks. The countdown starts on arrival (3218 in one run, about 26 days), runs across Approaching → AtDepot with no reset, and DF moves the caravan to Leaving when it reaches 0. Setting it to a small value is how the verify script reaches Leaving without waiting out the visit.
- Merchant goods are the `world.items.other.IN_PLAY` items with `flags.trader` set. Each has an `ENTITY_ITEMOWNER` general ref whose `entity_id` is the caravan's `entity`; `manifest` attributes goods to a caravan through that ref. All 200 goods of a forced dwarven caravan carried it, in every state. Scanning `IN_PLAY` (about 12,400 items in the fixture) takes about 35 ms.
- `caravan_state.goods` is **not** the manifest. It stayed empty in all three states while the caravan carried 200 goods; the earlier manifest built on it always reported 0.
- `caravan_state.import_value` is DF's total for the goods the caravan brought. It equals the sum of `dfhack.items.getValue(item, caravan_state)` over the `trader` items the caravan owns (28948 and 28458 in two runs).
- `caravan_state.buy_prices` (`entity_buy_prices`) holds parallel vectors `items.item_type[]` and `price[]`. It feeds `agreements.export` with the formula from DFHack's `internal/caravan/tradeagreement.lua`, `(price * 100) // 128`. Live, it held a single `GOBLET` entry at 204%.
- `caravan_state.sell_prices` (`entity_sell_prices`) holds `price`, an array of per-category price vectors indexed by `entity_sell_category`, in the same 128 fixed point. It feeds `agreements.import`. Live, it had 61 populated categories, mostly at 100%, with `SmallCutGems` ranging 100–197%.
- Both price structs can be null pointers (no active agreement with this caravan's civ); the agreement lists are then empty, not omitted.
- Broker: the fort entity's `BROKER` position (responsibility TRADE). Its `assignment.histfig` resolves to a live unit for name + `current_job`; "at depot" means the unit's position falls within the depot footprint.

## Related
[stocks](stocks.md) (what the fort could offer), [fort_status](fort_status.md) (overall dashboard), [chronicle](chronicle.md) (caravan arrivals as events), [rooms_and_zones](rooms_and_zones.md) (where the depot sits).

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
| `caravans[].manifest` | `{count, approx_value, by_category[]: {category, count}, by_category_truncated}` — goods the caravan itself is carrying (before unloading to the depot), grouped by DF's `item_type`; distinct from `goods_at_depot` |
| `caravans[].agreements` | `{export[], export_truncated, import[], import_truncated}` — active liaison price agreements, each row `{category, entries, price_pct_min, price_pct_max}` (100 = no markup, 200 = double price) |
| `caravan_count` | total caravans before the cap |
| `caravans_truncated` | list capped (cap = 8) |
| `broker.assigned` / `present` / `at_depot` / `name` / `current_job` | broker facts; `at_depot` = standing within the depot footprint |
| `alerts[]` | factual lines: depot not wagon-accessible; caravan at depot with no broker; caravan at depot, broker elsewhere |

```json
{
  "alerts": ["trade depot is not wagon-accessible"],
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
      "civ": { "name": "The Copper Coasts", "race": "DWARF" },
      "leaving_in_days": 6,
      "manifest": {
        "count": 42,
        "approx_value": 8150,
        "by_category": [
          { "category": "ARMOR", "count": 6 },
          { "category": "DRINK", "count": 12 },
          { "category": "WEAPON", "count": 4 }
        ],
        "by_category_truncated": false
      },
      "agreements": {
        "export": [
          { "category": "WEAPON", "entries": 2, "price_pct_min": 150, "price_pct_max": 200 }
        ],
        "export_truncated": false,
        "import": [
          { "category": "Leather", "entries": 3, "price_pct_min": 120, "price_pct_max": 140 }
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
  "goods_at_depot": { "approx_value": 15, "count": 3 }
}
```

## Caveats & limits
> **Status: the no-caravan-present path is live-verified; the populated manifest/agreements path is not.** Run against the Dreamfort fixture container (DFHack 53.15), which — like the fixture this code was originally drafted against — has no caravan currently at the depot: `verify:t1 --require-fort`, a direct `trade` call, `verify:invariants`, and `verify:t2 --update` all pass clean, the depot/broker/goods fields match the pre-existing golden exactly, and `caravans: []` means the new `manifest`/`agreements` code paths (and their `pcall` guards) simply never ran — there was nothing for them to run on. This confirms the extension doesn't crash or corrupt existing `trade` output when there's nothing to report. It does **not** confirm the manifest/agreement field paths themselves: those still follow DFHack 53.15-r2's documented structures unconfirmed against a live struct. Getting a fixture with a caravan actually on-site is the top priority for the next live check.

- With multiple depots, a complete + accessible one is preferred so the summary reflects the depot actually usable for trade.
- `leaving_in_days` appears only in states AtDepot/Leaving with a positive countdown (`time_remaining / 1200` ticks-per-day).
- Caravans are sorted (state, then civ race) for deterministic output, and capped at 8 with `caravans_truncated`.
- `goods_at_depot.approx_value` is a rough sum of `dfhack.items.getValue` over staged items; goods are aggregated, never itemized.
- `caravans[].manifest.approx_value` uses `dfhack.items.getValue(item, caravan_state)` (the two-argument form, per DFHack's own Lua API docs), which DFHack itself says adjusts for civ properties and any active trade agreements — so this number is not directly comparable to `goods_at_depot.approx_value`, which uses the plain one-argument form.
- `manifest.by_category` and `agreements.export` both group by DF's raw `item_type` enum (`WEAPON`, `ARMOR`, ~112 values, all-caps); `agreements.import` groups by DF's separate `entity_sell_category` enum (the liaison's own "request tab" categories — `Leather`, `Weapons`, `Meat`, ~60 values, title-case). These are two different taxonomies over the same items and will not line up 1:1 — a caravan can show a `WEAPON` export agreement and a `Weapons` import agreement with unrelated markups.
- `agreements.export` (from `caravan_state.buy_prices`) is the higher-confidence side: its struct path and the `price * 100 / 128` percent formula are both confirmed against DFHack's own `internal/caravan/tradeagreement.lua` (which labels this data "Merchant export agreements" — items the fort earns a bonus selling to this caravan).
- `agreements.import` (from `caravan_state.sell_prices`) is lower-confidence: the struct path is confirmed in df-structures, and it reuses the same 128-fixed-point encoding by analogy, but no shipped DFHack script was found actually reading it live — treat its presence, emptiness, and price values as unconfirmed until checked against a real liaison agreement.
- Both agreement lists are aggregated per category (`entries` + a `price_pct` range), not itemized per material/subtype — deliberately, per "facts not itemized junk," and because per-entry material/subtype names aren't reliably decodable from the struct alone.
- `manifest`/`agreements` are computed per caravan inside a `pcall`; if the live struct shape doesn't match what's coded here, the whole caravan row still emits (state/civ/leaving_in_days) but silently omits `manifest` and/or `agreements` rather than failing the tool.
- `broker.present: false` with `assigned: true` means a noble on paper with no live unit on the map (dead/absent).
- Authoring caveat from the Lua header: the original draft fixture had NO caravan visiting, and the Dreamfort container used for this pass's live verification has the same gap — the active-caravan fields (Approaching/AtDepot/Leaving, `leaving_in_days`, merchant goods, and `manifest`/`agreements`) are coded from the `caravan_state` struct but still have not been observed live; the quiet path (state none, depot + broker) is fully verified, twice now.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
Data model, verified live on DFHack 53.15:
- Depot: `world.buildings.other.TRADE_DEPOT` (`building_tradedepotst`). `accessible` is DF's own wagon-pathable flag — the exact thing the game checks before routing a wagon, not merely "is it built." Completeness is `construction_stage >= d:getMaxBuildStage()`. `contained_items` are the items physically staged in the depot footprint.
- Caravans: `df.global.plotinfo.caravans` is a vector of `caravan_state`; empty means no caravan. `trade_state` is `df.caravan_state.T_trade_state` (0 None, 1 Approaching, 2 AtDepot, 3 Leaving, 4 Stuck); `time_remaining` is a tick countdown (÷1200 = days), meaningful only in AtDepot/Leaving; `entity` resolves to the visiting civ.
- Broker: the fort entity's `BROKER` position (responsibility TRADE). Its `assignment.histfig` resolves to a live unit for name + `current_job`; "at depot" means the unit's position falls within the depot footprint.

Data model, **not** live-verified (draft — see the status callout above), sourced from df-structures tag `53.15-r2` and DFHack's `internal/caravan/` scripts:
- `caravan_state.goods` (df field `already_appraised_item_id`) is the vector of item ids the caravan itself is carrying, resolved via `df.item.find`; this is what `manifest` summarizes, and it is a different set of items than `depot_bld.contained_items` (goods already unloaded/staged at the depot).
- `caravan_state.buy_prices` (df field `requestagreement`, struct `entity_buy_prices`) holds parallel vectors `items.item_type[]` and `price[]` (one row per requested item/subtype); DFHack's `internal/caravan/tradeagreement.lua` reads this exact struct, labels it "Merchant export agreements," and converts price via `(price * 100) // 128` — the formula this tool replicates for `agreements.export`.
- `caravan_state.sell_prices` (df field `tradeagreement`, struct `entity_sell_prices`) holds `price`, a fixed-size array indexed by `entity_sell_category` (DF's liaison "request tab" categories) of per-category price vectors; `agreements.import` reads this by analogy to the same 128-fixed-point encoding, but no confirmed live reader of this specific field was found in DFHack's own scripts.
- Both price structs can be null pointers (no active agreement with this caravan's civ); `agreements.export`/`agreements.import` are simply empty in that case, not omitted.
- `dfhack.items.getValue(item, caravan_state)` (the two-argument form used for `manifest.approx_value`) is documented by DFHack itself to fold in civ properties and active trade agreements, unlike the one-argument form `goods_at_depot.approx_value` uses.

## Related
[stocks](stocks.md) (what the fort could offer), [fort_status](fort_status.md) (overall dashboard), [chronicle](chronicle.md) (caravan arrivals as events), [rooms_and_zones](rooms_and_zones.md) (where the depot sits).

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
| `caravans[]` | `{state, civ?: {name?, race?}, leaving_in_days?}`; state is None / Approaching / AtDepot / Leaving / Stuck |
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
  "caravan_count": 0,
  "caravans": [],
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
- With multiple depots, a complete + accessible one is preferred so the summary reflects the depot actually usable for trade.
- `leaving_in_days` appears only in states AtDepot/Leaving with a positive countdown (`time_remaining / 1200` ticks-per-day).
- Caravans are sorted (state, then civ race) for deterministic output, and capped at 8 with `caravans_truncated`.
- `goods_at_depot.approx_value` is a rough sum of `dfhack.items.getValue` over staged items; goods are aggregated, never itemized.
- `broker.present: false` with `assigned: true` means a noble on paper with no live unit on the map (dead/absent).
- Authoring caveat from the Lua header: the fixture used to write this had NO caravan visiting — the active-caravan fields (Approaching/AtDepot/Leaving, `leaving_in_days`, merchant goods) are coded from the `caravan_state` struct but were not observed live; the quiet path (state none, depot + broker) is fully verified.
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
Data model, verified live on DFHack 53.15:
- Depot: `world.buildings.other.TRADE_DEPOT` (`building_tradedepotst`). `accessible` is DF's own wagon-pathable flag — the exact thing the game checks before routing a wagon, not merely "is it built." Completeness is `construction_stage >= d:getMaxBuildStage()`. `contained_items` are the items physically staged in the depot footprint.
- Caravans: `df.global.plotinfo.caravans` is a vector of `caravan_state`; empty means no caravan. `trade_state` is `df.caravan_state.T_trade_state` (0 None, 1 Approaching, 2 AtDepot, 3 Leaving, 4 Stuck); `time_remaining` is a tick countdown (÷1200 = days), meaningful only in AtDepot/Leaving; `entity` resolves to the visiting civ.
- Broker: the fort entity's `BROKER` position (responsibility TRADE). Its `assignment.histfig` resolves to a live unit for name + `current_job`; "at depot" means the unit's position falls within the depot footprint.

## Related
[stocks](stocks.md) (what the fort could offer), [fort_status](fort_status.md) (overall dashboard), [chronicle](chronicle.md) (caravan arrivals as events), [rooms_and_zones](rooms_and_zones.md) (where the depot sits).

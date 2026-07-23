---
tool: hauling_routes
tier: sensor
gated: none
source: src/tools/haulingRoutes.ts
lua: src/dfhack-queries/mcp_haulingRoutes.lua
tags: [dfhack-mcp/tool]
---

# hauling_routes

> **Status: draft, not yet verified against a live fort.** Field paths below follow DFHack 53.15-r2's documented structures but have not been confirmed against a running game. Needs a `verify:t1`/`verify:t2` pass and a committed golden before this ships.

> The fort's minecart hauling infrastructure as facts: routes, their stops, and the vehicle objects that run them.

## Purpose
Issue #84 names `hauling_routes` as the sensor half of a deferred minecart-route actuator (v1.4, "Logistics & Engineering") — nothing currently sees track-based hauling at all. This tool reports what's configured (routes and their stops, each stop's linked stockpiles and departure conditions) and what's actually running (which vehicles are assigned to which route, where each currently sits, and whether a vehicle still has a real minecart item backing it). It composes with `rooms_and_zones`/a future `stockpiles` sensor, which see the stockpiles themselves but not how track-based hauling moves goods between them.

## Parameters
None.

## Returns
- `routes[]` — one row per hauling route (capped at 100 — see `routes_total`/`routes_truncated`): `{ id, name?, stops[], vehicles[] }`. `name` is absent for a route with no player-set nickname.
  - `stops[]` — that route's stops, sorted by id: `{ id, name?, pos, stockpiles[], conditions[], parked_vehicle_id? }`.
    - `pos` — `{ x, y, z }`, the stop's tile.
    - `stockpiles[]` — `{ building_id, take, give }` for every stockpile linked to this stop. `take` means the cart picks items up from that stockpile when parked here; `give` means it drops items into it; a single link can be both.
    - `conditions[]` — this stop's departure conditions: `{ direction?, mode?, timeout, load_percent, at_most, desired }`. `mode` is how a dwarf moves the cart onward (`Push`/`Ride`/`Guide`); `direction` is the initial departure heading (`North`/`South`/`East`/`West`); `at_most`/`desired` qualify the `load_percent` threshold the cart's contents must cross before this condition is satisfied. `direction`/`mode` are absent if the underlying value didn't resolve to a known name.
    - `parked_vehicle_id` — the vehicle (see the top-level `vehicles[]`) physically parked at this exact stop right now; absent if none is.
  - `vehicles[]` — `{ vehicle_id, current_stop_id? }`, the vehicles assigned to run this route. DF assigns a vehicle to a *route*, not to an individual stop — see Caveats. `current_stop_id` is which of this route's own stops the vehicle currently occupies; absent if it's in transit between stops (or the position didn't resolve).
- `routes_total` (number), `routes_truncated` (boolean).
- `vehicles[]` — every hauling vehicle fort-wide (capped at 200 — see `vehicles_total`/`vehicles_truncated`), regardless of route assignment: `{ vehicle_id, item_id, minecart_assigned, route_id?, on_track }`.
  - `minecart_assigned` — whether the vehicle's backing item still actually exists. A vehicle can persist as a stale reference (still listed on its route) after its physical minecart/wheelbarrow is destroyed, melted, or stolen — this is the one fact this tool reports that a player would otherwise only discover by noticing a route silently stopped moving.
  - `route_id` — the route this vehicle is currently assigned to; absent for an idle/unassigned vehicle.
  - `on_track` — whether the vehicle is currently riding a minecart track (`VEHICLE_FLAG_ON_TRACK`).
- `vehicles_total` (number), `vehicles_truncated` (boolean).

```json
{
  "routes": [
    {
      "id": 0,
      "name": "Ore Line",
      "stops": [
        {
          "id": 0,
          "pos": { "x": 61, "y": 42, "z": 137 },
          "stockpiles": [{ "building_id": 12, "take": true, "give": false }],
          "conditions": [
            { "direction": "East", "mode": "Guide", "timeout": 0, "load_percent": 100, "at_most": false, "desired": true }
          ]
        },
        {
          "id": 1,
          "pos": { "x": 70, "y": 42, "z": 137 },
          "stockpiles": [{ "building_id": 18, "take": false, "give": true }],
          "conditions": [],
          "parked_vehicle_id": 3
        }
      ],
      "vehicles": [{ "vehicle_id": 3, "current_stop_id": 1 }]
    }
  ],
  "routes_total": 1,
  "routes_truncated": false,
  "vehicles": [
    { "vehicle_id": 3, "item_id": 4021, "minecart_assigned": true, "route_id": 0, "on_track": true }
  ],
  "vehicles_total": 1,
  "vehicles_truncated": false
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- **Vehicle assignment is route-level, not per-stop.** DFHack's `hauling_route` struct carries `vehicle_ids[]` directly (confirmed via `df-structures` tag `53.15-r2`, `df.hauling.xml`) and the DF wiki's Minecart page states assignment "can be done with either the route or a stop selected" but is stored against the route. `hauling_stop` itself has no per-stop desired-vehicle field — the closest per-stop facts are `parked_vehicle_id` (who's physically there right now, from `currently_parked_itid`) and `conditions[]` (departure behavior, including a `desired` flag — `STOP_LEAVE_CONDITION_FLAG_DESIRED_ITEMS` — that governs the load threshold, not vehicle choice). Issue #84's phrase "desired vehicle" is folded into these two facts; which one the issue author meant is exactly the kind of thing this draft needs live confirmation on.
- The top-level `vehicles[]` list includes every non-siege hauling vehicle (`vehicle_type` `ITEM`, which covers minecarts and other cart-type haulers alike — DF's structures don't distinguish minecart-vs-wheelbarrow at this level, only via the underlying item's own subtype, which this tool does not resolve). `vehicle_type` `BATTERING_RAM` (siege equipment) is excluded.
- `direction`/`mode` name lookups use a static table built from `df.hauling.xml`'s declared enum-item order (`North`/`South`/`East`/`West` = 0-3; `Push`/`Ride`/`Guide` = 0-2), not a live DFHack enum binding — standard DF convention assigns sequential values in declaration order with no override in this file, but this has not been checked against a running game.
- `routes[]` capped at 100, top-level `vehicles[]` capped at 200; stops/stockpiles/conditions within a route are not separately capped (bounded in practice by how many a player manually places).
- Every field path in this document is a **DFHack 53.15-r2 `df-structures` reading, not a live-fort observation** — no golden exists yet (see the status callout above).

## Implementation notes
Routes live at `df.global.plotinfo.hauling.routes`, a pointer-vector of `hauling_route` keyed by `id` (`local_id`). Each route's `stops` are a pointer-vector of `hauling_stop`; a stop's `stockpiles` (`stockpile_link`, original field name) pairs a building id with a `take`/`give` bitfield, and `conditions` (`leave_condition`) each carry `timeout`/`direction`/`mode`/`load_percent`/`flags`. A stop's `cart_id` (`currently_parked_itid`) is an **item id**, not a vehicle id, so `parked_vehicle_id` is resolved by building an `item_id → vehicle_id` map from `df.global.world.vehicles.all` first. A route's `vehicle_ids`/`vehicle_stops` are parallel arrays (same index = same vehicle); `vehicle_stops[i]` is documented as `refers-to $$._global.stops[$]`, a 0-based index into that same route's `stops` vector — this tool adds 1 before indexing into the Lua-wrapped (1-based) vector, which is the standard DFHack Lua convention but is exactly the kind of index-math that needs a live fixture to confirm rather than a read of the XML alone.

Vehicles come from `df.global.world.vehicles.all`, filtered to `vehicle_type` `ITEM`; `route_id` (`hauling_route_id`) is the route it serves (absent when `-1`); `minecart_assigned` is `df.item.find(item_id) ~= nil` — whether the backing item object still resolves, since a vehicle record can outlive its physical minecart. None of this (the struct shapes, the field names, the index convention, `df.item.find`'s exact nil-on-missing behavior) has been exercised against a running fort — see the status callout at the top of this page.

## Related
[rooms_and_zones](rooms_and_zones.md) · [map_overview](map_overview.md) · [tile_region](tile_region.md)

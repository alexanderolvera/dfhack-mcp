---
tool: hauling_routes
tier: sensor
gated: none
source: src/tools/haulingRoutes.ts
lua: src/dfhack-queries/mcp_haulingRoutes.lua
tags: [dfhack-mcp/tool]
---

# hauling_routes

> **Status: verified against a live fort** (Dreamfort fixture, DFHack 53.15-r2, `df-headless:53.15`). `verify:t1`/`verify:t2` pass and a golden is committed (`test/golden/hauling_routes.json`). Dreamfort's 9 routes are all single-stop "quantum dump" carts with no departure conditions configured, so the `conditions[]`/`direction`/`mode` shape and the multi-stop travel case (a vehicle actually in transit between two stops of the same route) remain unexercised by real data — see Caveats.

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
- **Vehicle assignment is route-level, not per-stop.** Confirmed live: Dreamfort's `hauling_route` structs carry `vehicle_ids[]` directly, one vehicle per route in every case the fixture has, and each vehicle's own `route_id` agrees with the route that claims it (this cross-check is now an invariant, `hauling_routes_cross_references_resolve` in `test/invariants.mjs`). The DF wiki's Minecart page states assignment "can be done with either the route or a stop selected" but is stored against the route; `hauling_stop` itself has no per-stop desired-vehicle field — the closest per-stop facts remain `parked_vehicle_id` (who's physically there right now, from `currently_parked_itid`) and `conditions[]` (departure behavior, including a `desired` flag — `STOP_LEAVE_CONDITION_FLAG_DESIRED_ITEMS` — that governs the load threshold, not vehicle choice). Issue #84's phrase "desired vehicle" is folded into these two facts. The multi-vehicle-per-route case (more than one cart assigned to the same route) is still unexercised — Dreamfort's 9 routes are all 1-vehicle-1-stop.
- The top-level `vehicles[]` list includes every non-siege hauling vehicle (`vehicle_type` `ITEM`, which covers minecarts and other cart-type haulers alike — DF's structures don't distinguish minecart-vs-wheelbarrow at this level, only via the underlying item's own subtype, which this tool does not resolve). `vehicle_type` `BATTERING_RAM` (siege equipment) is excluded; confirmed live that `ITEM`/`BATTERING_RAM` are ordinals 0/1 on this build.
- `direction`/`mode` name lookups now read the live `df.stop_depart_condition.T_direction`/`T_mode` enum bindings directly (swapped in after live confirmation — see Implementation notes) rather than a hand-rolled table, so they can't drift from a future DF/DFHack build's declaration order. Dreamfort's routes have zero departure conditions configured (see the status callout), so the reverse-lookup itself was confirmed by querying the enum bindings directly against the live fort, not by observing a populated `conditions[]` in the wild — that's the one piece of this tool still waiting on a fixture that actually uses departure conditions.
- `routes[]` capped at 100, top-level `vehicles[]` capped at 200; stops/stockpiles/conditions within a route are not separately capped (bounded in practice by how many a player manually places).
- All 9 of Dreamfort's routes are the classic "quantum stockpile" pattern: one stop, one dedicated vehicle, `stockpiles[]` all `take:true`/`give:false`, zero `conditions[]`. That means the populated-route shape (multiple stops per route, a vehicle genuinely in transit between them, non-empty `conditions[]`, a `give:true` link, an unassigned/idle vehicle with no `route_id`) is the top priority for the next live check against a fort that uses hauling routes for actual point-to-point cargo runs rather than dump carts.

## Implementation notes
Routes live at `df.global.plotinfo.hauling.routes`, a pointer-vector of `hauling_route` keyed by `id` (`local_id`) — confirmed live. Each route's `stops` are a pointer-vector of `hauling_stop`; a stop's `stockpiles` (`route_stockpile_link`) pairs a building id with a `take`/`give` bitfield (`stop_stockpile_link_flag`), and `conditions` (`stop_depart_condition`) each carry `timeout`/`direction`/`mode`/`load_percent`/`flags` — all field names confirmed live by constructing a scratch `hauling_stop`/`stop_depart_condition` and enumerating their fields against the running DFHack instance. A stop's `cart_id` (`currently_parked_itid`) is an **item id**, not a vehicle id, so `parked_vehicle_id` is resolved by building an `item_id → vehicle_id` map from `df.global.world.vehicles.all` first.

A route's `vehicle_ids`/`vehicle_stops` are parallel arrays (same index = same vehicle); `vehicle_stops[i]` is a 0-based index into that same route's `stops` vector. **This was the one real bug the live pass caught**: the draft added 1 before indexing (`r.stops[stop_idx + 1]`), on the assumption DFHack's Lua vector wrapping was 1-based like a plain Lua table. It isn't — DFHack-wrapped `vector<T*>` fields (confirmed here for both `hauling.routes` and a route's own `stops`) use 0-based **direct** indexing that mirrors the underlying C++ vector, and `ipairs()` over the same vector also yields 0-based keys (verified directly: `ipairs(r.vehicle_ids)` yields `i=0` for the first element, and `r.stops[0]` — not `r.stops[1]` — is the first stop). The `+ 1` produced `Cannot read field vector<hauling_stop*>.1: index out of bounds` on every one of Dreamfort's single-stop routes, since a 1-element 0-based vector's only valid index is `0`. Fixed by indexing `r.stops[stop_idx]` directly, with no offset — `vehicle_stops[i]`'s documented 0-based convention already matches direct Lua-side indexing, so no conversion is needed at all.

`direction`/`mode` originally resolved through a static table hand-built from `df.hauling.xml`'s declared enum-item order. Live introspection confirmed the values match (`stop_depart_condition.T_direction` reverse-lookup gives `North`/`South`/`East`/`West` for `0`-`3`; `T_mode` gives `Push`/`Ride`/`Guide` for `0`-`2`, and out-of-range lookups return `nil` on both), so the tool now binds directly to `df.stop_depart_condition.T_direction`/`T_mode` instead of maintaining a parallel hand-rolled copy that could drift.

Vehicles come from `df.global.world.vehicles.all`, filtered to `vehicle_type` `ITEM`; `route_id` (confirmed field name live) is the route it serves (absent when `-1`); `minecart_assigned` is `df.item.find(item_id) ~= nil` — confirmed live to read `true` for every one of Dreamfort's 9 in-use minecarts (all backing items still exist on this paused fixture, so the "stale reference after the cart is destroyed" case itself remains unexercised — the mechanism (`df.item.find` returning `nil` for a missing item id) is standard DFHack behavior, not something specific to this tool).

## Related
[rooms_and_zones](rooms_and_zones.md) · [map_overview](map_overview.md) · [tile_region](tile_region.md)

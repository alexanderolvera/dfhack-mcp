local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local ROUTES_CAP = 100
local VEHICLES_CAP = 200

local DIRECTIONS = { [0] = 'North', [1] = 'South', [2] = 'East', [3] = 'West' }
local LEAVE_MODES = { [0] = 'Push', [1] = 'Ride', [2] = 'Guide' }

local hauling = df.global.plotinfo.hauling

local vehicle_id_by_item_id = {}
for _, v in ipairs(df.global.world.vehicles.all) do
  vehicle_id_by_item_id[v.item_id] = v.id
end

local function stop_payload(s)
  local stockpiles = {}
  for _, link in ipairs(s.stockpiles) do
    stockpiles[#stockpiles + 1] = {
      building_id = link.building_id,
      take = link.mode.take or false,
      give = link.mode.give or false,
    }
  end
  table.sort(stockpiles, function(a, b) return a.building_id < b.building_id end)

  local conditions = {}
  for _, c in ipairs(s.conditions) do
    conditions[#conditions + 1] = {
      direction = DIRECTIONS[c.direction],
      mode = LEAVE_MODES[c.mode],
      timeout = c.timeout,
      load_percent = c.load_percent,
      at_most = c.flags.at_most or false,
      desired = c.flags.desired or false,
    }
  end

  local parked_vehicle_id = nil
  if s.cart_id and s.cart_id ~= -1 then
    parked_vehicle_id = vehicle_id_by_item_id[s.cart_id]
  end

  return {
    id = s.id,
    name = (s.name ~= '' and s.name) or nil,
    pos = { x = s.pos.x, y = s.pos.y, z = s.pos.z },
    stockpiles = stockpiles,
    conditions = conditions,
    parked_vehicle_id = parked_vehicle_id,
  }
end

local routes = {}
for _, r in ipairs(hauling.routes) do
  local stops = {}
  for _, s in ipairs(r.stops) do
    stops[#stops + 1] = stop_payload(s)
  end
  table.sort(stops, function(a, b) return a.id < b.id end)

  local route_vehicles = {}
  for i, vid in ipairs(r.vehicle_ids) do
    local stop_idx = r.vehicle_stops[i]
    local current_stop_id = nil
    if stop_idx and stop_idx >= 0 then
      local stop_obj = r.stops[stop_idx + 1]
      if stop_obj then current_stop_id = stop_obj.id end
    end
    route_vehicles[#route_vehicles + 1] = { vehicle_id = vid, current_stop_id = current_stop_id }
  end
  table.sort(route_vehicles, function(a, b) return a.vehicle_id < b.vehicle_id end)

  routes[#routes + 1] = {
    id = r.id,
    name = (r.name ~= '' and r.name) or nil,
    stops = stops,
    vehicles = route_vehicles,
  }
end
table.sort(routes, function(a, b) return a.id < b.id end)

local routes_total = #routes
local routes_truncated = false
if #routes > ROUTES_CAP then
  local capped = {}
  for i = 1, ROUTES_CAP do capped[i] = routes[i] end
  routes = capped
  routes_truncated = true
end

local vehicles = {}
for _, v in ipairs(df.global.world.vehicles.all) do
  if df.vehicle_type[v.type] == 'ITEM' then
    vehicles[#vehicles + 1] = {
      vehicle_id = v.id,
      item_id = v.item_id,
      minecart_assigned = df.item.find(v.item_id) ~= nil,
      route_id = (v.route_id and v.route_id ~= -1) and v.route_id or nil,
      on_track = v.flag.ON_TRACK or false,
    }
  end
end
table.sort(vehicles, function(a, b) return a.vehicle_id < b.vehicle_id end)

local vehicles_total = #vehicles
local vehicles_truncated = false
if #vehicles > VEHICLES_CAP then
  local capped = {}
  for i = 1, VEHICLES_CAP do capped[i] = vehicles[i] end
  vehicles = capped
  vehicles_truncated = true
end

emit({
  routes = routes,
  routes_total = routes_total,
  routes_truncated = routes_truncated,
  vehicles = vehicles,
  vehicles_total = vehicles_total,
  vehicles_truncated = vehicles_truncated,
})

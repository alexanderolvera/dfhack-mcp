local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local WORN_MODES = {
  [df.inv_item_role_type.Worn] = true,
  [df.inv_item_role_type.Weapon] = true,
  [df.inv_item_role_type.Strapped] = true,
  [df.inv_item_role_type.Flask] = true,
}

local function occupant_unit(pos)
  if pos.occupant == -1 then return nil end
  local hf = df.historical_figure.find(pos.occupant)
  local u = hf and df.unit.find(hf.unit_id)
  if not u or dfhack.units.isDead(u) or not dfhack.units.isActive(u) then return nil end
  return u
end

local function worn_item_ids(u)
  local worn = {}
  for _, ii in ipairs(u.inventory) do
    if WORN_MODES[ii.mode] then worn[ii.item.id] = true end
  end
  return worn
end

local function uniform_rows(pos, worn)
  local by_type = {}
  local order = {}
  for _, slot in ipairs(pos.equipment.uniform) do
    for _, spec in ipairs(slot) do
      local tname = df.item_type[spec.item_type]
      local row = by_type[tname]
      if not row then
        row = { item_type = tname, assigned_count = 0, missing_count = 0 }
        by_type[tname] = row
        order[#order + 1] = tname
      end
      if #spec.assigned == 0 then
        row.assigned_count = row.assigned_count + 1
        row.missing_count = row.missing_count + 1
      else
        for ai = 0, #spec.assigned - 1 do
          local id = spec.assigned[ai]
          row.assigned_count = row.assigned_count + 1
          if not worn[id] then row.missing_count = row.missing_count + 1 end
        end
      end
    end
  end
  table.sort(order)
  local out = {}
  for _, tname in ipairs(order) do out[#out + 1] = by_type[tname] end
  return out
end

local function roster_row(pos)
  local u = occupant_unit(pos)
  if not u then return nil end
  local worn = worn_item_ids(u)
  local rows = uniform_rows(pos, worn)
  local missing_total = 0
  for _, r in ipairs(rows) do missing_total = missing_total + r.missing_count end
  return {
    unit_id = u.id,
    name = dfhack.units.getReadableName(u),
    uniform = missing_total > 0 and rows or {},
    uniform_complete = missing_total == 0,
  }
end

local function ammo_facts(sq)
  local specs = {}
  for i = 0, #sq.ammo.ammunition - 1 do
    local am = sq.ammo.ammunition[i]
    specs[#specs + 1] = {
      item_type = df.item_type[am.item_type],
      target_amount = am.amount,
      assigned_count = #am.assigned,
    }
  end
  return {
    specs = specs,
    ammo_items_assigned = #sq.ammo.ammo_items,
  }
end

local function training_facts(sq)
  local month = dfhack.world.ReadCurrentMonth()
  local routine = sq.schedule.routine[sq.cur_routine_idx]
  local m = routine and routine.month[month]
  local orders = {}
  if m then
    for i = 0, #m.orders - 1 do
      orders[#orders + 1] = df.squad_order_type[m.orders[i].order:getType()]
    end
  end
  return {
    cur_routine_idx = sq.cur_routine_idx,
    month = month,
    sleep_mode = m and df.squad_sleep_option_type[m.sleep_mode] or nil,
    uniform_mode = m and df.squad_civilian_uniform_type[m.uniform_mode] or nil,
    active_orders = orders,
  }
end

local fort = df.global.plotinfo.main.fortress_entity
local squads = {}
local assigned_positions = 0

for _, sq in ipairs(df.global.world.squads.all) do
  if fort and sq.entity_id == fort.id then
    local ok, nm = pcall(function() return dfhack.translation.translateName(sq.name, true) end)
    local name = (ok and nm ~= '' and nm) or (sq.alias ~= '' and sq.alias) or ('Squad ' .. sq.id)
    local filled, total = 0, 0
    local roster = {}
    for _, pos in ipairs(sq.positions) do
      total = total + 1
      if pos.occupant ~= -1 then
        filled = filled + 1
        local row = roster_row(pos)
        if row then roster[#roster + 1] = row end
      end
    end
    assigned_positions = assigned_positions + filled
    squads[#squads+1] = {
      name = name,
      filled = filled,
      positions = total,
      roster = roster,
      ammo = ammo_facts(sq),
      training = training_facts(sq),
    }
  end
end

local citizens = dfhack.units.getCitizens(true)
local soldiers, adults = 0, 0
for _, u in ipairs(citizens) do
  if not (dfhack.units.isChild(u) or dfhack.units.isBaby(u)) then
    adults = adults + 1
    if u.military and u.military.squad_id and u.military.squad_id ~= -1 then
      soldiers = soldiers + 1
    end
  end
end

local hostiles, great_danger = 0, 0
for _, u in ipairs(df.global.world.units.active) do
  if dfhack.units.isActive(u) and not dfhack.units.isDead(u)
     and dfhack.units.isDanger(u) and not dfhack.units.isCitizen(u)
     and not (u.flags1.caged or u.flags1.chained) then
    hostiles = hostiles + 1
    if dfhack.units.isGreatDanger(u) then great_danger = great_danger + 1 end
  end
end

local alerts = {}
if #squads == 0 then
  alerts[#alerts+1] = 'no military squads — the fort is undefended'
end
if hostiles > 0 and great_danger > 0 and soldiers == 0 then
  alerts[#alerts+1] = 'NO defenders against a great-danger creature (' .. great_danger ..
    ' on map, 0 soldiers)'
end
for _, sq in ipairs(squads) do
  for _, row in ipairs(sq.roster) do
    if not row.uniform_complete then
      alerts[#alerts+1] = row.name .. ' (' .. sq.name .. ') has an incomplete uniform'
    end
  end
end

emit({
  squad_count = #squads,
  soldiers = soldiers,
  assigned_positions = assigned_positions,
  adults = adults,
  hostiles_on_map = hostiles,
  great_danger_on_map = great_danger,
  squads = squads,
  alerts = alerts,
})

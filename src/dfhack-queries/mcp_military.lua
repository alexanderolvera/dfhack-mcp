local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local fort = df.global.plotinfo.main.fortress_entity
local squads = {}
local assigned_positions = 0

for _, sq in ipairs(df.global.world.squads.all) do
  if fort and sq.entity_id == fort.id then
    local ok, nm = pcall(function() return dfhack.translation.translateName(sq.name, true) end)
    local name = (ok and nm ~= '' and nm) or (sq.alias ~= '' and sq.alias) or ('Squad ' .. sq.id)
    local filled, total = 0, 0
    for _, pos in ipairs(sq.positions) do
      total = total + 1
      if pos.occupant ~= -1 then filled = filled + 1 end
    end
    assigned_positions = assigned_positions + filled
    squads[#squads+1] = { name = name, filled = filled, positions = total }
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

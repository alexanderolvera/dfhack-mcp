local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local visibility = reqscript('mcp_unitVisibility')

local SLAUGHTER_CAP = 50
local TRAINED_CAP = 50
local UNPASTURED_GRAZER_CAP = 50
local CAGES_CAP = 50
local CAGE_OCCUPANTS_CAP = 20

local function safe(fn, default)
  local ok, v = pcall(fn)
  if ok and v ~= nil then return v end
  return default
end

local function unit_name(u)
  return safe(function() return dfhack.units.getReadableName(u) end, 'unit ' .. tostring(u.id))
end

local function unit_sex(u)
  if u.sex == 1 then return 'male' elseif u.sex == 0 then return 'female' else return nil end
end

local function animal_row(u, race_token)
  return {
    unit_id = u.id,
    name = unit_name(u),
    species = race_token,
    sex = unit_sex(u),
    adult = safe(function() return dfhack.units.isAdult(u) end, true),
  }
end

local zt = df.civzone_type
local pens = {}
for _, z in ipairs(df.global.world.buildings.other.ACTIVITY_ZONE) do
  if zt[z.type] == 'Pen' then pens[#pens + 1] = z end
end

local nestboxes = {}
for _, nb in ipairs(df.global.world.buildings.other.NEST_BOX) do
  if nb:getBuildStage() == nb:getMaxBuildStage() then
    nestboxes[#nestboxes + 1] = nb
  end
end
local function contains_tile(z, x, y)
  local ok, v = pcall(dfhack.buildings.containsTile, z, x, y)
  return ok and v
end
local function pen_has_nestbox(z)
  for _, nb in ipairs(nestboxes) do
    if nb.z == z.z and contains_tile(z, nb.x1, nb.y1) then
      return true
    end
  end
  return false
end

local pen_of_unit = {}
local nestbox_pen_of_unit = {}
for _, z in ipairs(pens) do
  local hn = pen_has_nestbox(z)
  for _, uid in ipairs(z.assigned_units) do
    pen_of_unit[uid] = z.id
    nestbox_pen_of_unit[uid] = hn
  end
end

local group_counts = {}
local function group_key(species, sex, adult)
  return species .. '|' .. tostring(sex) .. '|' .. tostring(adult)
end

local tame_total, pets, livestock = 0, 0, 0
local grazer_total, grazer_pastured, grazer_unpastured = 0, 0, {}
local egg_total, egg_pastured_no_nestbox, egg_unpastured = 0, 0, 0
local slaughter, trained = {}, {}
local unassigned_count = 0

for _, u in ipairs(df.global.world.units.active) do
  local ok, tame = pcall(dfhack.units.isTame, u)
  if ok and tame and dfhack.units.isOwnCiv(u) and not visibility.is_hidden(u) then
    tame_total = tame_total + 1
    local race = df.global.world.raws.creatures.all[u.race]
    local token = race and tostring(race.creature_id) or 'UNKNOWN'
    local caste = race and race.caste[u.caste] or nil
    local sex, adult = unit_sex(u), safe(function() return dfhack.units.isAdult(u) end, true)

    local key = group_key(token, sex, adult)
    local g = group_counts[key]
    if not g then
      g = { species = token, sex = sex, adult = adult, count = 0 }
      group_counts[key] = g
    end
    g.count = g.count + 1

    if safe(function() return dfhack.units.isPet(u) end, false) then pets = pets + 1 else livestock = livestock + 1 end

    if caste and caste.flags.GRAZER then
      grazer_total = grazer_total + 1
      if pen_of_unit[u.id] then
        grazer_pastured = grazer_pastured + 1
      else
        grazer_unpastured[#grazer_unpastured + 1] = animal_row(u, token)
      end
    end

    if caste and caste.flags.LAYS_EGGS then
      egg_total = egg_total + 1
      if pen_of_unit[u.id] then
        if not nestbox_pen_of_unit[u.id] then egg_pastured_no_nestbox = egg_pastured_no_nestbox + 1 end
      else
        egg_unpastured = egg_unpastured + 1
      end
    end

    if u.flags2.slaughter then
      slaughter[#slaughter + 1] = animal_row(u, token)
    end

    local lvl = u.training_level
    if lvl and lvl >= df.animal_training_level.Trained and lvl <= df.animal_training_level.MasterfullyTrained then
      local row = animal_row(u, token)
      row.training_level = tostring(df.animal_training_level[lvl])
      trained[#trained + 1] = row
    end

    if not pen_of_unit[u.id] and not u.flags1.caged and not u.flags1.chained then
      unassigned_count = unassigned_count + 1
    end
  end
end

local by_group = {}
for _, g in pairs(group_counts) do by_group[#by_group + 1] = g end
table.sort(by_group, function(a, b)
  if a.species ~= b.species then return a.species < b.species end
  if tostring(a.sex) ~= tostring(b.sex) then return tostring(a.sex) < tostring(b.sex) end
  return tostring(a.adult) < tostring(b.adult)
end)

local function cap(list, n)
  local truncated = false
  if #list > n then
    local kept = {}
    for i = 1, n do kept[i] = list[i] end
    truncated = true
    return kept, truncated
  end
  return list, truncated
end
table.sort(grazer_unpastured, function(a, b) return a.unit_id < b.unit_id end)
table.sort(slaughter, function(a, b) return a.unit_id < b.unit_id end)
table.sort(trained, function(a, b) return a.unit_id < b.unit_id end)

local grazer_unpastured_truncated, slaughter_truncated, trained_truncated
grazer_unpastured, grazer_unpastured_truncated = cap(grazer_unpastured, UNPASTURED_GRAZER_CAP)
slaughter, slaughter_truncated = cap(slaughter, SLAUGHTER_CAP)
trained, trained_truncated = cap(trained, TRAINED_CAP)

local cages = {}
for _, c in ipairs(df.global.world.buildings.other.CAGE) do
  local occupants = safe(function() return dfhack.buildings.getCageOccupants(c) end, {}) or {}
  local rows = {}
  for _, u in ipairs(occupants) do
    if not visibility.is_hidden(u) then
      local race = df.global.world.raws.creatures.all[u.race]
      rows[#rows + 1] = animal_row(u, race and tostring(race.creature_id) or 'UNKNOWN')
    end
  end
  if #rows > 0 then
    table.sort(rows, function(a, b) return a.unit_id < b.unit_id end)
    local occupants_total = #rows
    local occupants_truncated
    rows, occupants_truncated = cap(rows, CAGE_OCCUPANTS_CAP)
    cages[#cages + 1] = {
      building_id = c.id,
      occupants = rows,
      occupants_total = occupants_total,
      occupants_truncated = occupants_truncated,
    }
  end
end
table.sort(cages, function(a, b) return a.building_id < b.building_id end)
local cages_truncated
cages, cages_truncated = cap(cages, CAGES_CAP)

emit({
  tame_total = tame_total,
  pets = pets,
  livestock = livestock,
  by_group = by_group,
  grazers = {
    total = grazer_total,
    pastured = grazer_pastured,
    unpastured = grazer_unpastured,
    unpastured_truncated = grazer_unpastured_truncated,
  },
  egg_layers = {
    total = egg_total,
    nestbox_count = #nestboxes,
    pastured_without_nestbox = egg_pastured_no_nestbox,
    unpastured = egg_unpastured,
  },
  marked_for_slaughter = slaughter,
  marked_for_slaughter_truncated = slaughter_truncated,
  trained = trained,
  trained_truncated = trained_truncated,
  cages = cages,
  cages_truncated = cages_truncated,
  unassigned_count = unassigned_count,
})

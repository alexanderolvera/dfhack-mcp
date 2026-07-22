local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local visibility = reqscript('mcp_unitVisibility')

local WELLS_CAP = 20
local DEITY_WORSHIP_MIN = 1
local CIVZONE = df.global.world.buildings.other.ACTIVITY_ZONE
local SITE = df.global.world.world_data.active_site[0]
local zt = df.civzone_type

local citizens = dfhack.units.getCitizens(true)
local adults = 0
local worship = {}
for _, u in ipairs(citizens) do
  if dfhack.units.isAdult(u) then adults = adults + 1 end
  local hf = df.historical_figure.find(u.hist_figure_id)
  if hf then
    for _, l in ipairs(hf.histfig_links) do
      if df.histfig_hf_link_type[l:getType()] == 'DEITY' and l.target_hf ~= -1 then
        worship[l.target_hf] = (worship[l.target_hf] or 0) + 1
      end
    end
  end
end

local bed_assigned, bed_unassigned, dormitories = 0, 0, 0
local dining_halls, dining_seats = 0, 0
for _, z in ipairs(CIVZONE) do
  local kind = zt[z.type]
  if kind == 'Bedroom' then
    if z.assigned_unit_id and z.assigned_unit_id ~= -1 then
      bed_assigned = bed_assigned + 1
    else
      bed_unassigned = bed_unassigned + 1
    end
  elseif kind == 'Dormitory' then
    dormitories = dormitories + 1
  elseif kind == 'DiningHall' then
    dining_halls = dining_halls + 1
    for _, b in ipairs(z.contained_buildings) do
      if df.building_type[b:getType()] == 'Chair' then dining_seats = dining_seats + 1 end
    end
  end
end

local taverns, libraries, guildhalls = 0, 0, 0
local dedicated = {}
local dedicated_hf = {}
local has_all_inclusive = false
local hospital_ab
for _, ab in ipairs(SITE and SITE.buildings or {}) do
  local t = df.abstract_building_type[ab:getType()]
  if t == 'INN_TAVERN' then
    taverns = taverns + 1
  elseif t == 'LIBRARY' then
    libraries = libraries + 1
  elseif t == 'GUILDHALL' then
    guildhalls = guildhalls + 1
  elseif t == 'HOSPITAL' then
    hospital_ab = ab
  elseif t == 'TEMPLE' then
    if ab.deity_type == -1 then
      has_all_inclusive = true
    elseif ab.deity_data and ab.deity_data.Deity and ab.deity_data.Deity ~= -1 then
      local dhf = df.historical_figure.find(ab.deity_data.Deity)
      if dhf then
        dedicated[#dedicated + 1] = dfhack.translation.translateName(dhf.name, true)
        dedicated_hf[ab.deity_data.Deity] = true
      end
    end
  end
end
table.sort(dedicated)

local needed = {}
if not has_all_inclusive then
  for dhfid, n in pairs(worship) do
    if n >= DEITY_WORSHIP_MIN and not dedicated_hf[dhfid] then
      local dhf = df.historical_figure.find(dhfid)
      needed[#needed + 1] = dhf and dfhack.translation.translateName(dhf.name, true) or ('deity ' .. dhfid)
    end
  end
  table.sort(needed)
end

local hospital = { zoned = false }
if hospital_ab then
  hospital.zoned = true
  local beds, traction, well_in = 0, 0, false
  local hz
  for _, z in ipairs(CIVZONE) do
    if z.location_id == hospital_ab.id then hz = z; break end
  end
  if hz then
    for _, b in ipairs(hz.contained_buildings) do
      local bt = df.building_type[b:getType()]
      if bt == 'Bed' then beds = beds + 1
      elseif bt == 'TractionBench' then traction = traction + 1
      elseif bt == 'Well' then well_in = true end
    end
    local function level(n) if n == 0 then return 'none' elseif n < 5 then return 'low' else return 'ok' end end
    local x1, x2, y1, y2, hzz = hz.x1, hz.x2, hz.y1, hz.y2, hz.z
    local function in_zone(it)
      local x, y, z = dfhack.items.getPosition(it)
      return x ~= nil and z == hzz and x >= x1 and x <= x2 and y >= y1 and y <= y2
    end
    local counts = { thread = 0, cloth = 0, splints = 0, crutches = 0 }
    local other = df.global.world.items.other
    local function tally(list, key)
      if not list then return end
      for _, it in ipairs(list) do if in_zone(it) then counts[key] = counts[key] + 1 end end
    end
    tally(other.THREAD, 'thread')
    tally(other.CLOTH, 'cloth')
    pcall(function() tally(other.SPLINT, 'splints') end)
    pcall(function() tally(other.CRUTCH, 'crutches') end)
    hospital.beds = beds
    hospital.traction_benches = traction
    hospital.well_in_hospital = well_in
    hospital.supplies = {
      thread = level(counts.thread),
      cloth = level(counts.cloth),
      splints = counts.splints,
      crutches = counts.crutches,
    }
  else
    hospital.beds = 0
    hospital.traction_benches = 0
    hospital.well_in_hospital = false
  end
end

local function well_source(w)
  local x, y = w.centerx, w.centery
  for z = w.z, math.max(0, w.z - 40), -1 do
    local blk = dfhack.maps.getTileBlock(x, y, z)
    if blk then
      local lx, ly = x % 16, y % 16
      local des = blk.designation[lx][ly]
      if des.hidden then return 'unknown' end
      if des.flow_size > 0 then
        return des.liquid_type and 'magma' or 'water'
      end
      local mat = df.tiletype.attrs[blk.tiletype[lx][ly]].material
      if df.tiletype_material[mat] == 'FROZEN_LIQUID' then return 'frozen' end
    end
  end
  return 'unknown'
end

local well_bldgs = df.global.world.buildings.other.WELL or {}
local wells = {}
for _, w in ipairs(well_bldgs) do
  wells[#wells + 1] = {
    z = w.z,
    working = w:getBuildStage() == w:getMaxBuildStage(),
    source = well_source(w),
  }
end
table.sort(wells, function(a, b) if a.z ~= b.z then return a.z > b.z end return a.source < b.source end)
local wells_total = #wells
local wells_truncated = false
if #wells > WELLS_CAP then
  local capped = {}
  for i = 1, WELLS_CAP do capped[i] = wells[i] end
  wells = capped
  wells_truncated = true
end

local coffins = df.global.world.buildings.other.COFFIN or {}
local coffins_free, coffins_used = 0, 0
for _, c in ipairs(coffins) do
  local occupied = false
  for _, ci in ipairs(c.contained_items) do
    local it = ci.item
    if df.item_corpsest:is_instance(it) or df.item_corpsepiecest:is_instance(it)
      or df.item_body_component:is_instance(it) then occupied = true break end
  end
  if occupied then coffins_used = coffins_used + 1 else coffins_free = coffins_free + 1 end
end

local fort_race = df.global.plotinfo.race_id
local dead_unburied = 0
local corpse_items = df.global.world.items.other.CORPSE or {}
for _, it in ipairs(corpse_items) do
  if not it.flags.dump and not it.flags.in_building and it.race == fort_race then
    dead_unburied = dead_unburied + 1
  end
end

local GHOSTS_CAP = 50
local civ_id = df.global.plotinfo.civ_id
local active_ghosts = {}
local active_ghost_hf = {}
for _, u in ipairs(df.global.world.units.active) do
  if u.flags3.ghostly and not visibility.is_hidden(u) then
    active_ghosts[#active_ghosts + 1] = {
      unit_id = u.id,
      name = dfhack.units.getReadableName(u),
      histfig_id = u.hist_figure_id,
    }
    if u.hist_figure_id and u.hist_figure_id ~= -1 then active_ghost_hf[u.hist_figure_id] = true end
  end
end
table.sort(active_ghosts, function(a, b) return a.unit_id < b.unit_id end)
local active_ghosts_truncated = false
if #active_ghosts > GHOSTS_CAP then
  local capped = {}
  for i = 1, GHOSTS_CAP do capped[i] = active_ghosts[i] end
  active_ghosts = capped
  active_ghosts_truncated = true
end

local unquiet_dead_count = 0
for _, hf in ipairs(df.global.world.history.figures) do
  if hf.race == fort_race and hf.civ_id == civ_id and hf.died_year ~= -1
    and hf.flags.ghost and not active_ghost_hf[hf.id] then
    unquiet_dead_count = unquiet_dead_count + 1
  end
end

local adults_without = math.max(0, adults - bed_assigned)
local alerts = {}
if adults_without > 0 then
  alerts[#alerts + 1] = adults_without .. ' adult' .. (adults_without == 1 and '' or 's') ..
    ' without an assigned bedroom'
end
if dead_unburied > 0 and coffins_free < dead_unburied then
  alerts[#alerts + 1] = dead_unburied .. ' dead awaiting burial, ' .. coffins_free .. ' free coffins'
end
if #needed > 0 then
  alerts[#alerts + 1] = #needed .. ' worshipped deit' .. (#needed == 1 and 'y' or 'ies') ..
    ' without a dedicated temple'
end
if #active_ghosts > 0 then
  alerts[#alerts + 1] = #active_ghosts .. ' active ghost' .. (#active_ghosts == 1 and '' or 's')
end

emit({
  bedrooms = { assigned = bed_assigned, unassigned = bed_unassigned, adults_without = adults_without, dormitories = dormitories },
  dining = { halls = dining_halls, seats = dining_seats },
  hospital = hospital,
  wells = wells,
  wells_total = wells_total,
  wells_truncated = wells_truncated,
  temples = { dedicated = dedicated, all_inclusive = has_all_inclusive, needed_by_worshippers = needed },
  taverns = taverns,
  libraries = libraries,
  guildhalls = guildhalls,
  coffins_free = coffins_free,
  coffins_used = coffins_used,
  dead_unburied = dead_unburied,
  ghosts = {
    active = active_ghosts,
    active_truncated = active_ghosts_truncated,
    unquiet_dead_count = unquiet_dead_count,
  },
  alerts = alerts,
})

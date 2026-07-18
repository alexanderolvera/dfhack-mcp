-- mcp_roomsAndZones: the fort's facility inventory, each count paired with its
-- demand-side number where one exists (bedrooms<->adults, coffins<->unburied,
-- temples<->deities worshipped). Supply-side companion to unmet_needs(): that
-- says WHO is unfulfilled, this says WHAT the fort has built for them.
--
-- FACTS ONLY: counts and pairings. No "build more bedrooms" advice — the pairing
-- (12 adults, 0 free rooms) is the fact; the agent draws the conclusion.
--
-- Data model (verified live on 53.15-r2, fort Bustlanterns):
--   * Civzones: world.buildings.other.ACTIVITY_ZONE; df.civzone_type[z.type] gives
--     readable kinds (Bedroom, Dormitory, DiningHall, Tomb, ...). z.assigned_unit_id
--     ~= -1 means the room is owned. z.location_id links a zone to a location.
--   * Locations (temples/taverns/libraries/hospitals/guildhalls): the abstract
--     buildings on world_data.active_site[0].buildings, keyed by
--     df.abstract_building_type. TEMPLE carries deity_data.Deity (a deity histfig
--     id) or deity_type == -1 for an all-inclusive temple.
--   * Deity worship: each citizen's historical_figure carries DEITY histfig_links
--     (target_hf = the deity). An all-inclusive temple satisfies every worshipper.
--   * Wells / coffins are plain buildings; a well is complete when
--     getBuildStage()==getMaxBuildStage(); a coffin is occupied when it contains a
--     corpse/body item. Water source is read by scanning downward from the well,
--     stopping at undiscovered tiles (fog of war stays honest).
--
-- Bounded: wells capped; bedrooms/coffins aggregated to counts, never itemized, so
-- a mega-fort payload stays flat.
-- Invoked by name via DFHack RunCommand; prints ONE JSON object.

local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local WELLS_CAP = 20            -- wells listed individually; excess summarized
local DEITY_WORSHIP_MIN = 1     -- a deity "needs" a temple if >= this many citizens worship it
local CIVZONE = df.global.world.buildings.other.ACTIVITY_ZONE
local SITE = df.global.world.world_data.active_site[0]
local zt = df.civzone_type

-- ---- citizens: adult tally + deity worship demand ----
local citizens = dfhack.units.getCitizens(true)
local adults = 0
local worship = {}   -- deity_hf -> #worshippers
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

-- ---- bedrooms + dining from civzones ----
-- Bedrooms are PRIVATE assignable rooms; dormitories are communal (shared, and
-- usually unassigned), so they are counted separately — folding them in would
-- inflate "unassigned private rooms" and leave adults_without unreduced by the
-- communal sleeping a dormitory actually provides. Kept as distinct facts.
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

-- ---- locations: temples / taverns / libraries / guildhalls / hospital ----
local taverns, libraries, guildhalls = 0, 0, 0
local dedicated = {}        -- deity names with a dedicated temple
local dedicated_hf = {}     -- set of deity hf ids with a dedicated temple
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

-- temples needed by worshippers: an all-inclusive temple satisfies everyone;
-- otherwise, deities worshipped by >= DEITY_WORSHIP_MIN citizens with no
-- dedicated temple of their own.
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

-- ---- hospital: beds, traction, well-in-zone, supplies physically present ----
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
    -- medical supplies actually in the hospital footprint (a fact, not a target)
    local function level(n) if n == 0 then return 'none' elseif n < 5 then return 'low' else return 'ok' end end
    local x1, x2, y1, y2, hzz = hz.x1, hz.x2, hz.y1, hz.y2, hz.z
    -- getPosition resolves an item's true location THROUGH its container (thread
    -- and cloth normally live in a coffer/bag on a hospital tile); it.pos alone is
    -- stale for contained items and would under-count a stocked hospital.
    local function in_zone(it)
      local x, y, z = dfhack.items.getPosition(it)  -- returns x,y,z; nil if nowhere
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

-- ---- wells: working + water source (fog-of-war-safe downward scan) ----
local function well_source(w)
  local x, y = w.centerx, w.centery
  for z = w.z, math.max(0, w.z - 40), -1 do
    local blk = dfhack.maps.getTileBlock(x, y, z)
    if blk then
      local lx, ly = x % 16, y % 16
      local des = blk.designation[lx][ly]
      if des.hidden then return 'unknown' end   -- fog of war: don't peer below
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

-- ---- coffins + unburied dead ----
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

-- dead awaiting burial: loose dwarf corpses on the map (not interred in a coffin,
-- not marked for dumping) of the fort's own race.
local fort_race = df.global.plotinfo.race_id
local dead_unburied = 0
local corpse_items = df.global.world.items.other.CORPSE or {}
for _, it in ipairs(corpse_items) do
  if not it.flags.dump and not it.flags.in_building and it.race == fort_race then
    dead_unburied = dead_unburied + 1
  end
end

-- ---- alerts: facts that crossed a line (mirrors the game's own nagging) ----
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
  alerts = alerts,
})

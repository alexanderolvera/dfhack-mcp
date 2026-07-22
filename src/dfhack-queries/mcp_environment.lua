local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local WATER_FREEZE = 10000
local BIOME_STEP   = 11
local SEASONS = { [0] = 'spring', [1] = 'summer', [2] = 'autumn', [3] = 'winter' }
local WEATHER = { [0] = 'none', [1] = 'rain', [2] = 'snow' }

local m = df.global.world.map
local wd = df.global.world.world_data

local season = df.global.cur_season
local season_name = SEASONS[season] or tostring(season)

local weather = 'none'
local raining, snowing = false, false
pcall(function()
  local counts = {}
  local w = df.global.current_weather
  for i = 0, 4 do
    for j = 0, 4 do
      local v = w[i][j]
      counts[v] = (counts[v] or 0) + 1
      if v == 1 then raining = true elseif v == 2 then snowing = true end
    end
  end
  local best, bestn = 0, -1
  for v, n in pairs(counts) do if n > bestn then bestn = n; best = v end end
  weather = WEATHER[best] or tostring(best)
end)

local citizen_groups = {}
for _, u in ipairs(dfhack.units.getCitizens(true)) do
  local p = u.pos
  if p and p.x >= 0 then
    local g = dfhack.maps.getWalkableGroup(xyz2pos(p.x, p.y, p.z))
    if g ~= 0 then citizen_groups[g] = true end
  end
end

local function region_at(rx, ry)
  for i = 0, #wd.regions - 1 do
    local rc = wd.regions[i].region_coords
    for j = 0, #rc.x - 1 do
      if rc.x[j] == rx and rc.y[j] == ry then return i end
    end
  end
  return nil
end

local rgn_seen = {}
local evil, good, reanimating = false, false, false
local temps = {}
for x = math.floor(BIOME_STEP / 2), m.x_count - 1, BIOME_STEP do
  for y = math.floor(BIOME_STEP / 2), m.y_count - 1, BIOME_STEP do
    for z = m.z_count - 1, 0, -1 do
      local blk = dfhack.maps.getTileBlock(x, y, z)
      if blk then
        local lx, ly = x % 16, y % 16
        local des = blk.designation[lx][ly]
        if not des.hidden then
          local sh = df.tiletype_shape[df.tiletype.attrs[blk.tiletype[lx][ly]].shape]
          if des.outside and sh ~= 'EMPTY' and sh ~= 'NONE' then
            temps[#temps + 1] = blk.temperature_1[lx][ly]
            local rx, ry = dfhack.maps.getTileBiomeRgn(xyz2pos(x, y, z))
            if rx then
              local key = rx * 100000 + ry
              if not rgn_seen[key] then
                rgn_seen[key] = true
                local ri = region_at(rx, ry)
                if ri then
                  local wr = wd.regions[ri]
                  if wr.evil then evil = true end
                  if wr.good then good = true end
                  if wr.reanimating then reanimating = true end
                end
              end
            end
            break
          end
        end
      end
    end
  end
end

local surface_temp
if #temps > 0 then
  table.sort(temps)
  surface_temp = temps[math.ceil(#temps / 2)]
end
local water_frozen
if surface_temp ~= nil then
  water_frozen = surface_temp <= WATER_FREEZE
end

local cavern_of_gf = {}
local seen_gf = {}
for _, b in ipairs(m.map_blocks) do
  local gf = b.global_feature
  if gf ~= -1 and seen_gf[gf] == nil then
    seen_gf[gf] = false
    local f = dfhack.maps.getGlobalInitFeature(gf)
    if f and tostring(f._type):find('subterranean_from_layer') then
      local discovered = false
      pcall(function() discovered = f.flags.Discovered end)
      if discovered then
        cavern_of_gf[gf] = (f.start_depth or 0) + 1
        seen_gf[gf] = true
      end
    end
  end
end

local cavern_open = {}
for _, num in pairs(cavern_of_gf) do cavern_open[num] = false end
local any_discovered = next(cavern_of_gf) ~= nil
if any_discovered then
  for _, b in ipairs(m.map_blocks) do
    local num = cavern_of_gf[b.global_feature]
    if num and not cavern_open[num] then
      local bx, by, bz = b.map_pos.x, b.map_pos.y, b.map_pos.z
      for lx = 0, 15 do
        for ly = 0, 15 do
          local des = b.designation[lx][ly]
          if des.feature_global and not des.hidden then
            local g = dfhack.maps.getWalkableGroup(xyz2pos(bx + lx, by + ly, bz))
            if g ~= 0 and citizen_groups[g] then cavern_open[num] = true end
          end
        end
        if cavern_open[num] then break end
      end
    end
  end
end

local caverns = {}
for num, open in pairs(cavern_open) do
  caverns[#caverns + 1] = { cavern = num, open_to_fort = open }
end
table.sort(caverns, function(a, b) return a.cavern < b.cavern end)

local alerts = {}
if water_frozen then alerts[#alerts + 1] = 'surface water is frozen' end
if evil then alerts[#alerts + 1] = 'evil biome' end
if reanimating then alerts[#alerts + 1] = 'reanimating biome: the dead reanimate' end
for _, c in ipairs(caverns) do
  if c.open_to_fort then
    alerts[#alerts + 1] = 'cavern ' .. c.cavern .. ' is open to fort pathing'
  end
end

emit({
  season = season,
  season_name = season_name,
  surface = {
    temperature = surface_temp,
    water_frozen = water_frozen,
    weather = weather,
    raining = raining,
    snowing = snowing,
  },
  biome = { evil = evil, good = good, reanimating = reanimating },
  caverns = caverns,
  caverns_discovered = #caverns,
  alerts = alerts,
})

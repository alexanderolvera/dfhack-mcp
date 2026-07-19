-- mcp_environment: the fort's ambient conditions RIGHT NOW -- season, weather,
-- surface temperature (is exposed water frozen?), the alignment of the biomes the
-- player knew at embark, and, for each cavern the fort has ALREADY breached,
-- whether it is currently open to fort pathing or sealed off.
--
-- FACTS ONLY: labeled current-state readings, never advice. Threshold restatements
-- (e.g. "surface water is frozen") go in `alerts`, which mirrors what the game
-- itself would surface -- no "dig deeper" / "wall it off" counsel.
--
-- FOG-OF-WAR HONEST (a HARD invariant): this reports NOTHING about undiscovered
-- cavern layers. A cavern appears in `caverns` only if the game's own Discovered
-- flag is set (the player has breached it); the open/sealed pathing test then
-- considers ONLY revealed (non-hidden) tiles. A world with three caverns none of
-- which the fort has reached emits `caverns: []` and never leaks their existence.
--
-- Small, FIXED-size payload: season/weather/temperature are scalars, biome is three
-- booleans, and caverns is capped at the (<=3) layers actually breached. Nothing in
-- here grows with fort age or map size.
--
-- Data model (verified live on 53.15 vs the frozen 78-pop fixture):
--   * Season   : df.global.cur_season (0..3 = spring/summer/autumn/winter).
--   * Weather  : df.global.current_weather is a 5x5 grid of df.weather_type
--                (0 None / 1 Rain / 2 Snow); the dominant cell is the fort weather.
--   * Temp     : block.temperature_1[lx][ly] at a surface tile, in DF units where
--                10000 == the melting/freezing point of water. <=10000 => exposed
--                water is ice. plotinfo.hi_temp/lo_temp read a 60001 sentinel here
--                and are NOT used.
--   * Biome    : the SURFACE biome per column resolves via
--                dfhack.maps.getTileBiomeRgn(pos) -> (world_x, world_y) THEN the
--                world_region whose region_coords contains it, carrying evil / good
--                / reanimating booleans -- exactly the surroundings shown at embark.
--                (getTileBiomeRgn underground collapses to the site region, so the
--                sample MUST be taken at each column's real surface tile.)
--   * Caverns  : block.global_feature -> dfhack.maps.getGlobalInitFeature(idx); a
--                feature_init_subterranean_from_layerst is a cavern, start_depth+1
--                its number (1..3). f.flags.Discovered gates disclosure. Open ==
--                a revealed cavern tile shares a citizen walkability group (DF's own
--                3D reachability, as in mcp_defenses); else sealed.
-- NOTE: per-tile SAVAGERY lives in world_data.region_map, which HARD-CRASHES this
-- DFHack build on any access, so `savage` is not reported (facts-only: no guess).
-- Invoked by name via DFHack RunCommand; prints ONE JSON object.

local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local WATER_FREEZE = 10000        -- DF temperature units: melting point of water
local BIOME_STEP   = 11           -- surface-sample grid stride (tiles)
local SEASONS = { [0] = 'spring', [1] = 'summer', [2] = 'autumn', [3] = 'winter' }
local WEATHER = { [0] = 'none', [1] = 'rain', [2] = 'snow' }

local m = df.global.world.map
local wd = df.global.world.world_data

-- ---- season ----
local season = df.global.cur_season
local season_name = SEASONS[season] or tostring(season)

-- ---- weather: dominant cell over the 5x5 grid ----
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

-- ---- citizen walkability groups (the "reachable by the fort" set) ----
-- Mirrors mcp_defenses: DF precomputes a 3D walk group per walkable tile; two tiles
-- are mutually reachable iff they share one nonzero group. A cavern is "open" when a
-- revealed cavern tile lands in a group a citizen also stands in.
local citizen_groups = {}
for _, u in ipairs(dfhack.units.getCitizens(true)) do
  local p = u.pos
  if p and p.x >= 0 then
    local g = dfhack.maps.getWalkableGroup(xyz2pos(p.x, p.y, p.z))
    if g ~= 0 then citizen_groups[g] = true end
  end
end

-- ---- surface pass: per-column true-surface biome + ambient temperature ----
-- One downward scan per sampled column to the first DISCOVERED, OUTSIDE, solid tile
-- (the real surface); there we read the tile temperature and the surface biome
-- region. Fog of war stays honest: hidden columns contribute nothing.
local function region_at(rx, ry)
  for i = 0, #wd.regions - 1 do
    local rc = wd.regions[i].region_coords
    for j = 0, #rc.x - 1 do
      if rc.x[j] == rx and rc.y[j] == ry then return i end
    end
  end
  return nil
end

local rgn_seen = {}            -- world-region index -> true (dedup)
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

-- representative surface temperature = median of the samples (robust to a stray
-- sun-warmed construction tile). No samples (fully roofed/hidden) => nil.
local surface_temp
if #temps > 0 then
  table.sort(temps)
  surface_temp = temps[math.ceil(#temps / 2)]
end
local water_frozen = (surface_temp ~= nil) and (surface_temp <= WATER_FREEZE) or false
local temperature_band
if surface_temp == nil then temperature_band = 'unknown'
elseif surface_temp <= WATER_FREEZE then temperature_band = 'freezing'
else temperature_band = 'above_freezing' end

-- ---- caverns: only those the fort has BREACHED (Discovered), open vs sealed ----
-- Collect the distinct global-feature ids referenced by loaded blocks, resolve each
-- to its init feature, and keep the DISCOVERED subterranean (cavern) layers. Then a
-- single block pass tests, per discovered cavern, whether a REVEALED tile shares a
-- citizen walk group (open) or none do (sealed).
local cavern_of_gf = {}        -- global_feature id -> cavern number (1..3)
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

local cavern_open = {}         -- cavern number -> bool (open to fort)
for _, num in pairs(cavern_of_gf) do cavern_open[num] = false end
local any_discovered = next(cavern_of_gf) ~= nil
if any_discovered then
  for _, b in ipairs(m.map_blocks) do
    local num = cavern_of_gf[b.global_feature]
    if num and not cavern_open[num] then
      local bx, by, bz = b.map_pos.x, b.map_pos.y, b.map_pos.z
      for lx = 0, 15 do
        for ly = 0, 15 do
          if not b.designation[lx][ly].hidden then
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

-- ---- alerts: factual restatements the game would nag about ----
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
    temperature_band = temperature_band,
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

-- mcp_geology: a one-call geological survey of the embark. REVEALED-INFO ONLY by
-- default — the geological substrate a player has actually exposed, plus the two
-- survey facts known from embark (aquifer, surface water). The deep secrets
-- (caverns, the magma sea) are FOG-OF-WAR gated: an undiscovered cavern or an
-- unreached magma sea is ABSENT from the payload, never leaked as a z-range the
-- player has not earned. Pass reveal_hidden=true to bypass that gate (a debug /
-- spoiler switch), which surfaces every cavern + the magma sea with z-ranges
-- regardless of discovery.
--
-- FACTS ONLY: labeled layers, materials, depths, presence/absence. No "dig here",
-- no "smooth the aquifer" — the pairing (light aquifer at z125-128) is the fact;
-- the agent draws the conclusion. alerts[] only RESTATES facts that crossed a line.
--
-- Data model (verified live on DFHack 53.15, fort at 127.0.0.1:5002):
--   * Local layers: each tile's designation.geolayer_index indexes the tile's
--     geo biome's layer stack. The geo biome for a tile is
--     getRegionBiome(getTileBiomeRgn(pos)).geo_index -> world_data.geo_biomes[gi].
--     layers[geolayer_index] carries {type=geo_layer_type, mat_index=inorganic}.
--     Material name via dfhack.matinfo.decode(0, mat_index). L.top_height/
--     bottom_height are WORLD elevations (0 here), NOT local z — so bands are
--     reconstructed by grouping consecutive z-levels with the same material set.
--   * Aquifer: block.flags.has_aquifer gates a per-tile designation.water_table;
--     occupancy.heavy_aquifer marks the heavy variant. Reported from full map data
--     (a survey fact known at embark), not fog-gated, filtered by the block flag.
--   * Caverns / magma sea / underworld: world.features.map_features holds the
--     LOCAL feature layers (type 7 = subterranean cavern, 8 = magma_core,
--     9 = underworld). flags.Discovered is the authoritative fog-of-war gate;
--     feature.min_map_z/max_map_z give the LOCAL z-range. start_depth orders the
--     caverns (0=first cavern). A cavern's water is read by scanning its z-band for
--     liquid water among tiles the player may see (hidden tiles skipped unless
--     reveal_hidden), so the water fact stays fog-honest too.
--   * Surface water: brook tiletype material, RIVER/RIVER_SOURCE tiletype special
--     and block has_river_* flags, murky pools as connected stagnant-water bodies
--     on revealed outside tiles. Freeze is biome-temperature derived (see below).
--
-- Bounded: layer bands and cavern rows are O(depth); the per-tile scan is one pass.
-- Invoked by name via DFHack RunCommand; prints ONE JSON object.

local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local args = { ... }
local reveal_hidden = args[1] == 'true' or args[1] == '1'

local w = df.global.world
local ttattrs = df.tiletype.attrs
local SHAPE = df.tiletype_shape
local TMAT = df.tiletype_material
local TSPECIAL = df.tiletype_special
local GLT = df.geo_layer_type

-- Freezing point of water in DF tile temperature units (urist); 10000 = 0C.
-- Region biome temperature is stored in Fahrenheit-scaled units; 32F is the
-- freeze point. A biome whose base temperature is at or below freezing keeps its
-- surface water frozen (glacier / tundra) — reported conservatively: a warmer
-- biome that freezes only in deep winter is NOT flagged, so we never fabricate a
-- freeze. (This fixture's biomes are 77-81F; the true/frozen path is untested.)
local FREEZE_F = 32

-- geo_layer_type enum -> readable kind. All SOIL* variants collapse to 'soil'
-- (the material name already distinguishes sand/clay/etc.).
local function kind_of(t)
  local n = GLT[t]
  if n == nil then return 'unknown' end
  if n:sub(1, 4) == 'SOIL' then return 'soil' end
  return n:lower()
end

-- cache: inorganic mat_index -> solid-state display name (what wiki/game_data resolve)
local mat_name_cache = {}
local function mat_name(mi)
  local c = mat_name_cache[mi]
  if c ~= nil then return c end
  local info = dfhack.matinfo.decode(0, mi)
  local name = info and info.material and info.material.state_name.Solid or ('material ' .. mi)
  mat_name_cache[mi] = name
  return name
end

-- cache: block region-biome key -> geo_index (one lookup per block center)
local geo_cache = {}
local function geo_index_at(x, y, z)
  local rx, ry = dfhack.maps.getTileBiomeRgn(xyz2pos(x, y, z))
  if not rx then return nil end
  local key = rx * 100000 + ry
  local gi = geo_cache[key]
  if gi ~= nil then return gi end
  local rb = dfhack.maps.getRegionBiome(rx, ry)
  gi = rb and rb.geo_index or nil
  geo_cache[key] = gi or false
  return gi
end

-- ---- single pass over the map -------------------------------------------------
local surface_z = -1
local revealed_zmin, revealed_zmax = math.huge, -1
local aq_present, aq_heavy, aq_zmin, aq_zmax = false, false, math.huge, -1
local magma_revealed = false
local brook, river = false, false
local pool_tiles = {}            -- "x,y,z" -> true (revealed stagnant surface water)
local perZ = {}                  -- z -> { ["kind\tmaterial"] = {kind=, material=} }

-- fort biome base temperatures (for the freeze fact), keyed by region tile
local biome_temp_min = math.huge

local blocks = w.map.map_blocks
for _, blk in ipairs(blocks) do
  local bz = blk.map_pos.z
  local has_aq = blk.flags.has_aquifer
  if blk.flags.has_river_high or blk.flags.has_river_medium or blk.flags.has_river_low then
    river = true
  end
  -- one geo lookup per block (center), reused for this block's sampled tiles
  local block_gi = geo_index_at(blk.map_pos.x + 8, blk.map_pos.y + 8, bz)

  for lx = 0, 15 do
    for ly = 0, 15 do
      local des = blk.designation[lx][ly]
      local hidden = des.hidden
      local visible = not hidden
      if visible then
        if bz < revealed_zmin then revealed_zmin = bz end
        if bz > revealed_zmax then revealed_zmax = bz end
        local tt = blk.tiletype[lx][ly]
        local a = ttattrs[tt]
        if des.outside then
          local shp = SHAPE[a.shape]
          if (shp == 'FLOOR' or shp == 'RAMP') and bz > surface_z then surface_z = bz end
        end
        -- magma actually visible on the map
        if des.flow_size > 0 and des.liquid_type then magma_revealed = true end
        -- surface water tiletypes
        if TMAT[a.material] == 'BROOK' then brook = true end
        local sp = TSPECIAL[a.special]
        if sp == 'RIVER_SOURCE' then river = true end
        -- murky pool: stagnant fresh water on an outside tile
        if des.outside and des.flow_size > 0 and not des.liquid_type
          and des.water_stagnant then
          pool_tiles[(blk.map_pos.x + lx) .. ',' .. (blk.map_pos.y + ly) .. ',' .. bz] = true
        end
      end
      -- aquifer: survey fact, read from full map data (not fog-gated), block-filtered
      if has_aq and des.water_table then
        aq_present = true
        if bz < aq_zmin then aq_zmin = bz end
        if bz > aq_zmax then aq_zmax = bz end
        if blk.occupancy[lx][ly].heavy_aquifer then aq_heavy = true end
      end
      -- layer sampling: the geological stack is embark-survey knowledge (the
      -- layers a player reads off the embark screen), so it is sampled from FULL
      -- map data — deterministically, not from whichever columns happen to be dug
      -- — on a coarse stride. The DEPTH shown is fog-gated at build time (default
      -- stops at the deepest revealed z; reveal_hidden shows the full column).
      if block_gi and lx % 4 == 0 and ly % 4 == 0 then
        local L = w.world_data.geo_biomes[block_gi].layers[des.geolayer_index]
        if L then
          local bucket = perZ[bz]
          if not bucket then bucket = {}; perZ[bz] = bucket end
          local kind = kind_of(L.type)
          local material = mat_name(L.mat_index)
          bucket[kind .. '\t' .. material] = { kind = kind, material = material }
        end
      end
    end
  end
end

-- fort biome temperatures for the freeze fact (sample the surface region tiles)
if surface_z >= 0 then
  for _, blk in ipairs(blocks) do
    if blk.map_pos.z == surface_z then
      local rx, ry = dfhack.maps.getTileBiomeRgn(xyz2pos(blk.map_pos.x + 8, blk.map_pos.y + 8, surface_z))
      if rx then
        local rb = dfhack.maps.getRegionBiome(rx, ry)
        if rb and rb.temperature < biome_temp_min then biome_temp_min = rb.temperature end
      end
    end
  end
end

if surface_z < 0 then surface_z = revealed_zmax end

-- ---- build layer bands from perZ (group consecutive z with the same set) ------
-- Walk z from surface downward; a band runs while the (kind,material) set is
-- unchanged. Each band reports its kind (single, or 'mixed' across biomes) and
-- the sorted unique material names (in-game names wiki/game_data resolve). The
-- window is fog-gated: the top is the surface; the bottom is the deepest revealed
-- z by default (what the fort has exposed), or the map bottom with reveal_hidden.
local z_floor = reveal_hidden and 0 or ((revealed_zmin ~= math.huge) and revealed_zmin or 0)
local zs = {}
for z in pairs(perZ) do
  if z <= surface_z and z >= z_floor then zs[#zs + 1] = z end
end
table.sort(zs, function(a, b) return a > b end)

local function signature(bucket)
  local keys = {}
  for k in pairs(bucket) do keys[#keys + 1] = k end
  table.sort(keys)
  return table.concat(keys, '|')
end

local layers = {}
local cur
for _, z in ipairs(zs) do
  local sig = signature(perZ[z])
  if cur and cur.sig == sig and z == cur.z_bottom - 1 then
    cur.z_bottom = z
  else
    if cur then layers[#layers + 1] = cur end
    -- materialize a fresh band
    local kinds, mats = {}, {}
    for _, e in pairs(perZ[z]) do
      kinds[e.kind] = true
      mats[e.material] = true
    end
    local kcount, kone = 0, nil
    for k in pairs(kinds) do kcount = kcount + 1; kone = k end
    local mlist = {}
    for m in pairs(mats) do mlist[#mlist + 1] = m end
    table.sort(mlist)
    cur = { z_top = z, z_bottom = z, kind = (kcount == 1) and kone or 'mixed', materials = mlist, sig = sig }
  end
end
if cur then layers[#layers + 1] = cur end
for _, b in ipairs(layers) do b.sig = nil end   -- drop the internal grouping key

-- ---- aquifer block ------------------------------------------------------------
local aquifer
if aq_present then
  aquifer = { present = true, type = aq_heavy and 'heavy' or 'light', z_top = aq_zmax, z_bottom = aq_zmin }
else
  aquifer = { present = false }
end

-- ---- caverns + magma sea (fog-of-war gated) -----------------------------------
-- Read the local feature layers. A cavern/magma is DISCOVERED per its
-- flags.Discovered bit; undiscovered ones are OMITTED unless reveal_hidden. Water
-- for a cavern is scanned from its z-band, skipping hidden tiles unless revealed,
-- so the water fact obeys the same fog-of-war rule.
local function zband_has_water(zb, zt)
  for _, blk in ipairs(blocks) do
    local bz = blk.map_pos.z
    if bz >= zb and bz <= zt then
      for lx = 0, 15 do
        for ly = 0, 15 do
          local des = blk.designation[lx][ly]
          if (reveal_hidden or not des.hidden) and des.flow_size > 0 and not des.liquid_type then
            return true
          end
        end
      end
    end
  end
  return false
end

local function feature_zrange(f)
  local zmin, zmax = math.huge, -1
  for j = 0, #f.min_map_z - 1 do
    local a, b = f.min_map_z[j], f.max_map_z[j]
    if a < zmin then zmin = a end
    if b > zmax then zmax = b end
  end
  return zmin, zmax
end

local caverns_discovered = {}
local caverns_hidden = {}
local magma_reached = magma_revealed
local magma_hidden      -- z-range of the (undiscovered) magma sea, only when reveal_hidden

local mf = w.features.map_features
for i = 0, #mf - 1 do
  local feat = mf[i]
  local ft = feat:getType()
  if ft == df.feature_type.subterranean_from_layer then
    local zmin, zmax = feature_zrange(feat.feature)
    local row = {
      layer = feat.start_depth + 1,           -- 1 = first cavern
      z_top = zmax,
      z_bottom = zmin,
      water = zband_has_water(zmin, zmax),
    }
    if feat.flags.Discovered then
      caverns_discovered[#caverns_discovered + 1] = row
    elseif reveal_hidden then
      caverns_hidden[#caverns_hidden + 1] = row
    end
  elseif ft == df.feature_type.magma_core_from_layer then
    if feat.flags.Discovered then magma_reached = true end
    if reveal_hidden and not feat.flags.Discovered then
      local zmin, zmax = feature_zrange(feat.feature)
      magma_hidden = { z_top = zmax, z_bottom = zmin }
    end
  end
end
table.sort(caverns_discovered, function(a, b) return a.z_top > b.z_top end)
table.sort(caverns_hidden, function(a, b) return a.z_top > b.z_top end)

-- ---- surface water ------------------------------------------------------------
-- murky pools: count connected components (4-neighbour, same z) of the collected
-- stagnant surface-water tiles, so overlapping tiles read as one pool.
local function count_pools()
  local seen = {}
  local n = 0
  for key in pairs(pool_tiles) do
    if not seen[key] then
      n = n + 1
      -- flood the component
      local stack = { key }
      seen[key] = true
      while #stack > 0 do
        local k = table.remove(stack)
        local x, y, z = k:match('(-?%d+),(-?%d+),(-?%d+)')
        x, y, z = tonumber(x), tonumber(y), tonumber(z)
        for _, d in ipairs({ { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }) do
          local nk = (x + d[1]) .. ',' .. (y + d[2]) .. ',' .. z
          if pool_tiles[nk] and not seen[nk] then seen[nk] = true; stack[#stack + 1] = nk end
        end
      end
    end
  end
  return n
end

local frozen = (biome_temp_min ~= math.huge) and (biome_temp_min <= FREEZE_F) or false
local surface_water = {
  brook = brook,
  river = river,
  murky_pools = count_pools(),
  frozen_in_winter = frozen,
}

-- ---- alerts: factual restatements only ----------------------------------------
local alerts = {}
if aq_present then
  alerts[#alerts + 1] = (aq_heavy and 'heavy' or 'light') .. ' aquifer at z' .. aq_zmin .. '-' .. aq_zmax
end
if magma_reached then
  alerts[#alerts + 1] = 'magma sea reached'
end

-- ---- emit ---------------------------------------------------------------------
local out = {
  surface_z = surface_z,
  layers = layers,
  aquifer = aquifer,
  caverns_discovered = caverns_discovered,
  magma_reached = magma_reached,
  surface_water = surface_water,
  alerts = alerts,
}
-- fog-piercing extras only appear under the documented spoiler switch, so the
-- default payload never carries a tell about undiscovered depths.
if reveal_hidden then
  out.reveal_hidden = true
  out.caverns_hidden = caverns_hidden
  if magma_hidden then out.magma_hidden = magma_hidden end
end
emit(out)

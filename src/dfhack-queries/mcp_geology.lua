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
--     caverns (0=first cavern). Caverns are GLOBAL features: block.global_feature
--     resolves (getGlobalInitFeature) to the map_features entry, and per-tile
--     designation.feature_global marks its tiles — so a cavern's water is counted
--     only on ITS OWN tiles (a cistern/aquifer seep in the same z-band is not
--     miscredited), hidden tiles skipped unless reveal_hidden. magma_reached is
--     the magma-SEA discovery flag ALONE — never a volcano / pool / hauled magma.
--   * Surface water: brook tiletype material, RIVER/RIVER_SOURCE tiletype special
--     and block has_river_* flags, murky pools as connected stagnant-water bodies
--     on revealed outside tiles. permanent_freeze is biome-base-temperature
--     derived (year-round ice; NOT a seasonal winter claim — see below).
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

-- Region biome temperature is stored in Fahrenheit-scaled units; 32F is the
-- freeze point of water. A biome whose BASE temperature is at or below freezing
-- has permanently frozen surface water (glacier / tundra) — that is what
-- surface_water.permanent_freeze reports. It is deliberately NOT a seasonal
-- "freezes in winter" claim: DF 53.15 does not reliably expose a per-biome winter
-- minimum (plotinfo hi/lo temp read back as sentinels), so seasonal freezing is
-- not computed and a warm biome that freezes only in deep winter is not flagged.
-- (This fixture's biomes are 77-81F; the true/frozen path is untested here.)
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

-- cache: region-biome key -> geo_index. A tile's geo biome is resolved from THAT
-- TILE's own biome (getTileBiomeRgn honours the per-tile designation.biome), not
-- the block centre — a block that straddles a biome boundary has tiles indexing
-- different geo layer tables, and the block centre would mislabel the boundary
-- tiles. A per-block cache keyed by the tile's designation.biome (0-8, the 3x3
-- neighbour selector) collapses getTileBiomeRgn to ~one call per distinct biome
-- per block, so per-tile correctness costs no measurable throughput.
local geo_cache = {}
local function geo_index_at(x, y, z)
  local rx, ry = dfhack.maps.getTileBiomeRgn(xyz2pos(x, y, z))
  if not rx then return nil end
  local key = rx * 100000 + ry
  local gi = geo_cache[key]
  if gi ~= nil then return gi or nil end
  local rb = dfhack.maps.getRegionBiome(rx, ry)
  gi = rb and rb.geo_index or false
  geo_cache[key] = gi
  return gi or nil
end

-- ---- single pass over the map -------------------------------------------------
local surface_z = -1
local revealed_zmin, revealed_zmax = math.huge, -1
local aq_present, aq_heavy, aq_zmin, aq_zmax = false, false, math.huge, -1
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
  -- per-block cache: this tile's designation.biome -> geo_index, so a boundary
  -- block resolves each tile against its OWN biome (not the block centre).
  local biome_geo = {}

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
      if lx % 4 == 0 and ly % 4 == 0 then
        local b = des.biome
        local gi = biome_geo[b]
        if gi == nil then
          gi = geo_index_at(blk.map_pos.x + lx, blk.map_pos.y + ly, bz) or false
          biome_geo[b] = gi
        end
        local L = gi and w.world_data.geo_biomes[gi].layers[des.geolayer_index]
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
-- flags.Discovered bit; undiscovered ones are OMITTED unless reveal_hidden.
local mf = w.features.map_features

local function feature_zrange(f)
  local zmin, zmax = math.huge, -1
  for j = 0, #f.min_map_z - 1 do
    local a, b = f.min_map_z[j], f.max_map_z[j]
    if a < zmin then zmin = a end
    if b > zmax then zmax = b end
  end
  return zmin, zmax
end

-- Cavern water, SCOPED to each cavern's own tiles. A cavern is a GLOBAL feature:
-- block.global_feature resolves (via getGlobalInitFeature) to the map_features
-- entry, and designation.feature_global marks the tiles that belong to it. We
-- count water only on those tiles, so a cistern or an aquifer seep sharing the
-- cavern's z-band does NOT get miscredited as cavern water. Built in one pass and
-- keyed by map_features index; hidden tiles are skipped unless reveal_hidden, so
-- the water fact obeys the same fog-of-war rule as the cavern itself.
local gfeat_to_mf = {}         -- block.global_feature index -> map_features index (cached)
local function mf_index_of_gfeat(gf)
  local cached = gfeat_to_mf[gf]
  if cached ~= nil then return cached or nil end
  local finit = dfhack.maps.getGlobalInitFeature(gf)
  local idx = false
  if finit then
    for i = 0, #mf - 1 do
      if mf[i] == finit then idx = i; break end
    end
  end
  gfeat_to_mf[gf] = idx
  return idx or nil
end

local feature_water = {}       -- map_features index -> true if that cavern holds water
for _, blk in ipairs(blocks) do
  local gf = blk.global_feature
  if gf ~= -1 then
    local mi = mf_index_of_gfeat(gf)
    if mi ~= nil and not feature_water[mi] then
      for lx = 0, 15 do
        for ly = 0, 15 do
          local des = blk.designation[lx][ly]
          if des.feature_global and (reveal_hidden or not des.hidden)
            and des.flow_size > 0 and not des.liquid_type then
            feature_water[mi] = true
          end
        end
      end
    end
  end
end

local caverns_discovered = {}
local caverns_hidden = {}
local magma_reached = false    -- true ONLY when the magma-SEA layer is discovered,
                               -- never for a volcano / magma pool / hauled magma
local magma_hidden             -- z-range of the (undiscovered) magma sea, only when reveal_hidden

for i = 0, #mf - 1 do
  local feat = mf[i]
  local ft = feat:getType()
  if ft == df.feature_type.subterranean_from_layer then
    local zmin, zmax = feature_zrange(feat.feature)
    local row = {
      layer = feat.start_depth + 1,           -- 1 = first cavern
      z_top = zmax,
      z_bottom = zmin,
      water = feature_water[i] or false,
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

-- permanent_freeze: the biome's base temperature is at or below freezing, so its
-- surface water is ice YEAR-ROUND (glacier / tundra). This is NOT seasonal winter
-- freezing: DF 53.15 exposes only the biome base temperature (plotinfo hi/lo temp
-- read back as sentinels on this build), so a warm biome that freezes only in deep
-- winter is honestly NOT flagged — the field claims permanent freeze, not seasonal.
local permanent_freeze = (biome_temp_min ~= math.huge) and (biome_temp_min <= FREEZE_F) or false
local surface_water = {
  brook = brook,
  river = river,
  murky_pools = count_pools(),
  permanent_freeze = permanent_freeze,
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

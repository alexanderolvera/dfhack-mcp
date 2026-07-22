-- mcp_geology: see docs/tools/geology.md for the data model and field paths.

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

-- Fahrenheit-scaled; see docs/tools/geology.md for the permanent_freeze derivation.
local FREEZE_F = 32

local function kind_of(t)
  local n = GLT[t]
  if n == nil then return 'unknown' end
  if n:sub(1, 4) == 'SOIL' then return 'soil' end
  return n:lower()
end

local mat_name_cache = {}
local function mat_name(mi)
  local c = mat_name_cache[mi]
  if c ~= nil then return c end
  local info = dfhack.matinfo.decode(0, mi)
  local name = info and info.material and info.material.state_name.Solid or ('material ' .. mi)
  mat_name_cache[mi] = name
  return name
end

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

local surface_z = -1
local revealed_zmin, revealed_zmax = math.huge, -1
local aq_present, aq_heavy, aq_zmin, aq_zmax = false, false, math.huge, -1
local brook, river = false, false
local pool_tiles = {}
local perZ = {}

local biome_temp_min = math.huge

local blocks = w.map.map_blocks
for _, blk in ipairs(blocks) do
  local bz = blk.map_pos.z
  local has_aq = blk.flags.has_aquifer
  if blk.flags.has_river_high or blk.flags.has_river_medium or blk.flags.has_river_low then
    river = true
  end
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
        if TMAT[a.material] == 'BROOK' then brook = true end
        local sp = TSPECIAL[a.special]
        if sp == 'RIVER_SOURCE' then river = true end
        if des.outside and des.flow_size > 0 and not des.liquid_type
          and des.water_stagnant then
          pool_tiles[(blk.map_pos.x + lx) .. ',' .. (blk.map_pos.y + ly) .. ',' .. bz] = true
        end
      end
      if has_aq and des.water_table then
        aq_present = true
        if bz < aq_zmin then aq_zmin = bz end
        if bz > aq_zmax then aq_zmax = bz end
        if blk.occupancy[lx][ly].heavy_aquifer then aq_heavy = true end
      end
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
for _, b in ipairs(layers) do b.sig = nil end

local aquifer
if aq_present then
  aquifer = { present = true, type = aq_heavy and 'heavy' or 'light', z_top = aq_zmax, z_bottom = aq_zmin }
else
  aquifer = { present = false }
end

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

local gfeat_to_mf = {}
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

local feature_water = {}
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
local magma_reached = false
local magma_hidden

for i = 0, #mf - 1 do
  local feat = mf[i]
  local ft = feat:getType()
  if ft == df.feature_type.subterranean_from_layer then
    local zmin, zmax = feature_zrange(feat.feature)
    local row = {
      layer = feat.start_depth + 1,
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

local function count_pools()
  local seen = {}
  local n = 0
  for key in pairs(pool_tiles) do
    if not seen[key] then
      n = n + 1
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

local permanent_freeze = (biome_temp_min ~= math.huge) and (biome_temp_min <= FREEZE_F) or false
local surface_water = {
  brook = brook,
  river = river,
  murky_pools = count_pools(),
  permanent_freeze = permanent_freeze,
}

local out = {
  surface_z = surface_z,
  layers = layers,
  aquifer = aquifer,
  caverns_discovered = caverns_discovered,
  magma_reached = magma_reached,
  surface_water = surface_water,
}
if reveal_hidden then
  out.reveal_hidden = true
  out.caverns_hidden = caverns_hidden
  if magma_hidden then out.magma_hidden = magma_hidden end
end
emit(out)

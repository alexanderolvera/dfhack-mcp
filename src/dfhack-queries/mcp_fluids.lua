local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local terrain = reqscript('mcp_readTerrain')

local TILE_BUDGET = 20000000
local AQUIFER_LAYERS_CAP = 50
local WATER_LAYERS_CAP = 200
local FLOOD_RISK_CAP = 50
local WELLS_CAP = 20
local WELL_SCAN_DEPTH = 40
local MAGMA_SEA_MIN_TILES = 20

local m = df.global.world.map
local x_count, y_count, z_count = m.x_count, m.y_count, m.z_count

local function cheb(ax, ay, bx, by) return math.max(math.abs(ax - bx), math.abs(ay - by)) end
local function bearing(fromx, fromy, tox, toy)
  local dx, dy = tox - fromx, toy - fromy
  local tol = 2
  local s = ''
  if dy < -tol then s = 'N' elseif dy > tol then s = 'S' end
  if dx > tol then s = s .. 'E' elseif dx < -tol then s = s .. 'W' end
  return (s == '') and 'here' or s
end

local cx, cy, cz, n = 0, 0, 0, 0
local interior_groups = {}
for _, u in ipairs(dfhack.units.getCitizens(true)) do
  local p = u.pos
  if p and p.x >= 0 then
    cx = cx + p.x; cy = cy + p.y; cz = cz + p.z; n = n + 1
    local g = dfhack.maps.getWalkableGroup(xyz2pos(p.x, p.y, p.z))
    if g ~= 0 then interior_groups[g] = true end
  end
end
local core = (n > 0) and { x = math.floor(cx / n), y = math.floor(cy / n), z = math.floor(cz / n) } or nil

local function near_interior(x, y, z)
  for dy = -1, 1 do
    for dx = -1, 1 do
      if not (dx == 0 and dy == 0) then
        local nx, ny = x + dx, y + dy
        if nx >= 0 and ny >= 0 and nx < x_count and ny < y_count then
          local blk = dfhack.maps.getTileBlock(nx, ny, z)
          local revealed = blk and not blk.designation[nx % 16][ny % 16].hidden
          if revealed then
            local g = dfhack.maps.getWalkableGroup(xyz2pos(nx, ny, z))
            if g ~= 0 and interior_groups[g] then return true end
          end
        end
      end
    end
  end
  return false
end

local aquifer_by_z = {}
local water_by_z = {}
local magma_by_z = {}

-- flood_risk_tiles must be the TRUE global top FLOOD_RISK_CAP by (z desc, x
-- asc, y asc), and flood_risk_total the true count of every qualifying tile
-- -- not just however many were seen before some collection limit. Because
-- the outer scan already walks z in strictly descending order (the sort's
-- own primary key), every tile at a given z sorts before every tile at any
-- lower z regardless of x/y. So: batch candidates per z-level, sort each
-- batch once its z finishes, and merge it into the running top-N -- once
-- that running set already holds FLOOD_RISK_CAP entries from z-levels at or
-- above the current one, no lower z can ever displace them, so candidate
-- collection (not the total count, which keeps running) can stop for good.
local flood_risk = {}
local flood_risk_total = 0
local collecting_candidates = true

local scanned_tiles = 0
local scan_complete = true
local last_z_scanned = nil

for z = z_count - 1, 0, -1 do
  if scanned_tiles >= TILE_BUDGET then scan_complete = false; break end
  last_z_scanned = z
  local level_candidates = {}
  local by = 0
  while by < y_count do
    local bx = 0
    while bx < x_count do
      local blk = dfhack.maps.getTileBlock(bx, by, z)
      if blk then
        for ly = 0, 15 do
          local y = by + ly
          if y < y_count then
            for lx = 0, 15 do
              local x = bx + lx
              if x < x_count then
                scanned_tiles = scanned_tiles + 1
                local des = blk.designation[lx][ly]
                if not des.hidden then
                  if des.water_table then
                    local occ = blk.occupancy[lx][ly]
                    local bucket = aquifer_by_z[z]
                    if not bucket then bucket = { light = 0, heavy = 0 }; aquifer_by_z[z] = bucket end
                    if occ.heavy_aquifer then bucket.heavy = bucket.heavy + 1
                    else bucket.light = bucket.light + 1 end
                  end
                  if des.flow_size > 0 then
                    if des.liquid_type then
                      magma_by_z[z] = (magma_by_z[z] or 0) + 1
                    else
                      local wb = water_by_z[z]
                      if not wb then
                        wb = { tiles = 0, salt = 0, fresh = 0, stagnant = 0, flowing = 0, max_depth = 0 }
                        water_by_z[z] = wb
                      end
                      wb.tiles = wb.tiles + 1
                      if des.water_salt then wb.salt = wb.salt + 1 else wb.fresh = wb.fresh + 1 end
                      if des.water_stagnant then wb.stagnant = wb.stagnant + 1 else wb.flowing = wb.flowing + 1 end
                      if des.flow_size > wb.max_depth then wb.max_depth = des.flow_size end
                      if des.flow_size >= 7 and core and near_interior(x, y, z) then
                        flood_risk_total = flood_risk_total + 1
                        if collecting_candidates then
                          level_candidates[#level_candidates + 1] = {
                            x = x, y = y, z = z,
                            salt = des.water_salt, stagnant = des.water_stagnant,
                            footing = terrain.sym(blk.tiletype[lx][ly], false),
                            from_core = { dist = cheb(x, y, core.x, core.y), dz = core.z - z,
                                          dir = bearing(core.x, core.y, x, y) },
                          }
                        end
                      end
                    end
                  end
                end
              end
            end
          end
        end
      end
      bx = bx + 16
    end
    by = by + 16
  end

  if collecting_candidates and #level_candidates > 0 then
    table.sort(level_candidates, function(a, b)
      if a.x ~= b.x then return a.x < b.x end
      return a.y < b.y
    end)
    for _, c in ipairs(level_candidates) do flood_risk[#flood_risk + 1] = c end
    if #flood_risk >= FLOOD_RISK_CAP then collecting_candidates = false end
  end
end

local flood_risk_truncated = false
if #flood_risk > FLOOD_RISK_CAP then
  local capped = {}
  for i = 1, FLOOD_RISK_CAP do capped[i] = flood_risk[i] end
  flood_risk = capped
  flood_risk_truncated = true
elseif flood_risk_total > #flood_risk then
  flood_risk_truncated = true
end

local function classify(b)
  if b.heavy > 0 and b.light > 0 then return 'mixed'
  elseif b.heavy > 0 then return 'heavy'
  else return 'light' end
end

local aq_zs = {}
for z in pairs(aquifer_by_z) do aq_zs[#aq_zs + 1] = z end
table.sort(aq_zs, function(a, b) return a > b end)

local aquifer_layers = {}
local cur = nil
for _, z in ipairs(aq_zs) do
  local b = aquifer_by_z[z]
  local cls = classify(b)
  if cur and cur.classification == cls and cur.z_bottom == z + 1 then
    cur.z_bottom = z
    cur.light_tiles = cur.light_tiles + b.light
    cur.heavy_tiles = cur.heavy_tiles + b.heavy
  else
    cur = { z_top = z, z_bottom = z, classification = cls, light_tiles = b.light, heavy_tiles = b.heavy }
    aquifer_layers[#aquifer_layers + 1] = cur
  end
end
local aquifer_layers_total = #aquifer_layers
local aquifer_layers_truncated = false
if #aquifer_layers > AQUIFER_LAYERS_CAP then
  local capped = {}
  for i = 1, AQUIFER_LAYERS_CAP do capped[i] = aquifer_layers[i] end
  aquifer_layers = capped
  aquifer_layers_truncated = true
end

local water_zs = {}
for z in pairs(water_by_z) do water_zs[#water_zs + 1] = z end
table.sort(water_zs, function(a, b) return a > b end)

local water_layers = {}
for _, z in ipairs(water_zs) do
  local wb = water_by_z[z]
  water_layers[#water_layers + 1] = {
    z = z, tiles = wb.tiles, salt_tiles = wb.salt, fresh_tiles = wb.fresh,
    stagnant_tiles = wb.stagnant, flowing_tiles = wb.flowing, max_depth = wb.max_depth,
  }
end
local water_layers_total = #water_layers
local water_layers_truncated = false
if #water_layers > WATER_LAYERS_CAP then
  local capped = {}
  for i = 1, WATER_LAYERS_CAP do capped[i] = water_layers[i] end
  water_layers = capped
  water_layers_truncated = true
end

local magma_sea = nil
do
  local zs = {}
  for z in pairs(magma_by_z) do zs[#zs + 1] = z end
  table.sort(zs, function(a, b) return a > b end)
  for _, z in ipairs(zs) do
    if magma_by_z[z] >= MAGMA_SEA_MIN_TILES then
      magma_sea = { top_z = z, revealed_tile_count = magma_by_z[z] }
      break
    end
  end
end

local function well_water_source(w)
  local x, y = w.centerx, w.centery
  for z = w.z, math.max(0, w.z - WELL_SCAN_DEPTH), -1 do
    local blk = dfhack.maps.getTileBlock(x, y, z)
    if blk then
      local lx, ly = x % 16, y % 16
      local des = blk.designation[lx][ly]
      if des.hidden then return { source = 'unknown', depth_to_source = nil } end
      if des.flow_size > 0 then
        return { source = des.liquid_type and 'magma' or 'water', depth_to_source = w.z - z }
      end
      local mat = df.tiletype.attrs[blk.tiletype[lx][ly]].material
      if df.tiletype_material[mat] == 'FROZEN_LIQUID' then
        return { source = 'frozen', depth_to_source = w.z - z }
      end
    end
  end
  return { source = 'unknown', depth_to_source = nil }
end

local well_bldgs = df.global.world.buildings.other.WELL or {}
local wells = {}
for _, w in ipairs(well_bldgs) do
  local found = well_water_source(w)
  wells[#wells + 1] = {
    x = w.centerx, y = w.centery, z = w.z,
    source = found.source, depth_to_source = found.depth_to_source,
  }
end
table.sort(wells, function(a, b)
  if a.z ~= b.z then return a.z > b.z end
  if a.x ~= b.x then return a.x < b.x end
  return a.y < b.y
end)
local wells_total = #wells
local wells_truncated = false
if #wells > WELLS_CAP then
  local capped = {}
  for i = 1, WELLS_CAP do capped[i] = wells[i] end
  wells = capped
  wells_truncated = true
end

emit({
  aquifer_layers = aquifer_layers,
  aquifer_layers_total = aquifer_layers_total,
  aquifer_layers_truncated = aquifer_layers_truncated,
  water_layers = water_layers,
  water_layers_total = water_layers_total,
  water_layers_truncated = water_layers_truncated,
  magma_sea = magma_sea,
  flood_risk_tiles = flood_risk,
  flood_risk_total = flood_risk_total,
  flood_risk_truncated = flood_risk_truncated,
  wells = wells,
  wells_total = wells_total,
  wells_truncated = wells_truncated,
  legend = terrain.TERRAIN_LEGEND,
  scan = { complete = scan_complete, tiles_scanned = scanned_tiles, last_z_scanned = last_z_scanned },
})

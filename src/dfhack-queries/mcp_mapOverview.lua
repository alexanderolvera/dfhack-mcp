local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local COLUMNS_CAP = 40
local m = df.global.world.map
local SHAPE = df.tiletype_shape
local MAT = df.tiletype_material
local attrs = df.tiletype.attrs

local cx, cy, cz, n = 0, 0, 0, 0
for _, u in ipairs(dfhack.units.getCitizens(true)) do
  local p = u.pos
  if p and p.x >= 0 then cx = cx + p.x; cy = cy + p.y; cz = cz + p.z; n = n + 1 end
end
local core = (n > 0)
  and { x = math.floor(cx / n), y = math.floor(cy / n), z = math.floor(cz / n), citizens = n }
  or nil

local function is_ground(s)
  return s == 'FLOOR' or s == 'RAMP' or s == 'RAMP_TOP' or s == 'BOULDER' or s == 'PEBBLES'
      or s == 'STAIR_UP' or s == 'STAIR_DOWN' or s == 'STAIR_UPDOWN'
end
local surface_z = nil
if core then
  local lx, ly = core.x % 16, core.y % 16
  for z = m.z_count - 1, 0, -1 do
    local blk = dfhack.maps.getTileBlock(core.x, core.y, z)
    if blk then
      local des = blk.designation[lx][ly]
      if not des.hidden and des.outside and is_ground(SHAPE[attrs[blk.tiletype[lx][ly]].shape]) then
        surface_z = z
        break
      end
    end
  end
end

local STAIR = {}
for tt = df.tiletype._first_item, df.tiletype._last_item do
  local a = attrs[tt]
  if a then
    local s = SHAPE[a.shape]
    if s == 'STAIR_UP' then STAIR[tt] = 'U'
    elseif s == 'STAIR_DOWN' then STAIR[tt] = 'D'
    elseif s == 'STAIR_UPDOWN' then STAIR[tt] = 'X' end
  end
end

local col = {}
local dig_zset = {}
for _, b in ipairs(m.map_blocks) do
  local z = b.map_pos.z
  local bx, by = b.map_pos.x, b.map_pos.y
  local tt = b.tiletype
  local des = b.designation
  for lx = 0, 15 do
    local ttx = tt[lx]
    local desx = des[lx]
    for ly = 0, 15 do
      local role = STAIR[ttx[ly]]
      if role and not desx[ly].hidden then
        local key = (bx + lx) .. ',' .. (by + ly)
        local c = col[key]
        if c then
          c.tiles[#c.tiles + 1] = { z = z, s = role }
        else
          col[key] = { x = bx + lx, y = by + ly, tiles = { { z = z, s = role } } }
        end
      end
    end
  end
  if b.flags.designated then
    for lx = 0, 15 do
      local desx = des[lx]
      for ly = 0, 15 do
        if desx[ly].dig ~= 0 then dig_zset[z] = true end
      end
    end
  end
end

local con_zset = {}
for _, c in ipairs(df.construction.get_vector()) do
  con_zset[c.pos.z] = true
end

local function sorted_keys(set)
  local a = {}
  for z in pairs(set) do a[#a + 1] = z end
  table.sort(a)
  return a
end
local construction_z = sorted_keys(con_zset)
local digging_z = sorted_keys(dig_zset)
local union = {}
for z in pairs(con_zset) do union[z] = true end
for z in pairs(dig_zset) do union[z] = true end
local activity_z = sorted_keys(union)

local function connects(lo, hi)
  return hi.z == lo.z + 1
     and (lo.s == 'U' or lo.s == 'X')
     and (hi.s == 'D' or hi.s == 'X')
end
local columns = {}
for _, cell in pairs(col) do
  local x, y, tiles = cell.x, cell.y, cell.tiles
  table.sort(tiles, function(a, b) return a.z < b.z end)
  local start_i = 1
  for i = 1, #tiles do
    if i == #tiles or not connects(tiles[i], tiles[i + 1]) then
      columns[#columns + 1] = { x = x, y = y, z_top = tiles[i].z, z_bottom = tiles[start_i].z }
      start_i = i + 1
    end
  end
end
local function height(c) return c.z_top - c.z_bottom + 1 end
table.sort(columns, function(a, b)
  local ha, hb = height(a), height(b)
  if ha ~= hb then return ha > hb end
  if a.x ~= b.x then return a.x < b.x end
  if a.y ~= b.y then return a.y < b.y end
  return a.z_top < b.z_top
end)
local stair_columns_total = #columns
local stair_columns_truncated = false
if #columns > COLUMNS_CAP then
  local capped = {}
  for i = 1, COLUMNS_CAP do capped[i] = columns[i] end
  columns = capped
  stair_columns_truncated = true
end

local alerts = {}
if core and surface_z == nil then
  alerts[#alerts + 1] = 'fort core column is not open to sky (surface_z unknown)'
end

emit({
  extents = { x = m.x_count, y = m.y_count, z = m.z_count },
  fort_core = core,
  surface_z = surface_z,
  activity = {
    z_levels = activity_z,
    construction_z = construction_z,
    digging_z = digging_z,
  },
  stair_columns = columns,
  stair_columns_total = stair_columns_total,
  stair_columns_truncated = stair_columns_truncated,
  alerts = alerts,
})

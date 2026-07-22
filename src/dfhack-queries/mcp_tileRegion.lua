local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local CAP = 100
local DEFAULT_W, DEFAULT_H = 60, 40

local GLYPHS = {
  ['?'] = 'undiscovered (fog of war)',
  ['#'] = 'undug stone / wall',
  [','] = 'undug soil (sand/clay/loam wall)',
  ['F'] = 'fortification',
  ['.'] = 'dug floor / walkable ground',
  ['r'] = 'ramp',
  ['v'] = 'ramp top',
  ['<'] = 'up stair',
  ['>'] = 'down stair',
  ['x'] = 'up/down stair',
  ['T'] = 'tree',
  ['~'] = 'water / brook',
  [' '] = 'open space',
  ['+'] = 'constructed floor',
  ['%'] = 'magma',
  ['W'] = 'workshop / furnace',
  ['S'] = 'stockpile',
  ['M'] = 'machine (gear/axle/pump/wheel/windmill)',
  ['n'] = 'furniture (bed/chair/table/door/etc)',
}

local CLASS = {}
CLASS['Workshop'] = 'W'; CLASS['Furnace'] = 'W'
CLASS['Stockpile'] = 'S'
for _, t in ipairs({ 'GearAssembly', 'AxleHorizontal', 'AxleVertical', 'Windmill',
                     'WaterWheel', 'ScrewPump', 'Rollers' }) do CLASS[t] = 'M' end
for _, t in ipairs({ 'Bed', 'Chair', 'Table', 'Door', 'Statue', 'Cabinet', 'Box',
                     'Coffin', 'Armorstand', 'Weaponrack', 'Bookcase', 'Cage',
                     'Chain', 'TractionBench', 'Hive', 'NestBox', 'DisplayFurniture',
                     'OfferingPlace', 'ArcheryTarget', 'Slab', 'GrateFloor',
                     'GrateWall', 'BarsFloor', 'BarsVertical', 'WindowGlass',
                     'WindowGem' }) do CLASS[t] = 'n' end

local z_count, z_sx, z_sy = {}, {}, {}
for _, u in ipairs(dfhack.units.getCitizens(true)) do
  local p = u.pos
  if p and p.x >= 0 then
    z_count[p.z] = (z_count[p.z] or 0) + 1
    z_sx[p.z] = (z_sx[p.z] or 0) + p.x
    z_sy[p.z] = (z_sy[p.z] or 0) + p.y
  end
end
local pz, pn = nil, -1
for zz, c in pairs(z_count) do if c > pn then pn = c; pz = zz end end

local a = { ... }
local az, ax0, ay0, ax1, ay1 =
  tonumber(a[1]), tonumber(a[2]), tonumber(a[3]), tonumber(a[4]), tonumber(a[5])

local m = df.global.world.map
local z = az or pz or 0
local x0, y0, w, h, truncated, req_w, req_h

if ax0 and ay0 and ax1 and ay1 then
  local lox, hix = math.min(ax0, ax1), math.max(ax0, ax1)
  local loy, hiy = math.min(ay0, ay1), math.max(ay0, ay1)
  x0, y0 = lox, loy
  w, h = hix - lox + 1, hiy - loy + 1
  req_w, req_h = w, h
  if w > CAP then w = CAP; truncated = true end
  if h > CAP then h = CAP; truncated = true end
else
  w, h = DEFAULT_W, DEFAULT_H
  local anchor = (az and z_count[az] and z_count[az] > 0) and az or pz
  local ccx, ccy
  if anchor and z_count[anchor] and z_count[anchor] > 0 then
    ccx = math.floor(z_sx[anchor] / z_count[anchor])
    ccy = math.floor(z_sy[anchor] / z_count[anchor])
  else
    ccx, ccy = math.floor(m.x_count / 2), math.floor(m.y_count / 2)
  end
  x0 = ccx - math.floor(w / 2)
  y0 = ccy - math.floor(h / 2)
end

if w > m.x_count then w = m.x_count end
if h > m.y_count then h = m.y_count end
x0 = math.max(0, math.min(m.x_count - w, x0))
y0 = math.max(0, math.min(m.y_count - h, y0))
if z < 0 then z = 0 elseif z >= m.z_count then z = m.z_count - 1 end
truncated = truncated or false

local rt = reqscript('mcp_readTerrain')
local win = rt.read_window(x0, y0, z, w, h)

local rows = {}
for i, s in ipairs(win.grid) do
  local r = {}
  for ci = 1, #s do r[ci] = s:sub(ci, ci) end
  rows[i] = r
end

local cache = {}
local function block(x, y)
  if x < 0 or y < 0 or x >= m.x_count or y >= m.y_count then return false end
  local bx, by = x - (x % 16), y - (y % 16)
  local key = bx * 100000 + by
  local v = cache[key]
  if v == nil then v = dfhack.maps.getTileBlock(x, y, z) or false; cache[key] = v end
  return v
end

local LIQUIDS_CAP = 400
local liquids, liquids_truncated = {}, false
for yy = 0, h - 1 do
  local gy = y0 + yy
  local row = rows[yy + 1]
  for xx = 0, w - 1 do
    local base = row[xx + 1]
    if base ~= '?' then
      local gx = x0 + xx
      local blk = block(gx, gy)
      if blk then
        local des = blk.designation[gx % 16][gy % 16]
        if des.flow_size > 0 then
          local is_magma = des.liquid_type
          row[xx + 1] = is_magma and '%' or '~'
          if #liquids < LIQUIDS_CAP then
            liquids[#liquids + 1] =
              { x = gx, y = gy, type = is_magma and 'magma' or 'water', depth = des.flow_size }
          else
            liquids_truncated = true
          end
        elseif base == '#' then
          local tt = blk.tiletype[gx % 16][gy % 16]
          if df.tiletype_material[df.tiletype.attrs[tt].material] == 'SOIL' then
            row[xx + 1] = ','
          end
        elseif base == '.' then
          local tt = blk.tiletype[gx % 16][gy % 16]
          if df.tiletype_material[df.tiletype.attrs[tt].material] == 'CONSTRUCTION' then
            row[xx + 1] = '+'
          end
        end
      end
    end
  end
end

local BT = df.building_type
local function contains(b, x, y)
  local ok, v = pcall(dfhack.buildings.containsTile, b, x, y)
  return ok and v
end
for _, b in ipairs(df.global.world.buildings.all) do
  if b.z == z then
    local g = CLASS[BT[b:getType()]]
    if g then
      local lx, ly = math.max(b.x1, x0), math.max(b.y1, y0)
      local hx, hy = math.min(b.x2, x0 + w - 1), math.min(b.y2, y0 + h - 1)
      if lx <= hx and ly <= hy then
        for gy = ly, hy do
          local row = rows[gy - y0 + 1]
          for gx = lx, hx do
            local cx = gx - x0 + 1
            if row[cx] ~= '?' and contains(b, gx, gy) then row[cx] = g end
          end
        end
      end
    end
  end
end

local grid, seen = {}, {}
for i, r in ipairs(rows) do
  local s = table.concat(r)
  grid[i] = s
  for ci = 1, #s do seen[s:sub(ci, ci)] = true end
end
local legend = {}
for ch in pairs(seen) do legend[ch] = GLYPHS[ch] or 'unknown glyph' end

local out = {
  z = z,
  origin = { x0, y0 },
  size = { w, h },
  legend = legend,
  grid = grid,
  liquids = liquids,
  liquids_truncated = liquids_truncated,
  hidden_tiles = win.hidden_tiles,
  truncated = truncated,
}
if truncated then out.requested = { req_w, req_h } end
emit(out)

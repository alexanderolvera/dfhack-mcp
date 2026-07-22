--@ module = true
-- mcp_readTerrain: see CONTRIBUTING.md "Shared internals: fog-of-war safety".

local json = require('json')

TERRAIN_LEGEND = {
  ['?'] = 'undiscovered (fog of war)',
  ['#'] = 'wall / solid rock',
  ['F'] = 'fortification',
  ['.'] = 'floor / walkable ground',
  ['r'] = 'ramp',
  ['v'] = 'ramp top',
  ['<'] = 'up stair',
  ['>'] = 'down stair',
  ['x'] = 'up/down stair',
  ['T'] = 'tree / trunk / branch',
  ['~'] = 'brook bed',
  [' '] = 'open space / empty',
}

local SHAPE = df.tiletype_shape

function sym(tt, hidden)
  if hidden then return '?' end
  if tt == nil then return ' ' end
  local s = SHAPE[df.tiletype.attrs[tt].shape]
  if s == 'WALL' then return '#'
  elseif s == 'FORTIFICATION' then return 'F'
  elseif s == 'FLOOR' or s == 'BOULDER' or s == 'PEBBLES' then return '.'
  elseif s == 'RAMP' then return 'r'
  elseif s == 'RAMP_TOP' then return 'v'
  elseif s == 'STAIR_UP' then return '<'
  elseif s == 'STAIR_DOWN' then return '>'
  elseif s == 'STAIR_UPDOWN' then return 'x'
  elseif s == 'TRUNK_BRANCH' or s == 'BRANCH' or s == 'TWIG' or s == 'SAPLING' then return 'T'
  elseif s == 'BROOK_BED' or s == 'BROOK_TOP' then return '~'
  elseif s == 'EMPTY' or s == 'NONE' then return ' '
  else return '.' end
end

function read_window(x0, y0, z, w, h)
  local m = df.global.world.map
  local cache = {}
  local function block(x, y)
    if x < 0 or y < 0 or x >= m.x_count or y >= m.y_count then return false end
    local bx, by = x - (x % 16), y - (y % 16)
    local key = bx * 100000 + by
    local v = cache[key]
    if v == nil then v = dfhack.maps.getTileBlock(x, y, z) or false; cache[key] = v end
    return v
  end

  local rows, hidden_n, visible_n, distinct = {}, 0, 0, {}
  local open_to_sky, covered = 0, 0
  local fortifications = {}
  for yy = 0, h - 1 do
    local line = {}
    for xx = 0, w - 1 do
      local x, y = x0 + xx, y0 + yy
      local blk = block(x, y)
      local hidden, tt, outside = false, nil, nil
      if blk then
        local des = blk.designation[x % 16][y % 16]
        hidden = des.hidden
        outside = des.outside
        tt = blk.tiletype[x % 16][y % 16]
      end
      if hidden then
        hidden_n = hidden_n + 1
      else
        visible_n = visible_n + 1
        if outside then open_to_sky = open_to_sky + 1 else covered = covered + 1 end
      end
      local ch = sym(tt, hidden)
      if ch == 'F' then fortifications[#fortifications + 1] = { x = x, y = y } end
      distinct[ch] = (distinct[ch] or 0) + 1
      line[#line + 1] = ch
    end
    rows[#rows + 1] = table.concat(line)
  end

  return {
    origin = { x = x0, y = y0, z = z }, w = w, h = h,
    visible_tiles = visible_n, hidden_tiles = hidden_n,
    exposure = { open_to_sky = open_to_sky, covered = covered, undiscovered = hidden_n },
    fortifications = fortifications,
    legend = TERRAIN_LEGEND, distinct = distinct, grid = rows,
  }
end

if dfhack_flags and dfhack_flags.module then
  return
end

if df.global.gamemode ~= df.game_mode.DWARF then
  print(json.encode({ error = 'no fort loaded' }))
  return
end

local a = { ... }
local x0 = tonumber(a[1])
local y0 = tonumber(a[2])
local z = tonumber(a[3])
local w = tonumber(a[4]) or 100
local h = tonumber(a[5]) or 100
if not (x0 and y0 and z) then
  print(json.encode({ error = 'usage: mcp_readTerrain X0 Y0 Z [W] [H]' }))
  return
end

print(json.encode(read_window(x0, y0, z, w, h)))

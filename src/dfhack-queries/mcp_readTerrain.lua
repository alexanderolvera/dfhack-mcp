--@ module = true
-- mcp_readTerrain: the fog-of-war-safe terrain substrate for spatial tools.
--
-- SPIKE #10 deliverable. Reads tile shape for a single z-level window and emits a
-- compact per-row symbol grid. UNDISCOVERED tiles (designation.hidden) are ALWAYS
-- rendered as '?' and their real tiletype is NEVER serialized — the fog-of-war
-- invariant is enforced at the source, in Lua, so no caller can leak the map the
-- player hasn't found. (RFR's GetBlockList, by contrast, ships real tiletypes for
-- hidden tiles and a ~50x larger raw payload; see the spike report.)
--
-- FACTS ONLY: tile shapes + discovery state. No pathing advice, no "safe route"
-- interpretation — the agent reasons over the grid.
--
-- Two ways in:
--   * Directly (this file): `mcp_readTerrain X0 Y0 Z [W] [H]` -> prints ONE JSON
--     object {origin,w,h,visible_tiles,hidden_tiles,exposure,fortifications,
--     legend,distinct,grid}. exposure = {open_to_sky,covered,undiscovered} from the
--     designation.outside/hidden flags; fortifications = [{x,y}] firing tiles.
--   * As a module for the five dependent spatial tools:
--       local rt = reqscript('mcp_readTerrain')
--       local win = rt.read_window(x0, y0, z, w, h)   -- returns the same table
--       local ch  = rt.sym(tiletype_id, hidden)
--     so the symbol table, the '?' convention, and the block-cached read live in
--     ONE place. Version-fragile field access (designation.hidden, tiletype attrs)
--     stays here, out of the individual tools.
--
-- Verified live on 53.15-r2 vs fort Bustlanterns: coords match defenses()/df tile
-- space (+x east, +y south); a 100x100 window is ~10 KB (~2.6k tokens); a
-- block-cached read of 10k tiles is ~65 ms (vs ~1.7 s reading per tile).

local json = require('json')

-- Symbol convention. '?' is reserved for undiscovered tiles and MUST NOT be
-- reused for any real terrain. Shapes collapse to one glyph each; the goal is a
-- legible ASCII map an agent can reason over, not a lossless dump.
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

-- tiletype id (+ hidden flag) -> one grid glyph. hidden always wins.
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

-- Read a w*h window at (x0,y0) on z-level z. Fetches each 16x16 map block ONCE
-- and indexes into it (26x faster than dfhack.maps.getTileType per tile). Returns
-- the emit-ready table. Out-of-map tiles read as open space.
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

  -- exposure = the designation.outside flag (open to sky vs under a roof), the
  -- tile-level "inside/outside" DF itself tracks; fortifications = firing tiles,
  -- collected as positions because they are sparse and defensively salient. All
  -- computed in the SAME block-cached pass — no extra reads for consumers.
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

-- When loaded via reqscript, stop here: the caller just wanted the functions.
if dfhack_flags and dfhack_flags.module then
  return
end

-- Direct invocation: `mcp_readTerrain X0 Y0 Z [W] [H]`.
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

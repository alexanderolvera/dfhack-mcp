-- mcp_tileRegion: a bounded window of ONE z-level rendered as a character grid +
-- self-describing legend. The "earthworks" map (issue #23): dug/undug, soil vs
-- stone, ramps and stairs, constructions, liquids, trees, and building footprints
-- collapsed to FOUR CLASSES (workshop / stockpile / machine / furniture). The
-- agent drafts layouts as annotations over this grid; the tool NEVER designs
-- anything and NEVER writes game state.
--
-- Composes on the shared fog-of-war substrate (spike #10): the base terrain grid
-- comes from mcp_readTerrain.read_window (walls '#', floor '.', ramps 'r'/'v',
-- stairs '<'/'>'/'x', trees 'T', fortifications 'F', brook '~', and — crucially —
-- undiscovered tiles as '?', with their real tiletype NEVER serialized). This
-- script then COMPOSES overlays ON TOP, and NEVER paints over a '?' tile: fog of
-- war stays honest, so the '?' count in the grid always equals hidden_tiles.
--
-- FACTS ONLY: it renders what is there. Building detail is collapsed to a class
-- glyph (a workshop is 'W', not "Craftsdwarf's Workshop") — the map is coarse on
-- purpose. Per-hostile / per-structure detail lives in defenses(); the fort's
-- facility inventory lives in rooms_and_zones().
--
-- ARGS (all optional; this is the first parameterized MCP tool): Z X0 Y0 X1 Y1.
--   * No args -> the DEFAULT window: a 60x40 rectangle centered on the fort core
--     (busiest citizen z-level + that level's citizen centroid, the same anchor
--     mcp_defenses uses), so the no-arg golden is reproducible.
--   * Z alone (or a partial rectangle) -> the default-centered window at that z.
--   * Z X0 Y0 X1 Y1 -> that explicit rectangle. Window is hard-capped at 100x100;
--     an oversized request is CLAMPED (never errored) with truncated=true and the
--     original requested size echoed back.
-- Emits ONE json.encode(obj): { z, origin:[x,y], size:[w,h], legend, grid,
--   hidden_tiles, truncated, requested? }.
--
-- Verified live on 53.15-r2, fort on :5005: buildings.all + b:getType()
-- (df.building_type); dfhack.buildings.containsTile(b,x,y) honors irregular
-- stockpile footprints; construction via tiletype material == CONSTRUCTION;
-- liquids via designation.flow_size + liquid_type.

local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local CAP = 100                 -- hard window cap per side (documented)
local DEFAULT_W, DEFAULT_H = 60, 40

-- The fixed master legend. Terrain glyphs mirror mcp_readTerrain; the overlay
-- glyphs below are chosen to NOT collide with it (readTerrain already owns
-- F/T/~/</>/x). Water reuses '~' (brook) — same "watery" meaning. The response
-- ships only the glyphs actually present, but this is the full documented set.
local GLYPHS = {
  ['?'] = 'undiscovered (fog of war)',
  ['#'] = 'undug stone / wall',
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

-- df.building_type name -> class glyph. Anything not listed (bridges, floodgates,
-- traps, farm plots, wells, trade depot) renders as its underlying terrain, not a
-- building glyph: the tool commits to exactly the four documented classes.
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

-- ---- fort-core anchor: busiest citizen z + that level's xy centroid ----------
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

-- ---- args -> window (clamped, never errored) --------------------------------
local a = { ... }
local az, ax0, ay0, ax1, ay1 =
  tonumber(a[1]), tonumber(a[2]), tonumber(a[3]), tonumber(a[4]), tonumber(a[5])

local m = df.global.world.map
local z = az or pz or 0
local x0, y0, w, h, truncated, req_w, req_h

if ax0 and ay0 and ax1 and ay1 then
  -- explicit rectangle; normalize corner order
  local lox, hix = math.min(ax0, ax1), math.max(ax0, ax1)
  local loy, hiy = math.min(ay0, ay1), math.max(ay0, ay1)
  x0, y0 = lox, loy
  w, h = hix - lox + 1, hiy - loy + 1
  req_w, req_h = w, h
  if w > CAP then w = CAP; truncated = true end
  if h > CAP then h = CAP; truncated = true end
else
  -- default (or partial-arg) window: centered on the fort core
  w, h = DEFAULT_W, DEFAULT_H
  local ccx = (pz and pn > 0) and math.floor(z_sx[pz] / pn) or math.floor(m.x_count / 2)
  local ccy = (pz and pn > 0) and math.floor(z_sy[pz] / pn) or math.floor(m.y_count / 2)
  x0 = ccx - math.floor(w / 2)
  y0 = ccy - math.floor(h / 2)
end

-- a window can never be larger than the map, then clamp the origin so it fits
if w > m.x_count then w = m.x_count end
if h > m.y_count then h = m.y_count end
x0 = math.max(0, math.min(m.x_count - w, x0))
y0 = math.max(0, math.min(m.y_count - h, y0))
if z < 0 then z = 0 elseif z >= m.z_count then z = m.z_count - 1 end
truncated = truncated or false

-- ---- base terrain grid (fog of war already enforced) ------------------------
local rt = reqscript('mcp_readTerrain')
local win = rt.read_window(x0, y0, z, w, h)

-- split each row string into a mutable char array for overlay stamping
local rows = {}
for i, s in ipairs(win.grid) do
  local r = {}
  for ci = 1, #s do r[ci] = s:sub(ci, ci) end
  rows[i] = r
end

-- one block-cached read plane at this z (26x faster than per-tile getTileType)
local cache = {}
local function block(x, y)
  if x < 0 or y < 0 or x >= m.x_count or y >= m.y_count then return false end
  local bx, by = x - (x % 16), y - (y % 16)
  local key = bx * 100000 + by
  local v = cache[key]
  if v == nil then v = dfhack.maps.getTileBlock(x, y, z) or false; cache[key] = v end
  return v
end

-- ---- overlay 1: liquids + constructed floor (NEVER over a '?' tile) ----------
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
          row[xx + 1] = des.liquid_type and '%' or '~'   -- magma vs water
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

-- ---- overlay 2: building footprints by class (stamped last, wins) -----------
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

-- ---- flatten + build the present-glyph legend -------------------------------
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
  hidden_tiles = win.hidden_tiles,
  truncated = truncated,
}
if truncated then out.requested = { req_w, req_h } end
emit(out)

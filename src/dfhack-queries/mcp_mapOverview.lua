-- mcp_mapOverview: cheap spatial orientation before any tile_region read. Answers
-- "how big is this map, where is the fort, and which z-levels is the player
-- actually working on?" so an agent can aim its expensive per-tile terrain reads
-- instead of sweeping 147 z-levels blind.
--
-- FACTS ONLY: dimensions, one anchor coordinate, the set of z-levels with player
-- activity, and stair columns as vertical runs. No "dig here" / "wall that off"
-- advice — the agent decides where to look; this just says where the map and the
-- work are.
--
-- FIXED-SIZE PAYLOAD regardless of fort size: activity is reported as a SET OF
-- Z-LEVELS (bounded by z_count), never per-tile; stair columns are collapsed to
-- (x,y,z_top,z_bottom) vertical RUNS and capped. A mega-fort payload stays flat.
--
-- FOG OF WAR: the surface probe and the stair scan skip undiscovered
-- (designation.hidden) tiles, so nothing the player hasn't found leaks. Stair
-- tiletypes only ever exist where the player carved or built (DF has no natural
-- stairs), so every reported column is discovered space by construction. Pending
-- DIG designations are counted regardless of the hidden flag: they are the
-- player's own markers, not sensed terrain, so reporting "digging at z=111"
-- reveals nothing the player didn't place there.
--
-- Fort-core anchor: the SAME 3D citizen centroid defenses() uses (getCitizens ->
-- mean x,y,z), so map_overview().fort_core == defenses().fort_core for one fort.
--
-- Verified live on 53.15 (fort, 78 pop): world.map.x_count/y_count/z_count;
-- df.construction.get_vector() (each .pos; global list; world.constructions is
-- GONE on this build); block.flags.designated gates the dig scan (54 of 11907
-- blocks); tiletype shape STAIR_UP/DOWN/UPDOWN + material CONSTRUCTION via
-- df.tiletype.attrs. Invoked by name via DFHack RunCommand; prints ONE JSON object.

local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local COLUMNS_CAP = 40          -- stair columns listed individually; excess summarized
local m = df.global.world.map
local SHAPE = df.tiletype_shape
local MAT = df.tiletype_material
local attrs = df.tiletype.attrs

-- ---- fort core: 3D citizen centroid (byte-for-byte the anchor defenses() uses) ----
local cx, cy, cz, n = 0, 0, 0, 0
for _, u in ipairs(dfhack.units.getCitizens(true)) do
  local p = u.pos
  if p and p.x >= 0 then cx = cx + p.x; cy = cy + p.y; cz = cz + p.z; n = n + 1 end
end
local core = (n > 0)
  and { x = math.floor(cx / n), y = math.floor(cy / n), z = math.floor(cz / n), citizens = n }
  or nil

-- ---- surface z at the fort center: highest non-hidden, open-to-sky ground tile
-- at the anchor (x,y). Skips open air above the map (EMPTY) and roofed-over tiles
-- (outside=false); null when the core column is never open to sky. ----
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

-- ---- precompute per-tiletype flags ONCE (avoids 3M live attrs lookups) ----
local STAIR = {}
-- STAIR[tt] holds the tile's stair role: 'U' offers up-access, 'D' offers
-- down-access, 'X' (up/down) offers both. This is what decides whether two
-- vertically-adjacent stair tiles actually CONNECT (see the run-grouping below),
-- so we keep the role, not just a boolean.
for tt = df.tiletype._first_item, df.tiletype._last_item do
  local a = attrs[tt]
  if a then
    local s = SHAPE[a.shape]
    if s == 'STAIR_UP' then STAIR[tt] = 'U'
    elseif s == 'STAIR_DOWN' then STAIR[tt] = 'D'
    elseif s == 'STAIR_UPDOWN' then STAIR[tt] = 'X' end
  end
end

-- ---- one pass over map blocks: stair tiles (everywhere) + dig z (designated
-- blocks only). Constructions come from the global vector below, not this scan. ----
local col = {}          -- "x,y" -> { x=, y=, tiles = { {z=,s=}, ... } }
local dig_zset = {}     -- z -> true, pending player dig designations
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
  -- dig designations: only blocks flagged as carrying designations, so this stays
  -- ~54 blocks not 11907. Counted regardless of hidden (player's own markers).
  if b.flags.designated then
    for lx = 0, 15 do
      local desx = des[lx]
      for ly = 0, 15 do
        if desx[ly].dig ~= 0 then dig_zset[z] = true end
      end
    end
  end
end

-- ---- constructions: distinct z-levels straight from the global vector ----
local con_zset = {}
for _, c in ipairs(df.construction.get_vector()) do
  con_zset[c.pos.z] = true
end

-- ---- activity z-levels: sorted lists + their union ----
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

-- ---- stair columns: group each (x,y)'s stair tiles into TRAVERSABLE vertical
-- runs. Two vertically-adjacent stair tiles connect only when the lower one
-- offers up-access (U or X) AND the one above offers down-access (D or X) --
-- DF's real stair rule. So a STAIR_UP under a STAIR_UP does NOT connect (nothing
-- to descend into), and this fort's helical shafts (D/U alternating per column,
-- descent hopping between adjacent columns) split into their genuinely-climbable
-- single-column segments instead of one bogus straight shaft. A z gap also closes
-- a run. z_top is the highest z of a run, z_bottom the lowest. ----
local function connects(lo, hi)      -- lo, hi are {z=,s=} with hi.z == lo.z+1 expected
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
-- deterministic order for stable goldens: by x, then y, then z_top.
table.sort(columns, function(a, b)
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

-- ---- alerts: honest facts only ----
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

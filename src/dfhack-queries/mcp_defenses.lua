-- mcp_defenses: where the threats are vs. what you have to fight them with.
--
-- FACTS ONLY. This script extracts positions, structures, and the RELATIVE
-- geometry between them (tile distance (Chebyshev, since DF movement is
-- 8-directional), z-level delta, 8-way compass bearing). It deliberately does
-- NOT decide what to DO about it -- no "atom-smash them" advice, no per-trait
-- caveats. Tactical judgment is the agent's job (and creature-trait facts live
-- in identify()); doctrine baked into this version-fragile boundary would
-- proliferate and drift. Interpretation stays out; only ground truth ships.
--
-- LEVEL 2 (terrain-aware, issue #4): each threat is classified inside/outside the
-- fort's WALLED PERIMETER, defined concretely as "shares a walkability group with
-- the fort's citizens" -- DF precomputes a walk group per walkable tile (3D:
-- stairs/ramps included), and two tiles are mutually walk-reachable iff they share
-- one nonzero group. So a threat is `inside` when a hostile could path to your
-- population through connected, open, walkable space without breaching a wall.
-- (This realizes the ticket's "flood-fill from core over walkable non-wall tiles"
-- using DF's own walk groups, anchored on citizens rather than the core centroid,
-- which can land inside rock.) Plus a `perimeter_terrain` readout of the primary
-- fort level via the shared mcp_readTerrain helper -- walls, fortifications,
-- open-to-sky vs covered, fog of war.
--
-- LIMITATIONS (facts, not advice, so the agent knows the edges): walk-group
-- connectivity is walking-only -- a FLIER or BUILDING_DESTROYER can reach you
-- while classified `outside` (cross-reference the trait facts in threats()/
-- identify()). `perimeter_terrain` is a single z-level (the busiest citizen
-- level); it does not synthesize a multi-z approach vector. Undiscovered tiles
-- are fog of war ('?') and never leak their real type. A threat on non-walkable
-- footing (flying, open pit) has walk_group 0 and reads `outside`.
--
-- Verified live on 53.15-r2: world.buildings.all + b:getType() (df.building_type
-- Bridge/Trap/Door/Floodgate/Hatch); bridge x1/y1/x2/y2/z/centerx/centery/
-- direction; trap b.trap_type (df.trap_type CageTrap/Lever/...); door
-- door_flags.forbidden; unit u.pos; dfhack.maps.getWalkableGroup(xyz2pos(...)).
-- Invoked by name via DFHack RunCommand; prints ONE JSON object.

local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local terrain = reqscript('mcp_readTerrain')

-- Terrain at a unit's own tile, honoring fog of war: an undiscovered tile reports
-- only { discovered = false } and NEVER leaks its real shape (the substrate rule),
-- even though the unit's position itself is known from the unit list.
local function footing(p)
  local blk = dfhack.maps.getTileBlock(p.x, p.y, p.z)
  if not blk then return { discovered = false } end
  local des = blk.designation[p.x % 16][p.y % 16]
  if des.hidden then return { discovered = false } end
  local ch = terrain.sym(blk.tiletype[p.x % 16][p.y % 16], false)
  return { discovered = true, symbol = ch, terrain = terrain.TERRAIN_LEGEND[ch],
           open_to_sky = des.outside }
end

-- 8-directional tile distance + z delta + compass bearing between two points.
local function cheb(ax, ay, bx, by) return math.max(math.abs(ax-bx), math.abs(ay-by)) end
local function bearing(fromx, fromy, tox, toy)
  local dx, dy = tox - fromx, toy - fromy      -- +x east, +y south
  local tol = 2
  local s = ''
  if dy < -tol then s = 'N' elseif dy > tol then s = 'S' end
  if dx > tol then s = s .. 'E' elseif dx < -tol then s = s .. 'W' end
  return (s == '') and 'here' or s
end

-- One pass over citizens builds three references:
--   * fort core   = 3D centroid (geometry/bearing anchor, as before)
--   * interior    = the walkability groups citizens stand in (the "walled
--                   perimeter": inside == a threat shares one of these groups)
--   * primary lvl = the z with the most citizens + its xy centroid (where the
--                   perimeter_terrain window is read)
local cx, cy, cz, n = 0, 0, 0, 0
local interior_groups = {}          -- walk_group -> citizen count
local z_count, z_sx, z_sy = {}, {}, {}
for _, u in ipairs(dfhack.units.getCitizens(true)) do
  local p = u.pos
  if p and p.x >= 0 then
    cx = cx + p.x; cy = cy + p.y; cz = cz + p.z; n = n + 1
    local g = dfhack.maps.getWalkableGroup(xyz2pos(p.x, p.y, p.z))
    if g ~= 0 then interior_groups[g] = (interior_groups[g] or 0) + 1 end
    z_count[p.z] = (z_count[p.z] or 0) + 1
    z_sx[p.z] = (z_sx[p.z] or 0) + p.x
    z_sy[p.z] = (z_sy[p.z] or 0) + p.y
  end
end
local core = (n > 0) and { x = math.floor(cx/n), y = math.floor(cy/n), z = math.floor(cz/n), citizens = n } or nil

-- Primary fort level: the busiest citizen z.
local primary_z, primary_n = nil, -1
for z, cnt in pairs(z_count) do if cnt > primary_n then primary_n = cnt; primary_z = z end end

-- Encode interior groups as an explicit list (an integer-keyed Lua table would
-- JSON-encode as a null-padded array). Walk-group ids are per-snapshot, not
-- stable across frames -- computed fresh every call, never persisted.
local interior = { groups = {}, primary_group = nil, citizens = n }
do
  local best_g, best_c = nil, -1
  for g, c in pairs(interior_groups) do
    interior.groups[#interior.groups + 1] = { group = g, citizens = c }
    if c > best_c then best_c = c; best_g = g end
  end
  interior.primary_group = best_g
end

-- Structures.
local bt = df.building_type
local bridges = {}
local levers, floodgates, hatches, cage_traps = 0, 0, 0, 0
local doors_total, doors_forbidden = 0, 0
for _, b in ipairs(df.global.world.buildings.all) do
  local t = b:getType()
  if t == bt.Bridge then
    local w = math.abs(b.x2 - b.x1) + 1
    local h = math.abs(b.y2 - b.y1) + 1
    bridges[#bridges+1] = { x = b.centerx, y = b.centery, z = b.z,
      tiles = w * h, direction = tostring(b.direction) }
  elseif t == bt.Trap then
    local st = df.trap_type[b.trap_type]
    if st == 'Lever' then levers = levers + 1
    elseif st == 'CageTrap' then cage_traps = cage_traps + 1 end
  elseif t == bt.Floodgate then floodgates = floodgates + 1
  elseif t == bt.Hatch then hatches = hatches + 1
  elseif t == bt.Door then
    doors_total = doors_total + 1
    local forbid = false
    pcall(function() forbid = b.door_flags.forbidden end)
    if forbid then doors_forbidden = doors_forbidden + 1 end
  end
end

-- Active hostiles with positions + geometry to the fort core and nearest bridge.
local threats = {}
for _, u in ipairs(df.global.world.units.active) do
  if dfhack.units.isActive(u) and not dfhack.units.isDead(u)
     and dfhack.units.isDanger(u) and not dfhack.units.isCitizen(u)
     and not (u.flags1.caged or u.flags1.chained) then
    local p = u.pos
    local token = nil
    pcall(function() token = df.global.world.raws.creatures.all[u.race].creature_id end)
    local th = { name = dfhack.units.getReadableName(u), token = token,
                 pos = { x = p.x, y = p.y, z = p.z } }
    -- inside/outside the walled perimeter: does this tile share a citizen
    -- walk group? (0 = no walkable footing, e.g. a flier over open space.)
    local g = dfhack.maps.getWalkableGroup(xyz2pos(p.x, p.y, p.z))
    th.walk_group = g
    th.location = (g ~= 0 and interior_groups[g] ~= nil) and 'inside' or 'outside'
    th.footing = footing(p)
    if core then
      th.from_core = { dist = cheb(p.x, p.y, core.x, core.y), dz = core.z - p.z,
                       dir = bearing(core.x, core.y, p.x, p.y) }
    end
    -- nearest bridge to this threat
    local best, bi = nil, nil
    for _, br in ipairs(bridges) do
      local d = cheb(p.x, p.y, br.x, br.y)
      if not best or d < best then best = d; bi = br end
    end
    if bi then
      th.nearest_bridge = { x = bi.x, y = bi.y, z = bi.z, dist = best,
                            dz = bi.z - p.z, dir = bearing(p.x, p.y, bi.x, bi.y) }
    end
    threats[#threats+1] = th
  end
end

-- Perimeter terrain: one bounded window on the busiest citizen level, read via
-- the shared mcp_readTerrain helper (walls, fortifications, open-to-sky vs
-- covered, fog of war). Centered on that level's citizen centroid, clamped to map.
local perimeter_terrain = nil
if primary_z then
  local W, H = 41, 41
  local m = df.global.world.map
  local ccx = math.floor(z_sx[primary_z] / primary_n)
  local ccy = math.floor(z_sy[primary_z] / primary_n)
  local x0 = math.max(0, math.min(m.x_count - W, ccx - math.floor(W / 2)))
  local y0 = math.max(0, math.min(m.y_count - H, ccy - math.floor(H / 2)))
  local win = terrain.read_window(x0, y0, primary_z, W, H)
  perimeter_terrain = {
    z = primary_z, citizens_on_level = primary_n, center = { x = ccx, y = ccy },
    origin = win.origin, w = win.w, h = win.h,
    exposure = win.exposure, fortifications = win.fortifications,
    distinct = win.distinct, legend = win.legend, grid = win.grid,
  }
end

emit({
  fort_core = core,
  interior = interior,
  threats = threats,
  structures = {
    bridges = bridges,
    levers = levers,
    floodgates = floodgates,
    hatches = hatches,
    cage_traps = cage_traps,
    doors = { total = doors_total, forbidden = doors_forbidden },
  },
  perimeter_terrain = perimeter_terrain,
})

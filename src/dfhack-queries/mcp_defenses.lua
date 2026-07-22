local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local terrain = reqscript('mcp_readTerrain')

local function footing(p)
  local blk = dfhack.maps.getTileBlock(p.x, p.y, p.z)
  if not blk then return { discovered = false } end
  local des = blk.designation[p.x % 16][p.y % 16]
  if des.hidden then return { discovered = false } end
  local ch = terrain.sym(blk.tiletype[p.x % 16][p.y % 16], false)
  return { discovered = true, symbol = ch, terrain = terrain.TERRAIN_LEGEND[ch],
           open_to_sky = des.outside }
end

local function cheb(ax, ay, bx, by) return math.max(math.abs(ax-bx), math.abs(ay-by)) end
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

local primary_z, primary_n = nil, -1
for z, cnt in pairs(z_count) do if cnt > primary_n then primary_n = cnt; primary_z = z end end

local interior = { groups = {}, primary_group = nil, citizens = n }
do
  local best_g, best_c = nil, -1
  for g, c in pairs(interior_groups) do
    interior.groups[#interior.groups + 1] = { group = g, citizens = c }
    if c > best_c then best_c = c; best_g = g end
  end
  interior.primary_group = best_g
end

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
    local g = dfhack.maps.getWalkableGroup(xyz2pos(p.x, p.y, p.z))
    th.walk_group = g
    th.location = (g ~= 0 and interior_groups[g] ~= nil) and 'inside' or 'outside'
    th.footing = footing(p)
    if core then
      th.from_core = { dist = cheb(p.x, p.y, core.x, core.y), dz = core.z - p.z,
                       dir = bearing(core.x, core.y, p.x, p.y) }
    end
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

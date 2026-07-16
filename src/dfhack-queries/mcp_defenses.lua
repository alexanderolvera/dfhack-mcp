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
-- Verified live on 53.15-r2: world.buildings.all + b:getType() (df.building_type
-- Bridge/Trap/Door/Floodgate/Hatch); bridge x1/y1/x2/y2/z/centerx/centery/
-- direction; trap b.trap_type (df.trap_type CageTrap/Lever/...); door
-- door_flags.forbidden; unit u.pos.
-- Invoked by name via DFHack RunCommand; prints ONE JSON object.

local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
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

-- Fort core = centroid of citizens, a reference the agent can reason from.
local cx, cy, cz, n = 0, 0, 0, 0
for _, u in ipairs(dfhack.units.getCitizens(true)) do
  if u.pos and u.pos.x >= 0 then cx = cx + u.pos.x; cy = cy + u.pos.y; cz = cz + u.pos.z; n = n + 1 end
end
local core = (n > 0) and { x = math.floor(cx/n), y = math.floor(cy/n), z = math.floor(cz/n), citizens = n } or nil

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

emit({
  fort_core = core,
  threats = threats,
  structures = {
    bridges = bridges,
    levers = levers,
    floodgates = floodgates,
    hatches = hatches,
    cage_traps = cage_traps,
    doors = { total = doors_total, forbidden = doors_forbidden },
  },
})

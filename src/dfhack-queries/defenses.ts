// defenses(): where the threats are vs. what you have to fight them with.
//
// Turns the generic "atom-smash them" advice into "you have 3 bridges; the
// nearest to the demons is ~N tiles away." Everything here is buildings + unit
// positions over the same Lua pipe (no RemoteFortressReader needed). Raw (x,y,z)
// is meaningless alone, so the value is the RELATIVE geometry we compute: tile
// distance (Chebyshev, since DF movement is 8-directional), z-level delta, and
// an 8-way compass bearing.
//
// Honest limits (documented, not hidden): walls/fortifications are map TILES,
// not buildings, so "inside vs outside the walls" waits on RFR terrain reads;
// and a bridge doesn't record which lever raises it, so we report bridges and
// levers separately, not their linkage.
//
// Verified live on 53.15-r2: world.buildings.all + b:getType() (df.building_type
// Bridge/Trap/Door/Floodgate/Hatch); bridge x1/y1/x2/y2/z/centerx/centery/
// direction; trap b.trap_type (df.trap_type CageTrap/Lever/...); door
// door_flags.forbidden; unit u.pos.

import { preamble } from './shared.ts';

export const DEFENSES = String.raw`${preamble()}
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

local alerts = {}
if #threats > 0 and #bridges == 0 then
  alerts[#alerts+1] = 'no drawbridge on the map — the safest kill (atom-smasher) is unavailable until you build one'
elseif #threats > 0 and #bridges > 0 then
  local nearest = nil
  for _, th in ipairs(threats) do
    if th.nearest_bridge and (not nearest or th.nearest_bridge.dist < nearest) then nearest = th.nearest_bridge.dist end
  end
  if nearest then alerts[#alerts+1] = 'nearest drawbridge is ~' .. nearest .. ' tiles from a threat' end
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
  notes = {
    'Distances are 8-directional tile counts (Chebyshev); dz is z-levels (+ = above the threat).',
    'Walls/fortifications are map tiles, not buildings, so "inside vs outside" is not yet covered.',
    'Bridges and levers are listed separately; which lever raises which bridge is not recorded in the raws.',
    'Cage traps do not work on TRAPAVOID creatures (check threats()/identify()).',
  },
})
`;

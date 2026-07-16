// military(): squads, soldier headcount, and readiness against live threats.
//
// Two different counts on purpose, because they can disagree and the gap is the
// point: `soldiers` is living, present citizens actually in a squad
// (unit.military.squad_id), while `assigned_positions` is filled squad slots —
// a slot can still hold a member who is dead, off-map, or otherwise not in the
// citizen list. Leading with `soldiers` avoids overstating fighting strength.
// Inlines the same hostile predicate as threats() so readiness reads against
// what's actually on the map.
//
// Verified live on 53.15-r2: squads.all filtered by entity_id == fortress
// entity; translateName(sq.name); unit.military.squad_id.

import { preamble } from './shared.ts';

export const MILITARY = String.raw`${preamble()}
local fort = df.global.plotinfo.main.fortress_entity
local squads = {}
local assigned_positions = 0

for _, sq in ipairs(df.global.world.squads.all) do
  if fort and sq.entity_id == fort.id then
    local ok, nm = pcall(function() return dfhack.translation.translateName(sq.name, true) end)
    local name = (ok and nm ~= '' and nm) or (sq.alias ~= '' and sq.alias) or ('Squad ' .. sq.id)
    local filled, total = 0, 0
    for _, pos in ipairs(sq.positions) do
      total = total + 1
      if pos.occupant ~= -1 then filled = filled + 1 end
    end
    assigned_positions = assigned_positions + filled
    squads[#squads+1] = { name = name, filled = filled, positions = total }
  end
end

-- Living, present citizens actually enlisted right now.
local citizens = dfhack.units.getCitizens(true)
local soldiers, adults = 0, 0
for _, u in ipairs(citizens) do
  if not (dfhack.units.isChild(u) or dfhack.units.isBaby(u)) then
    adults = adults + 1
    if u.military and u.military.squad_id and u.military.squad_id ~= -1 then
      soldiers = soldiers + 1
    end
  end
end

-- Hostiles on the map (same predicate as threats(); great-danger split out).
local hostiles, great_danger = 0, 0
for _, u in ipairs(df.global.world.units.active) do
  if dfhack.units.isActive(u) and not dfhack.units.isDead(u)
     and dfhack.units.isDanger(u) and not dfhack.units.isCitizen(u)
     and not (u.flags1.caged or u.flags1.chained) then
    hostiles = hostiles + 1
    if dfhack.units.isGreatDanger(u) then great_danger = great_danger + 1 end
  end
end

local alerts = {}
if #squads == 0 then
  alerts[#alerts+1] = 'no military squads — the fort is undefended'
end
if hostiles > 0 then
  local msg = hostiles .. ' hostile' .. (hostiles > 1 and 's' or '') .. ' on map vs ' ..
              soldiers .. ' soldier' .. (soldiers == 1 and '' or 's') ..
              ' in ' .. #squads .. ' squad' .. (#squads == 1 and '' or 's')
  if great_danger > 0 and soldiers == 0 then
    msg = msg .. ' — NO defenders against a great-danger creature'
  end
  alerts[#alerts+1] = msg
end

emit({
  squad_count = #squads,
  soldiers = soldiers,
  assigned_positions = assigned_positions,
  adults = adults,
  hostiles_on_map = hostiles,
  great_danger_on_map = great_danger,
  squads = squads,
  alerts = alerts,
})
`;

// threats(): enumerate dangerous units on the map, grouped by kind.
//
// Builds on fort_status's hostile predicate (active && !dead && isDanger &&
// !citizen) but classifies each threat and separates ACTIVE hostiles from
// CONTAINED ones (caged/chained — a captured beast is a hazard-in-waiting, not
// a live attack). Groups identical creatures so "12 goblins" reads as one line.
//
// Verified live on 53.15-r2: getReadableName, isInvader, isUndead, isCrazed,
// isGreatDanger all resolve; isSemiMegabeast does NOT exist in this build, so we
// don't rely on it. great_danger (megabeasts, titans, demons, forgotten beasts)
// is the "this can end the fort" signal.

import { preamble } from './shared.ts';

export const THREATS = String.raw`${preamble()}
-- Group dangerous units by a stable key so identical creatures collapse to one
-- line. Contained (caged/chained) threats are counted apart from active ones.
local groups = {}   -- key -> aggregate
local order = {}    -- preserve first-seen order for stable output
local active_total, contained_total = 0, 0

local function classify(u)
  return {
    invader      = dfhack.units.isInvader(u),
    undead       = dfhack.units.isUndead(u),
    crazed       = dfhack.units.isCrazed(u),
    great_danger = dfhack.units.isGreatDanger(u),
  }
end

-- Tactical intel for a group's representative unit: the creature token, a small
-- CURATED set of decisive traits, and the ranged/breath attack labels. This is
-- the hook an advisor needs BEFORE recommending a counter (e.g. cage traps are
-- useless vs. TRAPAVOID). Confirmed field paths on DFHack 53.15-r2:
--   * unit's creature: df.global.world.raws.creatures.all[u.race] (creature_raw);
--     .creature_id is the token (e.g. "DEMON_4").
--   * caste vector is the 'caste' field (NOT 'castes'); representative is caste[0].
--   * caste.flags is a bitfield whose TRUE keys are stable token names — read via
--     pairs(); never index by a token (an undefined bit throws "not found").
--   * ranged/breath: caste.body_info.interactions[].interaction.adv_name.
--   * building destroyer: caste.misc.buildingdestroyer (numeric; >0 means it can
--     smash buildings). There is NO BUILDINGDESTROYER flag bit in this build and
--     no caste.building_destroyer field — verified live against TROLL (=2) and the
--     Flame Phantom demons (=0).
-- Degrades gracefully: a unit whose race/caste can't resolve yields empty intel
-- (nil token, empty traits/ranged_attacks) rather than crashing.
local function unit_intel(u)
  local out = { token = nil, traits = {}, ranged_attacks = {} }
  local cr = df.global.world.raws.creatures.all[u.race]
  if not cr then return out end
  out.token = tostring(cr.creature_id)
  local caste = cr.caste and cr.caste[0]
  if not caste then return out end

  -- TRUE flag tokens as a lookup set (iterate the bitfield; never index by token).
  local flag = {}
  for k, v in pairs(caste.flags) do
    if v == true then flag[k] = true end
  end

  -- Ranged/breath interactions -> adv_name labels; note fire/web attacks.
  local ranged = {}
  local fire_attack, web_attack = false, false
  pcall(function()
    for _, ci in ipairs(caste.body_info.interactions) do
      local it = ci.interaction
      local nm = it and it.adv_name
      if nm and nm ~= '' then
        ranged[#ranged+1] = nm
        local low = string.lower(nm)
        if string.find(low, 'fire', 1, true) or string.find(low, 'flame', 1, true) then
          fire_attack = true
        end
        if string.find(low, 'web', 1, true) then web_attack = true end
      end
    end
  end)
  out.ranged_attacks = ranged

  -- Building destroyer level (0 = none) at the confirmed numeric path.
  local bd = 0
  pcall(function() bd = caste.misc.buildingdestroyer or 0 end)

  -- Only the tactically-DECISIVE traits, in a stable, advice-first order.
  local traits = {}
  if flag.TRAPAVOID then traits[#traits+1] = 'trapavoid' end
  if flag.FLIER then traits[#traits+1] = 'flier' end
  if flag.FIREIMMUNE or flag.FIREIMMUNE_SUPER or fire_attack then traits[#traits+1] = 'fire' end
  if flag.WEBBER or web_attack then traits[#traits+1] = 'webber' end
  if bd and bd > 0 then traits[#traits+1] = 'building_destroyer' end
  if #ranged > 0 then traits[#traits+1] = 'ranged' end
  out.traits = traits
  return out
end

for _, u in ipairs(df.global.world.units.active) do
  if dfhack.units.isActive(u) and not dfhack.units.isDead(u)
     and dfhack.units.isDanger(u) and not dfhack.units.isCitizen(u) then
    local contained = u.flags1.caged or u.flags1.chained
    local name = dfhack.units.getReadableName(u)
    local flags = classify(u)
    -- Distinct groups per (name, containment) so a caged beast never masks a
    -- loose one of the same kind.
    local key = name .. (contained and ' [contained]' or '')
    local g = groups[key]
    if not g then
      -- All units in a group share a creature, so pull intel once from the
      -- first-seen (representative) unit.
      local intel = unit_intel(u)
      g = { name = name, count = 0, contained = contained,
            invader = flags.invader, undead = flags.undead,
            crazed = flags.crazed, great_danger = flags.great_danger,
            token = intel.token, traits = intel.traits,
            ranged_attacks = intel.ranged_attacks }
      groups[key] = g
      order[#order+1] = key
    end
    g.count = g.count + 1
    if contained then contained_total = contained_total + 1
    else active_total = active_total + 1 end
  end
end

local group_list = {}
for _, key in ipairs(order) do group_list[#group_list+1] = groups[key] end

-- Alerts: lead with great-danger creatures, then invaders, then a catch-all for
-- any remaining active hostiles. Contained threats get a quieter mention.
local alerts = {}
local great, invaders, other = 0, 0, 0
local great_traits, seen_trait = {}, {}   -- unioned traits across active great-danger groups
for _, g in ipairs(group_list) do
  if not g.contained then
    if g.great_danger then
      great = great + g.count
      for _, t in ipairs(g.traits or {}) do
        if not seen_trait[t] then seen_trait[t] = true; great_traits[#great_traits+1] = t end
      end
    elseif g.invader then invaders = invaders + g.count
    else other = other + g.count end
  end
end
if great > 0 then
  local line = great .. ' great-danger creature' .. (great > 1 and 's' or '') .. ' loose (megabeast/titan/demon/FB)'
  -- Traits are what the advisor reads first — surface them on the lead alert.
  if #great_traits > 0 then
    line = line .. '; traits: ' .. table.concat(great_traits, ', ')
  end
  alerts[#alerts+1] = line
end
if invaders > 0 then
  alerts[#alerts+1] = invaders .. ' invader' .. (invaders > 1 and 's' or '') .. ' on map'
end
if other > 0 then
  alerts[#alerts+1] = other .. ' other hostile' .. (other > 1 and 's' or '') .. ' on map'
end
if contained_total > 0 then
  alerts[#alerts+1] = contained_total .. ' dangerous creature' .. (contained_total > 1 and 's' or '') .. ' caged/chained'
end

emit({
  active_hostiles = active_total,
  contained = contained_total,
  groups = group_list,
  alerts = alerts,
})
`;

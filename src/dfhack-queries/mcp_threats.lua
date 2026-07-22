local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local visibility = reqscript('mcp_unitVisibility')

local groups = {}
local order = {}
local active_total, contained_total = 0, 0

local function classify(u)
  return {
    invader      = dfhack.units.isInvader(u),
    undead       = dfhack.units.isUndead(u),
    crazed       = dfhack.units.isCrazed(u),
    great_danger = dfhack.units.isGreatDanger(u),
  }
end

local function unit_intel(u)
  local out = { token = nil, traits = {}, ranged_attacks = {} }
  local cr = df.global.world.raws.creatures.all[u.race]
  if not cr then return out end
  out.token = tostring(cr.creature_id)
  local caste = cr.caste and cr.caste[0]
  if not caste then return out end

  local flag = {}
  for k, v in pairs(caste.flags) do
    if v == true then flag[k] = true end
  end

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

  local bd = 0
  pcall(function() bd = caste.misc.buildingdestroyer or 0 end)

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
     and dfhack.units.isDanger(u) and not dfhack.units.isCitizen(u)
     and not visibility.is_hidden(u) then
    local contained = u.flags1.caged or u.flags1.chained
    local name = dfhack.units.getReadableName(u)
    local flags = classify(u)
    local key = name .. (contained and ' [contained]' or '')
    local g = groups[key]
    if not g then
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

local alerts = {}
local great, invaders, other = 0, 0, 0
local great_traits, seen_trait = {}, {}
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

emit({
  active_hostiles = active_total,
  contained = contained_total,
  groups = group_list,
  alerts = alerts,
})

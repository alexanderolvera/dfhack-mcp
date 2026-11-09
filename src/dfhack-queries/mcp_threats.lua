local json = require('json')
local emit = reqscript('mcp_jsonOut').emit

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

emit({
  active_hostiles = active_total,
  contained = contained_total,
  groups = group_list,
})

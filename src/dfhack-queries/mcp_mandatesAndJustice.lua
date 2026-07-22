local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local MANDATE_CAP = 50
local BAN_CAP = 50
local DEMAND_CAP = 50
local TICKS_PER_DAY = 1200
local DEADLINE_SOON = 7

local plotinfo = df.global.plotinfo
local ent = df.historical_entity.find(plotinfo.group_id)
local citizens = dfhack.units.getCitizens(true)

local function unit_name(u)
  if not u then return 'unknown' end
  local ok, s = pcall(function() return dfhack.units.getReadableName(u) end)
  if ok and s and s ~= '' then return s end
  ok, s = pcall(function() return dfhack.translation.translateName(dfhack.units.getVisibleName(u), true) end)
  if ok and s and s ~= '' then return s end
  return 'unit ' .. tostring(u.id)
end

local function hf_name(hf)
  if not hf then return 'unknown' end
  local ok, s = pcall(function() return dfhack.translation.translateName(hf.name, true) end)
  if ok and s and s ~= '' then return s end
  return 'hf ' .. tostring(hf.id)
end

local nobles = {}
if ent then
  for _, pos in ipairs(ent.positions.own) do
    local demands_something = pos.mandate_max > 0 or pos.demand_max > 0
      or pos.required_office > 0 or pos.required_bedroom > 0
      or pos.required_dining > 0 or pos.required_tomb > 0
    if demands_something then
      for _, asg in ipairs(ent.positions.assignments) do
        if asg.position_id == pos.id and asg.histfig ~= -1 then
          local hf = df.historical_figure.find(asg.histfig)
          local u = hf and hf.unit_id ~= -1 and df.unit.find(hf.unit_id) or nil
          nobles[pos.id] = {
            position = (pos.name[0] ~= '' and pos.name[0]) or pos.code,
            hf = hf, unit = u,
            name = u and unit_name(u) or hf_name(hf),
            pos = pos,
          }
        end
      end
    end
  end
end

local noble_rows = {}
for _, n in pairs(nobles) do
  noble_rows[#noble_rows + 1] = {
    position = n.position,
    noble = n.name,
    can_mandate = n.pos.mandate_max,
    can_demand = n.pos.demand_max,
  }
end
table.sort(noble_rows, function(a, b)
  if a.position ~= b.position then return a.position < b.position end
  return a.noble < b.noble
end)

local function mandate_item_name(m)
  local parts = {}
  local okmat, mi = pcall(function() return dfhack.matinfo.decode(m.mat_type, m.mat_index) end)
  if okmat and mi then
    local s = mi:toString()
    if s and s ~= '' and s ~= 'NONE' then parts[#parts + 1] = s end
  end
  local it = df.item_type[m.item_type]
  if it then parts[#parts + 1] = tostring(it):lower():gsub('_', ' ') end
  local name = table.concat(parts, ' ')
  return name ~= '' and name or ('item type ' .. tostring(m.item_type))
end

local function mandate_deadline_days(m)
  local remaining
  if m.timeout_limit and m.timeout_limit > 0 then
    remaining = m.timeout_limit - m.timeout_counter
  else
    remaining = m.timeout_counter
  end
  if not remaining then return nil end
  if remaining < 0 then remaining = 0 end
  return math.floor(remaining / TICKS_PER_DAY + 0.5)
end

local mandates = {}
local export_bans = {}
local guild_demands = {}
for _, m in ipairs(df.global.world.mandates.all) do
  local kind = df.mandate_type[m.mode]
  local noble = m.unit and unit_name(m.unit) or 'unknown'
  local item = mandate_item_name(m)
  if kind == 'Export' then
    export_bans[#export_bans + 1] = item
  elseif kind == 'Guild' then
    guild_demands[#guild_demands + 1] = { noble = noble, item = item }
  else
    mandates[#mandates + 1] = {
      noble = noble,
      kind = 'make',
      item = item,
      count = m.amount_total,
      remaining = m.amount_remaining,
      deadline_days = mandate_deadline_days(m),
    }
  end
end
table.sort(mandates, function(a, b)
  if a.noble ~= b.noble then return a.noble < b.noble end
  return a.item < b.item
end)
table.sort(export_bans)
table.sort(guild_demands, function(a, b)
  if a.noble ~= b.noble then return a.noble < b.noble end
  return a.item < b.item
end)

local function cap(list, n)
  local truncated = false
  if #list > n then
    local kept = {}
    for i = 1, n do kept[i] = list[i] end
    truncated = true
    return kept, truncated
  end
  return list, truncated
end

local mandates_truncated, export_bans_truncated
mandates, mandates_truncated = cap(mandates, MANDATE_CAP)
export_bans, export_bans_truncated = cap(export_bans, BAN_CAP)

local ROOM_ZONE = { office = 'Office', bedroom = 'Bedroom', dining = 'DiningHall', tomb = 'Tomb' }
local demands = {}
for _, n in pairs(nobles) do
  if n.unit then
    local owned = {}
    for _, b in ipairs(n.unit.owned_buildings) do
      if df.building_type[b:getType()] == 'Civzone' then
        owned[df.civzone_type[b.type]] = true
      end
    end
    local reqs = {
      { key = 'office',  need = n.pos.required_office,  value = n.pos.required_office },
      { key = 'bedroom', need = n.pos.required_bedroom, value = n.pos.required_bedroom },
      { key = 'dining',  need = n.pos.required_dining,  value = n.pos.required_dining },
      { key = 'tomb',    need = n.pos.required_tomb,    value = n.pos.required_tomb },
    }
    for _, r in ipairs(reqs) do
      if r.need > 0 and not owned[ROOM_ZONE[r.key]] then
        demands[#demands + 1] = {
          noble = n.name,
          position = n.position,
          demand = r.key,
          required_value = r.value,
          met = false,
        }
      end
    end
  end
end
table.sort(demands, function(a, b)
  if a.noble ~= b.noble then return a.noble < b.noble end
  return a.demand < b.demand
end)
local demands_truncated
demands, demands_truncated = cap(demands, DEMAND_CAP)

local ja = plotinfo.justice_active
local justice_active = (ja == true) or (ja == 1)

local open_cases = 0
for _, c in ipairs(df.global.world.crimes.all) do
  if c.flags.discovered and not c.flags.sentenced then
    open_cases = open_cases + 1
  end
end

local punishments = plotinfo.punishments
local pending_punishments = #punishments
local prison_sentences, scheduled_beatings, scheduled_hammerstrikes = 0, 0, 0
for _, p in ipairs(punishments) do
  if p.prison_counter and p.prison_counter > 0 then prison_sentences = prison_sentences + 1 end
  if p.beating and p.beating > 0 then scheduled_beatings = scheduled_beatings + 1 end
  if p.hammer_strikes and p.hammer_strikes > 0 then
    scheduled_hammerstrikes = scheduled_hammerstrikes + p.hammer_strikes
  end
end

local bo = df.global.world.buildings.other
local function restraint_free(r)
  if r.assigned ~= nil or r.chained ~= nil then return false end
  return true
end
local restraints_built, restraints_free = 0, 0
for _, r in ipairs(bo.CHAIN or {}) do
  restraints_built = restraints_built + 1
  if restraint_free(r) then restraints_free = restraints_free + 1 end
end
for _, r in ipairs(bo.CAGE or {}) do
  restraints_built = restraints_built + 1
  if restraint_free(r) then restraints_free = restraints_free + 1 end
end

local justice = {
  active = justice_active,
  open_cases = open_cases,
  pending_punishments = pending_punishments,
  prison_sentences = prison_sentences,
  scheduled_beatings = scheduled_beatings,
  scheduled_hammerstrikes = scheduled_hammerstrikes,
  restraints_built = restraints_built,
  restraints_free = restraints_free,
}

local alerts = {}
for _, m in ipairs(mandates) do
  if m.remaining and m.remaining > 0 and m.deadline_days and m.deadline_days <= DEADLINE_SOON then
    alerts[#alerts + 1] = m.noble .. "'s mandate (make " .. m.count .. ' ' .. m.item ..
      ') has ' .. m.remaining .. ' left, ' .. m.deadline_days .. ' day(s) to deadline'
  end
end
if #demands > 0 then
  alerts[#alerts + 1] = #demands .. ' unmet noble room demand' .. (#demands == 1 and '' or 's')
end
if prison_sentences > 0 and restraints_free < prison_sentences then
  alerts[#alerts + 1] = prison_sentences .. ' prison sentence' .. (prison_sentences == 1 and '' or 's') ..
    ' pending, ' .. restraints_free .. ' free restraint' .. (restraints_free == 1 and '' or 's')
end

emit({
  population = #citizens,
  nobles = noble_rows,
  mandates = mandates,
  mandates_truncated = mandates_truncated,
  export_bans = export_bans,
  export_bans_truncated = export_bans_truncated,
  guild_demands = guild_demands,
  demands = demands,
  demands_truncated = demands_truncated,
  justice = justice,
  alerts = alerts,
})

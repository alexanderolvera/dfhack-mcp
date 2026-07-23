local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local LOCATION_CAP = 50
local RESIDENCY_CAP = 50
local DEADLINE_SOON = 7
local TICKS_PER_DAY = 1200
local TICKS_PER_YEAR = TICKS_PER_DAY * 28 * 12

local SITE_ID = df.global.plotinfo.site_id
local now_ticks = df.global.cur_year * TICKS_PER_YEAR + df.global.cur_year_tick

local function total_ticks(year, tick) return year * TICKS_PER_YEAR + (tick or 0) end

local function age_days(year, tick)
  local delta = now_ticks - total_ticks(year, tick)
  if delta < 0 then delta = 0 end
  return math.floor(delta / TICKS_PER_DAY)
end

local function deadline_days(end_year, end_tick)
  if not end_year or end_year < 0 then return nil end
  local delta = total_ticks(end_year, end_tick) - now_ticks
  if delta < 0 then delta = 0 end
  return math.floor(delta / TICKS_PER_DAY)
end

local function petition_status(agr, ageDays)
  if agr.flags.convicted_accepted then return 'satisfied' end
  if agr.flags.petition_not_accepted then return 'denied' end
  if ageDays >= 336 then return 'expired' end
  return 'outstanding'
end

local function unit_name(u)
  if not u then return nil end
  local ok, s = pcall(function() return dfhack.units.getReadableName(u) end)
  if ok and s and s ~= '' then return s end
  return nil
end

local function hf_name(hf)
  if not hf then return nil end
  local ok, s = pcall(function() return dfhack.translation.translateName(hf.name, true) end)
  if ok and s and s ~= '' then return s end
  return 'hf ' .. tostring(hf.id)
end

local function entity_name(ent)
  if not ent then return nil end
  local ok, s = pcall(function() return dfhack.translation.translateName(ent.name, true) end)
  if ok and s and s ~= '' then return s end
  return 'entity ' .. tostring(ent.id)
end

local function find_party(agr, party_id)
  if not party_id or party_id < 0 then return nil end
  for _, p in ipairs(agr.parties) do
    if p.id == party_id then return p end
  end
  return nil
end

local function party_name(party)
  if not party then return 'unknown' end
  if party.histfig_ids and #party.histfig_ids > 0 then
    local hf = df.historical_figure.find(party.histfig_ids[0])
    if hf then
      local u = (hf.unit_id and hf.unit_id ~= -1) and df.unit.find(hf.unit_id) or nil
      return unit_name(u) or hf_name(hf) or 'unknown'
    end
  end
  if party.entity_ids and #party.entity_ids > 0 then
    local ent = df.historical_entity.find(party.entity_ids[0])
    if ent then return entity_name(ent) or 'unknown' end
  end
  return 'unknown'
end

local function location_deity(loc)
  local dtype = loc.deity_type
  if dtype == df.religious_practice_type.WORSHIP_HFID then
    local hf = loc.deity_data and df.historical_figure.find(loc.deity_data.Deity)
    if hf then return hf_name(hf) end
  elseif dtype == df.religious_practice_type.RELIGION_ENID then
    local ent = loc.deity_data and df.historical_entity.find(loc.deity_data.Religion)
    if ent then
      local deities = ent.relations and ent.relations.deities
      if deities and #deities > 0 then
        local dhf = df.historical_figure.find(deities[0])
        if dhf then return hf_name(dhf) end
      end
      return entity_name(ent)
    end
  end
  return nil
end

local function guild_profession(loc)
  local p = df.profession[loc.profession]
  if not p then return nil end
  return string.lower(tostring(p)):gsub('_', ' ')
end

local awaiting = {}
for _, aid in ipairs(df.global.plotinfo.petitions) do awaiting[aid] = true end

local location_petitions = {}
local residency_petitions = {}

for _, agr in ipairs(df.global.world.agreements.all) do
  if #agr.details > 0 then
    local det = agr.details[0]
    local dtype = df.agreement_details_type[det.type]
    if dtype == 'Location' then
      local loc = det.data.Location
      if loc and loc.site == SITE_ID then
        local applicant = find_party(agr, loc.applicant)
        local ageDays = age_days(det.year, det.year_tick)
        local building = df.abstract_building_type[loc.type]
        location_petitions[#location_petitions + 1] = {
          agreement_id = agr.id,
          building = building,
          tier = loc.tier,
          petitioner = party_name(applicant),
          deity = (building == 'TEMPLE') and location_deity(loc) or nil,
          guild_profession = (building == 'GUILDHALL') and guild_profession(loc) or nil,
          agreed_year = det.year,
          age_days = ageDays,
          warned_ready = loc.flags.warned_is_ready or false,
          awaiting_decision = awaiting[agr.id] or false,
          status = petition_status(agr, ageDays),
        }
      end
    elseif dtype == 'Residency' or dtype == 'Citizenship' then
      local data = (dtype == 'Residency') and det.data.Residency or det.data.Citizenship
      if data and data.site == SITE_ID then
        local applicant = find_party(agr, data.applicant)
        local ageDays = age_days(det.year, det.year_tick)
        residency_petitions[#residency_petitions + 1] = {
          agreement_id = agr.id,
          kind = dtype,
          petitioner = party_name(applicant),
          agreed_year = det.year,
          age_days = ageDays,
          deadline_days = deadline_days(data.end_year, data.end_season_tick),
          awaiting_decision = awaiting[agr.id] or false,
          status = petition_status(agr, ageDays),
        }
      end
    end
  end
end

table.sort(location_petitions, function(a, b) return a.agreement_id < b.agreement_id end)
table.sort(residency_petitions, function(a, b) return a.agreement_id < b.agreement_id end)

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

local location_petitions_truncated, residency_petitions_truncated
location_petitions, location_petitions_truncated = cap(location_petitions, LOCATION_CAP)
residency_petitions, residency_petitions_truncated = cap(residency_petitions, RESIDENCY_CAP)

local awaiting_decision_count = 0
for _, p in ipairs(location_petitions) do
  if p.awaiting_decision then awaiting_decision_count = awaiting_decision_count + 1 end
end
for _, p in ipairs(residency_petitions) do
  if p.awaiting_decision then awaiting_decision_count = awaiting_decision_count + 1 end
end

local alerts = {}
for _, p in ipairs(location_petitions) do
  if p.warned_ready and p.status == 'outstanding' then
    alerts[#alerts + 1] = p.petitioner .. "'s " .. string.lower(p.building) ..
      ' petition is ready to establish but still outstanding (' .. p.age_days .. ' days)'
  end
end
for _, p in ipairs(residency_petitions) do
  if p.status == 'outstanding' and p.deadline_days ~= nil and p.deadline_days <= DEADLINE_SOON then
    alerts[#alerts + 1] = p.petitioner .. "'s " .. string.lower(p.kind) ..
      ' petition has ' .. p.deadline_days .. ' day(s) left to decide'
  end
end
if awaiting_decision_count > 0 then
  alerts[#alerts + 1] = awaiting_decision_count .. ' petition(s) awaiting a decision'
end

emit({
  location_petitions = location_petitions,
  location_petitions_truncated = location_petitions_truncated,
  residency_petitions = residency_petitions,
  residency_petitions_truncated = residency_petitions_truncated,
  awaiting_decision_count = awaiting_decision_count,
  alerts = alerts,
})

local json = require('json')
local emit = reqscript('mcp_jsonOut').emit

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local CARE = {
  rq_diagnosis  = 'diagnosis',
  rq_immobilize = 'immobilization',
  rq_dressing   = 'dressing',
  rq_cleaning   = 'cleaning',
  rq_surgery    = 'surgery',
  rq_suture     = 'suture',
  rq_setting    = 'bone setting',
  rq_traction   = 'traction',
  rq_crutch     = 'crutch',
}

local DESCRIPTIVE_PART_FLAGS = { edged_damage = true, diagnosed = true }

local function part_is_active(pt)
  if pt.bleeding > 0 or pt.pain > 0 or pt.swelling > 0 or pt.strain > 0 then return true end
  for name, set in pairs(pt.flags1) do
    name = tostring(name)
    if set == true and not DESCRIPTIVE_PART_FLAGS[name] and name:sub(1, 5) ~= 'scar_' then
      return true
    end
  end
  return pt.flags2.needs_setting == true
end

local function wound_is_active(w)
  if w.flags.severed_part or w.flags.infection or w.flags.stuck_weapon or w.flags.popped_out then
    return true
  end
  if w.pain > 0 or w.nausea > 0 or w.dizziness > 0 or w.paralysis > 0
     or w.numbness > 0 or w.fever > 0 then
    return true
  end
  for _, pt in ipairs(w.parts) do
    if part_is_active(pt) then return true end
  end
  return false
end

local function wound_state(u)
  local ws = u.body and u.body.wounds
  if not ws or #ws == 0 then return 'none' end
  for _, w in ipairs(ws) do
    local ok, active = pcall(wound_is_active, w)
    if not ok or active then return 'active' end
  end
  return 'resolved'
end

local function is_asleep(u)
  local job = u.job and u.job.current_job
  return job ~= nil and job.job_type == df.job_type.Sleep
end

local citizens = dfhack.units.getCitizens(true)
local wounded, patients, bedridden, unconscious = 0, 0, 0, 0
local old_wounds_only, asleep = 0, 0
local care = {}

for _, u in ipairs(citizens) do
  local state = wound_state(u)
  if state == 'active' then wounded = wounded + 1
  elseif state == 'resolved' then old_wounds_only = old_wounds_only + 1 end
  local sleeping = is_asleep(u)
  if sleeping then asleep = asleep + 1 end
  if u.counters and u.counters.unconscious and u.counters.unconscious > 0 and not sleeping then
    unconscious = unconscious + 1
  end
  local hf = u.health and u.health.flags
  if hf then
    if hf.needs_healthcare then patients = patients + 1 end
    if hf.should_not_move then bedridden = bedridden + 1 end
    for flag, label in pairs(CARE) do
      if hf[flag] then care[label] = (care[label] or 0) + 1 end
    end
  end
end

local care_needs = {}
for label, n in pairs(care) do care_needs[#care_needs+1] = { care = label, count = n } end
table.sort(care_needs, function(a, b)
  if a.count ~= b.count then return a.count > b.count end
  return a.care < b.care
end)

local UNCONSCIOUS_FRACTION_ALERT = 0.10
local UNCONSCIOUS_MIN_ALERT = 3

local alerts = {}
if unconscious >= UNCONSCIOUS_MIN_ALERT and #citizens > 0
    and (unconscious / #citizens) >= UNCONSCIOUS_FRACTION_ALERT then
  local pct = math.floor(unconscious * 100 / #citizens)
  alerts[#alerts+1] = unconscious .. ' dwarves unconscious (' .. pct .. '% of pop)'
end

emit({
  population = #citizens,
  wounded = wounded,
  old_wounds_only = old_wounds_only,
  patients = patients,
  bedridden = bedridden,
  unconscious = unconscious,
  asleep = asleep,
  care_needs = care_needs,
  alerts = alerts,
})

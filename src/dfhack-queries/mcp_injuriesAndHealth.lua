local json = require('json')
local function emit(t) print(json.encode(t)) end

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

local citizens = dfhack.units.getCitizens(true)
local wounded, patients, bedridden, unconscious = 0, 0, 0, 0
local care = {}

for _, u in ipairs(citizens) do
  if u.body and u.body.wounds and #u.body.wounds > 0 then wounded = wounded + 1 end
  if u.counters and u.counters.unconscious and u.counters.unconscious > 0 then
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
  patients = patients,
  bedridden = bedridden,
  unconscious = unconscious,
  care_needs = care_needs,
  alerts = alerts,
})

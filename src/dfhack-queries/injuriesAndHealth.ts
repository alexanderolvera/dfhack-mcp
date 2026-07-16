// injuries_and_health(): the fort's medical picture — who needs care and what.
//
// unit.health is always present (not nil for the healthy). The actionable
// signals live in unit.health.flags: needs_healthcare (in the care queue),
// should_not_move (bedridden), and the rq_* care requests that say exactly what
// the hospital must do. Reporting the rq_ breakdown tells the player whether
// they're missing a diagnostician, surgeon, or supplies. body.wounds counts the
// wounded; counters.unconscious catches the knocked-out.
//
// Verified live on 53.15-r2: the health.flags field set below is the real one
// (rq_recover does NOT exist; don't reintroduce it).

import { preamble } from './shared.ts';

export const INJURIES_AND_HEALTH = String.raw`${preamble()}
-- rq_* care requests, mapped to plain labels for the breakdown.
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
local care = {}   -- label -> count

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

-- Flatten care needs, most-common first.
local care_needs = {}
for label, n in pairs(care) do care_needs[#care_needs+1] = { care = label, count = n } end
table.sort(care_needs, function(a, b)
  if a.count ~= b.count then return a.count > b.count end
  return a.care < b.care
end)

local alerts = {}
if patients > 0 then
  alerts[#alerts+1] = patients .. ' dwarves need medical care'
end
if unconscious > 0 then
  alerts[#alerts+1] = unconscious .. ' dwarves unconscious'
end
if care_needs[1] then
  alerts[#alerts+1] = 'top care need: ' .. care_needs[1].care .. ' (' .. care_needs[1].count .. ')'
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
`;

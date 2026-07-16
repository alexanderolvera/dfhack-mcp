// unmet_needs(): why the fort is stressed — the needs system, aggregated.
//
// Companion to fort_status's happiness buckets: those say HOW MANY dwarves are
// unhappy; this says WHY and what to build about it. Each citizen soul carries
// personality.needs (df.need_type). focus_level is the signal: >= 0 met/neutral,
// negative = distracted, magnitude = how starved. A dwarf can hold several needs
// of one type (e.g. PrayOrMeditate per deity) — we count each DWARF at most once
// per need type, using their worst focus for that type.
//
// Verified live on 53.15-r2: soul.personality.needs iterates; df.need_type[id]
// yields readable tokens (PrayOrMeditate, DrinkAlcohol, Socialize, ...).
//
// DISTRACTED_BELOW is a heuristic cut (a tunable): below it a dwarf is
// meaningfully distracted, not merely slightly unfulfilled. Ranked by how many
// dwarves are distracted, so the top line is the highest-leverage fix.

import { preamble } from './shared.ts';

export const UNMET_NEEDS = String.raw`${preamble()}
local DISTRACTED_BELOW = -1000   -- tunable: focus_level under this = distracted

-- What the player can DO about each need. Terse, actionable.
local SUGGEST = {
  PrayOrMeditate  = 'build a temple (or deity-specific shrine)',
  DrinkAlcohol    = 'keep alcohol brewed and stocked; a tavern helps',
  Socialize       = 'a tavern / meeting hall for dwarves to gather',
  MakeMerry       = 'a tavern with performances',
  BeWithFriends   = 'a lively meeting hall / tavern',
  EatGoodMeal     = 'cook prepared meals; a proper dining hall',
  AcquireObject   = 'let dwarves own goods; produce/import trinkets',
  BeExtravagant   = 'more/better clothing and jewelry to wear',
  AdmireArt       = 'place statues and engrave common areas',
  LearnSomething  = 'build a library with books/scrolls',
  ThinkAbstractly = 'a library to study in',
  SelfExamination = 'a quiet library / temple',
  CraftObject     = 'assign a craft workshop and labor',
  BeCreative      = 'workshops and artifact-capable labors',
  PracticeSkill   = 'assign labors matching their skills',
  MartialTraining = 'form a squad with a barracks to train',
  Fight           = 'military duty / training',
  StayOccupied    = 'give them jobs; reduce idle time',
  TakeItEasy      = 'ease workload; allow leisure',
  BeWithFamily    = 'keep family housed near each other',
  Excitement      = 'variety: outdoor access, performances',
  MakeRomance     = 'social venues where couples can meet',
  HearEloquence   = 'a tavern with skilled performers',
  SeeAnimal       = 'a zoo / pastured animals to visit',
}

local citizens = dfhack.units.getCitizens(true)
local NEED = df.need_type

-- agg[type] = { distracted = <#dwarves>, worst = <most negative focus> }
local agg = {}
local any_unmet = {}  -- set of unit ids with >=1 distracted need

for _, u in ipairs(citizens) do
  local soul = u.status.current_soul
  if soul and soul.personality and soul.personality.needs then
    local worst_by_type = {}  -- per-dwarf: type -> worst focus this dwarf has
    for _, need in ipairs(soul.personality.needs) do
      if need.focus_level < DISTRACTED_BELOW then
        local t = NEED[need.id] or tostring(need.id)
        if not worst_by_type[t] or need.focus_level < worst_by_type[t] then
          worst_by_type[t] = need.focus_level
        end
      end
    end
    for t, focus in pairs(worst_by_type) do
      local a = agg[t]
      if not a then a = { distracted = 0, worst = 0 }; agg[t] = a end
      a.distracted = a.distracted + 1
      if focus < a.worst then a.worst = focus end
      any_unmet[u.id] = true
    end
  end
end

-- Flatten and sort by #dwarves distracted (desc), then severity.
local rows = {}
for t, a in pairs(agg) do
  rows[#rows+1] = { need = t, dwarves = a.distracted, worst_focus = a.worst,
                    suggestion = SUGGEST[t] or nil }
end
table.sort(rows, function(x, y)
  if x.dwarves ~= y.dwarves then return x.dwarves > y.dwarves end
  return x.worst_focus < y.worst_focus
end)

-- Keep the top offenders; a long tail of 1-2 dwarf needs isn't actionable.
local top = {}
for i = 1, math.min(#rows, 8) do top[i] = rows[i] end

local n_affected = 0
for _ in pairs(any_unmet) do n_affected = n_affected + 1 end

local alerts = {}
if #top > 0 then
  alerts[#alerts+1] = top[1].dwarves .. ' dwarves distracted by unmet need: ' .. top[1].need
end
if n_affected > 0 then
  alerts[#alerts+1] = n_affected .. ' of ' .. #citizens .. ' dwarves have >=1 unmet need'
end

emit({
  population = #citizens,
  dwarves_with_unmet_need = n_affected,
  top_needs = top,
  alerts = alerts,
})
`;

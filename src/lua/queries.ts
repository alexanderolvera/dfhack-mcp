// Centralized DFHack Lua queries. Each is a self-contained chunk run via
// `lua <chunk>` (RunCommand); it gathers state and prints ONE JSON object.
//
// Keeping every version-fragile field access in this one file means a DF/DFHack
// version bump is a localized fix (per the project spec). All queries are
// verified against a live fort before shipping — see scripts/call-tool.mjs and
// the dfhack-remote debug probes.
//
// Field/API notes, confirmed live on DFHack 53.15-r2:
//   * arbitrary Lua: `lua <chunk>` as a single arg (NOT `-e`, console-only)
//   * name:    dfhack.translation.translateName(name, true)
//   * date:    df.global.cur_year, cur_year_tick; 1200 ticks/day, 33600/month
//   * pop:     dfhack.units.getCitizens(true)
//   * stress:  dfhack.units.getStressCategory(u) -> 0 (miserable) .. 6 (ecstatic)
//   * wealth:  df.global.plotinfo.tasks.wealth.total
//   * hostile: isActive && !isDead && isDanger && !isCitizen

export const FORT_STATUS = String.raw`
local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local months = {'Granite','Slate','Felsite','Hematite','Malachite','Galena',
                'Limestone','Sandstone','Timber','Moonstone','Opal','Obsidian'}
local seasons = {'Spring','Summer','Autumn','Winter'}
local tick = df.global.cur_year_tick
local midx = math.floor(tick / 33600)
local day = math.floor((tick % 33600) / 1200) + 1
local function ord(n)
  local v = n % 100
  if v >= 11 and v <= 13 then return n .. 'th' end
  local m = n % 10
  if m == 1 then return n .. 'st'
  elseif m == 2 then return n .. 'nd'
  elseif m == 3 then return n .. 'rd'
  else return n .. 'th' end
end

local ok, fname = pcall(function()
  return dfhack.translation.translateName(df.global.world.world_data.active_site[0].name, true)
end)

local citizens = dfhack.units.getCitizens(true)
local hap = { miserable = 0, unhappy = 0, content = 0, happy = 0 }
for _, u in ipairs(citizens) do
  local c = dfhack.units.getStressCategory(u)
  if c <= 0 then hap.miserable = hap.miserable + 1
  elseif c <= 2 then hap.unhappy = hap.unhappy + 1
  elseif c <= 4 then hap.content = hap.content + 1
  else hap.happy = hap.happy + 1 end
end

local hostiles = 0
for _, u in ipairs(df.global.world.units.active) do
  if dfhack.units.isActive(u) and not dfhack.units.isDead(u)
     and dfhack.units.isDanger(u) and not dfhack.units.isCitizen(u) then
    hostiles = hostiles + 1
  end
end

local wealth = 0
pcall(function() wealth = df.global.plotinfo.tasks.wealth.total end)

local alerts = {}
if hap.miserable > 0 then alerts[#alerts+1] = hap.miserable .. ' dwarves miserable' end
if hap.unhappy > 0 then alerts[#alerts+1] = hap.unhappy .. ' dwarves unhappy' end
if hostiles > 0 then
  alerts[#alerts+1] = hostiles .. ' hostile' .. (hostiles > 1 and 's' or '') .. ' on map'
end

emit({
  fort_name  = ok and fname or 'unknown',
  date       = ord(day) .. ' ' .. months[midx + 1] .. ', Year ' .. df.global.cur_year,
  season     = seasons[math.floor(midx / 3) + 1],
  population = #citizens,
  wealth     = wealth,
  happiness  = hap,
  alerts     = alerts,
})
`;

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
export const THREATS = String.raw`
local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

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
      g = { name = name, count = 0, contained = contained,
            invader = flags.invader, undead = flags.undead,
            crazed = flags.crazed, great_danger = flags.great_danger }
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
for _, g in ipairs(group_list) do
  if not g.contained then
    if g.great_danger then great = great + g.count
    elseif g.invader then invaders = invaders + g.count
    else other = other + g.count end
  end
end
if great > 0 then
  alerts[#alerts+1] = great .. ' great-danger creature' .. (great > 1 and 's' or '') .. ' loose (megabeast/titan/demon/FB)'
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
export const UNMET_NEEDS = String.raw`
local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

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

// jobs_and_labor(): workforce utilization — who's busy, who's idle, doing what.
//
// Derives everything from the citizens themselves (not world.jobs.list, which is
// a linked list, not an array). Children and babies are split out of the labor
// pool: an idle ADULT is wasted labor; an idle child is just a child. For
// working adults we tally current_job.job_type so the player sees what the fort
// is actually spending its hands on.
//
// Verified live on 53.15-r2: u.job.current_job truthy for busy dwarves;
// df.job_type[id] yields readable tokens; isChild/isBaby present.
export const JOBS_AND_LABOR = String.raw`
local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local IDLE_FRACTION_ALERT = 0.30   -- tunable: idle adults over this share -> alert

local citizens = dfhack.units.getCitizens(true)
local JT = df.job_type

local adults, children = 0, 0
local working, idle = 0, 0
local job_counts = {}

for _, u in ipairs(citizens) do
  if dfhack.units.isChild(u) or dfhack.units.isBaby(u) then
    children = children + 1
  else
    adults = adults + 1
    local cj = u.job.current_job
    if cj then
      working = working + 1
      local name = JT[cj.job_type] or tostring(cj.job_type)
      job_counts[name] = (job_counts[name] or 0) + 1
    else
      idle = idle + 1
    end
  end
end

-- Rank active job types (desc) so the top lines are where labor is going.
local jobs = {}
for name, n in pairs(job_counts) do jobs[#jobs+1] = { job = name, count = n } end
table.sort(jobs, function(a, b)
  if a.count ~= b.count then return a.count > b.count end
  return a.job < b.job
end)
local top_jobs = {}
for i = 1, math.min(#jobs, 10) do top_jobs[i] = jobs[i] end

local idle_pct = adults > 0 and math.floor(idle * 100 / adults) or 0

local alerts = {}
if adults > 0 and (idle / adults) >= IDLE_FRACTION_ALERT then
  alerts[#alerts+1] = idle .. ' of ' .. adults .. ' working-age dwarves idle (' .. idle_pct .. '%)'
end

emit({
  workforce = adults,
  children = children,
  working = working,
  idle = idle,
  idle_pct = idle_pct,
  top_jobs = top_jobs,
  alerts = alerts,
})
`;

// stocks(): food/drink as days-of-supply plus a few critical materials.
//
// Item counting follows DFHack's own dfstatus (iterate world.items.other.IN_PLAY,
// skip rotten/dump/forbid/construction/trader, sum stack sizes by type) but
// counts ALL edible food, not just prepared meals, and derives days-of-supply.
//
// Consumption rate (DF wiki, DF2014 Food): a dwarf eats ~2 food and drinks ~5
// units per season; a season is 3 months x 28 days = 84 ticks-days. So
//   food_days  = food_total  * 84 / (pop * 2)
//   drink_days = drink_total * 84 / (pop * 5)
// These are documented estimates; the raw counts in `counts` are exact.
export const STOCKS = String.raw`
local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

-- Tunables (days-of-supply and material floors below which we flag "low").
local SEASON_DAYS = 84
local FOOD_PER_SEASON, DRINK_PER_SEASON = 2, 5
local LOW_DAYS = 14
local LOW_FUEL, LOW_WOOD, LOW_CLOTH = 5, 20, 10
local HIGH_STONE = 500

local T = df.item_type
local edible = {
  [T.FOOD] = true, [T.MEAT] = true, [T.FISH] = true, [T.CHEESE] = true,
  [T.EGG] = true, [T.PLANT] = true, [T.PLANT_GROWTH] = true,
}

local c = { food = 0, prepared_meals = 0, drink = 0, wood = 0, fuel = 0,
            cloth = 0, tanned_hides = 0, stone = 0 }

for _, item in ipairs(df.global.world.items.other.IN_PLAY) do
  local fl = item.flags
  if not (fl.rotten or fl.dump or fl.forbid or fl.construction or fl.trader or fl.garbage_collect) then
    local ty = item:getType()
    local n = item:getStackSize()
    if edible[ty] then
      c.food = c.food + n
      if ty == T.FOOD then c.prepared_meals = c.prepared_meals + n end
    elseif ty == T.DRINK then c.drink = c.drink + n
    elseif ty == T.WOOD then c.wood = c.wood + n
    elseif ty == T.CLOTH then c.cloth = c.cloth + n
    elseif ty == T.SKIN_TANNED then c.tanned_hides = c.tanned_hides + n
    elseif ty == T.BOULDER then c.stone = c.stone + n
    elseif ty == T.BAR and item:getMaterial() == df.builtin_mats.COAL then
      c.fuel = c.fuel + n
    end
  end
end

local pop = #dfhack.units.getCitizens(true)
local function days(total, per) return pop > 0 and math.floor(total * SEASON_DAYS / (pop * per)) or -1 end
local food_days = days(c.food, FOOD_PER_SEASON)
local drink_days = days(c.drink, DRINK_PER_SEASON)

local low, high = {}, {}
if food_days >= 0 and food_days < LOW_DAYS then low[#low+1] = 'food' end
if drink_days >= 0 and drink_days < LOW_DAYS then low[#low+1] = 'drink' end
if c.fuel < LOW_FUEL then low[#low+1] = 'fuel' end
if c.wood < LOW_WOOD then low[#low+1] = 'wood' end
if c.cloth < LOW_CLOTH then low[#low+1] = 'cloth' end
if c.stone > HIGH_STONE then high[#high+1] = 'stone' end

emit({
  population  = pop,
  food_days   = food_days,
  drink_days  = drink_days,
  notable_low = low,
  notable_high = high,
  counts = c,
})
`;

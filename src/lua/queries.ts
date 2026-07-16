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

// military(): squads, soldier headcount, and readiness against live threats.
//
// Two different counts on purpose, because they can disagree and the gap is the
// point: `soldiers` is living, present citizens actually in a squad
// (unit.military.squad_id), while `assigned_positions` is filled squad slots —
// a slot can still hold a member who is dead, off-map, or otherwise not in the
// citizen list. Leading with `soldiers` avoids overstating fighting strength.
// Inlines the same hostile predicate as threats() so readiness reads against
// what's actually on the map.
//
// Verified live on 53.15-r2: squads.all filtered by entity_id == fortress
// entity; translateName(sq.name); unit.military.squad_id.
export const MILITARY = String.raw`
local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local fort = df.global.plotinfo.main.fortress_entity
local squads = {}
local assigned_positions = 0

for _, sq in ipairs(df.global.world.squads.all) do
  if fort and sq.entity_id == fort.id then
    local ok, nm = pcall(function() return dfhack.translation.translateName(sq.name, true) end)
    local name = (ok and nm ~= '' and nm) or (sq.alias ~= '' and sq.alias) or ('Squad ' .. sq.id)
    local filled, total = 0, 0
    for _, pos in ipairs(sq.positions) do
      total = total + 1
      if pos.occupant ~= -1 then filled = filled + 1 end
    end
    assigned_positions = assigned_positions + filled
    squads[#squads+1] = { name = name, filled = filled, positions = total }
  end
end

-- Living, present citizens actually enlisted right now.
local citizens = dfhack.units.getCitizens(true)
local soldiers, adults = 0, 0
for _, u in ipairs(citizens) do
  if not (dfhack.units.isChild(u) or dfhack.units.isBaby(u)) then
    adults = adults + 1
    if u.military and u.military.squad_id and u.military.squad_id ~= -1 then
      soldiers = soldiers + 1
    end
  end
end

-- Hostiles on the map (same predicate as threats(); great-danger split out).
local hostiles, great_danger = 0, 0
for _, u in ipairs(df.global.world.units.active) do
  if dfhack.units.isActive(u) and not dfhack.units.isDead(u)
     and dfhack.units.isDanger(u) and not dfhack.units.isCitizen(u)
     and not (u.flags1.caged or u.flags1.chained) then
    hostiles = hostiles + 1
    if dfhack.units.isGreatDanger(u) then great_danger = great_danger + 1 end
  end
end

local alerts = {}
if #squads == 0 then
  alerts[#alerts+1] = 'no military squads — the fort is undefended'
end
if hostiles > 0 then
  local msg = hostiles .. ' hostile' .. (hostiles > 1 and 's' or '') .. ' on map vs ' ..
              soldiers .. ' soldier' .. (soldiers == 1 and '' or 's') ..
              ' in ' .. #squads .. ' squad' .. (#squads == 1 and '' or 's')
  if great_danger > 0 and soldiers == 0 then
    msg = msg .. ' — NO defenders against a great-danger creature'
  end
  alerts[#alerts+1] = msg
end

emit({
  squad_count = #squads,
  soldiers = soldiers,
  assigned_positions = assigned_positions,
  adults = adults,
  hostiles_on_map = hostiles,
  great_danger_on_map = great_danger,
  squads = squads,
  alerts = alerts,
})
`;

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
export const INJURIES_AND_HEALTH = String.raw`
local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

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

// find_unit(query): a dossier on citizens matching a name or profession.
//
// The one parameterized query. The search term is injected as a Lua single-
// quoted literal via luaStr() (escapes \\ ' newline) so it can't break the chunk
// or inject Lua. Matches case-insensitively against the readable name AND the
// profession, so "medical" finds the chief medical dwarf and a partial name
// finds the dwarf. Returns a compact profile per match: profession, age, stress,
// current job, squad, and a health summary.
//
// Verified live on 53.15-r2: getReadableName, getProfessionName, getAge,
// getStressCategory all present; squad lookup via squads.all by id.

/** Escape an arbitrary string into a safe Lua single-quoted literal. */
function luaStr(s: string): string {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n') + "'";
}

const STRESS_LABELS = "{[0]='miserable',[1]='unhappy',[2]='unhappy',[3]='content',[4]='content',[5]='happy',[6]='ecstatic'}";

export function findUnitQuery(query: string): string {
  return String.raw`
local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local q = string.lower(${luaStr(query)})
local STRESS = ${STRESS_LABELS}
local MAX = 8

-- Pre-index fort squads by id for name lookup.
local squad_name = {}
local fort = df.global.plotinfo.main.fortress_entity
for _, sq in ipairs(df.global.world.squads.all) do
  if fort and sq.entity_id == fort.id then
    local ok, nm = pcall(function() return dfhack.translation.translateName(sq.name, true) end)
    squad_name[sq.id] = (ok and nm ~= '' and nm) or (sq.alias ~= '' and sq.alias) or ('Squad ' .. sq.id)
  end
end

local matches = {}
local total = 0
for _, u in ipairs(dfhack.units.getCitizens(true)) do
  local name = dfhack.units.getReadableName(u)
  local prof = dfhack.units.getProfessionName(u)
  if string.find(string.lower(name), q, 1, true) or string.find(string.lower(prof), q, 1, true) then
    total = total + 1
    if #matches < MAX then
      local cj = u.job.current_job
      local sc = dfhack.units.getStressCategory(u)
      local sid = u.military and u.military.squad_id or -1
      matches[#matches+1] = {
        name       = name,
        profession = prof,
        age        = math.floor(dfhack.units.getAge(u, true)),
        stress     = STRESS[sc] or tostring(sc),
        current_job = cj and (df.job_type[cj.job_type] or tostring(cj.job_type)) or 'idle',
        squad      = (sid ~= -1 and squad_name[sid]) or nil,
        wounded    = (u.body and u.body.wounds and #u.body.wounds > 0) or false,
        patient    = (u.health and u.health.flags and u.health.flags.needs_healthcare) or false,
        unconscious = (u.counters and u.counters.unconscious and u.counters.unconscious > 0) or false,
      }
    end
  end
end

emit({
  query = ${luaStr(query)},
  match_count = total,
  truncated = total > #matches,
  matches = matches,
})
`;
}

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
// game_data(query, kind): look up the LOADED WORLD's raws (df.global.world.raws.*)
// — ground truth for THIS world, the only source for procedural creatures
// (demons/forgotten beasts/titans, which are never on the wiki).
//
// One unified tool with a per-kind dispatch so new kinds (material/plant/reaction/
// item/building) drop in without a new tool. MVP implements the CREATURE kind;
// other kinds return {error:"kind 'X' not yet implemented"}.
//
// CREATURE matching contract:
//   * query is all digits            -> treat as a live unit_id (fusion shortcut):
//                                        df.unit.find(id).race indexes
//                                        raws.creatures.all -> that unit's race.
//   * exact creature_id token match  -> single strong hit (dossier).
//   * exact name/caste_name match    -> single strong hit (dossier).
//   * otherwise case-insensitive substring against creature_id + the name tuple
//     (singular/plural/adjective) + every caste_name. Exactly one match ->
//     dossier; several -> a disambiguation list (cap 8), mirroring find_unit;
//     none -> {match_count:0, matches:[]}.
//
// Verified live on DFHack 53.15-r2 against the two "Flame Phantom" demons
// (DEMON_4, unit_id 18393, race 1661). Confirmed version-fragile field paths:
//   * df.global.world.raws.creatures.all[race]  -> creature_raw
//   * cr.creature_id (token), cr.name[0..2] (singular/plural/adjective)
//   * cr.adultsize (body volume, cm^3), cr.caste (vector; the field is `caste`,
//     NOT `castes`), caste.caste_name[0..2], caste.description (a ready blurb),
//     caste.flags (a bitfield whose TRUE keys are stable token names — iterate
//     pairs(); NOT indexed by df.caste_raw_flags, so we never index it by token)
//   * caste.body_info.attacks[].{name,verb_3rd} (dup per left/right bp -> dedupe)
//   * caste.body_info.interactions[].interaction.adv_name (breath weapon label,
//     e.g. "Hurl fireball"/"Spray jet of fire"/"Emit dust") + material_str0..2
//     (the emitted material token, e.g. CREATURE_MAT:DEMON_4:POISON — the dust's
//     syndrome material). The syndrome vector on the resolved material reads 0 in
//     this build, so we surface the emission material token rather than traverse
//     a fragile/empty syndrome path.
//   * df.unit.find(id).race for the unit_id shortcut.

/** Advisor-relevant caste flag tokens. Only these are surfaced from the (large)
 *  raw flag bitfield. We read pairs(caste.flags) and keep TRUE keys in this set,
 *  so a token absent from a given creature's build simply never appears — no
 *  indexing by token, no crash. */
const CREATURE_FLAG_WHITELIST =
  "{DEMON=1,UNIQUE_DEMON=1,MEGABEAST=1,SEMIMEGABEAST=1,NIGHT_CREATURE_HUNTER=1," +
  "NIGHT_CREATURE_BOGEYMAN=1,NIGHT_CREATURE_NIGHTMARE=1,NIGHT_CREATURE_EXPERIMENT=1," +
  "FLIER=1,BUILDINGDESTROYER=1,FIREIMMUNE=1,FIREIMMUNE_SUPER=1,LARGE_PREDATOR=1," +
  "TRAPAVOID=1,WEBIMMUNE=1,WEBBER=1,NOT_LIVING=1,OPPOSED_TO_LIFE=1,SUPERNATURAL=1," +
  "EXTRAVISION=1,MAGMA_VISION=1,CAN_LEARN=1,CAN_SPEAK=1,NOFEAR=1,NOPAIN=1,NOSTUN=1," +
  "NO_SLEEP=1,NO_EAT=1,NO_DRINK=1,MISCHIEVOUS=1,AMPHIBIOUS=1,VENOMOUS=1," +
  "MOUNT=1,PET=1,COMMON_DOMESTIC=1,POWER=1,MANNERISM_LAUGH=0}";

export function gameDataQuery(query: string, kind?: string): string {
  return String.raw`
local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no game loaded' })
  return
end

local query = ${luaStr(query)}
local kind = ${luaStr(kind ?? '')}
if kind == '' then kind = 'creature' end

local FLAG_WL = ${CREATURE_FLAG_WHITELIST}
local MAX = 8
local creatures = df.global.world.raws.creatures.all

local function trim(s) return (tostring(s):gsub('^%s*(.-)%s*$', '%1')) end

-- DF body volume (cm^3) -> a glanceable size bucket.
local function size_label(v)
  if v < 1000 then return 'tiny'
  elseif v < 15000 then return 'small'
  elseif v < 100000 then return 'medium'
  elseif v < 500000 then return 'large'
  elseif v < 2000000 then return 'huge'
  else return 'gigantic' end
end

-- First sentence of a caste description -> a short human blurb.
local function first_sentence(desc)
  if not desc or desc == '' then return nil end
  local dot = string.find(desc, '%.')
  if dot then return trim(string.sub(desc, 1, dot)) end
  return trim(desc)
end

-- Curated advisor flags, unioned across all castes (a bitfield of stable token
-- keys; we only keep TRUE keys that are whitelisted).
local function creature_flags(cr)
  local set = {}
  for ci = 0, #cr.caste - 1 do
    for k, v in pairs(cr.caste[ci].flags) do
      if v == true and FLAG_WL[k] then set[k] = true end
    end
  end
  local out = {}
  for k in pairs(set) do out[#out+1] = k end
  table.sort(out)
  return out
end

-- Melee attacks, deduped by name (raws list one per left/right body part).
local function creature_attacks(caste)
  local seen, out = {}, {}
  for _, a in ipairs(caste.body_info.attacks) do
    if a.name and a.name ~= '' and not seen[a.name] then
      seen[a.name] = true
      out[#out+1] = { name = a.name, verb = (a.verb_3rd ~= '' and a.verb_3rd) or nil }
    end
  end
  return out
end

-- Breath weapons / creature interactions: the human adv_name plus the emitted
-- material token (which carries the syndrome, e.g. dust) when present.
local function creature_interactions(caste)
  local out = {}
  for _, ci in ipairs(caste.body_info.interactions) do
    local it = ci.interaction
    local nm = it.adv_name
    if nm and nm ~= '' then
      local parts = {}
      for _, s in ipairs({ it.material_str0, it.material_str1, it.material_str2 }) do
        if s and s ~= '' then parts[#parts+1] = s end
      end
      out[#out+1] = {
        name = nm,
        material = (#parts > 0) and table.concat(parts, ':') or nil,
      }
    end
  end
  return out
end

local function best_caste(cr)
  return cr.caste[0]
end

-- Full curated dossier for one creature_raw.
local function dossier(cr, unit_id, unit_name)
  local caste = best_caste(cr)
  local desc = caste.description
  return {
    kind        = 'creature',
    token       = tostring(cr.creature_id),
    name        = tostring(cr.name[0]),
    plural      = (cr.name[1] ~= '' and tostring(cr.name[1])) or nil,
    caste_count = #cr.caste,
    size        = cr.adultsize,
    size_label  = size_label(cr.adultsize),
    flags       = creature_flags(cr),
    attacks     = creature_attacks(caste),
    interactions = creature_interactions(caste),
    description = (desc ~= '' and desc) or nil,
    blurb       = first_sentence(desc),
    unit_id     = unit_id,
    unit_name   = unit_name,
  }
end

-- Compact entry for a disambiguation list.
local function stub(cr)
  local blurb = first_sentence(best_caste(cr).description)
  if not blurb then
    local fl = creature_flags(cr)
    blurb = size_label(cr.adultsize) .. ' ' .. (fl[1] and string.lower(fl[1]) or 'creature')
  end
  return { kind = 'creature', token = tostring(cr.creature_id),
           name = tostring(cr.name[0]), blurb = blurb }
end

local function lc(s) return string.lower(tostring(s)) end

-- ---- CREATURE kind -------------------------------------------------------
local function find_creature(q)
  -- Fusion shortcut: an all-digits query is a live unit_id.
  if string.match(q, '^%d+$') then
    local u = df.unit.find(tonumber(q))
    if not u then
      emit({ query = query, match_count = 0, matches = {} })
      return
    end
    local cr = creatures[u.race]
    if not cr then
      emit({ query = query, match_count = 0, matches = {} })
      return
    end
    local ok, nm = pcall(dfhack.units.getReadableName, u)
    emit(dossier(cr, u.id, ok and nm or nil))
    return
  end

  local ql = lc(q)
  local all, exact = {}, {}
  for i = 0, #creatures - 1 do
    local cr = creatures[i]
    local token = tostring(cr.creature_id)
    -- gather candidate names: creature name tuple + every caste_name
    local hit, is_exact = false, false
    if lc(token) == ql then is_exact = true; hit = true
    elseif string.find(lc(token), ql, 1, true) then hit = true end
    for n = 0, 2 do
      local nm = cr.name[n]
      if nm and nm ~= '' then
        if lc(nm) == ql then is_exact = true; hit = true
        elseif string.find(lc(nm), ql, 1, true) then hit = true end
      end
    end
    if not hit then
      for ci = 0, #cr.caste - 1 do
        local cn = cr.caste[ci].caste_name[0]
        if cn and cn ~= '' then
          if lc(cn) == ql then is_exact = true; hit = true; break
          elseif string.find(lc(cn), ql, 1, true) then hit = true; break end
        end
      end
    end
    if hit then
      all[#all+1] = cr
      if is_exact then exact[#exact+1] = cr end
    end
  end

  -- One strong (exact) hit, or a single overall hit -> a full dossier.
  if #exact == 1 then emit(dossier(exact[1])); return end
  if #all == 1 then emit(dossier(all[1])); return end

  -- Otherwise a disambiguation list (cap MAX), mirroring find_unit.
  local matches = {}
  for i = 1, math.min(#all, MAX) do matches[#matches+1] = stub(all[i]) end
  emit({
    query = query,
    match_count = #all,
    truncated = #all > #matches,
    matches = matches,
  })
end

local UNIMPLEMENTED = { material = 1, plant = 1, reaction = 1, item = 1, building = 1 }
local DISPATCH = { creature = find_creature }

if DISPATCH[kind] then
  DISPATCH[kind](query)
elseif UNIMPLEMENTED[kind] then
  emit({ error = "kind '" .. kind .. "' not yet implemented" })
else
  emit({ error = "unknown kind '" .. kind .. "'" })
end
`;
}

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

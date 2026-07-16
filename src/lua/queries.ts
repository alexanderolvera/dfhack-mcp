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

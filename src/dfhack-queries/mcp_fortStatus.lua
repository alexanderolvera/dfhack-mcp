-- mcp_fortStatus: one-call situational overview of the loaded fort — name, date,
-- season, population, wealth, a happiness breakdown, and a pre-triaged alerts list.
-- Invoked by name via DFHack RunCommand; prints ONE JSON object.

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

-- Unhappy dwarves scale with population: a handful stressed at any moment is
-- normal churn, not news. 'miserable' (stress category <= 0) is different — one
-- can tantrum or go insane, so it's notable at any count. Gate 'unhappy' on a
-- share of population so the alert means a fort-wide morale driver, not a number.
local UNHAPPY_FRACTION_ALERT = 0.10   -- tunable: unhappy share over this -> alert

local alerts = {}
if hap.miserable > 0 then alerts[#alerts+1] = hap.miserable .. ' dwarves miserable' end
if #citizens > 0 and (hap.unhappy / #citizens) >= UNHAPPY_FRACTION_ALERT then
  local pct = math.floor(hap.unhappy * 100 / #citizens)
  alerts[#alerts+1] = hap.unhappy .. ' dwarves unhappy (' .. pct .. '% of pop)'
end
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

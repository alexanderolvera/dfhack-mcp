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

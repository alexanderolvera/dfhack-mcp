local json = require('json')
local emit = reqscript('mcp_jsonOut').emit

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local visibility = reqscript('mcp_unitVisibility')

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
     and dfhack.units.isDanger(u) and not dfhack.units.isCitizen(u)
     and not visibility.is_hidden(u) then
    hostiles = hostiles + 1
  end
end

local wealth = 0
pcall(function() wealth = df.global.plotinfo.tasks.wealth.total end)

local DEATH_WINDOW_YEARS = 1
local DEATH_SCAN_CAP = 5000

local SITE_ID = df.global.plotinfo.site_id
local GROUP_ID = df.global.plotinfo.group_id

local function is_ours(hf)
  if not hf then return false end
  for _, link in ipairs(hf.entity_links) do
    if link.entity_id == GROUP_ID
       and tostring(df.histfig_entity_link_type[link:getType()]) == 'MEMBER' then
      return true
    end
  end
  return false
end

local since_year = df.global.cur_year - DEATH_WINDOW_YEARS
local citizen_deaths, slain_by_citizen, outsider_deaths_at_site = 0, 0, 0
local death_causes = {}
pcall(function()
  local ed = df.global.world.history.events_death
  local scanned = 0
  for i = #ed - 1, 0, -1 do
    scanned = scanned + 1
    if scanned > DEATH_SCAN_CAP then break end
    local e = ed[i]
    if e.year < since_year then break end
    if e.site == SITE_ID then
      local victim = df.historical_figure.find(e.victim_hf)
      if is_ours(victim) then
        citizen_deaths = citizen_deaths + 1
        local cause = tostring(df.death_type[e.death_cause])
        death_causes[cause] = (death_causes[cause] or 0) + 1
        local slayer = (e.slayer_hf ~= -1) and df.historical_figure.find(e.slayer_hf) or nil
        if is_ours(slayer) then slain_by_citizen = slain_by_citizen + 1 end
      else
        outsider_deaths_at_site = outsider_deaths_at_site + 1
      end
    end
  end
end)

local cause_rows = {}
for cause, n in pairs(death_causes) do cause_rows[#cause_rows + 1] = { cause = cause, count = n } end
table.sort(cause_rows, function(a, b)
  if a.count ~= b.count then return a.count > b.count end
  return a.cause < b.cause
end)

local recent_deaths = {
  since_year = since_year,
  citizens = citizen_deaths,
  citizens_slain_by_citizen = slain_by_citizen,
  outsiders_at_site = outsider_deaths_at_site,
  citizen_causes = cause_rows,
}

local UNHAPPY_FRACTION_ALERT = 0.10
local UNHAPPY_MIN_ALERT = 3

local alerts = {}
if hap.unhappy >= UNHAPPY_MIN_ALERT and #citizens > 0
    and (hap.unhappy / #citizens) >= UNHAPPY_FRACTION_ALERT then
  local pct = math.floor(hap.unhappy * 100 / #citizens)
  alerts[#alerts+1] = hap.unhappy .. ' dwarves unhappy (' .. pct .. '% of pop)'
end
if hostiles > 0 then
  alerts[#alerts+1] = hostiles .. ' hostile' .. (hostiles > 1 and 's' or '') .. ' on map'
end
if citizen_deaths > 0 then
  local parts = {}
  for _, r in ipairs(cause_rows) do
    parts[#parts + 1] = r.count .. ' ' .. string.lower(r.cause):gsub('_', ' ')
  end
  alerts[#alerts+1] = citizen_deaths .. ' citizen death' .. (citizen_deaths == 1 and '' or 's') ..
    ' since year ' .. since_year .. ' (' .. table.concat(parts, ', ') .. ')'
end
if slain_by_citizen > 0 then
  alerts[#alerts+1] = slain_by_citizen .. ' of those citizen' ..
    (slain_by_citizen == 1 and ' was' or 's were') .. ' slain by another citizen'
end

emit({
  fort_name  = ok and fname or 'unknown',
  date       = ord(day) .. ' ' .. months[midx + 1] .. ', Year ' .. df.global.cur_year,
  season     = seasons[math.floor(midx / 3) + 1],
  population = #citizens,
  wealth     = wealth,
  happiness  = hap,
  recent_deaths = recent_deaths,
  alerts     = alerts,
})

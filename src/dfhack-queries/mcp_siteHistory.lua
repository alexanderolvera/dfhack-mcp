local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local BATTLE_CAP = 20
local DEATH_CAP = 25

local function u(s)
  if s == nil then return nil end
  s = tostring(s)
  if dfhack.df2utf then
    local ok, v = pcall(dfhack.df2utf, s)
    if ok then return v end
  end
  return s
end

local function name_str(name, english)
  local ok, s = pcall(dfhack.translation.translateName, name, english)
  if ok and s and s ~= '' then return u(s) end
  return nil
end

local function civ_name(id)
  if not id or id < 0 then return nil end
  for _, e in ipairs(df.global.world.entities.all) do
    if e.id == id then return name_str(e.name, true) end
  end
  return nil
end

local function civ_names(id)
  if not id or id < 0 then return nil, nil end
  for _, e in ipairs(df.global.world.entities.all) do
    if e.id == id then return name_str(e.name, false), name_str(e.name, true) end
  end
  return nil, nil
end

local function hf_name(id)
  if not id or id < 0 then return nil end
  local hf = df.historical_figure.find(id)
  if not hf then return nil end
  return name_str(hf.name, true)
end

local function hf_race(id)
  if not id or id < 0 then return nil end
  local hf = df.historical_figure.find(id)
  if not hf then return nil end
  local tok
  pcall(function() tok = tostring(df.global.world.raws.creatures.all[hf.race].creature_id) end)
  return tok
end

local MONTHS = { 'Granite', 'Slate', 'Felsite', 'Hematite', 'Malachite', 'Galena',
  'Limestone', 'Sandstone', 'Timber', 'Moonstone', 'Opal', 'Obsidian' }
local function ord(n)
  local v = n % 100
  if v >= 11 and v <= 13 then return n .. 'th' end
  local m = n % 10
  if m == 1 then return n .. 'st' elseif m == 2 then return n .. 'nd'
  elseif m == 3 then return n .. 'rd' else return n .. 'th' end
end
local function date_str(year, tick)
  if not year then return nil end
  if not tick or tick < 0 then return 'Year ' .. year end
  local midx = math.floor(tick / 33600)
  local day = math.floor((tick % 33600) / 1200) + 1
  local mon = MONTHS[midx + 1]
  if not mon then return 'Year ' .. year end
  return ord(day) .. ' ' .. mon .. ', Year ' .. year
end

local SITE = df.global.plotinfo.site_id
local site
do
  local sites = df.global.world.world_data.sites
  for i = 0, #sites - 1 do
    if sites[i].id == SITE then site = sites[i]; break end
  end
end
if not site then
  emit({ error = 'no site loaded' })
  return
end

local function name_etymology(name)
  local out = {}
  pcall(function()
    local words = name.words
    local langwords = df.global.world.raws.language.words
    for wi = 0, #words - 1 do
      local widx = words[wi]
      if widx and widx >= 0 then
        local root, part
        pcall(function() root = tostring(langwords[widx].word) end)
        pcall(function() part = tostring(df.part_of_speech[name.parts_of_speech[wi]]) end)
        if root and root ~= '' then
          out[#out + 1] = { word = root, part = part }
        end
      end
    end
  end)
  return out
end

local created_year, created_tick, builder_hf
pcall(function() created_year = site.created_year end)
pcall(function() created_tick = site.created_tick end)
do
  local events = df.global.world.history.events
  for i = 0, #events - 1 do
    local e = events[i]
    local ok, t = pcall(function() return e:getType() end)
    if ok and tostring(df.history_event_type[t]) == 'CREATED_SITE' then
      local es; pcall(function() es = e.site end)
      if es == SITE then
        if created_year == nil then pcall(function() created_year = e.year end) end
        pcall(function() builder_hf = e.builder_hf end)
        break
      end
    end
  end
end

local civ_id = df.global.plotinfo.civ_id
local civ_dwarven, civ_english = civ_names(civ_id)

local WAR_TYPES = { WAR_ATTACKED_SITE = true, WAR_DESTROYED_SITE = true,
  WAR_SITE_NEW_LEADER = true }
local battles, battles_total = {}, 0
local deaths, deaths_total = {}, 0
do
  local events = df.global.world.history.events
  for i = 0, #events - 1 do
    local e = events[i]
    local ok, t = pcall(function() return e:getType() end)
    if ok then
      local tname = tostring(df.history_event_type[t])
      local es; pcall(function() es = e.site end)
      if es == SITE then
        if WAR_TYPES[tname] then
          battles_total = battles_total + 1
          local b = { year = nil, type = tname }
          pcall(function() b.year = e.year end)
          pcall(function() b.attacker = civ_name(e.attacker_civ) end)
          pcall(function() b.defender = civ_name(e.defender_civ) end)
          pcall(function() b.attacker_general = hf_name(e.attacker_general_hf) end)
          pcall(function() b.defender_general = hf_name(e.defender_general_hf) end)
          if tname == 'WAR_DESTROYED_SITE' then b.outcome = 'site destroyed' end
          b._ord = #battles + 1
          battles[#battles + 1] = b
        elseif tname == 'HIST_FIGURE_DIED' then
          local vic; pcall(function() vic = e.victim_hf end)
          local nm = hf_name(vic)
          if nm then
            deaths_total = deaths_total + 1
            local d = { name = nm, year = nil }
            pcall(function() d.year = e.year end)
            d.race = hf_race(vic)
            pcall(function() d.cause = tostring(df.death_type[e.death_cause]) end)
            local slayer; pcall(function() slayer = e.slayer_hf end)
            local sn = hf_name(slayer)
            if sn then d.slain_by = sn end
            d._ord = #deaths + 1
            deaths[#deaths + 1] = d
          end
        end
      end
    end
  end
end

local function by_year_desc(a, b)
  local ay, by = a.year or 0, b.year or 0
  if ay ~= by then return ay > by end
  return (a._ord or 0) < (b._ord or 0)
end
table.sort(battles, by_year_desc)
table.sort(deaths, by_year_desc)
local function cap(list, n)
  if #list <= n then return list end
  local out = {}
  for i = 1, n do out[i] = list[i] end
  return out
end
battles = cap(battles, BATTLE_CAP)
deaths = cap(deaths, DEATH_CAP)
for _, b in ipairs(battles) do b._ord = nil end
for _, d in ipairs(deaths) do d._ord = nil end

emit({
  site_id = SITE,
  site_name = name_str(site.name, false),
  site_name_english = name_str(site.name, true),
  site_type = tostring(df.world_site_type[site.type]),
  pos = { x = site.pos.x, y = site.pos.y },
  current_year = df.global.cur_year,
  age_years = (created_year ~= nil) and (df.global.cur_year - created_year) or nil,
  founding = {
    year = created_year,
    date = date_str(created_year, created_tick),
    civ_id = civ_id,
    civ = civ_dwarven,
    civ_english = civ_english,
    builder = hf_name(builder_hf),
  },
  name_etymology = name_etymology(site.name),
  battles = battles,
  battles_truncated = (battles_total > #battles) or nil,
  battles_total = (battles_total > #battles) and battles_total or nil,
  notable_deaths = deaths,
  notable_deaths_truncated = (deaths_total > #deaths) or nil,
  notable_deaths_total = (deaths_total > #deaths) and deaths_total or nil,
})

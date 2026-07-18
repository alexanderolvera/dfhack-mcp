-- mcp_siteHistory: this fort's entry in the PERMANENT world saga — founding
-- (year + date + owning civ), the fort name in Dwarven and English with a word
-- etymology, prior sieges/battles fought AT this site (with outcomes/generals),
-- and the notable historical figures who died here. Reads the durable event log
-- (df.global.world.history.events), NOT the pruned live report stream, so it
-- survives across seasons. Scoped STRICTLY to the loaded site_id — never a
-- world-gen data dump. Invoked by name via DFHack RunCommand; prints ONE JSON object.
--
-- Verified live on DFHack 53.15 against "Fortress of Dreams" (site_id 25, civ 10,
-- year 7). Confirmed, version-fragile field paths (all read through pcall):
--   * CURRENT SITE: df.global.plotinfo.site_id; the record is the entry in
--     df.global.world.world_data.sites with .id == site_id. Per-site: .name
--     (language_name), .type (df.world_site_type; fort = PlayerFortress),
--     .created_year, .created_tick, .pos.{x,y}. A player fort's own .civ_id is
--     -1, so the OWNING civ comes from df.global.plotinfo.civ_id, matched in
--     df.global.world.entities.all by .id.
--   * NAMES: dfhack.translation.translateName(name) = Dwarven ("Geshud Nözom");
--     (name, true) = English ("Fortress of Dreams"). Wrapped in dfhack.df2utf so
--     CP437 accents (ö, ä in proper nouns) become valid UTF-8 in the JSON.
--   * ETYMOLOGY: name.words[0..6] index df.global.world.raws.language.words
--     (.word = the English root, e.g. FORTRESS/DREAM); name.parts_of_speech[i]
--     indexes df.part_of_speech.
--   * BATTLES: history events carrying a .site field equal to this site_id and of
--     a war type (WAR_ATTACKED_SITE / WAR_DESTROYED_SITE / WAR_SITE_NEW_LEADER).
--     Fields .year, .attacker_civ, .defender_civ, .attacker_general_hf,
--     .defender_general_hf resolve to civ/figure names. WAR_FIELD_BATTLE is
--     region-scoped (no .site) so it is intentionally NOT included — battles here
--     means sieges fought AT this site. A young player fort typically has NONE,
--     so this degrades to an empty list (verified: site 25 has zero), while the
--     formatting path was verified against a besieged site (WAR_ATTACKED_SITE).
--   * NOTABLE DEATHS: HIST_FIGURE_DIED events with .site == site_id and a NAMED
--     victim (unnamed butchered livestock is excluded — a "figure" has a name).
--     .victim_hf -> df.historical_figure.find; .death_cause -> df.death_type;
--     .slayer_hf -> the killer's name when >= 0.
-- Battles and deaths are each sorted most-recent-first and capped (see caps
-- below); a truncated list reports its full total.

local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local BATTLE_CAP = 20
local DEATH_CAP = 25

-- CP437 -> UTF-8 so accented proper nouns are valid JSON; ASCII passes through.
local function u(s)
  if s == nil then return nil end
  s = tostring(s)
  if dfhack.df2utf then
    local ok, v = pcall(dfhack.df2utf, s)
    if ok then return v end
  end
  return s
end

-- Translate a language_name to its display string (Dwarven or English), UTF-8 safe.
local function name_str(name, english)
  local ok, s = pcall(dfhack.translation.translateName, name, english)
  if ok and s and s ~= '' then return u(s) end
  return nil
end

-- Resolve a civ/entity id to its English display name (nil if not found).
local function civ_name(id)
  if not id or id < 0 then return nil end
  for _, e in ipairs(df.global.world.entities.all) do
    if e.id == id then return name_str(e.name, true) end
  end
  return nil
end

-- Resolve a civ/entity id to BOTH name forms (story-writers want each).
local function civ_names(id)
  if not id or id < 0 then return nil, nil end
  for _, e in ipairs(df.global.world.entities.all) do
    if e.id == id then return name_str(e.name, false), name_str(e.name, true) end
  end
  return nil, nil
end

-- Resolve a historical-figure id to its English display name.
local function hf_name(id)
  if not id or id < 0 then return nil end
  local hf = df.historical_figure.find(id)
  if not hf then return nil end
  return name_str(hf.name, true)
end

-- A historical figure's creature token (e.g. "DWARF"), read defensively.
local function hf_race(id)
  if not id or id < 0 then return nil end
  local hf = df.historical_figure.find(id)
  if not hf then return nil end
  local tok
  pcall(function() tok = tostring(df.global.world.raws.creatures.all[hf.race].creature_id) end)
  return tok
end

-- DF calendar: 33600 ticks/month, 1200 ticks/day. A within-year tick -> "Nth Month".
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

-- ---- locate the loaded site -------------------------------------------------
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

-- ---- name + etymology -------------------------------------------------------
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

-- ---- founding ---------------------------------------------------------------
local created_year, created_tick, builder_hf
pcall(function() created_year = site.created_year end)
pcall(function() created_tick = site.created_tick end)
-- Corroborate founding + capture the builder from the CREATED_SITE saga event.
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

-- ---- battles + notable deaths (single pass over the saga) -------------------
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
          battles[#battles + 1] = b
        elseif tname == 'HIST_FIGURE_DIED' then
          local vic; pcall(function() vic = e.victim_hf end)
          local nm = hf_name(vic)
          -- A "notable figure" has a name; unnamed butchered livestock is skipped.
          if nm then
            deaths_total = deaths_total + 1
            local d = { name = nm, year = nil }
            pcall(function() d.year = e.year end)
            d.race = hf_race(vic)
            pcall(function() d.cause = tostring(df.death_type[e.death_cause]) end)
            local slayer; pcall(function() slayer = e.slayer_hf end)
            local sn = hf_name(slayer)
            if sn then d.slain_by = sn end
            deaths[#deaths + 1] = d
          end
        end
      end
    end
  end
end

-- Most-recent-first, then cap. Stable order for equal years preserves saga order.
local function by_year_desc(a, b) return (a.year or 0) > (b.year or 0) end
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
    civ = civ_dwarven, -- Dwarven form, e.g. "Uzoledzul"
    civ_english = civ_english, -- English form, e.g. "The Oily Vestibule"
    builder = hf_name(builder_hf), -- nil when no founder is recorded (builder_hf == -1)
  },
  name_etymology = name_etymology(site.name),
  battles = battles,
  battles_truncated = (battles_total > #battles) or nil,
  battles_total = (battles_total > #battles) and battles_total or nil,
  notable_deaths = deaths,
  notable_deaths_truncated = (deaths_total > #deaths) or nil,
  notable_deaths_total = (deaths_total > #deaths) and deaths_total or nil,
})

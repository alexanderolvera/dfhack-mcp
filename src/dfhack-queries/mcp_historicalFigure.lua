local args = {...}
local query = args[1] or ''

local emit = reqscript('mcp_jsonOut').emit
local visibility = reqscript('mcp_unitVisibility')

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

if not string.match(query, '^%d+$') then
  emit({ error = 'historical_figure expects a numeric hf_id (all digits); got "' .. tostring(query) .. '"' })
  return
end

local HF_ID = tonumber(query)
local hf = df.historical_figure.find(HF_ID)
if not hf then
  emit({ error = 'no historical figure with id ' .. query })
  return
end

local CAPS = {
  entities = 50,
  positions = 25,
  relationships = 50,
  worship = 20,
  sites = 25,
  kills = 50,
  unnamed_kills = 25,
  events = 50,
}

local function safe(fn)
  local ok, v = pcall(fn)
  if ok then return v end
  return nil
end

local function translated(name, english)
  if not name or not safe(function() return name.has_name end) then return nil end
  local s = safe(function() return dfhack.translation.translateName(name, english) end)
  if s and s ~= '' then return s end
  return nil
end

local function creature_token(race)
  if not race or race < 0 then return nil end
  return safe(function() return tostring(df.global.world.raws.creatures.all[race].creature_id) end)
end

local function caste_token(race, caste)
  if not race or race < 0 or not caste or caste < 0 then return nil end
  return safe(function() return tostring(df.global.world.raws.creatures.all[race].caste[caste].caste_id) end)
end

local function figure_ref(id)
  if not id or id < 0 then return nil end
  local other = df.historical_figure.find(id)
  if not other then return { hf_id = id } end
  return { hf_id = id, name = translated(other.name, true), race = creature_token(other.race) }
end

local function site_english(id)
  if not id or id < 0 then return nil end
  local site = df.world_site.find(id)
  return site and translated(site.name, true) or nil
end

local function sex_word(sex)
  if sex == 0 then return 'female' elseif sex == 1 then return 'male' end
  return nil
end

local function take(list, cap)
  if #list <= cap then return list, nil, nil end
  local out = {}
  for i = 1, cap do out[i] = list[i] end
  return out, true, #list
end

local function emit_list(out, key, list)
  local kept, truncated, total = take(list, CAPS[key])
  out[key] = kept
  out[key .. '_truncated'] = truncated
  out[key .. '_total'] = total
end

local function position_name(entity, assignment_id, sex)
  local assignment
  for _, a in ipairs(entity.positions.assignments) do
    if a.id == assignment_id then assignment = a; break end
  end
  if not assignment then return nil end
  for _, p in ipairs(entity.positions.own) do
    if p.id == assignment.position_id then
      local gendered = (sex == 0 and p.name_female[0]) or (sex == 1 and p.name_male[0]) or ''
      if gendered ~= '' then return gendered end
      return p.name[0] ~= '' and p.name[0] or p.code
    end
  end
  return nil
end

local function read_entities()
  local by_id, order = {}, {}
  for _, link in ipairs(hf.entity_links) do
    local id = link.entity_id
    local row = by_id[id]
    if not row then
      local entity = df.historical_entity.find(id)
      row = {
        entity_id = id,
        name = entity and translated(entity.name, false) or nil,
        name_english = entity and translated(entity.name, true) or nil,
        type = entity and tostring(df.historical_entity_type[entity.type]) or nil,
        _entity = entity,
        _links = {},
        positions = {},
      }
      by_id[id] = row
      order[#order + 1] = row
    end
    local link_type = tostring(df.histfig_entity_link_type[link:getType()])
    row._links[link_type] = true
    if (link_type == 'POSITION' or link_type == 'FORMER_POSITION') and row._entity then
      row.positions[#row.positions + 1] = {
        position = safe(function() return position_name(row._entity, link.assignment_id, hf.sex) end),
        current = link_type == 'POSITION',
        start_year = safe(function() return link.start_year end),
        end_year = safe(function() return link.end_year end),
      }
    end
  end
  table.sort(order, function(a, b) return a.entity_id < b.entity_id end)
  for _, row in ipairs(order) do
    row.links = {}
    for t in pairs(row._links) do row.links[#row.links + 1] = t end
    table.sort(row.links)
    table.sort(row.positions, function(a, b)
      if a.current ~= b.current then return a.current end
      local ay, by = a.start_year or -1, b.start_year or -1
      if ay ~= by then return ay > by end
      return (a.position or '') < (b.position or '')
    end)
    emit_list(row, 'positions', row.positions)
    row._entity, row._links = nil, nil
  end
  return order
end

local function read_hf_links()
  local relationships, worship, seen = {}, {}, {}
  for _, link in ipairs(hf.histfig_links) do
    local link_type = tostring(df.histfig_hf_link_type[link:getType()])
    local key = link_type .. ':' .. link.target_hf
    if not seen[key] then
      seen[key] = true
      local ref = figure_ref(link.target_hf) or { hf_id = link.target_hf }
      if link_type == 'DEITY' then
        worship[#worship + 1] = { hf_id = ref.hf_id, name = ref.name, strength = link.link_strength }
      else
        relationships[#relationships + 1] = { type = link_type, hf_id = ref.hf_id, name = ref.name, race = ref.race }
      end
    end
  end
  table.sort(relationships, function(a, b)
    if a.type ~= b.type then return a.type < b.type end
    return a.hf_id < b.hf_id
  end)
  table.sort(worship, function(a, b)
    if a.strength ~= b.strength then return a.strength > b.strength end
    return a.hf_id < b.hf_id
  end)
  return relationships, worship
end

local function read_sites()
  local sites, seen = {}, {}
  for _, link in ipairs(hf.site_links) do
    local link_type = tostring(df.histfig_site_link_type[link:getType()])
    local key = link_type .. ':' .. link.site
    if not seen[key] then
      seen[key] = true
      local site = df.world_site.find(link.site)
      sites[#sites + 1] = {
        site_id = link.site,
        name = site and translated(site.name, false) or nil,
        name_english = site and translated(site.name, true) or nil,
        type = site and tostring(df.world_site_type[site.type]) or nil,
        link = link_type,
      }
    end
  end
  table.sort(sites, function(a, b)
    if a.site_id ~= b.site_id then return a.site_id < b.site_id end
    return a.link < b.link
  end)
  return sites
end

local function read_unnamed_kills()
  local kills = safe(function() return hf.info.kills end)
  if not kills then return {} end
  local by_race = {}
  for i = 0, #kills.killed_race - 1 do
    local race = creature_token(kills.killed_race[i]) or tostring(kills.killed_race[i])
    by_race[race] = (by_race[race] or 0) + kills.killed_count[i]
  end
  local out = {}
  for race, count in pairs(by_race) do out[#out + 1] = { race = race, count = count } end
  table.sort(out, function(a, b)
    if a.count ~= b.count then return a.count > b.count end
    return a.race < b.race
  end)
  return out
end

local function death_cause(event)
  return safe(function() return tostring(df.death_type[event.death_cause]) end)
end

local function read_events()
  local death_event, kills, events = nil, {}, {}
  local DIED = df.history_event_type.HIST_FIGURE_DIED
  local all = df.global.world.history.events
  for i = 0, #all - 1 do
    local e = all[i]
    if safe(function() return e:isRelatedToHistfigID(HF_ID) end) then
      local event_type = e:getType()
      local site_id = safe(function() return e.site end)
      if site_id and site_id < 0 then site_id = nil end
      events[#events + 1] = {
        event_id = e.id,
        year = e.year,
        type = tostring(df.history_event_type[event_type]),
        site_id = site_id,
      }
      if event_type == DIED then
        if e.victim_hf == HF_ID then death_event = e end
        if e.slayer_hf == HF_ID and e.victim_hf ~= HF_ID then
          local victim = figure_ref(e.victim_hf) or {}
          kills[#kills + 1] = {
            event_id = e.id,
            hf_id = victim.hf_id,
            name = victim.name,
            race = victim.race,
            year = e.year,
            cause = death_cause(e),
            site_id = site_id,
            site = site_english(site_id),
          }
        end
      end
    end
  end
  local function recent_first(a, b)
    if a.year ~= b.year then return a.year > b.year end
    return a.event_id > b.event_id
  end
  table.sort(kills, recent_first)
  table.sort(events, recent_first)
  return death_event, kills, events
end

local function read_death(event)
  if hf.died_year < 0 then return nil end
  local death = { year = hf.died_year }
  if not event then return death end
  death.event_id = event.id
  death.cause = death_cause(event)
  local site_id = safe(function() return event.site end)
  if site_id and site_id >= 0 then
    death.site_id = site_id
    death.site = site_english(site_id)
  end
  if event.slayer_hf >= 0 then
    death.slayer = figure_ref(event.slayer_hf)
  elseif event.slayer_race >= 0 then
    death.slayer = {
      race = creature_token(event.slayer_race),
      caste = caste_token(event.slayer_race, event.slayer_caste),
    }
  end
  return death
end

local function visible_unit_id()
  local u = hf.unit_id >= 0 and df.unit.find(hf.unit_id) or nil
  if u and not visibility.is_hidden(u) then return u.id end
  return nil
end

local function spheres()
  local list = safe(function() return hf.info.metaphysical.spheres end)
  if not list then return nil end
  local out = {}
  for _, s in ipairs(list) do out[#out + 1] = tostring(df.sphere_type[s]) end
  table.sort(out)
  return out
end

local is_deity = hf.flags.deity
local is_force = hf.flags.force
local death_event, kills, events = read_events()
local relationships, worship = read_hf_links()

local out = {
  hf_id = hf.id,
  name = translated(hf.name, false),
  name_english = translated(hf.name, true),
  race = creature_token(hf.race),
  caste = caste_token(hf.race, hf.caste),
  sex = sex_word(hf.sex),
  profession = hf.profession >= 0 and tostring(df.profession[hf.profession]) or nil,
  deity = is_deity or nil,
  force = is_force or nil,
  ghost = hf.flags.ghost or nil,
  spheres = spheres(),
  alive = hf.died_year < 0,
  birth = (not is_deity and not is_force) and { year = hf.born_year } or nil,
  death = read_death(death_event),
  unit_id = visible_unit_id(),
}
emit_list(out, 'entities', read_entities())
emit_list(out, 'relationships', relationships)
emit_list(out, 'worship', worship)
emit_list(out, 'sites', read_sites())
emit_list(out, 'kills', kills)
emit_list(out, 'unnamed_kills', read_unnamed_kills())
emit_list(out, 'events', events)

emit(out)

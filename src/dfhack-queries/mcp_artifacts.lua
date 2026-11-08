local args = {...}

local json = require('json')
local emit = reqscript('mcp_jsonOut').emit

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local DEFAULT_LIMIT = 25
local MAX_LIMIT = 100
local DECORATION_CAP = 16
local ENGRAVING_SCAN_CAP = 20000
local SUBJECT_CAP = 40
local ENGRAVER_CAP = 10

local function sget(obj, field)
  local ok, v = pcall(function() return obj[field] end)
  if ok then return v end
  return nil
end

local function clean(s)
  if not s then return nil end
  s = tostring(s):gsub('[%z\1-\31]', '')
  s = s:gsub('^%s*(.-)%s*$', '%1')
  return (s ~= '') and s or nil
end

local function tname(name, english)
  local ok, v = pcall(dfhack.translation.translateName, name, english)
  if ok and v and v ~= '' then return clean(v) end
  return nil
end

local function quality_label(q)
  if not q then return nil end
  local ok, v = pcall(function() return df.item_quality[q] end)
  return (ok and v) and tostring(v) or nil
end

local function mat_of(mat_type, mat_index)
  local ok, mi = pcall(dfhack.matinfo.decode, mat_type, mat_index)
  if ok and mi then
    return { token = tostring(mi:getToken()), name = clean(tostring(mi.material.state_name.Solid)) }
  end
  return nil
end

local function item_mat(it)
  local ok, mi = pcall(dfhack.matinfo.decode, it)
  if ok and mi then
    return { token = tostring(mi:getToken()), name = clean(tostring(mi.material.state_name.Solid)) }
  end
  return nil
end

local citizen_by_hf = {}
do
  local ok, cits = pcall(dfhack.units.getCitizens, true)
  if ok and cits then
    for _, u in ipairs(cits) do
      local alive = true
      local oka, a = pcall(dfhack.units.isAlive, u)
      if oka then alive = a end
      if alive and u.hist_figure_id and u.hist_figure_id >= 0 then
        citizen_by_hf[u.hist_figure_id] = u.id
      end
    end
  end
end

local function maker_fact(hf_id)
  if not hf_id or hf_id < 0 then return nil end
  local hf = df.historical_figure.find(hf_id)
  local out = { histfig_id = hf_id }
  if hf then out.name = tname(hf.name, true) end
  out.unit_id = citizen_by_hf[hf_id]
  return out
end

local function decorations(it)
  local out, total = {}, 0
  local ok, imps = pcall(function() return it.improvements end)
  if not ok or not imps then return out, 0 end
  for j = 0, #imps - 1 do
    total = total + 1
    if #out < DECORATION_CAP then
      local im = imps[j]
      local ty = sget(im, 'getType') and im:getType() or nil
      local entry = {
        type = ty and tostring(df.improvement_type[ty]) or 'unknown',
        material = mat_of(sget(im, 'mat_type'), sget(im, 'mat_index')),
        quality = quality_label(sget(im, 'quality')),
      }
      if entry.type == 'ART_IMAGE' then
        entry.image_resolved = false
      end
      out[#out + 1] = entry
    end
  end
  return out, total
end

local function artifact_record(ar)
  local it = ar.item
  local rec = {
    id = ar.id,
    name = { dwarven = tname(ar.name, false), english = tname(ar.name, true) },
  }
  if it then
    local ty = sget(it, 'getType') and it:getType() or nil
    rec.item_type = ty and tostring(df.item_type[ty]) or nil
    rec.item_label = clean(sget(it, 'getType') and dfhack.items.getDescription(it, 0, false) or nil)
    rec.material = item_mat(it)
    local okv, v = pcall(dfhack.items.getValue, it)
    rec.value = okv and v or nil
    rec.quality = quality_label(sget(it, 'quality'))
    rec.maker = maker_fact(sget(it, 'maker'))
    local decs, dtotal = decorations(it)
    rec.decorations = decs
    if dtotal > #decs then
      rec.decorations_truncated = true
      rec.decorations_total = dtotal
    end
    rec.inscription = clean(sget(it, 'description'))
  end
  return rec
end

local fort_site_id = df.global.plotinfo.site_id

local function in_scope(ar, scope)
  if scope == 'world' then return true end
  return sget(ar, 'site') == fort_site_id
end

local function build_artifacts(cursor, limit, scope)
  local all = df.global.world.artifacts.all
  local world_total = #all
  local indices = {}
  for i = 0, world_total - 1 do
    if in_scope(all[i], scope) then indices[#indices + 1] = i end
  end
  local total = #indices
  local list = {}
  local n = cursor
  while n < total and #list < limit do
    local ar = all[indices[n + 1]]
    local ok, rec = pcall(artifact_record, ar)
    if not ok then
      rec = { id = (ar and ar.id) or nil, error = 'unreadable artifact record' }
    end
    if scope == 'world' then rec.site_local = sget(ar, 'site') == fort_site_id end
    list[#list + 1] = rec
    n = n + 1
  end
  local next_cursor
  if n < total then next_cursor = tostring(n) end
  return list, total, world_total, next_cursor
end

local function chunk_index()
  local idx = {}
  pcall(function()
    local chunks = df.global.world.art_image_chunks.all
    for i = 0, #chunks - 1 do idx[chunks[i].id] = chunks[i] end
  end)
  return idx
end

local SHEET_FIELDS = {
  'open', 'active_sheet', 'active_id', 'viewing_x', 'viewing_y', 'viewing_z',
  'engraving_title', 'raw_description',
}

local function load_chunks_via_engraving_sheet(pos_by_chunk)
  local scr = dfhack.gui.getDFViewscreen(true)
  if not df.viewscreen_dwarfmodest:is_instance(scr) then return end
  local vs = df.global.game.main_interface.view_sheets
  if vs.open then return end
  local saved = {}
  for _, f in ipairs(SHEET_FIELDS) do saved[f] = vs[f] end
  local paused = df.global.pause_state
  df.global.pause_state = true
  for _, pos in pairs(pos_by_chunk) do
    vs.open = true
    vs.active_sheet = df.view_sheet_type.ENGRAVING
    vs.viewing_x, vs.viewing_y, vs.viewing_z = pos.x, pos.y, pos.z
    pcall(scr.logic, scr)
  end
  for _, f in ipairs(SHEET_FIELDS) do vs[f] = saved[f] end
  df.global.pause_state = paused
end

local function ensure_chunks(engs, scanned)
  local idx = chunk_index()
  local missing, any = {}, false
  for i = 0, scanned - 1 do
    local g = engs[i]
    local art_id = sget(g, 'art_id')
    if art_id and art_id >= 0 and not idx[art_id] and not missing[art_id] then
      missing[art_id] = g.pos
      any = true
    end
  end
  if any then
    pcall(load_chunks_via_engraving_sheet, missing)
    idx = chunk_index()
  end
  return idx
end

local function find_image(idx, art_id, art_subid)
  local chunk = idx[art_id]
  if not chunk or not art_subid or art_subid < 0 then return nil end
  local ok, img = pcall(function() return chunk.images[art_subid].art_image end)
  return ok and img or nil
end

local function df_text(fn)
  local s = df.new('string')
  local ok = pcall(fn, s)
  local v = ok and clean(s.value) or nil
  df.delete(s)
  return v
end

local function enum_label(enum, v)
  local ok, label = pcall(function() return enum[v] end)
  return (ok and label) and tostring(label) or nil
end

local function element_fact(el)
  local ty = enum_label(df.art_image_element_type, el:getType())
  local f = {
    type = ty or 'unknown',
    name = df_text(function(s) el:getName(s, false, true, false) end),
  }
  local count = sget(el, 'count')
  if count and count > 0 then f.count = count end
  if ty == 'CREATURE' then
    local cr = df.creature_raw.find(el.race)
    f.race = cr and cr.creature_id or nil
    if el.histfig >= 0 then
      f.histfig_id = el.histfig
      f.unit_id = citizen_by_hf[el.histfig]
    end
  elseif ty == 'PLANT' or ty == 'TREE' then
    local ok, pl = pcall(function() return df.global.world.raws.plants.all[el.plant_id] end)
    f.plant = (ok and pl) and pl.id or nil
  elseif ty == 'SHAPE' then
    local ok, sh = pcall(function() return df.global.world.raws.descriptors.shapes[el.shape_id] end)
    f.shape = (ok and sh) and sh.id or nil
  elseif ty == 'ITEM' then
    f.item_type = enum_label(df.item_type, el.item_type)
    if el.mat_type >= 0 then f.material = mat_of(el.mat_type, el.mat_index) end
  end
  return f
end

local function property_fact(img, p)
  local ty = enum_label(df.art_image_property_type, p:getType())
  local f = {
    type = ty or 'unknown',
    verb = enum_label(df.art_image_property_verb, sget(p, 'verb')),
    subject = sget(p, 'subject'),
    object = sget(p, 'object'),
    text = df_text(function(s) p:getName(s, img, true, false) end),
  }
  return f
end

local function event_fact(event_id)
  if not event_id or event_id < 0 then return nil end
  local ev = df.history_event.find(event_id)
  if not ev then return { id = event_id } end
  return {
    id = event_id,
    type = enum_label(df.history_event_type, ev:getType()),
    year = sget(ev, 'year'),
  }
end

local function image_fact(img)
  local elements, properties = {}, {}
  for _, el in ipairs(img.elements) do
    local ok, f = pcall(element_fact, el)
    elements[#elements + 1] = ok and f or { type = 'unknown' }
  end
  for _, p in ipairs(img.properties) do
    local ok, f = pcall(property_fact, img, p)
    properties[#properties + 1] = ok and f or { type = 'unknown' }
  end
  return {
    elements = elements,
    properties = properties,
    event = event_fact(sget(img, 'event')),
    year = sget(img, 'year'),
  }
end

local function build_engravings()
  local engs = df.global.world.event.engravings
  local total = #engs
  local scanned = math.min(total, ENGRAVING_SCAN_CAP)
  local idx = ensure_chunks(engs, scanned)

  local buckets = {}
  local order = {}
  local quality = {}
  local artists = {}

  for i = 0, scanned - 1 do
    local g = engs[i]
    local art_id = sget(g, 'art_id') or 0
    local art_subid = sget(g, 'art_subid') or 0
    local ref = art_id .. ':' .. art_subid
    local b = buckets[ref]
    if not b then
      b = { ref = ref, art_id = art_id, art_subid = art_subid, count = 0 }
      buckets[ref] = b
      order[#order + 1] = ref
    end
    b.count = b.count + 1

    local ql = quality_label(sget(g, 'quality')) or 'unknown'
    quality[ql] = (quality[ql] or 0) + 1

    local ar = sget(g, 'artist')
    if ar and ar >= 0 then artists[ar] = (artists[ar] or 0) + 1 end
  end

  local list = {}
  local any_resolved = false
  for _, k in ipairs(order) do
    local b = buckets[k]
    b.img = find_image(idx, b.art_id, b.art_subid)
    if b.img then any_resolved = true end
    list[#list + 1] = b
  end
  table.sort(list, function(a, b)
    if a.count ~= b.count then return a.count > b.count end
    return a.ref < b.ref
  end)
  local distinct = #list
  local by_subject = {}
  for i = 1, math.min(distinct, SUBJECT_CAP) do
    local b = list[i]
    local entry = { ref = b.ref, count = b.count, subject_resolved = b.img ~= nil }
    if b.img then
      entry.subject = tname(b.img.name, true) or tname(b.img.name, false)
      entry.image = image_fact(b.img)
    end
    entry.subject = entry.subject or ('image #' .. b.ref)
    by_subject[#by_subject + 1] = entry
  end

  local eng_list = {}
  for hf, n in pairs(artists) do eng_list[#eng_list + 1] = { histfig_id = hf, count = n } end
  table.sort(eng_list, function(a, b) return a.count > b.count end)
  local top_engravers = {}
  for i = 1, math.min(#eng_list, ENGRAVER_CAP) do
    local e = eng_list[i]
    local hf = df.historical_figure.find(e.histfig_id)
    top_engravers[#top_engravers + 1] = {
      name = hf and tname(hf.name, true) or nil,
      histfig_id = e.histfig_id,
      unit_id = citizen_by_hf[e.histfig_id],
      count = e.count,
    }
  end

  return {
    total_present = total,
    scanned = scanned,
    scan_truncated = total > scanned,
    distinct_subjects = distinct,
    art_images_loaded = next(idx) ~= nil,
    subjects_resolvable = any_resolved,
    quality = quality,
    by_subject = by_subject,
    by_subject_truncated = distinct > #by_subject,
    top_engravers = top_engravers,
  }
end

local limit = tonumber(args[1] or '')
if not limit or limit < 1 then limit = DEFAULT_LIMIT end
if limit > MAX_LIMIT then limit = MAX_LIMIT end
limit = math.floor(limit)

local cursor = tonumber(args[2] or '')
if not cursor or cursor < 0 then cursor = 0 end
cursor = math.floor(cursor)

local scope = (args[3] == 'world') and 'world' or 'site'

local artifacts, total, world_total, next_cursor = build_artifacts(cursor, limit, scope)

emit({
  scope = scope,
  artifacts = artifacts,
  artifact_count = total,
  artifact_count_world = world_total,
  returned = #artifacts,
  cursor = cursor,
  next_cursor = next_cursor,
  engravings = build_engravings(),
  caps = {
    default_limit = DEFAULT_LIMIT,
    max_limit = MAX_LIMIT,
    decorations_per_artifact = DECORATION_CAP,
    engravings_scanned_max = ENGRAVING_SCAN_CAP,
    subject_buckets_max = SUBJECT_CAP,
    top_engravers_max = ENGRAVER_CAP,
  },
})

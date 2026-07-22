local args = {...}

local json = require('json')
local function emit(t) print(json.encode(t)) end

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

local function build_artifacts(cursor, limit)
  local all = df.global.world.artifacts.all
  local total = #all
  local list = {}
  local i = cursor
  while i < total and #list < limit do
    local ok, rec = pcall(artifact_record, all[i])
    if ok then
      list[#list + 1] = rec
    else
      list[#list + 1] = { id = (all[i] and all[i].id) or nil, error = 'unreadable artifact record' }
    end
    i = i + 1
  end
  local next_cursor
  if i < total then next_cursor = tostring(i) end
  return list, total, next_cursor
end

local function resolve_subject(art_id, art_subid)
  local ok, subj = pcall(function()
    local chunks = df.global.world.art_image_chunks.all
    for i = 0, #chunks - 1 do
      if chunks[i].id == art_id then
        local imgs = chunks[i].images
        if art_subid >= 0 and art_subid < #imgs then
          local nm = tname(imgs[art_subid].name, true)
          if nm then return nm end
        end
        return nil
      end
    end
    return nil
  end)
  return ok and subj or nil
end

local function build_engravings()
  local engs = df.global.world.event.engravings
  local total = #engs
  local scanned = math.min(total, ENGRAVING_SCAN_CAP)

  local buckets = {}
  local order = {}
  local quality = {}
  local artists = {}
  local any_resolved = false

  for i = 0, scanned - 1 do
    local g = engs[i]
    local art_id = sget(g, 'art_id') or 0
    local art_subid = sget(g, 'art_subid') or 0
    local subject = resolve_subject(art_id, art_subid)
    local resolved = subject ~= nil
    if resolved then any_resolved = true end
    local key = resolved and ('S:' .. subject) or ('R:' .. art_id .. ':' .. art_subid)
    local b = buckets[key]
    if not b then
      b = {
        subject = subject or ('image #' .. art_id .. ':' .. art_subid),
        subject_resolved = resolved,
        ref = art_id .. ':' .. art_subid,
        count = 0,
      }
      buckets[key] = b
      order[#order + 1] = key
    end
    b.count = b.count + 1

    local ql = quality_label(sget(g, 'quality')) or 'unknown'
    quality[ql] = (quality[ql] or 0) + 1

    local ar = sget(g, 'artist')
    if ar and ar >= 0 then artists[ar] = (artists[ar] or 0) + 1 end
  end

  local list = {}
  for _, k in ipairs(order) do list[#list + 1] = buckets[k] end
  table.sort(list, function(a, b)
    if a.count ~= b.count then return a.count > b.count end
    return a.ref < b.ref
  end)
  local distinct = #list
  local by_subject = {}
  for i = 1, math.min(distinct, SUBJECT_CAP) do by_subject[#by_subject + 1] = list[i] end

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

local artifacts, total, next_cursor = build_artifacts(cursor, limit)

emit({
  artifacts = artifacts,
  artifact_count = total,
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

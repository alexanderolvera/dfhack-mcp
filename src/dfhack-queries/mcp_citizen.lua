local args = {...}
local query = args[1] or ''

local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

if not string.match(query, '^%d+$') then
  emit({ error = 'citizen expects a numeric unit_id (all digits); got "' .. tostring(query) .. '"' })
  return
end

local u = df.unit.find(tonumber(query))
if not u then
  emit({ error = 'no unit with id ' .. query .. ' (use find_unit to get a valid unit_id)' })
  return
end

local STRESS = {[0]='miserable',[1]='unhappy',[2]='unhappy',[3]='content',[4]='content',[5]='happy',[6]='ecstatic'}
local FRIEND_CAP = 8
local GRUDGE_CAP = 8
local SKILL_CAP = 10
local PREF_CAP = 12
local THOUGHT_CAP = 10

local function safe(fn, default)
  local ok, v = pcall(fn)
  if ok and v ~= nil then return v end
  return default
end

local function humanize(tok)
  return (tostring(tok):gsub('_', ' '):lower())
end

local function hf_name(hfid)
  if not hfid or hfid < 0 then return nil end
  local hf = df.historical_figure.find(hfid)
  if not hf then return nil end
  return safe(function() return dfhack.translation.translateName(hf.name, true) end, nil)
end

local function hf_unit_id(hfid)
  if not hfid or hfid < 0 then return nil end
  local hf = df.historical_figure.find(hfid)
  if not hf then return nil end
  local uid = safe(function() return hf.unit_id end, -1)
  if uid and uid >= 0 then return uid end
  return nil
end

local soul = u.status.current_soul

local name = safe(function() return dfhack.units.getReadableName(u) end, 'unit ' .. query)
local profession = safe(function() return dfhack.units.getProfessionName(u) end, '')
local age = safe(function() return math.floor(dfhack.units.getAge(u, true)) end, nil)
local sc = safe(function() return dfhack.units.getStressCategory(u) end, nil)
local is_child = safe(function() return dfhack.units.isChild(u) end, false)

local out = {
  unit_id = u.id,
  name = name,
  profession = (profession ~= '' and profession) or nil,
  sex = safe(function() return (u.sex == 1 and 'male') or (u.sex == 0 and 'female') or nil end, nil),
  age = age,
  is_child = is_child or nil,
}

out.stress = {
  level = sc and (STRESS[sc] or tostring(sc)) or 'unknown',
  value = safe(function() return soul.personality.stress end, nil),
  longterm = safe(function() return soul.personality.longterm_stress end, nil),
}

local function facet_level(v)
  if v <= 9 then return 'very low'
  elseif v <= 24 then return 'low'
  elseif v >= 90 then return 'very high'
  elseif v >= 76 then return 'high'
  else return 'moderate' end
end
local extremes = {}
safe(function()
  local traits = soul.personality.traits
  for i = 0, #traits - 1 do
    local v = traits[i]
    if v <= 24 or v >= 76 then
      extremes[#extremes+1] = {
        facet = humanize(df.personality_facet_type[i]),
        value = v,
        level = facet_level(v),
      }
    end
  end
end)
table.sort(extremes, function(a, b)
  return math.abs(a.value - 50) > math.abs(b.value - 50)
end)
out.personality = { extremes = extremes }

local rel = { children = {}, parents = {}, friends = {}, grudges = {} }
local family_hf = {}

local spouse_uid = safe(function() return u.relationship_ids.Spouse end, -1)
if spouse_uid and spouse_uid >= 0 then
  local su = df.unit.find(spouse_uid)
  rel.spouse = {
    name = su and safe(function() return dfhack.units.getReadableName(su) end, 'unit ' .. spouse_uid) or ('unit ' .. spouse_uid),
    unit_id = spouse_uid,
  }
  local shf = su and safe(function() return su.hist_figure_id end, -1)
  if shf and shf >= 0 then family_hf[shf] = true end
end

local worship = {}
safe(function()
  local hf = df.historical_figure.find(u.hist_figure_id)
  if not hf then return end
  for _, l in ipairs(hf.histfig_links) do
    local kind = tostring(l._type):match('histfig_hf_link_(%a+)st')
    local tgt = safe(function() return l.target_hf end, -1)
    if kind == 'spouse' and not rel.spouse then
      family_hf[tgt] = true
      rel.spouse = { name = hf_name(tgt) or ('hf ' .. tgt), unit_id = hf_unit_id(tgt) }
    elseif kind == 'child' then
      family_hf[tgt] = true
      rel.children[#rel.children+1] = { name = hf_name(tgt) or ('hf ' .. tgt), unit_id = hf_unit_id(tgt) }
    elseif kind == 'mother' or kind == 'father' then
      family_hf[tgt] = true
      rel.parents[#rel.parents+1] = { relation = kind, name = hf_name(tgt) or ('hf ' .. tgt), unit_id = hf_unit_id(tgt) }
    elseif kind == 'deity' then
      worship[#worship+1] = {
        deity = hf_name(tgt) or ('hf ' .. tgt),
        strength = safe(function() return l.link_strength end, nil),
      }
    end
  end
end)
table.sort(worship, function(a, b) return (a.strength or 0) > (b.strength or 0) end)
out.worship = worship

local friends_all, grudges_all = {}, {}
safe(function()
  local hf = df.historical_figure.find(u.hist_figure_id)
  if not hf or not hf.info or not hf.info.relationships then return end
  for _, e in ipairs(hf.info.relationships.hf_visual) do
    local tgt = safe(function() return e.histfig_id end, -1)
    if tgt and tgt >= 0 and not family_hf[tgt] then
      local c = e.core
      local love = safe(function() return c.love end, 0)
      local trust = safe(function() return c.trust end, 0)
      local respect = safe(function() return c.respect end, 0)
      local loyalty = safe(function() return c.loyalty end, 0)
      local fear = safe(function() return c.fear end, 0)
      local meet = safe(function() return e.meet_count end, nil)
      local neg_dims = {}
      if love < 0 then neg_dims[#neg_dims+1] = 'love' end
      if trust < 0 then neg_dims[#neg_dims+1] = 'trust' end
      if respect < 0 then neg_dims[#neg_dims+1] = 'respect' end
      if loyalty < 0 then neg_dims[#neg_dims+1] = 'loyalty' end
      local is_grudge = (love < 0) or (#neg_dims > 0 and love <= 0)
      if is_grudge then
        grudges_all[#grudges_all+1] = {
          name = hf_name(tgt) or ('hf ' .. tgt), unit_id = hf_unit_id(tgt),
          love = love, trust = trust, respect = respect, loyalty = loyalty, fear = fear,
          negative_dims = neg_dims, meet_count = meet,
        }
      elseif love > 0 or respect > 0 then
        friends_all[#friends_all+1] = {
          name = hf_name(tgt) or ('hf ' .. tgt), unit_id = hf_unit_id(tgt),
          affection = love, respect = respect, meet_count = meet,
        }
      end
    end
  end
end)
table.sort(friends_all, function(a, b) return a.affection > b.affection end)
table.sort(grudges_all, function(a, b) return a.trust < b.trust end)
for i = 1, math.min(#friends_all, FRIEND_CAP) do rel.friends[i] = friends_all[i] end
for i = 1, math.min(#grudges_all, GRUDGE_CAP) do rel.grudges[i] = grudges_all[i] end
rel.friends_total = #friends_all
rel.grudges_total = #grudges_all
out.relationships = rel

local skills = {}
safe(function()
  local tmp = {}
  for _, s in ipairs(soul.skills) do
    local rating = safe(function() return s.rating end, 0)
    if rating and rating >= 1 then
      tmp[#tmp+1] = {
        skill = humanize(df.job_skill[s.id]),
        level = safe(function() return tostring(df.skill_rating[rating]) end, tostring(rating)),
        rating = rating,
        rusty = (safe(function() return s.rusty end, 0) or 0) > 0 or nil,
      }
    end
  end
  table.sort(tmp, function(a, b) return a.rating > b.rating end)
  for i = 1, math.min(#tmp, SKILL_CAP) do skills[i] = tmp[i] end
end)
out.skills = skills

local PT = df.unitpref_type
local function pref_target(pr)
  local ty = pr.type
  if ty == PT.LikeMaterial or ty == PT.LikeFood then
    return safe(function() local mi = dfhack.matinfo.decode(pr.mattype, pr.matindex); return mi and mi:toString() end, nil)
  elseif ty == PT.LikeCreature or ty == PT.HateCreature then
    return safe(function() return tostring(df.global.world.raws.creatures.all[pr.creature_id].name[0]) end, nil)
  elseif ty == PT.LikePlant or ty == PT.LikeTree then
    return safe(function() return tostring(df.global.world.raws.plants.all[pr.plant_id].name) end, nil)
  elseif ty == PT.LikeColor then
    return safe(function() return tostring(df.global.world.raws.descriptors.colors[pr.color_id].name) end, nil)
  elseif ty == PT.LikeShape then
    return safe(function() return tostring(df.global.world.raws.descriptors.shapes[pr.shape_id].name) end, nil)
  elseif ty == PT.LikeItem then
    return safe(function()
      local t = humanize(df.item_type[pr.item_type])
      return t
    end, nil)
  elseif ty == PT.LikePoeticForm then
    return safe(function() return dfhack.translation.translateName(df.poetic_form.find(pr.poetic_form_id).name, true) end, 'a poetic form')
  elseif ty == PT.LikeMusicalForm then
    return safe(function() return dfhack.translation.translateName(df.musical_form.find(pr.musical_form_id).name, true) end, 'a musical form')
  elseif ty == PT.LikeDanceForm then
    return safe(function() return dfhack.translation.translateName(df.dance_form.find(pr.dance_form_id).name, true) end, 'a dance form')
  end
  return nil
end
local likes, detests = {}, {}
safe(function()
  for _, pr in ipairs(soul.preferences) do
    local t = pref_target(pr)
    if t then
      if pr.type == PT.HateCreature then
        if #detests < PREF_CAP then detests[#detests+1] = t end
      else
        if #likes < PREF_CAP then likes[#likes+1] = t end
      end
    end
  end
end)
out.preferences = { likes = likes, detests = detests }

local physical = {}
physical.body_size_cm3 = safe(function() return u.body.size_info.size_cur end, nil)
local sizemod = safe(function() return u.appearance.size_modifier end, nil)
if sizemod then
  physical.size_modifier = sizemod
  if sizemod >= 110 then physical.build = 'larger than average'
  elseif sizemod <= 90 then physical.build = 'smaller than average'
  else physical.build = 'average build' end
end
out.physical = physical

local thoughts = {}
safe(function()
  local em = soul.personality.emotions
  local real = {}
  for _, e in ipairs(em) do
    local th = safe(function() return e.thought end, -1)
    if th and th >= 0 then real[#real+1] = e end
  end
  local startv = math.max(1, #real - THOUGHT_CAP + 1)
  for i = #real, startv, -1 do
    local e = real[i]
    local th = e.thought
    local caption = safe(function() return tostring(df.unit_thought_type.attrs[th].caption) end, humanize(df.unit_thought_type[th]))
    local etype = safe(function() return e.type end, -1)
    thoughts[#thoughts+1] = {
      emotion = (etype and etype >= 0) and humanize(df.emotion_type[etype]) or nil,
      about = caption,
      severity = safe(function() return e.severity end, nil),
      year = safe(function() return e.year end, nil),
    }
  end
end)
out.thoughts = thoughts

emit(out)

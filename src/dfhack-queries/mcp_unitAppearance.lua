local args = {...}
local query = args[1] or ''

local emit = reqscript('mcp_jsonOut').emit

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

if not string.match(query, '^%d+$') then
  emit({ error = 'unit_appearance expects a numeric unit_id (all digits); got "' .. tostring(query) .. '"' })
  return
end

local visibility = reqscript('mcp_unitVisibility')

local u = df.unit.find(tonumber(query))
if not u or visibility.is_hidden(u) then
  emit({ error = 'no visible unit with id ' .. query .. ' (use find_unit to get a valid unit_id)' })
  return
end

local FEATURE_CAP = 80
local PART_CAP = 6
local MARK_CAP = 20
local INVENTORY_CAP = 30
local DAYS_PER_YEAR = 336
local STRUCTURAL_IMPROVEMENTS = { THREAD = true, CLOTH = true }

local descriptors = df.global.world.raws.descriptors
local caste = df.creature_raw.find(u.race).caste[u.caste]
local body_parts = caste.body_info.body_parts

local function safe(fn, default)
  local ok, v = pcall(fn)
  if ok and v ~= nil then return v end
  return default
end

local function part_name(idx)
  local bp = body_parts[idx]
  if not bp then return nil end
  return safe(function() return bp.name_singular[0].value end, bp.token)
end

local function layer_name(part_idx, layer_idx)
  if layer_idx < 0 then return nil end
  return safe(function() return body_parts[part_idx].layers[layer_idx].layer_name end, nil)
end

local function capped(list, cap)
  if #list <= cap then return list, nil end
  local out = {}
  for i = 1, cap do out[i] = list[i] end
  return out, true
end

local function sorted_keys(set)
  local out = {}
  for k in pairs(set) do out[#out + 1] = k end
  table.sort(out)
  return out
end

local function desc_band(value, desc_range)
  local reached = 0
  for i = 0, 5 do
    if value >= desc_range[i] then reached = reached + 1 end
  end
  return reached - 3
end

local function color_name(idx)
  return safe(function() return descriptors.colors[idx].name end, nil)
end

local appearance = u.appearance

local function add_feature(groups, order, row, part)
  local key = table.concat({ row.feature, row.layer or '', row.modifier, tostring(row.value) }, '|')
  local g = groups[key]
  if not g then
    g = row
    g.part_set = {}
    groups[key] = g
    order[#order + 1] = key
  end
  if part then g.part_set[part] = true end
end

local function read_features()
  local groups, order = {}, {}
  for i = 0, #appearance.body_modifiers - 1 do
    local m = caste.body_appearance_modifiers[i].modifier
    add_feature(groups, order, {
      feature = 'body',
      modifier = df.appearance_modifier_type[m.type],
      value = appearance.body_modifiers[i],
      desc_band = desc_band(appearance.body_modifiers[i], m.desc_range),
    }, nil)
  end
  local bpa = caste.bp_appearance
  for i = 0, #appearance.bp_modifiers - 1 do
    local m = bpa.modifiers[bpa.modifier_idx[i]].modifier
    local pidx = bpa.part_idx[i]
    local pname = part_name(pidx)
    local noun = m.noun ~= '' and m.noun or pname
    add_feature(groups, order, {
      feature = noun,
      layer = layer_name(pidx, bpa.layer_idx[i]),
      modifier = df.appearance_modifier_type[m.type],
      value = appearance.bp_modifiers[i],
      desc_band = desc_band(appearance.bp_modifiers[i], m.desc_range),
    }, pname)
  end
  local rows = {}
  for _, key in ipairs(order) do
    local g = groups[key]
    local parts = sorted_keys(g.part_set)
    g.part_set = nil
    if #parts > 0 then g.parts, g.parts_truncated = capped(parts, PART_CAP) end
    rows[#rows + 1] = g
  end
  table.sort(rows, function(a, b)
    if a.feature ~= b.feature then return a.feature < b.feature end
    if (a.layer or '') ~= (b.layer or '') then return (a.layer or '') < (b.layer or '') end
    if a.modifier ~= b.modifier then return a.modifier < b.modifier end
    return a.value < b.value
  end)
  return rows
end

local function style_raw(type_id)
  for _, ts in ipairs(caste.tissue_styles) do
    if ts.id == type_id then return ts end
  end
  return nil
end

local function read_tissue_styles()
  local bpa = caste.bp_appearance
  local groups, order = {}, {}
  for i = 0, #appearance.tissue_style - 1 do
    local style = df.tissue_style_type[appearance.tissue_style[i]]
    local raw = style_raw(appearance.tissue_style_type[i])
    if raw and style and style ~= 'NONE' then
      local key = raw.noun .. '|' .. style
      local g = groups[key]
      if not g then
        g = { tissue = raw.noun, style = style, layer_set = {} }
        groups[key] = g
        order[#order + 1] = key
      end
      local layer = layer_name(bpa.style_part_idx[i], bpa.style_layer_idx[i])
      if layer then g.layer_set[layer] = true end
    end
  end
  local rows = {}
  for _, key in ipairs(order) do
    local g = groups[key]
    g.layers = sorted_keys(g.layer_set)
    g.layer_set = nil
    rows[#rows + 1] = g
  end
  table.sort(rows, function(a, b)
    if a.tissue ~= b.tissue then return a.tissue < b.tissue end
    return a.style < b.style
  end)
  return rows
end

local function read_colors(age_years)
  local age_days = (age_years or 0) * DAYS_PER_YEAR
  local rows = {}
  for i = 0, #appearance.colors - 1 do
    local cm = caste.color_modifiers[i]
    local timed = cm and cm.start_date > 0
    if cm and (not timed or age_days >= cm.start_date) then
      local pat = descriptors.patterns[cm.pattern_index[appearance.colors[i]]]
      if pat then
        local names = {}
        for k = 0, #pat.colors - 1 do names[#names + 1] = color_name(pat.colors[k]) end
        rows[#rows + 1] = {
          part = cm.part,
          pattern = pat.id,
          pattern_type = df.pattern_type[pat.pattern],
          colors = names,
          since_age = timed and cm.start_date / DAYS_PER_YEAR or nil,
          full_at_age = (timed and cm.end_date > 0) and cm.end_date / DAYS_PER_YEAR or nil,
        }
      end
    end
  end
  table.sort(rows, function(a, b)
    if a.part ~= b.part then return a.part < b.part end
    if (a.since_age or 0) ~= (b.since_age or 0) then return (a.since_age or 0) < (b.since_age or 0) end
    return a.pattern < b.pattern
  end)
  return rows
end

local function read_missing_parts()
  local status = u.body.components.body_part_status
  local names = {}
  for i = 0, #status - 1 do
    if status[i].missing then
      local parent = body_parts[i] and body_parts[i].con_part_id or -1
      if parent < 0 or not status[parent].missing then
        names[#names + 1] = part_name(i)
      end
    end
  end
  table.sort(names)
  return names
end

local function read_scars()
  local groups, order = {}, {}
  for _, w in ipairs(u.body.wounds) do
    for _, pt in ipairs(w.parts) do
      for flag, set in pairs(pt.flags1) do
        flag = tostring(flag)
        if set == true and flag:sub(1, 5) == 'scar_' then
          local part = part_name(pt.body_part_id) or tostring(pt.body_part_id)
          local layer = layer_name(pt.body_part_id, pt.layer_idx)
          local key = part .. '|' .. (layer or '')
          local g = groups[key]
          if not g then
            g = { part = part, layer = layer, kind_set = {} }
            groups[key] = g
            order[#order + 1] = key
          end
          g.kind_set[flag] = true
        end
      end
    end
  end
  local rows = {}
  for _, key in ipairs(order) do
    local g = groups[key]
    g.kinds = sorted_keys(g.kind_set)
    g.kind_set = nil
    rows[#rows + 1] = g
  end
  table.sort(rows, function(a, b)
    if a.part ~= b.part then return a.part < b.part end
    return (a.layer or '') < (b.layer or '')
  end)
  return rows
end

local function material_name(mat_type, mat_index)
  if mat_type < 0 then return nil end
  return safe(function() return dfhack.matinfo.decode(mat_type, mat_index):toString() end, nil)
end

local function dye_of(thread)
  local mat_type = safe(function() return thread.dye.mat_type end, -1)
  if mat_type < 0 then return nil end
  local mat_index = thread.dye.mat_index
  local mi = dfhack.matinfo.decode(mat_type, mat_index)
  return {
    material = material_name(mat_type, mat_index),
    color = mi and safe(function() return color_name(mi.material.state_color.Solid) end, nil) or nil,
  }
end

local function read_item_improvements(it)
  local decorations, dye = {}, nil
  if not df.item_constructed:is_instance(it) then return decorations, dye end
  for _, imp in ipairs(it.improvements) do
    local kind = df.improvement_type[imp:getType()]
    if kind == 'THREAD' then
      dye = dye or dye_of(imp)
    end
    if not STRUCTURAL_IMPROVEMENTS[kind] then
      decorations[#decorations + 1] = {
        type = kind,
        material = material_name(imp.mat_type, imp.mat_index),
        quality = df.item_quality[imp.quality],
      }
    end
  end
  table.sort(decorations, function(a, b)
    if a.type ~= b.type then return a.type < b.type end
    return (a.material or '') < (b.material or '')
  end)
  return decorations, dye
end

local function artifact_name(it)
  if not it.flags.artifact then return nil end
  local ref = dfhack.items.getGeneralRef(it, df.general_ref_type.IS_ARTIFACT)
  local art = ref and df.artifact_record.find(ref.artifact_id)
  return art and safe(function() return dfhack.translation.translateName(art.name, true) end, nil) or nil
end

local function read_inventory()
  local rows = {}
  for _, ii in ipairs(u.inventory) do
    local it = ii.item
    local decorations, dye = read_item_improvements(it)
    local wear = safe(function() return it.wear end, 0)
    rows[#rows + 1] = {
      item_id = it.id,
      role = df.inv_item_role_type[ii.mode],
      body_part = part_name(ii.body_part_id),
      item = safe(function() return dfhack.items.getDescription(it, 0, false) end, nil),
      type = df.item_type[it:getType()],
      material = material_name(it:getMaterial(), it:getMaterialIndex()),
      quality = df.item_quality[safe(function() return it:getQuality() end, 0)],
      wear = wear > 0 and wear or nil,
      dye = dye,
      decorations = decorations,
      artifact_name = artifact_name(it),
    }
  end
  table.sort(rows, function(a, b)
    if a.role ~= b.role then return a.role < b.role end
    if (a.body_part or '') ~= (b.body_part or '') then return (a.body_part or '') < (b.body_part or '') end
    return a.item_id < b.item_id
  end)
  return rows
end

local age = safe(function() return dfhack.units.getAge(u, true) end, nil)

local out = {
  unit_id = u.id,
  name = safe(function() return dfhack.units.getReadableName(u) end, 'unit ' .. query),
  race = safe(function() return df.creature_raw.find(u.race).name[0] end, nil),
  caste = safe(function() return caste.caste_id end, nil),
  sex = (u.sex == 1 and 'male') or (u.sex == 0 and 'female') or nil,
  age = age and math.floor(age) or nil,
  body_size_cm3 = safe(function() return u.body.size_info.size_cur end, nil),
}

out.features, out.features_truncated = capped(read_features(), FEATURE_CAP)
out.tissue_styles = read_tissue_styles()
out.colors = read_colors(age)
out.missing_parts, out.missing_parts_truncated = capped(read_missing_parts(), MARK_CAP)
out.scars, out.scars_truncated = capped(read_scars(), MARK_CAP)
out.inventory, out.inventory_truncated = capped(read_inventory(), INVENTORY_CAP)

emit(out)

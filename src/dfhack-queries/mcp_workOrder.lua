local json = require('json')
local emit = reqscript('mcp_jsonOut').emit

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local a = { ... }
local sub = a[1]

local function invert(t)
  local r = {}
  for k, v in pairs(t) do r[v] = k end
  return r
end

local LIST_CAP = 256
local FREQ = { OneTime = 0, Daily = 1, Monthly = 2, Seasonally = 3, Yearly = 4 }
local FREQ_NAME = invert(FREQ)
local COMPARE = { AtLeast = 0, AtMost = 1, GreaterThan = 2, LessThan = 3, Exactly = 4, Not = 5 }
local COMPARE_NAME = invert(COMPARE)
local ORDER_COND = { Activated = 0, Completed = 1 }
local ORDER_COND_NAME = invert(ORDER_COND)
local FLAG_GROUPS = {
  { field = 'flags1', type = df.job_item_flags1 },
  { field = 'flags2', type = df.job_item_flags2 },
  { field = 'flags3', type = df.job_item_flags3 },
}
local LIST_ONLY_ITEM_KEYS = { 'flags4', 'flags5', 'dye_color' }

local function manager_present()
  local ent = df.historical_entity.find(df.global.plotinfo.group_id)
  if not ent then return false end
  local mgr = {}
  for _, pos in ipairs(ent.positions.own) do
    local r = pos.responsibilities
    if (pos.code and pos.code:find('MANAGER')) or (r and r.MANAGE_PRODUCTION) then
      mgr[pos.id] = true
    end
  end
  for _, asn in ipairs(ent.positions.assignments) do
    if mgr[asn.position_id] and asn.histfig ~= -1 then return true end
  end
  return false
end

local function mat_token(mat_type, mat_index)
  if mat_type == -1 and mat_index == -1 then return nil end
  local mi = dfhack.matinfo.decode(mat_type, mat_index)
  return mi and mi:getToken() or (mat_type .. ':' .. mat_index)
end

local function subtype_token(item_type, item_subtype)
  if item_subtype == -1 then return nil end
  local def = item_type ~= -1 and dfhack.items.getSubtypeDef(item_type, item_subtype)
  return def and def.id or tostring(item_subtype)
end

local function find_subtype(item_type, token)
  for i = 0, dfhack.items.getSubtypeCount(item_type) - 1 do
    local def = dfhack.items.getSubtypeDef(item_type, i)
    if def and def.id == token then return i end
  end
  return nil
end

local function reaction_at(idx)
  local all = df.global.world.raws.reactions.reactions
  if idx >= 0 and idx < #all then return all[idx] end
  return nil
end

local function find_reaction(code)
  local all = df.global.world.raws.reactions.reactions
  for i = 0, #all - 1 do
    if all[i].code == code then return i, all[i] end
  end
  return nil, nil
end

local function find_reagent(reaction, code)
  for i = 0, #reaction.reagents - 1 do
    if reaction.reagents[i].code == code then return i end
  end
  return nil
end

local function flag_group_of(name)
  for _, g in ipairs(FLAG_GROUPS) do
    if g.type[name] ~= nil then return g end
  end
  return nil
end

local function set_flag_names(c)
  local names = {}
  for _, g in ipairs(FLAG_GROUPS) do
    local set = {}
    for k, v in pairs(c[g.field]) do
      if type(k) == 'string' and v == true then set[#set + 1] = k end
    end
    table.sort(set)
    for _, name in ipairs(set) do names[#names + 1] = name end
  end
  return names
end

local item_defaults_cache
local function item_defaults()
  if not item_defaults_cache then
    local c = df.manager_order_condition_item:new()
    item_defaults_cache = { flags4 = c.flags4, flags5 = c.flags5, dye_color = c.dye_color }
    c:delete()
  end
  return item_defaults_cache
end

local function item_condition_facts(c)
  local f = { condition = COMPARE_NAME[c.compare_type] or c.compare_type, value = c.compare_val }
  if c.item_type ~= -1 then f.item_type = df.item_type[c.item_type] end
  f.item_subtype = subtype_token(c.item_type, c.item_subtype)
  f.material = mat_token(c.mat_type, c.mat_index)
  local flags = set_flag_names(c)
  if #flags > 0 then f.flags = flags end
  if c.reaction_class ~= '' then f.reaction_class = c.reaction_class end
  if c.has_material_reaction_product ~= '' then f.reaction_product = c.has_material_reaction_product end
  if c.metal_ore ~= -1 then
    local mi = dfhack.matinfo.decode(0, c.metal_ore)
    f.bearing = mi and mi.inorganic and mi.inorganic.id or tostring(c.metal_ore)
  end
  if c.has_tool_use ~= -1 then f.tool = df.tool_uses[c.has_tool_use] end
  if c.min_dimension ~= -1 then f.min_dimension = c.min_dimension end
  local reaction = c.reaction_id ~= -1 and reaction_at(c.reaction_id) or nil
  if c.reaction_id ~= -1 then f.reaction = reaction and reaction.code or tostring(c.reaction_id) end
  if #c.contains > 0 then
    local codes = {}
    for i = 0, #c.contains - 1 do
      local ri = c.contains[i]
      local rg = reaction and ri >= 0 and ri < #reaction.reagents and reaction.reagents[ri]
      codes[#codes + 1] = rg and rg.code or tostring(ri)
    end
    f.contains = codes
  end
  local d = item_defaults()
  for _, k in ipairs(LIST_ONLY_ITEM_KEYS) do
    if c[k] ~= d[k] then f[k] = c[k] end
  end
  return f
end

local function order_condition_facts(c)
  return {
    order_id = c.order_id,
    condition = ORDER_COND_NAME[c.condition] or c.condition,
    satisfied = c.flags.satisfied,
  }
end

local function map_vector(vec, fn)
  local out = {}
  for i = 0, #vec - 1 do out[#out + 1] = fn(vec[i]) end
  return out
end

local function order_facts(o)
  local item
  if o.item_type ~= -1 then item = df.item_type[o.item_type] end
  local f = {
    id = o.id,
    job_type = df.job_type[o.job_type],
    item_type = item,
    material = mat_token(o.mat_type, o.mat_index),
    amount_total = o.amount_total,
    amount_left = o.amount_left,
    frequency = FREQ_NAME[o.frequency] or o.frequency,
    workshop_id = (o.workshop_id ~= -1) and o.workshop_id or nil,
    conditions = #o.item_conditions + #o.order_conditions,
    active = o.status.active,
    validated = o.status.validated,
  }
  if #o.item_conditions > 0 then f.item_conditions = map_vector(o.item_conditions, item_condition_facts) end
  if #o.order_conditions > 0 then f.order_conditions = map_vector(o.order_conditions, order_condition_facts) end
  return f
end

local function identity(job_type, item_type, item_subtype, mat_type, mat_index)
  return string.format('%d/%d/%d/%d/%d', job_type, item_type, item_subtype, mat_type, mat_index)
end

local function find_order(id)
  local all = df.global.world.manager_orders.all
  for i = 0, #all - 1 do
    if all[i].id == id then return i, all[i] end
  end
  return nil, nil
end

if sub == 'list' then
  local after = tonumber(a[2])
  local all = df.global.world.manager_orders.all
  local out = {}
  for i = 0, #all - 1 do
    local o = all[i]
    if not after or o.id > after then out[#out + 1] = order_facts(o) end
  end
  table.sort(out, function(x, y) return x.id < y.id end)
  local truncated = false
  local next_cursor
  while #out > LIST_CAP do
    table.remove(out)
    truncated = true
  end
  if truncated then next_cursor = out[#out].id end
  emit({
    count = #all,
    orders = out,
    truncated = truncated,
    next_cursor = next_cursor,
    manager_present = manager_present(),
  })
  return
end

local function decode_array(raw, label, blocked)
  if not raw then return {} end
  local ok, arr = pcall(json.decode, raw)
  if not ok or type(arr) ~= 'table' then
    blocked[#blocked + 1] = label .. ' is not a JSON array'
    return {}
  end
  return arr
end

local function parse_item_condition(t, where, blocked)
  local function bad(msg) blocked[#blocked + 1] = where .. ': ' .. msg end
  local s = { fields = {}, flags = {}, contains = {} }
  s.fields.compare_type = COMPARE[t.condition]
  if s.fields.compare_type == nil then
    bad('unknown condition ' .. tostring(t.condition) .. ' (AtLeast|AtMost|GreaterThan|LessThan|Exactly|Not)')
  end
  s.fields.compare_val = math.tointeger(t.value)
  if s.fields.compare_val == nil then bad('value must be an integer') end
  if t.item_type ~= nil then
    local it = df.item_type[t.item_type]
    if it == nil or it == -1 then bad('unknown item_type ' .. tostring(t.item_type)) else s.fields.item_type = it end
  end
  if t.item_subtype ~= nil then
    local st = s.fields.item_type and find_subtype(s.fields.item_type, t.item_subtype)
    if not st then
      bad('unknown item_subtype ' .. tostring(t.item_subtype) .. ' for item_type ' .. tostring(t.item_type))
    else
      s.fields.item_subtype = st
    end
  end
  if t.material ~= nil then
    local mi = dfhack.matinfo.find(t.material)
    if not mi then
      bad('unknown material token ' .. tostring(t.material))
    else
      s.fields.mat_type, s.fields.mat_index = mi.type, mi.index
    end
  end
  for _, name in ipairs(t.flags or {}) do
    local g = flag_group_of(name)
    if not g then bad('unknown flag ' .. tostring(name)) else s.flags[#s.flags + 1] = { field = g.field, name = name } end
  end
  if t.reaction_class ~= nil then s.fields.reaction_class = t.reaction_class end
  if t.reaction_product ~= nil then s.fields.has_material_reaction_product = t.reaction_product end
  if t.bearing ~= nil then
    local mi = dfhack.matinfo.find('INORGANIC:' .. tostring(t.bearing))
    if not mi or mi.mode ~= 'inorganic' then bad('unknown inorganic bearing ' .. tostring(t.bearing)) else s.fields.metal_ore = mi.index end
  end
  if t.tool ~= nil then
    local tu = df.tool_uses[t.tool]
    if tu == nil or tu == -1 then bad('unknown tool use ' .. tostring(t.tool)) else s.fields.has_tool_use = tu end
  end
  if t.min_dimension ~= nil then
    s.fields.min_dimension = math.tointeger(t.min_dimension)
    if s.fields.min_dimension == nil then bad('min_dimension must be an integer') end
  end
  local reaction
  if t.reaction ~= nil then
    local idx
    idx, reaction = find_reaction(t.reaction)
    if not idx then bad('unknown reaction ' .. tostring(t.reaction)) else s.fields.reaction_id = idx end
  end
  if t.contains ~= nil and #t.contains > 0 then
    if t.reaction == nil then bad('contains requires reaction (reagent codes are resolved within it)') end
    for _, code in ipairs(t.contains) do
      local ri = reaction and find_reagent(reaction, code)
      if reaction and not ri then bad('reaction ' .. t.reaction .. ' has no reagent ' .. tostring(code)) end
      if ri then s.contains[#s.contains + 1] = ri end
    end
  end
  return s
end

local function parse_order_condition(t, where, blocked)
  local cond = ORDER_COND[t.condition]
  if cond == nil then
    blocked[#blocked + 1] = where .. ': unknown condition ' .. tostring(t.condition) .. ' (Activated|Completed)'
  end
  local id = tonumber(t.order_id)
  if not id or not select(2, find_order(id)) then
    blocked[#blocked + 1] = where .. ': no manager order with id ' .. tostring(t.order_id)
  end
  return { order_id = id, condition = cond }
end

local function parse_create()
  local jt_name = a[2]
  local amount = tonumber(a[3])
  local freq_name = (a[4] ~= '' and a[4]) or 'OneTime'
  local mat_token_in = (a[5] ~= '' and a[5]) or nil
  local it_name = (a[6] ~= '' and a[6]) or nil
  local legacy_json = (a[7] ~= '' and a[7]) or nil
  local blocked = {}

  local jt = df.job_type[jt_name]
  if jt == nil then blocked[#blocked + 1] = 'unknown job_type: ' .. tostring(jt_name) end
  if not amount or amount < 1 or amount ~= math.floor(amount) then
    blocked[#blocked + 1] = 'amount must be a positive integer'
  end
  local freq = FREQ[freq_name]
  if freq == nil then
    blocked[#blocked + 1] =
      'unknown frequency: ' .. tostring(freq_name) .. ' (OneTime|Daily|Monthly|Seasonally|Yearly)'
  end
  local mat_type, mat_index = -1, -1
  if mat_token_in then
    local mi = dfhack.matinfo.find(mat_token_in)
    if not mi then
      blocked[#blocked + 1] = 'unknown material token: ' .. mat_token_in
    else
      mat_type, mat_index = mi.type, mi.index
    end
  end
  local item_type, item_subtype = -1, -1
  if it_name then
    local it = df.item_type[it_name]
    if it == nil then
      blocked[#blocked + 1] = 'unknown item_type: ' .. it_name
    else
      item_type = it
    end
  end
  if #decode_array(legacy_json, 'conditions', blocked) > 0 then
    blocked[#blocked + 1] = 'conditions is replaced by item_conditions / order_conditions'
  end
  local ic_in = decode_array(a[8] ~= '' and a[8] or nil, 'item_conditions', blocked)
  local oc_in = decode_array(a[9] ~= '' and a[9] or nil, 'order_conditions', blocked)
  local item_conds, order_conds = {}, {}
  for i, t in ipairs(ic_in) do
    item_conds[i] = parse_item_condition(t, 'item_conditions[' .. (i - 1) .. ']', blocked)
  end
  for i, t in ipairs(oc_in) do
    order_conds[i] = parse_order_condition(t, 'order_conditions[' .. (i - 1) .. ']', blocked)
  end
  return {
    jt = jt, amount = amount, freq = freq, freq_name = freq_name,
    mat_type = mat_type, mat_index = mat_index, mat_token = mat_token_in,
    item_type = item_type, item_subtype = item_subtype, it_name = it_name,
    ic_in = ic_in, oc_in = oc_in, item_conds = item_conds, order_conds = order_conds,
    blocked = blocked,
  }
end

local function find_duplicate(p)
  local all = df.global.world.manager_orders.all
  local want = identity(p.jt, p.item_type, p.item_subtype, p.mat_type, p.mat_index)
  for i = 0, #all - 1 do
    local o = all[i]
    if identity(o.job_type, o.item_type, o.item_subtype, o.mat_type, o.mat_index) == want then
      return o.id
    end
  end
  return nil
end

local function build_item_condition(s)
  local c = df.manager_order_condition_item:new()
  for k, v in pairs(s.fields) do c[k] = v end
  for _, f in ipairs(s.flags) do c[f.field][f.name] = true end
  for _, idx in ipairs(s.contains) do c.contains:insert('#', idx) end
  return c
end

local function build_order_condition(s)
  local c = df.manager_order_condition_order:new()
  c.order_id = s.order_id
  c.condition = s.condition
  return c
end

if sub == 'plan_create' or sub == 'apply_create' then
  local p = parse_create()
  if #p.blocked > 0 then emit({ blocked = p.blocked }) return end
  local dup = find_duplicate(p)
  if sub == 'plan_create' then
    emit({
      preview = {
        job_type = df.job_type[p.jt],
        amount = p.amount,
        frequency = p.freq_name,
        material = p.mat_token,
        item_type = p.it_name,
        item_conditions = (#p.ic_in > 0) and p.ic_in or nil,
        order_conditions = (#p.oc_in > 0) and p.oc_in or nil,
        would_duplicate = dup ~= nil,
        duplicate_of = dup,
        manager_present = manager_present(),
      },
      signature = string.format('create/%s/%d/%d/dup=%s',
        identity(p.jt, p.item_type, p.item_subtype, p.mat_type, p.mat_index),
        p.amount, p.freq, tostring(dup ~= nil)),
    })
    return
  end
  local mo = df.global.world.manager_orders
  local o = df.manager_order:new()
  o.id = mo.manager_order_next_id
  mo.manager_order_next_id = mo.manager_order_next_id + 1
  o.job_type = p.jt
  o.item_type = p.item_type
  o.item_subtype = p.item_subtype
  o.mat_type = p.mat_type
  o.mat_index = p.mat_index
  o.amount_total = p.amount
  o.amount_left = p.amount
  o.frequency = p.freq
  o.workshop_id = -1
  o.max_workshops = 0
  o.finished_year = -1
  o.finished_year_tick = -1
  for _, s in ipairs(p.item_conds) do o.item_conditions:insert('#', build_item_condition(s)) end
  for _, s in ipairs(p.order_conds) do o.order_conditions:insert('#', build_order_condition(s)) end
  mo.all:insert('#', o)
  emit({
    changes = {
      created_order_id = o.id,
      job_type = df.job_type[p.jt],
      amount = p.amount,
      frequency = p.freq_name,
    },
    undo = { order_id = o.id, reversal = 'work_order_cancel(order_id=' .. o.id .. ')' },
    readback = order_facts(o),
  })
  return
end

local function conditions_signature(o)
  local parts = {}
  for i = 0, #o.item_conditions - 1 do
    local c = o.item_conditions[i]
    parts[#parts + 1] = table.concat({
      c.compare_type, c.compare_val, c.item_type, c.item_subtype, c.mat_type, c.mat_index,
      c.flags1.whole, c.flags2.whole, c.flags3.whole, c.flags4, c.flags5,
      c.metal_ore, c.min_dimension, c.reaction_id, c.has_tool_use, c.dye_color, #c.contains,
      c.reaction_class, c.has_material_reaction_product,
    }, ',')
  end
  for i = 0, #o.order_conditions - 1 do
    local c = o.order_conditions[i]
    parts[#parts + 1] = 'o' .. c.order_id .. ',' .. c.condition
  end
  return table.concat(parts, ';')
end

local function dependents_of(id)
  local all = df.global.world.manager_orders.all
  local ids = {}
  for i = 0, #all - 1 do
    local o = all[i]
    for j = 0, #o.order_conditions - 1 do
      if o.order_conditions[j].order_id == id then
        ids[#ids + 1] = o.id
        break
      end
    end
  end
  table.sort(ids)
  return ids
end

local function recreate_spec(o, facts)
  local recreate = {
    job_type = facts.job_type,
    amount = o.amount_left,
    frequency = facts.frequency,
    material = facts.material,
    item_type = facts.item_type,
  }
  local dropped = {}
  if o.workshop_id ~= -1 then dropped[#dropped + 1] = 'workshop binding' end
  if o.item_subtype ~= -1 then dropped[#dropped + 1] = 'item_subtype' end
  if facts.item_conditions then
    for i, f in ipairs(facts.item_conditions) do
      for _, k in ipairs(LIST_ONLY_ITEM_KEYS) do
        if f[k] ~= nil then
          dropped[#dropped + 1] = 'item_conditions[' .. (i - 1) .. '].' .. k
          f[k] = nil
        end
      end
    end
    recreate.item_conditions = facts.item_conditions
  end
  if facts.order_conditions then
    local ocs = {}
    for i, f in ipairs(facts.order_conditions) do ocs[i] = { order_id = f.order_id, condition = f.condition } end
    recreate.order_conditions = ocs
  end
  local deps = dependents_of(o.id)
  if #deps > 0 then
    dropped[#dropped + 1] = 'order_conditions on order(s) ' .. table.concat(deps, ', ') ..
      ' that reference this order (a recreated order gets a new id)'
  end
  return recreate, dropped
end

local function free_order(o)
  for i = 0, #o.item_conditions - 1 do o.item_conditions[i]:delete() end
  for i = 0, #o.order_conditions - 1 do o.order_conditions[i]:delete() end
  if o.items then
    for i = 0, #o.items.elements - 1 do o.items.elements[i]:delete() end
    o.items:delete()
  end
  o:delete()
end

if sub == 'plan_cancel' or sub == 'apply_cancel' then
  local id = tonumber(a[2])
  if not id then emit({ blocked = { 'order_id must be an integer' } }) return end
  local idx, o = find_order(id)
  if not o then emit({ blocked = { 'no manager order with id ' .. id } }) return end
  local facts = order_facts(o)
  local signature = string.format('cancel/%d/%s/tot=%d/left=%d/%s/ws=%d/sub=%d/val=%s/cond=%s',
    id, identity(o.job_type, o.item_type, o.item_subtype, o.mat_type, o.mat_index),
    o.amount_total, o.amount_left, facts.frequency, o.workshop_id, o.item_subtype,
    tostring(o.status.validated), conditions_signature(o))
  if sub == 'plan_cancel' then
    local deps = dependents_of(id)
    if #deps > 0 then facts.depended_on_by = deps end
    emit({ preview = facts, signature = signature })
    return
  end
  local recreate, dropped = recreate_spec(o, facts)
  local undo = {
    recreate = recreate,
    faithful = #dropped == 0,
    reversal = 'work_order_create with the recreate spec',
  }
  if #dropped > 0 then undo.not_reproduced = dropped end
  df.global.world.manager_orders.all:erase(idx)
  free_order(o)
  local _, still = find_order(id)
  emit({
    changes = { cancelled_order_id = id },
    undo = undo,
    readback = { order_id = id, present = still ~= nil },
  })
  return
end

emit({ error = 'unknown subcommand: ' .. tostring(sub) })

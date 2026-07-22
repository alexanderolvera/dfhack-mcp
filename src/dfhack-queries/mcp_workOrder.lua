local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local a = { ... }
local sub = a[1]

local LIST_CAP = 256
local FREQ = { OneTime = 0, Daily = 1, Monthly = 2, Seasonally = 3, Yearly = 4 }
local FREQ_NAME = { [0] = 'OneTime', [1] = 'Daily', [2] = 'Monthly', [3] = 'Seasonally', [4] = 'Yearly' }

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

local function order_facts(o)
  local mat
  if o.mat_type ~= -1 or o.mat_index ~= -1 then
    local mi = dfhack.matinfo.decode(o.mat_type, o.mat_index)
    mat = mi and mi:getToken() or (o.mat_type .. ':' .. o.mat_index)
  end
  local item
  if o.item_type ~= -1 then item = df.item_type[o.item_type] end
  return {
    id = o.id,
    job_type = df.job_type[o.job_type],
    item_type = item,
    material = mat,
    amount_total = o.amount_total,
    amount_left = o.amount_left,
    frequency = FREQ_NAME[o.frequency] or o.frequency,
    workshop_id = (o.workshop_id ~= -1) and o.workshop_id or nil,
    conditions = #o.item_conditions + #o.order_conditions,
    active = o.status.active,
    validated = o.status.validated,
  }
end

local function identity(job_type, item_type, item_subtype, mat_type, mat_index)
  return string.format('%d/%d/%d/%d/%d', job_type, item_type, item_subtype, mat_type, mat_index)
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

local function parse_create()
  local jt_name = a[2]
  local amount = tonumber(a[3])
  local freq_name = (a[4] ~= '' and a[4]) or 'OneTime'
  local mat_token = (a[5] ~= '' and a[5]) or nil
  local it_name = (a[6] ~= '' and a[6]) or nil
  local cond_json = (a[7] ~= '' and a[7]) or nil
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
  if mat_token then
    local mi = dfhack.matinfo.find(mat_token)
    if not mi then
      blocked[#blocked + 1] = 'unknown material token: ' .. mat_token
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
  if cond_json then
    local okc, arr = pcall(json.decode, cond_json)
    if okc and type(arr) == 'table' and #arr > 0 then
      blocked[#blocked + 1] =
        'order prerequisite conditions are not supported in v1; specify material / item_type directly'
    end
  end
  return {
    jt = jt, amount = amount, freq = freq, freq_name = freq_name,
    mat_type = mat_type, mat_index = mat_index, mat_token = mat_token,
    item_type = item_type, item_subtype = item_subtype, it_name = it_name,
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

local function find_order(id)
  local all = df.global.world.manager_orders.all
  for i = 0, #all - 1 do
    if all[i].id == id then return i, all[i] end
  end
  return nil, nil
end

if sub == 'plan_cancel' or sub == 'apply_cancel' then
  local id = tonumber(a[2])
  if not id then emit({ blocked = { 'order_id must be an integer' } }) return end
  local idx, o = find_order(id)
  if not o then emit({ blocked = { 'no active manager order with id ' .. id } }) return end
  local facts = order_facts(o)
  local nconds = #o.item_conditions + #o.order_conditions
  local signature = string.format('cancel/%d/%s/tot=%d/left=%d/%s/ws=%d/cond=%d/sub=%d/val=%s',
    id, identity(o.job_type, o.item_type, o.item_subtype, o.mat_type, o.mat_index),
    o.amount_total, o.amount_left, facts.frequency, o.workshop_id, nconds, o.item_subtype,
    tostring(o.status.validated))
  if sub == 'plan_cancel' then
    emit({ preview = facts, signature = signature })
    return
  end
  local faithful = (o.workshop_id == -1) and (nconds == 0) and (o.item_subtype == -1)
  local recreate = {
    job_type = facts.job_type,
    amount = o.amount_left,
    frequency = facts.frequency,
    material = facts.material,
    item_type = facts.item_type,
  }
  local undo = { recreate = recreate, faithful = faithful, reversal = 'work_order_create with the recreate spec' }
  if not faithful then
    local dropped = {}
    if o.workshop_id ~= -1 then dropped[#dropped + 1] = 'workshop binding' end
    if nconds > 0 then dropped[#dropped + 1] = nconds .. ' order condition(s)' end
    if o.item_subtype ~= -1 then dropped[#dropped + 1] = 'item_subtype' end
    undo.not_reproduced = dropped
  end
  df.global.world.manager_orders.all:erase(idx)
  o:delete()
  local _, still = find_order(id)
  emit({
    changes = { cancelled_order_id = id },
    undo = undo,
    readback = { order_id = id, present = still ~= nil },
  })
  return
end

emit({ error = 'unknown subcommand: ' .. tostring(sub) })

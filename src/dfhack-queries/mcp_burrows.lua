local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local utils = require('utils')
local burrowsapi = dfhack.burrows

local a = { ... }
local sub = a[1]

local UNITS_CAP = 200

local function tile_count(b)
  local total = 0
  for _, blk in ipairs(burrowsapi.listBlocks(b)) do
    for x = 0, 15 do
      for y = 0, 15 do
        if burrowsapi.isAssignedBlockTile(b, blk, x, y) then total = total + 1 end
      end
    end
  end
  return total
end

local function find_burrow(name)
  for _, b in ipairs(df.global.plotinfo.burrows.list) do
    if b.name == name then return b end
  end
  return nil
end

local function find_burrow_by_id(id)
  for _, b in ipairs(df.global.plotinfo.burrows.list) do
    if b.id == id then return b end
  end
  return nil
end

local function civ_alert_burrow_ids()
  local list = df.global.plotinfo.alerts.list
  if #list < 2 then return {} end
  local out = {}
  for i = 0, #list[1].burrows - 1 do out[#out + 1] = list[1].burrows[i] end
  return out
end

local function burrow_facts(b, alert_set)
  local units = {}
  for i = 0, #b.units - 1 do units[#units + 1] = b.units[i] end
  table.sort(units)
  local truncated = false
  while #units > UNITS_CAP do
    table.remove(units)
    truncated = true
  end
  return {
    id = b.id,
    name = b.name,
    tile_count = tile_count(b),
    assigned_units = units,
    assigned_units_total = #b.units,
    assigned_units_truncated = truncated,
    civilian_alert_linked = alert_set[b.id] == true,
  }
end

if sub == nil or sub == 'list' then
  local alert_ids = civ_alert_burrow_ids()
  local alert_set = {}
  for _, id in ipairs(alert_ids) do alert_set[id] = true end
  local out = {}
  for _, b in ipairs(df.global.plotinfo.burrows.list) do
    out[#out + 1] = burrow_facts(b, alert_set)
  end
  table.sort(out, function(x, y) return x.id < y.id end)
  emit({
    count = #out,
    burrows = out,
    civilian_alert = {
      configured = #df.global.plotinfo.alerts.list >= 2,
      active = df.global.plotinfo.alerts.civ_alert_idx ~= 0,
      burrows = alert_ids,
    },
  })
  return
end

local function alert_signature(list_len, civ_idx, alert_ids, burrow_id)
  local sorted = {}
  for _, id in ipairs(alert_ids) do sorted[#sorted + 1] = id end
  table.sort(sorted)
  return string.format('civalert/list_len=%d/civ_idx=%d/burrow_id=%d/burrows=%s',
    list_len, civ_idx, burrow_id, table.concat(sorted, ','))
end

local function parse_toggle()
  local bname = a[2]
  local en_raw = a[3]
  local id_raw = a[4]
  local enabled = (en_raw == 'true' or en_raw == '1')
  local blocked = {}
  local bid = tonumber(id_raw)
  local b
  if bid then
    b = find_burrow_by_id(bid)
    if not b then blocked[#blocked + 1] = 'no burrow with id ' .. tostring(bid) end
  elseif bname and bname ~= '' then
    b = find_burrow(bname)
    if not b then blocked[#blocked + 1] = 'no burrow named "' .. bname .. '"' end
  else
    blocked[#blocked + 1] = 'burrow (name) or burrow_id is required'
  end
  return { bname = bname, enabled = enabled, b = b, blocked = blocked }
end

if sub == 'plan_alert' or sub == 'apply_alert' then
  local p = parse_toggle()
  if #p.blocked > 0 then
    emit({ blocked = p.blocked })
    return
  end

  local list = df.global.plotinfo.alerts.list
  local list_len = #list
  local alert_ids = civ_alert_burrow_ids()
  local alert_set = {}
  for _, id in ipairs(alert_ids) do alert_set[id] = true end
  local currently_in = alert_set[p.b.id] == true
  local civ_idx = df.global.plotinfo.alerts.civ_alert_idx
  local currently_sounding = civ_idx ~= 0

  local resulting_ids = {}
  for _, id in ipairs(alert_ids) do
    if id ~= p.b.id then resulting_ids[#resulting_ids + 1] = id end
  end
  if p.enabled then resulting_ids[#resulting_ids + 1] = p.b.id end
  table.sort(resulting_ids)
  local resulting_sounding = p.enabled or (currently_sounding and #resulting_ids > 0)
  local noop = (currently_in == p.enabled) and (currently_sounding == resulting_sounding)

  if sub == 'plan_alert' then
    emit({
      preview = {
        burrow_id = p.b.id,
        burrow_name = p.b.name,
        enabled = p.enabled,
        currently_in_civilian_alert = currently_in,
        civilian_alert_currently_sounding = currently_sounding,
        civilian_alert_configured = list_len >= 2,
        resulting_civilian_alert_burrows = resulting_ids,
        resulting_sounding = resulting_sounding,
      },
      signature = alert_signature(list_len, civ_idx, alert_ids, p.b.id),
      noop = noop or nil,
    })
    return
  end

  if #list < 2 then
    while #list < 2 do
      local item = df.alert_statest:new()
      item.id = df.global.plotinfo.alerts.next_id
      df.global.plotinfo.alerts.next_id = df.global.plotinfo.alerts.next_id + 1
      item.name = 'civ-alert'
      list:insert('#', item)
    end
  end
  local civ = list[1]

  if p.enabled then
    if not utils.binsearch(civ.burrows, p.b.id) then
      utils.insert_sorted(civ.burrows, p.b.id)
    end
    if df.global.plotinfo.alerts.civ_alert_idx == 0 and #civ.burrows > 0 then
      df.global.plotinfo.alerts.civ_alert_idx = 1
    end
  else
    utils.erase_sorted(civ.burrows, p.b.id)
    if #civ.burrows == 0 then
      df.global.plotinfo.alerts.civ_alert_idx = 0
    end
  end

  local new_alert_ids = {}
  local new_alert_set = {}
  for i = 0, #civ.burrows - 1 do
    local id = civ.burrows[i]
    new_alert_ids[#new_alert_ids + 1] = id
    new_alert_set[id] = true
  end

  emit({
    changes = {
      burrow_id = p.b.id,
      burrow_name = p.b.name,
      enabled = p.enabled,
      civilian_alert_burrows = new_alert_ids,
      civilian_alert_sounding = df.global.plotinfo.alerts.civ_alert_idx ~= 0,
    },
    undo = {
      reversible = true,
      reversal = 'call civilian_alert again on the same burrow with enabled inverted',
      note = 'if other burrows remain in the civilian-alert set, removing THIS burrow does not ' ..
        'by itself silence the alarm for them — it only clears when the set becomes empty',
    },
    readback = {
      burrow = burrow_facts(p.b, new_alert_set),
      civilian_alert = {
        configured = true,
        active = df.global.plotinfo.alerts.civ_alert_idx ~= 0,
        burrows = new_alert_ids,
      },
    },
  })
  return
end

emit({ error = 'unknown subcommand: ' .. tostring(sub) })

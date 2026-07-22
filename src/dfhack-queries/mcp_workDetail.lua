local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local a = { ... }
local sub = a[1]

local MEMBER_CAP = 200
local M = df.work_detail_mode

local function work_details()
  return df.global.plotinfo.labor_info.work_details
end

local function labor_names(d)
  local out = {}
  for i = 0, #d.allowed_labors - 1 do
    if d.allowed_labors[i] then out[#out + 1] = df.unit_labor[i] end
  end
  return out
end

local function granted(uid, L)
  local wds = work_details()
  for i = 0, #wds - 1 do
    local d = wds[i]
    if d.allowed_labors[L] then
      local mode = d.flags.mode
      if mode == M.EverybodyDoesThis then
        return true
      elseif mode == M.OnlySelectedDoesThis or mode == M.Default then
        for j = 0, #d.assigned_units - 1 do
          if d.assigned_units[j] == uid then return true end
        end
      end
    end
  end
  return false
end

local function member_index(d, uid)
  for j = 0, #d.assigned_units - 1 do
    if d.assigned_units[j] == uid then return j end
  end
  return nil
end

local function detail_facts(d, after)
  local ids = {}
  for j = 0, #d.assigned_units - 1 do
    local id = d.assigned_units[j]
    if not after or id > after then ids[#ids + 1] = id end
  end
  table.sort(ids)
  local count = #d.assigned_units
  local truncated = false
  while #ids > MEMBER_CAP do
    table.remove(ids)
    truncated = true
  end
  local names = {}
  for i, id in ipairs(ids) do
    local u = df.unit.find(id)
    names[i] = u and dfhack.units.getReadableName(u) or ('unit ' .. id)
  end
  return {
    name = d.name,
    mode = df.work_detail_mode[d.flags.mode] or d.flags.mode,
    no_modify = d.flags.no_modify,
    icon = d.icon,
    allowed_labors = labor_names(d),
    members = ids,
    member_names = names,
    member_count = count,
    members_truncated = truncated,
    members_cursor = truncated and ids[#ids] or nil,
  }
end

local function find_detail(name)
  local wds = work_details()
  for i = 0, #wds - 1 do
    if wds[i].name == name then return i, wds[i] end
  end
  return nil, nil
end

if sub == 'list' then
  local fname = a[2]
  if fname == '' then fname = nil end
  local after = tonumber(a[3])
  local wds = work_details()
  local out = {}
  for i = 0, #wds - 1 do
    if not fname or wds[i].name == fname then
      out[#out + 1] = detail_facts(wds[i], after)
    end
  end
  emit({ count = #out, details = out, members_after = after })
  return
end

local function parse_assign()
  local uid = tonumber(a[2])
  local dname = a[3]
  local en_raw = a[4]
  local enabled = (en_raw == 'true' or en_raw == '1')
  local blocked = {}

  if not uid or uid ~= math.floor(uid) then
    blocked[#blocked + 1] = 'unit_id must be an integer'
  end
  if not dname or dname == '' then
    blocked[#blocked + 1] = 'detail name is required'
  end

  local u = uid and df.unit.find(uid) or nil
  if uid and not u then
    blocked[#blocked + 1] = 'no unit with id ' .. tostring(uid)
  elseif u and not dfhack.units.isCitizen(u) then
    blocked[#blocked + 1] = 'unit ' .. uid .. ' is not a fort citizen'
  end

  local didx, detail
  if dname and dname ~= '' then
    didx, detail = find_detail(dname)
    if not detail then blocked[#blocked + 1] = 'no work detail named "' .. dname .. '"' end
  end

  return {
    uid = uid, u = u, dname = dname, enabled = enabled,
    didx = didx, detail = detail, blocked = blocked,
  }
end

local function labor_digest(d)
  local idx = {}
  for i = 0, #d.allowed_labors - 1 do
    if d.allowed_labors[i] then idx[#idx + 1] = i end
  end
  return table.concat(idx, ',')
end

local function member_digest(d)
  local ids = {}
  for j = 0, #d.assigned_units - 1 do ids[#ids + 1] = d.assigned_units[j] end
  table.sort(ids)
  return table.concat(ids, ',')
end

local function assign_signature(p, currently_member, count)
  return string.format(
    'assign/detail=%s/idx=%d/uid=%d/member=%s/count=%d/mode=%d/labors=%s/members=%s',
    p.dname, p.didx, p.uid, tostring(currently_member), count,
    p.detail.flags.mode, labor_digest(p.detail), member_digest(p.detail))
end

if sub == 'plan_assign' or sub == 'apply_assign' then
  local p = parse_assign()
  if #p.blocked > 0 then emit({ blocked = p.blocked }) return end

  local d = p.detail
  local mi = member_index(d, p.uid)
  local currently_member = mi ~= nil
  local count = #d.assigned_units
  local resulting = count
  if p.enabled and not currently_member then
    resulting = count + 1
  elseif not p.enabled and currently_member then
    resulting = count - 1
  end
  local noop = (p.enabled and currently_member) or (not p.enabled and not currently_member)
  local only_member = (not p.enabled) and currently_member and count == 1

  if sub == 'plan_assign' then
    local RESULTING_CAP = 50
    local wds = work_details()
    local resulting_details, r_truncated = {}, false
    for i = 0, #wds - 1 do
      local member
      if i == p.didx then member = p.enabled
      else member = member_index(wds[i], p.uid) ~= nil end
      if member then
        if #resulting_details < RESULTING_CAP then
          resulting_details[#resulting_details + 1] = wds[i].name
        else
          r_truncated = true
        end
      end
    end
    emit({
      preview = {
        unit_id = p.uid,
        unit_name = dfhack.units.getReadableName(p.u),
        detail = p.dname,
        detail_mode = df.work_detail_mode[d.flags.mode] or d.flags.mode,
        enabled = p.enabled,
        currently_member = currently_member,
        resulting_members_count = resulting,
        only_member = only_member,
        allowed_labors = labor_names(d),
        resulting_details = resulting_details,
        resulting_details_truncated = r_truncated or nil,
      },
      signature = assign_signature(p, currently_member, count),
      noop = noop or nil,
    })
    return
  end

  local prior_labors, stale_labors = {}, {}
  for i = 0, #d.allowed_labors - 1 do
    if d.allowed_labors[i] then
      local name = df.unit_labor[i]
      local prior = p.u.status.labors[i]
      prior_labors[name] = prior
      if prior ~= granted(p.uid, i) then stale_labors[#stale_labors + 1] = name end
    end
  end

  local now_member = currently_member
  if p.enabled and not currently_member then
    d.assigned_units:insert('#', p.uid)
    now_member = true
  elseif not p.enabled and currently_member then
    d.assigned_units:erase(mi)
    now_member = false
  end

  local labors_now = {}
  for i = 0, #d.allowed_labors - 1 do
    if d.allowed_labors[i] then
      local val = granted(p.uid, i)
      p.u.status.labors[i] = val
      labors_now[df.unit_labor[i]] = val
    end
  end

  emit({
    changes = {
      unit_id = p.uid,
      detail = p.dname,
      enabled = p.enabled,
      now_member = now_member,
    },
    undo = {
      reversal = 'assign_work_detail with enabled inverted',
      unit_id = p.uid,
      detail = p.dname,
      enabled = not p.enabled,
      prior_member = currently_member,
      prior_labors = prior_labors,
      faithful = #stale_labors == 0,
      not_reproduced = (#stale_labors > 0) and {
        string.format('labor cache for %d labor(s) was stale and is recomputed, not restored',
          #stale_labors),
      } or nil,
    },
    readback = {
      detail = detail_facts(d),
      unit_id = p.uid,
      is_member = member_index(d, p.uid) ~= nil,
      unit_labors_now = labors_now,
    },
  })
  return
end

emit({ error = 'unknown subcommand: ' .. tostring(sub) })

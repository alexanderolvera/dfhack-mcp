-- mcp_workDetail: A3 — labor via work details. Backs two MCP tools:
--   work_details        (read-only sensor; subcommand "list")
--   assign_work_detail  (gated actuator; "plan_assign" / "apply_assign")
--
-- EXECUTE, NEVER DECIDE: the caller names the unit, the detail, and the desired
-- membership; this script toggles it and reports facts. No "you should assign X".
-- The §A0 dry-run/confirm/undo loop lives in TS (src/actuator.ts); this script
-- answers plan_assign (preview + signature) and apply_assign (mutate + readback).
--
-- Work details live in df.global.plotinfo.labor_info.work_details
-- (vector<work_detail*>). Each work_detail has: .name (string), .assigned_units
-- (vector<int32_t> of unit ids), .allowed_labors (bool[] indexed by df.unit_labor —
-- index i true = that labor is enabled by the detail), .flags (with .mode, a
-- df.work_detail_mode: Default|EverybodyDoesThis|NobodyDoesThis|OnlySelectedDoesThis),
-- and .icon. These are the SAME structures the in-game Labor -> Work Details screen
-- reads, so a membership change appears in-game (spike #11, verified live on 53.15).
--
-- LABOR PROPAGATION (the residual risk #26 flagged, RESOLVED here): editing
-- assigned_units alone does NOT immediately update a unit's status.labors — the game
-- reconciles them only on a frame advance, via its automatic-professions system
-- (gated by df.global.game.external_flag.automatic_professions_disabled; false on the
-- fixture = enabled). assigned_units is therefore the DURABLE source of truth, and
-- status.labors is a derived cache. So apply_assign edits assigned_units AND mirrors
-- the affected labors onto unit.status.labors NOW — recomputing each as the union
-- across ALL details (granted()), exactly what the game reconciles to — so the change
-- is visible immediately even on a paused fort. Verified live: assign 111 -> Miners
-- => MINE true; remove => MINE false. (spike #11 + #26 residual-risk check.)
--
-- Invoked by name via DFHack RunCommand with a subcommand as arg 1; prints ONE JSON
-- object. Args arrive unescaped as `...`.

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

-- The labor names a detail enables (allowed_labors bool[] -> df.unit_labor names).
local function labor_names(d)
  local out = {}
  for i = 0, #d.allowed_labors - 1 do
    if d.allowed_labors[i] then out[#out + 1] = df.unit_labor[i] end
  end
  return out
end

-- Does ANY detail grant labor L to unit uid? This is the union the game itself
-- computes: an EverybodyDoesThis detail grants L to everyone; an OnlySelectedDoesThis
-- (or Default) detail grants L only to its assigned members; NobodyDoesThis grants
-- nothing. Used to mirror the affected labors onto the unit after a membership edit.
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

-- Index of uid within a detail's assigned_units, or nil if absent.
local function member_index(d, uid)
  for j = 0, #d.assigned_units - 1 do
    if d.assigned_units[j] == uid then return j end
  end
  return nil
end

-- Facts for one detail: labors it enables + a bounded, id-sorted member list (with
-- parallel readable names), the full member_count, and a truncation flag. Members are
-- SORTED by id so the payload is deterministic regardless of the vector's own order.
-- `after` (optional) is the members_after cursor: only ids > after are listed, so a
-- capped list can be paged. member_count stays the FULL count regardless of cursor.
-- members_cursor (the last listed id, to pass back as members_after) is emitted ONLY
-- when this detail's list was cap-truncated — an untruncated payload is unchanged.
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

-- Find a detail by exact name (first match). Returns index, detail or nil.
local function find_detail(name)
  local wds = work_details()
  for i = 0, #wds - 1 do
    if wds[i].name == name then return i, wds[i] end
  end
  return nil, nil
end

-- ============================ list ============================
-- work_details(): every work detail with its labors + bounded membership. READ-ONLY.
-- Narrowing args (both optional, empty = unset): [2] = exact detail name (return
-- ONLY that detail), [3] = members_after unit-id cursor (member lists start after
-- that id — the paging path past MEMBER_CAP). With neither, output is unchanged.
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
  -- count = details LISTED (the fort total when unfiltered). members_after is
  -- echoed only when a cursor was passed, so the no-arg payload is unchanged.
  emit({ count = #out, details = out, members_after = after })
  return
end

-- ============================ assign ============================
-- args: [2]=unit_id, [3]=detail name, [4]=enabled ("true"/"false"/"1"/"0")
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

-- Digest of the labor set a detail enables: the enabled df.unit_labor indices,
-- comma-joined in index order (stable). Changes exactly when the set changes.
local function labor_digest(d)
  local idx = {}
  for i = 0, #d.allowed_labors - 1 do
    if d.allowed_labors[i] then idx[#idx + 1] = i end
  end
  return table.concat(idx, ',')
end

-- Signature captures the detail identity + THIS unit's current membership state +
-- the detail's member count + the detail's MODE and allowed-labor set — the latter
-- two because the preview shows them and they determine which status.labors entries
-- apply mutates. Any change to the previewed target state (the unit joining/leaving
-- elsewhere, another unit changing the count, the detail vanishing, its mode or
-- labor set edited in-game between preview and confirm) voids the token. `enabled`
-- is part of the op args (opDigest), not the signature.
local function assign_signature(p, currently_member, count)
  return string.format('assign/detail=%s/idx=%d/uid=%d/member=%s/count=%d/mode=%d/labors=%s',
    p.dname, p.didx, p.uid, tostring(currently_member), count,
    p.detail.flags.mode, labor_digest(p.detail))
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
    -- The unit's RESULTING memberships (#26 AC): every detail the unit would be a
    -- member of AFTER the change — its current memberships adjusted for the pending
    -- add/remove (matched by detail INDEX, not name, so duplicates can't confuse
    -- it). Bounded, though forts only ever have ~a dozen details.
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
        only_member = only_member or nil,
        allowed_labors = labor_names(d),
        resulting_details = resulting_details,
        resulting_details_truncated = r_truncated or nil,
      },
      signature = assign_signature(p, currently_member, count),
      noop = noop or nil,
    })
    return
  end

  -- apply_assign: toggle membership, then mirror the affected labors onto the unit.
  local now_member = currently_member
  if p.enabled and not currently_member then
    d.assigned_units:insert('#', p.uid)
    now_member = true
  elseif not p.enabled and currently_member then
    d.assigned_units:erase(mi)
    now_member = false
  end

  -- Propagate: recompute each labor this detail governs to the union across ALL
  -- details, matching what the game reconciles to (see the LABOR PROPAGATION note).
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
      faithful = true,
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

local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local leverapi = reqscript('lever')

local a = { ... }
local sub = a[1]

local bt = df.building_type

-- gate_flags field names differ per target building type (matches DFHack's own
-- lever.lua flag_names table) — Bridge uses raised/lowered/raising/lowering,
-- Weapon (upright spikes) uses retracted/unretracted/retracting/unretracting,
-- Floodgate uses closed/open/closing/opening. Confirmed live: `closed`/`raised`
-- (the stable-state bit) are REAL fields on gate_flags, not just the two
-- transitional bits — read all four, not only the transitional pair.
local GATE_FLAG_NAMES = setmetatable({
  [bt.Bridge] = { closed = 'raised', open = 'lowered', closing = 'raising', opening = 'lowering' },
  [bt.Weapon] = { closed = 'retracted', open = 'unretracted', closing = 'retracting', opening = 'unretracting' },
}, { __index = function() return { closed = 'closed', open = 'open', closing = 'closing', opening = 'opening' } end })

local function job_facts(jobs)
  local out = {}
  for _, j in ipairs(jobs) do
    if j.job_type == df.job_type.PullLever then
      out[#out + 1] = {
        id = j.id,
        do_now = j.flags.do_now,
        repeating = j.flags['repeat'],
        suspended = j.flags.suspend,
      }
    end
  end
  return out
end

-- Resolves the building(s) a lever/pressure-plate's linked mechanism items point
-- at, mirroring DFHack's own lever.lua leverDescribe(). Bridge/Floodgate/Weapon
-- expose `gate_flags`; Door/Hatch expose `door_flags` instead (confirmed live —
-- both are a plain {closed: bool, ...} struct, no closing/opening transitional
-- bits). Support and any other target type reports no `state`.
local function linked_targets(trap)
  local out = {}
  for _, m in ipairs(trap.linked_mechanisms) do
    local tref = dfhack.items.getGeneralRef(m, df.general_ref_type.BUILDING_HOLDER)
    local tg = tref and tref:getBuilding()
    if tg then
      local target = {
        building_id = tg.id,
        type = df.building_type[tg:getType()],
        pos = { x = tg.centerx, y = tg.centery, z = tg.z },
      }
      local ok, flags = pcall(function() return tg.gate_flags end)
      if ok and flags then
        local names = GATE_FLAG_NAMES[tg:getType()]
        if flags[names.closing] then target.state = names.closing
        elseif flags[names.opening] then target.state = names.opening
        elseif flags[names.closed] then target.state = names.closed
        else target.state = names.open end
      else
        local ok2, dflags = pcall(function() return tg.door_flags end)
        if ok2 and dflags then
          target.state = dflags.closed and 'closed' or 'open'
        end
      end
      out[#out + 1] = target
    end
  end
  return out
end

local function lever_facts(b)
  return {
    building_id = b.id,
    name = b.name,
    pos = { x = b.centerx, y = b.centery, z = b.z },
    state = b.state,
    linked_targets = linked_targets(b),
    pending_pull_jobs = job_facts(b.jobs),
  }
end

local function plate_facts(b)
  local p = b.plate_info
  return {
    building_id = b.id,
    name = b.name,
    pos = { x = b.centerx, y = b.centery, z = b.z },
    linked_targets = linked_targets(b),
    triggers = {
      citizens = p.flags.citizens,
      creatures = p.flags.units,
      creature_weight_min = p.unit_min,
      creature_weight_max = p.unit_max,
      minecart_track = p.flags.track,
      minecart_weight_min = p.track_min,
      minecart_weight_max = p.track_max,
      water = p.flags.water,
      water_depth_min = p.water_min,
      water_depth_max = p.water_max,
      magma = p.flags.magma,
      magma_depth_min = p.magma_min,
      magma_depth_max = p.magma_max,
    },
  }
end

if sub == nil or sub == 'list' then
  local levers, plates = {}, {}
  local linked_target_ids = {}
  local bridges = {}

  for _, b in ipairs(df.global.world.buildings.all) do
    local t = b:getType()
    if t == bt.Trap then
      local tt = df.trap_type[b.trap_type]
      if tt == 'Lever' then
        local facts = lever_facts(b)
        levers[#levers + 1] = facts
        for _, tgt in ipairs(facts.linked_targets) do linked_target_ids[tgt.building_id] = true end
      elseif tt == 'PressurePlate' then
        local facts = plate_facts(b)
        plates[#plates + 1] = facts
        for _, tgt in ipairs(facts.linked_targets) do linked_target_ids[tgt.building_id] = true end
      end
    elseif t == bt.Bridge then
      bridges[#bridges + 1] = { building_id = b.id, pos = { x = b.centerx, y = b.centery, z = b.z } }
    end
  end
  table.sort(levers, function(x, y) return x.building_id < y.building_id end)
  table.sort(plates, function(x, y) return x.building_id < y.building_id end)

  local unlinked_levers, unlinked_bridges = {}, {}
  for _, lv in ipairs(levers) do
    if #lv.linked_targets == 0 then unlinked_levers[#unlinked_levers + 1] = lv.building_id end
  end
  for _, br in ipairs(bridges) do
    if not linked_target_ids[br.building_id] then
      unlinked_bridges[#unlinked_bridges + 1] = br.building_id
    end
  end
  table.sort(unlinked_bridges)

  emit({
    lever_count = #levers,
    levers = levers,
    plate_count = #plates,
    pressure_plates = plates,
    unlinked_levers = unlinked_levers,
    bridge_count = #bridges,
    unlinked_bridges = unlinked_bridges,
  })
  return
end

local function find_lever(id)
  local b = df.building.find(id)
  if not b then return nil end
  if not df.building_trapst:is_instance(b) then return nil end
  if df.trap_type[b.trap_type] ~= 'Lever' then return nil end
  return b
end

local function pull_signature(lever)
  local ids = {}
  for _, tgt in ipairs(linked_targets(lever)) do ids[#ids + 1] = tgt.building_id end
  table.sort(ids)
  local job_ids = {}
  for _, j in ipairs(job_facts(lever.jobs)) do job_ids[#job_ids + 1] = j.id end
  table.sort(job_ids)
  return string.format('pull/id=%d/state=%d/targets=%s/jobs=%s', lever.id, lever.state,
    table.concat(ids, ','), table.concat(job_ids, ','))
end

local function parse_pull()
  local lever_id = tonumber(a[2])
  local urgent_raw = a[3]
  local urgent = not (urgent_raw == 'false' or urgent_raw == '0')
  local blocked = {}
  if not lever_id or lever_id ~= math.floor(lever_id) then
    blocked[#blocked + 1] = 'lever_id must be an integer'
  end
  local lever = lever_id and find_lever(lever_id) or nil
  if lever_id and not lever then
    blocked[#blocked + 1] = 'no lever with building id ' .. tostring(lever_id)
  end
  return { lever_id = lever_id, urgent = urgent, lever = lever, blocked = blocked }
end

if sub == 'plan_pull' or sub == 'apply_pull' then
  local p = parse_pull()
  if #p.blocked > 0 then
    emit({ blocked = p.blocked })
    return
  end

  if sub == 'plan_pull' then
    emit({
      preview = {
        lever_id = p.lever.id,
        lever_name = p.lever.name,
        pos = { x = p.lever.centerx, y = p.lever.centery, z = p.lever.z },
        current_state = p.lever.state,
        linked_targets = linked_targets(p.lever),
        pending_pull_jobs = job_facts(p.lever.jobs),
        urgent = p.urgent,
      },
      signature = pull_signature(p.lever),
    })
    return
  end

  leverapi.leverPullJob(p.lever, p.urgent)

  emit({
    changes = {
      lever_id = p.lever.id,
      queued = true,
      urgent = p.urgent,
    },
    undo = {
      reversible = true,
      reversal = 'call pull_lever again on the same lever_id — a second pull toggles it back',
      note = 'this QUEUES a job; the lever only flips (and any linked bridge/door/spike/' ..
        'support only actually moves) once a dwarf walks over and completes it — not ' ..
        'immediately on apply',
    },
    readback = lever_facts(p.lever),
  })
  return
end

emit({ error = 'unknown subcommand: ' .. tostring(sub) })

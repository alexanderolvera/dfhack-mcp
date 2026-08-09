local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local visibility = reqscript('mcp_unitVisibility')

local a = { ... }
local sub = a[1]
local squad_id = tonumber(a[2])
local order_kind = a[3]
local tx, ty, tz = tonumber(a[4]), tonumber(a[5]), tonumber(a[6])
local target_csv = a[7] or ''

local MAX_KILL_TARGETS = 32

local function split_ids(s)
  local ids = {}
  for tok in tostring(s):gmatch('[^,]+') do
    local n = tonumber(tok)
    if n then ids[#ids + 1] = math.floor(n) end
  end
  return ids
end

local function find_squad(id)
  local sq = df.squad.find(id)
  if not sq then return nil end
  local fort = df.global.plotinfo.main.fortress_entity
  -- A squad belonging to another entity (a visiting lord's retinue) is not this
  -- fort's to command; military() never lists it, so it must not be targetable.
  if not fort or sq.entity_id ~= fort.id then return nil end
  return sq
end

local function squad_name(sq)
  local ok, nm = pcall(function() return dfhack.translation.translateName(sq.name, true) end)
  return (ok and nm ~= '' and nm) or (sq.alias ~= '' and sq.alias) or ('Squad ' .. sq.id)
end

-- Living, present members — the units that would actually carry the order out.
local function members(sq)
  local out = {}
  for _, p in ipairs(sq.positions) do
    if p.occupant ~= -1 then
      local hf = df.historical_figure.find(p.occupant)
      local u = hf and df.unit.find(hf.unit_id)
      if u and dfhack.units.isActive(u) and not dfhack.units.isDead(u) then
        out[#out + 1] = u
      end
    end
  end
  return out
end

local function order_facts(o)
  local t = df.squad_order_type[o:getType()]
  local row = { type = t, reported_as_complete = o.flags.reported_as_complete }
  if t == 'MOVE' then
    row.pos = { x = o.pos.x, y = o.pos.y, z = o.pos.z }
  elseif t == 'KILL_LIST' then
    local ids = {}
    for i = 0, #o.units - 1 do ids[#ids + 1] = o.units[i] end
    table.sort(ids)
    row.target_unit_ids = ids
    if o.title ~= '' then row.title = o.title end
  end
  return row
end

local function current_orders(sq)
  local out = {}
  for i = 0, #sq.orders - 1 do out[#out + 1] = order_facts(sq.orders[i]) end
  return out
end

-- Signature covers ONLY this squad's own order list and living-member set: the
-- things an apply would act on or through. A change anywhere else in the fort
-- must not void the token.
local function signature(sq)
  local parts = {}
  for _, o in ipairs(current_orders(sq)) do
    local extra = ''
    if o.pos then
      extra = string.format('@%d,%d,%d', o.pos.x, o.pos.y, o.pos.z)
    elseif o.target_unit_ids then
      extra = '#' .. table.concat(o.target_unit_ids, '.')
    end
    parts[#parts + 1] = o.type .. extra .. ':' .. tostring(o.reported_as_complete)
  end
  local mem = {}
  for _, u in ipairs(members(sq)) do mem[#mem + 1] = u.id end
  table.sort(mem)
  return string.format('squad=%d/orders=[%s]/members=[%s]',
    sq.id, table.concat(parts, ','), table.concat(mem, ','))
end

local function tile_walkable(x, y, z)
  local blk = dfhack.maps.getTileBlock(x, y, z)
  if not blk then return false, false end
  local hidden = blk.designation[x % 16][y % 16].hidden
  local tt = dfhack.maps.getTileType(xyz2pos(x, y, z))
  local shape = tt and df.tiletype.attrs[tt].shape
  local sattrs = shape and df.tiletype_shape.attrs[shape]
  return (sattrs and sattrs.walkable) or false, hidden
end

local function validate()
  local blocked = {}
  local sq = squad_id and find_squad(squad_id) or nil
  if not squad_id or squad_id ~= math.floor(squad_id) then
    blocked[#blocked + 1] = 'squad_id must be an integer'
  elseif not sq then
    blocked[#blocked + 1] = 'no squad of this fort with squad_id ' .. tostring(squad_id)
      .. ' (see military())'
  end

  if order_kind ~= 'move' and order_kind ~= 'kill' and order_kind ~= 'cancel' then
    blocked[#blocked + 1] = "order must be one of 'move', 'kill', 'cancel' (got '"
      .. tostring(order_kind) .. "')"
    return blocked, sq, nil
  end

  -- A squad with nobody in it cannot carry out an order; issuing one would look
  -- like it worked and silently do nothing.
  if sq and order_kind ~= 'cancel' and #members(sq) == 0 then
    blocked[#blocked + 1] = 'squad ' .. squad_id ..
      ' has no living, present members to carry out an order'
  end

  local resolved = nil

  if order_kind == 'move' then
    if not (tx and ty and tz) then
      blocked[#blocked + 1] = 'move requires integer x, y and z'
    else
      local map = df.global.world.map
      if tx < 0 or ty < 0 or tz < 0 or tx >= map.x_count or ty >= map.y_count
         or tz >= map.z_count then
        blocked[#blocked + 1] = string.format(
          'target (%d,%d,%d) is outside the map', tx, ty, tz)
      else
        local walkable, hidden = tile_walkable(tx, ty, tz)
        if not walkable then
          blocked[#blocked + 1] = string.format(
            'target (%d,%d,%d) is not a walkable tile — the squad could never reach it',
            tx, ty, tz)
        end
        resolved = { walkable = walkable, hidden = hidden }
      end
    end
  elseif order_kind == 'kill' then
    local ids = split_ids(target_csv)
    if #ids == 0 then
      blocked[#blocked + 1] = 'kill requires at least one target_unit_id'
    elseif #ids > MAX_KILL_TARGETS then
      blocked[#blocked + 1] = string.format(
        '%d kill targets exceeds the %d-target cap', #ids, MAX_KILL_TARGETS)
    end
    local targets, seen = {}, {}
    for _, id in ipairs(ids) do
      if not seen[id] then
        seen[id] = true
        local u = df.unit.find(id)
        if not u then
          blocked[#blocked + 1] = 'no unit with id ' .. id
        elseif dfhack.units.isDead(u) or not dfhack.units.isActive(u) then
          blocked[#blocked + 1] = 'unit ' .. id .. ' is dead or not on the map'
        elseif visibility.is_hidden(u) then
          -- Fog-of-war gate: ordering an attack on a unit standing on an
          -- undiscovered tile would act on knowledge the fort does not have.
          -- Fail closed, exactly as the unit-listing sensors do.
          blocked[#blocked + 1] = 'unit ' .. id ..
            ' is on an undiscovered tile and cannot be targeted'
        elseif dfhack.units.isCitizen(u) then
          blocked[#blocked + 1] = 'unit ' .. id ..
            ' is one of your own citizens — refusing to build a kill order against it'
        else
          targets[#targets + 1] = u
        end
      end
    end
    resolved = { targets = targets }
  end

  return blocked, sq, resolved
end

local function target_facts(targets)
  local out = {}
  for _, u in ipairs(targets) do
    out[#out + 1] = {
      unit_id = u.id,
      name = dfhack.units.getReadableName(u),
      pos = { x = u.pos.x, y = u.pos.y, z = u.pos.z },
      great_danger = dfhack.units.isGreatDanger(u),
    }
  end
  table.sort(out, function(p, q) return p.unit_id < q.unit_id end)
  return out
end

local blocked, sq, resolved = validate()
if #blocked > 0 then
  emit({ blocked = blocked })
  return
end

local existing = current_orders(sq)

if sub == 'plan' then
  local preview = {
    squad_id = sq.id,
    squad_name = squad_name(sq),
    order = order_kind,
    member_count = #members(sq),
    current_orders = existing,
  }

  if order_kind == 'move' then
    preview.target = { x = tx, y = ty, z = tz }
    preview.target_undiscovered = resolved.hidden
    preview.replaces_existing_orders = #existing
  elseif order_kind == 'kill' then
    preview.targets = target_facts(resolved.targets)
    preview.replaces_existing_orders = #existing
  else
    preview.orders_that_would_be_cancelled = #existing
  end

  emit({
    preview = preview,
    signature = signature(sq),
    noop = (order_kind == 'cancel' and #existing == 0) or nil,
  })
  return
end

if sub == 'apply' then
  -- Every path first clears the squad's existing orders: DF treats sq.orders as
  -- the squad's whole standing instruction set, so appending a second order
  -- would leave two live orders fighting over the same squad.
  local cleared = #existing
  for i = #sq.orders - 1, 0, -1 do
    local o = sq.orders[i]
    sq.orders:erase(i)
    o:delete()
  end

  local changes = {
    squad_id = sq.id,
    squad_name = squad_name(sq),
    order = order_kind,
    cleared_previous_orders = cleared,
  }

  if order_kind == 'move' then
    local o = df.squad_order_movest:new()
    o.pos.x, o.pos.y, o.pos.z = tx, ty, tz
    o.point_id = -1
    sq.orders:insert('#', o)
    changes.target = { x = tx, y = ty, z = tz }
  elseif order_kind == 'kill' then
    local o = df.squad_order_kill_listst:new()
    local names = {}
    for _, u in ipairs(resolved.targets) do
      o.units:insert('#', u.id)
      -- Not every creature is a historical figure (a wild beast is often not);
      -- inserting -1 would corrupt the list, so only real hf ids go in.
      if u.hist_figure_id and u.hist_figure_id ~= -1 then
        o.histfigs:insert('#', u.hist_figure_id)
      end
      names[#names + 1] = dfhack.units.getReadableName(u)
    end
    o.title = table.concat(names, ', ')
    sq.orders:insert('#', o)
    changes.targets = target_facts(resolved.targets)
  end

  local undo = {
    reversal = 'squad_orders with order="cancel" and the same squad_id',
    squad_id = sq.id,
    faithful = (cleared == 0),
  }
  if cleared > 0 then
    undo.not_reproduced = {
      cleared .. ' pre-existing order(s) on this squad were cleared and are not restored by a cancel',
    }
  end
  if order_kind ~= 'cancel' then
    undo.note = 'cancel RELEASES the squad from the order; it does not walk them back ' ..
      'to where they were, and cannot undo fighting that already happened'
  end

  emit({
    changes = changes,
    undo = undo,
    readback = {
      squad_id = sq.id,
      member_count = #members(sq),
      orders = current_orders(sq),
    },
  })
  return
end

emit({ error = 'unknown subcommand: ' .. tostring(sub) })

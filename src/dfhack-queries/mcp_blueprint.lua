local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

math.randomseed(os.time() + math.floor((os.clock() or 0) * 1e6))

local a = { ... }
local sub = a[1]
local csv = a[2] or ''
local x = tonumber(a[3])
local y = tonumber(a[4])
local z = tonumber(a[5])
local mode = a[6]

local SUPPORTED = { dig = true, zone = true }
local FOG_CAP = 64
local CONFLICT_CAP = 50
local MSG_CAP = 20
local MAX_FOOTPRINT = 10000
local MAX_CSV_BYTES = 65536

local function csv_fields(line)
  local fields, buf, in_q = {}, {}, false
  local i, n = 1, #line
  while i <= n do
    local ch = line:sub(i, i)
    if in_q then
      if ch == '"' then
        if line:sub(i + 1, i + 1) == '"' then
          buf[#buf + 1] = '"'
          i = i + 1
        else
          in_q = false
        end
      else
        buf[#buf + 1] = ch
      end
    elseif ch == '"' then
      in_q = true
    elseif ch == ',' then
      fields[#fields + 1] = table.concat(buf)
      buf = {}
    else
      buf[#buf + 1] = ch
    end
    i = i + 1
  end
  fields[#fields + 1] = table.concat(buf)
  return fields
end

local function occupied_cells()
  local cells, seen, err = {}, {}, nil
  local count = 0
  local function add(dx, dy)
    local k = dx .. ',' .. dy
    if not seen[k] then
      if count >= MAX_FOOTPRINT then
        err = 'blueprint footprint exceeds ' .. MAX_FOOTPRINT .. ' cells'
        return false
      end
      seen[k] = true
      count = count + 1
      cells[#cells + 1] = { dx = dx, dy = dy }
    end
    return true
  end
  local datarow = -1
  local seen_modeline = false
  for line in (csv .. '\n'):gmatch('(.-)\n') do
    if err then break end
    if not seen_modeline then
      if line:match('%S') then seen_modeline = true end
    else
      datarow = datarow + 1
      local col = 0
      for _, field in ipairs(csv_fields(line)) do
        local t = field:match('^%s*(.-)%s*$')
        if t ~= '' and not t:match('^#') then
          local ew, eh = t:match('%((%d+)x(%d+)%)')
          ew, eh = tonumber(ew) or 1, tonumber(eh) or 1
          if ew * eh > MAX_FOOTPRINT then
            err = 'cell expansion (' .. ew .. 'x' .. eh .. ') exceeds the max footprint of '
              .. MAX_FOOTPRINT .. ' cells'
            break
          end
          for ey = 0, eh - 1 do
            for ex = 0, ew - 1 do
              if not add(col + ex, datarow + ey) then break end
            end
            if err then break end
          end
        end
        if err then break end
        col = col + 1
      end
    end
  end
  return cells, err
end

local function validate()
  local blocked = {}
  if #csv > MAX_CSV_BYTES then
    blocked[#blocked + 1] = string.format(
      'csv is %d bytes, over the %d-byte (64 KiB) limit', #csv, MAX_CSV_BYTES)
  end
  if not SUPPORTED[mode] then
    if mode == 'build' or mode == 'place' then
      blocked[#blocked + 1] =
        "mode '" .. tostring(mode) .. "' is not supported in v1 (dig and zone only)"
    else
      blocked[#blocked + 1] = "unknown mode '" .. tostring(mode) .. "' (expected dig or zone)"
    end
  end
  if x == nil or y == nil or z == nil then
    blocked[#blocked + 1] = 'anchor x,y,z must all be integers'
  end
  local first
  for line in (csv .. '\n'):gmatch('(.-)\n') do
    if line:match('%S') then first = line break end
  end
  local modeline_mode = first and first:match('^%s*#(%a+)')
  if not modeline_mode then
    blocked[#blocked + 1] = 'csv has no #mode header line (expected a #dig or #zone modeline first)'
  elseif SUPPORTED[mode] and modeline_mode ~= mode then
    blocked[#blocked + 1] =
      "csv modeline '#" .. modeline_mode .. "' does not match mode '" .. tostring(mode) .. "'"
  end
  local _, ferr = occupied_cells()
  if ferr then blocked[#blocked + 1] = ferr end
  return blocked
end

local function md5(str)
  return dfhack.internal.md5(str)
end

local function scan_cells()
  local cells = occupied_cells()
  local map = df.global.world.map
  local res = {
    footprint = #cells,
    fog = 0,
    fog_sample = {},
    pre_existing = 0,
    clipped = 0,
    conflicts = {},
    conflicts_truncated = false,
  }
  local parts = {}
  local function conflict(wx, wy, reason)
    if #res.conflicts < CONFLICT_CAP then
      res.conflicts[#res.conflicts + 1] = { x = wx, y = wy, reason = reason }
    else
      res.conflicts_truncated = true
    end
  end
  for _, c in ipairs(cells) do
    local wx, wy = x + c.dx, y + c.dy
    local state, hidden = 'oob', 'oob'
    if wx < 0 or wy < 0 or z < 0 or wx >= map.x_count or wy >= map.y_count or z >= map.z_count then
      res.clipped = res.clipped + 1
      conflict(wx, wy, 'out of bounds')
    else
      local blk = dfhack.maps.getTileBlock(wx, wy, z)
      local d = blk and blk.designation[wx % 16][wy % 16]
      hidden = (d and d.hidden) and 1 or 0
      if hidden == 1 then
        res.fog = res.fog + 1
        if #res.fog_sample < FOG_CAP then
          res.fog_sample[#res.fog_sample + 1] = { x = wx, y = wy }
        end
      end
      if mode == 'dig' then
        state = d and d.dig or 'none'
        if d and d.dig ~= 0 then
          res.pre_existing = res.pre_existing + 1
          conflict(wx, wy, 'already designated')
        end
        if dfhack.buildings.findAtTile(xyz2pos(wx, wy, z)) then
          conflict(wx, wy, 'building present')
        end
      else
        local ids = {}
        local czs = dfhack.buildings.findCivzonesAt(xyz2pos(wx, wy, z))
        if czs then
          for _, cz in ipairs(czs) do ids[#ids + 1] = cz.id end
        end
        table.sort(ids)
        state = (#ids > 0) and table.concat(ids, '+') or 'none'
        if #ids > 0 then
          res.pre_existing = res.pre_existing + 1
          conflict(wx, wy, 'zone present')
        end
      end
    end
    parts[#parts + 1] = string.format('%d,%d,%s,%s', wx, wy, tostring(state), tostring(hidden))
  end
  table.sort(parts)
  res.digest = md5(table.concat(parts, ';'))
  return res
end

local function readback()
  local cells = occupied_cells()
  local set = 0
  for _, c in ipairs(cells) do
    local wx, wy = x + c.dx, y + c.dy
    if mode == 'dig' then
      local blk = dfhack.maps.getTileBlock(wx, wy, z)
      if blk and blk.designation[wx % 16][wy % 16].dig ~= 0 then set = set + 1 end
    else
      local cz = dfhack.buildings.findCivzonesAt(xyz2pos(wx, wy, z))
      if cz and #cz > 0 then set = set + 1 end
    end
  end
  return { mode = mode, footprint_cells = #cells, designated_tiles = set }
end

local function undo_handle(pre_existing)
  local h = {
    reversal = 'blueprint_undo',
    csv = csv,
    mode = mode,
    anchor = { x, y, z },
    faithful = pre_existing == 0,
  }
  if pre_existing > 0 then
    h.not_reproduced = {
      pre_existing .. ' pre-existing designation(s) on footprint tiles would also be removed',
    }
  end
  return h
end

local function bp_dir()
  return dfhack.getDFPath() .. '/dfhack-config/blueprints/'
end

local function write_temp()
  local name = string.format('mcp_bp_%d_%d.csv', os.time(), math.random(100000, 999999))
  local path = bp_dir() .. name
  local f = io.open(path, 'w')
  if not f then return nil, nil, 'cannot write temp blueprint file under ' .. bp_dir() end
  f:write(csv)
  f:close()
  return name, path
end

local function num_after(out, pat)
  local n = out:match(pat)
  return n and tonumber(n) or 0
end

local function run_qf(command, dry)
  local name, path, werr = write_temp()
  if not name then return nil, werr end
  local coord = string.format('%d,%d,%d', x, y, z)
  local args = { 'quickfort', command, name, '-c', coord }
  if dry then args[#args + 1] = '--dry-run' end
  local ok, out = pcall(dfhack.run_command_silent, args)
  os.remove(path)
  if not ok then return nil, 'quickfort ' .. command .. ' failed: ' .. tostring(out) end
  out = out or ''
  local messages, messages_truncated = {}, false
  for line in (out .. '\n'):gmatch('(.-)\n') do
    if line:match('successfully completed') then break end
    if line:match('%S') then
      if #messages < MSG_CAP then
        messages[#messages + 1] = line
      else
        messages_truncated = true
      end
    end
  end
  return {
    output = out,
    messages = messages,
    messages_truncated = messages_truncated,
    dig_designated = num_after(out, 'Tiles designated for digging:%s*(%d+)'),
    dig_undesignated = num_after(out, 'Tiles undesignated for digging:%s*(%d+)'),
    zone_designated = num_after(out, 'Zone tiles designated:%s*(%d+)'),
    zones_removed = num_after(out, 'Zones removed:%s*(%d+)'),
    could_not = num_after(out, 'could not be designated[^:\n]*:%s*(%d+)'),
    invalid_keys = num_after(out, 'Invalid key sequences:%s*(%d+)'),
  }
end

local function gate_reasons(stats)
  local gate = {}
  if stats.invalid_keys > 0 then
    gate[#gate + 1] = stats.invalid_keys .. ' invalid key sequence(s) in the blueprint'
  end
  if stats.could_not > 0 then
    gate[#gate + 1] = stats.could_not .. ' tile(s) could not be designated at this anchor'
  end
  return gate
end

local function attach_parse_errors(preview, stats)
  if #stats.messages > 0 then
    preview.parse_errors = stats.messages
    preview.parse_errors_truncated = stats.messages_truncated or nil
  end
end

if sub == 'plan_apply' or sub == 'apply_apply' then
  local blocked = validate()
  if #blocked > 0 then emit({ blocked = blocked }) return end

  if sub == 'plan_apply' then
    local scan = scan_cells()
    local stats, err = run_qf('run', true)
    if not stats then emit({ blocked = { err } }) return end
    local tiles = (mode == 'dig') and stats.dig_designated or stats.zone_designated
    local preview = {
      mode = mode,
      anchor = { x, y, z },
      tiles_affected = tiles,
      invalid_key_sequences = stats.invalid_keys,
      could_not_designate = stats.could_not,
      footprint_cells = scan.footprint,
      fog_of_war_tiles = scan.fog,
      fog_of_war_sample = (#scan.fog_sample > 0) and scan.fog_sample or nil,
      fog_of_war_truncated = (scan.fog > #scan.fog_sample) or nil,
      pre_existing_designations = scan.pre_existing,
      clipped_out_of_bounds = scan.clipped,
      conflicts = (#scan.conflicts > 0) and scan.conflicts or nil,
      conflicts_truncated = scan.conflicts_truncated or nil,
    }
    attach_parse_errors(preview, stats)
    local signature = string.format('apply/%s/%d,%d,%d/%s/t=%d/cn=%d/ik=%d/cells=%s',
      mode, x, y, z, md5(csv), tiles, stats.could_not, stats.invalid_keys, scan.digest)
    local gate = gate_reasons(stats)
    if #gate > 0 then
      emit({ blocked = gate, preview = preview, signature = signature })
      return
    end
    emit({ preview = preview, signature = signature, noop = (tiles == 0) or nil })
    return
  end

  local pre_existing = readback().designated_tiles
  local stats, err = run_qf('run', false)
  if not stats then emit({ error = err }) return end
  local tiles = (mode == 'dig') and stats.dig_designated or stats.zone_designated
  emit({
    changes = {
      mode = mode,
      anchor = { x, y, z },
      tiles_affected = tiles,
      invalid_key_sequences = stats.invalid_keys,
      could_not_designate = stats.could_not,
    },
    undo = undo_handle(pre_existing),
    readback = readback(),
  })
  return
end

if sub == 'plan_undo' or sub == 'apply_undo' then
  local blocked = validate()
  if #blocked > 0 then emit({ blocked = blocked }) return end

  if sub == 'plan_undo' then
    local rb = readback()
    local scan = scan_cells()
    local stats, err = run_qf('undo', true)
    if not stats then emit({ blocked = { err } }) return end
    local preview = {
      mode = mode,
      anchor = { x, y, z },
      footprint_cells = rb.footprint_cells,
      currently_designated = rb.designated_tiles,
    }
    attach_parse_errors(preview, stats)
    local signature = string.format('undo/%s/%d,%d,%d/%s/set=%d/cells=%s',
      mode, x, y, z, md5(csv), rb.designated_tiles, scan.digest)
    local gate = gate_reasons(stats)
    if #gate > 0 then
      emit({ blocked = gate, preview = preview, signature = signature })
      return
    end
    emit({
      preview = preview,
      signature = signature,
      noop = (rb.designated_tiles == 0) or nil,
    })
    return
  end

  local stats, err = run_qf('undo', false)
  if not stats then emit({ error = err }) return end
  local reverted = (mode == 'dig') and stats.dig_undesignated or stats.zones_removed
  emit({
    changes = { mode = mode, anchor = { x, y, z }, reverted = reverted },
    undo = {
      reversal = 'blueprint_apply',
      csv = csv,
      mode = mode,
      anchor = { x, y, z },
      faithful = true,
    },
    readback = readback(),
  })
  return
end

emit({ error = 'unknown subcommand: ' .. tostring(sub) })

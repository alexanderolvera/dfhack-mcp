local json = require('json')
local emit = reqscript('mcp_jsonOut').emit

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
local bp_path = a[7] or ''
local bp_label = a[8] or ''

local from_library = bp_path ~= ''

local SUPPORTED = { dig = true, zone = true }
local FOG_CAP = 64
local CONFLICT_CAP = 50
local MSG_CAP = 20
local MAX_FOOTPRINT = 10000
local MAX_CSV_BYTES = 65536

local function trim(s) return s:match('^%s*(.-)%s*$') end

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

local function new_acc()
  return { cells = {}, seen = {}, count = 0, err = nil }
end

local function acc_add(acc, cx, cy, cz)
  local k = cx .. ',' .. cy .. ',' .. cz
  if acc.seen[k] then return true end
  if acc.count >= MAX_FOOTPRINT then
    acc.err = 'blueprint footprint exceeds ' .. MAX_FOOTPRINT .. ' cells'
    return false
  end
  acc.seen[k] = true
  acc.count = acc.count + 1
  acc.cells[#acc.cells + 1] = { x = cx, y = cy, z = cz }
  return true
end

local function acc_place(acc, text, cx, cy, cz)
  local ew, eh = text:match('%((%d+)x(%d+)%)')
  ew, eh = tonumber(ew) or 1, tonumber(eh) or 1
  if ew * eh > MAX_FOOTPRINT then
    acc.err = 'cell expansion (' .. ew .. 'x' .. eh .. ') exceeds the max footprint of '
      .. MAX_FOOTPRINT .. ' cells'
    return false
  end
  for ey = 0, eh - 1 do
    for ex = 0, ew - 1 do
      if not acc_add(acc, cx + ex, cy + ey, cz) then return false end
    end
  end
  return true
end

local function csv_cells()
  local acc = new_acc()
  local datarow = -1
  local seen_modeline = false
  for line in (csv .. '\n'):gmatch('(.-)\n') do
    if acc.err then break end
    if not seen_modeline then
      if line:match('%S') then seen_modeline = true end
    else
      datarow = datarow + 1
      local col = 0
      for _, field in ipairs(csv_fields(line)) do
        local t = trim(field)
        if t ~= '' and not t:match('^#') then
          if not acc_place(acc, t, x + col, y + datarow, z) then break end
        end
        col = col + 1
      end
    end
  end
  return acc.cells, acc.err
end

local sections_cache, sections_err
local function library_sections()
  if sections_cache or sections_err then return sections_cache, sections_err end
  local quickfort_list = reqscript('internal/quickfort/list')
  local quickfort_parse = reqscript('internal/quickfort/parse')
  local filepath = quickfort_list.get_blueprint_filepath(bp_path)
  if not filepath or not dfhack.filesystem.exists(filepath) then
    sections_err = 'no blueprint file on disk for path "' .. bp_path
      .. '" (use blueprint_library() to list valid paths)'
    return nil, sections_err
  end
  local sheet_name, label =
    quickfort_parse.parse_section_name(bp_label ~= '' and bp_label or nil)
  local ok, res = pcall(quickfort_parse.process_section, filepath, sheet_name, label,
    xyz2pos(x, y, z), nil)
  if not ok then
    sections_err = 'cannot read blueprint "' .. bp_path .. '"'
      .. (bp_label ~= '' and (' -n ' .. bp_label) or '') .. ': ' .. tostring(res)
    return nil, sections_err
  end
  sections_cache = res
  return sections_cache
end

local function library_cells()
  local sections, err = library_sections()
  if not sections then return nil, err end
  local acc = new_acc()
  for _, section in ipairs(sections) do
    for gy, row in pairs(section.grid) do
      for gx, cell in pairs(row) do
        local t = trim(cell.text)
        if t ~= '' and not t:match('^#') then
          if not acc_place(acc, t, gx, gy, section.zlevel) then
            return acc.cells, acc.err
          end
        end
      end
    end
  end
  return acc.cells, acc.err
end

local cells_cache, cells_err
local function footprint_cells()
  if cells_cache or cells_err then return cells_cache or {}, cells_err end
  if x == nil or y == nil or z == nil then return {}, nil end
  local cells, err
  if from_library then
    cells, err = library_cells()
  else
    cells, err = csv_cells()
  end
  cells = cells or {}
  table.sort(cells, function(p, q)
    if p.z ~= q.z then return p.z < q.z end
    if p.y ~= q.y then return p.y < q.y end
    return p.x < q.x
  end)
  cells_cache, cells_err = cells, err
  return cells_cache, cells_err
end

local function source_id()
  if from_library then
    return dfhack.internal.md5(bp_path .. '\0' .. bp_label)
  end
  return dfhack.internal.md5(csv)
end

local function z_levels()
  local seen, levels = {}, {}
  for _, c in ipairs((footprint_cells())) do
    if not seen[c.z] then
      seen[c.z] = true
      levels[#levels + 1] = c.z
    end
  end
  table.sort(levels)
  return levels
end

local function validate_source()
  local blocked = {}
  if from_library and csv ~= '' then
    blocked[#blocked + 1] =
      'supply either csv or blueprint_path, not both (they are alternative sources for the same designation)'
    return blocked
  end
  if not from_library and csv == '' then
    blocked[#blocked + 1] =
      'no blueprint source: supply csv (an inline blueprint) or blueprint_path (a path from blueprint_library())'
    return blocked
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
  return blocked
end

local function validate_csv()
  local blocked = {}
  if #csv > MAX_CSV_BYTES then
    blocked[#blocked + 1] = string.format(
      'csv is %d bytes, over the %d-byte (64 KiB) limit', #csv, MAX_CSV_BYTES)
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
  return blocked
end

local function validate_library()
  local blocked = {}
  local sections, err = library_sections()
  if not sections then
    blocked[#blocked + 1] = err
    return blocked
  end
  if #sections == 0 then
    blocked[#blocked + 1] = 'blueprint "' .. bp_path .. '" has no data at that label'
    return blocked
  end
  local seen_modes = {}
  for _, section in ipairs(sections) do
    local m = section.modeline and section.modeline.mode
    if not seen_modes[m] then
      seen_modes[m] = true
      if not SUPPORTED[m] then
        blocked[#blocked + 1] = "blueprint mode '" .. tostring(m)
          .. "' is not supported in v1 (dig and zone only)"
      elseif SUPPORTED[mode] and m ~= mode then
        blocked[#blocked + 1] = "blueprint modeline '#" .. tostring(m)
          .. "' does not match mode '" .. tostring(mode) .. "'"
      end
    end
  end
  return blocked
end

local function validate()
  local blocked = validate_source()
  if #blocked > 0 then return blocked end
  blocked = from_library and validate_library() or validate_csv()
  if #blocked > 0 then return blocked end
  local _, ferr = footprint_cells()
  if ferr then blocked[#blocked + 1] = ferr end
  return blocked
end

local function scan_cells()
  local cells = footprint_cells()
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
  local function conflict(wx, wy, wz, reason)
    if #res.conflicts < CONFLICT_CAP then
      res.conflicts[#res.conflicts + 1] = { x = wx, y = wy, z = wz, reason = reason }
    else
      res.conflicts_truncated = true
    end
  end
  for _, c in ipairs(cells) do
    local wx, wy, wz = c.x, c.y, c.z
    local state, hidden = 'oob', 'oob'
    if wx < 0 or wy < 0 or wz < 0
      or wx >= map.x_count or wy >= map.y_count or wz >= map.z_count then
      res.clipped = res.clipped + 1
      conflict(wx, wy, wz, 'out of bounds')
    else
      local blk = dfhack.maps.getTileBlock(wx, wy, wz)
      local d = blk and blk.designation[wx % 16][wy % 16]
      hidden = (d and d.hidden) and 1 or 0
      if hidden == 1 then
        res.fog = res.fog + 1
        if #res.fog_sample < FOG_CAP then
          res.fog_sample[#res.fog_sample + 1] = { x = wx, y = wy, z = wz }
        end
      end
      if mode == 'dig' then
        state = d and d.dig or 'none'
        if d and d.dig ~= 0 then
          res.pre_existing = res.pre_existing + 1
          conflict(wx, wy, wz, 'already designated')
        end
        if dfhack.buildings.findAtTile(xyz2pos(wx, wy, wz)) then
          conflict(wx, wy, wz, 'building present')
        end
      else
        local ids = {}
        local czs = dfhack.buildings.findCivzonesAt(xyz2pos(wx, wy, wz))
        if czs then
          for _, cz in ipairs(czs) do ids[#ids + 1] = cz.id end
        end
        table.sort(ids)
        state = (#ids > 0) and table.concat(ids, '+') or 'none'
        if #ids > 0 then
          res.pre_existing = res.pre_existing + 1
          conflict(wx, wy, wz, 'zone present')
        end
      end
    end
    parts[#parts + 1] =
      string.format('%d,%d,%d,%s,%s', wx, wy, wz, tostring(state), tostring(hidden))
  end
  table.sort(parts)
  res.digest = dfhack.internal.md5(table.concat(parts, ';'))
  return res
end

local function readback()
  local cells = footprint_cells()
  local set = 0
  for _, c in ipairs(cells) do
    if mode == 'dig' then
      local blk = dfhack.maps.getTileBlock(c.x, c.y, c.z)
      if blk and blk.designation[c.x % 16][c.y % 16].dig ~= 0 then set = set + 1 end
    else
      local cz = dfhack.buildings.findCivzonesAt(xyz2pos(c.x, c.y, c.z))
      if cz and #cz > 0 then set = set + 1 end
    end
  end
  return { mode = mode, footprint_cells = #cells, designated_tiles = set }
end

local function source_handle()
  if from_library then
    return {
      blueprint_path = bp_path,
      blueprint_label = (bp_label ~= '') and bp_label or nil,
    }
  end
  return { csv = csv }
end

local function undo_handle(pre_existing)
  local h = {
    reversal = 'blueprint_undo',
    mode = mode,
    anchor = { x, y, z },
    faithful = pre_existing == 0,
  }
  for k, v in pairs(source_handle()) do h[k] = v end
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
  local coord = string.format('%d,%d,%d', x, y, z)
  local args, temp_path
  if from_library then
    args = { 'quickfort', command, bp_path }
    if bp_label ~= '' then
      args[#args + 1] = '-n'
      args[#args + 1] = bp_label
    end
  else
    local name, path, werr = write_temp()
    if not name then return nil, werr end
    temp_path = path
    args = { 'quickfort', command, name }
  end
  args[#args + 1] = '-c'
  args[#args + 1] = coord
  if dry then args[#args + 1] = '--dry-run' end
  local ok, out = pcall(dfhack.run_command_silent, args)
  if temp_path then os.remove(temp_path) end
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

local function attach_source(t)
  t.source = from_library and 'library' or 'inline_csv'
  if from_library then
    t.blueprint_path = bp_path
    t.blueprint_label = (bp_label ~= '') and bp_label or nil
    local levels = z_levels()
    t.z_levels = levels
    t.z_levels_spanned = #levels
  end
  return t
end

if sub == 'plan_apply' or sub == 'apply_apply' then
  local blocked = validate()
  if #blocked > 0 then emit({ blocked = blocked }) return end

  if sub == 'plan_apply' then
    local scan = scan_cells()
    local stats, err = run_qf('run', true)
    if not stats then emit({ blocked = { err } }) return end
    local tiles = (mode == 'dig') and stats.dig_designated or stats.zone_designated
    local preview = attach_source({
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
    })
    attach_parse_errors(preview, stats)
    local signature = string.format('apply/%s/%d,%d,%d/%s/t=%d/cn=%d/ik=%d/cells=%s',
      mode, x, y, z, source_id(), tiles, stats.could_not, stats.invalid_keys, scan.digest)
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
    changes = attach_source({
      mode = mode,
      anchor = { x, y, z },
      tiles_affected = tiles,
      invalid_key_sequences = stats.invalid_keys,
      could_not_designate = stats.could_not,
    }),
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
    local preview = attach_source({
      mode = mode,
      anchor = { x, y, z },
      footprint_cells = rb.footprint_cells,
      currently_designated = rb.designated_tiles,
    })
    attach_parse_errors(preview, stats)
    local signature = string.format('undo/%s/%d,%d,%d/%s/set=%d/cells=%s',
      mode, x, y, z, source_id(), rb.designated_tiles, scan.digest)
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
  local undo = {
    reversal = 'blueprint_apply',
    mode = mode,
    anchor = { x, y, z },
    faithful = true,
  }
  for k, v in pairs(source_handle()) do undo[k] = v end
  emit({
    changes = attach_source({ mode = mode, anchor = { x, y, z }, reverted = reverted }),
    undo = undo,
    readback = readback(),
  })
  return
end

emit({ error = 'unknown subcommand: ' .. tostring(sub) })

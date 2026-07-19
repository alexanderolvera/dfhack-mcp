-- mcp_blueprint: A2 actuator — quickfort blueprint designations. Backs two gated
-- MCP tools:
--   blueprint_apply   ("plan_apply" / "apply_apply")
--   blueprint_undo    ("plan_undo"  / "apply_undo")
--
-- EXECUTE, NEVER DECIDE: the caller drafts the quickfort CSV, names the anchor and
-- the mode; this script designates exactly that and reports facts. No "you should
-- dig here" logic. The §A0 dry-run/confirm/undo loop lives in TS (src/actuator.ts);
-- this script answers plan_* (preview + signature, no mutation) and apply_* (mutate
-- + readback). Version-fragile struct access (tile designation flags, civzones)
-- stays here.
--
-- v1 scope: dig + zone only. build/place are rejected (blocked, no token) so nothing
-- partially applies. Quickfort is driven over RPC at EXPLICIT coords (no cursor):
-- the CSV is written to a UNIQUE temp file in the blueprints dir, run by basename
-- with `-c x,y,z`, then removed. The MALFORMED-CSV gate (spike #11): quickfort does
-- NOT error on a bad blueprint — it PARTIALLY applies and reports "Invalid key
-- sequences" / "could not be designated". So BOTH plan_apply and plan_undo run a
-- --dry-run (verified live: `quickfort undo ... --dry-run` completes without
-- mutating and reports the same stats), parse those stats, and BLOCK (no
-- confirm_token) when either is > 0. Per-cell diagnostic lines (e.g. `invalid key
-- sequence: "ZZZ" in cell B2`) are captured (bounded) as parse_errors so the
-- caller can locate the bad cell.
--
-- Invoked by name via DFHack RunCommand; args arrive UNESCAPED as `...` (multi-line
-- CSV survives intact — verified live). Prints ONE JSON object.

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
local FOG_CAP = 64 -- bounded fog-of-war sample list
local CONFLICT_CAP = 50 -- bounded conflicts list
local MSG_CAP = 20 -- bounded quickfort diagnostic-line capture
local MAX_FOOTPRINT = 10000 -- distinct-cell cap; a (WxH) bomb blocks, never expands
-- Distinct BYTE cap on the raw CSV. The footprint cap bounds occupied CELLS, but
-- blank/comment bytes add zero cells while still being written to the temp
-- blueprint file AND echoed verbatim into the preview/undo handle (memory + disk).
-- So an all-blank 100 KB CSV clears MAX_FOOTPRINT yet is unbounded payload. 64 KiB
-- is far above any legitimate hand-drafted blueprint; over it blocks (no token) in
-- validate(), shared by both blueprint_apply and blueprint_undo.
local MAX_CSV_BYTES = 65536

-- ---- footprint parsing ----------------------------------------------------
-- Quote-aware CSV field split (RFC-4180-ish): spreadsheet-exported blueprints
-- quote cells with embedded commas ("#comment, note") and escape quotes by
-- doubling (""). Verified live: quickfort itself unquotes — `d,"#comment, x",d`
-- is a 3-cell row (footprint 2) — so a naive comma split would mis-place columns
-- and skew footprint/fog/readback/signature.
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

-- The occupied cells of the blueprint as distinct {dx,dy} offsets from the anchor.
-- The modeline is row -1; the first data row (directly below it) maps to the anchor
-- (verified live: `#dig`/`d,d` at -c X,Y,Z designates X,Y and X+1,Y). Blank cells
-- and comment (`#...`) cells are not occupied. Quickfort's (WxH) area-expansion
-- suffix is expanded down-and-right from the marked cell (verified: `n(2x2)` at
-- 84,40 covers 84-85,40-41), so the footprint matches what quickfort designates;
-- overlapping cells are de-duplicated so counts never double-report a tile.
--
-- Bounded: expansion happens BEFORE quickfort runs, so a hostile `d(9999x9999)`
-- cell would otherwise loop ~10^8 times here. Any single (WxH) whose area exceeds
-- MAX_FOOTPRINT, or a total distinct footprint past it, aborts with `err` set —
-- validate() turns that into a block (no token). Returns cells, err.
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

-- ---- validation (shared by every subcommand) ------------------------------
-- The mode arg is authoritative and must be dig|zone; the CSV's first non-blank
-- line must be a matching #dig / #zone modeline. A missing/malformed/mismatched
-- modeline is blocked here so quickfort's silent "bad modeline defaults to #dig"
-- behavior can never mis-designate. An over-budget footprint (see occupied_cells)
-- blocks here too, before any per-cell scan or quickfort run.
local function validate()
  local blocked = {}
  -- Byte cap first: cheapest gate, and it bounds the payload (temp file + echoed
  -- handle) that the footprint cap alone leaves unbounded for blank/comment bytes.
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

-- ---- per-cell live-state scan ----------------------------------------------
-- ONE pass over the footprint feeding both the preview facts and the signature:
--   fog        fog-of-war count + bounded sample (a FACT, never a block — the
--              agent may intend to designate into the dark)
--   pre_existing  cells ALREADY carrying this mode's designation (dig flag set /
--              civzone present) BEFORE this operation — quickfort's undo removes
--              designations on affected tiles regardless of who created them
--              (verified live: a manually-designated tile under the footprint is
--              cleared by undo), so this count drives faithful:false on the undo
--              handle
--   clipped / conflicts  bounded structured conflict list [{x,y,reason}] with
--              reasons 'out of bounds' | 'already designated' | 'zone present' |
--              'building present' (dig only; dfhack.buildings.findAtTile is
--              OOB-safe — verified live)
--   digest     md5 over the SORTED per-cell "x,y,state,hidden" lines, where state
--              is the dig designation value (dig mode) or the sorted civzone id
--              list (zone mode). Aggregate counts alone can stay equal while the
--              underlying cells drift (two offsetting per-tile changes), so the
--              signature carries this per-cell digest.
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

-- Readback: how many occupied cells currently carry the designation for this mode.
-- dig -> designation.dig set; zone -> a civzone covers the tile. Also the
-- BEFORE-apply pre-existing count (same question asked at a different moment).
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

-- The undo handle for apply_apply: quickfort's native `undo` faithfully reverts
-- dig/zone designations THIS apply created (verified live: dig flag
-- 0->apply->1->undo->0; zone 0->4->0) — but it clears the designation on EVERY
-- footprint tile, including ones the player had designated before this apply
-- (verified live). So faithful is true ONLY when no footprint tile carried a
-- pre-existing designation; otherwise not_reproduced names the loss as a fact
-- (mirrors the work-order faithful pattern).
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

-- ---- quickfort driver ------------------------------------------------------
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

-- Run quickfort by temp-file basename at explicit coords; parse the printed stats.
-- Returns the parsed stat table (or nil + message). Always removes the temp file.
-- Diagnostic lines (everything quickfort prints BEFORE its "successfully
-- completed" marker, e.g. `invalid key sequence: "ZZZ" in cell B2`) are captured
-- bounded as `messages` so previews can locate the offending cell.
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

-- MALFORMED / partial-apply gate shared by plan_apply and plan_undo: reasons
-- when the dry-run reports invalid keys or undesignatable tiles (spike #11 —
-- quickfort would PARTIALLY apply/undo otherwise).
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

-- Attach the bounded quickfort diagnostic lines to a preview (omitted when clean).
local function attach_parse_errors(preview, stats)
  if #stats.messages > 0 then
    preview.parse_errors = stats.messages
    preview.parse_errors_truncated = stats.messages_truncated or nil
  end
end

-- ============================ apply ============================
if sub == 'plan_apply' or sub == 'apply_apply' then
  local blocked = validate()
  if #blocked > 0 then emit({ blocked = blocked }) return end

  -- --------- plan_apply: dry-run, parse stats, gate, preview + signature -----
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
    -- Signature = target state: csv digest + anchor + mode + the dry-run stats +
    -- the PER-CELL state digest (aggregate counts alone can stay equal while
    -- individual tiles drift — e.g. one tile designated while another is
    -- revealed — so the digest is what actually voids a stale token).
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

  -- --------- apply_apply: real run, changes + undo handle + readback ---------
  -- Pre-existing designations are counted BEFORE mutating: they decide whether
  -- the undo handle is faithful (undo would clear them too — see undo_handle).
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

-- ============================ undo ============================
if sub == 'plan_undo' or sub == 'apply_undo' then
  local blocked = validate()
  if #blocked > 0 then emit({ blocked = blocked }) return end

  -- --------- plan_undo: read state + VALIDATED dry-run (no mutation) ---------
  -- `quickfort undo --dry-run` completes without touching designations and
  -- reports the same "Invalid key sequences" stat (verified live), so a
  -- malformed CSV with a valid modeline is gated here exactly like plan_apply —
  -- otherwise apply_undo could partially revert.
  if sub == 'plan_undo' then
    local rb = readback() -- designated_tiles = what undo would clear right now
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
    -- Signature = per-cell designation/zone identity + state (the digest), not
    -- just the aggregate count: designating one tile while clearing another
    -- leaves set=N unchanged but MUST void the token.
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

  -- --------- apply_undo: real undo, changes + re-apply handle + readback -----
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
    readback = readback(), -- designated_tiles should now be 0
  })
  return
end

emit({ error = 'unknown subcommand: ' .. tostring(sub) })

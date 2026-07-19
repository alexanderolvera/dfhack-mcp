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
-- sequences" / "could not be designated". So blueprint_apply's preview runs a
-- --dry-run, parses those stats, and BLOCKS (no confirm_token) when either is > 0.
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

-- ---- validation (shared by every subcommand) ------------------------------
-- The mode arg is authoritative and must be dig|zone; the CSV's first non-blank
-- line must be a matching #dig / #zone modeline. A missing/malformed/mismatched
-- modeline is blocked here so quickfort's silent "bad modeline defaults to #dig"
-- behavior can never mis-designate.
local function validate()
  local blocked = {}
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
  return blocked
end

-- ---- footprint parsing ----------------------------------------------------
-- The occupied cells of the blueprint as distinct {dx,dy} offsets from the anchor.
-- The modeline is row -1; the first data row (directly below it) maps to the anchor
-- (verified live: `#dig`/`d,d` at -c X,Y,Z designates X,Y and X+1,Y). Blank cells
-- and comment (`#...`) cells are not occupied. Quickfort's (WxH) area-expansion
-- suffix is expanded down-and-right from the marked cell (verified: `n(2x2)` at
-- 84,40 covers 84-85,40-41), so the footprint matches what quickfort designates;
-- overlapping cells are de-duplicated so counts never double-report a tile.
local function occupied_cells()
  local cells, seen = {}, {}
  local function add(dx, dy)
    local k = dx .. ',' .. dy
    if not seen[k] then seen[k] = true cells[#cells + 1] = { dx = dx, dy = dy } end
  end
  local datarow = -1
  local seen_modeline = false
  for line in (csv .. '\n'):gmatch('(.-)\n') do
    if not seen_modeline then
      if line:match('%S') then seen_modeline = true end
    else
      datarow = datarow + 1
      local col = 0
      for field in (line .. ','):gmatch('(.-),') do
        local t = field:match('^%s*(.-)%s*$')
        if t ~= '' and not t:match('^#') then
          local ew, eh = t:match('%((%d+)x(%d+)%)')
          ew, eh = tonumber(ew) or 1, tonumber(eh) or 1
          for ey = 0, eh - 1 do
            for ex = 0, ew - 1 do add(col + ex, datarow + ey) end
          end
        end
        col = col + 1
      end
    end
  end
  return cells
end

-- Fog of war over the footprint: count (and sample) occupied cells that land on an
-- UNDISCOVERED tile. Reported as a FACT — never a block (the agent may intend it).
local function fog_scan()
  local cells = occupied_cells()
  local hidden_n, sample = 0, {}
  for _, c in ipairs(cells) do
    local wx, wy = x + c.dx, y + c.dy
    local blk = dfhack.maps.getTileBlock(wx, wy, z)
    if blk and blk.designation[wx % 16][wy % 16].hidden then
      hidden_n = hidden_n + 1
      if #sample < FOG_CAP then sample[#sample + 1] = { x = wx, y = wy } end
    end
  end
  return #cells, hidden_n, sample
end

-- Readback: how many occupied cells currently carry the designation for this mode.
-- dig -> designation.dig set; zone -> a civzone covers the tile.
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
  return {
    output = out,
    dig_designated = num_after(out, 'Tiles designated for digging:%s*(%d+)'),
    dig_undesignated = num_after(out, 'Tiles undesignated for digging:%s*(%d+)'),
    zone_designated = num_after(out, 'Zone tiles designated:%s*(%d+)'),
    zones_removed = num_after(out, 'Zones removed:%s*(%d+)'),
    could_not = num_after(out, 'could not be designated[^:\n]*:%s*(%d+)'),
    invalid_keys = num_after(out, 'Invalid key sequences:%s*(%d+)'),
  }
end

-- Compact, stable target signature. Captures EVERYTHING the preview shows (csv
-- digest + anchor + mode + the dry-run tile set + fog count), so any change to the
-- previewed target — a tile revealed/dug, the blueprint edited — voids the token.
local function md5(str)
  return dfhack.internal.md5(str)
end

-- ============================ apply ============================
if sub == 'plan_apply' or sub == 'apply_apply' then
  local blocked = validate()
  if #blocked > 0 then emit({ blocked = blocked }) return end

  -- --------- plan_apply: dry-run, parse stats, gate, preview + signature -----
  if sub == 'plan_apply' then
    local footprint_cells, fog_n, fog_sample = fog_scan()
    local stats, err = run_qf('run', true)
    if not stats then emit({ blocked = { err } }) return end
    local tiles = (mode == 'dig') and stats.dig_designated or stats.zone_designated
    local preview = {
      mode = mode,
      anchor = { x, y, z },
      tiles_affected = tiles,
      invalid_key_sequences = stats.invalid_keys,
      could_not_designate = stats.could_not,
      footprint_cells = footprint_cells,
      fog_of_war_tiles = fog_n,
      fog_of_war_sample = (#fog_sample > 0) and fog_sample or nil,
      fog_of_war_truncated = (fog_n > #fog_sample) or nil,
    }
    local signature = string.format('apply/%s/%d,%d,%d/%s/t=%d/cn=%d/ik=%d/fog=%d',
      mode, x, y, z, md5(csv), tiles, stats.could_not, stats.invalid_keys, fog_n)
    -- MALFORMED / partial-apply gate: no confirm_token when the dry-run reports
    -- invalid keys or undesignatable tiles (spike #11 — quickfort would PARTIALLY
    -- apply otherwise).
    local gate = {}
    if stats.invalid_keys > 0 then
      gate[#gate + 1] = stats.invalid_keys .. ' invalid key sequence(s) in the blueprint'
    end
    if stats.could_not > 0 then
      gate[#gate + 1] = stats.could_not .. ' tile(s) could not be designated at this anchor'
    end
    if #gate > 0 then
      emit({ blocked = gate, preview = preview, signature = signature })
      return
    end
    emit({ preview = preview, signature = signature, noop = (tiles == 0) or nil })
    return
  end

  -- --------- apply_apply: real run, changes + undo handle + readback ---------
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
    -- quickfort's native `undo` faithfully reverts dig/zone designations (verified
    -- live: dig flag 0->apply->1->undo->0; zone 0->4->0). No known dig/zone case it
    -- cannot reverse, so faithful:true with no not_reproduced.
    undo = {
      reversal = 'blueprint_undo',
      csv = csv,
      mode = mode,
      anchor = { x, y, z },
      faithful = true,
    },
    readback = readback(),
  })
  return
end

-- ============================ undo ============================
if sub == 'plan_undo' or sub == 'apply_undo' then
  local blocked = validate()
  if #blocked > 0 then emit({ blocked = blocked }) return end

  -- --------- plan_undo: describe what undo would revert (read state, no run) --
  if sub == 'plan_undo' then
    local rb = readback() -- designated_tiles = what undo would clear right now
    local signature = string.format('undo/%s/%d,%d,%d/%s/set=%d',
      mode, x, y, z, md5(csv), rb.designated_tiles)
    emit({
      preview = {
        mode = mode,
        anchor = { x, y, z },
        footprint_cells = rb.footprint_cells,
        currently_designated = rb.designated_tiles,
      },
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

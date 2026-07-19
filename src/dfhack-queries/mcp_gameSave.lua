-- mcp_gameSave: A4 actuator — checkpoint the fort with a quicksave. Backs one tool:
--   game_save   (gated actuator; subcommands "plan" preview / "apply" trigger)
--
-- EXECUTE, NEVER DECIDE: the caller asks to save; this script triggers a save and
-- reports facts — no "you should save now" logic. The §A0 dry-run/confirm loop lives
-- in TS (src/actuator.ts); this script answers plan (preview + a CONSTANT signature)
-- and apply (trigger + readback).
--
-- Departures from the other actuators, surfaced as facts (all verified live on
-- 53.15 against a Dreamfort container):
--   * The save is ASYNCHRONOUS. `quicksave` requests DF's autosave; DF writes the
--     save over the NEXT FEW FRAMES. apply() can confirm the quicksave command was
--     DISPATCHED (command_result), NOT that the file has landed — that's async.
--   * It routes through DF's AUTOSAVE: the write lands in a rotating "autosave N"
--     folder governed by the player's DF autosave settings — it does NOT overwrite
--     the loaded region save. So we report the game DATE being frozen (reliable),
--     never an authoritative destination folder (cur_savegame.save_dir lags a save
--     behind and is config-dependent — reporting it would mislead).
--   * IRREVERSIBLE: once written, a save can't be un-written from here; roll back by
--     loading the appropriate save/autosave in DF.
-- We DELEGATE to the stock, maintained `quicksave` script (via run_command_silent, so
-- its print stays out of our JSON stdout) instead of poking the version-fragile
-- save_progress.* fields ourselves — a field rename is then DFHack's problem, not ours.
-- (Stock quicksave defers the actual autosave_request set to a next-frame overlay
-- render, so reading that flag synchronously here would always see false — we don't.)
--
-- Invoked by name via DFHack RunCommand with a subcommand as arg 1; prints ONE JSON.

local json = require('json')
local function emit(t) print(json.encode(t)) end

-- quicksave itself only runs in fortress mode with a loaded map; mirror the codebase
-- no-fort guard so game_save honors the same contract as every other tool.
if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local a = { ... }
local sub = a[1]

-- ---- shared facts: what a save would freeze --------------------------------
local months = {'Granite','Slate','Felsite','Hematite','Malachite','Galena',
                'Limestone','Sandstone','Timber','Moonstone','Opal','Obsidian'}
local seasons = {'Spring','Summer','Autumn','Winter'}

local function game_date()
  local tick = df.global.cur_year_tick
  local midx = math.floor(tick / 33600)
  local day = math.floor((tick % 33600) / 1200) + 1
  return {
    year = df.global.cur_year,
    year_tick = tick,
    month = months[midx + 1],
    season = seasons[math.floor(midx / 3) + 1],
    day = day,
  }
end

-- fort_name + game_date identify WHAT is being frozen — the reliable facts. We do
-- NOT report a destination folder: DF's autosave picks a rotating "autosave N" dir
-- per the player's settings, and cur_savegame.save_dir lags a save behind, so any
-- folder we named would mislead. fort_name is pcall'd (the JSON encoder can't emit
-- null, so an unavailable field is simply omitted).
local function save_facts()
  local ok_name, fname = pcall(function()
    return dfhack.translation.translateName(df.global.world.world_data.active_site[0].name, true)
  end)
  return {
    fort_name = (ok_name and fname ~= '') and fname or nil,
    method = 'quicksave',
    game_date = game_date(),
  }
end

-- ============================ plan ============================
if sub == 'plan' then
  local preview = save_facts()
  -- Facts the agent needs to understand what confirming does.
  preview.reversible = false
  preview.effect = 'triggers DFHack quicksave; DF writes a save asynchronously (over the next few frames) '
    .. 'via its autosave — the destination follows your DF autosave settings, typically a rotating "autosave" '
    .. 'folder rather than an overwrite of the loaded save'
  emit({
    preview = preview,
    -- CONSTANT signature: a save always freezes the CURRENT state, whatever it is, so
    -- no sub-target exists whose drift should void the confirm token (contrast the
    -- work-order / blueprint signatures, which sign their specific target). Single-use
    -- is the only guard that applies here.
    signature = 'game_save',
  })
  return
end

-- ============================ apply ============================
if sub == 'apply' then
  local facts = save_facts()
  -- Delegate to the stock quicksave script. run_command_silent returns (output,
  -- command_result); it keeps quicksave's 'The game should autosave now.' print out
  -- of our stdout. quicksave requests DF's autosave; DF performs the write on later
  -- frames (verified live: the save lands in a rotating "autosave N" folder).
  local out, rc = dfhack.run_command_silent('quicksave')
  if rc ~= 0 then
    emit({ error = 'quicksave failed (command_result ' .. tostring(rc) .. '): ' .. tostring(out) })
    return
  end
  emit({
    changes = {
      save_requested = true,
      method = 'quicksave',
      game_date = facts.game_date,
    },
    undo = {
      reversible = false,
      note = 'no undo — once written, the save persists. To roll back, load the appropriate save/autosave from before this call in DF',
    },
    -- Readback confirms the quicksave command was DISPATCHED (command_result 0 =
    -- CR_OK). It does NOT and CANNOT confirm the file finished writing — DF commits
    -- the save asynchronously over the next few frames.
    readback = {
      dispatched = rc == 0,
      command_result = rc,
      write = 'asynchronous — DF commits the save over the next few frames via its autosave; this call cannot confirm the file has landed',
      game_date = facts.game_date,
    },
  })
  return
end

emit({ error = 'unknown subcommand: ' .. tostring(sub) })

local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local a = { ... }
local sub = a[1]

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

if sub == 'plan' then
  local preview = save_facts()
  preview.reversible = false
  preview.effect = 'triggers DFHack quicksave; DF writes a save asynchronously (over the next few frames) '
    .. 'via its autosave — the destination follows your DF autosave settings, typically a rotating "autosave" '
    .. 'folder rather than an overwrite of the loaded save'
  emit({
    preview = preview,
    signature = 'game_save',
  })
  return
end

if sub == 'apply' then
  local facts = save_facts()
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

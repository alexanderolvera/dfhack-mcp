local emit = reqscript('mcp_jsonOut').emit

local world_loaded = dfhack.isWorldLoaded()
local map_loaded = dfhack.isMapLoaded()
local gamemode = df.global.gamemode

local function current_mode()
  if not world_loaded then
    local focus = dfhack.gui.getCurFocus(true)[1] or ''
    return focus:find('^title') and 'title' or 'other'
  end
  if map_loaded and gamemode == df.game_mode.DWARF then return 'fortress' end
  if map_loaded and gamemode == df.game_mode.ADVENTURE then return 'adventure' end
  return 'other'
end

local mode = current_mode()

local state = {
  dfhack_version = dfhack.getDFHackVersion(),
  df_version = dfhack.getDFVersion(),
  mode = mode,
  world_loaded = world_loaded,
  map_loaded = map_loaded,
}
if world_loaded then
  state.paused = df.global.pause_state
  state.clock = reqscript('mcp_gameDate').current()
  state.identity = reqscript('mcp_identity').read(mode == 'fortress')
end

emit(state)

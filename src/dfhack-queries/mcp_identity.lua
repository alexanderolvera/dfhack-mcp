--@ module = true
-- mcp_identity: see docs/tools/game_state.md "Implementation notes".

local function name_pair(name)
  if not name then return nil end
  local ok_dw, dwarven = pcall(dfhack.translation.translateName, name, false)
  local ok_en, english = pcall(dfhack.translation.translateName, name, true)
  return { dwarven = ok_dw and dwarven or nil, english = ok_en and english or nil }
end

local function fort_fields(out)
  local site_id = df.global.plotinfo.site_id
  local civ_id = df.global.plotinfo.civ_id
  local site = df.world_site.find(site_id)
  local civ = df.historical_entity.find(civ_id)
  out.site_id = site_id
  out.site_name = site and name_pair(site.name) or nil
  out.civ_id = civ_id
  out.civ_name = civ and name_pair(civ.name) or nil
end

function read(fortress)
  local wd = df.global.world.world_data
  local out = {
    world_name = wd and name_pair(wd.name) or nil,
    save_folder = df.global.world.cur_savegame.save_dir,
  }
  if fortress then fort_fields(out) end
  return out
end

if dfhack_flags and dfhack_flags.module then
  return
end

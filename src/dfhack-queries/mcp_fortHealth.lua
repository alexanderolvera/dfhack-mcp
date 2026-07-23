local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local T = df.item_type
local CORPSE_TYPES = { [T.CORPSE] = true, [T.CORPSEPIECE] = true, [T.REMAINS] = true }
local CLOTHES_TYPES = { [T.ARMOR] = true, [T.SHOES] = true, [T.HELM] = true, [T.GLOVES] = true, [T.PANTS] = true }

local items_total, stone, corpses, clothes = 0, 0, 0, 0
for _, item in ipairs(df.global.world.items.all) do
  items_total = items_total + 1
  local ty = item:getType()
  if ty == T.BOULDER then
    stone = stone + 1
  elseif CORPSE_TYPES[ty] then
    corpses = corpses + 1
  elseif CLOTHES_TYPES[ty] then
    clothes = clothes + 1
  end
end

local units_active, units_dead_on_map = 0, 0
for _, u in ipairs(df.global.world.units.active) do
  if dfhack.units.isActive(u) then
    if dfhack.units.isDead(u) then
      units_dead_on_map = units_dead_on_map + 1
    else
      units_active = units_active + 1
    end
  end
end

emit({
  fps = df.global.enabler.calculated_fps,
  gfps = df.global.enabler.calculated_gfps,
  items = {
    total = items_total,
    stone = stone,
    corpses = corpses,
    clothes = clothes,
  },
  units = {
    active = units_active,
    dead_on_map = units_dead_on_map,
  },
})

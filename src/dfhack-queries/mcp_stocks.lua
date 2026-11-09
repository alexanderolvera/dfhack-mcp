local json = require('json')
local emit = reqscript('mcp_jsonOut').emit

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local T = df.item_type

local function isItemTypeToken(token)
  local idx = T[token]
  return type(idx) == 'number' and idx >= 0 and T[idx] == token
end

local category = ({ ... })[1]
if category == '' then category = nil end
if category then
  category = category:upper()
  if not isItemTypeToken(category) then
    emit({ error = "unknown item type '" .. category .. "' (expected a df.item_type token, e.g. DRINK or BAR)" })
    return
  end
end

local inventory = {}
for i = 0, T._last_item do
  if not category or T[i] == category then inventory[T[i]] = 0 end
end

local edible = {
  [T.FOOD] = true, [T.MEAT] = true, [T.FISH] = true, [T.CHEESE] = true,
  [T.EGG] = true, [T.PLANT] = true, [T.PLANT_GROWTH] = true,
}

local c = { food = 0, prepared_meals = 0, drink = 0, wood = 0, fuel = 0,
            cloth = 0, tanned_hides = 0, stone = 0 }

for _, item in ipairs(df.global.world.items.other.IN_PLAY) do
  local fl = item.flags
  if not (fl.rotten or fl.dump or fl.forbid or fl.construction or fl.trader or fl.garbage_collect) then
    local ty = item:getType()
    local n = item:getStackSize()
    local token = T[ty]
    if inventory[token] then inventory[token] = inventory[token] + n end
    if edible[ty] then
      c.food = c.food + n
      if ty == T.FOOD then c.prepared_meals = c.prepared_meals + n end
    elseif ty == T.DRINK then c.drink = c.drink + n
    elseif ty == T.WOOD then c.wood = c.wood + n
    elseif ty == T.CLOTH then c.cloth = c.cloth + n
    elseif ty == T.SKIN_TANNED then c.tanned_hides = c.tanned_hides + n
    elseif ty == T.BOULDER then c.stone = c.stone + n
    elseif ty == T.BAR and item:getMaterial() == df.builtin_mats.COAL then
      c.fuel = c.fuel + n
    end
  end
end

local WORN_WEAR_THRESHOLD = 2
local WORN_CAP = 50
local WORN_SLOT = { SHOES = true, ARMOR = true, PANTS = true, GLOVES = true, HELM = true }
local worn, no_shoes_count = {}, 0
for _, u in ipairs(dfhack.units.getCitizens(true)) do
  local has_shoes, max_wear = false, 0
  for _, inv in ipairs(u.inventory) do
    if inv.mode == 2 and WORN_SLOT[T[inv.item:getType()]] then
      local w = inv.item.wear or 0
      if w > max_wear then max_wear = w end
      if T[inv.item:getType()] == 'SHOES' then has_shoes = true end
    end
  end
  if not has_shoes then no_shoes_count = no_shoes_count + 1 end
  if max_wear >= WORN_WEAR_THRESHOLD then
    worn[#worn + 1] = { unit_id = u.id, name = dfhack.units.getReadableName(u) }
  end
end
table.sort(worn, function(a, b) return a.unit_id < b.unit_id end)
local worn_truncated = false
if #worn > WORN_CAP then
  local capped = {}
  for i = 1, WORN_CAP do capped[i] = worn[i] end
  worn = capped
  worn_truncated = true
end

local pop = #dfhack.units.getCitizens(true)

emit({
  population = pop,
  counts = c,
  inventory = inventory,
  clothing = {
    worn_citizens = worn,
    worn_citizens_truncated = worn_truncated,
    no_shoes_count = no_shoes_count,
  },
})

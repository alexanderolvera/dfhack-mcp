local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local SEASON_DAYS = 84
local FOOD_PER_SEASON, DRINK_PER_SEASON = 2, 5
local LOW_DAYS = 14
local LOW_FUEL, LOW_WOOD, LOW_CLOTH = 5, 20, 10
local HIGH_STONE = 500

local T = df.item_type
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

local TATTERED_WEAR = 2
local TATTERED_CAP = 50
local WORN_SLOT = { SHOES = true, ARMOR = true, PANTS = true, GLOVES = true, HELM = true }
local tattered, no_shoes_count = {}, 0
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
  if max_wear >= TATTERED_WEAR then
    tattered[#tattered + 1] = { unit_id = u.id, name = dfhack.units.getReadableName(u) }
  end
end
table.sort(tattered, function(a, b) return a.unit_id < b.unit_id end)
local tattered_truncated = false
if #tattered > TATTERED_CAP then
  local capped = {}
  for i = 1, TATTERED_CAP do capped[i] = tattered[i] end
  tattered = capped
  tattered_truncated = true
end

local pop = #dfhack.units.getCitizens(true)
local function days(total, per) return pop > 0 and math.floor(total * SEASON_DAYS / (pop * per)) or -1 end
local food_days = days(c.food, FOOD_PER_SEASON)
local drink_days = days(c.drink, DRINK_PER_SEASON)

local low, high = {}, {}
if food_days >= 0 and food_days < LOW_DAYS then low[#low+1] = 'food' end
if drink_days >= 0 and drink_days < LOW_DAYS then low[#low+1] = 'drink' end
if c.fuel < LOW_FUEL then low[#low+1] = 'fuel' end
if c.wood < LOW_WOOD then low[#low+1] = 'wood' end
if c.cloth < LOW_CLOTH then low[#low+1] = 'cloth' end
if c.stone > HIGH_STONE then high[#high+1] = 'stone' end

emit({
  population  = pop,
  food_days   = food_days,
  drink_days  = drink_days,
  notable_low = low,
  notable_high = high,
  counts = c,
  clothing = {
    tattered_citizens = tattered,
    tattered_citizens_truncated = tattered_truncated,
    no_shoes_count = no_shoes_count,
  },
})

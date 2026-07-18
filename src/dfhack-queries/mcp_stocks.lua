-- mcp_stocks: food/drink as days-of-supply plus a few critical materials.
--
-- Item counting follows DFHack's own dfstatus (iterate world.items.other.IN_PLAY,
-- skip rotten/dump/forbid/construction/trader, sum stack sizes by type) but
-- counts ALL edible food, not just prepared meals, and derives days-of-supply.
--
-- Consumption rate (DF wiki, DF2014 Food): a dwarf eats ~2 food and drinks ~5
-- units per season; a season is 3 months x 28 days = 84 ticks-days. So
--   food_days  = food_total  * 84 / (pop * 2)
--   drink_days = drink_total * 84 / (pop * 5)
-- These are documented estimates; the raw counts in `counts` are exact.
-- Invoked by name via DFHack RunCommand; prints ONE JSON object.

local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

-- Tunables (days-of-supply and material floors below which we flag "low").
-- Reviewed under #5 and KEPT deliberately: unlike the raw-count happiness alerts,
-- food/drink here are already POPULATION-NORMALIZED — days-of-supply divides the
-- stock by pop*per-capita-rate, so LOW_DAYS=14 (under ~2 weeks of buffer) is a
-- proportional line that means the same on a 7-dwarf and a 200-dwarf fort. The
-- material figures are intentional ABSOLUTE working-buffers, not pop-shares: a
-- fort needs a baseline reserve to keep its forges/looms fed regardless of size,
-- and these are reported as a factual notable_low/high classification (not an
-- alert), so a large fort seeing them is a true low reserve, not statistical noise.
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
})

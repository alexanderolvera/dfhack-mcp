--@ module = true
-- mcp_gameDate: see docs/tools/game_state.md "Implementation notes".

local MONTHS = {'Granite','Slate','Felsite','Hematite','Malachite','Galena',
                'Limestone','Sandstone','Timber','Moonstone','Opal','Obsidian'}
local SEASONS = {'Spring','Summer','Autumn','Winter'}
local TICKS_PER_MONTH = 33600
local TICKS_PER_DAY = 1200

local function ordinal(n)
  local v = n % 100
  if v >= 11 and v <= 13 then return n .. 'th' end
  local m = n % 10
  if m == 1 then return n .. 'st'
  elseif m == 2 then return n .. 'nd'
  elseif m == 3 then return n .. 'rd'
  else return n .. 'th' end
end

function current()
  local year = df.global.cur_year
  local tick = df.global.cur_year_tick
  local month = math.floor(tick / TICKS_PER_MONTH)
  local day = math.floor((tick % TICKS_PER_MONTH) / TICKS_PER_DAY) + 1
  return {
    year = year,
    year_tick = tick,
    date = ordinal(day) .. ' ' .. MONTHS[month + 1] .. ', Year ' .. year,
    season = SEASONS[math.floor(month / 3) + 1],
  }
end

if dfhack_flags and dfhack_flags.module then
  return
end

local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local SEASONS = { 'SPRING', 'SUMMER', 'AUTUMN', 'WINTER' }
local plants = df.global.world.raws.plants.all

local function plant_token(idx)
  if not idx or idx < 0 then return nil end
  local p = plants[idx]
  return p and tostring(p.id) or nil
end

local seed_counts = {}
for _, it in ipairs(df.global.world.items.other.SEEDS) do
  local fl = it.flags
  if not (fl.rotten or fl.dump or fl.forbid or fl.construction or fl.trader or fl.garbage_collect) then
    local tok = plant_token(it.mat_index)
    if tok then
      seed_counts[tok] = (seed_counts[tok] or 0) + (it.stack_size or 1)
    end
  end
end

local seed_totals = {}
for tok, count in pairs(seed_counts) do
  seed_totals[#seed_totals + 1] = { plant = tok, count = count }
end
table.sort(seed_totals, function(a, b) return a.plant < b.plant end)

local plots = {}
for _, f in ipairs(df.global.world.buildings.other.FARM_PLOT) do
  local width = f.x2 - f.x1 + 1
  local height = f.y2 - f.y1 + 1
  local lx, ly = f.x1 % 16, f.y1 % 16
  local blk = dfhack.maps.getTileBlock(f.x1, f.y1, f.z)
  local outside = (blk and blk.designation[lx][ly].outside) or false

  local seasons = {}
  local any_crop = false
  for i, season in ipairs(SEASONS) do
    local tok = plant_token(f.plant_id[i - 1])
    if tok then any_crop = true end
    seasons[#seasons + 1] = {
      season = season,
      crop = tok,
      seeds_available = tok and (seed_counts[tok] or 0) or nil,
    }
  end

  plots[#plots + 1] = {
    id = f.id,
    size = width * height,
    surface = outside,
    seasons = seasons,
    no_crop_assigned = not any_crop,
  }
end
table.sort(plots, function(a, b) return a.id < b.id end)

emit({
  plots = plots,
  seed_totals = seed_totals,
})

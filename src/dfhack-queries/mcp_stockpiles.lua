local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local PILES_CAP = 200
local LINKS_CAP = 50
local BACKLOG_CAP = 150
local ROTTING_TYPES_CAP = 100
local ITEMS_PER_TILE_ESTIMATE = 4

local CATEGORY_FLAGS = {
  'animals', 'food', 'furniture', 'corpses', 'refuse', 'stone', 'ammo', 'coins',
  'bars_blocks', 'gems', 'finished_goods', 'leather', 'cloth', 'wood', 'weapons',
  'armor', 'sheet',
}

local function capped_sorted_ids(vec)
  local ids = {}
  for _, b in ipairs(vec) do ids[#ids + 1] = b.id end
  table.sort(ids)
  local truncated = false
  if #ids > LINKS_CAP then
    local capped = {}
    for i = 1, LINKS_CAP do capped[i] = ids[i] end
    ids = capped
    truncated = true
  end
  return ids, truncated
end

local piles = {}
for _, sp in ipairs(df.global.world.buildings.other.STOCKPILE) do
  local categories = {}
  for _, cat in ipairs(CATEGORY_FLAGS) do
    if sp.settings.flags[cat] then categories[#categories + 1] = cat end
  end
  table.sort(categories)

  local give_to, give_to_truncated = capped_sorted_ids(sp.links.give_to_pile)
  local take_from, take_from_truncated = capped_sorted_ids(sp.links.take_from_pile)

  piles[#piles + 1] = {
    id = sp.id,
    x1 = sp.x1, y1 = sp.y1, x2 = sp.x2, y2 = sp.y2, z = sp.z,
    size = (sp.x2 - sp.x1 + 1) * (sp.y2 - sp.y1 + 1),
    categories = categories,
    barrels_allowed = sp.storage.max_barrels > 0,
    bins_allowed = sp.storage.max_bins > 0,
    max_wheelbarrows = sp.storage.max_wheelbarrows,
    links_only = sp.stockpile_flag.use_links_only or false,
    give_to = give_to,
    give_to_truncated = give_to_truncated,
    take_from = take_from,
    take_from_truncated = take_from_truncated,
    item_count = 0,
  }
end

local function pile_at(x, y, z)
  for _, p in ipairs(piles) do
    if z == p.z and x >= p.x1 and x <= p.x2 and y >= p.y1 and y <= p.y2 then
      return p
    end
  end
  return nil
end

local IT = df.item_type
local backlog_counts = {}
local rotting_counts = {}
local rotting_total = 0
local dump_flagged_count = 0

for _, item in ipairs(df.global.world.items.other.IN_PLAY) do
  local fl = item.flags
  if fl.dump then dump_flagged_count = dump_flagged_count + 1 end

  local x, y, z = dfhack.items.getPosition(item)
  local pile = x and pile_at(x, y, z) or nil

  if fl.rotten then
    if fl.on_ground and not pile then
      rotting_total = rotting_total + 1
      local tok = IT[item:getType()]
      rotting_counts[tok] = (rotting_counts[tok] or 0) + 1
    end
  elseif not (fl.dump or fl.forbid or fl.construction or fl.trader or fl.garbage_collect) then
    if pile then
      pile.item_count = pile.item_count + 1
    elseif fl.on_ground then
      local tok = IT[item:getType()]
      backlog_counts[tok] = (backlog_counts[tok] or 0) + 1
    end
  end
end

for _, p in ipairs(piles) do
  local cap = p.size * ITEMS_PER_TILE_ESTIMATE
  p.fullness_pct = cap > 0 and math.floor((100 * p.item_count / cap) + 0.5) or 0
end

table.sort(piles, function(a, b) return a.id < b.id end)
local piles_total = #piles
local piles_truncated = false
if #piles > PILES_CAP then
  local capped = {}
  for i = 1, PILES_CAP do capped[i] = piles[i] end
  piles = capped
  piles_truncated = true
end

local unstored_backlog = {}
local unstored_backlog_item_count = 0
for tok, count in pairs(backlog_counts) do
  unstored_backlog[#unstored_backlog + 1] = { item_type = tok, count = count }
  unstored_backlog_item_count = unstored_backlog_item_count + count
end
table.sort(unstored_backlog, function(a, b) return a.item_type < b.item_type end)
local unstored_backlog_truncated = false
if #unstored_backlog > BACKLOG_CAP then
  local capped = {}
  for i = 1, BACKLOG_CAP do capped[i] = unstored_backlog[i] end
  unstored_backlog = capped
  unstored_backlog_truncated = true
end

local rotting_by_type = {}
for tok, count in pairs(rotting_counts) do
  rotting_by_type[#rotting_by_type + 1] = { item_type = tok, count = count }
end
table.sort(rotting_by_type, function(a, b) return a.item_type < b.item_type end)
local rotting_by_type_truncated = false
if #rotting_by_type > ROTTING_TYPES_CAP then
  local capped = {}
  for i = 1, ROTTING_TYPES_CAP do capped[i] = rotting_by_type[i] end
  rotting_by_type = capped
  rotting_by_type_truncated = true
end

emit({
  piles = piles,
  piles_total = piles_total,
  piles_truncated = piles_truncated,
  unstored_backlog = unstored_backlog,
  unstored_backlog_item_count = unstored_backlog_item_count,
  unstored_backlog_truncated = unstored_backlog_truncated,
  rotting_outside_stockpiles = {
    count = rotting_total,
    by_type = rotting_by_type,
    by_type_truncated = rotting_by_type_truncated,
  },
  dump_flagged_count = dump_flagged_count,
})

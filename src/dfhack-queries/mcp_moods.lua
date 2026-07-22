local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local ACTIVE_CAP = 16
local DEMANDS_CAP = 20

local STRANGE = {
  [df.mood_type.Fey]       = 'fey',
  [df.mood_type.Secretive] = 'secretive',
  [df.mood_type.Possessed] = 'possessed',
  [df.mood_type.Macabre]   = 'macabre',
  [df.mood_type.Fell]      = 'fell',
}

local MAT_FLAGS = {
  { 'flags2', 'bone', 'bone' },       { 'flags2', 'shell', 'shell' },
  { 'flags2', 'leather', 'leather' }, { 'flags2', 'silk', 'silk' },
  { 'flags2', 'yarn', 'yarn' },       { 'flags2', 'hair_wool', 'wool' },
  { 'flags2', 'pearl', 'pearl' },     { 'flags2', 'horn', 'horn' },
  { 'flags2', 'ivory_tooth', 'ivory' }, { 'flags2', 'plant', 'plant' },
  { 'flags2', 'soap', 'soap' },       { 'flags3', 'metal', 'metal' },
  { 'flags3', 'wood', 'wood' },       { 'flags3', 'gem', 'gem' },
  { 'flags3', 'stone', 'stone' },     { 'flags3', 'woven', 'cloth' },
  { 'flags3', 'sand', 'sand' },
}

local REDUNDANT = {
  [df.item_type.ROUGH] = { gem = true }, [df.item_type.SMALLGEM] = { gem = true },
  [df.item_type.BOULDER] = { stone = true }, [df.item_type.WOOD] = { wood = true },
}

local ITEM_LABEL = {
  ROUGH = 'rough gems', SMALLGEM = 'cut gems', BOULDER = 'stone', BAR = 'bars',
  WOOD = 'wood', BLOCKS = 'blocks', CLOTH = 'cloth', THREAD = 'thread',
  SKIN_TANNED = 'tanned skin', LEATHER = 'leather', SHELL = 'shell', BONE = 'bone',
}
local function item_label(item_type)
  if item_type < 0 then return nil end
  local tok = df.item_type[item_type]
  if not tok then return nil end
  return ITEM_LABEL[tok] or (tok:lower():gsub('_', ' '))
end

local function describe(ji)
  local parts = {}
  local function add(s) if s and s ~= '' then parts[#parts + 1] = s end end
  if ji.mat_type and ji.mat_type >= 0 then
    local ok, mi = pcall(function() return dfhack.matinfo.decode(ji.mat_type, ji.mat_index) end)
    if ok and mi then add(mi:toString()) end
  end
  local red = REDUNDANT[ji.item_type] or {}
  for _, spec in ipairs(MAT_FLAGS) do
    if not red[spec[3]] then
      local ok, on = pcall(function() return ji[spec[1]][spec[2]] end)
      if ok and on then add(spec[3]) end
    end
  end
  add(item_label(ji.item_type))
  local words, seen = {}, {}
  for _, part in ipairs(parts) do
    for w in part:gmatch('%S+') do
      local key = w:lower():gsub('s$', '')
      if not seen[key] then seen[key] = true; words[#words + 1] = w end
    end
  end
  return #words > 0 and table.concat(words, ' ') or 'unspecified material'
end

local function stock_have(ji)
  local ok, total = pcall(function()
    local want_type, want_sub = ji.item_type, ji.item_subtype
    local n = 0
    for _, it in ipairs(df.global.world.items.other.IN_PLAY) do
      local fl = it.flags
      if not (fl.rotten or fl.dump or fl.forbid or fl.construction or fl.trader or fl.garbage_collect) then
        local ity = it:getType()
        if (want_type < 0 or ity == want_type)
          and (want_sub < 0 or it:getSubtype() == want_sub)
          and dfhack.job.isSuitableMaterial(ji, it:getMaterial(), it:getMaterialIndex(), ity) then
          n = n + it:getStackSize()
        end
      end
    end
    return n
  end)
  return ok and total or -1
end

local function gathered_by_index(job)
  local g = {}
  local ok = pcall(function()
    for _, ref in ipairs(job.items) do
      local idx = ref.job_item_idx
      if idx and idx >= 0 then g[idx] = (g[idx] or 0) + 1 end
    end
  end)
  if not ok then return {} end
  return g
end

local function mood_skill_label(u)
  local ms = u.job.mood_skill
  if not ms or ms < 0 then return 'unknown' end
  local ok, cap = pcall(function() return df.job_skill.attrs[ms].caption end)
  if ok and cap and cap ~= '' then return cap end
  return df.job_skill[ms] or 'unknown'
end

local active = {}
for _, u in ipairs(dfhack.units.getCitizens(true)) do
  local mood = u.mood and STRANGE[u.mood]
  if mood then
    local row = {
      unit_id = u.id,
      name = dfhack.units.getReadableName(u),
      mood = mood,
      skill = mood_skill_label(u),
      mood_timeout = u.job.mood_timeout or -1,
      workshop = nil,
      workshop_status = 'unclaimed',
      demands = {},
      demands_truncated = false,
    }

    local job = u.job.current_job
    if job then
      local ok_h, holder = pcall(function() return dfhack.job.getHolder(job) end)
      if ok_h and holder then
        local ok_n, nm = pcall(function() return dfhack.buildings.getName(holder) end)
        row.workshop = (ok_n and nm ~= '' and nm) or df.workshop_type[holder.type] or 'workshop'
      end

      local gathered = gathered_by_index(job)
      local all_filled = true
      local total_demands = 0
      for i, ji in ipairs(job.job_items) do
        total_demands = total_demands + 1
        if #row.demands < DEMANDS_CAP then
          local needed = ji.quantity or 1
          local got = gathered[i - 1] or 0    -- job_item_idx is 0-based
          if got < needed then all_filled = false end
          row.demands[#row.demands + 1] = {
            material = describe(ji),
            needed = needed,
            gathered = got,
            have = stock_have(ji),
          }
        else
          all_filled = false
        end
      end
      row.demands_truncated = total_demands > #row.demands
      row.workshop_status = (total_demands > 0 and all_filled) and 'working' or 'gathering'
    end

    active[#active + 1] = row
  end
end

table.sort(active, function(a, b) return a.unit_id < b.unit_id end)

local active_truncated = #active > ACTIVE_CAP
if active_truncated then
  local capped = {}
  for i = 1, ACTIVE_CAP do capped[i] = active[i] end
  active = capped
end

local alerts = {}
for _, row in ipairs(active) do
  for _, d in ipairs(row.demands) do
    if d.have == 0 and d.gathered < d.needed then
      alerts[#alerts + 1] = row.name .. ' demands ' .. d.material ..
        ' but the fort has none in stock'
    end
  end
end

emit({
  active = active,
  active_truncated = active_truncated,
  alerts = alerts,
})

local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local plotinfo = df.global.plotinfo
local ent = plotinfo.main.fortress_entity

local function unit_name(u)
  if not u then return 'unknown' end
  local ok, s = pcall(function() return dfhack.units.getReadableName(u) end)
  if ok and s and s ~= '' then return s end
  ok, s = pcall(function() return dfhack.translation.translateName(dfhack.units.getVisibleName(u), true) end)
  if ok and s and s ~= '' then return s end
  return 'unit ' .. tostring(u.id)
end

local function hf_name(hf)
  if not hf then return 'unknown' end
  local ok, s = pcall(function() return dfhack.translation.translateName(hf.name, true) end)
  if ok and s and s ~= '' then return s end
  return 'hf ' .. tostring(hf.id)
end

local code_by_id = {}
local holders_by_pos = {}
if ent then
  for _, pos in ipairs(ent.positions.own) do
    code_by_id[pos.id] = pos.code
  end
  for _, asg in ipairs(ent.positions.assignments) do
    if asg.histfig and asg.histfig ~= -1 then
      local hf = df.historical_figure.find(asg.histfig)
      local u = hf and hf.unit_id and hf.unit_id ~= -1 and df.unit.find(hf.unit_id) or nil
      local list = holders_by_pos[asg.position_id]
      if not list then list = {}; holders_by_pos[asg.position_id] = list end
      list[#list + 1] = {
        histfig_id = asg.histfig,
        unit_id = u and u.id or nil,
        name = u and unit_name(u) or hf_name(hf),
      }
    end
  end
end

local positions = {}
if ent then
  for _, pos in ipairs(ent.positions.own) do
    local holders = holders_by_pos[pos.id] or {}
    local row = {
      code = pos.code,
      name = (pos.name[0] ~= '' and pos.name[0]) or pos.code,
      vacant = #holders == 0,
      holders = holders,
    }
    if pos.replaced_by and pos.replaced_by ~= -1 then
      row.superseded_by = code_by_id[pos.replaced_by]
    end
    positions[#positions + 1] = row
  end
end
table.sort(positions, function(a, b) return a.code < b.code end)

emit({
  positions = positions,
  bookkeeper_precision_level = plotinfo.nobles.bookkeeper_settings,
  mayor_election_pending = plotinfo.flags.force_elections,
  monarch = {
    arrived = plotinfo.king_arrived,
    hasty = plotinfo.king_hasty,
  },
})

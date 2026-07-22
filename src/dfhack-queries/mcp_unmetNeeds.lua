local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local DISTRACTED_BELOW = -1000

local citizens = dfhack.units.getCitizens(true)
local NEED = df.need_type

local agg = {}
local any_unmet = {}

for _, u in ipairs(citizens) do
  local soul = u.status.current_soul
  if soul and soul.personality and soul.personality.needs then
    local worst_by_type = {}
    for _, need in ipairs(soul.personality.needs) do
      if need.focus_level < DISTRACTED_BELOW then
        local t = NEED[need.id] or tostring(need.id)
        if not worst_by_type[t] or need.focus_level < worst_by_type[t] then
          worst_by_type[t] = need.focus_level
        end
      end
    end
    for t, focus in pairs(worst_by_type) do
      local a = agg[t]
      if not a then a = { distracted = 0, worst = 0 }; agg[t] = a end
      a.distracted = a.distracted + 1
      if focus < a.worst then a.worst = focus end
      any_unmet[u.id] = true
    end
  end
end

local rows = {}
for t, a in pairs(agg) do
  rows[#rows+1] = { need = t, dwarves = a.distracted, worst_focus = a.worst }
end
table.sort(rows, function(x, y)
  if x.dwarves ~= y.dwarves then return x.dwarves > y.dwarves end
  return x.worst_focus < y.worst_focus
end)

local top = {}
for i = 1, math.min(#rows, 8) do top[i] = rows[i] end

local n_affected = 0
for _ in pairs(any_unmet) do n_affected = n_affected + 1 end

local NEED_SHARE_ALERT = 0.25

local alerts = {}
if #top > 0 and #citizens > 0 and (top[1].dwarves / #citizens) >= NEED_SHARE_ALERT then
  alerts[#alerts+1] = top[1].dwarves .. ' of ' .. #citizens ..
    ' dwarves distracted by unmet need: ' .. top[1].need
end

emit({
  population = #citizens,
  dwarves_with_unmet_need = n_affected,
  top_needs = top,
  alerts = alerts,
})

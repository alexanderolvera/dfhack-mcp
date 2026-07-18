-- mcp_unmetNeeds: why the fort is stressed — the needs system, aggregated.
--
-- Companion to fort_status's happiness buckets: those say HOW MANY dwarves are
-- unhappy; this says WHICH needs are starving them and how badly. Facts only:
-- it reports the need types and severities, not what to build about them (that's
-- game knowledge the agent looks up). Each citizen soul carries
-- personality.needs (df.need_type). focus_level is the signal: >= 0 met/neutral,
-- negative = distracted, magnitude = how starved. A dwarf can hold several needs
-- of one type (e.g. PrayOrMeditate per deity) — we count each DWARF at most once
-- per need type, using their worst focus for that type.
--
-- Verified live on 53.15-r2: soul.personality.needs iterates; df.need_type[id]
-- yields readable tokens (PrayOrMeditate, DrinkAlcohol, Socialize, ...).
--
-- DISTRACTED_BELOW is a heuristic cut (a tunable): below it a dwarf is
-- meaningfully distracted, not merely slightly unfulfilled. Ranked by how many
-- dwarves are distracted, so the top line is the highest-leverage fix.
-- Invoked by name via DFHack RunCommand; prints ONE JSON object.

local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local DISTRACTED_BELOW = -1000   -- tunable: focus_level under this = distracted

local citizens = dfhack.units.getCitizens(true)
local NEED = df.need_type

-- agg[type] = { distracted = <#dwarves>, worst = <most negative focus> }
local agg = {}
local any_unmet = {}  -- set of unit ids with >=1 distracted need

for _, u in ipairs(citizens) do
  local soul = u.status.current_soul
  if soul and soul.personality and soul.personality.needs then
    local worst_by_type = {}  -- per-dwarf: type -> worst focus this dwarf has
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

-- Flatten and sort by #dwarves distracted (desc), then severity.
local rows = {}
for t, a in pairs(agg) do
  rows[#rows+1] = { need = t, dwarves = a.distracted, worst_focus = a.worst }
end
table.sort(rows, function(x, y)
  if x.dwarves ~= y.dwarves then return x.dwarves > y.dwarves end
  return x.worst_focus < y.worst_focus
end)

-- Keep the top offenders; a long tail of 1-2 dwarf needs isn't actionable.
local top = {}
for i = 1, math.min(#rows, 8) do top[i] = rows[i] end

local n_affected = 0
for _ in pairs(any_unmet) do n_affected = n_affected + 1 end

-- Almost every dwarf always carries at least one distracted need, so
-- "n_affected > 0" crosses no line — it's the baseline, not news (77 of 78 here).
-- The signal is REACH: a single need distracting a large SHARE of the fort is a
-- systemic, nameable gap the player can act on. Gate the top-need alert on that
-- share; drop the near-universal aggregate line (dwarves_with_unmet_need stays a
-- queryable output fact, just not an alert).
local NEED_SHARE_ALERT = 0.25   -- tunable: top need distracting >= this share -> alert

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

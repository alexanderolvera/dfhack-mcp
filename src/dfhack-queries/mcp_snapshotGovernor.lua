--@ module = true

local DEFAULTS = {
  high = 0.05,
  low = 0.01,
  min_frames = 120,
  over_streak = 2,
  under_streak = 3,
  step = 1.5,
  max_backoff = 16,
}

local function reset_samples(g)
  g.busy_ms, g.busy_frames, g.idle_ms, g.idle_frames = 0, 0, 0, 0
end

function new(opts)
  local g = {}
  for k, v in pairs(DEFAULTS) do
    local o = opts and tonumber(opts[k])
    g[k] = o or v
  end
  g.level, g.over, g.under = 0, 0, 0
  g.inflation, g.decision, g.decided_at = nil, nil, nil
  reset_samples(g)
  return g
end

function multiplier(g)
  local m = g.step ^ g.level
  if m < 1 then return 1 end
  if m > g.max_backoff then return g.max_backoff end
  return m
end

function sample(g, ms, busy)
  if ms < 0 then return end
  if busy then
    g.busy_ms, g.busy_frames = g.busy_ms + ms, g.busy_frames + 1
  else
    g.idle_ms, g.idle_frames = g.idle_ms + ms, g.idle_frames + 1
  end
end

function decide(g)
  if g.busy_frames < g.min_frames or g.idle_frames < g.min_frames then return nil end
  local busy = g.busy_ms / g.busy_frames
  local idle = g.idle_ms / g.idle_frames
  if idle <= 0 then
    reset_samples(g)
    return nil
  end

  g.inflation = busy / idle - 1
  local out = 'hold'
  if g.inflation > g.high then
    g.over, g.under = g.over + 1, 0
    if g.over >= g.over_streak then
      g.over = 0
      if multiplier(g) < g.max_backoff then
        g.level = g.level + 1
        out = 'backoff'
      else
        out = 'at_max_backoff'
      end
    end
  elseif g.inflation < g.low then
    g.under, g.over = g.under + 1, 0
    if g.under >= g.under_streak then
      g.under = 0
      if g.level > 0 then
        g.level = g.level - 1
        out = 'recover'
      else
        out = 'at_target'
      end
    end
  else
    g.over, g.under = 0, 0
  end

  g.decision = out
  reset_samples(g)
  return out
end

function cadence_for(g, target)
  return math.max(1, math.floor(target * multiplier(g) + 0.5))
end

function report(g)
  return {
    level = g.level,
    multiplier = multiplier(g),
    inflation = g.inflation,
    decision = g.decision,
    decided_at = g.decided_at,
    high = g.high,
    low = g.low,
    busy_frames = g.busy_frames,
    idle_frames = g.idle_frames,
  }
end

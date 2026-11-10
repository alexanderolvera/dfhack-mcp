-- Exercises the pure cadence-governor law under standalone Lua (no DFHack).
-- Driven by test/governor.test.mjs; see docs/snapshot.md.
dofile(arg[1])

local failures = 0
local function check(cond, msg)
  if cond then
    print('ok   ' .. msg)
  else
    failures = failures + 1
    print('FAIL ' .. msg)
  end
end

local function feed(g, frames, busy_ms, idle_ms)
  for _ = 1, frames do
    sample(g, busy_ms, true)
    sample(g, idle_ms, false)
  end
end

local function cycle(g, busy_ms, idle_ms)
  feed(g, g.min_frames, busy_ms, idle_ms)
  return decide(g)
end

print('-- defaults and bounds --')
local g = new()
check(g.level == 0, 'a new governor starts at level 0')
check(multiplier(g) == 1, 'and multiplies a configured cadence by 1')
check(cadence_for(g, 600) == 600, 'so the configured cadence is used as-is')

print('-- not enough samples --')
g = new()
sample(g, 10, true)
sample(g, 10, false)
check(decide(g) == nil, 'no decision before min_frames samples on both sides')
feed(g, g.min_frames, 10, 10)
check(decide(g) ~= nil, 'a decision once both sides have min_frames')

print('-- headroom: no inflation means no backoff, ever --')
g = new()
for _ = 1, 10 do
  cycle(g, 10, 10)
end
check(g.level == 0, 'identical busy and idle frame times never back off')
check(g.inflation == 0, 'measured inflation is 0')
check(cadence_for(g, 600) == 600, 'cadence stays at the configured value')

print('-- harm: sustained inflation backs off, with hysteresis --')
g = new()
local first = cycle(g, 13, 10)
check(first == 'hold', 'one bad window alone does not back off (hysteresis)')
check(g.level == 0, 'still at level 0 after one bad window')
check(math.abs(g.inflation - 0.3) < 1e-9, 'inflation measured as 0.3')
check(cycle(g, 13, 10) == 'backoff', 'two consecutive bad windows back off')
check(g.level == 1, 'level rose to 1')
check(cadence_for(g, 600) == 900, 'cadence stretched 1.5x, to 900 frames')

print('-- backoff is bounded --')
g = new()
for _ = 1, 60 do
  cycle(g, 20, 10)
end
check(multiplier(g) == g.max_backoff, 'multiplier saturates at max_backoff')
check(g.decision == 'at_max_backoff', 'and says so instead of climbing forever')
check(cadence_for(g, 600) == 9600, 'cadence capped at 16x the configured value')

print('-- recovery never overshoots the configured cadence --')
g = new()
for _ = 1, 4 do
  cycle(g, 20, 10)
end
local raised = g.level
check(raised > 0, 'backed off first (level ' .. raised .. ')')
for _ = 1, 60 do
  cycle(g, 10, 10)
end
check(g.level == 0, 'returns to level 0 once the inflation is gone')
check(g.decision == 'at_target', 'and reports it is at target, not recovering further')
check(cadence_for(g, 600) == 600, 'never faster than the configured cadence')

print('-- the dead band holds position --')
g = new()
cycle(g, 20, 10)
cycle(g, 20, 10)
local held = g.level
for _ = 1, 10 do
  cycle(g, 10.3, 10)
end
check(g.level == held, 'inflation between low and high changes nothing')

print('-- a stalled idle measurement is ignored, not divided by --')
g = new()
feed(g, g.min_frames, 10, 0)
check(decide(g) == nil, 'zero idle frame time yields no decision')
check(g.level == 0, 'and no change')

print('-- custom thresholds are honoured --')
g = new({ high = 0.5, low = 0.1, over_streak = 1 })
check(g.high == 0.5 and g.low == 0.1, 'thresholds taken from opts')
check(cycle(g, 13, 10) == 'hold', '0.3 inflation is inside a 0.5 high watermark')
check(cycle(g, 16, 10) == 'backoff', '0.6 inflation trips it with over_streak 1')

print('')
if failures > 0 then
  print(failures .. ' check(s) failed')
  os.exit(1)
end
print('all governor law checks passed')

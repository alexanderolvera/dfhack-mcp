-- mcp_jobsAndLabor: workforce utilization — who's busy, who's idle, doing what.
--
-- Derives everything from the citizens themselves (not world.jobs.list, which is
-- a linked list, not an array). Children and babies are split out of the labor
-- pool: an idle ADULT is wasted labor; an idle child is just a child. For
-- working adults we tally current_job.job_type so the player sees what the fort
-- is actually spending its hands on.
--
-- Verified live on 53.15-r2: u.job.current_job truthy for busy dwarves;
-- df.job_type[id] yields readable tokens; isChild/isBaby present.
-- Invoked by name via DFHack RunCommand; prints ONE JSON object.

local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

-- A fort always runs some idle churn (dwarves between tasks, ~10-20%); a third
-- of the workforce standing around is surplus/misallocated labor worth naming.
-- Validated against the live fort (27/77 = 35% idle -> fires correctly).
local IDLE_FRACTION_ALERT = 0.30   -- tunable: idle adults over this share -> alert

local citizens = dfhack.units.getCitizens(true)
local JT = df.job_type

local adults, children = 0, 0
local working, idle = 0, 0
local job_counts = {}

for _, u in ipairs(citizens) do
  if dfhack.units.isChild(u) or dfhack.units.isBaby(u) then
    children = children + 1
  else
    adults = adults + 1
    local cj = u.job.current_job
    if cj then
      working = working + 1
      local name = JT[cj.job_type] or tostring(cj.job_type)
      job_counts[name] = (job_counts[name] or 0) + 1
    else
      idle = idle + 1
    end
  end
end

-- Rank active job types (desc) so the top lines are where labor is going.
local jobs = {}
for name, n in pairs(job_counts) do jobs[#jobs+1] = { job = name, count = n } end
table.sort(jobs, function(a, b)
  if a.count ~= b.count then return a.count > b.count end
  return a.job < b.job
end)
local top_jobs = {}
for i = 1, math.min(#jobs, 10) do top_jobs[i] = jobs[i] end

local idle_pct = adults > 0 and math.floor(idle * 100 / adults) or 0

local alerts = {}
if adults > 0 and (idle / adults) >= IDLE_FRACTION_ALERT then
  alerts[#alerts+1] = idle .. ' of ' .. adults .. ' working-age dwarves idle (' .. idle_pct .. '%)'
end

emit({
  workforce = adults,
  children = children,
  working = working,
  idle = idle,
  idle_pct = idle_pct,
  top_jobs = top_jobs,
  alerts = alerts,
})

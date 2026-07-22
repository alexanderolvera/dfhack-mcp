local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local IDLE_FRACTION_ALERT = 0.30
local CANCEL_SPAM_ALERT = 10

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

local jobs = {}
for name, n in pairs(job_counts) do jobs[#jobs+1] = { job = name, count = n } end
table.sort(jobs, function(a, b)
  if a.count ~= b.count then return a.count > b.count end
  return a.job < b.job
end)
local top_jobs = {}
for i = 1, math.min(#jobs, 10) do top_jobs[i] = jobs[i] end

local REASON_CAP = 20
local AT = df.announcement_type
local cancel_counts = {}
local cancel_total = 0
for _, r in ipairs(df.global.world.status.reports) do
  if AT[r.type] == 'CANCEL_JOB' then
    local n = 1 + ((r.repeat_count and r.repeat_count > 0) and r.repeat_count or 0)
    cancel_total = cancel_total + n
    local reason = r.text:match('.*:%s*(.-)%.?$') or 'unknown'
    cancel_counts[reason] = (cancel_counts[reason] or 0) + n
  end
end
local cancel_reasons = {}
for reason, n in pairs(cancel_counts) do cancel_reasons[#cancel_reasons + 1] = { reason = reason, count = n } end
table.sort(cancel_reasons, function(a, b)
  if a.count ~= b.count then return a.count > b.count end
  return a.reason < b.reason
end)
local cancel_reasons_truncated = false
if #cancel_reasons > REASON_CAP then
  local capped = {}
  for i = 1, REASON_CAP do capped[i] = cancel_reasons[i] end
  cancel_reasons = capped
  cancel_reasons_truncated = true
end

local idle_pct = adults > 0 and math.floor(idle * 100 / adults) or 0

local alerts = {}
if adults > 0 and (idle / adults) >= IDLE_FRACTION_ALERT then
  alerts[#alerts+1] = idle .. ' of ' .. adults .. ' working-age dwarves idle (' .. idle_pct .. '%)'
end
if #cancel_reasons > 0 and cancel_reasons[1].count >= CANCEL_SPAM_ALERT then
  alerts[#alerts+1] = cancel_reasons[1].count .. 'x job cancellation: ' .. cancel_reasons[1].reason
end

emit({
  workforce = adults,
  children = children,
  working = working,
  idle = idle,
  idle_pct = idle_pct,
  top_jobs = top_jobs,
  cancellations = {
    total = cancel_total,
    by_reason = cancel_reasons,
    by_reason_truncated = cancel_reasons_truncated,
  },
  alerts = alerts,
})

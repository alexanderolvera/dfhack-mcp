---
tool: jobs_and_labor
tier: sensor
gated: none
source: src/tools/jobsAndLabor.ts
lua: src/dfhack-queries/mcp_jobsAndLabor.lua
tags: [dfhack-mcp/tool]
---

# jobs_and_labor

> Workforce utilization: how many working-age dwarves are busy vs. idle, the idle percentage, and a ranked breakdown of what jobs the fort is currently working on.

## Purpose
Reports where the fort's hands are going: adults working vs. idle (children and babies split out of the labor pool — an idle adult is wasted labor, an idle child is just a child), the idle percentage, and the top current job types by count. Also aggregates recent job-cancellation announcements by reason — `chronicle` reports each cancellation as a one-off event, but nothing summed them into "this exact reason keeps firing" until now. An AI co-pilot calls it to spot surplus/misallocated labor, see what the fort is actually spending effort on right now, or catch a systemic cancellation cause (a path-blocking construction, a chronic missing-item bottleneck) before it silently repeats for months. High idle or repeated cancellations can mean unassigned labor, a blocked path, or a missing resource; the tool reports the numbers, not the fix.

## Parameters
None.

## Returns
- `workforce` (number) — adult citizens (the labor pool).
- `children` (number) — children + babies, excluded from the pool.
- `working` (number) — adults with a current job.
- `idle` (number) — adults with none.
- `idle_pct` (number) — floor(idle * 100 / workforce).
- `top_jobs[]` — up to 10 `{ job, count }` rows, count-descending; `job` is the raw `df.job_type` token (e.g. "StoreItemInStockpile").
- `cancellations` — `{ total, by_reason[], by_reason_truncated }`. `total` is every `CANCEL_JOB` OCCURRENCE in the currently-retained report buffer (DF's own report log, which evicts old entries — in practice roughly the last few months of play, no separate time window applied) — weighted by DF's own `repeat_count` (see Caveats), not a raw row count. `by_reason[]` is `{ reason, count }`, the reason text taken verbatim from after the last colon in the announcement (e.g. `"Equipment mismatch"`, `"Needs foxtail millet"`), also occurrence-weighted, sorted count-descending, capped at 20 distinct reasons.
- `alerts[]` — fires when idle share >= 30% of adults, or when the top cancellation reason has fired >= 10 times.

```json
{
  "alerts": ["27 of 77 working-age dwarves idle (35%)", "61x job cancellation: Equipment mismatch"],
  "cancellations": {
    "total": 71,
    "by_reason": [
      { "reason": "Equipment mismatch", "count": 61 },
      { "reason": "Needs 2 steel bars", "count": 3 },
      { "reason": "Needs rope reed seeds", "count": 3 },
      { "reason": "Needs foxtail millet", "count": 1 }
    ],
    "by_reason_truncated": false
  },
  "children": 1,
  "idle": 27,
  "idle_pct": 35,
  "top_jobs": [
    { "count": 16, "job": "StoreItemInStockpile" },
    { "count": 9, "job": "Sleep" },
    { "count": 5, "job": "PenLargeAnimal" },
    { "count": 3, "job": "MeltMetalObject" },
    { "count": 2, "job": "CarveRamp" },
    { "count": 1, "job": "MakeWeapon" }
  ],
  "workforce": 77,
  "working": 50
}
```

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- `top_jobs` is capped at 10 rows (no truncation flag; the tail is simply dropped).
- "Working" includes personal-need jobs (Sleep, Eat, DrinkItem count as jobs, not idle), so `idle` measures dwarves literally between tasks.
- Job names are raw job_type tokens, not prettified strings.
- Idle alert threshold: >= 30% of adults (a fort always runs ~10-20% idle churn; validated live at 35%).
- Derived from the citizens themselves, not `world.jobs.list` (which is a linked list on this build).
- `cancellations.by_reason` aggregates the reason string VERBATIM, not a generalized category — two item-specific reasons ("Needs foxtail millet" vs. "Needs rope reed seeds") stay distinct rows even though both mean "missing an item"; a systemic reason (e.g. a pathing or equipment problem) naturally clusters into one high-count row instead.
- `cancellations.total` reflects whatever DF's report buffer currently retains, not a fixed lookback window — an old, high-report-volume fort's buffer covers less wall-clock time than a young fort's.
- `cancellations` counts OCCURRENCES, weighted by each report's `repeat_count` (DF collapses consecutive identical cancellations into one report row and tallies the extras there instead of writing N rows) — counting report rows alone would badly undercount a repeating reason (verified live: a 7-row "Equipment mismatch" cluster was actually 61 occurrences once its `repeat_count`s were summed).

## Related
[work_details](work_details.md) · [work_order_list](work_order_list.md) · [citizen](citizen.md) · [fort_status](fort_status.md)

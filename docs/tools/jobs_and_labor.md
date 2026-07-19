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
Reports where the fort's hands are going: adults working vs. idle (children and babies split out of the labor pool — an idle adult is wasted labor, an idle child is just a child), the idle percentage, and the top current job types by count. An AI co-pilot calls it to spot surplus/misallocated labor or to see what the fort is actually spending effort on right now. High idle can mean unassigned labor or nothing queued; the tool reports the numbers, not the fix.

## Parameters
None.

## Returns
- `workforce` (number) — adult citizens (the labor pool).
- `children` (number) — children + babies, excluded from the pool.
- `working` (number) — adults with a current job.
- `idle` (number) — adults with none.
- `idle_pct` (number) — floor(idle * 100 / workforce).
- `top_jobs[]` — up to 10 `{ job, count }` rows, count-descending; `job` is the raw `df.job_type` token (e.g. "StoreItemInStockpile").
- `alerts[]` — fires when idle share >= 30% of adults.

```json
{
  "alerts": ["27 of 77 working-age dwarves idle (35%)"],
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

## Related
[work_details](work_details.md) · [work_order_list](work_order_list.md) · [citizen](citizen.md) · [fort_status](fort_status.md)

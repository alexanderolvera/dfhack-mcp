---
tool: work_details
tier: sensor
gated: none
source: src/tools/workDetail.ts
lua: src/dfhack-queries/mcp_workDetail.lua
tags: [dfhack-mcp/tool]
---

# work_details

> List the fort's work details (the labor-management groups) as facts.

## Purpose
Reads `df.global.plotinfo.labor_info.work_details` — the same structures the in-game Labor → Work Details screen shows: each detail's name, mode, the labor tokens it enables, and its assigned citizens (id-sorted, with parallel readable names). Doubles as the labor view and as the readback sensor for [assign_work_detail](assign_work_detail.md). Read-only and always available (not behind the actuator gate).

## Parameters
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `detail` | string (min 1) | no | all details | exact work detail name — return ONLY that detail, e.g. "Miners" |
| `members_after` | integer (coerced) | no | from the start | member-list cursor: list members with id AFTER this (use `members_cursor` from a truncated response) |

## Returns
| Field | Meaning |
|---|---|
| `count` | number of details LISTED (the fort total when unfiltered) |
| `details[].name` | detail name |
| `details[].mode` | `Default` \| `EverybodyDoesThis` \| `NobodyDoesThis` \| `OnlySelectedDoesThis` |
| `details[].no_modify` | a default detail the in-game UI won't let you rename/delete |
| `details[].icon` | icon index |
| `details[].allowed_labors` | `df.unit_labor` names this detail enables |
| `details[].members` | assigned citizen unit ids, id-sorted, capped at 200 |
| `details[].member_names` | readable names parallel to `members` |
| `details[].member_count` | FULL count, even when the list is truncated/paged |
| `details[].members_truncated` | the member list was capped below the remaining tail |
| `details[].members_cursor` | ONLY when truncated: last listed id — pass back as `members_after` |
| `members_after` | echo of the cursor arg; absent when none was passed |

```json
{
  "count": 12,
  "details": [
    {
      "allowed_labors": ["MINE"],
      "icon": 0,
      "member_count": 2,
      "member_names": [
        "Atir Rasenastod \"Coalgulfs\", Miner",
        "Sigun Sastreskeskal \"Princessshoots\", Miner"
      ],
      "members": [112, 113],
      "members_truncated": false,
      "mode": "OnlySelectedDoesThis",
      "name": "Miners",
      "no_modify": true
    }
  ]
}
```
*(one of 12 details shown; the golden carries the full fort set. Dwarven names contain accented characters, ASCII-folded here.)*

## Caveats & limits
- Member lists are capped at 200 per detail; page a big detail with `members_after` using the `members_cursor` from a truncated response. `member_count` is always the full count regardless of cursor.
- Members are sorted by id so the payload is deterministic regardless of the game vector's own order.
- `detail` filtering is exact-name (first match); an unknown name simply yields `count: 0` with an empty list.
- With no arguments, the payload is identical to the pre-parameterized version (goldens stay stable).
- Returns `{"error":"no fort loaded"}` if no fort is active.

## Implementation notes
Work details live in `df.global.plotinfo.labor_info.work_details` (`vector<work_detail*>`). Each `work_detail` has `.name` (string), `.assigned_units` (`vector<int32_t>` of unit ids), `.allowed_labors` (bool array indexed by `df.unit_labor` — index `i` true means that labor is enabled by the detail), `.flags.mode` (a `df.work_detail_mode`), and `.icon`. These are the same structures the in-game Labor → Work Details screen reads, so a membership change made through this tool appears in-game (verified live on DFHack 53.15).

Grant semantics by mode: an `EverybodyDoesThis` detail grants its enabled labors to every citizen; `OnlySelectedDoesThis` (and `Default`) grant them only to `assigned_units` members; `NobodyDoesThis` grants nothing. [assign_work_detail](assign_work_detail.md) computes this union (across every detail that enables a given labor) to decide what a citizen's resulting labor set should be.

Labor propagation (the mechanism [assign_work_detail](assign_work_detail.md) relies on): editing `assigned_units` alone does not immediately update a unit's `status.labors` — the game only reconciles that on a frame advance, via its automatic-professions system (gated by `df.global.game.external_flag.automatic_professions_disabled`). `assigned_units` is therefore the durable source of truth, and `status.labors` is a derived cache. `assign_work_detail`'s apply step edits `assigned_units` and also mirrors the affected labors onto `unit.status.labors` immediately — recomputing each as the union across all details — so the change is visible even on a paused fort. Verified live: assigning a unit to "Miners" flips its `MINE` labor true; removing it flips `MINE` false.

## Related
[assign_work_detail](assign_work_detail.md) (the actuator this readback verifies), [jobs_and_labor](jobs_and_labor.md) (what dwarves are actually doing), [find_unit](find_unit.md) and [citizen](citizen.md) (resolving the unit ids listed here).

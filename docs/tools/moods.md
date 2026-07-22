---
tool: moods
tier: sensor
gated: none
source: src/tools/moods.ts
lua: src/dfhack-queries/mcp_moods.lua
tags: [dfhack-mcp/tool]
---

# moods

> Any active strange mood (fey/secretive/possessed/macabre/fell) and its material countdown.

## Purpose
Reports each dwarf seized by a strange mood: the mood type, the driving artifact skill, the workshop claimed (or that none is yet), the game's raw mood countdown, and every demanded material cross-referenced against fort stock — needed, gathered so far, and how many the fort actually has. The whole early warning is "demands bones, fort has zero": the tool reports the demand vs. the stock, not what to go collect. An AI co-pilot calls it when a mood announcement fires, or periodically, since an unsatisfiable mood ends in insanity.

## Parameters
None.

## Returns
- `active[]` — one row per moody dwarf:
  - `unit_id`, `name`.
  - `mood` — `fey | secretive | possessed | macabre | fell` (insanity states are excluded — they are not strange moods).
  - `skill` — the artifact skill caption (e.g. "Bone Carving").
  - `workshop` (string | null) — claimed workshop name, null before one is claimed.
  - `workshop_status` — `unclaimed | gathering | working` (working = all materials in hand).
  - `mood_timeout` (number) — the game's raw countdown, verbatim (-1 when inactive).
  - `demands[]` — `{ material, needed, gathered, have }`; `have` is matching fort stock (-1 if suitability was unevaluable), matched with DFHack's own suitability predicates so category demands (bones/cloth/shell) resolve the way DF itself resolves them.
  - `demands_truncated` (boolean).
- `active_truncated` (boolean).
- `alerts[]` — a demand with `have == 0` and not yet gathered (workshop-claim status is already on each `active[]` row).

```json
{
  "active": [],
  "active_truncated": false,
  "alerts": []
}
```

(The golden fixture has no active mood — `{"active":[]}` is the common case. A populated row looks like: `{ "unit_id": 123, "name": "Urist ...", "mood": "fey", "skill": "Bone Carving", "workshop": null, "workshop_status": "unclaimed", "mood_timeout": 49000, "demands": [{ "material": "bone", "needed": 1, "gathered": 0, "have": 0 }], "demands_truncated": false }`.)

## Caveats & limits
- Returns `{"error":"no fort loaded"}` when no fort is active.
- Caps: `active` at 16 (moods are near-unique; the cap defends a pathological save), `demands` at 20 per mood.
- `have` counts mirror the `stocks` skip set (rotten/dump/forbid/construction/trader/garbage excluded) so the numbers are comparable; `-1` means suitability could not be evaluated for that demand.
- The POPULATED path is live-unverified on the current fixture (no active mood existed); the empty path was exercised live on 53.15. Field paths were probed live.
- `workshop_status` "working" is inferred from all demands being fully gathered; "gathering" covers claimed-but-still-collecting.
- Insanity states (Melancholy/Raving/Berserk/Traumatized) are deliberately NOT reported here.

## Implementation notes
- A moody dwarf is identified by `u.mood` matching `{Fey, Secretive, Possessed, Macabre, Fell}`; the insanity states (Melancholy/Raving/Berserk/Traumatized) are a different field's values entirely and are never matched.
- `u.job.mood_skill` (a `df.job_skill`) is the artifact skill; `u.job.mood_timeout` is the game's own countdown, reported verbatim.
- Before a workshop is claimed, `u.job.current_job` is `nil`. Once claimed, the job is held by the workshop building, resolved via `dfhack.job.getHolder(job)`. The job's `job_items` are the demands (one per material, with a `quantity`); `job.items` are what's been gathered so far, and each entry's `job_item_idx` (0-based) says which demand it fills.
- Generic material-category demands (bone, shell, silk, wood, ...) have no dedicated `material_category` field on `job_item` — they live as individual boolean flags spread across the `flags2`/`flags3` bitfields, so matching a demand means checking each known flag rather than reading one field.
- Stock matching (`have`) uses DFHack's own `dfhack.job.isSuitableMaterial` predicate against each in-play item, so a category demand counts exactly the materials DF itself would accept for that mood.

## Related
[stocks](stocks.md) · [citizen](citizen.md) · [artifacts_and_engravings](artifacts_and_engravings.md) · [unmet_needs](unmet_needs.md)

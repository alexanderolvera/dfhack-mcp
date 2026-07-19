---
tool: fort_status
tier: sensor
gated: none
source: src/tools/fortStatus.ts
lua: src/dfhack-queries/mcp_fortStatus.lua
tags: [dfhack-mcp/tool]
---

# fort_status

> One-call situational overview of the currently loaded Dwarf Fortress fort.

## Purpose
The single-call snapshot: fort name, in-game date and season, population, created wealth, a happiness breakdown, and a pre-triaged list of alerts worth attention. An AI co-pilot typically calls this first each session to orient itself before reaching for the deeper sensors.

## Parameters
None.

## Returns
Top-level fields:
- `fort_name`, `date` (in-game), `season`
- `population` — citizen count
- `wealth` — created wealth
- `happiness` — `{miserable, unhappy, content, happy}` citizen counts
- `alerts[]` — pre-triaged strings worth attention

```json
{
  "alerts": [
    "7 hostiles on map"
  ],
  "date": "19th Obsidian, Year 7",
  "fort_name": "Fortress of Dreams",
  "happiness": {
    "content": 58,
    "happy": 16,
    "miserable": 0,
    "unhappy": 4
  },
  "population": 78,
  "season": "Winter",
  "wealth": 678023
}
```

## Caveats & limits
- Alerts are facts pre-triaged for attention (e.g. hostiles on map), not recommendations.
- Small fixed-size payload; no parameters, no pagination.
- Returns `{"error":"no fort loaded"}` if no fort is active — this is also the canonical probe for whether a fort is loaded at all.

## Related
- [threats](threats.md) ↔ [defenses](defenses.md) — drill into a hostile alert.
- [unmet_needs](unmet_needs.md) / [moods](moods.md) — drill into the happiness breakdown.
- [environment](environment.md) — the ambient-conditions companion snapshot.
- [chronicle](chronicle.md) — what has happened since the last look.

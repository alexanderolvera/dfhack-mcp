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
The single-call snapshot: fort name, in-game date and season, the fort's identity, population, created wealth, a happiness breakdown, recent deaths, and the count of hostiles on the map. An AI co-pilot typically calls this first each session to orient itself before reaching for the deeper sensors.

## Parameters
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| reveal_hidden | boolean | No | `false` | Bypass [fog of war](../../CONTRIBUTING.md#fog-of-war-the-reveal_hidden-opt-in): also read what stands on undiscovered tiles. The response reports the mode as `fog_of_war`. |

## Returns
Top-level fields:
- `fort_name`, `date` (in-game), `season`
- `identity`: `world_name` (`{dwarven, english}`), `save_folder`, `site_id`, `site_name` (`{dwarven, english}`), `civ_id`, `civ_name` (`{dwarven, english}`). The same object [game_state](game_state.md) reports; field paths are documented there.
- `population` — citizen count
- `wealth` — created wealth
- `happiness` — `{miserable, unhappy, content, happy}` citizen counts
- `recent_deaths` — deaths recorded AT THIS SITE within the last game year: `since_year` (the cutoff), `citizens` (the fort's own dead), `citizens_slain_by_citizen` (how many of those were killed by a fellow citizen), `outsiders_at_site` (dead who were not fort members), `citizen_causes[]` (`{cause, count}` for citizens only, most-common first, e.g. `THIRST`, `STARVATION`, `STRUCK_DOWN`)
- `hostiles_on_map` — discovered, living, non-citizen dangerous units on the map, caged/chained ones included (equals `threats`' `active_hostiles + contained`)
- `fog_of_war` — `"applied"` (the default) or `"bypassed"` (with `reveal_hidden=true`).

```json
{
  "date": "19th Obsidian, Year 7",
  "recent_deaths": {
    "since_year": 101,
    "citizens": 1,
    "citizens_slain_by_citizen": 0,
    "outsiders_at_site": 2,
    "citizen_causes": [{ "cause": "THIRST", "count": 1 }]
  },
  "fort_name": "Fortress of Dreams",
  "hostiles_on_map": 7,
  "identity": {
    "civ_id": 10,
    "civ_name": { "dwarven": "Uzoledzul", "english": "The Oily Vestibule" },
    "save_folder": "region1",
    "site_id": 25,
    "site_name": { "dwarven": "Geshud Nåzom", "english": "Fortress of Dreams" },
    "world_name": { "dwarven": "Emeanenu", "english": "The Eternal Planets" }
  },
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
- **A citizen is a member of the FORT GROUP** (`plotinfo.group_id`), not merely a dwarf. Another civilization's dwarves killed at your gate are counted in `outsiders_at_site`, never as your losses. This distinction is not cosmetic: on Torchbristled the two Year-102 killings at the site were both dwarves of civ 289 ("The Tongs of Labors") slain by fort citizens of civ 265 — outsiders repelled, not a loyalty cascade. Reading them as citizen-on-citizen murder (which the raw `site_history.notable_deaths` list invites, since it lists any histfig death at the site) inverts what actually happened.
- **`citizens_slain_by_citizen` is the murder / loyalty-cascade signal.** `threats` is scoped to hostiles by definition and will always report `[]` when the aggressor is one of your own, so this is the only field that surfaces the fact. It counts only deaths where BOTH victim and slayer hold fort membership.
- The death window is the last **1 game year** (`since_year` states the cutoff explicitly). It is a recency window, not fort history — use [site_history](site_history.md) for the full record.
- Deaths are read from DF's dedicated `history.events_death` index, scanned newest-first and stopped at the year cutoff, so cost is proportional to recent deaths rather than to world age.
- **Fog of war**: `hostiles_on_map` excludes any unit standing on an undiscovered tile — an undiscovered cavern's inhabitants never surface here (same gate as [threats](threats.md)).
- **Fog-of-war bypass**: with `reveal_hidden=true`, `hostiles_on_map` also counts hostiles on undiscovered tiles.
- Small fixed-size payload; no parameters, no pagination.
- Returns `{"error":"no fort loaded"}` if no fort is active. To find out what DF is doing when no fort is loaded, use [game_state](game_state.md), which works at any screen.

## Implementation notes
`recent_deaths` scans `df.global.world.history.events_death` — a purpose-built index of death events (2,740 entries on the Torchbristled world) rather than `history.events` (41,477 entries there). The vector is chronological, so the scan runs backward from the newest entry and breaks at the first event older than the cutoff, with a 5,000-entry backstop. This is what makes the read affordable in the fort's cheapest always-run tool: measured live, 68 entries visited in 0.002s, versus 0.32s for an equivalent backward scan over `history.events` and 4.5s for a full forward scan of it. Whole-tool time with the death scan included is ~0.011s.

Citizenship is tested by walking the victim's `entity_links` for a `MEMBER` link to `plotinfo.group_id` (the fort group), not by comparing `civ_id`. Comparing civs would be wrong in both directions: it counts a hostile dwarf civ's dead as neither ours nor outsiders correctly, and it would miss that DF keeps the `MEMBER` link intact after death (confirmed live — a citizen dead of thirst in Year 101 still carried `MEMBER:754`).


## Related
- [threats](threats.md) ↔ [defenses](defenses.md) — drill into `hostiles_on_map`.
- [unmet_needs](unmet_needs.md) / [moods](moods.md) — drill into the happiness breakdown.
- [environment](environment.md) — the ambient-conditions companion snapshot.
- [chronicle](chronicle.md) — what has happened since the last look.
- [game_state](game_state.md): versions, mode, pause and clock, readable without a fort.

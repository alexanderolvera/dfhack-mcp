---
tool: game_state
tier: sensor
gated: none
source: src/tools/gameState.ts
lua: src/dfhack-queries/mcp_gameState.lua
tags: [dfhack-mcp/tool]
---

# game_state

> What DFHack and Dwarf Fortress are doing right now, readable at any screen.

## Purpose
The one tool that works with no fort loaded. Every other game tool answers `{"error":"no fort loaded"}` at the title screen, so a client can't tell "DF is at the title screen" from "a fort is loaded but paused" from "DFHack is down" by calling them. `game_state` answers that directly: versions, game mode, whether a world and a map are loaded, whether the game is paused, the raw game clock (for scheduling checks in in-game time), and the identity of the loaded world and fort.

## Parameters
None.

## Returns
- `dfhack_version`: `dfhack.getDFHackVersion()`, e.g. `"53.15-r2"`
- `df_version`: `dfhack.getDFVersion()`, the running DF build string, e.g. `"v0.53.15 linux64 ITCH"`
- `mode`: `"title"` | `"fortress"` | `"adventure"` | `"other"`
- `world_loaded`, `map_loaded`: booleans
- `paused`: boolean, or `null` before a world is loaded
- `clock`: `{year, year_tick, date, season}`, or `null` before a world is loaded. `year_tick` runs 0 to 403,199 within a year (1,200 ticks a day, 33,600 a month). `date` and `season` are the same strings `fort_status` prints.
- `identity`: `null` before a world is loaded; otherwise
  - `world_name`: `{dwarven, english}`
  - `save_folder`: the save folder name, e.g. `"region1"`
  - `site_id`, `site_name` (`{dwarven, english}`), `civ_id`, `civ_name` (`{dwarven, english}`). These are filled in fortress mode only and are `null` in every other mode.

At the title screen:

```json
{
  "clock": null,
  "df_version": "v0.53.15 linux64 ITCH",
  "dfhack_version": "53.15-r2",
  "identity": null,
  "map_loaded": false,
  "mode": "title",
  "paused": null,
  "world_loaded": false
}
```

With the fixture fort loaded:

```json
{
  "clock": {
    "date": "19th Obsidian, Year 7",
    "season": "Winter",
    "year": 7,
    "year_tick": 391869
  },
  "df_version": "v0.53.15 linux64 ITCH",
  "dfhack_version": "53.15-r2",
  "identity": {
    "civ_id": 10,
    "civ_name": { "dwarven": "Uzoledzul", "english": "The Oily Vestibule" },
    "save_folder": "region1",
    "site_id": 25,
    "site_name": { "dwarven": "Geshud Nåzom", "english": "Fortress of Dreams" },
    "world_name": { "dwarven": "Emeanenu", "english": "The Eternal Planets" }
  },
  "map_loaded": true,
  "mode": "fortress",
  "paused": true,
  "world_loaded": true
}
```

## Caveats & limits
- If DFHack itself can't be reached, the call fails with the connection error. That is the "DFHack is down" signal, and it is different from `mode: "title"`.
- `mode` is `"title"` only when no world is loaded and DFHack's current focus is the title screen. Any other screen with no world loaded (world generation, for example) reads as `"other"`, as does a loaded world with no map (legends mode). Arena modes aren't told apart from fortress or adventure mode, and neither adventure nor arena mode has been checked live.
- `save_folder` is the folder name DF has for the current game. Fort names aren't unique across worlds, so a client that remembers forts can key on `world_name` + `site_id` and use `save_folder` as a label.
- Small fixed-size payload; cheap enough to poll every few seconds.
- The same `identity` object is on [fort_status](fort_status.md).

## Implementation notes
Field paths confirmed live against DFHack 53.15-r2 / DF 53.15 (the `df-headless:53.15` fixture), both at the title screen and with the fixture fort loaded:

| Field | Source | Title screen | Fixture fort |
| --- | --- | --- | --- |
| `dfhack_version` | `dfhack.getDFHackVersion()` | `53.15-r2` | same |
| `df_version` | `dfhack.getDFVersion()` | `v0.53.15 linux64 ITCH` | same |
| `world_loaded` / `map_loaded` | `dfhack.isWorldLoaded()` / `dfhack.isMapLoaded()` | `false` / `false` | `true` / `true` |
| mode inputs | `df.global.gamemode` (`df.game_mode`: `DWARF`=0, `ADVENTURE`=1, `NONE`=3), `dfhack.gui.getCurFocus(true)[1]` | `NONE`, `title/Default` | `DWARF`, `dwarfmode/Default` |
| `paused` | `df.global.pause_state` (agrees with `dfhack.world.ReadPauseState()`) | `false` (not meaningful, so not reported) | `true` |
| `clock.year` / `year_tick` | `df.global.cur_year` / `df.global.cur_year_tick` | `0` / `0` (not meaningful, so not reported) | `7` / `391869` |
| `world_name` | `dfhack.translation.translateName(df.global.world.world_data.name, english)` | `world_data` is `nil` | `Emeanenu` / `The Eternal Planets` |
| `save_folder` | `df.global.world.cur_savegame.save_dir` | `""` | `region1` |
| `site_id` / `site_name` | `df.global.plotinfo.site_id` (agrees with `world_data.active_site[0].id`), name via `df.world_site.find(id).name` | | `25` / `Geshud Nåzom`, `Fortress of Dreams` |
| `civ_id` / `civ_name` | `df.global.plotinfo.civ_id`, name via `df.historical_entity.find(id).name` | | `10` / `Uzoledzul`, `The Oily Vestibule` |

`civ_id` is the parent civilization, not the fort's own site government (`plotinfo.group_id`, "The Last Paddles" on the fixture), which `fort_status` uses to decide citizenship.

`df.global.world.world_data.name` has no `first_name` on the fixture world; `translateName` still renders both forms from the word list.

DFHack's Lua `json` module has no null value, so the Lua omits nil fields and `src/tools/gameState.ts` fills every documented key back in as `null`.

The clock formatting and the identity read are shared with `fort_status` through two `reqscript` modules: `mcp_gameDate.lua` (`current()` returns `{year, year_tick, date, season}`) and `mcp_identity.lua` (`read(fortress)` returns the identity, with site and civ fields only when `fortress` is true).

## Related
- [fort_status](fort_status.md): the fort snapshot, carrying the same `identity`.
- [game_save](game_save.md): checkpoint the fort.

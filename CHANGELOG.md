# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the major version is `0`, the tool surface is still stabilizing: **minor**
releases (`0.x.0`) may change or remove tool output, and **patch** releases
(`0.0.x`) are backwards-compatible fixes.

## [Unreleased]

### Added

- **`defenses` Level 2 — terrain-aware inside/outside** (issue #4). Each active
  threat is now classified `inside`/`outside` the fort's walled perimeter,
  defined concretely as sharing a DF walkability group with the fort's citizens
  (a threat can walk to your population through connected open space without
  breaching a wall). Adds `interior` (the citizen walk group(s)), per-threat
  `walk_group` + `location` + `footing` (the threat's own tile, fog-of-war
  respected), and `perimeter_terrain`: an ASCII tile grid of the busiest citizen
  level with wall/fortification and open-to-sky vs covered counts.
- **`mcp_readTerrain` shared terrain helper** (spike #10). A fog-of-war-safe
  single-z terrain reader used by `defenses` and future spatial tools:
  undiscovered tiles render as `?` and never leak their real type. Usable
  directly or via `reqscript`. Reads tiles in Lua (block-cached) rather than RFR
  `GetBlockList`, which leaks undiscovered terrain and ships a ~50× larger
  payload.

### Changed

- **Facts-only doctrine.** Tools report facts, not advice — they sense the game
  the way a player reads a screen, and judgment is left to the agent.
  - `defenses` no longer emits tactical `alerts` or `notes`; it returns only
    positions, the controllable-structure inventory, and the relative geometry
    between them. Caveats (walls not yet covered, lever↔bridge linkage not
    recorded) moved into the tool description.
  - `unmet_needs` no longer emits a `suggestion` per need; it reports the need
    type and how starved it is (`worst_focus`). How to satisfy a need is game
    knowledge the agent looks up.
  - Recorded the rule in the README's Contributing guide for future tools.

## [0.1.0] - 2026-07-16

### Added

- Initial public release — 13 read-only MCP tools over DFHack's Remote RPC:
  - **Sensors:** `fort_status`, `stocks`, `threats`, `unmet_needs`,
    `jobs_and_labor`, `military`, `injuries_and_health`, `defenses`, `find_unit`.
  - **Reference:** `game_data` (the loaded world's raws), `wiki_search`,
    `wiki_lookup`, and `identify` (raws + wiki fusion).
  - `run_lua` dev-only escape hatch, gated behind `DFHACK_MCP_DEV`.
- Version-fragile DFHack field access isolated in native `.lua` scripts invoked
  by name with argv (`src/dfhack-queries/`), so a DF/DFHack version bump is a
  localized fix.

[Unreleased]: https://github.com/alexanderolvera/dfhack-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/alexanderolvera/dfhack-mcp/releases/tag/v0.1.0

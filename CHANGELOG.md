# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the major version is `0`, the tool surface is still stabilizing: **minor**
releases (`0.x.0`) may change or remove tool output, and **patch** releases
(`0.0.x`) are backwards-compatible fixes.

## [Unreleased]

### Added

- **`game_data` — the remaining raws kinds** (issues #1, #2, #3). The unified
  `game_data` lookup now implements every kind; none report "not yet
  implemented". Each mirrors the creature contract (one strong hit → a curated
  dossier; several → a capped disambiguation list; none →
  `{match_count:0,matches:[]}`):
  - **`material`** — resolves via `dfhack.matinfo` over the loaded inorganics
    (metals, stones, gems, ores), plus a direct token lookup for
    fully-qualified `PLANT:`/`CREATURE:` tokens. Exposes token, state names
    (solid/liquid/gas), melting/boiling/ignite points as DF-urist + Celsius
    facts, a `flammable` flag, solid/liquid density, and curated notable flags.
  - **`plant`** — token, name, `type` (tree/grass/shrub), value, growth time,
    growth seasons, surface/subterranean + depth, biomes, `yields`
    (drink/seed/thread/mill/extract_*), growths, and produced materials.
  - **`reaction`** — token, name, required skill, building
    (category + workshop/furnace + custom workshop token), reagents, products.
  - **`item`** — itemdefs across all classes (weapon/armor/tool/ammo/…) with
    token, names, class, value, a per-class stat block, and weapon attacks.
  - **`building`** — custom (raws-defined) workshops: token, name, category,
    purpose, footprint, build stages, and the reactions available there.

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

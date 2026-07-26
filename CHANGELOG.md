# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
loosely while the tool surface is still evolving: **minor** releases (`1.x.0`)
may change or remove tool output, and **patch** releases (`1.0.x`) are
backwards-compatible fixes only.

## [Unreleased]

### Fixed

- `mandates_and_justice` crashed in any fort with a built cage.
- `threats`, `military`, and `defenses` disagreed on how many hostiles were on
  the map, and the latter two counted creatures the player had never
  discovered — `defenses` gave away their names and coordinates too. Undiscovered
  threats are now never listed at all, so `defenses.threats[].footing` no longer
  carries a `discovered` flag.
- `defenses` could pick a bridge many z-levels away as the nearest one.
- `injuries_and_health` reported long-healed dwarves as wounded and sleeping
  dwarves as unconscious, which could raise a false mass-casualty alert. Healed
  dwarves are now counted as `old_wounds_only`, sleepers as `asleep`.
- `artifacts_and_engravings` listed every artifact in the world rather than the
  fort's own. It is now site-scoped by default; `scope: "world"` returns the old
  list.
- `fluids` reported no water at all when the fort's water was frozen; it now
  reports ice in `ice_layers[]`.
- `fluids` and `defenses` returned map legends for symbols they never used.
- `map_overview` and `geology` both called their surface height `surface_z` while
  measuring different things — the fort-core column versus the whole embark, tens
  of levels apart on a sloped map. They are now `surface_z_at_core` and
  `surface_z_max`.
- `mandates_and_justice` counted restraints that were only placed, not built,
  toward the capacity to hold a convict; those are now reported separately.
- `unmet_needs.worst_focus` looked clamped at `-32640`, but the value was always
  right: the floor is `-16320 x` the dwarf's need level, so the same value across
  different needs is expected. Documented in the tool description — no values
  changed.

### Added

- `fort_status` reports recent citizen deaths and their causes, including when
  a dwarf was killed by another dwarf.
- `artifacts_and_engravings` reports whether engraving subjects can be resolved
  at all — DF does not load the art-image table in fortress mode, so usually
  they cannot.

## [1.4.0] - 2026-07-25

### Added

- **`stockpiles` sensor** ([#79](https://github.com/alexanderolvera/dfhack-mcp/issues/79))
  — one row per stockpile (accepted categories, bounds, container permissions,
  give/take links, and `occupied_tiles`), plus three fort-wide backlog signals:
  items sitting unstored, food already rotted while unstored, and items flagged
  for dumping.
- **`fluids` sensor** ([#80](https://github.com/alexanderolvera/dfhack-mcp/issues/80))
  — aquifer layers by light/heavy, standing water per z-level, the magma sea's
  top once struck, full-depth water exposed next to the fort's interior, and
  each well's water source and depth. Fog-of-war safe throughout.
- **`petitions` sensor** ([#81](https://github.com/alexanderolvera/dfhack-mcp/issues/81))
  — temple/guildhall location petitions and residency/citizenship petitions,
  with petitioner, age, status, and which are awaiting a decision right now.
  `warned_ready` catches the classic silent failure: agreed to, ready to build,
  never zoned.
- **`fort_health` sensor** ([#83](https://github.com/alexanderolvera/dfhack-mcp/issues/83))
  — the engine's own `fps`/`gfps`, fort-wide item counts broken out by the
  classic clutter candidates (stone, corpses, clothes), and unit counts split
  live vs. dead-on-map.
- **`hauling_routes` sensor** ([#84](https://github.com/alexanderolvera/dfhack-mcp/issues/84))
  — every minecart route with its stops, linked stockpiles, and departure
  conditions, plus fort-wide vehicle state including whether a vehicle's
  backing cart still exists (a destroyed cart silently stops a route).
- **Listed on the official MCP Registry** as `io.github.alexanderolvera/dfhack-mcp`.
  A new `server.json` describes the server for registry clients, published on
  every `v*` tag. Installing is unchanged — `npx -y dfhack-mcp` and the registry
  listing resolve to the same build.

### Changed

- **`trade` now reports each caravan's manifest and price agreements**
  ([#85](https://github.com/alexanderolvera/dfhack-mcp/issues/85)) — `manifest`
  is what the caravan itself carries (distinct from `goods_at_depot`);
  `agreements` is the liaison's active price agreements as `price_pct_min`/`max`
  (100 = no markup). If either read fails the row carries
  `manifest_error`/`agreements_error` instead, so a bug can't look like "nothing
  to report."
- **`zod` is now a direct dependency** (`^4.4.3`). It was only ever a transitive
  install of the MCP SDK, so an SDK bump could have moved zod majors underneath
  the server's schemas. A new metadata test also guards the
  `package.json` ↔ `server.json` contract so a forgotten version bump fails at
  PR time rather than mid-release.

### Fixed

- **DF names arrived mangled.** DF stores text in CP437, so any accented
  character in a generated name — very common — decoded as `U+FFFD`:
  `Såkzul Kelkosh` read as `S�kzul Kelkosh`. Every tool that reports a name was
  affected, since v0.1.0. Names are now converted to UTF-8 at the point of
  serialization.
- **`trade` hid half its price agreements.** Both agreement lists capped at 30
  rows *after* an alphabetical sort, so everything past `Headwear` was silently
  dropped — a real caravan has 61 import categories. The cap sat below DF's own
  enum ceiling, so it cost data without bounding anything; raised to 150.

## [1.3.0] - 2026-07-22

### Added

- **`burrows` sensor + `civilian_alert` actuator**
  ([#77](https://github.com/alexanderolvera/dfhack-mcp/issues/77)) — "siege
  spotted, everyone inside." `burrows()` reports each burrow's exact tile count,
  assigned units, and whether it's a civilian-alert safety burrow;
  `civilian_alert(burrow, enabled)` toggles one in or out of that set and sounds
  or silences the alarm to match. Uses the same slot as the in-game Squads alert
  button. Reversal: the same call inverted.
- **`mechanisms` sensor + `pull_lever` actuator**
  ([#78](https://github.com/alexanderolvera/dfhack-mcp/issues/78)) — lever
  wiring, made legible. Lists every lever with its position, state, and linked
  targets (with each target's own open/closed state), every pressure plate's
  targets and trigger conditions, and which levers and bridges are wired to
  nothing. `pull_lever(lever_id, urgent?)` queues a real pull job rather than an
  instant toggle, so the flip happens when a dwarf completes it.
- **`military` squad equipment depth**
  ([#82](https://github.com/alexanderolvera/dfhack-mcp/issues/82)) — fulfills
  the long-promised `equipment_gaps`: the co-pilot can now say "8 of them have
  no armor," not just "you have 21 soldiers." Each squad reports `roster[]`
  (per-soldier uniform gaps and a `uniform_complete` flag), `ammo`, and
  `training`; `alerts[]` names anyone with an incomplete uniform.

## [1.2.0] - 2026-07-21

### Added

- **`nobles_and_administrators` sensor**
  ([#75](https://github.com/alexanderolvera/dfhack-mcp/issues/75)) — every
  appointed position with its holder or vacancy, the bookkeeper's precision
  level, pending mayoral election, and monarch arrival state. A vacant position
  is a common, previously invisible cause of work-order/trade/justice failures;
  `superseded_by` marks the expected vacancies so they don't read as problems.
- **`farming` sensor**
  ([#76](https://github.com/alexanderolvera/dfhack-mcp/issues/76)) — each plot's
  size, crop assignment per season, and seed availability, plus fort-wide seed
  totals by plant. `no_crop_assigned` flags an idle plot before it becomes a
  food crisis.
- **`livestock_and_pastures` sensor**
  ([#74](https://github.com/alexanderolvera/dfhack-mcp/issues/74)) — tame animals
  by species/sex/age, pets vs. livestock, grazers with no pasture (silent
  starvation), egg-layer and nestbox coverage, animals marked for slaughter,
  training state, occupied cages, and how many roam unassigned.
- **Small extensions to three existing tools**
  ([#87](https://github.com/alexanderolvera/dfhack-mcp/issues/87)):
  - `rooms_and_zones`: `ghosts` — active apparitions, plus a count of this civ's
    world-flagged unquiet dead not visible locally.
  - `stocks`: `clothing` — citizens in worn-out gear, and how many wear no shoes
    at all. A chronic, easy-to-miss stress source.
  - `jobs_and_labor`: `cancellations` — job cancellations aggregated by reason,
    surfacing a systemic cause (e.g. 7× "Equipment mismatch") that otherwise
    reads as unrelated one-offs.

### Fixed

- **`livestock_and_pastures` counted dead animals as living livestock.** On the
  test fixture, 187 of 264 `isTame` matches were corpses whose unit records
  linger. `tame_total` fell 264 → 77 and `unassigned_count` 206 → 19; every
  downstream count was affected.
- **`livestock_and_pastures` and `rooms_and_zones.ghosts` leaked
  undiscovered-map units** — both enumerated units without the required
  fog-of-war gate. Now filtered, and tame animals additionally require
  `isOwnCiv`, so a visiting caravan's pack animal isn't counted as yours.
- **`livestock_and_pastures.egg_layers` counted juveniles that can't lay yet.**
  `LAYS_EGGS` is a caste capability, not an age-independent fact; now gated on
  adulthood, which corrected the fixture's count from 96 to 13. `grazers` has no
  such gate — a juvenile still grazes.
- **`jobs_and_labor.cancellations` counted report rows, not occurrences.** DF
  collapses repeats into one report with a `repeat_count`; a 7-row cluster was
  really 61 occurrences. Now weighted correctly.
- **`farming` claimed "no eligible crop" but only checked "no crop assigned."**
  Added a per-season `eligible` fact and a plot-level `no_eligible_crop`.
- **Several lists were unbounded** and could grow without limit on old or modded
  forts: `farming.plots[]`, `farming.seed_totals[]`,
  `livestock_and_pastures.cages[]`, its per-cage `occupants[]`, and `by_group[]`
  are now all capped with truncation flags.
- **`livestock_and_pastures` nestbox coverage used a bounding-box check**, so an
  irregular pen could report coverage for a tile outside the zone. Now uses
  DF's own containment check.
- **`rooms_and_zones`'s ghost alert reported the capped count**, so it always
  read "50 active ghosts" past that point. Now uses the true total with a `+`
  when truncated.
- **`nobles_and_administrators` holders could omit their only stable id.**
  Holders now always carry `histfig_id`; `unit_id` appears only when a live unit
  exists. A vacant position's `holders[]` also no longer arrives as `{}` instead
  of `[]`.
- **`farming.seasons[].seeds_available` duplicated `seed_totals[]`** — removed;
  join a season's `crop` against `seed_totals[]` instead.
- **Renamed two misleading fields.** `stocks.tattered_citizens` →
  `worn_citizens` (the threshold always included both heavily-worn *and*
  tattered stages); `farming.plots[].surface` → `open_to_sky` (it reports light
  exposure, not depth — a roofed surface plot and an underground one both read
  `false`).
- **`environment_wellformed` invariant checked a field removed in 1.1.0**, so it
  always failed on `undefined`. A stale test, not a live-data bug.
- **Doc corrections** — `stocks.md` wrongly excluded cloaks and shirts from its
  clothing caveat; `rooms_and_zones.unquiet_dead_count` overstated its
  fog-of-war guarantee; `docs/VERIFY.md` had a stale tool count.

## [1.1.0] - 2026-07-21

### Fixed

- **A failing script could be re-executed on retry**
  ([#64](https://github.com/alexanderolvera/dfhack-mcp/issues/64)) — a script
  error was indistinguishable from a transport error, so it triggered a
  reconnect-and-retry, risking a second run of an actuator that had already
  partially applied. Real RPC failures now rethrow; only transport errors retry.
- **The wiki cache escaped the npm package**
  ([#65](https://github.com/alexanderolvera/dfhack-mcp/issues/65)) — the path
  didn't survive bundling and resolved outside the package. Now uses an OS
  per-user cache dir, overridable via `DFHACK_MCP_CACHE_DIR`.
- **T0 only ever tested the actuators-on surface**
  ([#68](https://github.com/alexanderolvera/dfhack-mcp/issues/68)) — never the
  default read-only surface npm users actually get, and `run_lua` had no
  coverage at all. T0 now runs both gate states.
- **`docs/tools/game_save.md` was missing entirely**, and the tool index counts
  had gone stale.
- **Two live-verification scripts weren't wired to anything** and had silently
  rotted. Added `npm run verify:game-data` / `verify:wiki` so they can't again.

### Removed

- **`identify`'s `tactics[]` field** — a hand-curated summary that mostly
  restated the dossier's own `flags[]`/`interactions[]`, for the cost of a
  second source of truth that could drift. Its `ranged` derivation also
  overfired on any interaction, including a cat's head-bump
  ([#66](https://github.com/alexanderolvera/dfhack-mcp/issues/66)).
- **A batch of redundant output fields and alert lines**, each a second encoding
  of a fact already present in the same response: `blurb`
  (duplicated `description`), plant `subterranean` (the negation of `surface`),
  `is_current_citizen`, `temperature_band`, and several `alerts[]` lines that
  merely restated labeled counts. `geology`'s `alerts[]` is gone entirely.
  `game_data` material's `name` and `chronicle`'s `cursor` look similar but were
  deliberately kept — one preserves a uniform dossier envelope, the other is the
  ergonomic name for a specific use.

### Changed

- **Repo-wide comment-hygiene pass.** Field paths, version quirks, and design
  rationale moved out of code comments into each tool's `docs/tools/*.md` page,
  or into `CONTRIBUTING.md` for cross-cutting internals. No output, schema, or
  logic changed.

## [1.0.0] - 2026-07-19

The tool surface is complete and stable: **27 read-only sensors + reference
tools** plus **5 opt-in actuators** (behind `DFHACK_MCP_ACTUATORS`; the default
server stays strictly read-only). First release published to npm — install with
`npx -y dfhack-mcp`, no build step.

### Added

- **Actuator foundation — the mutation contract** (issue #8) — `src/actuator.ts`
  implements the shared dry-run → single-use `confirm_token` → apply →
  undo-handle loop once, so each actuator supplies only its own plan/apply
  bodies. Tokens are single-use and scoped to the operation's own targets. The
  `DFHACK_MCP_ACTUATORS` gate keeps every mutating tool out of `tools/list`
  unless explicitly enabled.
- **Manager work orders** (issue #24) — `work_order_create` / `work_order_cancel`
  actuators plus an always-available `work_order_list` sensor. Create flags
  `would_duplicate` and `manager_present`; cancel returns a recreate spec as its
  undo handle.
- **Quickfort blueprints** (issue #25) — `blueprint_apply` / `blueprint_undo`,
  dig and zone only. `blueprint_apply` without a token *is* the preview. A
  malformed blueprint partially applies rather than erroring in quickfort, so
  the preview blocks outright on invalid keys or undesignatable tiles.
  Fog-of-war tiles under the footprint are reported, never blocked.
- **Labor via work details** (issue #26) — a `work_details()` sensor plus the
  `assign_work_detail` actuator. The game only reconciles a unit's labors on a
  frame advance, so apply mirrors them immediately to match what the game would
  settle on.
- **`game_data` — the remaining raws kinds** (issues #1, #2, #3) — `material`,
  `plant`, `reaction`, `item`, and `building` dossiers now all implemented, each
  mirroring the creature contract (one strong hit → dossier; several → a capped
  disambiguation list; none → an empty match set).
- **`game_data` plant `farm_plantable`** (issue #35) — DF's own farm-plot
  eligibility as a labeled boolean. Probed live, it yields exactly the vanilla
  crop roster and correctly excludes gather-only wild shrubs and seeded trees.
- **`citizen(unit_id)` — the character sheet** (issue #13) — a deep dossier on
  one dwarf: the walkable social graph (each relation carries a `unit_id` you
  can pass back in), worshipped deities, notable personality extremes, skills,
  likes, and recent thoughts tied to current stress.
- **`defenses` terrain-aware inside/outside** (issue #4) — each threat is
  classified by whether it shares a walkability group with your citizens, i.e.
  whether it can reach them without breaching a wall. Adds per-threat position
  and footing, plus a perimeter terrain grid.
- **`mcp_readTerrain` shared terrain helper** (spike #10) — a fog-of-war-safe
  single-z reader where undiscovered tiles render as `?` and never leak their
  real type. Reads tiles in Lua rather than over RPC, which leaked undiscovered
  terrain and shipped a ~50× larger payload.

### Changed

- **Facts-only doctrine.** Tools report what is true and leave judgment to the
  agent. `defenses` no longer emits tactical advice, and `unmet_needs` no longer
  suggests how to satisfy a need — both now report only the underlying facts.

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

[Unreleased]: https://github.com/alexanderolvera/dfhack-mcp/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/alexanderolvera/dfhack-mcp/compare/v1.2.0...v1.4.0
[1.3.0]: https://github.com/alexanderolvera/dfhack-mcp/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/alexanderolvera/dfhack-mcp/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/alexanderolvera/dfhack-mcp/compare/v1.0.1...v1.1.0
[1.0.0]: https://github.com/alexanderolvera/dfhack-mcp/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/alexanderolvera/dfhack-mcp/releases/tag/v0.1.0

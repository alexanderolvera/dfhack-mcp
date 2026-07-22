# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
loosely while the tool surface is still evolving: **minor** releases (`1.x.0`)
may change or remove tool output, and **patch** releases (`1.0.x`) are
backwards-compatible fixes only.

## [1.2.0] - 2026-07-21

### Added

- **`nobles_and_administrators` sensor** ([#75](https://github.com/alexanderolvera/dfhack-mcp/issues/75))
  — every appointed fort position (manager, bookkeeper, broker, chief medical dwarf,
  sheriff, captain of the guard, expedition leader/mayor, militia commander/captain,
  hammerer, dungeon master, messenger, champion, and any baron+ the site has grown
  into) with its holder(s) or vacancy, plus the bookkeeper's precision level, whether
  a mayoral election is pending, and monarch arrival state. A vacant position is a
  common, previously invisible cause of `work_order_create`/`trade`/justice-punishment
  failures; `superseded_by` explains the expected vacancies (sheriff → captain of the
  guard, expedition leader → mayor) so they don't read as problems.
- **`farming` sensor** ([#76](https://github.com/alexanderolvera/dfhack-mcp/issues/76))
  — the early-survival pipeline between `game_data`'s abstract "what's plantable" and
  `stocks`'s food *outputs*: each farm plot's tile size, surface/underground status,
  crop assignment per season (fallow if none), and seed availability for that crop;
  plus fort-wide seed totals by plant. `no_crop_assigned` flags an idle plot before it
  becomes a food crisis.
- **`livestock_and_pastures` sensor** ([#74](https://github.com/alexanderolvera/dfhack-mcp/issues/74))
  — the single largest post-v1.0 blind spot: every fort manages animals and `threats`
  only ever saw hostiles. Reports tame animal counts by species/sex/adult, pets vs.
  livestock, which grazers have no pasture (they can't graze — silent starvation),
  egg-layer/nestbox coverage, animals marked for slaughter, war/hunting training
  state, occupied cages, and how many animals are roaming unassigned.
- **Cheap sensor extensions bundle** ([#87](https://github.com/alexanderolvera/dfhack-mcp/issues/87))
  — three small additions to existing tools:
  - `rooms_and_zones`: `ghosts` — active apparitions currently on the map, plus a
    count of this civ's dead who are world-flagged unquiet ghosts
    (`historical_figure.flags.ghost`) with no apparition currently active locally.
  - `stocks`: `clothing` — citizens wearing tattered (`wear >= 2`) shoes, armor,
    pants, gloves, or a helm, plus a fort-wide no-shoes-worn count — a chronic,
    easy-to-miss stress source.
  - `jobs_and_labor`: `cancellations` — recent job-cancellation announcements
    aggregated by reason (`chronicle` reports each one individually but never
    summed them), surfacing a repeating systemic cause (e.g. 7x "Equipment
    mismatch") that would otherwise read as unrelated one-off events.

  Two items from the original issue were scoped out rather than shipped
  unreliable or duplicated: `stocks`' proposed "seed totals by plant" is now
  `farming`'s `seed_totals[]` (shipped in this same release, #76) — adding a
  second copy in `stocks` would have been exactly the kind of second-source-of-
  truth drift this project avoids. `rooms_and_zones`' proposed "unmemorialized
  dead with no corpse" was dropped after live verification showed the natural
  heuristic (a dead citizen with no loose `CORPSE`/`CORPSEPIECE` item) can't
  distinguish "buried long ago" from "corpse lost forever" — both look identical
  once the item is gone — so it would have misreported safely-buried citizens as
  ghost-risk. `ghosts.unquiet_dead_count` (above) reports the same underlying
  concern from a field DF itself computes, instead.

### Fixed

- **`environment_wellformed` invariant checked a removed field** — `environment`'s
  `temperature_band` was cut in 1.1.0 (a redundant 3rd encoding of `water_frozen`),
  but `test/invariants.mjs` still asserted it was one of `freezing`/`above_freezing`/
  `unknown`. Since the field no longer exists, the check always failed on `undefined`
  — a stale test, not a live-data bug. Rewritten to check the surviving
  `temperature`/`water_frozen` pair only.
- **`livestock_and_pastures` and `rooms_and_zones.ghosts` leaked undiscovered-map
  units** — both new sensors enumerated `world.units.active` without the mandatory
  `mcp_unitVisibility` fog-of-war gate CONTRIBUTING.md requires of every unit-listing
  tool (the same class of bug fixed on `threats`/`fort_status` before v1.0). Fixed by
  filtering every unit fact (the tame-animal enumeration, cage occupants, active
  ghosts) through `is_hidden(u)`; the tame-animal enumeration also now requires
  `dfhack.units.isOwnCiv(u)` so a visiting caravan's or diplomat's pack animal is
  never counted as this fort's livestock.
- **`nobles_and_administrators` holders could omit their only stable id** — a
  position holder living off-map (no loaded unit) had neither field the shipped
  invariant required. Holders now always carry `histfig_id`; `unit_id` remains
  present only when a live unit exists.
- **`farming` claimed "no eligible crop" but only checked "no crop assigned"** — a
  plot with a crop assigned in every season, none of them actually eligible for
  their season, read as fine. Added a per-season `eligible` fact (the plant raw's
  own season flag) and a plot-level `no_eligible_crop`, deliberately NOT extended to
  surface/depth eligibility — live verification found a plant flagged surface-only
  (`REED_ROPE`, `underground_depth_min == max == 0`) successfully planted
  underground in the fixture, so asserting a depth rule would have been wrong, not
  just incomplete.
- **Unbounded payload risk on two new list fields** — `farming.plots[]` (no cap:
  an old/modded fort's plot count could grow without bound) and
  `livestock_and_pastures.cages[]` (same, for occupied cages) now cap at 200 and 50
  respectively, each with the established `total`/`truncated` pair. `NEST_BOX`
  buildings still under construction no longer count toward nestbox coverage.
- **`nobles_and_administrators` position `holders[]` could arrive as `{}`** — a
  vacant position's empty nested Lua table wasn't coerced to `[]` like every other
  nested list field in this release, so `.length`/`.forEach()` would have thrown
  for a vacant position.
- **`farming.seasons[].seeds_available` duplicated `seed_totals[]`** — the exact
  same fort-wide count was repeated under every plot/season growing that crop
  (the shipped invariant literally required the two copies stay identical — a
  clear sign it was pure duplication, not new information, contrary to this
  project's own rule against re-packaging a fact already in the same payload).
  Removed; join a season's `crop` token against `seed_totals[]` instead.
- **`jobs_and_labor.cancellations` counted report rows, not occurrences** — DF
  collapses consecutive identical job cancellations into one report and tallies
  the extras in that report's `repeat_count` (the same field `chronicle` already
  exposes), so a reason repeating for months could still read as a handful of
  rows. Now weighted by `1 + repeat_count` per report; verified live against the
  fixture, a 7-row "Equipment mismatch" cluster was actually 61 occurrences once
  weighted.
- **`livestock_and_pastures` nestbox coverage used a same-z bounding-box check**
  — an irregularly-shaped or hole-containing pen could report nestbox coverage
  for a tile that was never actually part of the zone. Switched to
  `dfhack.buildings.containsTile`, the same containment check `tile_region`
  already uses for building extents.
- **`rooms_and_zones`'s active-ghost alert reported the capped count, not the
  real one** — with more than 50 active ghosts, the alert would read exactly
  "50 active ghosts" regardless of the true total, silently hiding the overflow
  `active_truncated` was meant to flag. The alert now uses the pre-cap total,
  with a `+` suffix when truncated.

## [1.1.0] - 2026-07-21

### Fixed

- **`dfclient` retry re-executes failing scripts** ([#64](https://github.com/alexanderolvera/dfhack-mcp/issues/64))
  — a script failure (DFHack reachable, the script ran and errored) was indistinguishable
  from a transport failure, so it triggered a reconnect-and-retry — risking a second
  execution of an actuator that had already partially run. `RpcError` (a real FAIL frame)
  is now rethrown as-is; only genuine transport errors reconnect and retry once.
- **wiki cache dir escaped the npm package** ([#65](https://github.com/alexanderolvera/dfhack-mcp/issues/65))
  — the cache path was computed relative to the source module's depth, which doesn't
  survive tsup's single-file bundle: for an npm/npx install it resolved to
  `node_modules/cache`, outside the package. Now uses an OS per-user cache dir
  (`$XDG_CACHE_HOME`/`%LOCALAPPDATA%`/`~/.cache`, under `dfhack-mcp`), overridable via
  `DFHACK_MCP_CACHE_DIR`.
- **`verify` T0 always forced the actuator gate** ([#68](https://github.com/alexanderolvera/dfhack-mcp/issues/68))
  — T0 unconditionally set `DFHACK_MCP_ACTUATORS=1` before deriving the expected tool
  set, so it only ever asserted the full actuators-on surface and never the default
  read-only surface npm users actually get; the dev-only `run_lua` also had zero
  coverage anywhere. T0 now runs twice against isolated subprocesses — gates off
  (default surface) and gates on (full surface, including `run_lua`) — and
  `docs/VERIFY.md` documents both passes.
- **`docs/tools/game_save.md` was missing entirely** — the actuator shipped without
  its doc page. Added, and `docs/tools/README.md`'s tool/actuator counts corrected
  (34 tools, 6 actuators — they'd gone stale when `game_save` landed).
- Two orphaned-but-functional live-verification scripts (`scripts/verify-game-data.mjs`,
  `scripts/verify-wiki.mjs`) weren't wired to any npm script or doc, the same way
  `verify-identify.mjs` had silently rotted (see Removed). Added `npm run verify:game-data`
  / `npm run verify:wiki` and a `docs/VERIFY.md` section so they can't quietly stop working
  again.

### Removed

- **`identify`'s `tactics[]` field** — a hand-curated summary (`trapavoid`, `flier`,
  `fire`, `building_destroyer`, `webber`, `ranged`) that mostly restated values already
  present in the returned `creature.flags[]`/`interactions[]`, for the cost of a second,
  driftable source of truth. Its `ranged` derivation had its own overfire bug
  ([#66](https://github.com/alexanderolvera/dfhack-mcp/issues/66) — it fired on any
  interaction, including a cat's "Clean"/"Head bump") before the field was cut entirely.
  The dossier's own `flags[]`/`interactions[]` carry the same facts directly; `identify`'s
  fire-vs-building-destroyer wiki-page selection (unrelated to this field) is unaffected.
  The orphaned dev script `scripts/verify-identify.mjs` (a stale import predating
  `identify`'s split into a directory) was removed alongside it.
- **A handful of redundant output fields and `alerts[]` lines**, each a second encoding
  of a fact already present elsewhere in the same response, found in a repo-wide audit
  for the same pattern as `tactics[]`:
  - `game_data`/`identify` creature dossier: `blurb` (a duplicate of `description`,
    already redundant once both are present — `blurb` still appears alone on
    disambiguation-list stubs, where `description` isn't returned).
  - `game_data` plant dossier: `subterranean` (the exact negation of `surface`, sitting
    next to it).
  - `artifacts_and_engravings` maker: `is_current_citizen` (a boolean restating whether
    `unit_id` is present — `top_engravers[]` in the same tool already uses the
    presence-of-`unit_id` convention alone, with no such twin).
  - `environment`: `temperature_band` (a 3-state string restating the 3-state
    `water_frozen`/`null`).
  - `fort_status` alert: "N dwarves miserable" (restates `happiness.miserable`, already
    a labeled count in the same response).
  - `injuries_and_health` alerts: "N dwarves need medical care" and "top care need: ..."
    (restate the already-emitted `patients` count and `care_needs[0]`).
  - `moods` alert: the unclaimed-workshop line (restates each `active[]` row's own
    `workshop_status`/`name`/`mood` fields).
  - `military` alert: the base "N hostiles on map vs M soldiers in K squads" sentence
    (re-concatenates `hostiles_on_map`/`soldiers`/`squad_count`, all already top-level
    fields); the genuine "NO defenders against a great-danger creature" callout is kept.
  - `threats` alert: "N dangerous creatures caged/chained" (restates the already-emitted
    `contained` field).
  - `geology`'s `alerts[]` field is removed entirely — both of its lines (aquifer range,
    magma reached) were pure restatements of the already-emitted `aquifer` object and
    `magma_reached` boolean, and nothing legitimate was left in the array once they were
    cut.

  Two similar-looking cases were reviewed and deliberately **kept**: `game_data`
  material's `name` (duplicates `state_names.solid`, but every dossier kind shares a
  uniform `{kind, token, name, ...}` envelope, so dropping it only for `material` would
  break that consistency) and `chronicle`'s `cursor` (duplicates `newest_retained_id`,
  but is the ergonomic, self-documenting name for the specific "pass this back as
  `since`" use case).

### Changed

- **Repo-wide comment-hygiene pass.** All 28 `dfhack-queries/*.lua` scripts and the
  TypeScript source, scripts, and tests were swept per a new convention recorded in
  `AGENTS.md`: no comment blocks in code — confirmed DFHack field paths, version
  quirks, and design rationale now live in each tool's `docs/tools/*.md` page (a new
  "Implementation notes" section on most of them) or, for cross-cutting internals with
  no single tool doc (`mcp_readTerrain.lua`/`mcp_unitVisibility.lua`'s fog-of-war gates,
  the actuator contract, connection retry), a new "Shared internals" section in
  `CONTRIBUTING.md`. JSDoc is now reserved for functions genuinely consumed across a
  module boundary, written as a tagged summary rather than untagged prose. No output,
  schema, or logic changed — verified via `luac -p` on all 28 Lua files, `tsc --noEmit`,
  the full lint/unit-test suite, and a live T0 run.

## [1.0.0] - 2026-07-19

The tool surface is complete and stable: **27 read-only sensors + reference
tools** plus **5 opt-in actuators** (behind `DFHACK_MCP_ACTUATORS`; the default
server stays strictly read-only). First release published to npm — install with
`npx -y dfhack-mcp`, no build step.

### Added

- **`game_data` plant — a defensible `farm_plantable` fact** (issue #35). Each plant
  dossier now carries `farm_plantable`, DF's own farm-plot eligibility as a labeled
  boolean: `true` iff the plant has a plantable seed (the `SEED` flag) and is neither
  a tree nor a grass. This closes the crop/wild-shrub gap that deferred #35: probed
  live on 53.15, the rule yields exactly the vanilla crop roster (110 plants) and
  correctly excludes the two gather-only wild shrubs that carry no seed (kobold bulb,
  valley herb) and the 47 seeded trees you cannot farm. Facts only — the same
  classification the game uses to build a plot's planting list, not advice.
- **A2 actuators — quickfort blueprints** (issue #25, behind `DFHACK_MCP_ACTUATORS`).
  The highest-value actuator: an agent drafts a quickfort CSV and applies it to
  designate dig/zone. `blueprint_apply` and `blueprint_undo` (gated, dry-run →
  confirm → apply → undo) built on the §A0 foundation; there is no separate read
  sensor — `blueprint_apply` without a `confirm_token` _is_ the preview, and its
  dry-run parses quickfort's own statistics. The malformed-CSV gate (spike #11): a
  bad blueprint does not error in quickfort — it partially applies — so the dry-run
  blocks (no token) whenever it reports invalid key sequences or undesignatable
  tiles. Fog-of-war tiles under the footprint are surfaced as a fact (never blocked).
  Reversal is quickfort's native undo, whose handle is `faithful:true` only when no
  footprint tile carried a pre-existing designation; when some did, undo would clear
  those too, so the handle is `faithful:false` with a `not_reproduced` note. v1 scope: dig + zone only;
  build/place are rejected. Verified live end-to-end on the fixture: dig
  preview → apply → undo (dig flag 0→1→0), zone preview → apply → undo (civzone
  0→4→0), the malformed/unsupported-mode blocks, and the tamper/replay token
  rejections.
- **A3 — labor via work details** (issue #26, behind `DFHACK_MCP_ACTUATORS`). A
  read-only `work_details()` sensor (always available) lists every work detail with
  its mode, the labor tokens it enables, and its assigned citizens (id-sorted,
  capped at 200 with a `members_truncated` flag + full `member_count`, plus
  `member_names`). The gated `assign_work_detail(unit_id, detail, enabled)` actuator
  adds/removes one citizen to/from one detail; the preview flags `currently_member`,
  `resulting_members_count`, and `only_member` as facts, an already-satisfied
  request previews as a no-op, and the reversal is the same call with `enabled`
  inverted (`prior_member` echoed; the undo handle also carries `prior_labors`, the
  exact pre-edit labor-cache bytes, and is `faithful:true` only when that cache was
  already consistent — `faithful:false` with a `not_reproduced` note when some
  affected labor's cache was stale and the inverse recomputes rather than restores
  it). Resolves the spike-flagged
  labor-propagation risk: `assigned_units` (at
  `df.global.plotinfo.labor_info.work_details`) is the durable source of truth, and
  because the game reconciles `unit.status.labors` from it only on a frame advance
  (its automatic-professions system), `apply` mirrors the affected labors onto the
  unit immediately — recomputed as the union across all details, matching what the
  game reconciles to. Verified live end-to-end on the fixture (assign → member +
  labors propagate → restore), including the no-op and tamper/replay rejections.
- **A1 actuators — manager work orders** (issue #24, behind `DFHACK_MCP_ACTUATORS`).
  The first actuators built on the §A0 foundation: `work_order_create` and
  `work_order_cancel` (gated, dry-run → confirm → apply → undo) plus a read-only
  `work_order_list` sensor (always available; the Q1 manager-screen view and the
  actuators' readback). Create flags `would_duplicate` and `manager_present`; cancel
  returns a recreate spec as its undo handle. Verified live end-to-end on the fixture
  (create → appears in list → cancel → gone), including the tamper/replay rejections.
  The validation lane also refined the foundation: actuators now pass the
  `{error:'no fort loaded'}` guard straight through (like every read tool), and the
  verify harness exercises the full gated surface via safe dry-runs.
- **Actuator foundation — the §A0 mutation contract** (issue #8 §A0; de-risked by
  spike #11). `src/actuator.ts` implements the shared dry-run → single-use
  `confirm_token` → apply → undo-handle + readback loop once, so the coming
  `work_order_*` / `blueprint_*` / `assign_work_detail` tools supply only their
  version-fragile `plan()`/`apply()` bodies. Tokens are single-use and scoped to
  the operation's **own** targets (an unrelated world change does not void them; a
  change to the target does). A new `DFHACK_MCP_ACTUATORS` gate keeps every
  mutating tool out of `tools/list` unless explicitly enabled — **the default
  server remains strictly read-only**. Adds `npm run test:unit` (node:test,
  CI-gated) covering the protocol, and a `docs`/README section on the contract.
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
- **`citizen(unit_id)` — the character sheet** (issue #13). A deep dossier on
  one citizen, chained by `unit_id` from `find_unit` (or `chronicle`). Where
  `find_unit` stays compact, `citizen` is the depth: the walkable social graph
  (spouse, parents, children, friends, grudges — each with a `unit_id` you can
  pass back into `citizen` to walk the graph), worshipped deities with worship
  strength, NOTABLE personality extremes (top/bottom facets only, not the full
  50-facet dump), skills of note, likes/detests, physical highlights, and recent
  thoughts phrased as the game phrases them, tied to current stress. Friends are
  positive-affection acquaintances; grudges are relationships gone negative, each
  carrying its raw love/trust/respect scores as labeled facts. Empty categories
  degrade to `[]`; a missing/invalid `unit_id` yields a labeled `{error}`, never
  a traceback. Facts only — it senses, it does not advise. `find_unit`'s
  description now points at `citizen` for depth.

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

[Unreleased]: https://github.com/alexanderolvera/dfhack-mcp/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/alexanderolvera/dfhack-mcp/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/alexanderolvera/dfhack-mcp/compare/v1.0.1...v1.1.0
[1.0.0]: https://github.com/alexanderolvera/dfhack-mcp/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/alexanderolvera/dfhack-mcp/releases/tag/v0.1.0

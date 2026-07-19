# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
While the major version is `0`, the tool surface is still stabilizing: **minor**
releases (`0.x.0`) may change or remove tool output, and **patch** releases
(`0.0.x`) are backwards-compatible fixes.

## [Unreleased]

### Added

- **A2 actuators — quickfort blueprints** (issue #25, behind `DFHACK_MCP_ACTUATORS`).
  The highest-value actuator: an agent drafts a quickfort CSV and applies it to
  designate dig/zone. `blueprint_apply` and `blueprint_undo` (gated, dry-run →
  confirm → apply → undo) built on the §A0 foundation; there is no separate read
  sensor — `blueprint_apply` without a `confirm_token` _is_ the preview, and its
  dry-run parses quickfort's own statistics. The malformed-CSV gate (spike #11): a
  bad blueprint does not error in quickfort — it partially applies — so the dry-run
  blocks (no token) whenever it reports invalid key sequences or undesignatable
  tiles. Fog-of-war tiles under the footprint are surfaced as a fact (never blocked).
  Reversal is quickfort's native undo (`faithful:true`). v1 scope: dig + zone only;
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

[Unreleased]: https://github.com/alexanderolvera/dfhack-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/alexanderolvera/dfhack-mcp/releases/tag/v0.1.0

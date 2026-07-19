# dfhack-mcp

An [MCP](https://modelcontextprotocol.io) server that exposes a **live Dwarf
Fortress fort** to an AI agent as a small set of **curated, semantic tools** — a
fortress co-pilot and early-warning advisor, not an autopilot. **Read-only** in
v1: the tools observe the game, they never change it.

It rests on two pillars:

- **Sensors** (`fort_status` … `find_unit`) answer _what is this fort doing right
  now?_ — happiness, stocks, threats, jobs, military, health, defenses.
- **Reference** (`game_data`, `wiki_*`, `identify`) answer _how does DF work?_ —
  `game_data` is **this world's** ground truth (the loaded raws), the `wiki_*`
  tools are the general explanation, and `identify` fuses the two.

Most sensor tools are a thin TypeScript wrapper over one purpose-written DFHack
Lua query that returns already-summarized JSON, so responses stay small and
glanceable. It talks to DFHack's Remote RPC (localhost:5000) through the sibling
[`dfhack-remote-node`](https://github.com/alexanderolvera/dfhack-remote-node) client.

## Requirements

- **Node 24+** — runs the TypeScript sources directly via type-stripping, so the
  dev workflow needs no build step. (Local imports use explicit `.ts` extensions.)
- **Dwarf Fortress running with DFHack**, a fort loaded.
- **DFHack Remote RPC** reachable on `localhost:5000` (`allow_remote` may stay
  `false` — localhost is enough).

## Setup

The DFHack RPC transport,
[`dfhack-remote-node`](https://www.npmjs.com/package/dfhack-remote-node), is a
published npm package (ships prebuilt), so setup is a single clone + install:

```sh
git clone https://github.com/alexanderolvera/dfhack-mcp.git
cd dfhack-mcp
npm install        # or: npm run bootstrap  (installs + runs the T0 contract check)
```

## Run

The server speaks MCP over stdio; an MCP client launches it. In development, run
the TypeScript entry directly (no build):

```sh
node src/index.ts
```

MCP client config (e.g. Claude Desktop / Claude Code):

```json
{
  "mcpServers": {
    "dfhack": {
      "command": "node",
      "args": ["C:/Users/Xalex/Desktop/DF-AI-Projects/dfhack-mcp-server/src/index.ts"]
    }
  }
}
```

Environment overrides: `DFHACK_HOST` (default `127.0.0.1`), `DFHACK_PORT` (`5000`).

## Verify against a live fort

The harness spawns the server over stdio like a real MCP client, lists the
tools, and calls one:

```sh
npm run call                       # fort_status (default)
npm run call threats
npm run call find_unit query=medical
npm run call game_data query="flame phantom"
npm run call wiki_lookup title=Trap
```

Sample output (fort "Bustlanterns", DFHack 53.15-r2):

```json
{
  "fort_name": "Bustlanterns",
  "date": "15th Malachite, Year 105",
  "season": "Summer",
  "population": 106,
  "wealth": 427944,
  "happiness": { "miserable": 0, "unhappy": 28, "content": 43, "happy": 35 },
  "alerts": ["28 dwarves unhappy", "2 hostiles on map"]
}
```

If no fort is loaded a tool returns `{"error":"no fort loaded"}`; if DFHack
can't be reached at all it returns an `isError` result explaining that. Every
tool is verified against a real running fort before it ships — never mocks.

## Tools

The **sensors** (no arguments; report on the loaded fort):

- **`fort_status()`** — name, date/season, population, wealth, happiness breakdown, pre-triaged alerts.
- **`stocks()`** — food/drink as days-of-supply, plus critical material counts and notable-low/high lists.
- **`threats()`** — dangerous units grouped by type; active vs. contained, great-danger/invader/undead flags, plus each group's creature `token` and decisive `traits` (trapavoid, flier, fire, webber, building_destroyer, ranged).
- **`unmet_needs()`** — the needs system aggregated: top unmet needs ranked by how many dwarves are distracted, each with a build/action suggestion.
- **`jobs_and_labor()`** — workforce utilization: busy vs. idle adults (children excluded), idle %, and a ranked breakdown of active jobs.
- **`military()`** — squads, enlisted soldiers, filled positions, and readiness against hostiles on the map (great-danger split out).
- **`mandates_and_justice()`** — the nobility's overhead: active production mandates and export bans (item, count, deadline), unmet noble room demands (office/bedroom/dining/tomb), and justice state (open cases, convictions awaiting punishment, and restraint capacity built vs. free).
- **`moods()`** — any active strange mood (fey/secretive/possessed/macabre/fell): the dwarf, driving skill, workshop claimed (unclaimed/gathering/working), and each demanded material cross-referenced against fort stock (needed/gathered/have) — the "demands bones, fort has zero" early warning.
- **`injuries_and_health()`** — wounded / patients / bedridden / unconscious counts, plus what care is needed (diagnosis, surgery, suture, …).
- **`defenses()`** — active hostiles with map positions and tile-distance/direction/z-delta to the fort core and nearest drawbridge, plus a controllable-structure inventory (bridges, levers, floodgates, hatches, cage traps, doors).
- **`trade()`** — the caravan lifecycle and the trade depot: depot existence, completeness, and DF's own wagon-accessibility check; caravans present and their state (none / approaching / at depot / leaving, days remaining where knowable) and civ; broker assignment / presence / at-depot / current job; and the count and approximate value of goods staged in the depot.
- **`find_unit(query)`** — look up citizens by name fragment or profession; a compact dossier per match (profession, age, stress, job, squad, health flags).
- **`site_history()`** — the fort's entry in the permanent world saga: founding (year, in-game date, owning civ in Dwarven + English), the fort name in both tongues with a word etymology, prior sieges/battles fought at the site (attacker/defender civ + general), and the notable figures who died here. Reads the durable event log, scoped strictly to the loaded site; a young fort degrades to empty battle/death lists.
- **`rooms_and_zones()`** — the facility inventory, each count paired with its demand-side number: bedrooms (assigned/unassigned vs. adults without one), dining halls + seats, the hospital (beds, traction benches, well-inside, medical supplies stocked), wells (working state + water source), temples (dedicated deities, all-inclusive, and deities worshipped without a temple), taverns, libraries, guildhalls, and coffins free vs. dead awaiting burial. The supply-side companion to `unmet_needs()`; wells are capped and bedroom/coffin detail aggregated so mega-forts stay flat.
- **`map_overview()`** — cheap spatial orientation to run _before_ any per-tile terrain read: map extents (x/y/z tile counts), the fort-core coordinate (the same 3D citizen centroid `defenses()` reports), the surface z-level above the fort center, the z-levels carrying player activity (construction and pending digging, listed separately and unioned), and stairways collapsed to vertical columns (`x, y, z_top, z_bottom`). Fixed-size regardless of fort size — activity is a set of z-levels, never per-tile, and stair columns are capped. Fog-of-war honest; tells the agent which z-levels and area to pull grids for.
- **`tile_region(z?, x0?, y0?, x1?, y1?)`** — a bounded window of ONE z-level rendered as an ASCII character grid plus a self-describing legend (shipped with **every** response, carrying exactly the glyphs present). Composes on the fog-of-war-safe `mcp_readTerrain` substrate: undiscovered tiles stay `?` and are **never** painted over. Distinguishes undug **soil** (`,`) from undug **stone** (`#`). Buildings are collapsed to four CLASS footprints (workshop / stockpile / machine / furniture), never per-building detail. The grid glyph is depth-blind; a separate sparse `liquids` list carries per-tile `{x,y,type,depth}` (flow_size 1–7, capped at 400 with `liquids_truncated`). All params are optional: with **none**, returns the DEFAULT **60×40 window centered on the fort core** (the busiest citizen z-level and that level's citizen centroid); pass `z` alone to recenter on **that level's own** citizen centroid, or `z,x0,y0,x1,y1` for an explicit rectangle (corners may be given in any order). The window is **hard-capped at 100×100** per side — an oversized request is _clamped_ (never errored) with `truncated:true` and the original size echoed in `requested`. A busy 100×100 window is ~10.8 KB (~2.7k tokens); a liquid-heavy one ~20 KB (~5k tokens) — comfortably inside one tool-result budget. Facts only: it renders the map, it never designs or suggests layouts. Read-only. The fixed legend:

  | glyph       | meaning                     | glyph   | meaning                                 |
  | ----------- | --------------------------- | ------- | --------------------------------------- |
  | `?`         | undiscovered (fog of war)   | `+`     | constructed floor                       |
  | `#`         | undug stone / wall          | `~`     | water / brook                           |
  | `,`         | undug soil (sand/clay/loam) | `%`     | magma                                   |
  | `.`         | dug floor / walkable ground | `W`     | workshop / furnace                      |
  | `F`         | fortification               | `S`     | stockpile                               |
  | `r`         | ramp                        | `M`     | machine (gear/axle/pump/wheel/windmill) |
  | `v`         | ramp top                    | `n`     | furniture (bed/chair/table/door/etc)    |
  | `<` `>` `x` | up / down / up-down stair   | (space) | open space                              |
  | `T`         | tree                        |         |                                         |
- **`geology(reveal_hidden?)`** — a one-call geological survey of the embark, revealed-info only by default: the surface z-level; the exposed layer stack (each band's z-range, kind — soil/sedimentary/metamorphic/igneous — and in-game material names that `game_data`/`wiki_lookup` resolve); the aquifer (presence, light vs. heavy, z-range — fuses with `wiki_lookup("Aquifer")`); the caverns actually **discovered** (z-range + water); whether the magma sea has been reached; and surface water (brook, river, murky-pool count, and `permanent_freeze` — whether the biome's base temperature keeps surface water frozen year-round; not a seasonal winter claim). Undiscovered caverns and an unreached magma sea are **omitted** — fog of war stays honest. `reveal_hidden: true` bypasses that gate (a debug/spoiler switch, default off) to surface every cavern (`caverns_hidden`) and the magma-sea z-range (`magma_hidden`).

The **reference** tools (`wiki_*` are pure HTTP and work without the game;
`game_data`/`identify` need a loaded world):

- **`game_data(query, kind?)`** — the loaded world's raws; ground truth for procedural creatures (demons, forgotten beasts, titans) that never reach the wiki. `query` is a creature token (`DEMON_4`), a name, or a live `unit_id`. One strong hit → a dossier; several → a disambiguation list. Only `kind: creature` is implemented; other kinds report "not yet implemented" and land in _this same tool_.
- **`wiki_search(query)`** — search the DF wiki for candidate titles + cleaned snippets, biased to the `DF2014` namespace.
- **`wiki_lookup(title, section?, refresh?)`** — fetch a wiki article as clean text, pinned to `DF2014`; follows multi-hop redirects, honors section fragments, cache-first to a git-ignored `cache/` dir (~30-day TTL; `refresh` bypasses).
- **`identify(query)`** — _"what is this creature and how do I handle it"_ in one call: fuses `game_data` (this world's raws) with `wiki_lookup` (strategy). Returns the dossier, a `tactics` list pairing each decisive trait with a hard-fact implication (e.g. _TRAPAVOID → mechanical traps don't work_), and 1–2 trimmed wiki excerpts. Use it instead of a bare wiki lookup when a threat appears.

### `run_lua(snippet)` — dev only

A raw DFHack Lua escape hatch returning printed output verbatim. **Not
registered unless `DFHACK_MCP_DEV` is set** — arbitrary Lua can read _and write_
game state, so it is off by default and intended only for field-probing while
authoring curated tools.

```sh
DFHACK_MCP_DEV=1 node src/index.ts
```

## Layout

```
src/
  index.ts            server construction + registers the collected tools + stdio wiring
  register.ts         ToolDef types + registerTool dispatcher (result + error framing)
  dfclient.ts         single RPC connection: lazy connect, one-shot reconnect,
                      registers dfhack-queries/ as a DFHack script path
  query.ts            invoke a named DFHack script -> parse JSON -> normalize list fields
  dfhack-queries/     the version-FRAGILE boundary: one real DFHack .lua script per query
    mcp_fortStatus.lua mcp_stocks.lua mcp_threats.lua mcp_unmetNeeds.lua
    mcp_jobsAndLabor.lua mcp_military.lua mcp_injuriesAndHealth.lua
    mcp_defenses.lua mcp_findUnit.lua mcp_gameData.lua
  wiki/               MediaWiki client (pure HTTP; the other external boundary)
    api.ts              fetch + search + redirect/namespace/section resolution
    clean.ts            rendered HTML -> readable text (dependency-free)
    cache.ts            git-ignored disk cache (cache-first, ~30-day TTL)
    lookup.ts           the wiki_lookup orchestration
    index.ts            public re-exports
  tools/              one file per tool: run the query/client call, parse, normalize,
                      and export a ToolDef descriptor (name/title/description/schema/handler)
    registry.ts         imports every ToolDef into ALL_TOOLS (the single tool list)
    identify/           tactics.ts (trait derivation) + wiki.ts (topic selection) + index.ts (fusion)
scripts/
  call-tool.mjs       end-to-end harness (real MCP client over stdio)
cache/                git-ignored disk cache of cleaned wiki pages
```

The `dfhack-queries/` folder is deliberate: **all** version-fragile DFHack field
access (the exact `df.global.*` / `dfhack.units.*` / caste paths that can shift
between DF/DFHack builds) is confined there, so a version bump is a localized fix
— you edit the `.lua` scripts, never the tools or the server.

These are **real DFHack `.lua` scripts**, not Lua embedded in TypeScript. On
connect the server registers the folder with DFHack (`dfhack.internal`'s script
path) and each tool invokes its script **by name with native argv** — so query
parameters are injection-safe by construction (no string escaping), and the Lua
gets proper editor tooling. (This needs `dfhack.internal.addScriptPath`, present
in the pinned build; the server errors clearly if a DFHack lacks it.)

## Scripts

| Script                  | Does                                                      |
| ----------------------- | --------------------------------------------------------- |
| `npm start`             | run the server directly (`node src/index.ts`, type-strip) |
| `npm run build`         | bundle `src/index.ts` → `dist/index.js` (ESM, shebang)    |
| `npm run typecheck`     | `tsc --noEmit`                                            |
| `npm run lint`          | eslint (flat config)                                      |
| `npm run format`        | prettier --write                                          |
| `npm run call`          | one-shot live harness (see _Verify_ above)                |
| `npm run verify:t0`     | contract tier: handshake + `tools/list` + schemas (no DF) |
| `npm run verify:t1`     | reachability tier: every tool callable (needs a fort)     |
| `npm run verify:t2`     | golden + invariants (needs the fixture save)              |
| `npm run verify:update` | rewrite goldens from the loaded fixture                   |
| `npm run bootstrap`     | one-command setup: build client → install → T0            |
| `npm run worktree`      | `<branch>` → isolated worktree for a parallel agent       |

The **verification harness** ([`docs/VERIFY.md`](docs/VERIFY.md)) is tiered: T0 is
CI-gated and needs no game; T1/T2 run locally against a live fort. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for setup and the parallel-agent workflow.

## Contributing

**Facts, not advice.** These tools _sense_ — they return what is true about the
fort and the world, the way a player reads a screen or looks something up. They
do not tell the agent what to build or how to fight; that judgment is the agent's
job. A field that says _what to do_ is advice — leave it out (or, if it is a
genuine limitation the caller must know, put it in the tool description, not the
per-call payload). Restating a fact that crossed a threshold ("28 dwarves
unhappy") is fine — that mirrors the game's own announcements. Curated strategy,
if it ever ships, belongs in a separate authored knowledge layer an agent chooses
to consult, never scattered through sensor output.

New tools follow the existing split: write the version-fragile Lua as a real
`src/dfhack-queries/mcp_<name>.lua` script (read parameters from `local args =
{...}`, `print(require('json').encode(...))` one JSON object), add a thin wrapper
in `src/tools/<name>.ts` that calls `runJsonScript('<name>', args, listFields)`
and types the result, and register it in `src/index.ts`. **Verify every tool
against a live fort with the harness — no mocks.** Keep `npm run typecheck` and
`npm run lint` clean.

## License

ISC — see [LICENSE.md](./LICENSE.md).

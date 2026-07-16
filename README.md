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
[`dfhack-remote-node`](../dfhack-remote) client.

## Requirements

- **Node 24+** — runs the TypeScript sources directly via type-stripping, so the
  dev workflow needs no build step. (Local imports use explicit `.ts` extensions.)
- **Dwarf Fortress running with DFHack**, a fort loaded.
- **DFHack Remote RPC** reachable on `localhost:5000` (`allow_remote` may stay
  `false` — localhost is enough).

## Setup

This server depends on the sibling `dfhack-remote-node` client as a local
`file:` dependency (`file:../dfhack-remote`). That package ships as built TS —
its `package.json` `main` points at `dist/index.js` — so **install it first** so
its `dist/` is built before this server links to it.

```sh
# 1. Clone both repos side by side:
#      some-dir/
#        dfhack-remote/          (the client, package name "dfhack-remote-node")
#        dfhack-mcp-server/       (this repo)

# 2. Build the client FIRST (its `prepare` script builds dist/):
cd ../dfhack-remote
npm install

# 3. Then install this server (links the client + pulls dev tooling):
cd ../dfhack-mcp-server
npm install
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
- **`injuries_and_health()`** — wounded / patients / bedridden / unconscious counts, plus what care is needed (diagnosis, surgery, suture, …).
- **`defenses()`** — active hostiles with map positions and tile-distance/direction/z-delta to the fort core and nearest drawbridge, plus a controllable-structure inventory (bridges, levers, floodgates, hatches, cage traps, doors).
- **`find_unit(query)`** — look up citizens by name fragment or profession; a compact dossier per match (profession, age, stress, job, squad, health flags).

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
  index.ts            server construction + the 13 tool registrations + stdio wiring
  register.ts         registerReadTool / registerQueryTool helpers (result + error framing)
  dfclient.ts         single RPC connection: lazy connect, one-shot reconnect
  query.ts            run a Lua query -> parse JSON -> normalize list fields
  dfhack-queries/     the version-FRAGILE boundary: one DFHack Lua query per file
    shared.ts           preamble/guard, luaStr, stress labels, creature-flag whitelist (+ why this folder exists)
    fortStatus.ts stocks.ts threats.ts unmetNeeds.ts jobsAndLabor.ts
    military.ts injuriesAndHealth.ts defenses.ts findUnit.ts gameData.ts
  wiki/               MediaWiki client (pure HTTP; the other external boundary)
    api.ts              fetch + search + redirect/namespace/section resolution
    clean.ts            rendered HTML -> readable text (dependency-free)
    cache.ts            git-ignored disk cache (cache-first, ~30-day TTL)
    lookup.ts           the wiki_lookup orchestration
    index.ts            public re-exports
  tools/              one file per tool: run the query/client call, parse, normalize
    identify/           tactics.ts (trait derivation) + wiki.ts (topic selection) + index.ts (fusion)
scripts/
  call-tool.mjs       end-to-end harness (real MCP client over stdio)
cache/                git-ignored disk cache of cleaned wiki pages
```

The `dfhack-queries/` folder is deliberate: **all** version-fragile DFHack field
access (the exact `df.global.*` / `dfhack.units.*` / caste paths that can shift
between DF/DFHack builds) is confined there, so a version bump is a localized fix
— you edit the query snippets, never the tools or the server.

## Scripts

| Script              | Does                                                      |
| ------------------- | --------------------------------------------------------- |
| `npm start`         | run the server directly (`node src/index.ts`, type-strip) |
| `npm run build`     | bundle `src/index.ts` → `dist/index.js` (ESM, shebang)    |
| `npm run typecheck` | `tsc --noEmit`                                            |
| `npm run lint`      | eslint (flat config)                                      |
| `npm run format`    | prettier --write                                          |
| `npm run call`      | the live harness (see _Verify_ above)                     |

## Contributing

New tools follow the existing split: put the version-fragile Lua in a
`src/dfhack-queries/<name>.ts` snippet (reuse the helpers in `shared.ts`), add a
thin wrapper in `src/tools/<name>.ts` that parses and normalizes, and register it
in `src/index.ts`. **Verify every tool against a live fort with the harness — no
mocks.** Keep `npm run typecheck` and `npm run lint` clean.

## License

ISC — see [LICENSE.md](./LICENSE.md).

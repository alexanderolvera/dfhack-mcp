# dfhack-mcp

An [MCP](https://modelcontextprotocol.io) server that exposes a **live Dwarf
Fortress fort** to an AI agent as a small set of **curated, semantic tools** —
a fortress co-pilot / early-warning advisor, not an autopilot. Read-only in v1.

It talks to DFHack's Remote RPC (localhost:5000) through the
[`dfhack-remote`](../dfhack-remote) Node client. Most tools are a thin wrapper
over one purpose-written Lua query that returns already-summarized JSON, so
responses stay small and glanceable.

## Requirements

- Node 24+ (runs the TypeScript sources directly via type-stripping — no build)
- Dwarf Fortress running with DFHack, a fort loaded
- DFHack Remote RPC on `localhost:5000` (`allow_remote` should stay `false`)

## Setup

```sh
npm install          # also links ../dfhack-remote
```

## Run

The server speaks MCP over stdio; an MCP client launches it:

```sh
node src/index.ts
```

MCP client config (e.g. Claude Desktop / Claude Code):

```json
{
  "mcpServers": {
    "dfhack": { "command": "node", "args": ["C:/Users/Xalex/Desktop/DF-AI-Projects/dfhack-mcp-server/src/index.ts"] }
  }
}
```

Environment overrides: `DFHACK_HOST` (default `127.0.0.1`), `DFHACK_PORT` (5000).

## Verify against a live fort

```sh
npm run call            # spawns the server, calls fort_status, prints JSON
npm run call fort_status
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

If no fort is loaded the tool returns `{"error":"no fort loaded"}`; if DFHack
can't be reached at all it returns an `isError` result explaining that.

## Tools

### `fort_status()`
Situational overview: name, date/season, population, created wealth, happiness
breakdown, and a pre-triaged `alerts` list. No arguments.

### `stocks()`
Food and drink as estimated **days-of-supply** for the current population, plus
counts of critical materials (wood, fuel, cloth, tanned hides, stone) and
`notable_low` / `notable_high` lists. No arguments.

Days-of-supply assume ~2 food and ~5 drink per dwarf per season (DF wiki). The
raw `counts` are exact; the day estimates are approximations. Note: `food`
counts all edible items including raw plants, some of which may be destined for
brewing/milling — so `food_days` can overstate effective food.

### `threats()`
Dangerous units on the map, grouped by creature type. Separates **active**
hostiles from **contained** ones (caged/chained), and flags `great_danger`
(megabeasts, titans, demons, forgotten beasts), `invader`, and `undead`. Each
group also carries the creature `token` (a direct `game_data`/`identify` handle)
and a curated `traits` list of the **tactically decisive** facts — `trapavoid`,
`flier`, `fire`, `webber`, `building_destroyer`, `ranged` — plus `ranged_attacks`
(breath-weapon names), so the facts that decide how to fight a threat are in the
readout itself. No arguments.

### `unmet_needs()`
Why the fort is stressed: the dwarven needs system aggregated across all
citizens. Returns the top unmet needs (prayer, drink, socializing, …) ranked by
how many dwarves are distracted, each with a concrete build/action suggestion,
plus how many dwarves have at least one unmet need. Complements
`fort_status`'s happiness breakdown. No arguments.

### `jobs_and_labor()`
Workforce utilization: working-age dwarves busy vs. idle (children excluded),
the idle percentage, and a ranked breakdown of what the fort is currently
working on. No arguments.

### `military()`
Squads, how many living present dwarves are actually enlisted (`soldiers`),
filled squad positions, and readiness read against hostiles on the map
(great-danger split out). Warns if the fort is undefended. No arguments.

### `injuries_and_health()`
The medical picture: wounded, patients in the care queue, bedridden, and
unconscious counts, plus a breakdown of what care is needed (diagnosis,
surgery, suture, …) so gaps in medical coverage are visible. No arguments.

### `defenses()`
Where the threats are versus what you have to fight them with. Returns active
hostiles with map positions and their tile-distance/direction/z-delta to the
**fort core** (citizen centroid) and to the **nearest drawbridge**, plus an
inventory of controllable structures (drawbridges with positions, levers,
floodgates, hatches, cage traps, locked doors). Turns generic "atom-smash them"
advice into a *located* plan. Buildings + positions only — walls/fortifications
(map tiles) await the RemoteFortressReader terrain work. No arguments.

### `find_unit(query)`
Look up citizens by a name fragment or profession (case-insensitive, matches
either). Returns a compact dossier per match: profession, age, stress, current
job, squad, and health flags. Argument: `query` (string).

### `game_data(query, kind?)`
Look up the **loaded world's raws** — ground truth for *this* world, and the
only source for procedural creatures (demons, forgotten beasts, titans) that
never appear on the wiki. `query` is a creature token (`DEMON_4`), a name
(`flame phantom`, case-insensitive), or a live `unit_id` (all digits, a
fusion shortcut). One strong hit → a full dossier (token, name, size, notable
flags, attacks, breath/interactions, blurb); several → a disambiguation list.
`kind` is an optional filter (`creature|material|plant|reaction|item|building`);
only `creature` is implemented so far — the others report "not yet implemented"
and are added *to this same tool*, never as new tools.

### `wiki_search(query)`
Search the Dwarf Fortress wiki for candidate article titles + cleaned snippets,
biased to the `DF2014` namespace. The discovery step before `wiki_lookup`. Pure
HTTP — works without the game running. Argument: `query` (string).

### `wiki_lookup(title, section?, refresh?)`
Fetch a wiki article as clean, readable text, pinned to `DF2014`. Follows
multi-hop redirects and honors section fragments (`"Weapon trap"` → the Weapon
Trap section of `DF2014:Trap`). Cache-first to a git-ignored `cache/` dir
(~30-day TTL; `refresh: true` bypasses). Returns `{title, url, text, from_cache,
resolved_from?}` or `{error}`. Pure HTTP.

### `identify(query)`
One-call *"what is this creature and how do I handle it"* — fuses `game_data`
(this world's raws) with `wiki_lookup` (strategy). Same input as `game_data` (a
token, name, or live `unit_id`). Returns the creature dossier, a `tactics` list
pairing each decisive trait with a hard-fact implication (e.g. *TRAPAVOID →
mechanical traps don't work*, *FLIER → needs a roof, not just a bridge*), and
1–2 trimmed wiki strategy excerpts. Procedural creatures (demons, forgotten
beasts, titans) have no wiki page, so it leans on their traits plus the most
relevant trait page. Use this instead of a bare `wiki_lookup` when a creature
threat appears — it's the reason the tool exists.

### `run_lua(snippet)` — dev only
Raw DFHack Lua escape hatch, returning printed output verbatim. **Not
registered unless `DFHACK_MCP_DEV` is set** — arbitrary Lua can read *and write*
game state, so it is off by default and intended only for field-probing while
authoring curated tools. Argument: `snippet` (string).

## Layout

```
src/
  index.ts         MCP server + tool registration (stdio)
  dfclient.ts      single RPC connection: lazy connect, one-shot reconnect
  lua/queries.ts   centralized Lua queries (version-fragile field access lives here)
  wiki/client.ts   MediaWiki fetch/resolve/clean/cache (the wiki_* tools)
  tools/           one file per tool: run query, parse, normalize
scripts/
  call-tool.mjs    end-to-end harness (real MCP client over stdio)
cache/             git-ignored disk cache of cleaned wiki pages
```

Two pillars: the **sensors** (`fort_status` … `find_unit`) answer *what is this
fort doing?*; the **reference** tools (`game_data`, `wiki_*`) answer *how does
DF work?* — `game_data` is this world's ground truth, `wiki_*` is the general
explanation.

Every tool is verified against a real running fort before it ships — never mocks.

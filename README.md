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

Planned (see the spec vault): `threats`, `unmet_needs`, `jobs_and_labor`,
`military`, `injuries_and_health`, `find_unit`.

## Layout

```
src/
  index.ts         MCP server + tool registration (stdio)
  dfclient.ts      single RPC connection: lazy connect, one-shot reconnect
  lua/queries.ts   centralized Lua queries (version-fragile field access lives here)
  tools/           one file per tool: run query, parse, normalize
scripts/
  call-tool.mjs    end-to-end harness (real MCP client over stdio)
```

Every tool is verified against a real running fort before it ships — never mocks.

# dfhack-mcp

An [MCP](https://modelcontextprotocol.io) server that gives an AI agent a live
window into your **Dwarf Fortress** fort — a co-pilot and early-warning advisor,
not an autopilot. Point Claude (or any MCP client) at it and ask _"how's my fort
doing?"_ — it reads happiness, threats, stocks, jobs, health, and defenses
straight from the running game and answers in plain language.

**Read-only by default.** The 27 sensor and reference tools only observe the
game. A handful of **actuators** that _change_ the fort — queue manager orders,
apply quickfort blueprints, assign labor — ship behind an explicit opt-in and
stay hidden until you enable them (see [Taking action](#taking-action-actuators)).

Two kinds of tools:

- **Sensors** answer _what is my fort doing right now?_ — `fort_status`,
  `threats`, `stocks`, `jobs_and_labor`, `military`, `injuries_and_health`,
  `defenses`, and more.
- **Reference** answers _how does Dwarf Fortress work?_ — `game_data` is **your
  world's** ground truth (its loaded raws), the `wiki_*` tools are the general
  explanation, and `identify` fuses the two for _"what is this creature and how
  do I handle it."_

It returns **facts, not advice** — already-summarized JSON that reads like a
glance at the screen, leaving the judgment to the agent.

## Quick start

The package is published to npm and ships a **prebuilt bundle** — there is
nothing to build. Point your MCP client at it with `npx`:

```json
{
  "mcpServers": {
    "dfhack": {
      "command": "npx",
      "args": ["-y", "dfhack-mcp"]
    }
  }
}
```

That's it for Claude Desktop / Claude Code / any stdio MCP client. `npx -y
dfhack-mcp` fetches and runs the latest release; its runtime dependencies — the
MCP SDK and the
[`dfhack-remote-node`](https://www.npmjs.com/package/dfhack-remote-node) RPC
transport — are pulled from npm automatically.

Then just have your fort running (next section) and ask your agent something like
_"check on my fort and flag anything urgent."_

Prefer a pinned global install?

```sh
npm install -g dfhack-mcp     # then set "command": "dfhack-mcp", "args": []
```

## Requirements

- **Dwarf Fortress running with DFHack**, with a fort loaded. The tools read the
  live game; if no fort is loaded they say so.
- **DFHack Remote RPC** on `localhost:5000`. This is **on by default** whenever DF
  runs with DFHack — no config file to edit. (The `allow_remote` setting only
  governs connections from _other_ machines and can stay `false`; a local MCP
  server reaches it either way.) Point elsewhere with `DFHACK_HOST` / `DFHACK_PORT`.
- **Node 20+** to run the published package. (Node 24+ only if you develop from
  source — see [Development](#development).)

## What you can ask it

Your agent picks the tools; you just describe what you want. The tools below are
what it has to work with.

### Sensors — the state of your fort

No arguments; each reports on the loaded fort.

- **`fort_status()`** — name, date/season, population, wealth, happiness breakdown, pre-triaged alerts.
- **`stocks()`** — food/drink as days-of-supply, plus critical material counts and notable low/high lists.
- **`threats()`** — dangerous units grouped by type; active vs. contained, great-danger/invader/undead flags, plus each group's decisive traits (trapavoid, flier, fire, webber, building-destroyer, ranged).
- **`unmet_needs()`** — the needs system aggregated: the top unmet needs ranked by how many dwarves are distracted, and how starved each is.
- **`jobs_and_labor()`** — workforce utilization: busy vs. idle adults (children excluded), idle %, and a ranked breakdown of active jobs.
- **`military()`** — squads, enlisted soldiers, filled positions, and readiness against hostiles on the map.
- **`injuries_and_health()`** — wounded / patients / bedridden / unconscious counts, plus the care needed (diagnosis, surgery, suture, …).
- **`defenses()`** — active hostiles with map positions and distance/direction/z-delta to the fort core and nearest drawbridge, plus a controllable-structure inventory (bridges, levers, floodgates, hatches, cage traps, doors).
- **`moods()`** — any active strange mood (fey/secretive/possessed/macabre/fell): the dwarf, driving skill, workshop state, and each demanded material cross-referenced against fort stock — the "demands bones, fort has zero" early warning.
- **`mandates_and_justice()`** — the nobility's overhead: active production mandates and export bans, unmet noble room demands, and justice state (open cases, convictions awaiting punishment, restraint capacity).
- **`rooms_and_zones()`** — the facility inventory, each count paired with its demand-side number: bedrooms, dining halls, the hospital, wells, temples, taverns, libraries, guildhalls, and coffins free vs. dead awaiting burial. The supply-side companion to `unmet_needs()`.
- **`trade()`** — the caravan lifecycle and trade depot: depot existence/completeness and wagon-accessibility, caravans present and their state, broker assignment/presence, and the count and approximate value of goods staged in the depot.
- **`environment()`** — ambient conditions right now: season and weather, surface temperature and whether exposed water is frozen, the embark's biome alignment (evil/good/reanimating), and — for each cavern the fort has **already breached** — whether it is open or sealed. Fog-of-war honest.
- **`find_unit(query)`** — look up citizens by name fragment or profession; a compact dossier per match (profession, age, stress, job, squad, health flags). Chain into `citizen` for depth.
- **`citizen(unit_id)`** — the full character sheet for one dwarf: social graph (spouse/parents/children/friends/grudges, each with a `unit_id` you can walk), worshipped deities, notable personality extremes, skills of note, likes/detests, and recent thoughts tied to current stress.
- **`site_history()`** — the fort's entry in the world saga: founding, the fort name in Dwarven + English with etymology, prior sieges/battles at the site, and notable figures who died here.
- **`artifacts_and_engravings()`** — the fort's masterworks and notable engravings.
- **`chronicle()`** — a scannable recent-events feed for the fort.

**Spatial** (fog-of-war honest — undiscovered tiles never leak):

- **`map_overview()`** — cheap orientation to run _before_ any per-tile read: map extents, the fort-core coordinate, the surface z-level, the z-levels carrying player activity (digging/construction), and stairways as vertical columns. Fixed-size regardless of fort size.
- **`tile_region(z?, x0?, y0?, x1?, y1?)`** — a bounded window of one z-level as an ASCII grid plus a self-describing legend. Undiscovered tiles stay `?`. All params optional: none → a 60×40 window on the fort core; `z` alone → that level's centroid; explicit corners otherwise. Hard-capped at 100×100 (oversized requests are clamped, never errored). Renders the map; never designs it.

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

- **`geology(reveal_hidden?)`** — a one-call geological survey (revealed-info only by default): surface z-level, the exposed layer stack with material names, the aquifer (light vs. heavy, z-range), discovered caverns, whether the magma sea is reached, and surface water. `reveal_hidden: true` bypasses fog of war (a debug/spoiler switch, default off).

### Reference — how DF works

`wiki_*` are pure HTTP and work without the game; `game_data` / `identify` read a
loaded world.

- **`game_data(query, kind?)`** — your world's raws across six kinds (`creature`, `material`, `plant`, `reaction`, `item`, `building`; default `creature`). Ground truth for procedural creatures (demons, forgotten beasts, titans) that never reach the wiki. `query` is a token (`DEMON_4`, `INORGANIC:IRON`), a name (`"plump helmet"`), or — for creatures — a live `unit_id`. One strong hit → a full dossier; several → a disambiguation list; none → `{"match_count":0,"matches":[]}`.
- **`identify(query)`** — _"what is this creature and how do I handle it"_ in one call: fuses `game_data` (your world's raws) with `wiki_lookup` (strategy). Returns the dossier, a `tactics` list pairing each decisive trait with a hard-fact implication (e.g. _TRAPAVOID → mechanical traps don't work_), and 1–2 trimmed wiki excerpts. Reach for it when a threat appears.
- **`wiki_search(query)`** — search the DF wiki for candidate titles + cleaned snippets (biased to the `DF2014` namespace).
- **`wiki_lookup(title, section?, refresh?)`** — fetch a wiki article as clean text, pinned to `DF2014`; follows redirects, honors section fragments, cached ~30 days.

### Taking action (actuators)

By default every tool above only reads the game. The **actuators** _change_ the
fort, so they ship behind an explicit switch — set `DFHACK_MCP_ACTUATORS` and they
appear in the tool list; leave it unset and the server is strictly read-only.

```json
{
  "mcpServers": {
    "dfhack": {
      "command": "npx",
      "args": ["-y", "dfhack-mcp"],
      "env": { "DFHACK_MCP_ACTUATORS": "1" }
    }
  }
}
```

Every actuator uses the same **preview → confirm → apply → undo** safety loop, so
a change is never a surprise:

1. **Preview (dry-run).** The agent calls the tool with the operation fully
   specified but **no** confirmation token. It gets back a `preview` of exactly
   what would change — facts, never advice — plus a single-use `confirm_token`.
   **Nothing is written.** If the operation can't be applied as asked (e.g. a
   malformed blueprint), the preview reports why and **no token is issued**.
2. **Apply.** The agent calls again with the same arguments plus that token. The
   server re-checks that _the thing being acted on_ hasn't changed since the
   preview; if it has, the token is void and the agent re-previews. On success it
   gets an `undo` handle and a `readback` from the matching sensor confirming the
   change.

Tokens are single-use and target-scoped: an unrelated change elsewhere in the
fort does not void them, but a change to the target does. Each actuator names its
own reversal path.

**Manager work orders**

- **`work_order_list(after_id?)`** — _read-only, always available._ The fort's manager orders as facts: id, job type, output item/material, amount total/left, repeat frequency, bound workshop, and per-order validation state. Paged (cap 256) with a cursor.
- **`work_order_create(job_type, amount, frequency?, material?, item_type?)`** — queue a new order; the preview flags `would_duplicate` and `manager_present`. Reversal: `work_order_cancel`.
- **`work_order_cancel(order_id)`** — remove one order by id; the undo handle is a recreate spec (with a `faithful` flag when a workshop binding or conditions can't be fully restored).

**Quickfort blueprints** — designate dig/zone from an agent-drafted quickfort CSV. There's no separate read sensor: `blueprint_apply` **without** a token _is_ the preview.

- **`blueprint_apply(csv, anchor_x, anchor_y, anchor_z, mode)`** — designate from a `#dig` or `#zone` blueprint; the top-left cell maps to the anchor. The dry-run parses quickfort's own stats and previews tiles affected, footprint, and fog-of-war tiles under it (a fact, never blocked). **A malformed blueprint blocks with no token** (quickfort would partially apply). **v1 scope: dig + zone only** — `build`/`place` are rejected. Reversal: `blueprint_undo`.
- **`blueprint_undo(csv, anchor_x, anchor_y, anchor_z, mode)`** — revert a dig/zone designation via quickfort's native undo (same csv/anchor/mode). The token signs a per-cell digest, so any per-cell drift voids it.

**Labor via work details**

- **`work_details()`** — _read-only, always available._ Every work detail (the game's labor groups): name, mode, the labor tokens it enables, and its assigned citizens (id-sorted, capped at 200 with the full `member_count`).
- **`assign_work_detail(unit_id, detail, enabled)`** — add or remove one citizen to/from one detail. The preview reports `currently_member`, `resulting_members_count`, and `only_member`; an already-satisfied request previews as a no-op. Reversal: the same call with `enabled` inverted.

## Configuration

All optional, set in your MCP client's `env` for the server:

| Variable               | Default     | Effect                                                                                                                  |
| ---------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `DFHACK_HOST`          | `127.0.0.1` | Host where DFHack's Remote RPC is listening.                                                                            |
| `DFHACK_PORT`          | `5000`      | Port for DFHack's Remote RPC.                                                                                           |
| `DFHACK_MCP_ACTUATORS` | _(unset)_   | Set to `1` to expose the write actuators (off = strictly read-only).                                                    |
| `DFHACK_MCP_DEV`       | _(unset)_   | Set to `1` to expose `run_lua`, a raw DFHack Lua escape hatch (reads **and writes** game state; for tool authors only). |

## Troubleshooting

- **`{"error":"no fort loaded"}`** — DFHack is reachable but you're at the title
  screen or in the menus. Load a fort in Fortress mode.
- **An error about not reaching DFHack** — Dwarf Fortress isn't running with
  DFHack, or the RPC port differs. Confirm DF is up with DFHack and that
  `DFHACK_HOST` / `DFHACK_PORT` match (defaults `127.0.0.1:5000`).
- **The tools don't show up in your client** — restart the MCP client so it
  relaunches the server; a running server won't pick up a config change.
- **The write tools are missing** — that's the default. Set
  `DFHACK_MCP_ACTUATORS=1` (see [Taking action](#taking-action-actuators)).
- **First call after loading a fort errors once, then works** — a freshly-started
  DFHack can reject the very first tool call while it finishes registering the
  query scripts; retry once.

## Development

To hack on the server itself, clone and run the TypeScript entry directly (Node
24+ — it runs the sources via type-stripping, no build step):

```sh
git clone https://github.com/alexanderolvera/dfhack-mcp.git
cd dfhack-mcp
npm install        # or: npm run bootstrap  (installs + runs the T0 contract check)
node src/index.ts
```

Point an MCP client at the checkout with `"command": "node", "args":
["/absolute/path/to/dfhack-mcp/src/index.ts"]`.

All version-fragile DFHack field access lives in **real `.lua` scripts** under
`src/dfhack-queries/` (one per tool), invoked by name with native argv — so a
DF/DFHack version bump is a localized fix and query parameters are injection-safe
by construction. Each tool is a thin TypeScript wrapper in `src/tools/`.

**Facts, not advice.** Tools _sense_ — they return what is true about the fort and
the world, the way a player reads a screen. They do not say what to build or how
to fight; that judgment is the agent's. A field that says _what to do_ is advice —
leave it out.

Every tool is verified against a **live fort** with the tiered harness (`npm run
verify:t0` … `t2`) — never mocks. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the
tool-authoring split and the verification workflow, and
[`docs/VERIFY.md`](docs/VERIFY.md) for the harness tiers.

## License

ISC — see [LICENSE.md](./LICENSE.md).

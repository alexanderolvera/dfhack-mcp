# Contributing to dfhack-mcp

This server is a DFHack access layer for AI clients. It exposes a live Dwarf
Fortress game as MCP tools that report facts and execute exactly what they are
asked. Judgment (thresholds, triage, strategy and game knowledge) lives in the
client, not here; see [Facts, not advice](#facts-not-advice). It is **read-only
by default**. The mutating _actuators_ (`work_order_*`, `blueprint_*`,
`assign_work_detail`, `squad_orders`, `civilian_alert`, `pull_lever`,
`game_save`) are gated behind `DFHACK_MCP_ACTUATORS`, and `dfhack_command_run`
behind its own `DFHACK_MCP_COMMANDS`. Each is absent from the tool list unless
its gate is set. The DFHack
RPC transport,
[`dfhack-remote-node`](https://www.npmjs.com/package/dfhack-remote-node), is a
published npm dependency (its source lives in a
[separate repo](https://github.com/alexanderolvera/dfhack-remote-node)) — you
don't clone it to work on the server.

## Environment

- **Node 24 for development** — pinned in [`.nvmrc`](.nvmrc). `nvm use` (or install
  Node 24) before anything. The server runs TypeScript directly via Node's type
  stripping (`node src/index.ts`); no ts-node. (`engines` in `package.json` is the
  looser `>=20` — that governs the _published_ bundle's runtime, not this
  from-source dev workflow.)
- **Windows-native by default.** DF + DFHack run on the Windows host; headless mode is available via Docker (see [docker/README.md](docker/README.md)) ([#27](https://github.com/alexanderolvera/dfhack-mcp/issues/27)).
- **Don't expose the fort.** Never enable `allow_remote` in `remote-server.json`.
  DFHack's RPC only accepts connections that _originate_ from `127.0.0.1`, so the
  server talks to `localhost:5000` by default. `DFHACK_HOST` / `DFHACK_PORT` can
  retarget it, but reaching DF in another environment (a VM, WSL, a container) is
  not just a matter of the address — DFHack still rejects a non-loopback origin,
  so you must put a **loopback-preserving forward or bridge** in front of it that
  re-originates the connection as local (the `socat` pattern in
  [`docker/README.md`](docker/README.md)), never `allow_remote`.
- **Query script path.** `dfclient.ts` resolves the DFHack query directory
  relative to itself — `src/dfhack-queries/` in dev, `dist/dfhack-queries/` in
  the published bundle — and always converts backslashes to forward slashes
  before registering it, since `addScriptPath` rejects backslashes on Windows.
  `DFHACK_MCP_QUERY_DIR` overrides the path for a containerized DFHack, which
  needs the container-internal path rather than this host's (see
  [`docker/README.md`](docker/README.md)). `addScriptPath` **ignores a path it
  cannot see, silently**, so the server now verifies registration by resolving a
  known query script and fails the connection with an explanation if it did not
  take. Two ways to get this wrong: pointing `DFHACK_MCP_QUERY_DIR` at a host
  path when DF is in a container, and running a POSIX path through Git Bash
  without `MSYS_NO_PATHCONV=1`, which rewrites `/opt/df/mcp-queries` into
  `C:/Program Files/Git/opt/df/mcp-queries` before the server ever sees it.

## Setup — one command

Clone this repo and, from its root:

```sh
npm run bootstrap
```

That verifies Node 24, installs (the published `dfhack-remote-node` client comes
down with it), and runs the T0 contract check. It's idempotent — re-run it any
time the tree feels off. Plain `npm install` works too; `bootstrap` just adds the
version check and the contract gate.

## Verify — the tiered harness

Full detail in [`docs/VERIFY.md`](docs/VERIFY.md). The short version:

| Tier                       | Command                                      | Needs             | Gate                    |
| -------------------------- | -------------------------------------------- | ----------------- | ----------------------- |
| **T0** contract            | `npm run verify:t0`                          | nothing           | **CI-required**         |
| **T1** reachability        | `npm run verify:t1`                          | live fort         | local                   |
| **T1** no-fort guard       | `node scripts/verify.mjs --tier=1 --no-fort` | no-fort fixture   | local                   |
| **Invariants** (Red/Green) | `npm run verify:invariants`                  | any live fort     | local                   |
| **T2** golden + invariants | `npm run verify:t2`                          | fixture container | local                   |
| **Lua syntax**             | `npm run lint:lua`                           | `luac` on PATH    | local (skips if absent) |

The two halves of "did we break anything": **goldens** (T2) freeze the exact
bytes each tool emits against the frozen fixture; **invariants** encode properties
true of _any_ valid fort (population agrees across tools, happiness sums to
population, the `find_unit`→`citizen` id chain resolves). Because invariants are
relational they run against _any_ fort with no committed golden — so `npm run
verify:invariants` is also the **Red/Green** surface: add a spec in
[`test/invariants.mjs`](test/invariants.mjs), watch it fail on today's code (red),
fix the tool until it passes (green). Both the fixture-frozen goldens and the
invariants use the **disposable DF container** as the fort (see below); the
container image tag _is_ the fixture version.

T1 also has a **`--no-fort`** mode (the mirror of `--require-fort`): pointed at a
no-fort fixture — a container booted to the title screen with RPC up but no fort
loaded ([`docker/README.md`](docker/README.md)) — it asserts every game-dependent
tool returns its `{"error":"no fort loaded"}` guard cleanly, and that
`game_state`, the one tool built to work without a fort, reports the title
screen. This **exercises**
the no-fort guard ([#6](https://github.com/alexanderolvera/dfhack-mcp/issues/6))
rather than trusting it's coded, and is the no-fort reachability path for
[#28](https://github.com/alexanderolvera/dfhack-mcp/issues/28).

Some states the frozen fixture never reaches get an opt-in script that drives
a scratch container into them instead of changing the shared save. `npm run
verify:trade-caravan` forces a caravan and checks `trade` in each caravan state;
run it after touching `mcp_trade.lua` or the `trade` invariants. `npm run
verify:snapshot` exercises the snapshot publisher against any loaded fort —
walker defaults, `autostart`, every entity class, `seq` advancing on a completed
pass, and `find_unit` parity between the projection and the live Lua; run it after
touching `mcp_snapshot.lua` or `src/snapshot.ts`. Its `--no-fort` mode, pointed at
the no-fort fixture, checks that the walkers publish the guard under a new `seq`
and that the reader never serves a cached fort behind it. Details are in
[`docs/VERIFY.md`](docs/VERIFY.md#ad-hoc-live-verification-scripts).

**Every tool is verified against a real running fort before it ships — no mocks.**
Lua runs _inside_ DF, so "test infra" is provisioned frozen-save fixtures, not
unit tests. Keep `npm run typecheck` and `npm run lint` clean.

`npm run lint:lua` is the one exception that needs no fort: it runs `luac -p` over
every `src/dfhack-queries/*.lua`, so a syntax error is caught at the terminal
instead of surfacing as a failed tool call against a live game. It is part of
`prepublishOnly` and skips cleanly where `luac` isn't installed.

Reads served from the in-game snapshot instead of a per-call Lua walk have their
own contract — cadence, `seq`, provenance and what deliberately stays live. See
[`docs/snapshot.md`](docs/snapshot.md) before touching `mcp_snapshot.lua` or
`src/snapshot.ts`.

**Gotcha — DFHack caches loaded scripts by name, across server processes.**
`addScriptPath` (`src/dfclient.ts`) registers a directory per connection, but
DFHack's Lua VM is process-wide and persists for the life of the running game —
if you point a _second_ server checkout (a different worktree, an older build)
at the same live DF/DFHack instance, a script already loaded under a given name
(e.g. `mcp_threats`) is NOT guaranteed to be re-resolved from the new path; you
can get silently stale output that looks like your fix didn't take effect. This
is distinct from the cold-start "runScript warm-up" issue — it bites mid-session,
when comparing before/after behavior live. If a live A/B test against one
running fort gives suspiciously identical results, bypass script-name resolution
to get a trustworthy read: `run_lua` (dev-gated) with
`dofile('<absolute path to the .lua file>')` (forward slashes even on Windows)
executes that exact file fresh, ignoring whatever DFHack has cached under its
script name. Cleanest alternative: restart DF/DFHack between checkouts so there's
nothing to have cached.

## Calling a tool by hand

`npm run call [toolName] [key=value ...]` (`scripts/call-tool.mjs`) spawns the
server over stdio, lists its tools, and calls one — e.g. `npm run call
find_unit query=medical`. Defaults to `fort_status` with no args. Needs Dwarf
Fortress running with DFHack and a fort loaded.

## Working overlapping issues in parallel

Multiple agents can work different issues at once, each in an **isolated git
worktree**:

```sh
npm run worktree feat/moods       # creates ../dfhack-mcp-server--feat-moods
```

This creates the worktree as a sibling of the primary tree (tidy grouping; the
client is a published dependency, so each tree just installs it), gives it its
own `node_modules`, and confirms T0 passes before handing it off.

- **T0 is free and parallel.** Contract checks need no DF, so every worktree —
  and CI — can run them simultaneously. This is the gate that lets parallel work
  land safely: schema/registration drift is caught without the game.
- **The live DF is a shared resource — but no longer the only option.** Your
  single live Steam DF is one fort on one port, so T1/T2 against _it_ still run
  **one worktree at a time**. For real parallel live verification, spin up
  **disposable headless DF containers** ([`docker/`](docker/)): each worktree gets
  its own fort on its own port, so T1/T2 run concurrently. See
  [`docker/README.md`](docker/README.md) — this is [#27](https://github.com/alexanderolvera/dfhack-mcp/issues/27)'s
  deliverable. Quick path:
  ```sh
  cd docker && ./build.sh && ./run-instances.sh 3
  ./verify-container.sh 5001            # tools against fort #1
  ```

Why serialize, at the mechanism level: on connect the server calls
`dfhack.internal.addScriptPath(<its queries dir>)`, which mutates a **global,
DF-wide script search path**, and tools resolve `mcp_<name>` **by name** against
it. Two worktrees pointed at the same DF both register their own `dfhack-queries/`,
and `addScriptPath` prepends — so for a script that exists in both branches but
_differs_ (the common case: the one under test), whichever server connected last
wins, and Agent A's call can silently run Agent B's version. Unique new tool names
don't collide; same-named divergent scripts do. This is why true parallel live
testing needs **separate DF instances** (#27's real deliverable), not just N
servers — and why **T0 is the parallel-safe gate**: it never connects, never
registers a path, never runs a script.

Tear a worktree down when its branch merges:

```sh
git worktree remove ../dfhack-mcp-server--feat-moods
```

## Facts, not advice

These tools **sense** — they return what is true about the fort and the world,
the way a player reads a screen or looks something up. They do not tell the agent
what to build or how to fight; that judgment is the agent's job. A field that
says _what to do_ is advice — leave it out (or, if it's a genuine limitation the
caller must know, put it in the tool _description_, not the per-call payload).
Thresholds belong to the client too: report the number (`happiness.unhappy`,
`idle_pct`), never a sentence that fires when it crosses a line the server
picked ("28 dwarves unhappy"). Deciding which facts deserve attention is
triage, and a prose restatement of a field already in the payload is a second
copy of it to drift. The same goes for game knowledge: picking which strategy
text or wiki excerpt applies is curation, so the server ships none. Clients bring
their own.

## Adding a tool

Follow the existing split:

1. Write the version-fragile Lua as a real `src/dfhack-queries/mcp_<name>.lua`
   script — read parameters from `local args = {...}`, emit **one** JSON object
   with `print(require('json').encode(...))`. **Sort any unordered list before
   emit** so goldens don't flap on `pairs()` order (see _Canonicalization_ in
   `docs/VERIFY.md`).
   Any `{error}` other than the shared `no fort loaded` guard sets its own
   `code` (see _Shared internals: error codes_ below).
2. Add a thin `src/tools/<name>.ts` wrapper that calls
   `runJsonScript('<name>', args, listFields)` and types the result.
3. In that same module, export a `ToolDef` descriptor — `export const <name>Def:
ToolDef = { name, title, description, shape?, run }` (add `shape` for a tool
   that takes arguments; omit it for a no-arg read tool). The descriptor is the
   tool's contract; keep the description and schema here, not in `src/index.ts`.
4. **Add one import + one array entry to [`src/tools/registry.ts`](src/tools/registry.ts)**,
   in alphabetical-by-tool-name position. That's the whole registration — T0
   derives its expected set from `ALL_TOOLS`, so it fails until you add the entry.
   Because each tool lands at its own line, sibling tool PRs auto-merge instead of
   colliding.
5. Verify against a live fort: `npm run verify:t1`. Author its golden against the
   fixture container: `npm run verify:update` (then commit `test/golden/<name>.json`
   with the code). If the tool has a property true of any valid fort, add an
   invariant in [`test/invariants.mjs`](test/invariants.mjs) too — that's the check
   that survives a fixture bump.

## Shared internals: actuator contract (`actuator.ts`)

`defineActuator` encodes the preview/confirm/apply/undo loop (issue #8 §A0) once,
so the actuator tools (`work_order_*`, `blueprint_*`, `assign_work_detail`,
`squad_orders`, `game_save`) only supply their version-fragile `plan()`/`apply()` bodies — see
[Taking action](README.md#taking-action-actuators) in the README for the
user-facing contract this implements. Spike #11 (issue #11) proved the loop is
drivable over RPC for manager orders, quickfort, and work details.

Confirm tokens live in an in-memory, process-local `Map` (the server handles
tool calls sequentially, so no locking is needed), keyed by a full UUID and bound
to both the operation's target-state `signature` and a digest of its own
arguments (`opDigestOf`) — the latter stops a token minted for one operation
being redeemed against a different one that happens to share the same target
signature. Each token is single-use (`redeem` always deletes it), and the store
is capped at 512 entries with oldest-first eviction so abandoned previews can't
leak memory over the server's lifetime; an evicted token simply reads as expired
on redeem.

## Shared internals: connection retry and deadline (`dfclient.ts`)

`runLua`, `runScript` and `runDfhackCommand` own the single RPC connection to
DFHack, lazy-connecting on first use, and share one helper, `withRetry`, for the
rules below.

- **Deadline.** Each attempt (connect, script-path registration and the call
  itself) must finish within `DFHACK_MCP_TIMEOUT_MS`, 30 000 ms by default. A miss
  throws `TimeoutError` (`code: TIMEOUT`) and closes the connection, including one
  still mid-handshake, so the next call reconnects cleanly.
- **No retry after the call may have run.** An `RpcError` means DFHack was
  reachable and the snippet/script actually ran and failed. A `TimeoutError` means
  it may still be running. Both are rethrown as-is, never retried: retrying would
  re-run the script, which for the actuators (`work_order_create`,
  `blueprint_apply`, `assign_work_detail`, `game_save`, ...) and for the mutating
  forms of `dfhack_command_run` risks repeating side effects from a script that
  already partly ran. A timed-out call is not retried for read-only tools either:
  a DFHack that missed one deadline is unlikely to meet the next.
- **One reconnect for a dead socket.** Any other failure (e.g. a stale socket
  after DF restarted) resets the client and retries once, re-registering the
  query script path via `ensureConnected`. If that also fails, the caller gets
  `NotConnectedError` (`code: NOT_CONNECTED`).

Concurrent calls that arrive while the connection is being set up share the one
in-flight connection attempt rather than each opening their own.

## Shared internals: error codes (`errors.ts`)

Every error payload carries a `code` from `ERROR_CODES` (the table is in the
README's [Errors](README.md#errors) section). Codes are assigned in three places:

- **Thrown errors**: `register.ts`'s `errorPayload` maps `NotConnectedError`,
  `TimeoutError` and `ToolError` to their codes, and everything else (an
  `RpcError`, unparsable script output) to `SCRIPT_ERROR`. Throw a `ToolError`
  with a code when a tool's own TypeScript rejects a call.
- **Shared Lua guards**: `runJsonScript` adds `NO_FORT` / `NO_GAME` to the
  `no fort loaded` / `no game loaded` guards, so the guard lines in each script
  stay as they are.
- **Tool-specific errors**: anything else a script `emit`s, or a tool's
  TypeScript returns, sets its own code (`emit({ error = ..., code = 'NOT_FOUND' })`).

`test/errorCodes.test.mjs` scans every `emit({ error = ... })` in
`src/dfhack-queries/` and every `{ error: '...' }` literal in `src/tools/` and
fails on one without a known code, and the harness's `callJson` fails any T1/T2
payload whose `error` lacks one.

## Shared internals: fog-of-war safety

Two `reqscript`'d Lua modules centralize fog-of-war correctness so individual
tools never re-derive it. They aren't tools themselves (no `docs/tools/*.md`
page), so their behavior is documented here instead:

- **`mcp_readTerrain.lua`** — the terrain substrate for spatial tools, and the
  one place fog of war is decided. `fog_gate(args)` reads the bypass flag from a
  script's argv and returns the gate every fog-gated script uses: `mode`
  (`"applied"`/`"bypassed"`), `tile_hidden(x, y, z, blk)`, `des_hidden(des)` for a
  designation already in hand, `feature_discovered(feat)` for caverns and the
  magma sea, and `read_window(x0, y0, z, w, h)`. With fog applied, undiscovered
  tiles (`designation.hidden`) render as `?` and the real tiletype is never
  serialized. `read_window` block-caches reads (~26x faster than per-tile
  `getTileType`) and is the one place the tile-shape-to-glyph mapping and the
  hidden-tile convention live. A tile with no loaded block is hidden in both
  modes (fail closed).
- **`mcp_unitVisibility.lua`** — the fog-of-war gate for UNIT enumeration, the
  companion to the module above. Its `fog_gate(args)` returns the terrain gate
  plus `unit_hidden(u)`, the single source of truth for "has the fort discovered
  the tile this unit stands on". Every unit-listing tool must `reqscript` this
  and filter through it rather than re-deriving the `designation.hidden` check
  inline. That duplication is exactly how a real fog-of-war leak happened once
  (an undiscovered cavern's hostiles reported as "on the map", an X-ray leak on
  `threats`/`fort_status`, since fixed). A caged/chained beast is gated the same
  as a loose one; an off-map unit is treated as unseen in both modes.

**Writing a tool that reads terrain or enumerates units? `reqscript` the
relevant module above — don't re-implement the hidden-tile check.**

This applies to **writes**, not just reads. An actuator that takes a unit as a
_target_ must gate it the same way: `squad_orders` blocks a kill order against a
unit standing on an undiscovered tile, because issuing it would act on knowledge
the fort does not have — the write-side twin of the X-ray leak the sensors fixed.
The distinction to preserve is target-vs-area: naming a specific unseen creature
is refused, while ordering movement (or a dig) into unexplored space is a
legitimate command and is only _reported_ as a fact (`squad_orders`'
`target_undiscovered`, `blueprint_apply`'s `fog_of_war_tiles`), never blocked.

Both modules use the standard DFHack `--@ module = true` idiom: a leading
`if dfhack_flags and dfhack_flags.module then return end` guard so a
`reqscript` caller gets only the functions, while direct invocation
(`dfhack-run mcp_readTerrain ...`) still runs the script's tail.

### Fog of war: the `reveal_hidden` opt-in

Fog of war is on by default, and what a player may see is the client's policy,
not the server's. So every fog-gated tool takes the same optional
`reveal_hidden: boolean` (default `false`) and every response from it reports
`fog_of_war: "applied" | "bypassed"`, so a client can never mistake one mode for
the other. The fog-gated tools are `defenses`, `environment`, `fluids`,
`fort_health`, `fort_status`, `geology`, `historical_figure`,
`livestock_and_pastures`, `map_overview`, `military`, `rooms_and_zones`,
`threats`, `tile_region` and `unit_appearance`.

The bypass is implemented once. The TS side declares the shared
`revealHiddenParam` from `src/fog.ts` and appends `fogArgs(reveal_hidden)`
(`--reveal-hidden`) to the script's argv; the script hands its argv to
`fog_gate`, which strips the flag, so positional arguments are unaffected. A
bypassed response is computed as if the whole map were discovered: the same
fields and shape, with more in them. `test/fog.test.mjs` fails if a script takes
the flag without its tool sending it (or the reverse), if a fog-gated script
does not report `fog_of_war`, or if any other script reads `designation.hidden`
or `flags.Discovered` itself. Only `blueprint_apply` and `squad_orders` may, to
report undiscovered tiles as a fact.

A full-map scan reads every tile instead of skipping undiscovered ones, so
`fluids` and `geology` take noticeably longer with `reveal_hidden=true`; raise
`DFHACK_MCP_TIMEOUT_MS` on a large map.

Tools that stay out of the opt-in:

- `squad_orders` refuses a kill order against a unit on an undiscovered tile
  and always applies fog (`fog_gate({})`). It is a write: bypassing it would
  change what the fort does, not what the client shows.
- `blueprint_apply` and `squad_orders` only _report_ undiscovered tiles
  (`fog_of_war_tiles`, `target_undiscovered`); they gate nothing.
- `dfhack_command_run`'s `prospect` reads the revealed map only. Its `all`/`hell`
  keywords, which scan undiscovered tiles, stay off the allowlist.
- `game_state` and `artifacts_and_engravings` read no map-bound fog state.

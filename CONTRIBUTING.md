# Contributing to dfhack-mcp

This server exposes a live Dwarf Fortress fort to an AI agent as curated,
semantic tools — **read-only by default**, with a small set of mutation
_actuators_ (`work_order_*`, `blueprint_*`, `assign_work_detail`) gated behind
`DFHACK_MCP_ACTUATORS` and absent from the tool list unless it is set. The DFHack
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
  [`docker/README.md`](docker/README.md)).

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

| Tier | Command | Needs | Gate |
| --- | --- | --- | --- |
| **T0** contract | `npm run verify:t0` | nothing | **CI-required** |
| **T1** reachability | `npm run verify:t1` | live fort | local |
| **T1** no-fort guard | `node scripts/verify.mjs --tier=1 --no-fort` | no-fort fixture | local |
| **Invariants** (Red/Green) | `npm run verify:invariants` | any live fort | local |
| **T2** golden + invariants | `npm run verify:t2` | fixture container | local |

The two halves of "did we break anything": **goldens** (T2) freeze the exact
bytes each tool emits against the frozen fixture; **invariants** encode properties
true of *any* valid fort (population agrees across tools, happiness sums to
population, the `find_unit`→`citizen` id chain resolves). Because invariants are
relational they run against *any* fort with no committed golden — so `npm run
verify:invariants` is also the **Red/Green** surface: add a spec in
[`test/invariants.mjs`](test/invariants.mjs), watch it fail on today's code (red),
fix the tool until it passes (green). Both the fixture-frozen goldens and the
invariants use the **disposable DF container** as the fort (see below); the
container image tag *is* the fixture version.

T1 also has a **`--no-fort`** mode (the mirror of `--require-fort`): pointed at a
no-fort fixture — a container booted to the title screen with RPC up but no fort
loaded ([`docker/README.md`](docker/README.md)) — it asserts every game-dependent
tool returns its `{"error":"no fort loaded"}` guard cleanly. This **exercises**
the no-fort guard ([#6](https://github.com/alexanderolvera/dfhack-mcp/issues/6))
rather than trusting it's coded, and is the no-fort reachability path for
[#28](https://github.com/alexanderolvera/dfhack-mcp/issues/28).

**Every tool is verified against a real running fort before it ships — no mocks.**
Lua runs *inside* DF, so "test infra" is provisioned frozen-save fixtures, not
unit tests. Keep `npm run typecheck` and `npm run lint` clean.

**Gotcha — DFHack caches loaded scripts by name, across server processes.**
`addScriptPath` (`src/dfclient.ts`) registers a directory per connection, but
DFHack's Lua VM is process-wide and persists for the life of the running game —
if you point a *second* server checkout (a different worktree, an older build)
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
  single live Steam DF is one fort on one port, so T1/T2 against *it* still run
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
*differs* (the common case: the one under test), whichever server connected last
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
says *what to do* is advice — leave it out (or, if it's a genuine limitation the
caller must know, put it in the tool *description*, not the per-call payload).
Restating a fact that crossed a threshold ("28 dwarves unhappy") is fine — that
mirrors the game's own announcements.

## Adding a tool

Follow the existing split:

1. Write the version-fragile Lua as a real `src/dfhack-queries/mcp_<name>.lua`
   script — read parameters from `local args = {...}`, emit **one** JSON object
   with `print(require('json').encode(...))`. **Sort any unordered list before
   emit** so goldens don't flap on `pairs()` order (see *Canonicalization* in
   `docs/VERIFY.md`).
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
`game_save`) only supply their version-fragile `plan()`/`apply()` bodies — see
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

## Shared internals: connection retry (`dfclient.ts`)

`runLua` and `runScript` own the single RPC connection to DFHack, lazy-connecting
on first use. Both share one retry rule: an `RpcError` means DFHack was reachable
and the snippet/script actually ran and failed, so it's rethrown as-is rather than
retried. Only a connection-level failure (e.g. a stale socket after DF restarted)
resets the client and retries once, re-registering the query script path via
`ensureConnected`. This distinction matters most for `runScript`: retrying on an
`RpcError` would re-run the script, which for actuators (`work_order_create`,
`blueprint_apply`, `assign_work_detail`) risks repeated side effects from a script
that already partially executed.

## Shared internals: fog-of-war safety

Two `reqscript`'d Lua modules centralize fog-of-war correctness so individual
tools never re-derive it. They aren't tools themselves (no `docs/tools/*.md`
page), so their behavior is documented here instead:

- **`mcp_readTerrain.lua`** — the terrain substrate for spatial tools.
  Undiscovered tiles (`designation.hidden`) are always rendered as `?`; the
  real tiletype is never serialized. `read_window(x0, y0, z, w, h)`
  block-caches reads (~26x faster than per-tile `getTileType`) and is the one
  place the tile-shape-to-glyph mapping and the hidden-tile convention live.
  Used by `defenses` and `tile_region` via `reqscript('mcp_readTerrain')`.
- **`mcp_unitVisibility.lua`** — the fog-of-war gate for UNIT enumeration, the
  companion to the module above. `is_hidden(u)` is the single source of truth
  for "has the fort discovered the tile this unit stands on"; every
  unit-listing tool (`threats`, `fort_status`, and any future wildlife/
  animal-economy sensor) must `reqscript` this and filter through it rather
  than re-deriving the `designation.hidden` check inline — that duplication is
  exactly how a real fog-of-war leak happened once (an undiscovered cavern's
  hostiles reported as "on the map" — an X-ray leak on `threats`/`fort_status`,
  since fixed). A caged/chained beast is gated the same as a loose one;
  off-map/unloaded tiles are treated as unseen (fail closed, never leak).

**Writing a tool that reads terrain or enumerates units? `reqscript` the
relevant module above — don't re-implement the hidden-tile check.**

Both modules use the standard DFHack `--@ module = true` idiom: a leading
`if dfhack_flags and dfhack_flags.module then return end` guard so a
`reqscript` caller gets only the functions, while direct invocation
(`dfhack-run mcp_readTerrain ...`) still runs the script's tail.

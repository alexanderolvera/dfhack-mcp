# Contributing to dfhack-mcp

This server exposes a live Dwarf Fortress fort to an AI agent as curated,
read-only tools. The DFHack RPC transport,
[`dfhack-remote-node`](https://www.npmjs.com/package/dfhack-remote-node), is a
published npm dependency (its source lives in a
[separate repo](https://github.com/alexanderolvera/dfhack-remote-node)) — you
don't clone it to work on the server.

## Environment

- **Node 24** — pinned in [`.nvmrc`](.nvmrc) and `engines`. `nvm use` (or install
  Node 24) before anything. The server runs TypeScript directly via Node's type
  stripping (`node src/index.ts`); no ts-node.
- **Windows-native by default.** DF + DFHack run on the Windows host; there is no
  headless mode yet (that's [#27](https://github.com/alexanderolvera/dfhack-mcp/issues/27)).
- **Localhost only.** Never enable `allow_remote` in `remote-server.json`. The
  server only ever talks to `localhost:5000`.

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
| **T2** golden + invariants | `npm run verify:t2` | fixture save (#27) | local |

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
5. Verify against a live fort: `npm run verify:t1`. Author a golden once the
   fixture is available: `npm run verify:update`.

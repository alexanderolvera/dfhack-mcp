# Contributing to dfhack-mcp

This server exposes a live Dwarf Fortress fort to an AI agent as curated,
read-only tools. Two repos, gitted from commit one:

- **server** (this repo) — the tools and MCP wiring
- **client** — [`dfhack-remote-node`](https://github.com/alexanderolvera/dfhack-remote-node),
  the DFHack Remote RPC transport, consumed via `file:../dfhack-remote-node`

## Environment

- **Node 24** — pinned in [`.nvmrc`](.nvmrc) and `engines`. `nvm use` (or install
  Node 24) before anything. The server runs TypeScript directly via Node's type
  stripping (`node src/index.ts`); no ts-node.
- **Windows-native by default.** DF + DFHack run on the Windows host; there is no
  headless mode yet (that's [#27](https://github.com/alexanderolvera/dfhack-mcp/issues/27)).
- **Localhost only.** Never enable `allow_remote` in `remote-server.json`. The
  server only ever talks to `localhost:5000`.

## Setup — one command

Clone both repos **side by side**, keeping the client folder named
`dfhack-remote-node` (the server's dependency path is relative):

```
some-parent/
  dfhack-mcp-server/      # this repo
  dfhack-remote-node/     # the client (a junction/symlink to it is fine)
```

Then, from `dfhack-mcp-server/`:

```sh
npm run bootstrap
```

That verifies Node 24, confirms the sibling client is present, **builds the
client first**, installs the server, and runs the T0 contract check. It's
idempotent — re-run it any time the layout feels off.

> **Why client-first?** The server links the client through `file:../dfhack-remote-node`.
> If the client's `dist/` isn't built, the server won't typecheck. `bootstrap`
> (and CI) always build the client before installing the server.

## Verify — the tiered harness

Full detail in [`docs/VERIFY.md`](docs/VERIFY.md). The short version:

| Tier | Command | Needs | Gate |
| --- | --- | --- | --- |
| **T0** contract | `npm run verify:t0` | nothing | **CI-required** |
| **T1** reachability | `npm run verify:t1` | live fort | local |
| **T2** golden + invariants | `npm run verify:t2` | fixture save (#27) | local |

**Every tool is verified against a real running fort before it ships — no mocks.**
Lua runs *inside* DF, so "test infra" is provisioned frozen-save fixtures, not
unit tests. Keep `npm run typecheck` and `npm run lint` clean.

## Working overlapping issues in parallel

Multiple agents can work different issues at once, each in an **isolated git
worktree**:

```sh
npm run worktree feat/moods       # creates ../dfhack-mcp-server--feat-moods
```

This creates the worktree **as a sibling of the primary tree** (so
`file:../dfhack-remote-node` still resolves to the same built client), installs
its own `node_modules`, and confirms T0 passes before handing it off.

- **T0 is free and parallel.** Contract checks need no DF, so every worktree —
  and CI — can run them simultaneously. This is the gate that lets parallel work
  land safely: schema/registration drift is caught without the game.
- **The live DF is the one shared resource.** There's a single fort on a single
  port, so T1/T2 (live reachability, goldens) run **one worktree at a time**
  until [#27](https://github.com/alexanderolvera/dfhack-mcp/issues/27) provides
  multi-port / headless instances. Coordinate live runs; don't race the game.

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
3. Register it in `src/index.ts`.
4. **Add the tool name to [`test/expected-tools.json`](test/expected-tools.json)**
   — T0 fails until you do. That edit is the deliberate, reviewable record that
   the surface changed.
5. Verify against a live fort: `npm run verify:t1`. Author a golden once the
   fixture is available: `npm run verify:update`.

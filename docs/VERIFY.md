# Verification harness

`scripts/verify.mjs` proves, repeatably, that an agent can reach and correctly
call every MCP tool. It's a **scripted** deterministic client (not an LLM agent),
so it's free, fast, and CI-friendly. It spawns the server over real MCP stdio —
the same path a real client uses.

```sh
npm run verify:t0          # contract        (no game)
npm run verify:t1          # reachability    (live fort)
npm run verify:invariants  # Red/Green specs (any live fort, no golden needed)
npm run verify:t2          # golden+invariants (fixture container)
npm run verify:update      # rewrite goldens from the loaded fixture
```

Exit code is non-zero on any failure, so CI and pre-push hooks can gate on it.

## Ad hoc live-verification scripts

A few tools also have a standalone live-verification script, for deeper manual
checks the tiered harness's fixture-agnostic checks don't cover (specific
regression guards, live text output to read by eye). Each needs Dwarf
Fortress + DFHack running:

```sh
npm run verify:game-data   # game_data across all 6 kinds + two regression guards
npm run verify:trade-caravan   # trade with a caravan on-site (starts its own container)
```

`verify:trade-caravan` covers what the fixture save can't. The fixture has no
caravan, so the `trade` golden only ever sees `caravan_count: 0`. The script
starts a scratch `df-headless:53.15` container with this checkout's
`src/dfhack-queries` mounted, runs DFHack's `force Caravan`, and follows the
caravan through Approaching, AtDepot and Leaving. It shortens the departure
countdown to reach Leaving. In each state it pauses the game, calls `trade`, and
runs the `trade` invariants (`trade_caravan_rows_wellformed`,
`trade_state_consistency`). It also checks the numbers against DF's own
`caravan_state`: `leaving_in_days` matches `time_remaining / 120`, and
`manifest.approx_value` equals `import_value`. It never touches the shared
fixture save. It needs Docker and the built image, not a running game.
Defaults are `--name=df-trade-caravan --port=5011`. Pass `--keep` to leave the
container up for poking at, and `--timeout-min=N` to change the 15-minute limit.
It removes the container when it finishes.

## Artifact smoke test

`npm run smoke:artifact` (`scripts/smoke-artifact.mjs`) is the one gate T0
can't be: T0 launches `src/index.ts` under Node 24, but the published artifact
is `dist/index.js`, run by whatever Node the caller has. It builds a fresh
`dist`, `npm pack`s it (`--ignore-scripts`, so the deterministic tarball name
`dfhack-mcp-<version>.tgz` is the only thing depended on), installs the
tarball into a throwaway directory so its deps resolve from the registry —
not this repo's `node_modules` — then boots the installed bundle over MCP
with the gates pinned explicitly (`DFHACK_MCP_ACTUATORS=1`, `DFHACK_MCP_DEV`
unset) so the expected tool count (`SURFACE_ACTUATORS_ON`, derived from the
registry) can't drift with whatever
`DFHACK_MCP_*` the caller's shell happens to export. It asserts the handshake
version, tool count, and a handful of required tool names. Runnable locally
(needs network for the registry install); exit 0 means the artifact is
publishable, non-zero means do not publish.

## Why fixtures, not mocks

Lua runs *inside* Dwarf Fortress, and mocks are banned by the working agreement.
So "test infra" means **provisioned frozen-save fixtures**, not unit tests. DF
pauses, so we test against a paused, committed save: reads of a frozen fort are
deterministic, which makes golden-**value** snapshots viable — not just shape.
The frozen fort *is* the golden fixture — here, the paused fort baked into the
versioned DF container image ([#27](https://github.com/alexanderolvera/dfhack-mcp/issues/27)),
so the image tag is the fixture version.

## The tiers

### T0 — contract (no fort → CI-able today)

- Server starts and completes the MCP handshake.
- `tools/list` **equals** the expected set derived from [`src/tools/registry.ts`](../src/tools/registry.ts) (`ALL_TOOLS`, minus whatever the active env gates withhold — see below).
- Every tool has a description and a well-formed input schema.

Catches registration / schema / "server won't start" regressions that CI was
previously blind to. The expected set is filtered by the SAME predicate the server
registers with (`isGatedOff` in [`src/register.ts`](../src/register.ts)), so the
two can't drift.

T0 runs this check **twice**, each against its own subprocess with an explicit,
from-scratch env (any `DFHACK_MCP_DEV` / `DFHACK_MCP_ACTUATORS` inherited from
your shell is stripped first, so a pass never leaks into the other or picks up
ambient state):

- **default surface (gates off)** — neither gate var set. This is the surface an
  npm/npx install actually ships: the read-only curated tools, no `run_lua`, no
  actuators.
- **full surface (gates on)** — both `DFHACK_MCP_DEV=1` and `DFHACK_MCP_ACTUATORS=1`
  set. Adds the dev-only `run_lua` and the mutating actuators (e.g. `work_order_*`)
  to the expected set, so their schemas get the same description/input-schema
  checks as everything else — this is the only coverage `run_lua` gets anywhere in
  the harness.

Both the server's `tools/list` and each pass's expected set derive from the same
`ALL_TOOLS` registry, so adding or renaming a tool is a one-line edit in
`src/tools/registry.ts` (plus the tool's own module); that diff is the deliberate,
reviewable record that the surface changed.

### T1 — reachability (live fort)

Every tool is callable and returns well-formed JSON *or* the documented
`{"error":"no fort loaded"}`. This is the literal "an agent can reach and call
every command" check. Needs Dwarf Fortress running with DFHack and a fort loaded.
Every `{error}` payload the harness sees, in any tier, must also carry a known
`code` (`ERROR_CODES` in `src/errors.ts`); one without fails the run.

T1 has two assertion modes, opposite fixtures, mutually exclusive:

- **`--require-fort`** (loaded fixture): a no-fort guard is a **FAILURE**, so a
  broken headless load can't be reported as a verified instance.
- **`--no-fort`** (no-fort fixture — title screen, RPC up, no fort loaded): the
  **mirror**. Every *game-dependent* tool MUST return its `{"error":"no fort
  loaded"}` (or game_data's `"no game loaded"`) guard as **normal
  output** — not `isError`, not a crash/traceback, not a different error, and
  **not real data**. Anything else fails. The exception is `game_state`, the one
  tool built to work without a fort: it must return real data reporting
  `mode: "title"`, `world_loaded`/`map_loaded` false, both version strings, and
  `paused`/`clock`/`identity` null. `dfhack_command_list` reads only DFHack's own
  command list, so like the wiki tools it must return well-formed, non-error data. This is what actually **exercises** the
  no-fort guard ([#6](https://github.com/alexanderolvera/dfhack-mcp/issues/6)),
  closing the long-standing "guard coded but never exercised" gap, and it is the
  no-fort reachability path for
  [#28](https://github.com/alexanderolvera/dfhack-mcp/issues/28). A genuine
  "DFHack unreachable" surfaces as its connection error and correctly fails (it
  is not masked as a pass). Boot the
  no-fort fixture with the empty-`dfhack.init` container in
  [`docker/README.md`](../docker/README.md); run with
  `DFHACK_PORT=<port> … node scripts/verify.mjs --tier=1 --no-fort`.

> **Against a single live DF, run T1/T2 one worktree at a time.** The server
> registers its `dfhack-queries/` on a *global, DF-wide* script path
> (`dfhack.internal.addScriptPath`) and resolves `mcp_<name>` by name. Two servers
> against one DF stomp each other's resolution for same-named-but-divergent scripts
> (last registrant wins). **For real parallel verification, use the disposable
> headless DF containers** in [`docker/`](../docker/) ([#27](https://github.com/alexanderolvera/dfhack-mcp/issues/27)'s
> deliverable): one fort per worktree on its own port, so `DFHACK_PORT=<port> …
> verify:t1 --require-fort` runs concurrently. See [`docker/README.md`](../docker/README.md).

### Invariants — relational specs (Red/Green, any live fort)

Goldens answer *"did the output change?"*; invariants answer *"is the output
correct?"*. An invariant is a property true of **any** valid fort, not just the
frozen fixture — so it needs no committed golden and runs against whatever fort is
loaded. That makes `npm run verify:invariants` the **Red/Green** surface: add a
spec, watch it fail on today's code (**red**), fix the tool until it passes
(**green**) — a spec written *before* the behaviour, not a snapshot of behaviour
that already exists.

Specs live in [`test/invariants.mjs`](../test/invariants.mjs), one object each:

```js
{ name, tools: ['fort_status', …], desc, check(payloads) => string[] }  // [] === pass
```

A spec whose property spans several calls of one tool (a cursor contract, a
limit clamp, a lookup that must round-trip) adds `probes`:
`{ key: { tool, args(payloads) => args | null } }`. Each probe runs after the
`tools` payloads are captured, in declaration order, and its `args` sees those
payloads plus the earlier probes' results as `payloads.probes`; returning `null`
skips it. The results reach `check` as `payloads.probes.<key>`, and a probe that
returns an error fails the spec. `chronicle_cursor_contract` is the worked
example.

The runner captures each `tools` payload live and skips a spec as **n/a** if any
is missing or returned the no-fort guard, so `--invariants` degrades cleanly with
no fort. The seed set covers cross-tool consistency (`population_consistency` —
`fort_status`, `injuries_and_health`, and `stocks` must report the same
population, since all three derive it from `getCitizens(true)`), per-tool sanity
(happiness partitions the population, stock counts ≥ 0, health buckets ≤
population), and a real tool chain (`citizen_resolves_requested_unit` —
`citizen(find_unit.matches[0].unit_id)` returns *that* unit). Invariants also run
at the end of T2, reusing the payloads it already captured.

### T2 — golden + invariants (fixture container)

A full-payload golden snapshot per tool against the fixture, plus the invariants
above. Every tool is covered.

**The fixture is the versioned DF container image**
([`docker/`](../docker/), [#27](https://github.com/alexanderolvera/dfhack-mcp/issues/27)),
not a git-LFS save: its baked fort loads **paused**, so reads are byte-identical
across calls *and across container restarts* (verified), which is exactly what a
golden needs. So goldens in [`test/golden/`](../test/golden/) are **committed and
pinned to the image tag** (`df-headless:53.15`). A DF/DFHack/image bump that
changes output churns them **on purpose** — a reviewable diff, authored with
`npm run verify:update` against the loaded fixture, committed alongside the change.
Never `--update` against your own live Steam fort — that fort isn't frozen and the
goldens would flap. A tool with no committed golden **fails** a plain T2 run; only
`--update` writes a new golden, so a forgotten or deleted snapshot can't pass by
silently authoring itself.

T2 also drives the mutating actuators through their full preview → confirm →
apply → undo loop (`blueprint_*`, `work_order_create`/`_cancel`,
`assign_work_detail`), then reads the touched state back and fails if it differs
from before. These loops run after the goldens are compared, so running T2 twice
in a row against one container is the end-to-end proof that they leave the fixture
as they found it. One residue no read tool can see: `work_order_create` advances
DF's `manager_order_next_id`, so the next order created gets a higher id.

## Canonicalization

The only residual variation on an identical frozen fort is our own output
ordering (`pairs()` over unordered Lua tables/sets). So **canonicalize before
compare**: the harness sorts object keys recursively when writing goldens, and
tools should **sort any unordered list before they emit it**. With that, golden
diffs are rock-solid — and a version bump that changes output churns goldens *on
purpose* (a desired signal, not rot).

## Updating goldens

An intentional output change (new field, schema tweak, threshold retune, DF/DFHack
version bump) should surface as a reviewable diff:

1. Load the fixture save.
2. `npm run verify:update`.
3. Review the `git diff` under `test/golden/` — confirm the change is intended.
4. Commit the goldens with the code change that caused them.

Never `--update` against a non-fixture fort.

## Special cases

- **`chronicle()`** (when it lands, [#12](https://github.com/alexanderolvera/dfhack-mcp/issues/12))
  is the clock-stepping exception: its AC is about *only-new-events after time
  passes*, so its check steps the clock rather than staying frozen. Everything
  else is frozen by default.
- **`fort_health`'s `fps`/`gfps`** are a live-reading exception discovered verifying
  against the fixture: `df.global.enabler.calculated_fps`/`calculated_gfps` measure
  DFHack's own render/tick-loop cadence, which keeps advancing in real time even
  against a paused fort — confirmed live (two calls a few seconds apart returned
  `99`/`6` then `100`/`8`) while every other field in the same payload stayed
  byte-identical. `scripts/verify.mjs`'s `VOLATILE_FIELDS` masks just those two
  fields to `null` before the golden snapshot/compare, so T2 doesn't flap on
  wall-clock timing; the real values are still shape/bounds-checked live by the
  `fort_health_wellformed_and_bounds_population` invariant. See
  [`docs/tools/fort_health.md`](tools/fort_health.md)'s Implementation notes.
- **`historical_figure`** is goldened for more than one id. Its main
  `historical_figure.json` comes from `TOOL_ARGS`, and `HISTORICAL_FIGURE_GOLDEN_IDS`
  adds a `historical_figure.<hf_id>.json` for each extra fixture figure, so a dead
  citizen, a living citizen, a non-fort beast and a deity are all pinned. See
  [`docs/tools/historical_figure.md`](tools/historical_figure.md).
- **Actuators** (write tools, Tier 2 / M3) verify as **fixture → apply → assert
  readback → restore-fixture**. Still deterministic; the committed save is the
  anchor the apply is measured against and restored to.

## Roadmap (issue #28)

- **Phase 1 (done):** T0 in CI; T1/T2 + invariants runnable locally;
  canonicalization; dev-env standardized (`.nvmrc`, `engines`, `CONTRIBUTING.md`,
  `npm run bootstrap`). Plus the relational **invariants** layer (Red/Green), which
  needs no fixture.
- **Phase 2 (largely delivered):** the shareable fixture turned out to be the
  **versioned DF container image** (#27), not a git-LFS save — its baked fort loads
  paused and is deterministic across restarts, so goldens are now **committed and
  pinned to the image tag**. Remaining: a reset primitive for actuator (write-tool)
  round-trips.
- **Phase 3:** PRs into `main` spin up the headless DF container and run
  T1/T2/invariants live as a required check. The end state — the pieces
  (deterministic container, container-scriptable verify) are in place; wiring it
  as a required GitHub check is what's left.

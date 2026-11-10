---
tags: [dfhack-mcp/internals]
source: src/snapshot.ts
lua: src/dfhack-queries/mcp_snapshot.lua
---

# The snapshot publisher

> The game publishes state across frames; tools project it. Live reads stay available for everything, and writes stay live.

Productionized from the [#143 spike](spikes/snapshot-publisher.md) under
[#145](https://github.com/alexanderolvera/dfhack-mcp/issues/145). The spike page is the
evidence — measurements, dead ends, and the reasoning behind the split. This page is the
contract.

## Why

Most MCP reads pay a fixed cost before they do any work. On Windows,
`run_command_silent` costs about 6.6 ms per call in DFHack's script lookup, and a
`reqscript` on an already-cached module another 3.3 ms — so a read like `find_unit` spends
roughly 10 ms of **frozen game time** before it looks at a single unit. Tools that walk a
collection pay far more on top: `stocks` measured 28–103 ms per call, `fluids` 9–11 s, and
`map_overview` 1,104 ms, every call, with the game stopped for the whole walk.

The publisher moves that work off the request path. A Lua walker visits a slice of the fort
each frame, encodes what it sees, and publishes one JSON string when the pass completes. A
read then costs the RPC transfer and nothing else.

## The two walkers

Each walker has its own slice (entities per frame) and cadence (frames to wait between
passes), because map structure changes far more slowly than entity state.

| Walker     | Classes                         | Default slice | Default cadence     | Pass time |
| ---------- | ------------------------------- | ------------- | ------------------- | --------- |
| `entities` | `units,items,buildings,reports` | 16            | 600 frames (~6 s)   | ~5.5 s    |
| `map`      | `census`                        | 32            | 6000 frames (~60 s) | ~24 s     |

Slice is expressed in _unit-equivalents_: each class declares a measured per-entity cost
and `class_slice` scales the slice down for expensive classes, so every frame costs about
the same whichever class is being walked. At slice 32 the census walks about 10 blocks per
frame.

### Per-frame cost at the defaults — measured

`npm run bench:snapshot`, 2026-11-09, on a live **unpaused** fort: DF 53.16 Steam (win64) +
DFHack 53.16-r3, GPU renderer, FPS capped at 100. 192×192×164 (23,616 blocks), 270 units,
7,228 items, 464 buildings. 90 s steady-state window per config, so each covers a full
walk-plus-idle cycle. Main-thread Lua time comes from DFHack's own `update_lua_ms` counter.

| Config                            | lua_ms/s  | ms/frame | % of main thread | vs baseline | fps avg / min |
| --------------------------------- | --------- | -------- | ---------------- | ----------- | ------------- |
| publisher off                     | 6.0       | 0.06     | 0.6%             | —           | 99.5 / 99     |
| `entities` 16 / 600               | 108.1     | 1.08     | 10.8%            | **+10.2%**  | 99.3 / 98     |
| `map` 32 / 6000                   | 68.4      | 0.69     | 6.9%             | **+6.2%**   | 99.5 / 97     |
| **both — the defaults**           | **179.3** | **1.80** | **18.0%**        | **+17.4%**  | 99.7 / **72** |
| both, gentler (8/1800 + 16/12000) | 99.2      | 0.99     | 9.9%             | +9.3%       | 99.4 / 98     |
| publisher off (again)             | 6.5       | 0.07     | 0.7%             | +0.0%       | 99.6 / 98     |

**The defaults cost about 17% of main-thread time.** That is well above the ~1% the spike
reported for its units-only walker at slice 8 / 600 — the entity walker now carries items,
and items are 87% of its pass.

Reading the numbers honestly:

- **FPS did not move, and that proves nothing.** This fort is capped at 100 with spare frame
  time, so 17% of main thread is absorbed by headroom; average FPS stayed within noise
  (99.3–99.7) across every config, including the baselines. On a fort already running below
  its cap, that 17% comes straight out of FPS. The `fps_min` of 72 under both walkers is the
  one hint of a visible dip, but treat it as soft: frame gaps were large and noisy in _every_
  config, baselines included (max gap 156–234 ms, 13–22 gaps over 50 ms whether the
  publisher ran or not), so the gap watcher cannot separate the publisher from DF's own
  hitching on this machine.
- **The two walkers are near-additive**: 10.2% + 6.2% = 16.4% against 17.4% measured.
- **Max step stayed at 16 ms** (one Windows timer tick) for both walkers, so no single frame
  takes a visible hit — the cost is spread, not spiky. That is the slicing working.

Derived from the pass times below, cost _while walking_ is ~20% of main thread for the
entity walker (52% duty) and ~22% for the census (28% duty).

### Tuning

Cadence is the cheap lever: it changes the duty cycle without changing the per-frame hitch.
Slice shortens the pass — narrowing how far apart two records in one snapshot can be — at a
proportional per-frame cost. To land near a ~2% budget per walker on this fort, the arithmetic
from the measured while-walking cost wants roughly **entities 16 / 6000** (~60 s between
passes) and **census 32 / 24000** (~4 min), about 10× the current cadences. The cost of that
is freshness: entity facts up to ~66 s old rather than ~12 s.

Whether that trade is right is a product decision, not a measurement — the current defaults
are the ones [#145](https://github.com/alexanderolvera/dfhack-mcp/issues/145) specified, and
they are left as specified. The structural fix is giving items their own cadence, since they
are 87% of the entity pass; that is
[#151](https://github.com/alexanderolvera/dfhack-mcp/issues/151)'s problem anyway.

But no single default can be right: the cost depends on the CPU, on how large the fort is,
and on how much of the frame budget DF itself is already using — all of which change as a
fort grows. So cadence is tunable while the publisher runs, and can be governed
automatically.

#### Retuning in place

```
mcp_snapshot tune [slice] [cadence]          # the entity walker
mcp_snapshot tune_map [slice] [cadence]      # the census
```

Either argument may be empty to leave that value alone. Unlike `start`, `tune` **does not
restart anything**: the pass in flight keeps going, `latest` is kept, and `seq` does not
move. A new cadence takes effect when the current pass ends; a new slice takes effect on the
next pass, because per-class slices are computed once when a walk begins.

`status` reports both `cadence` (what is in effect) and `cadence_configured` (what was
asked for). The two differ only when the governor is backing off. `tuneWalker()` in
`src/snapshot.ts` is the same thing from the server side.

#### The governor

```
mcp_snapshot govern on [high] [low]
mcp_snapshot govern off
```

Also `DFHACK_MCP_SNAPSHOT_GOVERNOR=1`, with `…_GOVERNOR_HIGH` / `…_GOVERNOR_LOW`, which the
reader applies when it starts the walkers.

The control signal is the publisher's **measured effect on frame time**, not its CPU share —
because that is what actually matters, and because it is the thing that can be measured
honestly. A walker alternates between walking and idling, which hands the governor a
built-in A/B test on the same machine and the same fort seconds apart: it times every frame
and sorts each one into _busy_ (a pass is in flight) or _idle_ (neither walker is walking),
then compares the mean frame interval of the two.

```
inflation = mean_busy_frame_ms / mean_idle_frame_ms - 1
```

That makes it self-calibrating, with no absolute thresholds to guess per machine. It also
gives the property the measurement above argued for: **on a fort with headroom under its FPS
cap, inflation is ~0 and the governor correctly leaves an aggressive cadence alone**, because
there is no harm to undo. On a fort running below its cap the same cadence inflates frame
time, and the governor backs off. A fort that grows into that condition is handled while it
runs, which is the case a fixed default cannot cover.

Decisions, per window of at least `min_frames` (120) frames on each side:

| Measurement             | Action                                                         |
| ----------------------- | -------------------------------------------------------------- |
| `inflation > high` (5%) | after 2 consecutive windows, stretch cadence by 1.5×           |
| `inflation < low` (1%)  | after 3 consecutive windows, shrink it back towards configured |
| in between              | hold, and reset both streaks                                   |

Two properties are deliberate and worth relying on:

- **The governor never makes the publisher more aggressive than configured.** Level 0 is the
  configured cadence and is the floor; the governor only ever trades freshness away under
  measured harm, then gives it back. It cannot run away and start costing more than you
  asked for.
- **Backoff is bounded** at 16× the configured cadence, and reports `at_max_backoff` rather
  than climbing forever — so a fort that is slow for reasons unrelated to the publisher
  cannot drive the cadence to infinity.

Hysteresis (2 windows up, 3 down) and the dead band between `low` and `high` keep it from
oscillating. Samples reset after every decision so one window's measurement never smears
into the next configuration's.

`status.governor` reports `level`, `multiplier`, the last `inflation` and `decision`, and the
frame counts behind them.

The law itself is `src/dfhack-queries/mcp_snapshotGovernor.lua`, deliberately free of any
DFHack dependency so it can be exercised outside the game — `test/governor.lua`, run under
standalone Lua by `npm run test:unit`, covers the headroom case, hysteresis, the bound,
recovery not overshooting, the dead band, and a zero idle measurement.

`npm run verify:snapshot` covers the in-game half, with the watermarks forced low enough to
trip: the governor appears in status at level 0, backs off to level 1 (cadence 600 → 900)
while leaving `cadence_configured` at 600 as its recovery target, and `govern off` restores 600. Measured inflation on the fixture container was 0.6% — below the 5% default, so at the
defaults the governor correctly does nothing there, which is the behaviour to expect
anywhere the publisher is not actually costing frames.

### One complete pass at the defaults

Same live fort and run as the table above:

| Walker     | Pass wall time | Steps | Max step | Payload   |
| ---------- | -------------- | ----- | -------- | --------- |
| `entities` | 6,438 ms       | 576   | 16 ms    | ~3,115 KB |
| `map`      | 23,875 ms      | 2,364 | 16 ms    | ~76 KB    |

Within the entity pass:

| Class     | Records | Payload  | Share of the pass |
| --------- | ------- | -------- | ----------------- |
| items     | 7,691   | 2,739 KB | 5,578 ms (87%)    |
| reports   | 1,219   | 219 KB   | 500 ms (8%)       |
| units     | 321     | 77 KB    | 203 ms (3%)       |
| buildings | 464     | 80 KB    | 141 ms (2%)       |

**Items are 87% of the entity pass** — the spike measured 85% and the fixture container 79%,
so the shape is stable across forts and machines, and it is the one number that decides this
layer's cost. The census pass lands at 23.9 s for 23,616 blocks, matching the spike's ~24 s
estimate, and publishes only ~76 KB (almost all of it the surface map) because it keeps
counts plus the coordinates of rare features rather than tiles.

## What is not in the snapshot

- **Unit positions.** Re-measured on the live unpaused fort at the defaults, diffing each
  published unit against the live game:

  | Snapshot age | Position changed | Job changed | Death changed |
  | ------------ | ---------------- | ----------- | ------------- |
  | 1.4–2.0 s    | 50–55%           | 4–6%        | 0             |
  | 4.8–5.4 s    | 54–60%           | 4–8%        | 0             |
  | 8.2–8.8 s    | 55–63%           | 5–7%        | 0             |
  | 11.5–14.8 s  | 62–64%           | 6–7%        | 0             |

  **Half the fort has moved before a snapshot is two seconds old**, and it plateaus around
  64% — worse than the spike's 26–34% at ~1 s, because the entity pass here is 6.4 s rather
  than a units-only walk, so even the freshest record is several seconds old. Position is
  read live, or from the tile layer. Records still carry `pos` so a projection can report
  _where a unit was captured_, but a tool that needs current position must read live.

  Job changes sit at 4–8% and deaths at 0 across every age sampled, which is the other half
  of the result: **the slow-moving state that tools actually read is fine.** Roster, death,
  squad, stress and health move far slower than position.

  One caveat on that 4–8%: it is measured across _every_ active unit, and job churn is not
  spread evenly. `verify:snapshot` on the same fort found 4 of the 8 citizens shown by a
  `find_unit` query had a different `current_job` at a snapshot age of only 0.7 s — the
  figure concentrates in the citizens who actually take jobs, rather than the animals and
  visitors that make up much of the unit list. So `job_type` is the most staleness-sensitive
  field in the entity layer, which makes `jobs_and_labor`
  ([#154](https://github.com/alexanderolvera/dfhack-mcp/issues/154)) the migration that will
  need the shortest cadence or a live path.

- **Tiles, as a continuous snapshot.** A full map pass costs 7.4 s of main-thread time in
  Lua, or 16 s and 752 MB through RemoteFortressReader. The tile layer stays on demand and
  region-scoped. What the census keeps instead is counts per z-level plus the _coordinates_
  of rare features a model will want to locate (stairs, and under
  [#149](https://github.com/alexanderolvera/dfhack-mcp/issues/149) ore veins, liquids and
  fortifications).

## The `seq` contract

`seq` identifies **the published payload**, and the server caches by it: an unchanged `seq`
costs one small status call and no body transfer.

That makes the invariant load-bearing — _every_ change to what is published must advance
`seq`, including the drop to the no-fort marker. A walker that set
`latest = '{"error":"no fort loaded"}'` while leaving `seq` alone would leave every reader
serving its cached snapshot of a fort that is no longer loaded. `advance()` therefore bumps
`seq` on the transition into the no-fort state, and only on the transition, so idling at the
title screen does not churn `seq` and defeat caching. `test/snapshot.test.mjs` holds that
contract from both sides.

## Status and readiness

`status` reports `running`, `slice`, `cadence`, `classes`, `seq`, `ready`, `walking`,
`progress`, `steps`, `max_step_wall_ms` and `last_error`.

`ready` is the one readers must respect: it means a payload has been published. `start`
clears `latest`, so between starting a walker and its first completed pass there is nothing
to read — a reader that waited only on `seq > 0` would fetch `null`. The reader re-reads
status after starting the walkers and polls until `ready`.

## The read path

Readers call the resident module, never the script:

```lua
package.loaded['rpc.mcp_snapshot'] = { seqs = …, entities = …, map = … }
```

`callLua` (`src/dfclient.ts`) reaches it through DFHack's core RunLua RPC, which skips the
per-call script lookup that dominates small reads. DFHack only permits module names of the
form `rpc.*`, `*.rpc` or `*-rpc`, which is why the module is registered under `rpc.`.

The snapshot is concatenated once at publish time and never re-encoded per read.

## Surviving reloads and second copies

A DFHack script's environment persists across runs _and_ across file edits, and DFHack keeps
state per file — so two checkouts pointed at one game (the server loading `dist/`, a bench
loading `src/`) would otherwise each run their own walkers. Three rules keep that safe:

1. **State lives on `dfhack.mcp_snapshot_state`**, not in the script's own environment, so
   every copy shares one set of walkers.
2. **`walker()` back-fills every default on every call.** `state = state or {}` preserves a
   table written by an older version of the file, which is then missing any key added since;
   one `nil` comparison killed the timer chain during the spike. Back-filling per call means
   a reload can never leave a field unset.
3. **Each `start` bumps a generation counter**, and every timer step checks its captured
   generation still matches. A step from a superseded chain returns instead of walking, so a
   reload or a double `start` cannot leave two chains walking and overwriting each other's
   `wk.timer` — of which `stop` could only ever cancel the last.

## Fog of war

The publisher records `hidden` for every unit, item and building through
`mcp_readTerrain`'s shared `fog_gate({})`, and the census classifies revealed tiles only —
hidden tiles are counted, never classified. The TypeScript projections apply `reveal_hidden`
over those captured facts. `test/fog.test.mjs` asserts snapshot-backed tools use the shared
parameter and carry the shared note, and that the Lua goes through the gate.

## Commands

```
mcp_snapshot autostart              # both walkers at their defaults
mcp_snapshot start [slice] [cadence] [classes]
mcp_snapshot start_map [slice] [cadence]
mcp_snapshot stop                   # both
mcp_snapshot status | status_map
mcp_snapshot get | get_map          # status plus the payload
```

`bench_classes [block_limit]` (per-entity cost in one suspend) and `gap start|stop` (the
frame-gap watcher) are the in-game cost instruments; `npm run bench:snapshot` drives the
latter.

### Autostart from `dfhack.init`

The server starts the walkers on first use, so autostart is optional — it only removes the
first call's warm-up wait. The script must be on DFHack's path first:

```
script-paths add /path/to/dfhack-mcp/src/dfhack-queries
mcp_snapshot autostart
```

`autostart` is idempotent: a walker already running is left alone, so re-running it never
restarts a pass in flight.

## Environment

| Variable                            | Default | Effect                                                                                                                |
| ----------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `DFHACK_MCP_SNAPSHOT`               | unset   | Registers `snapshot_query` and `z_levels`, and lets snapshot-backed tools project instead of reading live.            |
| `DFHACK_MCP_SNAPSHOT_SLICE`         | `16`    | Entity walker slice.                                                                                                  |
| `DFHACK_MCP_SNAPSHOT_CADENCE`       | `600`   | Entity walker cadence, in frames.                                                                                     |
| `DFHACK_MCP_SNAPSHOT_MAP_SLICE`     | `32`    | Census slice.                                                                                                         |
| `DFHACK_MCP_SNAPSHOT_MAP_CADENCE`   | `6000`  | Census cadence, in frames.                                                                                            |
| `DFHACK_MCP_SNAPSHOT_GOVERNOR`      | unset   | Turns the cadence governor on when the reader starts the walkers.                                                     |
| `DFHACK_MCP_SNAPSHOT_GOVERNOR_HIGH` | `0.05`  | Frame-time inflation above which the governor backs off.                                                              |
| `DFHACK_MCP_SNAPSHOT_GOVERNOR_LOW`  | `0.01`  | Inflation below which it recovers towards the configured cadence.                                                     |
| `DFHACK_MCP_SNAPSHOT_WARMUP_MS`     | `90000` | How long a read waits for a first payload. The census needs ~24 s, so the first call after a cold start is slow once. |
| `DFHACK_MCP_SNAPSHOT_POLL_MS`       | `250`   | Status poll interval while waiting.                                                                                   |

## Implementation notes

- **Atomicity holds per record, not per snapshot.** A sliced pass spreads across its walk
  time, so two records in one payload can be up to one pass apart (~5.5 s at the entity
  default). Every individual record is internally consistent. Narrowing the window means a
  larger slice and a proportionally larger per-frame cost.
- **Encode inside the slice, concatenate at publish.** Each record is JSON-encoded as it is
  visited, so publishing is one `table.concat`.
- **The walker stores ids, never pointers**, and re-checks `isMapLoaded()` every step, so a
  fort unloading mid-walk cannot leave it dereferencing freed memory.
- **Guard every optional field read.** Zones and stockpiles have no `contained_items`; 100
  of 464 building records came back as errors during the spike until `field()` wrapped those
  reads in `pcall`. `encode_safe` emits `{id, error}` for a record that throws rather than
  failing the pass.
- **`os.clock()` overcounts** — it is process CPU across all of DF's threads (222 ms CPU
  against 115 ms wall in one bench). Use `getPerfCounters().update_lua_ms` for main-thread
  cost and `getTickCount()` for wall time. Windows `getTickCount` ticks in ~16 ms steps, so
  single-step maxima read 0 or 16; averages come from loops.
- **Per-unit cost is dominated by name translation.** At ~95 µs per unit the expensive calls
  are `getReadableName` / `getProfessionName`. Caching names by unit id is the untested next
  lever.
- **Blocks do not deduplicate.** 1,845 of 2,000 sampled blocks were unique, because
  designation bits vary tile by tile — so there is no cheap win in hashing blocks.

## Verifying

| Check                                       | Command                                      | Needs               |
| ------------------------------------------- | -------------------------------------------- | ------------------- |
| Reader contract, including no-fort recovery | `npm run test:unit`                          | nothing             |
| Lua parses                                  | `npm run lint:lua`                           | `luac` on PATH      |
| Tool surface under the gate                 | `npm run verify:t0`                          | nothing             |
| Publisher in-game, plus `find_unit` parity  | `npm run verify:snapshot`                    | live fort           |
| The no-fort guard in-game                   | `node scripts/verify-snapshot.mjs --no-fort` | no-fort fixture     |
| Walker cost at and around the defaults      | `npm run bench:snapshot`                     | live, unpaused fort |

Against a containerized DFHack, pass the container-internal query dir and disable Git Bash
path conversion, or `addScriptPath` silently gets a Windows path and every call fails as
"not a recognized command":

```bash
MSYS_NO_PATHCONV=1 DFHACK_PORT=5001 DFHACK_MCP_QUERY_DIR=/opt/df/mcp-queries node scripts/verify-snapshot.mjs
```

`test/snapshot.test.mjs` models the publisher's own seq/ready/no-fort rules against the real
reader, so the unload-and-recover path is covered off-game.
`npm run verify:snapshot` then covers the in-game half that a unit test cannot: that the Lua
actually runs under DFHack, that every class publishes without per-record errors, that
`autostart` is idempotent, that a completed pass advances `seq`, and that `find_unit`
projected from the snapshot agrees with the live Lua query. It leaves both walkers stopped.

**Parity is pause-aware, and has to be.** With the game paused the projection must be
deep-equal to the live query — that is the real assertion, and it holds (7/7 on the spike's
fort, 6/6 on the fixture container). On a _running_ fort it legitimately will not: a
snapshot is as old as its pass, 4–8% of units change job in that window, and a query showing
up to 8 matches will usually include one that moved. So unpaused, the check requires the
**identity spine** (`unit_id`, `name`, `profession`, `age`, `squad`, plus `match_count` and
`truncated`) to match exactly, and reports `current_job` / `stress` / `wounded` / `patient`
/ `unconscious` differences as drift rather than failure. A spine mismatch would be a real
projection bug; drift is the snapshot being a few seconds old, which is exactly what the
provenance metadata in
[#146](https://github.com/alexanderolvera/dfhack-mcp/issues/146) exists to tell the caller.

`--no-fort`, pointed at the no-fort fixture ([`docker/README.md`](../docker/README.md)),
covers the other side: that the walkers come up at the title screen, publish
`{"error":"no fort loaded"}` **under a new `seq`**, hold that `seq` steady while idling, and
that `readSnapshot()` returns the shared guard tagged `NO_FORT`. Measured on the fixture:
`seq 3 -> 4` on the transition, then stable across 5 s of idling.

Because publisher state is durable across script reloads by design, a second run in the same
DF process does not start from `seq 0` — these checks assert the _transition_, never an
absolute `seq`.

Two things still need a fort neither harness can produce on demand: a fort **unloaded
mid-walk** (the headless container cannot abandon or retire a fort to order, so only the
already-no-fort case is covered), and **cost at the defaults on a fort running below its FPS
cap**. Both are the open half of
[#145](https://github.com/alexanderolvera/dfhack-mcp/issues/145)'s acceptance.

# Spike #143: snapshot publisher (PoC findings)

**Verdict: feasible for entities, cheap at a sane cadence; not for the map.**

- **Build:** a timeout-chained Lua walker builds a versioned unit snapshot across frames.
- **Parity:** `find_unit` served from the snapshot is deep-equal to the Lua query on every query tried, paused and unpaused.
- **Walker cost on a live fort:** at slice 8 with a 300–600 frame cadence it's about 1% of main-thread time or less. FPS and frame gaps can't be told apart from the publisher being off.
- **Two live surprises:**
  1. On Windows, most of a small read's freeze is DFHack's per-call **script lookup** (about 6.6 ms), not the query.
  2. **Unit positions go stale within a fraction of a second**, so position doesn't belong in a cached snapshot.

## Live test (2026-11-08)

Setup: Alex's fort, DF 53.16 Steam (win64) + DFHack 53.16-r3, **unpaused**, GPU renderer, FPS capped at 100 (GFPS 49). 244 active units, 57 citizens, 6,765 items. Instruments:

- `scripts/spike-snapshot.mjs`;
- a cadence, read-cost and staleness sweep, `scripts/spike/live-sweep.mjs`;
- a dispatch probe.

Timer caveat: Windows `getTickCount` ticks in about 16 ms steps, so single-step maxima read 0 or 16. The averages below come from loops or perf counters.

### Walker cost against the live game (10 s windows)

| Config                   | FPS avg / min | Lua ms/s (DFHack perf counter) | Max frame gap | Gaps > 50 ms |
| ------------------------ | ------------- | ------------------------------ | ------------- | ------------ |
| publisher off            | 99.8 / 99     | 6.2                            | 125           | 1            |
| slice 8 / 30 frames      | 99.4 / 99     | 43.5                           | 125           | 2            |
| slice 8 / 300 frames     | 99.4 / 99     | 16.8                           | 94            | 2            |
| **slice 8 / 600 frames** | 99.0 / 99     | **7.6**                        | 46            | 0            |
| slice 4 / 300 frames     | 98.8 / 98     | 9.3                            | 109           | 1            |
| slice 16 / 300 frames    | 99.0 / 98     | 15.3                           | 109           | 2            |
| publisher off (again)    | 99.4 / 99     | 10.8                           | 94            | 2            |

- A full 244-unit walk costs about **22–24 ms** of main-thread time, roughly 95 µs per unit. That's about twice as fast as the container.
- The "off" baseline moves between 6 and 11 ms/s and has 125 ms gaps of its own, from DF and other scripts. At a cadence of 300 frames or more the publisher sits inside that noise.
- **The FPS cap hides headroom.** This fort has spare frame time, so FPS doesn't move. On a fort running below the cap, main-thread time comes straight out of FPS: 1% of main thread ≈ 1% FPS. Re-test on a laggy fort before calling it free.
- Max single step at slice ≤ 16 was below one 16 ms tick in most windows; the gap watcher saw nothing the publisher-off runs didn't also show.

### Read cost: game time per call (in-game loop, average)

| Read                    | ms/call | Output              |
| ----------------------- | ------- | ------------------- |
| `stocks`                | 28.1    | 1.9 KB              |
| `fort_status`           | 21.1    | 0.7 KB              |
| `citizen`               | 17.2    | 5.6 KB              |
| `threats`               | 15.7    | 0.1 KB              |
| `military`              | 15.6    | 7.4 KB              |
| `jobs_and_labor`        | 12.5    | 1.8 KB              |
| `unmet_needs`           | 10.9    | 0.6 KB              |
| `find_unit a`           | 10.2    | 2.1 KB              |
| snapshot `get` (script) | 7.2     | 61.0 KB, every unit |

**Script dispatch dominates small reads on Windows:**

| Step                                                     | Cost per call                                      |
| -------------------------------------------------------- | -------------------------------------------------- |
| `run_command_silent('mcp_snapshot', …)`, any output size | 6.56 ms                                            |
| `dfhack.findScript('mcp_snapshot')` alone                | 3.29 ms                                            |
| `reqscript` on a cached module                           | 3.28 ms (it calls `findScript` and stats the file) |
| reading the snapshot table once dispatched               | ~0                                                 |

So today `find_unit` costs about 6.6 ms of dispatch, plus 3.3 ms for its `reqscript('mcp_jsonOut')`, plus well under 1 ms of actual work. Most MCP reads pay that roughly 10 ms floor before they do anything. The container hid it because Linux `stat` is cheap. This matters beyond the snapshot design:

- **For the snapshot getter:** skip script lookup entirely. Publish the state on a global the RPC snippet can reach directly (for example `dfhack.mcp_snapshot = state`), and read it with `runLuaSnippet`. Expected cost: about the RPC transfer and nothing else.
- **For today's tools:** the per-call floor is in `run_command` and `reqscript`, so moving query code to resident modules would cut every read's freeze even without the snapshot.

### Staleness: snapshot against the live game (slice 8, cadence 600 frames)

| Snapshot age | Units whose position changed | Job changed | Death changed |
| ------------ | ---------------------------- | ----------- | ------------- |
| 0.1–1.1 s    | 26–34%                       | 0–2%        | 0             |
| 1.7–2.7 s    | 38–46%                       | 2–4%        | 0             |
| 3.3–4.9 s    | 45–51%                       | 2–6%        | 0             |
| 5.8 s        | 48–57%                       | 6–8%        | 0             |

- **Position is not snapshot material.** A quarter of units have moved before the walk even finishes. Read positions live, or from the tile layer.
- **Slow state is fine.** Jobs change for about 1% of units per second; roster, death, squad, stress and health change far slower. Those are the bulk of what tools read.
- This suggests **per-field-class cadence**: roster and identity rarely, jobs and health every few seconds, never position. That's the same answer the items layer will need.

### Parity, live and unpaused

`find_unit` from the snapshot is deep-equal to Lua on all 7 queries (0–57 matches). Its fields (job type, stress, wounds, squad) move slowly enough that a few-second-old snapshot still matched exactly.

## Whole-fort snapshot (2026-11-08, live fort, paused)

The question: what if the snapshot covered the entire fort, map blocks included? The walker now takes a class list (`start <slice> <cadence> units,items,buildings,reports,blocks`). It walks the classes in order, with per-class slice sizes weighted by measured cost, so every frame costs about the same. Blocks are walked and encoded but **not published**; a 118 MB string has no business in DF's Lua heap.

Fort: 192×192×164 tiles (6.05 M tiles, 23,616 blocks), 274 units, 7,359 items, 464 buildings, 1,172 reports.

### Cost per entity (one suspend, `bench_classes`)

| Class                                           | Count  | µs each                 | Full pass     | JSON                  |
| ----------------------------------------------- | ------ | ----------------------- | ------------- | --------------------- |
| units                                           | 274    | 95                      | 26 ms         | 0.06 MB               |
| items (with description)                        | 7,359  | 87                      | 0.64 s        | 2.08 MB               |
| buildings                                       | 464    | 34                      | 16 ms         | 0.07 MB               |
| reports                                         | 1,172  | 67                      | 78 ms         | 0.20 MB               |
| map blocks (tiletype + designation + occupancy) | 23,616 | 312 read/pack + 164 hex | 7.4 s + 3.9 s | 59 MB raw, 118 MB hex |

The item description is nearly free (85 → 87 µs). Blocks don't deduplicate: 1,845 of 2,000 sampled blocks were unique, because designation bits vary tile by tile.

### Sliced, in-game

| Walk                   | Per frame | Share of main thread while walking | One complete pass         | Snapshot                   |
| ---------------------- | --------- | ---------------------------------- | ------------------------- | -------------------------- |
| all entities, slice 8  | 0.98 ms   | 9.8%                               | **11.1 s** (1,089 frames) | 2.42 MB, client read 45 ms |
| all entities, slice 32 | 3.17 ms   | 31.9%                              | 3.1 s (258 frames)        | same                       |
| blocks, 1 per frame    | 0.67 ms   | 6.7%                               | **3.9 min**               | (not published)            |
| blocks, 7 per frame    | 3.36 ms   | 33.7%                              | 0.6 min                   | (not published)            |

Max frame gap stayed at 32 ms (two Windows timer ticks) in every run. FPS held at 100, but the fort was paused and capped. On a fort below the cap, a 3 ms/frame walker costs about 30% FPS.

### RemoteFortressReader (native C++) for the same map

| Pass                                          | Game + transfer             | Size                | Notes                                                                         |
| --------------------------------------------- | --------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| full map, `forceReload`, one z-level per call | 15.9 s, slowest call 141 ms | **752 MB** protobuf | +3.7 s decode in Node; one 16-level call failed with "reply too large: 72 MB" |
| changes only, nothing changed (paused)        | 2.3 s                       | 618 blocks resent   | its change check still visits every block                                     |

The full-map RFR numbers are its worst case, not its normal use. Armok Vision, the client RFR was written for, asks for a camera-sized window, uses RFR's per-block hashes to get changed blocks only, and caps blocks per request. (Stonesense uses none of this; it is an in-process C++ plugin reading a bounded segment around the view.) That pattern, measured on the same fort:

| Request (5x5 blocks x 5 z-levels around the view, 125 blocks) | Time                    | Size              |
| ------------------------------------------------------------- | ----------------------- | ----------------- |
| first load                                                    | 85 ms                   | 4.1 MB            |
| first load capped at 16 blocks                                | 6 ms                    | 636 KB            |
| steady poll, changed blocks only (x20, paused)                | median 19 ms, max 22 ms | 34 blocks, 103 KB |

Cost scales with the window, not the fort: about 0.7 ms per block on first load. Even paused, 34 blocks in the window come back "changed" on every poll, so the change detection is coarser than real tile changes.

### What this says

- **Entities: yes.** The whole entity layer fits in a 2.4 MB snapshot, about 1 s of main-thread time per complete pass. At slice 8 with a 60 s cadence that's about 2% averaged; the cadence policy decides the rest. Items are 85% of the cost, so they're the class to optimize, or the class to give its own cadence.
- **The tile layer should follow Armok Vision's pattern:** region-scoped, changed-only through RFR's hashes, capped per call, which puts it at about 6–20 ms per request. Open question: whether RFR's hash state is per connection or global to the plugin. If it's global, two clients (Armok and the MCP) would steal each other's change notifications.
- **The map: no, not as a continuous snapshot**, by either route. Lua needs 7.4 s of main-thread time per pass, and minutes of wall time if sliced politely. RFR needs 16 s and 752 MB, and even its no-change poll costs 2.3 s. The tile layer stays **on demand and scoped by region**, read live, which is the split the ticket already guessed: snapshot = entities, tiles = per-request.
- **A one-off full-map capture is fine** where a 7–11 s freeze is acceptable: building fixtures, or a "map baseline" taken at load. Change tracking after that would need DF events or per-block hashes, and re-hashing every block costs a full read anyway.
- **"Atomic reads" only holds per entity.** A sliced pass spreads across its walk time: items took 9.2 s of the 11.1 s pass at slice 8. Every record is internally consistent, but two records can be up to one walk time apart. On a running fort that's the price of not freezing it. Faster slices (slice 32: 3 s) narrow the window at about 3× the per-frame cost.

## Relay prototype: query tool + z-level census (2026-11-08, live fort, paused)

The bottleneck in a real warden request turned out to be finding things, not game time. The model needs a cheap index and precise questions, not more state. Two tools, both behind `DFHACK_MCP_SNAPSHOT`:

- **`snapshot_query`** filters, projects, groups and counts over any entity class (units, items, buildings, reports, squads). It takes exact or op matches (`eq/ne/lt/lte/gt/gte/in/contains/exists`), dotted paths, `group_by`, `count_only`, `sort_by` and an optional caller `limit`. Nothing is truncated by the server.
- **`z_levels`** gives one row per revealed z-level. Each row has tile counts by class over revealed tiles (open, floor, constructed, stair, ramp, tree, stone/ore/soil walls, liquid), the hidden count, and per-level citizens, other units, workshops, stockpiles, zones, bedrooms and unowned bedrooms. It's columnar; fully unrevealed levels collapse into ranges.

Built on:

- **Two walkers.** Entities: about 5.5 s per pass at slice 16. The map census: 23,616 blocks at 168 µs each, so about 24 s per pass sliced at 10 blocks per frame. It publishes **2.3 KB for the whole map**: 41 revealed levels, plus `unrevealed_z: [[0,122]]`.
- **A direct read path.** A `package.loaded['rpc.mcp_snapshot']` module is called through the core RunLua RPC, which skips DFHack's 6.6 ms per-call script lookup. DFHack only permits module names of the form `rpc.*`. The server caches each snapshot by `seq`, so an unchanged snapshot costs one tiny status call.
- **Fog through the shared gate.** The publisher records `hidden` for every unit, item and building through `mcp_readTerrain`'s `fog_gate({})`. The census classifies only revealed tiles. The TypeScript tools apply `reveal_hidden` over those facts. A new invariant test covers this pattern.
- **New entity fields:** item `material` token, real position (`getPosition`, resolving containers and holders), `construction`; building `zone_type` and `owner` for zones.

### The bedroom request, discovery only

|                      | Original run                    | With the prototype                                                       |
| -------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| Calls                | 13                              | 8                                                                        |
| Bytes into the model | ~40 KB                          | **6.9 KB**                                                               |
| Blind probes         | 3 tile_region guesses           | 0 (`z_levels` showed z123–136 untouched and the bedrooms on z141)        |
| Time (warm)          | ~10–28 ms of game time per call | ~95 ms total for 7 calls; `map_overview` (old Lua path) alone took 1.2 s |
| First call ever      | —                               | 24 s, once: it waits for the first census                                |

The answers it got that the original run couldn't:

- **All 61 bedroom zones are on z141, 7 unowned**, with their rectangles. The original run never looked at z141.
- **Free furniture: 9 beds, 14 doors, 9 cabinets, 9 boxes** (not installed, not forbidden, not in a job). The original run inferred "about 20 free beds" from totals; that was wrong.
- **Stone by material**: 16 boulder materials, fire clay 932, gypsum 150, and so on.

So the 16-room plan needs work orders for at least 7 beds and some storage. That's now a fact-based decision.

### Bugs found and fixed

- **Stop/start served `null`.** `start` cleared the published snapshot but kept `seq`, so a reader that waited on `seq > 0` fetched nothing. The status now reports `ready`, and the reader re-reads status after starting walkers.
- **Two copies of the script, two states.** The server loads `dist/` and the bench loads `src/`; DFHack keeps per-file state, so each copy would start its own walkers. State now lives on `dfhack.mcp_snapshot_state`.
- **Zones and stockpiles have no `contained_items`.** 100 of 464 building records came back as errors until field reads were guarded.

### map_overview moved onto the census

In the rerun above, `map_overview` was the one slow call, at 1.2 s. Its Lua walks all 23,616 blocks on **every call**, freezing the game for the whole walk. The census already visits every tile in the background, but at first it kept only counts.

Rare features now keep their positions: the census records stair tiles `[x,y,z,U|D|X]` (92 on this fort), a per-column surface height (the highest revealed, open-to-sky ground tile; hex, 2 characters per column), the levels with pending digs, and the levels with constructions. `projectMapOverview` rebuilds the tool's exact payload in TypeScript: the same citizen centroid, column splitting by DF stair rules, height ranking, and 40-column cap. With `DFHACK_MCP_SNAPSHOT` set, `map_overview` serves from it; `reveal_hidden=true` still goes to the Lua.

|                            | Lua `map_overview`                   | From the snapshot |
| -------------------------- | ------------------------------------ | ----------------- |
| Per call                   | **1,104 ms**, game frozen throughout | **6 ms**          |
| Parity on the paused fort  | —                                    | deep-equal        |
| Bedroom discovery, 8 calls | 1,322 ms total                       | **134 ms total**  |

The trade-off is freshness. Pending digs show up when the census next refreshes, about once a minute, instead of instantly. Stairs and the surface barely change. If digging freshness matters, the dig levels are cheap to read live (only flagged blocks need checking), and everything else can stay on the census. The map snapshot grows from 2.3 KB to 76 KB, almost all of it the surface map. That stays inside the server, cached by `seq`; nothing extra reaches the model.

Rule this established for the census: counts are fine for common tiles, but **rare features a model will want to locate (stairs, ore veins, liquids, designations) keep their coordinates.**

## Container PoC (2026-11-08)

Measured against the fixture fort (Dreamfort, 365 active units, 78 citizens, paused). Setup: `df-headless:53.15` container, DF 53.15 + DFHack 53.15-r2, software GL under Xvfb, on a Windows host via Docker Desktop.

## What was built

| Piece      | Where                                 | What it does                                                                                                                                                                                                                                                                    |
| ---------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publisher  | `src/dfhack-queries/mcp_snapshot.lua` | Persistent module script. `start [slice] [cadence]`, `stop`, `status`, `get`. Each frame it encodes `slice` units (0 = all). When a walk finishes it publishes one JSON string, then waits `cadence` frames before the next walk. `bench` and `gap` are spike-only instruments. |
| Reader     | `src/snapshot.ts`                     | `readSnapshot()`: gets the latest snapshot and starts the publisher if it isn't running. Waits up to 15 s for the first walk. Maps the no-fort marker to the shared `NO_FORT` guard. Adds `age_ms`.                                                                             |
| Projection | `src/tools/findUnit.ts`               | `projectFindUnit(snapshot, query)` rebuilds find_unit's exact payload in TS. Used only when `DFHACK_MCP_SNAPSHOT=1`; the default path is unchanged.                                                                                                                             |
| Bench      | `scripts/spike-snapshot.mjs`          | Cost by slice, freeze scenarios, parity check.                                                                                                                                                                                                                                  |

Snapshot shape: `{seq, captured_at_ms, started:{year,year_tick}, captured:{...}, walk:{stats}, squads:[{id,name}], units:[...]}`. Each unit carries `id, name, profession, race, citizen, dead, age, stress_category, job_type, squad_id, wound_count, needs_healthcare, unconscious, pos`. Values are raw, with no bucketing; the projection maps `stress_category` to a word, the way the Lua does.

## Numbers

### Read cost: game time per call (in-game, `run_command_silent` ×N, `getTickCount`)

| Read                | ms/call   | Output               |
| ------------------- | --------- | -------------------- |
| `stocks` (Lua)      | **103.2** | 0.4 KB               |
| `military` (Lua)    | 18.8      | 2.9 KB               |
| `citizen 112` (Lua) | 4.6       | 3.3 KB               |
| `fort_status` (Lua) | 3.0       | 0.4 KB               |
| `find_unit a` (Lua) | 2.9       | 2.0 KB               |
| **snapshot `get`**  | **0.8**   | 83.1 KB (every unit) |

Client round-trip times over the Docker bridge are bimodal: 2–3 ms or 80–90 ms, and the slow mode hits the _smaller_ outputs. That looks like delayed-ACK latency on the bridge. Treat client-side latency as transport noise, not game cost.

### Walker cost (DFHack's own perf counter `update_lua_ms`, `resetPerfCounters(true)` so it counts while paused; cadence 30 frames)

| slice | frames/walk | max single step | Lua ms/frame (avg) | Lua ms/s |
| ----- | ----------- | --------------- | ------------------ | -------- |
| 1     | 366         | ≤4 ms           | 0.15               | 15       |
| 4     | 93          | ≤2 ms           | 0.42               | 42       |
| 8     | 47          | ≤7 ms           | 0.6–1.0            | 61–98    |
| 16    | 24          | ≤9 ms           | 1.1                | 113      |
| 64    | 7           | ≤10 ms          | 1.3–2.0            | 132–200  |
| all   | 2           | **55–80 ms**    | 1.2–1.8            | 115–183  |

- A full 365-unit walk costs **about 50–75 ms of main-thread time**, roughly 150–200 µs per unit, whatever the slice. Slicing spreads that cost across frames; it doesn't shrink it.
- **Walking everything in one frame is a visible hitch** (55–80 ms). Keep slices small.
- **Cadence sets the bill.** At a 30-frame cadence (about 0.3 s) the walker is 10–18% of main-thread time, which is far too aggressive. At a 5 s cadence the same walk is about 1%. The spike only measured 30 frames; the live test should sweep cadence.
- Starting a walk (collecting ids, the citizen set and squad names) takes 0–3 ms.
- Max-step values have 1 ms resolution, and the host was noisy: the encode bench read 63 µs/unit in one run and 107 µs in another.

### Freeze: unresolved in the container

The bench records the longest gap between consecutive game frames while each workload runs. Inside the container, even idle with the publisher **off**, the max gap is about 96 ms, with about 49 gaps over 50 ms in 3 s. Software-GL rendering delivers frames in bursts, and that jitter swamps every read cost above. **The freeze comparison needs a real GPU machine.** It's in the live-test plan below.

## Answers to the ticket's questions

| Question                      | Answer from the PoC                                                                                                                                                                                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incremental without hitching? | **Units: yes**, at slice ≤8 (single-digit ms steps). Items, buildings, zones and reports are not built yet. Items will dominate: the fixture has about 12k against 365 units.                                                                                                                              |
| Transport: file vs RPC getter | **RPC getter.** 0.8 ms in-game for 83 KB. No shared filesystem needed, so it works the same in the container. The snapshot is concatenated once at publish time, never re-encoded per read.                                                                                                                |
| Cadence / staleness           | Every snapshot carries `captured` (game tick) and `age_ms`. The paused fixture can't show drift; the live test must. Whether a "refresh now" is needed is still open.                                                                                                                                      |
| Full rewrite vs deltas        | Units: a full rewrite is fine (82 KB). Items at about 12k likely need per-class cadence or dirty tracking. Untested.                                                                                                                                                                                       |
| Spatial split                 | Not exercised; nothing here contradicts "snapshot = entities, RFR = tiles".                                                                                                                                                                                                                                |
| State changes                 | No fort → `{"error":"no fort loaded"}` with `NO_FORT`, verified on the `nofort` container. The walker stores unit **ids**, never pointers, across frames and re-checks `isMapLoaded` every step. That's built for unload mid-walk, but **not tested**: the headless harness can't unload a fort on demand. |
| Survives reconnects / toggle  | Yes. One client started it, others read it (`dfhack-run`, separate Node processes); `stop` turns it off. Starting it from `dfhack.init` is not tested. The script must be on the path first, so it would need `addScriptPath` in init.                                                                     |

## Things the spike found

1. **Reload hazard.** A script's environment persists across runs _and_ across file edits, so `state = state or {...}` keeps a stale table missing any new keys. One `nil` comparison then killed the timer chain. Fixed by back-filling defaults. Anything long-lived in DFHack Lua needs this.
2. **`os.clock()` overcounts.** It is process CPU across all of DF's threads: 222 ms CPU against 115 ms wall in one bench. Use `getPerfCounters().update_lua_ms` for cost and `getTickCount()` for wall time.
3. **Encode while walking, concatenate at publish.** Each unit is JSON-encoded inside its slice, so publishing is one `table.concat` with no per-read encoding.
4. **Per-unit cost is the lever.** At about 150–200 µs/unit the expensive calls are probably `getReadableName` / `getProfessionName` (name translation). Caching names per unit id is the obvious next experiment; it wasn't profiled.

## Live test plan (original; steps 1–4 done above, 5 still open)

On a real fort, unpaused, with GPU rendering:

1. **Baseline:** `calculated_fps` and the frame-gap watcher, publisher off, idle, then while hammering `stocks` / `military`.
2. **Walker sweep:** slice ∈ {4, 8, 16} × cadence ∈ {60, 300, 600} frames. Record FPS delta, max frame gap and `update_lua_ms`.
3. **Snapshot reads under load:** 20× `get` while unpaused. The expected frame-gap delta is about zero.
4. **Staleness:** units moving and jobs changing. Diff `find_unit` from the snapshot against Lua at a range of `age_ms`.
5. **Unload/load:** abandon or retire mid-walk, then reload. The walker should go to `NO_FORT` and recover.

## Running it

```bash
npm run fort:up   # from hearthwarden, or this repo's docker harness
docker cp src/dfhack-queries/mcp_snapshot.lua hw-fort:/opt/df/mcp-queries/   # the image bakes queries; the spike copies the new one in
DFHACK_PORT=5001 DFHACK_MCP_QUERY_DIR=/opt/df/mcp-queries node scripts/spike-snapshot.mjs
DFHACK_MCP_SNAPSHOT=1 ...   # serve find_unit from the snapshot (dev only)
```

Tuning: `DFHACK_MCP_SNAPSHOT_SLICE` (default 8), `DFHACK_MCP_SNAPSHOT_CADENCE` (frames, default 60). Bench: `SPIKE_SLICES`, `SPIKE_CADENCE`, `SPIKE_WINDOW_MS`.

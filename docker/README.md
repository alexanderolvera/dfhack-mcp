# Disposable headless DF instances (spike #27)

Containerized, headless **Dwarf Fortress 53.15 + DFHack 53.15-r2** that auto-loads
a fixture fort and serves the DFHack Remote RPC — so the verification harness (and
parallel agents) can each hit their **own** disposable fort instead of sharing the
one live game. This is what makes T1/T2 runnable in parallel and, eventually,
live-in-CI (#28 Phase 3).

## Quick start

```sh
cd docker
./build.sh                 # stages query scripts + fixture, builds df-headless:53.15
./run-instances.sh 3       # 3 forts on 127.0.0.1:5001, :5002, :5003
# ~30-45s later:
./verify-container.sh 5001 # run the MCP tool suite (T1) against the fort on 5001
./stop-instances.sh        # tear them all down
```

Point a server (or agent) at one instance with `DFHACK_PORT=<port>` — the harness
and `dfclient.ts` both honor it.

## How it works (and the hard-won details)

- **DF is not container-native.** We use the *free Linux classic* DF build (the
  Steam build is Windows-only/non-redistributable) + the matching Linux DFHack,
  run under **Xvfb** with a real software-GL stack (Mesa DRI). The headless
  save-load advances via DF's actual SDL/GL render loop, so a *real* virtual
  display is required — not `SDL_VIDEODRIVER=dummy`, not `PRINT_MODE:TEXT`.
- **`--security-opt seccomp=unconfined`** is required: DFHack's launcher disables
  ASLR via `personality()`, which Docker's default seccomp blocks.
- **RPC bridging.** DFHack's `RunCommand` only accepts `127.0.0.1` clients, so the
  container keeps `allow_remote:false` and a **socat** bridge re-originates the
  Docker-mapped connection as local. The host publishes to `127.0.0.1` only — the
  RPC never reaches the LAN.
- **Loading the fort.** DFHack's stock `load-save` is broken on 53.15; the
  DF 50+/Premium title screen is mouse-driven, so `autoload.lua` (run in-process
  via `dfhack.init`) simulates `_MOUSE_L` clicks — the method from DFHack's own
  `ci/test.lua` — then pauses with `resetDwarfmodeView(true)`.
- **The fixture MUST be a compressed save** (`world.sav`). Uncompressed saves
  (`world.dat` + loose files, the Steam default) stall the headless load at
  `cur_step=1`. `fetch-fixture.sh` pulls DFHack's Dreamfort (compressed). To use
  your own fort, save it with `[COMPRESSED_SAVES:YES]` and drop it as
  `fixture/region1`.
- **Curated tools in-container.** The MCP server registers its query dir on the
  DFHack side, so when DFHack runs in a container it must point at the scripts
  baked *inside* it: set `DFHACK_MCP_QUERY_DIR=/opt/df/mcp-queries` (build.sh bakes
  them from `../src/dfhack-queries`). `verify-container.sh` sets this for you.
  > Windows/Git Bash mangles `/opt/...` env values into Windows paths; the scripts
  > set `MSYS_NO_PATHCONV=1` to prevent it.

## No-fort fixture (title screen, RPC up, NO fort) — for `verify.mjs --no-fort`

The regular instances auto-load a fort. The **no-fort** fixture is the mirror: an
instance that boots to the **title screen** with DFHack RPC up but **no fort ever
loaded**, so every game-dependent tool returns its `{"error":"no fort loaded"}`
guard. This is what the harness's `--no-fort` T1 mode asserts against — it
**exercises** the long-standing "guard coded but unexercised" gap
([#6](https://github.com/alexanderolvera/dfhack-mcp/issues/6)) and is the no-fort
reachability path for [#28](https://github.com/alexanderolvera/dfhack-mcp/issues/28).

The trick: `autoload.lua` only runs because the baked `dfhack.init` says so
(`dfhack-config/init/dfhack.init` contains `autoload`). Mount an **empty file**
over that init and autoload never runs — DFHack still starts and serves RPC, but
the game sits at the title screen with no fort.

```sh
cd docker
:> /tmp/empty-dfhack.init            # any empty file (this is the whole trick)
MSYS_NO_PATHCONV=1 docker run -d --name df-nofort \
  --security-opt seccomp=unconfined \
  -e TERM=xterm-256color \
  -v /tmp/empty-dfhack.init:/opt/df/dfhack-config/init/dfhack.init:ro \
  -p "127.0.0.1:5010:5001" \
  df-headless:53.15
# ~10-15s later (no fort to load, so it settles faster than the fort instances):
MSYS_NO_PATHCONV=1 DFHACK_HOST=127.0.0.1 DFHACK_PORT=5010 \
  DFHACK_MCP_QUERY_DIR=/opt/df/mcp-queries \
  node ../scripts/verify.mjs --tier=1 --no-fort   # every game tool must return its guard cleanly
docker rm -f df-nofort               # teardown = reset (same disposable primitive)
```

This is `run-instances.sh` with one change: the empty-`dfhack.init` bind-mount in
place of the autoload. Everything else (seccomp, port mapping, query dir) is
identical. To run the worktree's **live** query Lua instead of the baked snapshot,
add `-v "$(pwd)/../src/dfhack-queries:/opt/df/mcp-queries:ro"` as with the fort
instances.

## Files

| File | Purpose |
| --- | --- |
| `Dockerfile` | the image: DF + DFHack + Xvfb/Mesa/socat + autoload + baked scripts/save |
| `entrypoint.sh` | Xvfb + socat bridge + launch DF |
| `autoload.lua` | in-process mouse-click title-screen load + pause |
| `build.sh` | stage scripts/fixture, `docker build` |
| `fetch-fixture.sh` | download the Dreamfort compressed save |
| `run-instances.sh` / `stop-instances.sh` | launch/tear down N forts on ports 5001+ |
| `verify-container.sh` | run `scripts/verify.mjs` against a container (sets env correctly) |

## Per-worktree isolation

The query scripts are **baked into the image at build time** — a self-contained
snapshot, ideal for CI and for read-only parallel verification where the Lua
doesn't change. But a worktree with **divergent** `dfhack-queries` Lua would run
the baked snapshot, not its own code. Two ways to get true per-worktree isolation:

- **Mount the live scripts** (same image, current code): `./run-instances.sh 1 ../src/dfhack-queries`
  bind-mounts that dir read-only over `/opt/df/mcp-queries`, so the instance runs
  the worktree's Lua. Simplest when one worktree is under test at a time.
- **One instance per worktree, distinct port** for genuinely concurrent divergent
  worktrees. From worktree *k*'s checkout:
  ```sh
  docker run -d --name df-fort-wt-k --security-opt seccomp=unconfined \
    -e TERM=xterm-256color \
    -v "$(pwd)/src/dfhack-queries:/opt/df/mcp-queries:ro" \
    -p "127.0.0.1:$((5000+k)):5001" df-headless:53.15
  # then: DFHACK_PORT=$((5000+k)) ... npm run verify:t1 -- --require-fort
  ```
  Each agent gets its own fort **and** its own live scripts — the isolation #27
  is for. (The DF binary/save layer is shared read-only via the image; only the
  query dir differs, so this is cheap.)

## Reset primitive & the Windows-native fallback (#27 findings)

- **Reset = recreate.** An instance is disposable: `docker rm -f <name>` then
  re-`run` restores the exact baked fixture (the save lives in the image's
  read-only layers; the container's writes are a throwaway upper layer). No
  in-place "reset save" step is needed — teardown *is* the reset, and it's
  deterministic because every instance starts from the same committed image.
  `stop-instances.sh` / `run-instances.sh` are that primitive.
- **Containers beat the Windows-native "N copies on ports" fallback**, which #27
  asked us to weigh. The native fallback (N Steam DF processes, each with a
  patched `remote-server.json` port) works but: ties up the desktop with N GUI
  windows, has no filesystem isolation (shared install, save dirs, configs), no
  clean reset (manual save juggling), can't run in CI, and each instance is
  hand-managed. The container path is headless, disposable, reset-by-recreate,
  identical across machines, and CI-capable — so we chose it. The native fallback
  remains available only if a machine can't run Docker.
- **The one true requirement the spike surfaced:** the fixture must be a
  **compressed** save. That's the single constraint on which forts can seed an
  instance.

## Status

Proven end-to-end on 2026-07-16: image boots headless, auto-loads the fort,
serves RPC; the host reads live fort data and **all curated MCP tools pass
`--require-fort` T1** against it; **two instances run in parallel** on separate
ports. Remaining polish: a compressed `region5` as the canonical fixture, T2
goldens (needs the frozen fixture), and wiring container T1/T2 into CI as a
required live check (#28 Phase 3).

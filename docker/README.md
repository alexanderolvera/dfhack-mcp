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

## Status

Proven end-to-end on 2026-07-16: image boots headless, auto-loads the fort,
serves RPC; the host reads live fort data and **all curated MCP tools pass T1**
against it; **two instances run in parallel** on separate ports. Remaining polish:
a compressed `region5` as the canonical fixture, T2 goldens (needs the frozen
fixture), and wiring this into CI as a required live check.

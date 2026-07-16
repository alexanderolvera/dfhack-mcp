# Verification harness

`scripts/verify.mjs` proves, repeatably, that an agent can reach and correctly
call every MCP tool. It's a **scripted** deterministic client (not an LLM agent),
so it's free, fast, and CI-friendly. It spawns the server over real MCP stdio —
the same path a real client uses.

```sh
npm run verify:t0        # contract       (no game)
npm run verify:t1        # reachability   (live fort)
npm run verify:t2        # golden+invariants (fixture save)
npm run verify:update    # rewrite goldens from the loaded fixture
```

Exit code is non-zero on any failure, so CI and pre-push hooks can gate on it.

## Why fixtures, not mocks

Lua runs *inside* Dwarf Fortress, and mocks are banned by the working agreement.
So "test infra" means **provisioned frozen-save fixtures**, not unit tests. DF
pauses, so we test against a paused, committed save: reads of a frozen fort are
deterministic, which makes golden-**value** snapshots viable — not just shape.
The committed save *is* the golden fixture ([#27](https://github.com/alexanderolvera/dfhack-mcp/issues/27)
provisions it).

## The tiers

### T0 — contract (no fort → CI-able today)

- Server starts and completes the MCP handshake.
- `tools/list` **equals** the expected set in [`test/expected-tools.json`](../test/expected-tools.json).
- Every tool has a description and a well-formed input schema.

Catches registration / schema / "server won't start" regressions that CI was
previously blind to. Runs with `DFHACK_MCP_DEV` unset, so the dev-only `run_lua`
tool is excluded — the expected set is exactly the 13 shipping tools. Adding or
renaming a tool **requires** editing `test/expected-tools.json`; that diff is the
deliberate, reviewable record that the surface changed.

### T1 — reachability (live fort)

Every tool is callable and returns well-formed JSON *or* the documented
`{"error":"no fort loaded"}`. This is the literal "an agent can reach and call
every command" check, and it exercises the no-fort guard
([#6](https://github.com/alexanderolvera/dfhack-mcp/issues/6)) in one pass. Needs
Dwarf Fortress running with DFHack and a fort loaded.

> **Run T1/T2 one worktree at a time.** The server registers its `dfhack-queries/`
> on a *global, DF-wide* script path (`dfhack.internal.addScriptPath`) and resolves
> `mcp_<name>` by name. Two servers against one DF stomp each other's resolution
> for same-named-but-divergent scripts (last registrant wins). New scripts are
> picked up without a DF restart; a changed script reloads on the next call.
> Concurrent live testing needs separate DF instances — [#27](https://github.com/alexanderolvera/dfhack-mcp/issues/27).

### T2 — golden + invariants (fixture save)

A full-payload golden snapshot per tool against the fixture save, plus a thin
layer of cross-tool **invariants** a golden faithfully records as "correct"
(happiness sums to population, days-of-supply ≥ 0, …). `wiki_search` / `wiki_lookup`
are network-dependent and excluded from goldens.

Goldens live in [`test/golden/`](../test/golden/) and are **empty until the
fixture lands** — a golden authored against a random fort flaps on the next tick.
Author them against the documented fixture, loaded, with `npm run verify:update`.

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
- **Actuators** (write tools, Tier 2 / M3) verify as **fixture → apply → assert
  readback → restore-fixture**. Still deterministic; the committed save is the
  anchor the apply is measured against and restored to.

## Roadmap (issue #28)

- **Phase 1 (done):** T0 in CI; T1/T2 runnable locally; canonicalization; dev-env
  standardized (`.nvmrc`, `engines`, `CONTRIBUTING.md`, `npm run bootstrap`).
- **Phase 2:** committed/shareable fixture saves + a reset primitive (#27);
  author goldens against them.
- **Phase 3:** PRs into `main` spin up headless DF + DFHack and run T1/T2 live as
  a required check. The end state.

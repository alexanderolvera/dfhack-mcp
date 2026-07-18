# Golden snapshots

Full-payload golden snapshots for the T2 tier of `scripts/verify.mjs`, one
`<tool>.json` per tool. Each is the canonicalized (sorted-key) output of the tool
called against the **fixture fort** — the paused fort baked into the versioned DF
container image (`df-headless:53.15`, see [`docker/`](../../docker/)), *not* a
random live fort.

**Why the container image is the fixture.** Its fort loads paused, so tool reads
are byte-identical across calls *and across container restarts* (verified) — the
determinism a golden needs. So these goldens are **committed and pinned to the
image tag**. `wiki_search` / `wiki_lookup` are network-dependent and are not
goldened; every other tool is.

To (re)author goldens after a deliberate output change:

```
# boot the fixture container (docker/README.md), then, pointed at it:
npm run verify:update      # rewrites every golden from the loaded fixture
```

An intentional change — a new field, a schema tweak, a threshold retune, or a
DF/DFHack/image bump that churns values — then shows up as a reviewable `git diff`
here. That diff **is** the signal; commit it alongside the code change that caused
it. Never `--update` against your own live Steam fort — it isn't frozen, so the
goldens would flap on the next tick.

Properties that should hold on *any* fort (not just this fixture) belong in
[`../invariants.mjs`](../invariants.mjs), not here — those survive a fixture bump.

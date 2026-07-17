# Golden snapshots

Full-payload golden snapshots for the T2 tier of `scripts/verify.mjs`, one
`<tool>.json` per tool. Each is the canonicalized (sorted-key) output of the tool
called against the **documented fixture save** — not against a random live fort.

**These are intentionally empty until the fixture save lands (spike #27).** A
golden authored against an arbitrary fort would flap on the next tick; the whole
point is a frozen, committed fixture whose reads are deterministic.

To (re)author goldens once the fixture is loaded:

```
npm run verify:update      # writes/overwrites every golden from the loaded fixture
```

An intentional output change (a new field, a schema tweak, a version bump that
churns values) shows up as a reviewable diff here — that's the signal, not rot.
Never `--update` against a non-fixture fort.

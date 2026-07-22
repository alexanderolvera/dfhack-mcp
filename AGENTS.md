# AGENTS.md

Guidance for AI coding agents working in this repo, beyond what's in
[CONTRIBUTING.md](CONTRIBUTING.md). CONTRIBUTING.md covers the tiered verify
harness and the tool-adding checklist; this file covers code/comment hygiene —
things to actively look for on every pass through this codebase, not just when
asked.

## Does this snippet earn its keep?

Before adding — or when passing over — a derived/curated field, function, or
script, ask whether it's actually adding information, or just re-packaging
something already available elsewhere in the same payload/module with a bit of
prose wrapped around it. A second, hand-maintained summary of a fact is a
second place for that fact to drift out of sync with the source (see the
"Facts, not advice" doctrine in CONTRIBUTING.md — the same reasoning applies
to internal duplication, not just advice-vs-fact).

**Precedent:** `identify`'s `tactics[]` field (`src/tools/identify/tactics.ts`,
removed) derived a curated `{trait, note}` list — `trapavoid`, `flier`, `fire`,
`building_destroyer`, `webber`, `ranged` — from the creature dossier's own
`flags[]`/`interactions[]`, which the same response already returns. It
duplicated data the caller could already see, cost a second source of truth
(its `ranged` derivation had its own bug — issue #66 — before the field was
cut entirely), and its removal deleted real code with no loss of information.
That's the shape to look for: a field/helper that mostly restates data sitting
one hop away in the same response.

Also watch for orphaned scripts: `scripts/verify-identify.mjs` (removed) had a
stale import path from before `identify` became a directory, and wasn't
referenced by any npm script or doc — it had already silently stopped working.
If a script/module isn't reachable from `package.json`, a doc, or another
module, don't assume it's still doing anything.

## Comment hygiene

**The target is zero comment blocks.** Code should be legible enough — through
naming, structure, and small functions — that it doesn't need prose alongside
it to be understood. A comment is a sign the code didn't quite say what it
means; prefer fixing that over documenting around it.

Behavior, rationale, and implementation notes — confirmed-live DFHack field
paths, version quirks, algorithm reasoning, anything a maintainer would
otherwise need explained — belong in the **docs** (`docs/tools/<name>.md` for
a tool's Lua query, README/CONTRIBUTING for cross-cutting concerns), not in
code comments. This repo's `src/dfhack-queries/*.lua` files currently carry
large top-of-file blocks documenting field paths verified live against a
specific DFHack build (e.g. `mcp_gameData.lua`'s "Confirmed version-fragile
field paths"); that knowledge is real and hard-won, but it's a reference fact
about the tool's behavior, not something that needs to live next to the code
that implements it — it belongs in that tool's doc page. When you touch a
file like this, relocate the substance to its doc (adding an "Implementation
notes" section if there isn't one) rather than leaving it in place or
silently deleting it.

A short inline comment is occasionally still the pragmatic choice for a single
line that would otherwise need its own doc cross-reference for one clause —
keep those rare and short (one line, not a block).

## JSDoc: only at service boundaries, and simple

JSDoc is for functions/classes that are **consumed as a service** — exported
and called by other modules/callers who need to know the contract (what it
takes, what it returns, what it throws) without reading the body. Internal
helpers, private functions, and anything only used within its own module
don't get JSDoc, however non-trivial — their contract is visible to the one
caller that matters by just reading the function.

Where it applies, keep it simple: a short one-line summary, plus
`@param`/`@returns`/`@throws`. Not a paragraph of prose with no tags:

```ts
// Avoid — prose, no tags, and this is a public entry point other modules call:
/**
 * Run a Lua snippet and return its printed output, reconnecting once if the
 * socket dropped. Throws NotConnectedError if DFHack can't be reached at all.
 */
export async function runLua(snippet: string): Promise<string> { ... }

// Prefer:
/**
 * Runs a Lua snippet, reconnecting once if the socket dropped.
 * @param snippet Lua source to execute.
 * @returns The snippet's printed output.
 * @throws {NotConnectedError} If DFHack can't be reached after the retry.
 */
export async function runLua(snippet: string): Promise<string> { ... }
```

## Checklist for a review pass

- Does this field/snippet just re-package data already present elsewhere in
  the same response or module?
- Is this a comment block at all? If so, can the substance move to
  `docs/tools/<name>.md` (or be deleted, if it's just restating the code)
  instead of living inline?
- Is this JSDoc on a function actually consumed by other modules/callers
  (keep, simplify if untagged) or on an internal helper (remove)?
- Is this file/script actually reachable — imported, registered in
  `src/tools/registry.ts`, wired to an npm script, or linked from a doc — or
  has it quietly gone dead?

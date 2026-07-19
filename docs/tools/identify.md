---
tool: identify
tier: reference
gated: none
source: src/tools/identify/index.ts
tags: [dfhack-mcp/tool]
---

# identify

> One-call "what is this creature and how do I handle it": fuses THIS WORLD's raws (ground truth) with the DF wiki (strategy).

## Purpose
Resolves a creature query (raw token, name fragment, or live unit_id) to a full dossier from this world's raws, derives the decisive tactical traits with their hard game-fact implications, and attaches 1-2 trimmed wiki strategy excerpts. It composes `game_data` (resolution + dossier) and `wiki_lookup` (article text) rather than re-implementing either. An AI co-pilot calls it when a creature shows up (via `threats`, `find_unit`, sighting reports) so world-specific facts — e.g. a TRAPAVOID demon that cage traps cannot hold — are never missed by leaning on a generic wiki page alone.

## Parameters
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| query | string (min 1) | Yes | — | Creature token (e.g. "DEMON_4"), name fragment ("flame phantom"), or a live unit_id (all digits). Same contract as `game_data`. |

## Returns
On a single strong match:
- `query` (string) — the input, echoed.
- `creature` — the `game_data` creature dossier: `token`, `name`, `plural`, `description`, `blurb`, `size`, `size_label`, `caste_count`, `flags[]`, `attacks[]`, `interactions[]`, `kind: "creature"`.
- `tactics[]` — `{ trait, note }` pairs for present decisive traits only: `trapavoid`, `flier`, `fire` (FIREIMMUNE flag or a fire-named interaction), `building_destroyer`, `webber`, `ranged` (any interactions). Notes are hard game facts, not strategy opinions.
- `wiki[]` — `{ topic, title, url, excerpt }`; at most ~2 pages (the creature's own page unless procedural, plus the single most relevant trait page — fire beats building destroyer), each excerpt trimmed to ~700 chars on a word boundary.
- `notes[]` (optional) — best-effort diagnostics: procedural-creature notice, failed/missing wiki lookups.

On multiple matches, a disambiguation passthrough: `{ query, match_count, truncated?, matches[] }` (matches are `game_data` stubs — let the caller narrow).

```json
{
  "query": "cat",
  "creature": {
    "kind": "creature",
    "token": "CAT",
    "name": "cat",
    "plural": "cats",
    "blurb": "A small mammalian carnivore.",
    "size": 500,
    "size_label": "tiny",
    "caste_count": 2,
    "flags": ["COMMON_DOMESTIC", "PET"],
    "attacks": [{ "name": "BITE", "verb": "bites" }],
    "interactions": [{ "name": "Clean" }, { "name": "Head bump" }]
  },
  "tactics": [
    { "trait": "ranged", "note": "Ranged attacks: Clean, Head bump." }
  ],
  "wiki": [
    {
      "topic": "creature: cat",
      "title": "DF2014:Cat",
      "url": "https://dwarffortresswiki.org/index.php/DF2014%3ACat",
      "excerpt": "Cat ... Cats are domestic animals, and one of the most common creatures ..."
    }
  ]
}
```

## Caveats & limits
- Returns `{"error":"no game loaded"}` if no game is active (passthrough from `game_data`); also passes through `game_data`'s no-match error.
- Procedural creatures (demons, forgotten beasts, titans — detected via DEMON flag or FORGOTTEN/TITAN token/name) have no wiki page; strategy leans on their traits plus the most relevant trait page, noted in `notes`.
- Wiki fetching is best-effort: a missing page or network error becomes a `notes` entry, never a throw. Duplicate wiki titles are deduped.
- Wiki excerpts are capped at ~700 characters; whole articles are never dumped.
- The `ranged` tactic fires on ANY interaction (the cat golden shows "Clean" and "Head bump" flagged as "Ranged attacks"), so benign social interactions can read as ranged attacks — treat the tactic as "has interactions", not necessarily weapons-grade.
- Needs network access for the wiki step (dwarffortresswiki.org); the raws step is local.

## Related
[game_data](game_data.md) · [wiki_lookup](wiki_lookup.md) · [wiki_search](wiki_search.md) · [threats](threats.md) · [find_unit](find_unit.md)

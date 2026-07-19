---
tool: wiki_search
tier: reference
gated: none
source: src/tools/wikiSearch.ts
tags: [dfhack-mcp/tool]
---

# wiki_search

> Search the Dwarf Fortress wiki (MediaWiki) for candidate article titles and cleaned snippets.

## Purpose
The discovery/disambiguation step before [wiki_lookup](wiki_lookup.md): given a free-text query, returns ranked candidate article titles with cleaned snippets from the MediaWiki search API. Search is biased into the DF2014 (Steam/Premium) namespace while keeping the main namespace (bare titles redirect into DF2014). Pure HTTP via Node's built-in fetch — works without the game running.

## Parameters
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string (min 1) | yes | — | What to search the DF wiki for |

## Returns
| Field | Meaning |
|---|---|
| `results[]` | up to 8 hits, in MediaWiki relevance order |
| `results[].title` | candidate article title (may be namespaced, e.g. `DF2014:Trap`) |
| `results[].snippet` | search snippet with markup stripped by the shared HTML cleaner |

No golden exists for this tool (it is pure HTTP, not part of the DF-fixture harness).

## Caveats & limits
- Hard limit of 8 results (`SEARCH_LIMIT`); no pagination.
- The DF2014 namespace id is discovered once via the siteinfo API and cached in-process; if that lookup fails, search silently falls back to the main namespace only (no bias, still works).
- Results are NOT disk-cached (unlike [wiki_lookup](wiki_lookup.md) articles).
- Errors come back as `{error}`: empty query, or `wiki search failed: <message>` on network/API failure.
- Requires internet access; does NOT require DFHack or a loaded fort.

## Related
[wiki_lookup](wiki_lookup.md) (fetch the chosen title), [identify](identify.md) (raws + wiki combined), [game_data](game_data.md) (the game's own raws).

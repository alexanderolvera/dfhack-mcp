---
tool: wiki_lookup
tier: reference
gated: none
source: src/tools/wikiLookup.ts
tags: [dfhack-mcp/tool]
---

# wiki_lookup

> Fetch a Dwarf Fortress wiki article as clean, readable text, pinned to the DF2014 namespace.

## Purpose
Retrieves an article from dwarffortresswiki.org as cleaned plain text, pinned to the DF2014 namespace (the wiki kept DF2014 for the Steam/Premium release). Bare titles are tried as `DF2014:<title>` first, then as given; redirects are followed (multi-hop), and a redirect's `#fragment` — or an explicit `section` argument — scopes the result to one section (e.g. "Weapon trap" resolves to the Weapon Trap section of the Trap page). Pure HTTP via Node's built-in fetch — works without the game running. This is the co-pilot's game-knowledge reference; sensors report facts, this supplies the background to interpret them.

## Parameters
| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `title` | string (min 1) | yes | — | Article title or topic (namespace optional) |
| `section` | string | no | redirect fragment, if any | Section/heading name to scope to (case/space/underscore-insensitive match) |
| `refresh` | boolean | no | false | Bypass the disk cache and refetch |

## Returns
| Field | Meaning |
|---|---|
| `title` | the resolved (final) page title |
| `url` | human-facing article URL (with `#section` fragment when scoped) |
| `text` | the cleaned article (or section) text |
| `from_cache` | whether the disk cache served this |
| `resolved_from` | present only when the input title differed from the resolved one |

No golden exists for this tool (it is pure HTTP, not part of the DF-fixture harness).

## Caveats & limits
- Cache-first to a git-ignored `cache/` dir at the repo root with a ~30-day TTL; the cache is best-effort (a failed read/write never fails a lookup). `refresh: true` bypasses it.
- A section name that doesn't match any heading falls back to the whole page (no error).
- Errors come back as `{error}`: empty title, `wiki page not found: "<title>"`, or `wiki lookup failed: <message>` on network/API failure.
- Requires internet access; does NOT require DFHack or a loaded fort.
- Requests go out with a polite dedicated User-Agent to the MediaWiki API.

## Related
[wiki_search](wiki_search.md) (discovery/disambiguation step before this), [identify](identify.md) (raws + wiki combined for one entity), [game_data](game_data.md) (the game's own raws, the other half of the Reference tier).

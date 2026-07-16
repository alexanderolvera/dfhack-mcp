// Dwarf Fortress wiki (MediaWiki) client — PURE HTTP, no DFHack, no game needed.
// Public face of the wiki concern, split across:
//   api.ts     fetch + search + redirect/namespace/section resolution
//   clean.ts   rendered HTML -> readable text (dependency-free)
//   cache.ts   git-ignored disk cache (cache-first, ~30-day TTL)
//   lookup.ts  the wiki_lookup orchestration tying the three together
//
// Node 24 built-in fetch only — NO new npm dependencies.

import { CACHE_DIR, cacheKey } from './cache.ts';
import { cleanHtml } from './clean.ts';
import { resolveTitle } from './api.ts';

export { wikiSearch, type WikiSearch, type WikiSearchResult } from './api.ts';
export { wikiLookup, type WikiLookup } from './lookup.ts';
export { cleanHtml } from './clean.ts';

// Expose for tests/inspection.
export const _internal = { CACHE_DIR, cleanHtml, resolveTitle, cacheKey };

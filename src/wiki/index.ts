import { CACHE_DIR, cacheKey } from './cache.ts';
import { cleanHtml } from './clean.ts';
import { resolveTitle } from './api.ts';

export { wikiSearch, type WikiSearch, type WikiSearchResult } from './api.ts';
export { wikiLookup, type WikiLookup } from './lookup.ts';
export { cleanHtml } from './clean.ts';

// Expose for tests/inspection.
export const _internal = { CACHE_DIR, cleanHtml, resolveTitle, cacheKey };

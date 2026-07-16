// wiki_lookup(title, section?, refresh?): clean, DF2014-pinned article text.
// Follows redirects, honors section fragments, cache-first to disk. Pure HTTP.

import { wikiLookup, type WikiLookup } from '../wiki/index.ts';

export function wikiLookupTool(
  title: string,
  section?: string,
  refresh?: boolean
): Promise<WikiLookup | { error: string }> {
  return wikiLookup(title, section, refresh);
}

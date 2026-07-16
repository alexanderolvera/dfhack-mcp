// wiki_search(query): ranked candidate DF wiki titles + cleaned snippets.
// Discovery/disambiguation step — pure HTTP to the MediaWiki API, no game needed.

import { wikiSearch, type WikiSearch } from '../wiki/client.ts';

export function wikiSearchTool(query: string): Promise<WikiSearch | { error: string }> {
  return wikiSearch(query);
}

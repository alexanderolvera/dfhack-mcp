import { wikiSearch, type WikiSearch } from '../wiki/index.ts';
import { z } from 'zod';
import type { ToolDef } from '../register.ts';

export function wikiSearchTool(query: string): Promise<WikiSearch | { error: string }> {
  return wikiSearch(query);
}

export const wikiSearchDef: ToolDef = {
  name: 'wiki_search',
  title: 'Wiki search',
  description:
    'Search the Dwarf Fortress wiki (MediaWiki) for candidate article titles and ' +
    'cleaned snippets. Discovery/disambiguation step before wiki_lookup; biased ' +
    'to the DF2014 (Steam/Premium) namespace. Pure HTTP — works without the game ' +
    'running. Returns {results:[{title, snippet}]} (up to 8).',
  shape: { query: z.string().min(1).describe('What to search the DF wiki for') },
  run: ({ query }) => wikiSearchTool(query),
};

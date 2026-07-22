import { wikiLookup, type WikiLookup } from '../wiki/index.ts';
import { z } from 'zod';
import type { ToolDef } from '../register.ts';

export function wikiLookupTool(
  title: string,
  section?: string,
  refresh?: boolean
): Promise<WikiLookup | { error: string }> {
  return wikiLookup(title, section, refresh);
}

export const wikiLookupDef: ToolDef = {
  name: 'wiki_lookup',
  title: 'Wiki lookup',
  description:
    'Fetch a Dwarf Fortress wiki article as clean, readable text, pinned to the ' +
    'DF2014 namespace. Follows redirects (multi-hop) and honors section ' +
    'fragments (e.g. "Weapon trap" resolves to the Weapon Trap section of the ' +
    'Trap page). Cache-first to disk (~30-day TTL); pass refresh:true to bypass. ' +
    'Pure HTTP — works without the game running. Returns {title, url, text, ' +
    'from_cache, resolved_from?} or {error} if the page is not found.',
  shape: {
    title: z.string().min(1).describe('Article title or topic (namespace optional)'),
    section: z.string().optional().describe('Section/heading name to scope to'),
    refresh: z.boolean().optional().describe('Bypass the disk cache and refetch'),
  },
  run: ({ title, section, refresh }) => wikiLookupTool(title, section, refresh),
};

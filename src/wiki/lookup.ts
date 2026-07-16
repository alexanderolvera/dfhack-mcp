// wiki_lookup orchestration: resolve a title (redirects + DF2014 pinning +
// section fragment) -> cache-first read -> fetch + clean + persist. Composes the
// api/clean/cache concerns; the behavior is cache-first with a ~30-day TTL.

import { resolveTitle, fetchParsed, articleUrl } from './api.ts';
import { cleanHtml } from './clean.ts';
import { cacheKey, readCache, writeCache, type CacheEntry } from './cache.ts';

export interface WikiLookup {
  title: string;
  url: string;
  text: string;
  from_cache: boolean;
  resolved_from?: string;
}

export async function wikiLookup(
  title: string,
  section?: string,
  refresh?: boolean
): Promise<WikiLookup | { error: string }> {
  const t = (title ?? '').trim();
  if (!t) return { error: 'empty title' };
  const sec = section?.trim() || undefined;

  try {
    // 1. Resolve redirects / pin to DF2014 to get the canonical cache key.
    const resolved = await resolveTitle(t);
    if (!resolved) return { error: `wiki page not found: "${t}"` };
    const effectiveSection = sec ?? resolved.fragment;
    const resolvedFrom = resolved.title !== t ? t : undefined;
    const file = cacheKey(resolved.title, effectiveSection);

    // 2. Cache-first (unless refresh).
    if (!refresh) {
      const hit = await readCache(file);
      if (hit) {
        return {
          title: hit.title,
          url: hit.url,
          text: hit.text,
          from_cache: true,
          resolved_from: hit.resolved_from,
        };
      }
    }

    // 3. Fetch + clean.
    const { html, realTitle } = await fetchParsed(resolved.title, effectiveSection);
    const text = cleanHtml(html);
    const url = articleUrl(realTitle, effectiveSection);

    // 4. Persist and return.
    const entry: CacheEntry = {
      title: realTitle,
      url,
      text,
      fetched_at: new Date().toISOString(),
      resolved_from: resolvedFrom,
    };
    await writeCache(file, entry);

    return { title: realTitle, url, text, from_cache: false, resolved_from: resolvedFrom };
  } catch (err) {
    return { error: `wiki lookup failed: ${(err as Error).message}` };
  }
}

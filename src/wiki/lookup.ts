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

/**
 * Resolves a wiki title (redirects, DF2014 pinning, section fragment), then
 * returns it from cache or fetches, cleans, and persists it.
 * @param title Page title to look up.
 * @param section Optional section name to scope the result to.
 * @param refresh Bypass the cache and force a refetch.
 * @returns The cleaned article text, or `{error}` if the title can't be resolved.
 */
export async function wikiLookup(
  title: string,
  section?: string,
  refresh?: boolean
): Promise<WikiLookup | { error: string }> {
  const t = (title ?? '').trim();
  if (!t) return { error: 'empty title' };
  const sec = section?.trim() || undefined;

  try {
    const resolved = await resolveTitle(t);
    if (!resolved) return { error: `wiki page not found: "${t}"` };
    const effectiveSection = sec ?? resolved.fragment;
    const resolvedFrom = resolved.title !== t ? t : undefined;
    const file = cacheKey(resolved.title, effectiveSection);

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

    const { html, realTitle } = await fetchParsed(resolved.title, effectiveSection);
    const text = cleanHtml(html);
    const url = articleUrl(realTitle, effectiveSection);

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

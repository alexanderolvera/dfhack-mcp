import { cleanHtml } from './clean.ts';
import pkg from '../../package.json';

const API = 'https://dwarffortresswiki.org/api.php';
const USER_AGENT = `${pkg.name}/${pkg.version} (personal DF co-pilot)`;
// The wiki kept DF2014 for the Steam/Premium release — a known constant, no v50.
export const VERSION_NS = 'DF2014';
const SEARCH_LIMIT = 8;

export interface WikiSearchResult {
  title: string;
  snippet: string;
}
export interface WikiSearch {
  results: WikiSearchResult[];
}

export interface Resolved {
  title: string; // final page title (missing === false guaranteed)
  fragment?: string; // section fragment picked up from the redirect chain
}

async function apiGet(params: Record<string, string>): Promise<any> {
  const url = `${API}?${new URLSearchParams({ ...params, format: 'json' })}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`wiki API HTTP ${res.status}`);
  return res.json();
}

let df2014NsId: string | null = null;
async function versionNamespaceId(): Promise<string | null> {
  if (df2014NsId !== null) return df2014NsId;
  try {
    const data = await apiGet({ action: 'query', meta: 'siteinfo', siprop: 'namespaces' });
    const namespaces = data?.query?.namespaces ?? {};
    for (const ns of Object.values<any>(namespaces)) {
      if (ns['*'] === VERSION_NS || ns.canonical === VERSION_NS) {
        df2014NsId = String(ns.id);
        return df2014NsId;
      }
    }
  } catch {
    /* fall through — search still works without a namespace bias */
  }
  return null;
}

export async function wikiSearch(query: string): Promise<WikiSearch | { error: string }> {
  const q = query.trim();
  if (!q) return { error: 'empty query' };
  try {
    const nsId = await versionNamespaceId();
    const params: Record<string, string> = {
      action: 'query',
      list: 'search',
      srsearch: q,
      srlimit: String(SEARCH_LIMIT),
    };
    // Bias into DF2014 but keep main namespace (0) — bare titles redirect into DF2014.
    params.srnamespace = nsId ? `0|${nsId}` : '0';
    const data = await apiGet(params);
    const hits: any[] = data?.query?.search ?? [];
    return {
      results: hits.slice(0, SEARCH_LIMIT).map((h) => ({
        title: h.title,
        snippet: cleanHtml(h.snippet ?? ''),
      })),
    };
  } catch (err) {
    return { error: `wiki search failed: ${(err as Error).message}` };
  }
}

function hasNamespace(title: string): boolean {
  return /^[A-Za-z0-9 .]+:/.test(title);
}

async function resolveOnce(
  title: string
): Promise<{ title: string; missing: boolean; fragment?: string }> {
  const data = await apiGet({ action: 'query', titles: title, redirects: '1' });
  const q = data?.query ?? {};
  // The redirect chain (may be multi-hop) — grab the last fragment if any.
  let fragment: string | undefined;
  for (const r of (q.redirects ?? []) as any[]) {
    if (r.tofragment) fragment = r.tofragment;
  }
  const pages = Object.values<any>(q.pages ?? {});
  const page = pages[0];
  return { title: page?.title ?? title, missing: page?.missing !== undefined, fragment };
}

/**
 * Resolves a user title to a real DF2014 page, trying the DF2014-namespaced
 * title first (bare titles do not auto-redirect into DF2014) then the title as given.
 * @param title The title to resolve.
 * @returns The resolved title and any redirect section fragment, or null if nothing exists.
 */
export async function resolveTitle(title: string): Promise<Resolved | null> {
  const candidates = hasNamespace(title) ? [title] : [`${VERSION_NS}:${title}`, title];
  for (const cand of candidates) {
    try {
      const r = await resolveOnce(cand);
      if (!r.missing) return { title: r.title, fragment: r.fragment };
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

function normHeading(s: string): string {
  return s
    .replace(/[_\s]+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Fetches parsed HTML for a page, optionally scoped to one section.
 * @param title Page title to fetch.
 * @param sectionName Heading name to scope to (from an explicit `section` arg or a redirect `#fragment`).
 * @returns The section's (or whole page's) rendered HTML, and the page's real title.
 */
export async function fetchParsed(
  title: string,
  sectionName?: string
): Promise<{ html: string; realTitle: string }> {
  let sectionIndex: string | undefined;
  if (sectionName) {
    // Look up the section list to map a heading name → numeric section index.
    try {
      const secData = await apiGet({ action: 'parse', page: title, prop: 'sections' });
      const sections: any[] = secData?.parse?.sections ?? [];
      const want = normHeading(sectionName);
      const match = sections.find(
        (s) => normHeading(s.line) === want || normHeading(s.anchor) === want
      );
      if (match) sectionIndex = String(match.index);
    } catch {
      /* fall back to whole page */
    }
  }
  const params: Record<string, string> = { action: 'parse', page: title, prop: 'text' };
  if (sectionIndex) params.section = sectionIndex;
  const data = await apiGet(params);
  if (data?.error) throw new Error(data.error.info ?? 'parse failed');
  const html: string = data?.parse?.text?.['*'] ?? '';
  return { html, realTitle: data?.parse?.title ?? title };
}

/**
 * Builds the human-facing article URL for a resolved title.
 * @param title Resolved page title.
 * @param fragment Optional section fragment.
 * @returns The article URL.
 */
export function articleUrl(title: string, fragment?: string): string {
  let url = `https://dwarffortresswiki.org/index.php/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  if (fragment) url += `#${encodeURIComponent(fragment.replace(/ /g, '_'))}`;
  return url;
}

// Dwarf Fortress wiki (MediaWiki) client — PURE HTTP, no DFHack, no game needed.
// Pins to the DF2014 namespace, resolves redirects (+ section fragments), fetches
// rendered HTML via action=parse, cleans it to readable text with a dependency-free
// pass, and caches cleaned lookups to a git-ignored cache/ dir (cache-first, ~30d TTL).
//
// Node 24 built-in fetch only — NO new npm dependencies.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://dwarffortresswiki.org/api.php';
const USER_AGENT = 'dfhack-mcp/0.1 (personal DF co-pilot)';
// The wiki kept DF2014 for the Steam/Premium release — a known constant, no v50.
const VERSION_NS = 'DF2014';
const SEARCH_LIMIT = 8;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // ~30 days; the wiki changes slowly.

// cache/ lives at the repo root (this file is src/wiki/client.ts → ../../cache).
const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cache');

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export interface WikiSearchResult {
  title: string;
  snippet: string;
}
export interface WikiSearch {
  results: WikiSearchResult[];
}

export interface WikiLookup {
  title: string;
  url: string;
  text: string;
  from_cache: boolean;
  resolved_from?: string;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** GET the MediaWiki API as JSON with a polite User-Agent. */
async function apiGet(params: Record<string, string>): Promise<any> {
  const url = `${API}?${new URLSearchParams({ ...params, format: 'json' })}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`wiki API HTTP ${res.status}`);
  return res.json();
}

let df2014NsId: string | null = null;
/** DF2014's numeric namespace id (cached in-process); biases search into DF2014. */
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

// ---------------------------------------------------------------------------
// wiki_search
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Redirect / namespace resolution
// ---------------------------------------------------------------------------

interface Resolved {
  title: string; // final page title (missing === false guaranteed)
  fragment?: string; // section fragment picked up from the redirect chain
}

/** Does the title already carry a wiki namespace prefix (e.g. "DF2014:Trap")? */
function hasNamespace(title: string): boolean {
  return /^[A-Za-z0-9 .]+:/.test(title);
}

async function resolveOnce(title: string): Promise<{ title: string; missing: boolean; fragment?: string }> {
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
 * Resolve a user title to a real DF2014 page. Tries the DF2014-namespaced title
 * first (bare titles like "Trap" do NOT auto-redirect into DF2014), then falls
 * back to the title as given. Returns null if nothing exists.
 */
async function resolveTitle(title: string): Promise<Resolved | null> {
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

// ---------------------------------------------------------------------------
// Section mapping
// ---------------------------------------------------------------------------

/** Normalize a heading/fragment for loose matching (case/space/underscore-insensitive). */
function normHeading(s: string): string {
  return s.replace(/[_\s]+/g, ' ').trim().toLowerCase();
}

/**
 * Fetch parsed HTML for a page, optionally scoped to a section identified by a
 * heading name (from an explicit `section` arg or a redirect `#fragment`).
 */
async function fetchParsed(
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

/** Human-facing article URL for a resolved title (+ optional section fragment). */
function articleUrl(title: string, fragment?: string): string {
  let url = `https://dwarffortresswiki.org/index.php/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  if (fragment) url += `#${encodeURIComponent(fragment.replace(/ /g, '_'))}`;
  return url;
}

// ---------------------------------------------------------------------------
// HTML → readable text (dependency-free)
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', middot: '·',
  times: '×', deg: '°', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body] ?? m;
  });
}

// Elements whose entire subtree is wiki chrome, not article content.
const SKIP_CLASS = /\b(mw-editsection|reference|navbox|toc|noprint|catlinks|printfooter|mw-jump-link|metadata|page-quality|mw-references|thumbcaption|magnify|NavFrame|version-table|version-links|version-link)\b/;
const SKIP_ID = /^(page-quality-rating|toc|catlinks|References)$/;
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'wbr', 'source']);

/**
 * Clean rendered MediaWiki HTML into readable plain text. Streams tags rather
 * than nesting regexes so cruft subtrees (edit links, navboxes, refs, TOC) are
 * dropped cleanly even when nested. Keeps headings, lists and tables as simple
 * text; decodes entities; collapses whitespace.
 */
export function cleanHtml(html: string): string {
  if (!html) return '';
  // Drop comments / scripts / styles wholesale first.
  let s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  const out: string[] = [];
  // Stack of open elements; skip=true if this element or an ancestor is chrome.
  const stack: { tag: string; skip: boolean }[] = [];
  const skipping = () => stack.length > 0 && stack[stack.length - 1].skip;

  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(s)) !== null) {
    const text = s.slice(last, m.index);
    if (text && !skipping()) out.push(decodeEntities(text));
    last = tagRe.lastIndex;

    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    const selfClose = m[4] === '/' || VOID.has(tag);

    if (closing) {
      // Pop back to the matching open tag (tolerate minor imbalance).
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      if (!skipping()) emitClose(tag, out);
      continue;
    }

    if (selfClose) {
      if (!skipping() && tag === 'br') out.push('\n');
      continue;
    }

    const classMatch = /class\s*=\s*["']([^"']*)["']/i.exec(attrs);
    const idMatch = /id\s*=\s*["']([^"']*)["']/i.exec(attrs);
    const isChrome =
      (classMatch && SKIP_CLASS.test(classMatch[1])) ||
      (idMatch && SKIP_ID.test(idMatch[1]));
    const skip = skipping() || !!isChrome;
    stack.push({ tag, skip });
    if (!skip) emitOpen(tag, out);
  }
  const tail = s.slice(last);
  if (tail && !skipping()) out.push(decodeEntities(tail));

  return normalizeText(out.join(''));
}

function emitOpen(tag: string, out: string[]): void {
  if (/^h[1-6]$/.test(tag)) out.push('\n\n## ');
  else if (tag === 'li') out.push('\n- ');
  else if (tag === 'tr') out.push('\n');
  else if (tag === 'dt' || tag === 'dd') out.push('\n');
  else if (tag === 'p' || tag === 'div' || tag === 'blockquote') out.push('\n');
}

function emitClose(tag: string, out: string[]): void {
  if (/^h[1-6]$/.test(tag)) out.push('\n');
  else if (tag === 'td' || tag === 'th') out.push(' | ');
  else if (tag === 'p' || tag === 'blockquote') out.push('\n');
  else if (tag === 'ul' || tag === 'ol') out.push('\n');
}

function normalizeText(s: string): string {
  return s
    .replace(/\[edit\]/gi, '')
    .replace(/This article is about an older version of DF\.?/gi, '') // version notice
    .replace(/[ \t\f\v]+/g, ' ')       // collapse horizontal whitespace
    .replace(/(?: *\| *){2,}/g, ' | ') // collapse runs of empty table cells
    .replace(/ *\| *\n/g, '\n')        // trailing table separators at line end
    .replace(/\n *\| */g, '\n')        // leading table separators at line start
    .replace(/\n +/g, '\n')            // leading spaces on lines
    .replace(/ +\n/g, '\n')            // trailing spaces on lines
    .replace(/\n{3,}/g, '\n\n')        // collapse blank runs
    .replace(/^(?:\s*##\s*)$/gm, '')   // empty headings
    .trim();
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  title: string;
  url: string;
  text: string;
  fetched_at: string;
  resolved_from?: string;
}

/** Deterministic, filesystem-safe cache filename keyed by resolved title (+section). */
function cacheKey(title: string, section?: string): string {
  const raw = section ? `${title}##${section}` : title;
  const safe = raw.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 180);
  return `${safe || 'page'}.json`;
}

async function readCache(file: string): Promise<CacheEntry | null> {
  try {
    const entry = JSON.parse(await readFile(join(CACHE_DIR, file), 'utf8')) as CacheEntry;
    const age = Date.now() - new Date(entry.fetched_at).getTime();
    if (!Number.isFinite(age) || age > CACHE_TTL_MS) return null; // stale
    return entry;
  } catch {
    return null;
  }
}

async function writeCache(file: string, entry: CacheEntry): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(join(CACHE_DIR, file), JSON.stringify(entry, null, 2), 'utf8');
  } catch {
    /* cache is best-effort — never fail a lookup because the disk write failed */
  }
}

// ---------------------------------------------------------------------------
// wiki_lookup
// ---------------------------------------------------------------------------

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

// Expose for tests/inspection.
export const _internal = { CACHE_DIR, cleanHtml, resolveTitle, cacheKey };

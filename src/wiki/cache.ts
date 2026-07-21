// Disk cache for cleaned wiki lookups: an OS per-user cache dir, cache-first
// with a ~30-day TTL (the wiki changes slowly). Best-effort — a failed
// read/write never fails a lookup, it just misses the cache.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // ~30 days.

export const CACHE_DIR =
  process.env.DFHACK_MCP_CACHE_DIR ??
  join(
    process.env.XDG_CACHE_HOME ||
      (process.platform === 'win32'
        ? (process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'))
        : join(homedir(), '.cache')),
    'dfhack-mcp'
  );

export interface CacheEntry {
  title: string;
  url: string;
  text: string;
  fetched_at: string;
  resolved_from?: string;
}

/** Deterministic, filesystem-safe cache filename keyed by resolved title (+section). */
export function cacheKey(title: string, section?: string): string {
  const raw = section ? `${title}##${section}` : title;
  const safe = raw
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
  return `${safe || 'page'}.json`;
}

export async function readCache(file: string): Promise<CacheEntry | null> {
  try {
    const entry = JSON.parse(await readFile(join(CACHE_DIR, file), 'utf8')) as CacheEntry;
    const age = Date.now() - new Date(entry.fetched_at).getTime();
    if (!Number.isFinite(age) || age > CACHE_TTL_MS) return null; // stale
    return entry;
  } catch {
    return null;
  }
}

export async function writeCache(file: string, entry: CacheEntry): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(join(CACHE_DIR, file), JSON.stringify(entry, null, 2), 'utf8');
  } catch {
    /* cache is best-effort — never fail a lookup because the disk write failed */
  }
}

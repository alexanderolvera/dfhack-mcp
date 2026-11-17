import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface FixtureProvenance {
  df_version: string;
  dfhack_version: string;
  save_folder: string;
  captured_now_ms: number;
  captured_by: string;
}

interface FixtureFile {
  fixture: FixtureProvenance;
  published: Record<string, unknown>;
}

const loaded = new Map<string, FixtureFile>();

/**
 * The fixture directory the snapshot layer reads instead of DFHack, if any.
 * @param env Environment to read; defaults to `process.env`.
 * @returns The directory from `DFHACK_MCP_SNAPSHOT_FIXTURE`, or undefined when unset.
 */
export function fixtureDir(
  env: Record<string, string | undefined> = process.env
): string | undefined {
  return env.DFHACK_MCP_SNAPSHOT_FIXTURE || undefined;
}

/**
 * Reads a captured walker payload from the configured fixture directory.
 * @param walker Which walker's capture to load.
 * @param dir Directory holding `<walker>.json`.
 * @returns The published payload and the wall clock recorded at capture, so `age_ms` is stable.
 * @throws {Error} If the file is missing, unreadable, or not a capture this version understands.
 */
export function readFixture<T = Record<string, unknown>>(
  walker: string,
  dir: string
): { data: T; now: number } {
  const path = join(dir, `${walker}.json`);
  let file = loaded.get(path);
  if (!file) {
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (err) {
      throw new Error(
        `DFHACK_MCP_SNAPSHOT_FIXTURE is set to ${dir}, but ${path} could not be read ` +
          `(${(err as Error).message}). Capture one with: npm run capture:snapshot -- --out ${dir}`
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`${path} is not valid JSON (${(err as Error).message})`);
    }
    const candidate = parsed as FixtureFile;
    if (!candidate?.fixture || typeof candidate.published !== 'object' || !candidate.published) {
      throw new Error(
        `${path} is not a snapshot capture — expected an object with "fixture" provenance and a ` +
          '"published" payload. Re-capture it with npm run capture:snapshot.'
      );
    }
    if (typeof candidate.published.captured_at_ms !== 'number') {
      throw new Error(`${path} has no published.captured_at_ms, so age_ms cannot be derived`);
    }
    file = candidate;
    loaded.set(path, file);
  }
  return { data: file.published as T, now: file.fixture.captured_now_ms };
}

/**
 * The provenance of a loaded capture, for reporting which fort and build it came from.
 * @param walker Which walker's capture to describe.
 * @param dir Directory holding `<walker>.json`.
 * @returns That capture's recorded provenance.
 * @throws {Error} If the capture cannot be read.
 */
export function fixtureProvenance(walker: string, dir: string): FixtureProvenance {
  readFixture(walker, dir);
  return loaded.get(join(dir, `${walker}.json`))!.fixture;
}

/** Test-only: drops the parsed-fixture cache so a rewritten fixture is re-read. */
export function _clearFixtureCache(): void {
  loaded.clear();
}

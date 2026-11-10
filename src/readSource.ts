import { z } from 'zod';
import { snapshotEnabled, type GameTime, type MapSnapshot, type Snapshot } from './snapshot.ts';

export type ReadSource = 'snapshot' | 'live';

export type Walker = 'entities' | 'map';

export interface SnapshotProvenance {
  seq: number;
  age_ms: number;
  captured: GameTime;
}

export interface SourceReport {
  source: ReadSource;
  snapshot?: Partial<Record<Walker, SnapshotProvenance>>;
}

/** The `source` input every dual-path read shares. */
export const readSourceParam = z
  .enum(['snapshot', 'live'])
  .optional()
  .describe(
    'Where to read from. "live" queries the game directly, costing frozen game time, and ' +
      'is always honored. "snapshot" projects the in-game publisher\'s last complete ' +
      'capture, which costs no game time but is seconds old; it falls back to live when ' +
      'the snapshot layer is off or the call cannot be served from a capture. Defaults to ' +
      'DFHACK_MCP_READ_SOURCE, else snapshot wherever the layer is on.'
  );

/** The provenance note every response that reports `source` documents itself with. */
export const READ_SOURCE_NOTE =
  'Every response reports source: "snapshot" | "live", the path that actually served it. ' +
  "A snapshot read also carries snapshot.<walker>.{seq, age_ms, captured}: the publisher's " +
  'sequence number for the capture, how old it is in milliseconds, and the game time it was ' +
  'taken at. Read age_ms before trusting anything that moves — measured on a live fort, half ' +
  'the units had changed position by 2 s of snapshot age, and current job is the ' +
  'fastest-moving field in the capture.';

/**
 * The source a dual-path read uses when the caller names none.
 * @param env Environment to read; defaults to `process.env`.
 * @returns `live` wherever the snapshot layer is off, else `DFHACK_MCP_READ_SOURCE` or `snapshot`.
 */
export function defaultReadSource(
  env: Record<string, string | undefined> = process.env
): ReadSource {
  if (!snapshotEnabled(env)) return 'live';
  return env.DFHACK_MCP_READ_SOURCE === 'live' ? 'live' : 'snapshot';
}

/**
 * Whether a dual-path read should project from the snapshot rather than query live.
 * @param requested The caller's `source` input, or undefined.
 * @param env Environment to read; defaults to `process.env`.
 * @returns True only when the snapshot layer is on and the resolved source is `snapshot`.
 */
export function readsSnapshot(
  requested?: ReadSource,
  env: Record<string, string | undefined> = process.env
): boolean {
  return snapshotEnabled(env) && (requested ?? defaultReadSource(env)) === 'snapshot';
}

/**
 * Builds the provenance a live read reports.
 * @returns `{ source: 'live' }`.
 */
export function liveSource(): SourceReport {
  return { source: 'live' };
}

/**
 * Builds the provenance a snapshot read reports, one entry per walker that contributed.
 * @param parts The snapshots the payload was projected from.
 * @returns `{ source: 'snapshot', snapshot: { <walker>: { seq, age_ms, captured } } }`.
 */
export function snapshotSource(parts: { entities?: Snapshot; map?: MapSnapshot }): SourceReport {
  const snapshot: Partial<Record<Walker, SnapshotProvenance>> = {};
  for (const walker of ['entities', 'map'] as const) {
    const snap = parts[walker];
    if (snap) snapshot[walker] = { seq: snap.seq, age_ms: snap.age_ms, captured: snap.captured };
  }
  return { source: 'snapshot', snapshot };
}

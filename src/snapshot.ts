import { callLua, runScript } from './dfclient.ts';
import { withGuardCode, type ErrorPayload } from './errors.ts';

export interface GameTime {
  year: number;
  year_tick: number;
}

export interface Pos {
  x: number;
  y: number;
  z: number;
}

export interface SnapshotUnit {
  id: number;
  name: string;
  profession: string;
  race?: string;
  citizen: boolean;
  dead: boolean;
  age: number;
  stress_category?: number;
  job_type?: string;
  squad_id?: number;
  wound_count: number;
  needs_healthcare: boolean;
  unconscious: number;
  pos: Pos;
  hidden?: boolean;
  error?: string;
}

export interface SnapshotBuilding {
  id: number;
  type: string;
  subtype: number;
  zone_type?: string;
  owner?: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  z: number;
  hidden?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface Census {
  columns: string[];
  levels: number[][];
  unrevealed_z: [number, number][];
  extents: { x: number; y: number; z: number };
  stairs: [number, number, number, 'U' | 'D' | 'X'][];
  digging_z: number[];
  construction_z: number[];
  surface_hex: string;
}

interface Published {
  seq: number;
  captured_at_ms: number;
  started: GameTime;
  captured: GameTime;
  walk: Record<string, unknown>;
}

export interface Snapshot extends Published {
  age_ms: number;
  squads: { id: number; name: string }[];
  units: SnapshotUnit[];
  items: Record<string, unknown>[];
  buildings: SnapshotBuilding[];
  reports: Record<string, unknown>[];
}

export interface MapSnapshot extends Published {
  age_ms: number;
  census: Census;
}

type Walker = 'entities' | 'map';

interface WalkerStatus {
  running: boolean;
  ready: boolean;
  seq: number;
  now_ms: number;
  cadence: number;
  cadence_configured: number;
  governor?: Record<string, unknown>;
}

const ENTITY_CLASSES = 'units,items,buildings,reports';
const SLICE = process.env.DFHACK_MCP_SNAPSHOT_SLICE ?? '16';
const CADENCE = process.env.DFHACK_MCP_SNAPSHOT_CADENCE ?? '600';
const MAP_SLICE = process.env.DFHACK_MCP_SNAPSHOT_MAP_SLICE ?? '32';
const MAP_CADENCE = process.env.DFHACK_MCP_SNAPSHOT_MAP_CADENCE ?? '6000';
const GOVERNOR = process.env.DFHACK_MCP_SNAPSHOT_GOVERNOR;
const GOVERNOR_HIGH = process.env.DFHACK_MCP_SNAPSHOT_GOVERNOR_HIGH ?? '';
const GOVERNOR_LOW = process.env.DFHACK_MCP_SNAPSHOT_GOVERNOR_LOW ?? '';
const WARMUP_MS = Number(process.env.DFHACK_MCP_SNAPSHOT_WARMUP_MS ?? 90_000);
const POLL_MS = Number(process.env.DFHACK_MCP_SNAPSHOT_POLL_MS ?? 250);
const RPC_MODULE = 'rpc.mcp_snapshot';

const cache: Partial<Record<Walker, { seq: number; data: Published | { error: string } }>> = {};

/**
 * Whether read tools that support it should project from the in-game snapshot.
 * @param env Environment to read; defaults to `process.env`.
 * @returns True when `DFHACK_MCP_SNAPSHOT` is set.
 */
export function snapshotEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.DFHACK_MCP_SNAPSHOT;
}

async function statuses(): Promise<Record<Walker, WalkerStatus>> {
  try {
    return JSON.parse((await callLua(RPC_MODULE, 'seqs'))[0]);
  } catch {
    await runScript('snapshot', ['status']);
    return JSON.parse((await callLua(RPC_MODULE, 'seqs'))[0]);
  }
}

async function ensureRunning(s: Record<Walker, WalkerStatus>): Promise<boolean> {
  let started = false;
  if (!s.entities.running) {
    await runScript('snapshot', ['start', SLICE, CADENCE, ENTITY_CLASSES]);
    started = true;
  }
  if (!s.map.running) {
    await runScript('snapshot', ['start_map', MAP_SLICE, MAP_CADENCE]);
    started = true;
  }
  if (GOVERNOR && !s.entities.governor) {
    await runScript('snapshot', ['govern', 'on', GOVERNOR_HIGH, GOVERNOR_LOW]);
    started = true;
  }
  return started;
}

/**
 * Changes a walker's slice and cadence in place, without restarting the pass in flight.
 * @param walker Which walker to retune.
 * @param slice Entities per frame, or undefined to leave it alone.
 * @param cadence Frames between passes, or undefined to leave it alone. With the governor
 *   on this sets the target it recovers towards, not necessarily the effective cadence.
 * @returns The walker's status after the change.
 * @throws {NotConnectedError} If DFHack can't be reached.
 */
export async function tuneWalker(
  walker: Walker,
  slice?: number,
  cadence?: number
): Promise<WalkerStatus> {
  const sub = walker === 'map' ? 'tune_map' : 'tune';
  const out = await runScript('snapshot', [sub, String(slice ?? ''), String(cadence ?? '')]);
  return JSON.parse(out);
}

async function latest(
  walker: Walker
): Promise<{ data: Published | { error: string }; now: number } | ErrorPayload> {
  let s = await statuses();
  if (await ensureRunning(s)) s = await statuses();
  const deadline = Date.now() + WARMUP_MS;
  for (;;) {
    if (s[walker].ready) {
      const hit = cache[walker];
      if (hit && hit.seq === s[walker].seq) return { data: hit.data, now: s[walker].now_ms };
      const data = JSON.parse((await callLua(RPC_MODULE, walker))[0]);
      if (data) {
        cache[walker] = { seq: s[walker].seq, data };
        return { data, now: s[walker].now_ms };
      }
    }
    if (Date.now() > deadline) {
      return { error: `no ${walker} snapshot published within ${WARMUP_MS} ms`, code: 'TIMEOUT' };
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
    s = await statuses();
  }
}

async function read<T extends Published>(
  walker: Walker
): Promise<(T & { age_ms: number }) | ErrorPayload> {
  const got = await latest(walker);
  if ('error' in got) return got;
  if ('error' in got.data) return withGuardCode({ error: got.data.error }) as ErrorPayload;
  return { ...(got.data as T), age_ms: got.now - got.data.captured_at_ms };
}

/**
 * Returns the latest complete entity snapshot, starting the publisher if needed.
 * Cached by sequence number, so an unchanged snapshot costs one small RPC.
 * @returns The snapshot, the shared no-fort guard, or a TIMEOUT payload if none arrives in time.
 * @throws {Error} If the publisher's output isn't valid JSON.
 */
export function readSnapshot(): Promise<Snapshot | ErrorPayload> {
  return read<Snapshot>('entities');
}

/**
 * Returns the latest complete map census, starting the publisher if needed.
 * @returns The census snapshot, the shared no-fort guard, or a TIMEOUT payload.
 * @throws {Error} If the publisher's output isn't valid JSON.
 */
export function readMapSnapshot(): Promise<MapSnapshot | ErrorPayload> {
  return read<MapSnapshot>('map');
}

import { runJsonScript } from '../query.ts';
import type { ErrorPayload } from '../errors.ts';
import type { ToolDef } from '../register.ts';
import { FOG_OF_WAR_NOTE, fogArgs, revealHiddenParam, type FogReport } from '../fog.ts';
import {
  READ_SOURCE_NOTE,
  liveSource,
  readSourceParam,
  readsSnapshot,
  snapshotSource,
  type ReadSource,
  type SourceReport,
} from '../readSource.ts';
import { readMapSnapshot, readSnapshot, type MapSnapshot, type Snapshot } from '../snapshot.ts';

export interface MapExtents {
  x: number;
  y: number;
  z: number;
}

export interface FortCore {
  x: number;
  y: number;
  z: number;
  citizens: number;
}

export interface MapActivity {
  z_levels: number[];
  construction_z: number[];
  digging_z: number[];
}

export interface StairColumn {
  x: number;
  y: number;
  z_top: number;
  z_bottom: number;
}

export interface MapOverview extends FogReport, SourceReport {
  extents: MapExtents;
  fort_core: FortCore | null;
  surface_z_at_core: number | null;
  activity: MapActivity;
  stair_columns: StairColumn[];
  stair_columns_total: number;
  stair_columns_truncated: boolean;
}

type LiveMapOverview = Omit<MapOverview, keyof SourceReport>;

const COLUMNS_CAP = 40;

function fortCore(snap: Snapshot): FortCore | null {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let n = 0;
  for (const u of snap.units) {
    if (!u.citizen || u.error || u.pos.x < 0) continue;
    cx += u.pos.x;
    cy += u.pos.y;
    cz += u.pos.z;
    n++;
  }
  if (n === 0) return null;
  return { x: Math.floor(cx / n), y: Math.floor(cy / n), z: Math.floor(cz / n), citizens: n };
}

function stairColumns(stairs: MapSnapshot['census']['stairs']): StairColumn[] {
  const cells = new Map<string, { x: number; y: number; tiles: { z: number; s: string }[] }>();
  for (const [x, y, z, s] of stairs) {
    const key = `${x},${y}`;
    const cell = cells.get(key) ?? { x, y, tiles: [] };
    cell.tiles.push({ z, s });
    cells.set(key, cell);
  }
  const connects = (lo: { z: number; s: string }, hi: { z: number; s: string }) =>
    hi.z === lo.z + 1 && (lo.s === 'U' || lo.s === 'X') && (hi.s === 'D' || hi.s === 'X');
  const columns: StairColumn[] = [];
  for (const { x, y, tiles } of cells.values()) {
    tiles.sort((a, b) => a.z - b.z);
    let start = 0;
    for (let i = 0; i < tiles.length; i++) {
      if (i === tiles.length - 1 || !connects(tiles[i], tiles[i + 1])) {
        columns.push({ x, y, z_top: tiles[i].z, z_bottom: tiles[start].z });
        start = i + 1;
      }
    }
  }
  const height = (c: StairColumn) => c.z_top - c.z_bottom + 1;
  return columns.sort(
    (a, b) => height(b) - height(a) || a.x - b.x || a.y - b.y || a.z_top - b.z_top
  );
}

/**
 * Builds map_overview's payload from the publisher's map census and entity snapshot.
 * @param map A complete map census snapshot.
 * @param snap A complete entity snapshot (for the citizen centroid).
 * @returns The same shape `mcp_mapOverview.lua` emits with fog of war applied, plus provenance.
 */
export function projectMapOverview(map: MapSnapshot, snap: Snapshot): MapOverview {
  const c = map.census;
  const core = fortCore(snap);
  let surface: number | null = null;
  if (core) {
    const i = (core.y * c.extents.x + core.x) * 2;
    const hex = c.surface_hex.slice(i, i + 2);
    surface = hex === 'ff' || hex.length < 2 ? null : parseInt(hex, 16);
  }
  const all = stairColumns(c.stairs);
  const union = [...new Set([...c.construction_z, ...c.digging_z])].sort((a, b) => a - b);
  return {
    ...snapshotSource({ entities: snap, map }),
    extents: c.extents,
    fort_core: core,
    surface_z_at_core: surface,
    activity: { z_levels: union, construction_z: c.construction_z, digging_z: c.digging_z },
    stair_columns: all.slice(0, COLUMNS_CAP),
    stair_columns_total: all.length,
    stair_columns_truncated: all.length > COLUMNS_CAP,
    fog_of_war: 'applied',
  };
}

async function mapOverviewFromSnapshot(): Promise<MapOverview | ErrorPayload> {
  const map = await readMapSnapshot();
  if ('error' in map) return map;
  const snap = await readSnapshot();
  if ('error' in snap) return snap;
  return projectMapOverview(map, snap);
}

export async function mapOverview(
  revealHidden?: boolean,
  source?: ReadSource
): Promise<MapOverview | ErrorPayload> {
  if (readsSnapshot(source) && !revealHidden) return mapOverviewFromSnapshot();
  const live = await runJsonScript<LiveMapOverview>('mapOverview', fogArgs(revealHidden), [
    'stair_columns',
  ]);
  if ('error' in live) return live;
  const data: MapOverview = { ...liveSource(), ...live };
  if (data.activity) {
    for (const k of ['z_levels', 'construction_z', 'digging_z'] as const) {
      if (!Array.isArray(data.activity[k])) data.activity[k] = [];
    }
  }
  if (data.surface_z_at_core === undefined) data.surface_z_at_core = null;
  if (data.fort_core === undefined) data.fort_core = null;
  return data;
}

export const mapOverviewDef: ToolDef = {
  name: 'map_overview',
  title: 'Map overview',
  description:
    'Cheap spatial orientation to run BEFORE any per-tile terrain read: map ' +
    'extents (x/y/z tile counts), the fort-core coordinate (the same 3D citizen ' +
    'centroid defenses() reports), surface_z_at_core — the surface z-level ' +
    'directly above the fort center, i.e. the highest open-to-sky ground tile in ' +
    'THAT ONE COLUMN, or null if the core is not under open sky (this is NOT ' +
    "geology()'s surface_z_max, which is the highest open-to-sky ground tile " +
    'anywhere on the embark; on a sloped map the two legitimately differ by many ' +
    'z-levels, so pick the one you mean) — the z-levels that carry player activity (construction and ' +
    'pending digging, listed separately and as a union), and stairways collapsed ' +
    'to traversable single-column vertical runs (x, y, z_top, z_bottom); a run ' +
    'only spans levels that actually connect by DF stair rules, so a helical ' +
    'shaft splits into its climbable segments. The payload is fixed-size ' +
    'regardless of fort size: activity is a set of z-levels, never per-tile, and ' +
    'stair columns are RANKED BY HEIGHT (tallest run first) then capped, so when a ' +
    'fort exceeds the cap the tallest shafts survive and only trivial fragments ' +
    'are dropped (stair_columns_truncated flags the overflow; stair_columns_total ' +
    'gives the full count). ' +
    'Fog-of-war honest: undiscovered tiles never leak. Use it to decide which ' +
    'z-levels and area to pull grids for. Returns {"error":"no fort loaded"} if ' +
    'no fort is active. ' +
    'reveal_hidden=true always reads live: the map census classifies revealed tiles only, ' +
    'so a bypassed overview cannot be projected from it. ' +
    FOG_OF_WAR_NOTE +
    ' ' +
    READ_SOURCE_NOTE,
  shape: { reveal_hidden: revealHiddenParam, source: readSourceParam },
  run: ({ reveal_hidden, source }) => mapOverview(reveal_hidden, source),
};

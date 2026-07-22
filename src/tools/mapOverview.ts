import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

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

export interface MapOverview {
  extents: MapExtents;
  fort_core: FortCore | null;
  surface_z: number | null;
  activity: MapActivity;
  stair_columns: StairColumn[];
  stair_columns_total: number;
  stair_columns_truncated: boolean;
  alerts: string[];
}

export async function mapOverview(): Promise<MapOverview | { error: string }> {
  const data = await runJsonScript<MapOverview>('mapOverview', [], ['stair_columns', 'alerts']);
  if ('error' in data) return data;
  if (data.activity) {
    for (const k of ['z_levels', 'construction_z', 'digging_z'] as const) {
      if (!Array.isArray(data.activity[k])) data.activity[k] = [];
    }
  }
  if (data.surface_z === undefined) data.surface_z = null;
  if (data.fort_core === undefined) data.fort_core = null;
  return data;
}

export const mapOverviewDef: ToolDef = {
  name: 'map_overview',
  title: 'Map overview',
  description:
    'Cheap spatial orientation to run BEFORE any per-tile terrain read: map ' +
    'extents (x/y/z tile counts), the fort-core coordinate (the same 3D citizen ' +
    'centroid defenses() reports), the surface z-level directly above the fort ' +
    'center (highest open-to-sky ground tile there, or null if the core is not ' +
    'under open sky), the z-levels that carry player activity (construction and ' +
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
    'no fort is active.',
  run: mapOverview,
};

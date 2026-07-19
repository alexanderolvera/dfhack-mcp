// map_overview(): cheap spatial orientation before any tile_region read — map
// extents, the fort-core anchor (the same 3D citizen centroid defenses() uses),
// the surface z at that center, the z-levels carrying player activity
// (construction or digging), and stair columns as vertical runs. A fixed-size
// payload regardless of fort size. Thin wrapper over the MAP_OVERVIEW Lua query.

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
  z_levels: number[]; // union of construction_z and digging_z, sorted
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
  // The activity lists are nested, so runJsonScript's top-level normalization
  // doesn't reach them; an empty Lua table encodes as {} rather than []. Keep the
  // tool's contract of number[] firm at this version-fragile boundary.
  if (data.activity) {
    for (const k of ['z_levels', 'construction_z', 'digging_z'] as const) {
      if (!Array.isArray(data.activity[k])) data.activity[k] = [];
    }
  }
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
    'to vertical columns (x, y, z_top, z_bottom). The payload is fixed-size ' +
    'regardless of fort size: activity is a set of z-levels, never per-tile, and ' +
    'stair columns are capped (stair_columns_truncated flags the overflow). ' +
    'Fog-of-war honest: undiscovered tiles never leak. Use it to decide which ' +
    'z-levels and area to pull grids for. Returns {"error":"no fort loaded"} if ' +
    'no fort is active.',
  run: mapOverview,
};

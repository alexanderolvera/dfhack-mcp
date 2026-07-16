// defenses(): where the threats are vs. what you have to fight them with.
// Thin wrapper over the DEFENSES Lua query.

import { runJsonScript } from '../query.ts';

export interface Geo {
  dist: number; // 8-directional tile distance (Chebyshev)
  dz: number; // z-levels (+ = the other point is above the threat)
  dir: string; // compass bearing, e.g. "NW", or "here"
}

/** Terrain at a threat's own tile. `discovered:false` (fog of war) carries no
 *  shape — the substrate never leaks an undiscovered tile's type. */
export interface Footing {
  discovered: boolean;
  symbol?: string; // mcp_readTerrain glyph, e.g. "." floor, "#" wall
  terrain?: string; // that glyph's legend meaning
  open_to_sky?: boolean; // the designation.outside flag (open vs covered)
}

export interface DefenseThreat {
  name: string;
  token: string | null;
  pos: { x: number; y: number; z: number };
  walk_group: number; // DF walkability group of the threat's tile (0 = none)
  location: 'inside' | 'outside'; // inside == shares a citizen walk group
  footing: Footing;
  from_core?: Geo;
  nearest_bridge?: { x: number; y: number; z: number } & Geo;
}

export interface Bridge {
  x: number;
  y: number;
  z: number;
  tiles: number;
  direction: string;
}

/** The fort's connected walkable interior(s) — the "walled perimeter". */
export interface Interior {
  groups: { group: number; citizens: number }[];
  primary_group: number | null;
  citizens: number;
}

/** A single-z terrain window on the busiest citizen level (via mcp_readTerrain). */
export interface PerimeterTerrain {
  z: number;
  citizens_on_level: number;
  center: { x: number; y: number };
  origin: { x: number; y: number; z: number };
  w: number;
  h: number;
  exposure: { open_to_sky: number; covered: number; undiscovered: number };
  fortifications: { x: number; y: number }[];
  distinct: Record<string, number>;
  legend: Record<string, string>;
  grid: string[];
}

export interface Defenses {
  fort_core: { x: number; y: number; z: number; citizens: number } | null;
  interior: Interior;
  threats: DefenseThreat[];
  structures: {
    bridges: Bridge[];
    levers: number;
    floodgates: number;
    hatches: number;
    cage_traps: number;
    doors: { total: number; forbidden: number };
  };
  perimeter_terrain: PerimeterTerrain | null;
}

export async function defenses(): Promise<Defenses | { error: string }> {
  const res = await runJsonScript<Defenses>('defenses', [], ['threats']);
  if ('error' in res) return res;
  // Empty Lua tables encode as {} not [] — coerce the nested list fields.
  if (res.structures && !Array.isArray(res.structures.bridges)) res.structures.bridges = [];
  if (res.interior && !Array.isArray(res.interior.groups)) res.interior.groups = [];
  const pt = res.perimeter_terrain;
  if (pt) {
    if (!Array.isArray(pt.fortifications)) pt.fortifications = [];
    if (!Array.isArray(pt.grid)) pt.grid = [];
  }
  return res;
}

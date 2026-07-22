import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface Geo {
  dist: number;
  dz: number;
  dir: string;
}

export interface Footing {
  discovered: boolean;
  symbol?: string;
  terrain?: string;
  open_to_sky?: boolean;
}

export interface DefenseThreat {
  name: string;
  token: string | null;
  pos: { x: number; y: number; z: number };
  walk_group: number;
  location: 'inside' | 'outside';
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

export interface Interior {
  groups: { group: number; citizens: number }[];
  primary_group: number | null;
  citizens: number;
}

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
  if (res.structures && !Array.isArray(res.structures.bridges)) res.structures.bridges = [];
  if (res.interior && !Array.isArray(res.interior.groups)) res.interior.groups = [];
  const pt = res.perimeter_terrain;
  if (pt) {
    if (!Array.isArray(pt.fortifications)) pt.fortifications = [];
    if (!Array.isArray(pt.grid)) pt.grid = [];
  }
  return res;
}

export const defensesDef: ToolDef = {
  name: 'defenses',
  title: 'Defenses',
  description:
    'Where the threats are versus what you have to fight them with. Returns active ' +
    'hostiles with map positions and their geometry to the fort core and to the ' +
    'nearest drawbridge (dist = 8-directional tile count (Chebyshev), dz = ' +
    'z-levels with + meaning above the threat, dir = compass bearing), plus an ' +
    'inventory of controllable defensive structures (drawbridges with positions, ' +
    'levers, floodgates, hatches, cage traps, locked doors). Terrain-aware: each ' +
    'threat is classified inside/outside the fort\'s walled perimeter — "inside" ' +
    'means its tile shares a walkability group with your citizens, i.e. a hostile ' +
    'could walk to your population through connected open space without breaching ' +
    'a wall (walk_group 0 = no walkable footing, e.g. a flier over open air). ' +
    'A perimeter_terrain field reads the busiest citizen level via the terrain ' +
    'substrate: an ASCII tile grid (with legend) plus counts of walls, ' +
    'fortifications (with positions), and open-to-sky vs covered vs undiscovered ' +
    'tiles. Facts only — decide the tactics yourself, and use identify() for a ' +
    'creature\'s trait facts (e.g. cage traps do not hold a TRAPAVOID creature). ' +
    'Caveats: inside/outside is walking connectivity, so a FLIER or ' +
    'BUILDING_DESTROYER can reach you while reported "outside" — cross-reference ' +
    'its traits. perimeter_terrain is a single z-level and does not synthesize a ' +
    'multi-z approach vector; undiscovered tiles are fog of war ("?") and never ' +
    'leak their real type. Which lever raises which bridge is not recorded in the ' +
    'raws, so bridges and levers are reported separately, not linked. Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  run: defenses,
};

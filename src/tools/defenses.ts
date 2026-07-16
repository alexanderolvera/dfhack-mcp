// defenses(): where the threats are vs. what you have to fight them with.
// Thin wrapper over the DEFENSES Lua query.

import { runJsonScript } from '../query.ts';

export interface Geo {
  dist: number; // 8-directional tile distance (Chebyshev)
  dz: number; // z-levels (+ = the other point is above the threat)
  dir: string; // compass bearing, e.g. "NW", or "here"
}

export interface DefenseThreat {
  name: string;
  token: string | null;
  pos: { x: number; y: number; z: number };
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

export interface Defenses {
  fort_core: { x: number; y: number; z: number; citizens: number } | null;
  threats: DefenseThreat[];
  structures: {
    bridges: Bridge[];
    levers: number;
    floodgates: number;
    hatches: number;
    cage_traps: number;
    doors: { total: number; forbidden: number };
  };
  notes: string[];
}

export async function defenses(): Promise<Defenses | { error: string }> {
  const res = await runJsonScript<Defenses>('defenses', [], ['threats', 'notes']);
  if ('error' in res) return res;
  // Nested list under structures needs its own coercion (empty Lua table -> {}).
  if (res.structures && !Array.isArray(res.structures.bridges)) res.structures.bridges = [];
  return res;
}

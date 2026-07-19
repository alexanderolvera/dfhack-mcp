// geology(): a one-call geological survey of the embark — the layer stack the
// fort has exposed, the aquifer, surface water, and (fog-of-war gated) the
// caverns and magma sea. Thin wrapper over the mcp_geology Lua query.

import { runJsonScript } from '../query.ts';
import { z } from 'zod';
import type { ToolDef } from '../register.ts';

/** One geological band: a run of z-levels sharing the same material set. */
export interface GeoLayer {
  z_top: number;
  z_bottom: number;
  kind: string; // soil | sedimentary | metamorphic | igneous_extrusive | igneous_intrusive | mixed | unknown
  materials: string[]; // in-game names (e.g. "limestone") that wiki/game_data resolve
}

export interface Aquifer {
  present: boolean;
  type?: 'light' | 'heavy';
  z_top?: number;
  z_bottom?: number;
}

export interface Cavern {
  layer: number; // 1 = first cavern
  z_top: number;
  z_bottom: number;
  water: boolean;
}

export interface SurfaceWater {
  brook: boolean;
  river: boolean;
  murky_pools: number;
  frozen_in_winter: boolean;
}

export interface Geology {
  surface_z: number;
  layers: GeoLayer[];
  aquifer: Aquifer;
  caverns_discovered: Cavern[];
  magma_reached: boolean;
  surface_water: SurfaceWater;
  alerts: string[];
  // Present only when reveal_hidden was passed (fog-of-war bypass):
  reveal_hidden?: true;
  caverns_hidden?: Cavern[];
  magma_hidden?: { z_top: number; z_bottom: number };
}

export async function geology(reveal_hidden = false): Promise<Geology | { error: string }> {
  const data = await runJsonScript<Geology>(
    'geology',
    [reveal_hidden ? 'true' : 'false'],
    ['layers', 'caverns_discovered', 'alerts']
  );
  if ('error' in data) return data;
  // Nested list fields an empty Lua table encodes as {} — keep the contract firm.
  for (const b of data.layers ?? []) {
    if (!Array.isArray(b.materials)) b.materials = [];
  }
  if (reveal_hidden && !Array.isArray(data.caverns_hidden)) data.caverns_hidden = [];
  return data;
}

export const geologyDef: ToolDef = {
  name: 'geology',
  title: 'Geology',
  description:
    'A one-call geological survey of the embark, REVEALED-INFO ONLY by default. ' +
    'Returns the surface z-level; the layer stack the fort has exposed (each band ' +
    'z_top..z_bottom with a kind — soil/sedimentary/metamorphic/igneous — and the ' +
    'in-game material names, e.g. "limestone", that game_data/wiki_lookup resolve); ' +
    'the aquifer (presence, light vs. heavy type, and z-range, enough to fuse with ' +
    'wiki_lookup("Aquifer")); the caverns actually DISCOVERED (each with z-range and ' +
    'whether it holds water); whether the magma sea has been reached; and surface ' +
    'water (brook, river, murky-pool count, and whether it freezes in winter — the ' +
    'well-gating fact). Undiscovered caverns and an unreached magma sea are OMITTED ' +
    '(fog of war stays honest). Set reveal_hidden=true to BYPASS FOG OF WAR and also ' +
    'surface every undiscovered cavern (caverns_hidden) and the magma sea z-range ' +
    '(magma_hidden) — a debug/spoiler switch, default false. Reports what is there, ' +
    'not where to dig. Returns {"error":"no fort loaded"} if no fort is active.',
  shape: {
    reveal_hidden: z
      .boolean()
      .optional()
      .describe(
        'Bypass fog of war: also report undiscovered caverns and the magma-sea ' +
          'z-range regardless of discovery. Default false (undiscovered depths omitted).'
      ),
  },
  run: ({ reveal_hidden }) => geology(reveal_hidden ?? false),
};

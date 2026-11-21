import { z } from 'zod';
import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';
import { FOG_OF_WAR_NOTE, fogArgs, revealHiddenParam, type FogReport } from '../fog.ts';

export interface GeoLayer {
  z_top: number;
  z_bottom: number;
  kind: string;
  materials: string[];
}

export interface Aquifer {
  present: boolean;
  type?: 'light' | 'heavy';
  z_top?: number;
  z_bottom?: number;
}

export interface Cavern {
  layer: number;
  z_top: number;
  z_bottom: number;
  water: boolean;
}

export interface SurfaceWater {
  brook: boolean;
  river: boolean;
  murky_pools: number;
  permanent_freeze: boolean;
}

export interface Geology extends FogReport {
  surface_z_max: number;
  layers: GeoLayer[];
  aquifer: Aquifer;
  caverns_discovered: Cavern[];
  magma_reached: boolean;
  surface_water: SurfaceWater;
}

export async function geology(
  revealHidden?: boolean,
  refresh?: boolean
): Promise<Geology | { error: string }> {
  const argv = fogArgs(revealHidden);
  if (refresh) argv.push('--refresh');
  const data = await runJsonScript<Geology>('geology', argv, ['layers', 'caverns_discovered']);
  if ('error' in data) return data;
  for (const b of data.layers ?? []) {
    if (!Array.isArray(b.materials)) b.materials = [];
  }
  return data;
}

export const geologyDef: ToolDef = {
  name: 'geology',
  title: 'Geology',
  description:
    'A one-call geological survey of the embark, REVEALED-INFO ONLY by default. ' +
    'Returns surface_z_max — the highest open-to-sky ground z-level found ANYWHERE ' +
    "on the embark (NOT map_overview()'s surface_z_at_core, which is the surface " +
    'directly above the fort centre only; on a sloped map the two legitimately ' +
    'differ by many z-levels); the layer stack the fort has exposed (each band ' +
    'z_top..z_bottom with a kind — soil/sedimentary/metamorphic/igneous — and the ' +
    'in-game material names, e.g. "limestone", that game_data resolves); the ' +
    'aquifer (presence, light vs. heavy type, and z-range); the caverns actually ' +
    'DISCOVERED (each with z-range and whether it holds water); whether the magma ' +
    'sea has been reached; and surface water (brook, river, murky-pool count, and ' +
    'permanent_freeze — whether the ' +
    "biome's base temperature keeps surface water frozen year-round, glacier/tundra, " +
    'the well-gating fact; not a seasonal winter claim). Undiscovered caverns and an ' +
    'unreached magma sea are OMITTED; with reveal_hidden=true every cavern is listed ' +
    'in caverns_discovered, magma_reached reports whether the sea exists, and the ' +
    'layer stack runs the full column. Reports what is there, not where to dig. ' +
    'The layer stack is fixed for a map load, so this is computed once per load and per ' +
    'reveal_hidden mode and served from memory afterwards: the first call costs seconds of ' +
    'frozen game time, later ones cost the RPC round trip. Pass refresh=true to recompute. ' +
    'Returns {"error":"no fort loaded"} if no fort is active. ' +
    FOG_OF_WAR_NOTE,
  shape: {
    reveal_hidden: revealHiddenParam,
    refresh: z
      .boolean()
      .optional()
      .describe(
        'Recompute instead of serving the load-time cache, and replace what is cached. ' +
          'The cache is already dropped when a map loads or unloads, so this is only for ' +
          'forcing a fresh read.'
      ),
  },
  run: ({ reveal_hidden, refresh }) => geology(reveal_hidden, refresh),
};

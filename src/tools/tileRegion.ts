import { runJsonScript } from '../query.ts';
import { z } from 'zod';
import type { ToolDef } from '../register.ts';

export interface Liquid {
  x: number;
  y: number;
  type: 'water' | 'magma';
  depth: number;
}

export interface TileRegion {
  z: number;
  origin: [number, number];
  size: [number, number];
  legend: Record<string, string>;
  grid: string[];
  liquids: Liquid[];
  liquids_truncated: boolean;
  hidden_tiles: number;
  truncated: boolean;
  requested?: [number, number];
}

const coord = () => z.coerce.number().int().optional();
const toArg = (n?: number): string => (n === undefined || n === null ? '' : String(n));

export async function tileRegion(args: {
  z?: number;
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
}): Promise<TileRegion | { error: string }> {
  const argv = [toArg(args.z), toArg(args.x0), toArg(args.y0), toArg(args.x1), toArg(args.y1)];
  return runJsonScript<TileRegion>('tileRegion', argv, ['grid', 'liquids']);
}

export const tileRegionDef: ToolDef = {
  name: 'tile_region',
  title: 'Tile region',
  description:
    'A bounded window of ONE z-level rendered as an ASCII character grid plus a ' +
    'self-describing legend (every response carries the legend for exactly the ' +
    'glyphs it uses). Renders terrain shape (undug stone #, undug soil ",", dug ' +
    'floor ., ramps r/v, up/down stairs </>/x, fortifications F, trees T), ' +
    'constructed floor +, water ~ and magma %, and building footprints collapsed ' +
    'to FOUR CLASSES — workshop/furnace W, stockpile S, machine M, furniture n — ' +
    'never per-building detail. The grid glyph is depth-blind; a separate sparse ' +
    'liquids list carries per-tile [{x,y,type,depth}] (flow_size 1..7). ' +
    'Undiscovered tiles are ? (fog of war) and are NEVER painted over. ' +
    'All five parameters are OPTIONAL: with none, returns a fixed DEFAULT 60x40 ' +
    'window centered on the fort core (the busiest citizen z-level and that ' +
    "level's citizen centroid); pass z alone to recenter on THAT level's own " +
    'citizen centroid; pass z,x0,y0,x1,y1 for an explicit rectangle. The window ' +
    'is hard-capped at 100x100 per side — an oversized request is CLAMPED (never ' +
    'errored) with truncated:true and the original size echoed in requested. ' +
    'Facts only: it renders the map, it does not design or suggest layouts. ' +
    'Read-only. Returns {"error":"no fort loaded"} if no fort is active.',
  shape: {
    z: coord().describe('z-level to render; defaults to the busiest citizen level'),
    x0: coord().describe('window corner X (with y0,x1,y1 for an explicit rectangle)'),
    y0: coord().describe('window corner Y'),
    x1: coord().describe('opposite window corner X'),
    y1: coord().describe('opposite window corner Y'),
  },
  run: (args) => tileRegion(args),
};

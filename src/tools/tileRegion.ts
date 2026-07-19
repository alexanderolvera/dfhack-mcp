// tile_region(z, x0, y0, x1, y1): a bounded window of ONE z-level rendered as a
// character grid + self-describing legend. The "earthworks" map — terrain shape,
// ramps/stairs, constructions, liquids, trees, and building footprints collapsed
// to four CLASSES (workshop / stockpile / machine / furniture). Thin wrapper over
// the mcp_tileRegion Lua query, which composes on the fog-of-war-safe
// mcp_readTerrain substrate (hidden tiles stay '?', never overwritten).
//
// This is the FIRST parameterized MCP tool. All five params are optional: with
// none, the Lua emits a fixed DEFAULT window centered on the fort core, so the
// no-arg golden (what verify.mjs captures) is reproducible.

import { runJsonScript } from '../query.ts';
import { z } from 'zod';
import type { ToolDef } from '../register.ts';

export interface TileRegion {
  z: number;
  origin: [number, number]; // window top-left [x, y] in DF map space (+x east, +y south)
  size: [number, number]; // [width, height], each hard-capped at 100
  legend: Record<string, string>; // exactly the glyphs present in `grid`
  grid: string[]; // `size[1]` rows, each `size[0]` chars wide
  hidden_tiles: number; // count of '?' fog-of-war tiles in the grid
  truncated: boolean; // an oversized request was clamped to the 100x100 cap
  requested?: [number, number]; // present only when truncated: the original [w, h]
}

// Optional integer arg accepting either a number or a numeric string (call-tool
// passes key=value strings; a real MCP client passes numbers). Coerced, then
// serialized back to argv for the positional Lua contract (Z X0 Y0 X1 Y1).
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
  return runJsonScript<TileRegion>('tileRegion', argv, ['grid']);
}

export const tileRegionDef: ToolDef = {
  name: 'tile_region',
  title: 'Tile region',
  description:
    'A bounded window of ONE z-level rendered as an ASCII character grid plus a ' +
    'self-describing legend (every response carries the legend for exactly the ' +
    'glyphs it uses). Renders terrain shape (undug stone #, dug floor ., ramps ' +
    'r/v, up/down stairs </>/x, fortifications F, trees T), constructed floor +, ' +
    'water ~ and magma %, and building footprints collapsed to FOUR CLASSES — ' +
    'workshop/furnace W, stockpile S, machine M, furniture n — never per-building ' +
    'detail. Undiscovered tiles are ? (fog of war) and are NEVER painted over. ' +
    'All five parameters are OPTIONAL: with none, returns a fixed DEFAULT 60x40 ' +
    'window centered on the fort core (the busiest citizen z-level and that ' +
    "level's citizen centroid); pass z alone to recenter on another level; pass " +
    'z,x0,y0,x1,y1 for an explicit rectangle. The window is hard-capped at ' +
    '100x100 per side — an oversized request is CLAMPED (never errored) with ' +
    'truncated:true and the original size echoed in requested. Facts only: it ' +
    'renders the map, it does not design or suggest layouts. Read-only. Returns ' +
    '{"error":"no fort loaded"} if no fort is active.',
  shape: {
    z: coord().describe('z-level to render; defaults to the busiest citizen level'),
    x0: coord().describe('window corner X (with y0,x1,y1 for an explicit rectangle)'),
    y0: coord().describe('window corner Y'),
    x1: coord().describe('opposite window corner X'),
    y1: coord().describe('opposite window corner Y'),
  },
  run: (args) => tileRegion(args),
};

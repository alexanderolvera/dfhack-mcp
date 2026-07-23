import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface AquiferLayer {
  z_top: number;
  z_bottom: number;
  classification: 'light' | 'heavy' | 'mixed';
  light_tiles: number;
  heavy_tiles: number;
}

export interface WaterLayer {
  z: number;
  tiles: number;
  salt_tiles: number;
  fresh_tiles: number;
  stagnant_tiles: number;
  flowing_tiles: number;
  max_depth: number;
}

export interface MagmaSea {
  top_z: number;
  revealed_tile_count: number;
}

export interface FloodRiskTile {
  x: number;
  y: number;
  z: number;
  salt: boolean;
  stagnant: boolean;
  footing: string;
  from_core: { dist: number; dz: number; dir: string };
}

export interface FluidsWell {
  x: number;
  y: number;
  z: number;
  source: 'water' | 'magma' | 'frozen' | 'unknown';
  depth_to_source?: number;
}

export interface Fluids {
  aquifer_layers: AquiferLayer[];
  aquifer_layers_total: number;
  aquifer_layers_truncated: boolean;
  water_layers: WaterLayer[];
  water_layers_total: number;
  water_layers_truncated: boolean;
  magma_sea: MagmaSea | null;
  flood_risk_tiles: FloodRiskTile[];
  flood_risk_total: number;
  flood_risk_truncated: boolean;
  wells: FluidsWell[];
  wells_total: number;
  wells_truncated: boolean;
  legend: Record<string, string>;
  scan: { complete: boolean; tiles_scanned: number; last_z_scanned: number | null };
}

export function fluids(): Promise<Fluids | { error: string }> {
  return runJsonScript<Fluids>('fluids', [], [
    'aquifer_layers',
    'water_layers',
    'flood_risk_tiles',
    'wells',
  ]);
}

export const fluidsDef: ToolDef = {
  name: 'fluids',
  title: 'Fluids',
  description:
    'Water and magma engineering facts the Earthworks tier (tile_region, geology) does ' +
    "not cover: aquifer layers, standing/flowing water, the magma sea's top, flood " +
    'exposure at the fort interior, and well water-source depth. Revealed-only, fog-of-' +
    'war safe — undiscovered tiles never contribute to any field here, the same as ' +
    'tile_region/defenses. aquifer_layers[] groups contiguous revealed z-levels sharing ' +
    'the same light/heavy classification (a mix of both within a run of z-levels reads ' +
    '"mixed") with light_tiles/heavy_tiles tile counts (capped at 50 layers). ' +
    'water_layers[] is a per-z-level aggregate of revealed standing/flowing water tiles ' +
    '(tiles, salt_tiles/fresh_tiles, stagnant_tiles/flowing_tiles, max_depth 1..7) — NOT ' +
    'flood-filled into discrete named bodies (no connectivity analysis is attempted; a ' +
    'single lake spanning two z-levels appears as two rows) — capped at 200 z-levels. ' +
    'magma_sea is the highest revealed z-level with at least 20 revealed magma tiles ' +
    '(a size floor meant to separate a real magma sea from a small pool/volcano pipe), ' +
    'or null if no such level is revealed. flood_risk_tiles[] lists revealed FULL-depth ' +
    '(max_depth 7/7) water tiles chebyshev-adjacent to a tile in the same walkable group ' +
    "as any citizen — a flood-EXPOSURE fact (this water sits next to fort-reachable " +
    'space right now), not a prediction of whether or when it floods anything; capped ' +
    'at 50 (flood_risk_total/flood_risk_truncated track the real count). wells[] extends ' +
    "rooms_and_zones' well read with each well's x/y and the water source found scanning " +
    `down from it (source: water/magma/frozen/unknown, depth_to_source in z-levels; ` +
    'depth_to_source is absent if the source is unknown or the scan hit a hidden tile ' +
    'first) — capped at 20. scan.complete is false if the fort-wide tile budget was hit ' +
    'before reaching z=0 (scan.last_z_scanned marks where it stopped); every field above ' +
    'is still fog-of-war-safe when that happens, just possibly missing deep layers. ' +
    'Facts only — no dig/pump/floodgate recommendations. Returns {"error":"no fort ' +
    'loaded"} if no fort is active.',
  run: fluids,
};

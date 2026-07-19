// environment(): the fort's ambient conditions right now — season, weather,
// surface temperature (is exposed water frozen?), the alignment of the biomes the
// player knew at embark, and, for each cavern the fort has ALREADY breached,
// whether it is currently open to fort pathing or sealed. Thin wrapper over the
// ENVIRONMENT Lua query; the version-fragile DF access lives there.

import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export type Weather = 'none' | 'rain' | 'snow';
export type TemperatureBand = 'freezing' | 'above_freezing' | 'unknown';

export interface Surface {
  temperature: number | null; // DF units; 10000 == water's freezing point. null if fully roofed/hidden.
  temperature_band: TemperatureBand;
  water_frozen: boolean; // surface temperature at/below water's freezing point
  weather: Weather; // dominant cell over the weather grid
  raining: boolean;
  snowing: boolean;
}

export interface Biome {
  evil: boolean;
  good: boolean;
  reanimating: boolean;
}

export interface Cavern {
  cavern: number; // 1..3
  open_to_fort: boolean; // a revealed cavern tile shares a citizen walk group
}

export interface Environment {
  season: number; // 0..3
  season_name: 'spring' | 'summer' | 'autumn' | 'winter' | string;
  surface: Surface;
  biome: Biome;
  caverns: Cavern[]; // ONLY caverns the fort has discovered; empty if none breached
  caverns_discovered: number;
  alerts: string[];
}

export async function environment(): Promise<Environment | { error: string }> {
  return runJsonScript<Environment>('environment', [], ['caverns', 'alerts']);
}

export const environmentDef: ToolDef = {
  name: 'environment',
  title: 'Environment',
  description:
    "The fort's ambient conditions right now: current season and dominant " +
    'weather (none/rain/snow), the surface temperature with whether exposed water ' +
    'is currently frozen (the freezing point is 10000 DF units; composes with ' +
    "geology()'s freeze-in-winter fact), the alignment of the biomes visible at " +
    'embark (evil / good / reanimating booleans), and — for each cavern the fort ' +
    'has ALREADY breached — whether it is open to fort pathing or sealed off. ' +
    'Fog-of-war honest: reports NOTHING about undiscovered cavern layers (a fort ' +
    'that has breached none returns an empty caverns list). Small fixed-size ' +
    'payload. Per-tile savagery is unavailable in this DFHack build, so no savage ' +
    'flag is reported. Returns {"error":"no fort loaded"} if no fort is active.',
  run: environment,
};

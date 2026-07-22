import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export type Weather = 'none' | 'rain' | 'snow';

export interface Surface {
  temperature: number | null;
  water_frozen: boolean | null;
  weather: Weather;
  raining: boolean;
  snowing: boolean;
}

export interface Biome {
  evil: boolean;
  good: boolean;
  reanimating: boolean;
}

export interface Cavern {
  cavern: number;
  open_to_fort: boolean;
}

export interface Environment {
  season: number;
  season_name: 'spring' | 'summer' | 'autumn' | 'winter' | string;
  surface: Surface;
  biome: Biome;
  caverns: Cavern[];
  caverns_discovered: number;
  alerts: string[];
}

export async function environment(): Promise<Environment | { error: string }> {
  const data = await runJsonScript<Environment>('environment', [], ['caverns', 'alerts']);
  if ('error' in data) return data;
  if (data.surface) {
    if (data.surface.temperature === undefined) data.surface.temperature = null;
    if (data.surface.water_frozen === undefined) data.surface.water_frozen = null;
  }
  return data;
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

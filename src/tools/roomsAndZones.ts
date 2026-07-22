import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export type SupplyLevel = 'none' | 'low' | 'ok';

export interface Bedrooms {
  assigned: number;
  unassigned: number;
  adults_without: number;
  dormitories: number;
}

export interface Dining {
  halls: number;
  seats: number;
}

export interface Hospital {
  zoned: boolean;
  beds?: number;
  traction_benches?: number;
  well_in_hospital?: boolean;
  supplies?: {
    thread: SupplyLevel;
    cloth: SupplyLevel;
    splints: number;
    crutches: number;
  };
}

export interface Well {
  z: number;
  working: boolean;
  source: 'water' | 'frozen' | 'magma' | 'unknown';
}

export interface Temples {
  dedicated: string[];
  all_inclusive: boolean;
  needed_by_worshippers: string[];
}

export interface ActiveGhost {
  unit_id: number;
  name: string;
  histfig_id: number;
}

export interface Ghosts {
  active: ActiveGhost[];
  active_truncated: boolean;
  unquiet_dead_count: number;
}

export interface RoomsAndZones {
  bedrooms: Bedrooms;
  dining: Dining;
  hospital: Hospital;
  wells: Well[];
  wells_total: number;
  wells_truncated: boolean;
  temples: Temples;
  taverns: number;
  libraries: number;
  guildhalls: number;
  coffins_free: number;
  coffins_used: number;
  dead_unburied: number;
  ghosts: Ghosts;
  alerts: string[];
}

export async function roomsAndZones(): Promise<RoomsAndZones | { error: string }> {
  const data = await runJsonScript<RoomsAndZones>('roomsAndZones', [], ['wells', 'alerts']);
  if ('error' in data) return data;
  if (data.temples) {
    if (!Array.isArray(data.temples.dedicated)) data.temples.dedicated = [];
    if (!Array.isArray(data.temples.needed_by_worshippers)) data.temples.needed_by_worshippers = [];
  }
  if (data.ghosts && !Array.isArray(data.ghosts.active)) data.ghosts.active = [];
  return data;
}

export const roomsAndZonesDef: ToolDef = {
  name: 'rooms_and_zones',
  title: 'Rooms and zones',
  description:
    "The fort's facility inventory, each count paired with its demand-side " +
    'number where one exists: bedrooms (assigned/unassigned vs. adults without ' +
    'one), dining halls and seats, the hospital (beds, traction benches, ' +
    'whether a well is inside, and medical supplies physically stocked), wells ' +
    '(working state and water source: water/frozen/magma/unknown), temples ' +
    '(dedicated deities, whether an all-inclusive temple exists, and deities ' +
    'worshipped by citizens that lack a dedicated temple), taverns, libraries, ' +
    'guildhalls, and coffins free vs. dead awaiting burial (loose corpses of ' +
    "the fort's own race). ghosts reports active apparitions currently on the " +
    'map (`active[]`, fog-of-war gated) plus unquiet_dead_count — this civ\'s ' +
    'dead who are world-flagged as unquiet ghosts (`flags.ghost`) and NOT ' +
    'represented in the visible `active[]` list. This is deliberately not the ' +
    'same as "confirmed absent locally": a ghost hidden behind fog of war is ' +
    'excluded from `active[]` (never leaked) but still counted here, since the ' +
    'world-level ghost fact is fair game even when its exact location isn\'t. ' +
    'The supply-side companion to unmet_needs(). Reports ' +
    'what the fort has, not what to build. ' +
    'Wells are capped (wells_truncated flags the overflow); bedroom and coffin ' +
    'detail is aggregated to counts. Returns {"error":"no fort loaded"} if no ' +
    'fort is active.',
  run: roomsAndZones,
};

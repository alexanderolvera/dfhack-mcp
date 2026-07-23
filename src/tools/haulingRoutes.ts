import { runJsonScript } from '../query.ts';
import type { ToolDef } from '../register.ts';

export interface HaulingStockpileLink {
  building_id: number;
  take: boolean;
  give: boolean;
}

export interface HaulingDepartCondition {
  direction?: 'North' | 'South' | 'East' | 'West';
  mode?: 'Push' | 'Ride' | 'Guide';
  timeout: number;
  load_percent: number;
  at_most: boolean;
  desired: boolean;
}

export interface HaulingStop {
  id: number;
  name?: string;
  pos: { x: number; y: number; z: number };
  stockpiles: HaulingStockpileLink[];
  conditions: HaulingDepartCondition[];
  parked_vehicle_id?: number;
}

export interface RouteVehicle {
  vehicle_id: number;
  current_stop_id?: number;
}

export interface HaulingRoute {
  id: number;
  name?: string;
  stops: HaulingStop[];
  vehicles: RouteVehicle[];
}

export interface Vehicle {
  vehicle_id: number;
  item_id: number;
  minecart_assigned: boolean;
  route_id?: number;
  on_track: boolean;
}

export interface HaulingRoutes {
  routes: HaulingRoute[];
  routes_total: number;
  routes_truncated: boolean;
  vehicles: Vehicle[];
  vehicles_total: number;
  vehicles_truncated: boolean;
}

function normalizeStop(stop: HaulingStop): void {
  if (!Array.isArray(stop.stockpiles)) stop.stockpiles = [];
  if (!Array.isArray(stop.conditions)) stop.conditions = [];
}

function normalizeRoute(route: HaulingRoute): void {
  if (!Array.isArray(route.stops)) route.stops = [];
  if (!Array.isArray(route.vehicles)) route.vehicles = [];
  route.stops.forEach(normalizeStop);
}

export async function haulingRoutes(): Promise<HaulingRoutes | { error: string }> {
  const data = await runJsonScript<HaulingRoutes>('haulingRoutes', [], ['routes', 'vehicles']);
  if ('error' in data) return data;
  data.routes.forEach(normalizeRoute);
  return data;
}

export const haulingRoutesDef: ToolDef = {
  name: 'hauling_routes',
  title: 'Hauling routes',
  description:
    "The fort's minecart hauling infrastructure: routes, each route's stops, and " +
    'the vehicle (minecart) objects fort-wide. routes[] is {id, name?, stops[], ' +
    'vehicles[]}. Each stop is {id, name?, pos:{x,y,z}, stockpiles[], ' +
    'conditions[], parked_vehicle_id?} — stockpiles[] is {building_id, take, ' +
    'give} for every stockpile linked to that stop (take = the cart picks items ' +
    'up from that stockpile, give = the cart drops items into it; a link can be ' +
    'both). conditions[] is that stop\'s departure conditions — {direction, ' +
    'mode, timeout, load_percent, at_most, desired} — mode is how a dwarf moves ' +
    'the cart onward (Push/Ride/Guide), direction is the initial departure ' +
    'heading, and at_most/desired describe the load_percent threshold that must ' +
    'be met before the cart leaves. parked_vehicle_id is the vehicle currently ' +
    'sitting at that exact stop right now, absent if none is. A route\'s own ' +
    'vehicles[] ({vehicle_id, current_stop_id?}) is the set of vehicles ' +
    "assigned to run that route — DF assigns vehicles at the route level, not " +
    'per stop; current_stop_id is which of that route\'s own stops the vehicle ' +
    'currently occupies, absent if in transit or unknown. The top-level ' +
    'vehicles[] is every hauling vehicle fort-wide (minecarts and other cart- ' +
    'type haulers; battering rams excluded) as {vehicle_id, item_id, ' +
    'minecart_assigned, route_id?, on_track} — minecart_assigned is whether the ' +
    "vehicle's backing item still exists (a vehicle can persist as a stale " +
    'reference after its physical cart is destroyed or stolen); route_id is ' +
    'absent for a vehicle not currently assigned to any route. Both routes[] ' +
    '(capped 100, see routes_total/routes_truncated) and the top-level ' +
    'vehicles[] (capped 200, see vehicles_total/vehicles_truncated) are sorted ' +
    'by id. Returns {"error":"no fort loaded"} if no fort is active.',
  run: haulingRoutes,
};

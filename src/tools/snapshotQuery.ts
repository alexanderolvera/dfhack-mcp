import { z } from 'zod';
import { FOG_OF_WAR_NOTE, revealHiddenParam } from '../fog.ts';
import type { ToolDef } from '../register.ts';
import { readMapSnapshot, readSnapshot, type Snapshot } from '../snapshot.ts';

type Primitive = string | number | boolean | null;
type Ops = {
  eq?: Primitive;
  ne?: Primitive;
  lt?: number;
  lte?: number;
  gt?: number;
  gte?: number;
  in?: Primitive[];
  contains?: string;
  exists?: boolean;
};
type Cond = Primitive | Ops;
type Row = Record<string, unknown>;

export interface QueryArgs {
  class: 'units' | 'items' | 'buildings' | 'reports' | 'squads';
  where?: Record<string, Cond>;
  fields?: string[];
  group_by?: string[];
  count_only?: boolean;
  sort_by?: string;
  desc?: boolean;
  limit?: number;
  reveal_hidden?: boolean;
}

const primitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const ops = z
  .object({
    eq: primitive.optional(),
    ne: primitive.optional(),
    lt: z.number().optional(),
    lte: z.number().optional(),
    gt: z.number().optional(),
    gte: z.number().optional(),
    in: z.array(primitive).optional(),
    contains: z.string().optional(),
    exists: z.boolean().optional(),
  })
  .strict();

const lower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

const valueAt = (row: Row, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Row)[k] : undefined), row);

function holds(v: unknown, cond: Cond): boolean {
  if (cond === null || typeof cond !== 'object') return (v ?? null) === cond;
  const n = typeof v === 'number' ? v : undefined;
  if (cond.eq !== undefined && (v ?? null) !== cond.eq) return false;
  if (cond.ne !== undefined && (v ?? null) === cond.ne) return false;
  if (cond.lt !== undefined && !(n !== undefined && n < cond.lt)) return false;
  if (cond.lte !== undefined && !(n !== undefined && n <= cond.lte)) return false;
  if (cond.gt !== undefined && !(n !== undefined && n > cond.gt)) return false;
  if (cond.gte !== undefined && !(n !== undefined && n >= cond.gte)) return false;
  if (cond.in !== undefined && !cond.in.includes((v ?? null) as Primitive)) return false;
  if (
    cond.contains !== undefined &&
    !(typeof v === 'string' && lower(v).includes(lower(cond.contains)))
  )
    return false;
  if (cond.exists !== undefined && (v !== undefined && v !== null) !== cond.exists) return false;
  return true;
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function project(row: Row, fields: string[]): Row {
  const out: Row = {};
  for (const f of fields) {
    const v = valueAt(row, f);
    if (v !== undefined) out[f] = v;
  }
  return out;
}

/**
 * Runs a filter/projection/grouping query over one snapshot class.
 * @param snap A complete entity snapshot.
 * @param args The query.
 * @returns Matched count plus rows, groups, or neither (count_only).
 */
export function runQuery(snap: Snapshot, args: QueryArgs): Row {
  const source = (snap[args.class] ?? []) as Row[];
  const reveal = !!args.reveal_hidden;
  const where = Object.entries(args.where ?? {});
  let rows = source.filter(
    (r) => (reveal || r.hidden !== true) && where.every(([path, c]) => holds(valueAt(r, path), c))
  );
  const out: Row = {
    class: args.class,
    fog_of_war: reveal ? 'bypassed' : 'applied',
    snapshot: { seq: snap.seq, age_ms: snap.age_ms, captured: snap.captured },
    matched: rows.length,
  };
  if (args.count_only) return out;
  if (args.group_by?.length) {
    const keys = args.group_by;
    const groups = new Map<string, Row>();
    for (const r of rows) {
      const vals = keys.map((k) => valueAt(r, k) ?? null);
      const id = JSON.stringify(vals);
      const g = groups.get(id) ?? { ...Object.fromEntries(keys.map((k, i) => [k, vals[i]])), n: 0 };
      g.n = (g.n as number) + 1;
      groups.set(id, g);
    }
    out.groups = [...groups.values()].sort((a, b) => (b.n as number) - (a.n as number));
    return out;
  }
  if (args.sort_by) {
    const key = args.sort_by;
    const dir = args.desc ? -1 : 1;
    rows = [...rows].sort((a, b) => dir * compare(valueAt(a, key), valueAt(b, key)));
  }
  if (args.limit !== undefined) {
    rows = rows.slice(0, args.limit);
    out.returned = rows.length;
  }
  out.rows = args.fields?.length ? rows.map((r) => project(r, args.fields!)) : rows;
  return out;
}

export const snapshotQueryDef: ToolDef = {
  name: 'snapshot_query',
  title: 'Snapshot query',
  description:
    'Filter, project, group and count any entity class from the in-game snapshot. ' +
    'Served from memory: costs no game time once the snapshot is warm. Nothing is truncated; ' +
    'scope with where/fields/group_by/count_only/limit. Paths are dotted (e.g. "pos.z"). ' +
    'where values match exactly, or take ops {eq,ne,lt,lte,gt,gte,in,contains,exists}; contains is ' +
    'case-insensitive. group_by returns [{<field>:value..., n}] sorted by n. Classes and fields: ' +
    'units {id,name,profession,race,citizen,dead,age,stress_category(0 miserable..6 ecstatic),' +
    'job_type,squad_id,wound_count,needs_healthcare,unconscious,pos{x,y,z}}; ' +
    'items {id,type(df item_type e.g. BED,DOOR,BOX,CABINET,BOULDER,BAR),subtype,material(token e.g. ' +
    'INORGANIC:GRANITE, PLANT:WILLOW:WOOD),mat_type,mat_index,quality,wear,stack,pos,container,holder,' +
    'forbid,in_job,dump,on_ground,in_building(installed as furniture),in_inventory,rotten,trader,' +
    'construction,desc}; buildings {id,type(Bed,Door,Workshop,Furnace,Stockpile,Civzone...),subtype,' +
    'zone_type(Civzone only: Bedroom,DiningHall,Office,Tomb...),owner(unit id),x1,y1,x2,y2,z,stage,' +
    'max_stage,name,items,jobs}; reports {id,type,text,year,time,pos,continuation}; squads {id,name}. ' +
    'Every response carries snapshot {seq, age_ms, captured} — positions go stale within seconds. ' +
    'Rows on undiscovered tiles are omitted. ' +
    FOG_OF_WAR_NOTE,
  shape: {
    class: z.enum(['units', 'items', 'buildings', 'reports', 'squads']),
    where: z.record(z.string(), z.union([primitive, ops])).optional(),
    fields: z.array(z.string()).optional().describe('paths to return per row; default all'),
    group_by: z.array(z.string()).optional(),
    count_only: z.boolean().optional(),
    sort_by: z.string().optional(),
    desc: z.boolean().optional(),
    limit: z.coerce.number().int().positive().optional(),
    reveal_hidden: revealHiddenParam,
  },
  snapshot: true,
  compact: true,
  run: async (args: QueryArgs) => {
    const snap = await readSnapshot();
    return 'error' in snap ? snap : runQuery(snap, args);
  },
};

const ENTITY_COLUMNS = [
  'citizens',
  'other_units',
  'workshops',
  'stockpiles',
  'zones',
  'bedrooms',
  'bedrooms_unowned',
  'other_buildings',
];

function entityCounts(snap: Snapshot): Map<number, number[]> {
  const byZ = new Map<number, number[]>();
  const bump = (zv: number, col: number) => {
    const row = byZ.get(zv) ?? ENTITY_COLUMNS.map(() => 0);
    row[col]++;
    byZ.set(zv, row);
  };
  for (const u of snap.units) {
    if (u.error || u.dead || u.hidden) continue;
    bump(u.pos.z, u.citizen ? 0 : 1);
  }
  for (const b of snap.buildings) {
    if (b.error || b.hidden) continue;
    if (b.type === 'Workshop' || b.type === 'Furnace') bump(b.z, 2);
    else if (b.type === 'Stockpile') bump(b.z, 3);
    else if (b.type === 'Civzone') {
      bump(b.z, 4);
      if (b.zone_type === 'Bedroom') {
        bump(b.z, 5);
        if (b.owner === undefined) bump(b.z, 6);
      }
    } else bump(b.z, 7);
  }
  return byZ;
}

export const zLevelsDef: ToolDef = {
  name: 'z_levels',
  title: 'Z-level census',
  description:
    'One row per REVEALED z-level of the whole map, surface first: tile counts by class (open, ' +
    'floor, constructed, stair, ramp, tree, wall_stone, wall_mineral (ore veins), wall_soil, ' +
    'wall_other, liquid) over revealed tiles only, the hidden-tile count, and what stands there ' +
    '(citizens, other_units, workshops, stockpiles, zones, bedrooms, bedrooms_unowned, ' +
    'other_buildings). Columnar: {columns, levels:[[...]], unrevealed_z:[[lo,hi]]} — fully ' +
    'unrevealed levels collapse into ranges. Use it to decide where to look before tile_region or ' +
    'snapshot_query. Served from the snapshot; the map census refreshes slowly ' +
    '(minutes), entity counts every few seconds; ages are reported. Optional z_min/z_max scope ' +
    'the rows. Fog-of-war honest: hidden tiles are only counted, never classified.',
  shape: {
    z_min: z.coerce.number().int().optional(),
    z_max: z.coerce.number().int().optional(),
  },
  snapshot: true,
  compact: true,
  run: async ({ z_min, z_max }: { z_min?: number; z_max?: number }) => {
    const map = await readMapSnapshot();
    if ('error' in map) return map;
    const snap = await readSnapshot();
    if ('error' in snap) return snap;
    const counts = entityCounts(snap);
    const empty = ENTITY_COLUMNS.map(() => 0);
    const inRange = (zv: number) =>
      (z_min === undefined || zv >= z_min) && (z_max === undefined || zv <= z_max);
    return {
      columns: [...map.census.columns, ...ENTITY_COLUMNS],
      levels: map.census.levels
        .filter((row) => inRange(row[0]))
        .map((row) => [...row, ...(counts.get(row[0]) ?? empty)]),
      unrevealed_z: map.census.unrevealed_z,
      map_snapshot: { seq: map.seq, age_ms: map.age_ms },
      entity_snapshot: { seq: snap.seq, age_ms: snap.age_ms },
    };
  },
};

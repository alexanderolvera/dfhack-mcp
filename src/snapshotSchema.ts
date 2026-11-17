export type SnapshotClassName = 'units' | 'items' | 'buildings' | 'reports' | 'squads';

export interface SnapshotField {
  name: string;
  note?: string;
  always?: boolean;
}

export interface SnapshotClass {
  name: SnapshotClassName;
  summary: string;
  fields: SnapshotField[];
}

const HIDDEN: SnapshotField = {
  name: 'hidden',
  note: 'true on an undiscovered tile; absent where there is no map position to test',
};

export const SNAPSHOT_CLASSES: readonly SnapshotClass[] = [
  {
    name: 'units',
    summary: 'every unit on the map, citizens and others alike',
    fields: [
      { name: 'id', always: true },
      { name: 'name', always: true },
      { name: 'profession', always: true },
      { name: 'citizen', always: true },
      { name: 'dead', always: true },
      { name: 'age', always: true, note: 'whole years' },
      { name: 'wound_count', always: true },
      { name: 'needs_healthcare', always: true },
      { name: 'unconscious', always: true, note: 'counter, 0 when awake' },
      { name: 'pos', always: true, note: '{x,y,z}; x is negative for a unit off the map' },
      { name: 'race', note: 'creature token, e.g. DWARF' },
      { name: 'stress_category', note: '0 miserable .. 6 ecstatic' },
      { name: 'job_type', note: 'absent when the unit has no current job' },
      { name: 'squad_id', note: 'absent when unsquadded' },
      HIDDEN,
    ],
  },
  {
    name: 'items',
    summary: 'every item, on the ground or held',
    fields: [
      { name: 'id', always: true },
      { name: 'type', always: true, note: 'df item_type, e.g. BED, DOOR, BOX, BOULDER, BAR' },
      { name: 'subtype', always: true, note: '-1 when the type has none' },
      { name: 'mat_type', always: true },
      { name: 'mat_index', always: true },
      { name: 'quality', always: true, note: '0 ordinary .. 5 artifact' },
      { name: 'wear', always: true },
      { name: 'stack', always: true },
      { name: 'forbid', always: true },
      { name: 'in_job', always: true },
      { name: 'dump', always: true },
      { name: 'on_ground', always: true },
      { name: 'in_building', always: true, note: 'installed as furniture' },
      { name: 'in_inventory', always: true },
      { name: 'rotten', always: true },
      { name: 'trader', always: true },
      { name: 'construction', always: true },
      { name: 'material', note: 'token, e.g. INORGANIC:GRANITE, PLANT:WILLOW:WOOD' },
      { name: 'pos', note: 'absent for an item with no map position, i.e. one held or contained' },
      { name: 'container', note: 'item id of the container holding it' },
      { name: 'holder', note: 'unit id carrying it' },
      { name: 'desc', note: "DF's own rendered description" },
      HIDDEN,
    ],
  },
  {
    name: 'buildings',
    summary: 'every building, including stockpiles and zones',
    fields: [
      { name: 'id', always: true },
      { name: 'type', always: true, note: 'Bed, Door, Workshop, Furnace, Stockpile, Civzone, ...' },
      { name: 'subtype', always: true, note: '-1 when the type has none' },
      { name: 'custom', always: true, note: 'custom building type index, -1 when not custom' },
      { name: 'x1', always: true },
      { name: 'y1', always: true },
      { name: 'x2', always: true },
      { name: 'y2', always: true },
      { name: 'z', always: true },
      { name: 'stage', always: true, note: 'build stage reached' },
      { name: 'max_stage', always: true, note: 'stage at which it is complete' },
      { name: 'zone_type', note: 'Civzone only: Bedroom, DiningHall, Pen, Barracks, ...' },
      { name: 'owner', note: 'assigned unit id, absent when unassigned' },
      { name: 'name', note: 'absent when the building is unnamed' },
      { name: 'items', note: 'count of contained items' },
      { name: 'jobs', note: 'count of jobs posted at it' },
      HIDDEN,
    ],
  },
  {
    name: 'reports',
    summary: "the fort's recent announcements and combat log",
    fields: [
      { name: 'id', always: true },
      { name: 'type', always: true, note: 'df announcement_type, e.g. COMBAT_PARRY' },
      { name: 'text', always: true },
      { name: 'year', always: true },
      { name: 'time', always: true, note: 'tick within the year' },
      { name: 'pos', always: true },
      {
        name: 'continuation',
        always: true,
        note: 'true when this line continues the previous one',
      },
    ],
  },
  {
    name: 'squads',
    summary: 'military squads, for resolving squad_id',
    fields: [
      { name: 'id', always: true },
      { name: 'name', always: true },
    ],
  },
];

export const SNAPSHOT_CLASS_NAMES = SNAPSHOT_CLASSES.map((c) => c.name) as [
  SnapshotClassName,
  ...SnapshotClassName[],
];

export const CENSUS_COLUMNS: readonly SnapshotField[] = [
  { name: 'z', note: 'the z-level this row describes' },
  { name: 'revealed', note: 'discovered tiles on the level' },
  { name: 'hidden', note: 'undiscovered tiles, counted but never classified' },
  { name: 'open' },
  { name: 'floor' },
  { name: 'constructed' },
  { name: 'stair' },
  { name: 'ramp' },
  { name: 'tree' },
  { name: 'wall_stone' },
  { name: 'wall_mineral', note: 'ore veins' },
  { name: 'wall_soil' },
  { name: 'wall_other' },
  { name: 'liquid' },
];

export const ENTITY_COLUMNS: readonly SnapshotField[] = [
  { name: 'citizens' },
  { name: 'other_units' },
  { name: 'workshops', note: 'workshops and furnaces' },
  { name: 'stockpiles' },
  { name: 'zones' },
  { name: 'bedrooms' },
  { name: 'bedrooms_unowned' },
  { name: 'other_buildings' },
];

export const ENTITY_COLUMN_NAMES = ENTITY_COLUMNS.map((c) => c.name);

const render = (f: SnapshotField): string => (f.note ? `${f.name} (${f.note})` : f.name);

/**
 * Renders the per-class field reference `snapshot_query`'s description carries.
 * @returns One `class {field, field (note), ...}` clause per class, semicolon separated.
 */
export function describeSnapshotClasses(): string {
  return SNAPSHOT_CLASSES.map((c) => `${c.name} {${c.fields.map(render).join(', ')}}`).join('; ');
}

/**
 * Renders the column reference `z_levels`'s description carries.
 * @returns The census columns and the entity columns as two labelled lists.
 */
export function describeZLevelColumns(): string {
  return (
    `tile counts over revealed tiles only — ${CENSUS_COLUMNS.map(render).join(', ')} — ` +
    `then what stands there: ${ENTITY_COLUMNS.map(render).join(', ')}`
  );
}

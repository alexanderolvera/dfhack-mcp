import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  CENSUS_COLUMNS,
  ENTITY_COLUMNS,
  ENTITY_COLUMN_NAMES,
  SNAPSHOT_CLASSES,
  SNAPSHOT_CLASS_NAMES,
  describeSnapshotClasses,
  describeZLevelColumns,
} from '../src/snapshotSchema.ts';
import { snapshotQueryDef, zLevelsDef } from '../src/tools/snapshotQuery.ts';

const ENTITIES = 'test/fixtures/snapshot/entities.json';
const MAP = 'test/fixtures/snapshot/map.json';
const captured = existsSync(ENTITIES) && existsSync(MAP);
const published = (path) => JSON.parse(readFileSync(path, 'utf8')).published;

const doc = (name) => readFileSync(`docs/tools/${name}.md`, 'utf8');

test('the schema is well formed and every class is offered by the tool', () => {
  assert.deepEqual(
    [...SNAPSHOT_CLASS_NAMES],
    SNAPSHOT_CLASSES.map((c) => c.name)
  );
  for (const c of SNAPSHOT_CLASSES) {
    const names = c.fields.map((f) => f.name);
    assert.deepEqual(names, [...new Set(names)], `${c.name}: duplicate field`);
    assert.ok(c.summary.length > 10, `${c.name}: summary`);
    for (const f of c.fields)
      assert.ok(
        f.note === undefined || !f.note.includes('\n'),
        `${c.name}.${f.name}: one-line note`
      );
  }
});

// The schema mirrors what the Lua walker emits, so the capture is the only thing
// that can prove the mirror honest. See CONTRIBUTING.md, "Off-game development".
test(
  'every field the walker emits is in the schema, and vice versa',
  { skip: !captured && 'no capture committed' },
  () => {
    const cap = published(ENTITIES);
    for (const c of SNAPSHOT_CLASSES) {
      const rows = cap[c.name];
      assert.ok(Array.isArray(rows) && rows.length > 0, `${c.name}: capture has rows`);
      const emitted = new Set();
      for (const r of rows) for (const k of Object.keys(r)) emitted.add(k);
      const declared = new Set(c.fields.map((f) => f.name));
      const undocumented = [...emitted].filter((k) => !declared.has(k)).sort();
      const phantom = [...declared].filter((k) => !emitted.has(k)).sort();
      assert.deepEqual(undocumented, [], `${c.name}: emitted but not in the schema`);
      assert.deepEqual(phantom, [], `${c.name}: in the schema but never emitted`);
    }
  }
);

test(
  'a field marked always is present on every captured row',
  { skip: !captured && 'no capture committed' },
  () => {
    const cap = published(ENTITIES);
    for (const c of SNAPSHOT_CLASSES) {
      const rows = cap[c.name];
      for (const f of c.fields.filter((f) => f.always)) {
        const missing = rows.filter((r) => !(f.name in r)).length;
        assert.equal(missing, 0, `${c.name}.${f.name} claims always but is missing on ${missing}`);
      }
    }
  }
);

test(
  'the census columns the schema documents are the columns the walker publishes',
  { skip: !captured && 'no capture committed' },
  () => {
    const census = published(MAP).census;
    assert.deepEqual(
      census.columns,
      CENSUS_COLUMNS.map((c) => c.name),
      'census column names and order are the contract z_levels reports'
    );
    for (const row of census.levels)
      assert.equal(
        row.length,
        CENSUS_COLUMNS.length,
        'every census row carries exactly one value per column'
      );
  }
);

test('both tool descriptions name every field and column from the schema', () => {
  const q = snapshotQueryDef.description;
  for (const c of SNAPSHOT_CLASSES) {
    assert.ok(q.includes(`${c.name} {`), `snapshot_query description is missing class ${c.name}`);
    for (const f of c.fields)
      assert.ok(q.includes(f.name), `snapshot_query description is missing ${c.name}.${f.name}`);
  }
  assert.ok(q.includes(describeSnapshotClasses()), 'the class reference comes from the schema');

  const z = zLevelsDef.description;
  for (const col of [...CENSUS_COLUMNS, ...ENTITY_COLUMNS])
    assert.ok(z.includes(col.name), `z_levels description is missing column ${col.name}`);
  assert.ok(z.includes(describeZLevelColumns()), 'the column reference comes from the schema');
});

test('both doc pages name every field and column from the schema', () => {
  const q = doc('snapshot_query');
  for (const c of SNAPSHOT_CLASSES) {
    assert.ok(q.includes(c.name), `snapshot_query.md is missing class ${c.name}`);
    for (const f of c.fields)
      assert.ok(
        q.includes(`\`${f.name}\``),
        `snapshot_query.md does not document ${c.name}.${f.name}`
      );
  }

  const z = doc('z_levels');
  for (const col of [...CENSUS_COLUMNS, ...ENTITY_COLUMNS])
    assert.ok(z.includes(`\`${col.name}\``), `z_levels.md does not document column ${col.name}`);
});

test('z_levels reports the census columns followed by the entity columns', () => {
  assert.deepEqual(
    ENTITY_COLUMN_NAMES,
    ENTITY_COLUMNS.map((c) => c.name),
    'the names used for counting are the ones documented'
  );
  const shared = ENTITY_COLUMN_NAMES.filter((n) => CENSUS_COLUMNS.some((c) => c.name === n));
  assert.deepEqual(shared, [], 'a column name means one thing, so the two sets cannot overlap');
});

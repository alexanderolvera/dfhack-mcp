import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFixture, fixtureDir, _clearFixtureCache } from '../src/snapshotFixture.ts';
import { projectFindUnit } from '../src/tools/findUnit.ts';
import { projectMapOverview } from '../src/tools/mapOverview.ts';
import { runQuery } from '../src/tools/snapshotQuery.ts';

const FIXTURES = 'test/fixtures/snapshot';
const captured = existsSync(join(FIXTURES, 'entities.json'));

function writeFixture(dir, walker, body) {
  writeFileSync(join(dir, `${walker}.json`), JSON.stringify(body));
  _clearFixtureCache();
}

const scratch = () => mkdtempSync(join(tmpdir(), 'dfmcp-fixture-'));

test('fixtureDir reads the env var and treats empty as unset', () => {
  assert.equal(fixtureDir({}), undefined);
  assert.equal(fixtureDir({ DFHACK_MCP_SNAPSHOT_FIXTURE: '' }), undefined);
  assert.equal(fixtureDir({ DFHACK_MCP_SNAPSHOT_FIXTURE: 'some/dir' }), 'some/dir');
});

test('a capture yields the payload plus the wall clock recorded with it, so age_ms is stable', () => {
  const dir = scratch();
  writeFixture(dir, 'entities', {
    fixture: {
      df_version: 'v0.53.15',
      dfhack_version: '53.15-r2',
      save_folder: 'region1',
      captured_now_ms: 9000,
      captured_by: 'test',
    },
    published: { seq: 4, captured_at_ms: 7500, units: [] },
  });
  const got = readFixture('entities', dir);
  assert.equal(got.now, 9000);
  assert.equal(got.data.seq, 4);
  assert.equal(got.now - got.data.captured_at_ms, 1500, 'age_ms is derived from recorded numbers');
  assert.equal(
    readFixture('entities', dir).now - readFixture('entities', dir).data.captured_at_ms,
    1500,
    'and is identical on every read'
  );
});

test('a missing, malformed or non-capture fixture fails loudly rather than falling back to live', () => {
  const dir = scratch();
  assert.throws(() => readFixture('entities', dir), /could not be read/);

  writeFileSync(join(dir, 'map.json'), '{ not json');
  _clearFixtureCache();
  assert.throws(() => readFixture('map', dir), /not valid JSON/);

  writeFixture(dir, 'map', { published: { captured_at_ms: 1 } });
  assert.throws(() => readFixture('map', dir), /not a snapshot capture/);

  writeFixture(dir, 'map', { fixture: { captured_now_ms: 1 }, published: { seq: 1 } });
  assert.throws(() => readFixture('map', dir), /no published\.captured_at_ms/);
});

// The projections below are pure functions over a capture, so they are the one
// part of the snapshot path that CI can exercise with no DF and no Docker.
// See CONTRIBUTING.md, "Off-game development".
test(
  'the committed capture is a complete entity snapshot',
  { skip: !captured && 'no capture committed' },
  () => {
    const { data } = readFixture('entities', FIXTURES);
    assert.ok(Number.isInteger(data.seq), 'seq');
    assert.ok(Number.isInteger(data.captured?.year), 'captured.year');
    for (const cls of ['units', 'items', 'buildings', 'reports', 'squads'])
      assert.ok(Array.isArray(data[cls]), `${cls} is an array`);
    assert.ok(data.units.length > 0, 'the capture has units');
  }
);

test(
  'projectFindUnit over the capture returns citizens that exist in it',
  { skip: !captured && 'no capture committed' },
  () => {
    const { data, now } = readFixture('entities', FIXTURES);
    const snap = { ...data, age_ms: now - data.captured_at_ms };
    const ids = new Set(snap.units.map((u) => u.id));

    const all = projectFindUnit(snap, '');
    assert.equal(all.source, 'snapshot');
    assert.equal(all.snapshot.entities.seq, snap.seq);
    assert.ok(all.match_count > 0, 'the empty query matches every citizen');
    assert.equal(all.truncated, all.match_count > all.matches.length);
    for (const m of all.matches) {
      assert.ok(ids.has(m.unit_id), `unit_id ${m.unit_id} is in the capture`);
      assert.equal(typeof m.name, 'string');
      assert.notEqual(m.stress, undefined);
      assert.equal(typeof m.current_job, 'string', 'current_job is always reported, idle included');
    }

    const none = projectFindUnit(snap, 'zzzznomatch');
    assert.equal(none.match_count, 0);
    assert.deepEqual(none.matches, []);
    assert.equal(none.truncated, false);
  }
);

test(
  'projectMapOverview over the capture stays inside the map it describes',
  { skip: !captured && 'no capture committed' },
  () => {
    const ents = readFixture('entities', FIXTURES);
    const maps = readFixture('map', FIXTURES);
    const snap = { ...ents.data, age_ms: ents.now - ents.data.captured_at_ms };
    const map = { ...maps.data, age_ms: maps.now - maps.data.captured_at_ms };

    const out = projectMapOverview(map, snap);
    assert.equal(out.source, 'snapshot');
    assert.deepEqual(
      Object.keys(out.snapshot).sort(),
      ['entities', 'map'],
      'both walkers reported'
    );
    assert.equal(out.fog_of_war, 'applied');

    const e = out.extents;
    assert.ok(e.x > 0 && e.y > 0 && e.z > 0, 'extents are positive');
    if (out.fort_core) {
      assert.ok(out.fort_core.x >= 0 && out.fort_core.x < e.x, 'fort_core x inside extents');
      assert.ok(out.fort_core.y >= 0 && out.fort_core.y < e.y, 'fort_core y inside extents');
      assert.ok(out.fort_core.citizens > 0, 'fort_core counts the citizens it averaged');
    }
    for (const c of out.stair_columns) {
      assert.ok(
        c.x >= 0 && c.x < e.x && c.y >= 0 && c.y < e.y,
        `stair column ${c.x},${c.y} in bounds`
      );
      assert.ok(c.z_top >= c.z_bottom, 'a stair run is top-down ordered');
    }
    assert.equal(out.stair_columns_truncated, out.stair_columns_total > out.stair_columns.length);
    const union = new Set(out.activity.z_levels);
    for (const z of [...out.activity.construction_z, ...out.activity.digging_z])
      assert.ok(union.has(z), `activity z ${z} is in the union`);
  }
);

test(
  'runQuery over the capture scopes without truncating behind the caller',
  { skip: !captured && 'no capture committed' },
  () => {
    const { data, now } = readFixture('entities', FIXTURES);
    const snap = { ...data, age_ms: now - data.captured_at_ms };

    const all = runQuery(snap, { class: 'units' });
    assert.equal(all.matched, all.rows.length, 'with no limit, every matched row is returned');
    assert.equal(all.returned, undefined, 'and returned is only reported when a limit scoped it');

    const limited = runQuery(snap, { class: 'units', limit: 3 });
    assert.equal(limited.matched, all.matched, 'limit scopes the rows, not the match count');
    assert.ok(limited.rows.length <= 3);
    assert.equal(limited.returned, limited.rows.length);

    const counted = runQuery(snap, { class: 'units', count_only: true });
    assert.equal(counted.matched, all.matched);
    assert.equal(counted.rows, undefined, 'count_only returns no rows');

    const fields = runQuery(snap, { class: 'units', fields: ['id', 'name'], limit: 2 });
    for (const row of fields.rows)
      assert.deepEqual(
        Object.keys(row).sort(),
        ['id', 'name'],
        'fields projects exactly what was asked'
      );

    const grouped = runQuery(snap, { class: 'items', group_by: ['type'] });
    assert.ok(grouped.groups.length > 1, 'a real fort has more than one item type');
    assert.equal(
      grouped.groups.reduce((n, g) => n + g.n, 0),
      grouped.matched,
      'the groups account for every matched row'
    );
    for (let i = 1; i < grouped.groups.length; i++)
      assert.ok(grouped.groups[i - 1].n >= grouped.groups[i].n, 'groups are ordered by size');
    assert.equal(grouped.rows, undefined, 'a grouped query returns groups, not rows');

    const hidden = runQuery(snap, { class: 'units' });
    assert.ok(
      hidden.rows.every((r) => r.hidden !== true),
      'fog of war is applied by default, so hidden rows never leak'
    );
    assert.equal(hidden.fog_of_war, 'applied');
  }
);

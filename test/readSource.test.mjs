import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_TOOLS } from '../src/tools/registry.ts';
import {
  READ_SOURCE_NOTE,
  defaultReadSource,
  liveSource,
  readSourceParam,
  readsSnapshot,
  snapshotSource,
} from '../src/readSource.ts';
import { PARITY_SPECS, compareParity, sourceProblems, stripProvenance } from './parity.mjs';

const TOOLS = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'tools');
const modules = readdirSync(TOOLS)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(join(TOOLS, f), 'utf8'));

const toolsInModulesCalling = (marker) => {
  const names = modules
    .filter((src) => src.includes(marker))
    .flatMap((src) => [...src.matchAll(/^ {2}name: '([a-z_]+)',$/gm)].map((m) => m[1]));
  return ALL_TOOLS.filter((t) => names.includes(t.name));
};

const dualPathTools = toolsInModulesCalling('readsSnapshot(');
const reportingTools = toolsInModulesCalling('snapshotSource(');
const paramTools = ALL_TOOLS.filter((t) => t.shape?.source);

const SNAP = {
  seq: 7,
  age_ms: 1234,
  captured: { year: 251, year_tick: 4200 },
  captured_at_ms: 0,
  started: { year: 251, year_tick: 4100 },
  walk: {},
  squads: [],
  units: [],
  items: [],
  buildings: [],
  reports: [],
};
const MAP = { ...SNAP, seq: 2, age_ms: 44_000, census: {} };

test('every dual-path tool declares the shared source parameter and documents provenance', () => {
  assert.ok(dualPathTools.length > 0);
  assert.deepEqual(paramTools.map((t) => t.name).sort(), dualPathTools.map((t) => t.name).sort());
  for (const t of paramTools) {
    assert.equal(t.shape.source, readSourceParam, `${t.name} declares its own source param`);
  }
});

test('every tool that reports provenance carries the shared note', () => {
  assert.ok(reportingTools.length > 0);
  for (const t of reportingTools) {
    assert.ok(t.description.includes(READ_SOURCE_NOTE), `${t.name} description lacks the note`);
  }
});

test('every parity spec names a registered dual-path tool and at least one call', () => {
  const dual = new Set(dualPathTools.map((t) => t.name));
  for (const spec of PARITY_SPECS) {
    assert.ok(dual.has(spec.tool), `${spec.tool} has no source parameter to compare both ways`);
    assert.ok(spec.calls.length > 0, `${spec.tool} has no parity calls`);
  }
  assert.deepEqual(PARITY_SPECS.map((s) => s.tool).sort(), [...dual].sort());
});

test('source is an optional snapshot|live enum', () => {
  assert.equal(readSourceParam.safeParse(undefined).success, true);
  assert.equal(readSourceParam.safeParse('live').data, 'live');
  assert.equal(readSourceParam.safeParse('snapshot').data, 'snapshot');
  assert.equal(readSourceParam.safeParse('census').success, false);
  assert.equal(readSourceParam.safeParse(true).success, false);
});

test('the default source is live until the snapshot layer is on', () => {
  assert.equal(defaultReadSource({}), 'live');
  assert.equal(defaultReadSource({ DFHACK_MCP_READ_SOURCE: 'snapshot' }), 'live');
  assert.equal(defaultReadSource({ DFHACK_MCP_SNAPSHOT: '1' }), 'snapshot');
  assert.equal(
    defaultReadSource({ DFHACK_MCP_SNAPSHOT: '1', DFHACK_MCP_READ_SOURCE: 'live' }),
    'live'
  );
});

test('source=live is always honored, source=snapshot only where the layer is on', () => {
  const on = { DFHACK_MCP_SNAPSHOT: '1' };
  assert.equal(readsSnapshot('live', on), false);
  assert.equal(readsSnapshot('snapshot', on), true);
  assert.equal(readsSnapshot(undefined, on), true);
  assert.equal(readsSnapshot('snapshot', {}), false);
  assert.equal(readsSnapshot(undefined, {}), false);
  assert.equal(readsSnapshot('live', {}), false);
  assert.equal(readsSnapshot(undefined, { ...on, DFHACK_MCP_READ_SOURCE: 'live' }), false);
});

test('a live read reports source only; a snapshot read reports one entry per walker', () => {
  assert.deepEqual(liveSource(), { source: 'live' });
  assert.deepEqual(snapshotSource({ entities: SNAP }), {
    source: 'snapshot',
    snapshot: { entities: { seq: 7, age_ms: 1234, captured: { year: 251, year_tick: 4200 } } },
  });
  const both = snapshotSource({ entities: SNAP, map: MAP });
  assert.deepEqual(Object.keys(both.snapshot), ['entities', 'map']);
  assert.equal(both.snapshot.map.age_ms, 44_000);
});

test('the parity harness accepts the envelope the contract emits and rejects drift in it', () => {
  assert.deepEqual(sourceProblems(liveSource(), 'live'), []);
  assert.deepEqual(sourceProblems(snapshotSource({ entities: SNAP, map: MAP }), 'snapshot'), []);
  assert.deepEqual(sourceProblems({ ...liveSource(), snapshot: {} }, 'live'), [
    'a live read carries snapshot provenance',
  ]);
  assert.deepEqual(sourceProblems({ source: 'snapshot' }, 'snapshot'), [
    'a snapshot read carries no snapshot.<walker> provenance',
  ]);
  assert.deepEqual(sourceProblems(snapshotSource({ entities: SNAP }), 'live'), [
    'source is "snapshot", expected "live"',
    'a live read carries snapshot provenance',
  ]);
});

test('stripping provenance leaves the payload the two paths must agree on', () => {
  const payload = { ...snapshotSource({ entities: SNAP }), query: 'a', matches: [] };
  assert.deepEqual(stripProvenance(payload), { query: 'a', matches: [] });
});

const findUnitSpec = PARITY_SPECS.find((spec) => spec.tool === 'find_unit');
const match = (over = {}) => ({
  unit_id: 1,
  name: 'Urist',
  profession: 'Miner',
  age: 57,
  current_job: 'Dig',
  stress: 'content',
  wounded: false,
  patient: false,
  unconscious: false,
  ...over,
});
const payload = (provenance, matches) => ({
  ...provenance,
  query: 'a',
  match_count: matches.length,
  truncated: false,
  matches,
});
const LIVE = () => payload(liveSource(), [match()]);
const PROJECTED = (over) => payload(snapshotSource({ entities: SNAP }), [match(over)]);

test('paused, the two paths must be deep-equal once provenance is stripped', () => {
  assert.deepEqual(compareParity(findUnitSpec, LIVE(), PROJECTED(), { paused: true }), {
    failures: [],
    drift: [],
  });
  const moved = compareParity(findUnitSpec, LIVE(), PROJECTED({ current_job: 'idle' }), {
    paused: true,
  });
  assert.equal(moved.failures.length, 1);
  assert.match(moved.failures[0], /not deep-equal to the live read/);
});

test('running, a volatile field is drift and an identity field is failure', () => {
  const drifted = compareParity(findUnitSpec, LIVE(), PROJECTED({ current_job: 'idle' }), {
    paused: false,
  });
  assert.deepEqual(drifted.failures, []);
  assert.deepEqual(drifted.drift, ['matches: 1/1 rows moved since capture (current_job)']);

  const renamed = compareParity(findUnitSpec, LIVE(), PROJECTED({ name: 'Someone else' }), {
    paused: false,
  });
  assert.deepEqual(renamed.drift, []);
  assert.equal(renamed.failures.length, 1);
  assert.match(renamed.failures[0], /^matches\[0\]\.name: live /);
});

test('running, a stable top-level field is failure and a row-count mismatch is too', () => {
  const live = LIVE();
  const short = payload(snapshotSource({ entities: SNAP }), []);
  const r = compareParity(findUnitSpec, live, short, { paused: false });
  assert.ok(r.failures.some((f) => f.startsWith('match_count: live 1 vs projected 0')));
  assert.ok(r.failures.some((f) => f === 'matches: 1 live rows vs 0 projected'));
});

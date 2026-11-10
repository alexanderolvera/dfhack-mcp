import process from 'node:process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.DFHACK_MCP_TIMEOUT_MS = '2000';
process.env.DFHACK_MCP_SNAPSHOT_WARMUP_MS = '300';
process.env.DFHACK_MCP_SNAPSHOT_POLL_MS = '20';

const { _setClientFactory } = await import('../src/dfclient.ts');

const RPC = 'rpc.mcp_snapshot';
const PROBE = 'addScriptPath) and "yes"';
const NO_FORT = { error: 'no fort loaded' };
const LUA = readFileSync('src/dfhack-queries/mcp_snapshot.lua', 'utf8');

function entityPayload(seq, units) {
  return {
    seq,
    captured_at_ms: 400,
    started: { year: 125, year_tick: 1000 },
    captured: { year: 125, year_tick: 1200 },
    walk: { steps: 7 },
    squads: [],
    units,
    items: [],
    buildings: [],
    reports: [],
  };
}

function publisher() {
  const walkers = {
    entities: { running: false, seq: 0, latest: null, now_ms: 1000 },
    map: { running: false, seq: 0, latest: null, now_ms: 1000 },
  };
  const bodyReads = [];
  const started = [];

  const statusOf = (w) => ({
    running: w.running,
    ready: w.latest !== null,
    seq: w.seq,
    now_ms: w.now_ms,
  });

  _setClientFactory(() => ({
    connected: false,
    async connect() {
      this.connected = true;
      return this;
    },
    close() {
      this.connected = false;
    },
    runLuaSnippet(snippet) {
      if (snippet.includes(PROBE)) return Promise.resolve('yes');
      if (snippet.includes('findScript(')) return Promise.resolve('/queries/mcp_gameState.lua');
      return Promise.resolve('');
    },
    runCommand(command, args) {
      if (command === 'mcp_snapshot') {
        started.push(args[0]);
        if (args[0] === 'start') walkers.entities.running = true;
        if (args[0] === 'start_map') walkers.map.running = true;
      }
      return Promise.resolve('{}');
    },
    callLua(module, fn) {
      assert.equal(module, RPC, 'the reader uses the resident rpc module, not a script lookup');
      if (fn === 'seqs') {
        const body = { entities: statusOf(walkers.entities), map: statusOf(walkers.map) };
        return Promise.resolve([JSON.stringify(body)]);
      }
      bodyReads.push(fn);
      return Promise.resolve([JSON.stringify(walkers[fn].latest)]);
    },
  }));

  return {
    walkers,
    bodyReads,
    started,
    publish(name, payload) {
      const w = walkers[name];
      w.seq += 1;
      w.latest = payload;
    },
    unloadFort() {
      for (const w of Object.values(walkers)) {
        if (w.latest && w.latest.error === NO_FORT.error) continue;
        w.seq += 1;
        w.latest = NO_FORT;
      }
    },
  };
}

let salt = 0;
const freshReader = () => import('../src/snapshot.ts?t=' + ++salt);

test('reads the published entity snapshot and reports its age', async () => {
  const pub = publisher();
  pub.publish('entities', entityPayload(1, [{ id: 7, name: 'Urist' }]));
  const { readSnapshot } = await freshReader();

  const snap = await readSnapshot();
  assert.equal(snap.units[0].id, 7);
  assert.equal(snap.seq, 1);
  assert.equal(snap.age_ms, 600, 'age is the publisher clock minus the capture time');
});

test('the publisher is started on first use, each walker once', async () => {
  const pub = publisher();
  pub.publish('entities', entityPayload(1, []));
  pub.publish('map', { seq: 1, captured_at_ms: 400, census: { levels: [] } });
  const { readSnapshot, readMapSnapshot } = await freshReader();

  await readSnapshot();
  await readMapSnapshot();
  assert.deepEqual(pub.started, ['start', 'start_map']);
});

test('an unchanged seq is served from cache without re-reading the body', async () => {
  const pub = publisher();
  pub.publish('entities', entityPayload(1, [{ id: 7 }]));
  const { readSnapshot } = await freshReader();

  await readSnapshot();
  await readSnapshot();
  await readSnapshot();
  assert.deepEqual(pub.bodyReads, ['entities'], 'one body read for three calls at the same seq');
});

test('a fort unloaded mid-walk replaces a cached snapshot with the no-fort guard', async () => {
  const pub = publisher();
  pub.publish('entities', entityPayload(1, [{ id: 7, name: 'Urist' }]));
  const { readSnapshot } = await freshReader();

  const live = await readSnapshot();
  assert.equal(live.units[0].id, 7);

  pub.unloadFort();
  const after = await readSnapshot();
  assert.equal(after.error, 'no fort loaded', 'the stale fort snapshot is not served');
  assert.equal(after.code, 'NO_FORT');
  assert.equal(after.units, undefined);
});

test('the no-fort state publishes a new seq exactly once, then the reader caches it', async () => {
  const pub = publisher();
  pub.publish('entities', entityPayload(1, []));
  const { readSnapshot } = await freshReader();
  await readSnapshot();

  pub.unloadFort();
  const seqAtUnload = pub.walkers.entities.seq;
  pub.unloadFort();
  assert.equal(pub.walkers.entities.seq, seqAtUnload, 'idling with no fort does not churn seq');

  await readSnapshot();
  const reads = pub.bodyReads.length;
  await readSnapshot();
  assert.equal(pub.bodyReads.length, reads, 'the guard is cached by seq like any payload');
});

test('the reader recovers after the fort reloads', async () => {
  const pub = publisher();
  pub.publish('entities', entityPayload(1, [{ id: 7 }]));
  const { readSnapshot } = await freshReader();
  await readSnapshot();

  pub.unloadFort();
  assert.equal((await readSnapshot()).code, 'NO_FORT');

  pub.publish('entities', entityPayload(3, [{ id: 9, name: 'Dodok' }]));
  const back = await readSnapshot();
  assert.equal(back.error, undefined);
  assert.equal(back.units[0].id, 9);
});

test('a publisher that never readies times out instead of hanging', async () => {
  publisher();
  const { readSnapshot } = await freshReader();

  const started = Date.now();
  const out = await readSnapshot();
  assert.equal(out.code, 'TIMEOUT');
  assert.ok(Date.now() - started < 5000, 'gave up near the warm-up budget');
});

test('the publisher bumps seq when it drops to the no-fort marker', () => {
  const advance = LUA.slice(LUA.indexOf('local function advance'));
  const body = advance.slice(0, advance.indexOf('local function make_step'));
  assert.match(
    body,
    /if wk\.latest ~= NO_FORT then\s*\n\s*wk\.seq = wk\.seq \+ 1\s*\n\s*wk\.latest = NO_FORT/,
    'advance() must publish NO_FORT under a new seq, or readers keep their cached fort'
  );
});

test('walker state back-fills its defaults, so a script reload cannot leave a nil field', () => {
  const fn = LUA.slice(LUA.indexOf('local function walker(name)'));
  const body = fn.slice(0, fn.indexOf('\nend'));
  for (const key of ['running', 'slice', 'cadence', 'classes', 'seq', 'steps', 'gen']) {
    assert.match(
      body,
      new RegExp('if w\\.' + key + ' == nil then'),
      'walker() leaves ' + key + ' unset'
    );
  }
});

test('a step from a superseded walker generation stops instead of double-walking', () => {
  assert.match(LUA, /local gen, step = wk\.gen/);
  assert.match(LUA, /if not wk\.running or wk\.gen ~= gen then return end/);
  assert.match(LUA, /wk\.gen = wk\.gen \+ 1\s*\n\s*wk\.running = true/);
});

test('the production defaults match the documented cadence', () => {
  assert.match(LUA, /entities = \{ slice = 16, cadence = 600,/);
  assert.match(LUA, /map = \{ slice = 32, cadence = 6000,/);
  assert.match(LUA, /cmd == 'autostart'/);
});

test('cadence is derived through one governor predicate that honours enabled', () => {
  assert.match(
    LUA,
    /local function active_governor\(\)\s*\n\s*local g = state\.gov\s*\n\s*if g and g\.enabled then return g end/,
    'the governor is only active when enabled, or a disabled one still stretches cadence'
  );
  assert.doesNotMatch(
    LUA,
    /state\.gov and gov\.cadence_for/,
    'deriving cadence from state.gov truthiness ignores enabled and strands the backoff'
  );
  const derivations = LUA.match(/wk\.cadence = [^\n]+/g) ?? [];
  assert.ok(derivations.length > 0, 'cadence is assigned somewhere');
  for (const line of derivations) {
    assert.match(
      line,
      /effective_cadence\(wk\)/,
      'cadence assigned without the shared predicate: ' + line
    );
  }
});

test('turning the governor off drops its state, so no stale level survives', () => {
  const fn = LUA.slice(LUA.indexOf('local function govern(on, opts)'));
  const off = fn.slice(0, fn.indexOf('local g = gov.new'));
  assert.match(off, /state\.gov = nil/, 'govern off must clear the governor, not just disable it');
  assert.match(off, /apply_governor\(\)/, 'and re-derive every walker cadence from its target');
});

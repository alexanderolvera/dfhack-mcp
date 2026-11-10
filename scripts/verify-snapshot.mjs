// Live check of the snapshot publisher (#145) against a running fort.
//   DFHACK_PORT=5001 node scripts/verify-snapshot.mjs
//   DFHACK_PORT=5010 node scripts/verify-snapshot.mjs --no-fort
// Needs a loaded fort, or a no-fort fixture for --no-fort (docker/README.md).
// Leaves both walkers stopped. See docs/snapshot.md.
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { callLua, closeConnection, runLua, runScript } from '../src/dfclient.ts';
import { findUnit, projectFindUnit } from '../src/tools/findUnit.ts';
import { readSnapshot } from '../src/snapshot.ts';
import { PARITY_SPECS, compareParity } from '../test/parity.mjs';

const NO_FORT_MODE = process.argv.includes('--no-fort');

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.log(`  ✗ FAIL: ${msg}`);
  }
}

const section = (n, title) => console.log(`\n=== ${n}. ${title} ===`);

async function snapshotCmd(...args) {
  const out = await runScript('snapshot', args);
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`mcp_snapshot ${args.join(' ')} returned non-JSON: ${out.slice(0, 300)}`);
  }
}

const rpc = async (fn) => JSON.parse((await callLua('rpc.mcp_snapshot', fn))[0]);

async function waitFor(predicate, budgetMs, pollMs = 1000) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const got = await predicate();
    if (got) return got;
    if (Date.now() > deadline) return null;
    await sleep(pollMs);
  }
}

const ENTITY_CLASSES = ['units', 'items', 'buildings', 'reports'];

if (NO_FORT_MODE) {
  section(1, 'with no fort loaded, the publisher publishes the guard under a new seq');
  await snapshotCmd('stop');
  // State is durable across script reloads, so seq is whatever this DF process
  // reached already — assert the transition, not an absolute value.
  const seqBeforeStart = (await snapshotCmd('status')).seq;

  const up = await snapshotCmd('autostart');
  assert(up.entities.running && up.map.running, 'autostart runs both walkers with no fort loaded');

  const ready = await waitFor(async () => {
    const s = await rpc('seqs');
    return s.entities.ready ? s.entities : null;
  }, 60_000);
  assert(ready !== null, 'the walker becomes ready even with no fort to walk');
  assert(
    ready?.seq === seqBeforeStart + 1,
    `the guard is published under a NEW seq (${seqBeforeStart} -> ${ready?.seq})`
  );

  for (const walker of ['entities', 'map']) {
    const payload = await rpc(walker);
    assert(payload?.error === 'no fort loaded', `${walker} publishes the no-fort marker`);
  }

  const before = (await rpc('seqs')).entities.seq;
  await sleep(5000);
  const after = (await rpc('seqs')).entities.seq;
  assert(before === after, `idling with no fort does not churn seq (${before} -> ${after})`);

  const read = await readSnapshot();
  assert(read?.error === 'no fort loaded', 'readSnapshot returns the shared guard');
  assert(read?.code === 'NO_FORT', `tagged with the NO_FORT code (got ${read?.code})`);

  await snapshotCmd('stop');
  closeConnection();
  console.log(failures ? `\n${failures} check(s) failed\n` : '\nall no-fort checks passed\n');
  process.exit(failures ? 1 : 0);
}

section(1, 'the script loads and reports its production defaults');
await snapshotCmd('stop');
const ent = await snapshotCmd('status');
assert(ent.slice === 16, `entity slice is 16 (got ${ent.slice})`);
assert(ent.cadence === 600, `entity cadence is 600 frames (got ${ent.cadence})`);
assert(
  ent.classes === ENTITY_CLASSES.join(','),
  `entity classes are ${ENTITY_CLASSES.join(',')} (got ${ent.classes})`
);
const map = await snapshotCmd('status_map');
assert(map.slice === 32, `census slice is 32 (got ${map.slice})`);
assert(map.cadence === 6000, `census cadence is 6000 frames (got ${map.cadence})`);
assert(map.classes === 'census', `census class is census (got ${map.classes})`);
assert(ent.running === false && map.running === false, 'both walkers are stopped after stop');

section(2, 'the resident rpc module answers without a script lookup');
const seqs = await rpc('seqs');
assert(!!seqs.entities && !!seqs.map, 'rpc.mcp_snapshot seqs reports both walkers');

section(3, 'autostart brings both walkers up and is idempotent');
const first = await snapshotCmd('autostart');
assert(first.entities.running && first.map.running, 'both walkers run after autostart');
const stepsBefore = (await snapshotCmd('status')).steps;
await snapshotCmd('autostart');
await sleep(1500);
const stepsAfter = (await snapshotCmd('status')).steps;
assert(
  stepsAfter > stepsBefore,
  `the walk kept stepping across a second autostart (${stepsBefore} -> ${stepsAfter})`
);

section(4, 'the entity walker publishes every class');
const ready = await waitFor(async () => {
  const s = await rpc('seqs');
  return s.entities.ready ? s.entities : null;
}, 180_000);
if (!ready) {
  assert(false, 'the entity walker never became ready within 180 s');
} else {
  assert(true, `entities ready at seq ${ready.seq}`);
  const snap = await rpc('entities');
  for (const cls of ENTITY_CLASSES) {
    assert(
      Array.isArray(snap[cls]) && snap[cls].length > 0,
      `${cls}: ${snap[cls]?.length} records`
    );
  }
  const broken = ENTITY_CLASSES.flatMap((cls) =>
    (snap[cls] ?? []).filter((r) => r.error).map((r) => `${cls}#${r.id}: ${r.error}`)
  );
  assert(broken.length === 0, `no per-record errors across every class (${broken.length})`);
  for (const b of broken.slice(0, 5)) console.log(`      ${b}`);
  assert(
    snap.units.every((u) => Object.hasOwn(u, 'hidden')),
    'every unit carries a fog verdict from the shared gate'
  );
  console.log(
    `      pass: ${snap.walk?.wall_ms} ms wall, ${snap.walk?.steps} steps, ` +
      `max step ${snap.walk?.max_step_wall_ms} ms`
  );
  for (const [cls, s] of Object.entries(snap.walk?.classes ?? {})) {
    console.log(`      ${cls}: n=${s.n} ${s.kb?.toFixed(1)} KB ${s.wall_ms} ms`);
  }
}

section(5, 'the census publishes a whole-map snapshot');
const mapReady = await waitFor(async () => {
  const s = await rpc('seqs');
  return s.map.ready ? s.map : null;
}, 300_000);
if (!mapReady) {
  assert(false, 'the census never became ready within 300 s');
} else {
  const census = (await rpc('map')).census;
  assert(census?.levels?.length > 0, `revealed z-levels: ${census?.levels?.length}`);
  assert(census?.columns?.length > 0, `columns: ${census?.columns?.join(',')}`);
  assert(
    typeof census?.surface_hex === 'string',
    `surface map: ${census.surface_hex.length / 2} columns`
  );
  assert(Array.isArray(census?.stairs), `stairs located: ${census?.stairs?.length}`);
  assert(
    typeof census?.extents?.x === 'number',
    `extents ${census?.extents?.x}x${census?.extents?.y}x${census?.extents?.z}`
  );
}

section(6, 'a completed pass advances seq');
const before = (await rpc('seqs')).entities.seq;
const grown = await waitFor(async () => {
  const now = (await rpc('seqs')).entities.seq;
  return now > before ? now : null;
}, 120_000);
assert(grown !== null, grown ? `seq ${before} -> ${grown}` : 'seq never advanced within 120 s');

const parity = PARITY_SPECS.find((spec) => spec.tool === 'find_unit');
const paused = (await runLua('print(tostring(df.global.pause_state))')).trim() === 'true';
section(
  7,
  `find_unit from the snapshot vs the live Lua query (fort ${paused ? 'paused' : 'running'})`
);
const published = await rpc('entities');
const snap = {
  ...published,
  age_ms: (await rpc('seqs')).entities.now_ms - published.captured_at_ms,
};
console.log(`      snapshot age at comparison: ${(snap.age_ms / 1000).toFixed(1)} s`);

for (const args of parity.calls) {
  const live = await findUnit(args.query, 'live');
  const projected = projectFindUnit(snap, args.query);
  const { failures, drift } = compareParity(parity, live, projected, { paused });
  assert(
    failures.length === 0,
    `"${args.query}": ${paused ? 'deep-equal to the live query' : 'identity spine matches'} ` +
      `(${live.match_count} matches)`
  );
  for (const line of failures) console.log(`      ${line}`);
  for (const line of drift) console.log(`      drift: ${line}`);
}

section(8, 'tune changes slice and cadence without restarting the pass');
const beforeTune = await snapshotCmd('status');
const tuned = await snapshotCmd('tune', '8', '1800');
assert(tuned.slice === 8, `slice retuned to 8 (got ${tuned.slice})`);
assert(tuned.cadence === 1800, `cadence retuned to 1800 (got ${tuned.cadence})`);
assert(tuned.cadence_configured === 1800, 'the configured cadence is what was asked for');
assert(tuned.seq === beforeTune.seq, `tuning published nothing new (seq ${tuned.seq})`);
assert(tuned.ready === beforeTune.ready, 'and did not clear the published snapshot');

const partial = await snapshotCmd('tune', '', '600');
assert(partial.cadence === 600 && partial.slice === 8, 'an empty slice leaves slice alone');
const mapTuned = await snapshotCmd('tune_map', '16', '12000');
assert(mapTuned.slice === 16 && mapTuned.cadence === 12000, 'tune_map retunes the census');
await snapshotCmd('tune', '16', '600');
await snapshotCmd('tune_map', '32', '6000');

section(9, 'the governor backs off under measured harm and restores on off');
const aggressive = await snapshotCmd('govern', 'on', '0.0001', '0.00001');
assert(aggressive.entities.governor, 'status reports the governor once enabled');
assert(aggressive.entities.governor.level === 0, 'it starts at level 0, the configured cadence');
assert(
  aggressive.entities.cadence === aggressive.entities.cadence_configured,
  'so the effective cadence starts equal to the configured one'
);

const backedOff = await waitFor(async () => {
  const s = await snapshotCmd('status');
  return s.governor?.level > 0 ? s : null;
}, 120_000);
if (!backedOff) {
  assert(false, 'the governor never backed off despite a 0.01% harm threshold');
} else {
  const g = backedOff.governor;
  assert(true, `backed off to level ${g.level} (x${g.multiplier.toFixed(2)})`);
  assert(
    backedOff.cadence > backedOff.cadence_configured,
    `effective cadence ${backedOff.cadence} stretched past the configured ${backedOff.cadence_configured}`
  );
  assert(
    backedOff.cadence_configured === 600,
    'and the configured cadence is left untouched, as the recovery target'
  );
  console.log(
    `      measured frame-time inflation while walking: ${(g.inflation * 100).toFixed(1)}%`
  );
}

const off = await snapshotCmd('govern', 'off');
assert(!off.entities.governor, 'turning it off drops it from status');
assert(
  off.entities.cadence === off.entities.cadence_configured,
  `and restores the configured cadence (${off.entities.cadence})`
);
assert(
  off.map.cadence === off.map.cadence_configured,
  `and the census cadence too (${off.map.cadence})`
);

const afterTune = await snapshotCmd('tune', '', '600');
assert(
  afterTune.cadence === 600 && !afterTune.governor,
  `a tune after govern off keeps the configured cadence (got ${afterTune.cadence})`
);
const afterRestart = await snapshotCmd('start');
assert(
  afterRestart.cadence === afterRestart.cadence_configured,
  `and a restart does not resurrect the backoff (got ${afterRestart.cadence})`
);

section(10, 'stop halts both walkers');
await snapshotCmd('stop');
const stopped = await rpc('seqs');
assert(!stopped.entities.running && !stopped.map.running, 'both walkers report stopped');
const idle = (await snapshotCmd('status')).steps;
await sleep(1500);
assert((await snapshotCmd('status')).steps === idle, `no stepping after stop (${idle})`);

closeConnection();
console.log(failures ? `\n${failures} check(s) failed\n` : '\nall snapshot checks passed\n');
process.exit(failures ? 1 : 0);

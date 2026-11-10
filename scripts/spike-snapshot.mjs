import { deepStrictEqual } from 'node:assert';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { runLua, runScript, closeConnection } from '../src/dfclient.ts';
import { projectFindUnit } from '../src/tools/findUnit.ts';

const SLICES = (process.env.SPIKE_SLICES ?? '1,4,8,16,32,64,0').split(',').map(Number);
const CADENCE = process.env.SPIKE_CADENCE ?? '30';
const WINDOW_MS = Number(process.env.SPIKE_WINDOW_MS ?? 4000);
const QUERIES = ['a', 'e', 'urist', 'miner', 'doctor', 'commander', 'zzzz'];

const pub = async (...args) => JSON.parse((await runScript('snapshot', args)).trim());
const f = (n, d = 2) => Number(n).toFixed(d);
const normalize = (r) => ({ ...r, matches: Array.isArray(r.matches) ? r.matches : [] });

async function luaCost() {
  await runLua('dfhack.internal.resetPerfCounters(true)');
  await sleep(WINDOW_MS);
  const p = JSON.parse(
    (
      await runLua(
        "print(require('json').encode(dfhack.internal.getPerfCounters(),{pretty=false}))"
      )
    ).trim()
  );
  const fps = Number((await runLua('print(df.global.enabler.calculated_fps)')).trim());
  return {
    per_frame: p.update_lua_ms / ((p.elapsed_ms / 1000) * fps),
    per_s: (p.update_lua_ms / p.elapsed_ms) * 1000,
  };
}

async function waitForSeq(min) {
  for (let i = 0; i < 600; i++) {
    const s = await pub('status');
    if (s.seq >= min) return s;
    await sleep(100);
  }
  throw new Error(`publisher never reached seq ${min}`);
}

async function freeze(label, work) {
  await pub('gap', 'start');
  await sleep(200);
  const t0 = performance.now();
  await work();
  const client = performance.now() - t0;
  const g = await pub('gap');
  console.log(
    `  ${label.padEnd(44)} max frame gap ${String(g.max_gap_ms).padStart(4)} ms  ` +
      `gaps>50ms ${String(g.gaps_over_50ms).padStart(3)}  frames ${String(g.frames).padStart(4)}  ` +
      `client ${f(client, 0)} ms`
  );
}

const repeat = (n, fn) => async () => {
  for (let i = 0; i < n; i++) await fn();
};

try {
  await pub('stop');

  const bench = await pub('bench', '20');
  console.log(
    `encode: ${f(bench.us_per_unit, 1)} µs/unit (under suspend), ${bench.units} units, ` +
      `${(bench.bytes_per_walk / 1024).toFixed(1)} KB/walk`
  );

  console.log(`\npublisher cost by slice (cadence ${CADENCE} frames):`);
  console.log('  slice  frames/walk  walk_ms  begin_ms  max_step_ms  lua_ms/frame  lua_ms/s');
  for (const slice of SLICES) {
    const started = await pub('start', String(slice), CADENCE);
    await waitForSeq(started.seq + 2);
    const cost = await luaCost();
    const w = (await pub('get')).snapshot.walk;
    console.log(
      `  ${String(slice || 'all').padStart(5)}  ${String(w.steps).padStart(11)}  ` +
        `${String(w.wall_ms).padStart(7)}  ${String(w.begin_ms).padStart(8)}  ` +
        `${String(w.max_step_wall_ms).padStart(11)}  ${f(cost.per_frame, 3).padStart(12)}  ` +
        `${f(cost.per_s).padStart(8)}`
    );
  }
  await pub('stop');

  console.log('\nfreeze (longest gap between game frames while the work runs):');
  await freeze('idle, publisher off', () => sleep(3000));
  await pub('start', '8', CADENCE);
  await freeze(`idle, publisher slice 8 / cadence ${CADENCE}`, () => sleep(3000));
  await pub('start', '0', CADENCE);
  await freeze(`idle, publisher slice all / cadence ${CADENCE}`, () => sleep(3000));
  await pub('stop');
  await freeze(
    '20x find_unit via Lua',
    repeat(20, () => runScript('findUnit', ['zzzz']))
  );
  await freeze(
    '20x fort_status via Lua',
    repeat(20, () => runScript('fortStatus'))
  );
  await freeze(
    '5x stocks via Lua',
    repeat(5, () => runScript('stocks'))
  );
  await pub('start', '8', '300');
  await waitForSeq(1);
  await freeze(
    '20x snapshot read (publisher slice 8 / 300)',
    repeat(20, () => runScript('snapshot', ['get']))
  );

  const snap = (await pub('get')).snapshot;
  await pub('stop');
  await pub('gap', 'stop');

  console.log('\nparity, snapshot projection vs Lua find_unit:');
  let failures = 0;
  for (const q of QUERIES) {
    const lua = normalize(JSON.parse((await runScript('findUnit', [q])).trim()));
    try {
      deepStrictEqual(projectFindUnit(snap, q), lua);
      console.log(`  ${q.padEnd(10)} identical (${lua.match_count} matches)`);
    } catch (err) {
      failures++;
      console.log(`  ${q.padEnd(10)} DIFFERS\n${err.message.split('\n').slice(0, 30).join('\n')}`);
    }
  }
  process.exitCode = failures ? 1 : 0;
} finally {
  closeConnection();
}

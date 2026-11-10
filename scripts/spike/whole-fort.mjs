import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { runLua, runScript, closeConnection } from '../../src/dfclient.ts';

const pub = async (...a) => JSON.parse((await runScript('snapshot', a)).trim());
const lua = async (s) => (await runLua(s)).trim();
const ENTITIES = 'units,items,buildings,reports';

async function perfWindow(ms) {
  await pub('gap', 'start');
  await lua('dfhack.internal.resetPerfCounters(true)');
  await sleep(ms);
  const p = JSON.parse(
    await lua("print(require('json').encode(dfhack.internal.getPerfCounters(),{pretty=false}))")
  );
  const g = await pub('gap');
  const frames = g.frames || 1;
  return {
    lua_ms_per_frame: p.update_lua_ms / frames,
    lua_share: p.update_lua_ms / p.elapsed_ms,
    fps: frames / (g.window_ms / 1000),
    max_gap: g.max_gap_ms,
  };
}

async function untilSeq(seq, timeoutMs) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    const s = await pub('status');
    if (s.seq >= seq) return s;
    await sleep(250);
  }
  return null;
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

try {
  for (const slice of (process.env.SLICES ?? '8,32').split(',')) {
    const s0 = await pub('start', slice, '100000', ENTITIES);
    const t0 = performance.now();
    const cost = await perfWindow(3000);
    const done = await untilSeq(s0.seq + 1, 300_000);
    const walkMs = performance.now() - t0;
    const g0 = performance.now();
    const raw = await runScript('snapshot', ['get']);
    const getMs = performance.now() - g0;
    const snap = JSON.parse(raw.trim()).snapshot;
    console.log(
      `\nentities, slice ${slice}: walk ${(walkMs / 1000).toFixed(1)} s, ${snap.walk.steps} frames; ` +
        `Lua ${cost.lua_ms_per_frame.toFixed(2)} ms/frame (${pct(cost.lua_share)} of wall), ` +
        `${cost.fps.toFixed(0)} fps, max gap ${cost.max_gap} ms`
    );
    console.log(
      `  snapshot ${(raw.length / 1048576).toFixed(2)} MB, read in ${getMs.toFixed(0)} ms (client); done=${!!done}`
    );
    for (const [name, c] of Object.entries(snap.walk.classes)) {
      console.log(
        `  ${name.padEnd(10)} ${String(c.n).padStart(6)}  ${(c.kb / 1024).toFixed(2).padStart(6)} MB  ` +
          `${String(c.per_frame).padStart(3)}/frame  ${String(c.steps).padStart(5)} frames  ${c.wall_ms} ms`
      );
    }
    const g1 = performance.now();
    await lua(
      'local s = dfhack.mcp_snapshot_state.walkers.entities.latest ' +
        'local t0 = dfhack.getTickCount() for i = 1, 20 do local _ = #s end ' +
        'print(dfhack.getTickCount() - t0)'
    );
    console.log(
      `  (direct state access via runLua: ${(performance.now() - g1).toFixed(0)} ms client)`
    );
  }

  for (const slice of (process.env.BLOCK_SLICES ?? '8,40').split(',')) {
    await pub('start', slice, '100000', 'blocks');
    await sleep(500);
    const a = (await pub('status')).progress;
    const t0 = performance.now();
    const cost = await perfWindow(10_000);
    const b = (await pub('status')).progress;
    const rate = (b.done - a.done) / ((performance.now() - t0) / 1000);
    console.log(
      `\nblocks, slice ${slice} (${Math.max(1, Math.floor((slice * 95) / 476))}/frame): ` +
        `${rate.toFixed(0)} blocks/s, full map ${(b.total / rate / 60).toFixed(1)} min; ` +
        `Lua ${cost.lua_ms_per_frame.toFixed(2)} ms/frame (${pct(cost.lua_share)} of wall), ` +
        `${cost.fps.toFixed(0)} fps, max gap ${cost.max_gap} ms`
    );
  }
  await pub('stop');
  await pub('gap', 'stop');
} finally {
  closeConnection();
}

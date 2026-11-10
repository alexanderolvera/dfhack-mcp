// Walker cost on a live fort, at the production defaults and around them (#145).
// Run with the fort UNPAUSED; main-thread Lua time is the number that matters.
//   npm run bench:snapshot                     (WINDOW_MS=45000 per config)
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { runLua, runScript, closeConnection } from '../src/dfclient.ts';

const pub = async (...a) => JSON.parse((await runScript('snapshot', a)).trim());
const lua = async (s) => (await runLua(s)).trim();
const WINDOW = Number(process.env.WINDOW_MS ?? 45_000);
const STATE = 'dfhack.mcp_snapshot_state.walkers';

async function windowStats() {
  await pub('gap', 'start');
  await lua('dfhack.internal.resetPerfCounters(true)');
  const fps = [];
  for (let t = 0; t < WINDOW; t += 3000) {
    await sleep(3000);
    fps.push(Number(await lua('print(df.global.enabler.calculated_fps)')));
  }
  const p = JSON.parse(
    await lua("print(require('json').encode(dfhack.internal.getPerfCounters(),{pretty=false}))")
  );
  const g = await pub('gap');
  return {
    fps_min: Math.min(...fps),
    fps_avg: fps.reduce((a, b) => a + b, 0) / fps.length,
    lua_ms_s: (p.update_lua_ms / p.elapsed_ms) * 1000,
    total_update_ms_s: (p.total_update_ms / p.elapsed_ms) * 1000,
    max_gap: g.max_gap_ms,
    over50: g.gaps_over_50ms,
    frames_s: g.frames / (g.window_ms / 1000),
  };
}

// Per-frame cost at 100 FPS: 1 ms/frame is 10% of a 10 ms frame.
const perFrame = (lua_ms_s, frames_s) => (frames_s > 0 ? lua_ms_s / frames_s : 0);

const CONFIGS = [
  { label: 'publisher off', ent: null, map: null },
  { label: 'entities 16/600', ent: ['16', '600'], map: null },
  { label: 'census 32/6000', ent: null, map: ['32', '6000'] },
  { label: 'BOTH — defaults', ent: ['16', '600'], map: ['32', '6000'] },
  { label: 'both, gentler', ent: ['8', '1800'], map: ['16', '12000'] },
  { label: 'publisher off (again)', ent: null, map: null },
];

async function apply({ ent, map }) {
  await pub('stop');
  if (ent) await pub('start', ent[0], ent[1], 'units,items,buildings,reports');
  if (map) await pub('start_map', map[0], map[1]);
}

async function fortSize() {
  return lua(`
    local m = df.global.world.map
    print(string.format('%dx%dx%d, %d blocks, %d units, %d items, %d buildings',
      m.x_count, m.y_count, m.z_count,
      #m.map_blocks, #df.global.world.units.active,
      #df.global.world.items.all, #df.global.world.buildings.all))`);
}

try {
  console.log('\nfort: ' + (await fortSize()));
  console.log('paused: ' + (await lua('print(tostring(df.global.pause_state))')));

  console.log(`\n== cost by config (${WINDOW / 1000} s steady-state window each) ==`);
  console.log(
    'config                 fps_avg fps_min  frames/s  lua_ms/s  ms/frame  %main  dfhack_ms/s  max_gap  >50ms'
  );
  const rows = [];
  for (const config of CONFIGS) {
    await apply(config);
    const r = await windowStats();
    const mspf = perFrame(r.lua_ms_s, r.frames_s);
    rows.push({ label: config.label, ...r, mspf });
    console.log(
      `${config.label.padEnd(22)} ${r.fps_avg.toFixed(1).padStart(7)} ${String(r.fps_min).padStart(7)}` +
        `  ${r.frames_s.toFixed(0).padStart(8)}  ${r.lua_ms_s.toFixed(1).padStart(8)}` +
        `  ${mspf.toFixed(2).padStart(8)}  ${(mspf * 10).toFixed(1).padStart(5)}%` +
        `  ${r.total_update_ms_s.toFixed(1).padStart(11)}  ${String(r.max_gap).padStart(7)}  ${String(r.over50).padStart(5)}`
    );
  }
  const base = rows[0];
  console.log('\n== cost attributable to the publisher (vs the first baseline) ==');
  for (const r of rows.slice(1)) {
    console.log(
      `${r.label.padEnd(22)} +${(r.lua_ms_s - base.lua_ms_s).toFixed(1).padStart(5)} lua_ms/s` +
        `  +${((r.mspf - base.mspf) * 10).toFixed(1).padStart(4)}% of main thread` +
        `  fps ${(r.fps_avg - base.fps_avg).toFixed(1).padStart(5)}`
    );
  }

  console.log('\n== one complete pass at the defaults ==');
  await apply(CONFIGS[3]);
  for (const walker of ['entities', 'map']) {
    const sub = walker === 'map' ? 'status_map' : 'status';
    const deadline = Date.now() + 300_000;
    while (!(await pub(sub)).ready && Date.now() < deadline) await sleep(2000);
    const stats = await lua(`
      local w = ${STATE}.${walker}
      if not w.latest or w.latest:find('no fort') then print('(not published yet)') return end
      local s = require('json').decode(w.latest).walk
      print(string.format('${walker}: %d ms wall, %d steps, max step %d ms', s.wall_ms, s.steps, s.max_step_wall_ms))
      if s.classes then
        for name, c in pairs(s.classes) do
          print(string.format('   %-10s n=%-6d %8.1f KB %6d ms', name, c.n, c.kb, c.wall_ms))
        end
      end`);
    console.log(stats);
  }

  console.log('\n== staleness: snapshot vs the live game, by age (defaults) ==');
  console.log('age_ms  units  pos_changed  job_changed  dead_changed');
  for (let i = 0; i < 10; i++) {
    console.log(
      await lua(`
      local w = ${STATE}.entities
      if not w.latest then print('(not published yet)') return end
      local snap = require('json').decode(w.latest)
      local n, pos, job, dead = 0, 0, 0, 0
      for _, su in ipairs(snap.units or {}) do
        local u = su.id and df.unit.find(su.id)
        if u and su.pos then
          n = n + 1
          if u.pos.x ~= su.pos.x or u.pos.y ~= su.pos.y or u.pos.z ~= su.pos.z then pos = pos + 1 end
          local cj = u.job.current_job
          local jt = cj and (df.job_type[cj.job_type] or tostring(cj.job_type)) or nil
          if jt ~= su.job_type then job = job + 1 end
          if dfhack.units.isDead(u) ~= su.dead then dead = dead + 1 end
        end
      end
      if n == 0 then print('(no comparable units)') return end
      print(string.format('%6d  %5d  %10.0f%%  %10.0f%%  %12d',
        dfhack.getTickCount() - snap.captured_at_ms, n, 100*pos/n, 100*job/n, dead))`)
    );
    await sleep(2000);
  }

  await pub('stop');
  await pub('gap', 'stop');
  console.log('\nwalkers stopped.\n');
} finally {
  closeConnection();
}

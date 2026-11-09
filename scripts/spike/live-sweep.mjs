import { setTimeout as sleep } from 'node:timers/promises';
import { runLua, runScript, closeConnection } from '../../src/dfclient.ts';

const pub = async (...a) => JSON.parse((await runScript('snapshot', a)).trim());
const lua = async (s) => (await runLua(s)).trim();
const WINDOW = Number(process.env.WINDOW_MS ?? 10000);

async function windowStats() {
  await pub('gap', 'start');
  await lua('dfhack.internal.resetPerfCounters(true)');
  const fps = [];
  for (let t = 0; t < WINDOW; t += 2000) {
    await sleep(2000);
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

async function waitWalk() {
  const s0 = await pub('status');
  for (let i = 0; i < 300; i++) {
    if ((await pub('status')).seq > s0.seq) return;
    await sleep(100);
  }
}

try {
  console.log('\n== cadence sweep (window ' + WINDOW / 1000 + ' s each) ==');
  console.log(
    'config            fps_avg fps_min  frames/s  lua_ms/s  dfhack_update_ms/s  max_gap  gaps>50'
  );
  const configs = [
    ['off'],
    ['8', '30'],
    ['8', '300'],
    ['8', '600'],
    ['4', '300'],
    ['16', '300'],
    ['off'],
  ];
  for (const c of configs) {
    if (c[0] === 'off') await pub('stop');
    else {
      await pub('start', ...c);
      await waitWalk();
    }
    const r = await windowStats();
    const label = c[0] === 'off' ? 'publisher off' : `slice ${c[0]} / ${c[1]}f`;
    console.log(
      `${label.padEnd(17)} ${r.fps_avg.toFixed(1).padStart(7)} ${String(r.fps_min).padStart(7)}  ${r.frames_s.toFixed(0).padStart(8)}  ${r.lua_ms_s.toFixed(1).padStart(8)}  ${r.total_update_ms_s.toFixed(1).padStart(18)}  ${String(r.max_gap).padStart(7)}  ${String(r.over50).padStart(7)}`
    );
  }

  console.log('\n== game time per read (in-game loop, avg) ==');
  await pub('start', '8', '300');
  await waitWalk();
  console.log(
    await lua(`
    local rows = {{'find_unit a',20,'mcp_findUnit','a'},{'fort_status',20,'mcp_fortStatus'},{'military',10,'mcp_military'},
      {'citizen',10,'mcp_citizen', tostring(dfhack.units.getCitizens(true)[1].id)},{'stocks',10,'mcp_stocks'},
      {'jobs_and_labor',10,'mcp_jobsAndLabor'},{'threats',10,'mcp_threats'},{'unmet_needs',10,'mcp_unmetNeeds'},
      {'snapshot get',50,'mcp_snapshot','get'}}
    for _, r in ipairs(rows) do
      local t0, out = dfhack.getTickCount()
      for i = 1, r[2] do out = dfhack.run_command_silent(table.unpack(r, 3)) end
      print(string.format('%-16s %7.1f ms/call %8.1f KB', r[1], (dfhack.getTickCount() - t0) / r[2], #out / 1024))
    end`)
  );

  console.log('\n== staleness: snapshot vs live game, by snapshot age (slice 8 / 600f) ==');
  await pub('start', '8', '600');
  await waitWalk();
  console.log('age_ms  units  pos_changed  job_changed  dead_changed');
  for (let i = 0; i < 12; i++) {
    console.log(
      await lua(`
      local m = reqscript('mcp_snapshot')
      local snap = require('json').decode(m.state.latest)
      local n, pos, job, dead = 0, 0, 0, 0
      for _, su in ipairs(snap.units) do
        local u = df.unit.find(su.id)
        if u then
          n = n + 1
          if u.pos.x ~= su.pos.x or u.pos.y ~= su.pos.y or u.pos.z ~= su.pos.z then pos = pos + 1 end
          local cj = u.job.current_job
          local jt = cj and (df.job_type[cj.job_type] or tostring(cj.job_type)) or nil
          if jt ~= su.job_type then job = job + 1 end
          if dfhack.units.isDead(u) ~= su.dead then dead = dead + 1 end
        end
      end
      print(string.format('%6d  %5d  %10.0f%%  %10.0f%%  %12d', dfhack.getTickCount() - snap.captured_at_ms, n, 100*pos/n, 100*job/n, dead))`)
    );
    await sleep(1500);
  }
  await pub('stop');
  await pub('gap', 'stop');
} finally {
  closeConnection();
}

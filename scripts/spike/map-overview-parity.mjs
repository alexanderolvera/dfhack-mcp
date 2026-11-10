import { deepStrictEqual } from 'node:assert';
import { performance } from 'node:perf_hooks';
import { runScript, closeConnection } from '../../src/dfclient.ts';
import { runJsonScript } from '../../src/query.ts';
import { readMapSnapshot, readSnapshot } from '../../src/snapshot.ts';
import { projectMapOverview } from '../../src/tools/mapOverview.ts';

const normalize = (d) => ({
  ...d,
  stair_columns: Array.isArray(d.stair_columns) ? d.stair_columns : [],
  activity: Object.fromEntries(
    Object.entries(d.activity ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v : []])
  ),
  surface_z_at_core: d.surface_z_at_core ?? null,
  fort_core: d.fort_core ?? null,
});

try {
  await runScript('snapshot', ['stop']);
  const t0 = performance.now();
  const map = await readMapSnapshot();
  const snap = await readSnapshot();
  console.log(`cold census + entities ready in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  if ('error' in map || 'error' in snap) throw new Error(JSON.stringify(map.error ? map : snap));
  const c = map.census;
  console.log(
    `census: ${c.stairs.length} stair tiles, surface map ${c.surface_hex.length / 2} columns, ` +
      `digging_z ${JSON.stringify(c.digging_z)}, construction_z ${JSON.stringify(c.construction_z)}, ` +
      `map snapshot ${(JSON.stringify(map).length / 1024).toFixed(1)} KB`
  );

  const lt = [];
  let lua;
  for (let i = 0; i < 5; i++) {
    const a = performance.now();
    lua = normalize(await runJsonScript('mapOverview', [], ['stair_columns']));
    lt.push(performance.now() - a);
  }
  const pt = [];
  let projected;
  for (let i = 0; i < 5; i++) {
    const a = performance.now();
    const m = await readMapSnapshot();
    const s = await readSnapshot();
    projected = projectMapOverview(m, s);
    pt.push(performance.now() - a);
  }
  const med = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1].toFixed(0);
  console.log(`Lua map_overview: median ${med(lt)} ms per call (game frozen for the walk)`);
  console.log(`snapshot projection: median ${med(pt)} ms per call (two status checks + TS)`);

  try {
    deepStrictEqual(projected, lua);
    console.log('parity: identical');
  } catch (err) {
    console.log('parity: DIFFERS\n' + err.message.split('\n').slice(0, 40).join('\n'));
    process.exitCode = 1;
  }
  console.log('projected:', JSON.stringify(projected).slice(0, 400));
} finally {
  await runScript('snapshot', ['stop']);
  closeConnection();
}

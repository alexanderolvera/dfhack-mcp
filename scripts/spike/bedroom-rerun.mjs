import { performance } from 'node:perf_hooks';
import { fileURLToPath, URL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const entry = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => typeof v === 'string')
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  env: { ...env, DFHACK_MCP_SNAPSHOT: '1', DFHACK_PORT: process.env.DFHACK_PORT ?? '5000' },
});
const client = new Client({ name: 'bedroom-rerun', version: '0.0.0' });
await client.connect(transport);

const ledger = [];
async function call(label, name, args = {}) {
  const t0 = performance.now();
  const res = await client.callTool({ name, arguments: args });
  const ms = performance.now() - t0;
  const text = res.content.map((c) => c.text ?? '').join('');
  ledger.push({ label, name, bytes: text.length, ms });
  return JSON.parse(text);
}

const warm = performance.now();
await call('warm-up (starts walkers, waits for first map census)', 'z_levels');
const warmMs = performance.now() - warm;
ledger.length = 0;

const levels = await call('1. where is everything?', 'z_levels');
const bedroomsByZ = await call('2. where are the bedrooms?', 'snapshot_query', {
  class: 'buildings',
  where: { zone_type: 'Bedroom' },
  group_by: ['z'],
});
const unowned = await call('3. unowned bedrooms', 'snapshot_query', {
  class: 'buildings',
  where: { zone_type: 'Bedroom', owner: { exists: false } },
  fields: ['id', 'x1', 'y1', 'x2', 'y2', 'z'],
});
const citizens = await call('4. how many citizens?', 'snapshot_query', {
  class: 'units',
  where: { citizen: true, dead: false },
  count_only: true,
});
const furniture = await call('5. free furniture', 'snapshot_query', {
  class: 'items',
  where: {
    type: { in: ['BED', 'DOOR', 'CABINET', 'BOX'] },
    in_building: false,
    forbid: false,
    construction: false,
    in_job: false,
  },
  group_by: ['type'],
});
const boulders = await call('6. stone for masons', 'snapshot_query', {
  class: 'items',
  where: { type: 'BOULDER', forbid: false, in_job: false },
  group_by: ['material'],
});
const overview = await call('7. stair columns', 'map_overview');
const site = await call('8. confirm the site', 'tile_region', {
  z: 136,
  x0: 60,
  y0: 107,
  x1: 89,
  y1: 136,
});

const cols = levels.columns;
const col = (n) => cols.indexOf(n);
console.log(`warm-up: ${(warmMs / 1000).toFixed(1)} s (first call only)\n`);
console.log('z_levels rows (z, revealed, floor+stair+ramp dug, citizens, bedrooms, unowned):');
for (const r of levels.levels.slice(0, 41)) {
  const dug = r[col('floor')] + r[col('stair')] + r[col('ramp')];
  if (r[col('revealed')] < 20 || r[col('bedrooms')] || r[col('citizens')] || dug > 50) {
    console.log(
      `  z${r[0]}  revealed ${r[col('revealed')]}  dug ${dug}  citizens ${r[col('citizens')]}  ` +
        `bedrooms ${r[col('bedrooms')]}  unowned ${r[col('bedrooms_unowned')]}`
    );
  }
}
console.log(`  unrevealed: ${JSON.stringify(levels.unrevealed_z)}`);
console.log('\nbedrooms by z:', JSON.stringify(bedroomsByZ.groups));
console.log('unowned bedrooms:', unowned.matched, JSON.stringify(unowned.rows));
console.log('citizens:', citizens.matched);
console.log('free furniture:', JSON.stringify(furniture.groups));
console.log(
  'boulders by material:',
  JSON.stringify(boulders.groups.slice(0, 6)),
  `(${boulders.groups.length} materials)`
);
console.log(
  'stairs:',
  JSON.stringify(overview.stair_columns?.slice(0, 2)),
  '... z136 hidden tiles',
  site.hidden_tiles
);

console.log('\nledger:');
let bytes = 0;
let ms = 0;
for (const l of ledger) {
  bytes += l.bytes;
  ms += l.ms;
  console.log(
    `  ${l.label.padEnd(26)} ${l.name.padEnd(15)} ${String(l.bytes).padStart(6)} B  ${l.ms.toFixed(0).padStart(5)} ms`
  );
}
console.log(
  `  ${'TOTAL'.padEnd(42)} ${String(bytes).padStart(6)} B  ${ms.toFixed(0).padStart(5)} ms, ${ledger.length} calls`
);
await client.close();

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { stripVTControlCharacters } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { INVARIANTS } from '../test/invariants.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (key, fallback) =>
  (argv.find((a) => a.startsWith(`--${key}=`)) ?? `=${fallback}`).split('=')[1];
const NAME = opt('name', 'df-trade-caravan');
const PORT = opt('port', '5011');
const IMAGE = opt('image', 'df-headless:53.15');
const KEEP = argv.includes('--keep');
const DEADLINE = Date.now() + Number(opt('timeout-min', '15')) * 60_000;
const TIME_REMAINING_PER_DAY = 120;
const TRADE_SPECS = INVARIANTS.filter((i) => i.tools.length === 1 && i.tools[0] === 'trade');

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  failures++;
  console.log(`  ✗ FAIL: ${msg}`);
};
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const dfhack = (...args) =>
  stripVTControlCharacters(docker('exec', '-w', '/opt/df', NAME, '/opt/df/dfhack-run', ...args))
    .split('\n')
    .filter((l) => l && !l.includes('locale::facet'))
    .join('\n')
    .trim();
const lua = (code) => dfhack('lua', code);
const removeContainer = () => {
  try {
    docker('rm', '-f', NAME);
  } catch {
    // Nothing to remove.
  }
};

const CARAVAN_PROBE =
  'local c = df.global.plotinfo.caravans[0] ' +
  "if not c then print('none') return end " +
  "print(df.caravan_state.T_trade_state[c.trade_state] .. ' ' .. c.time_remaining .. ' ' .. c.import_value)";

function caravanFacts() {
  const out = lua(CARAVAN_PROBE);
  if (out === 'none') return null;
  const [state, timeRemaining, importValue] = out.split(/\s+/);
  return { state, timeRemaining: Number(timeRemaining), importValue: Number(importValue) };
}

async function waitFor(label, pred, everyMs = 2000) {
  while (Date.now() < DEADLINE) {
    try {
      const v = pred();
      if (v) return v;
    } catch {
      // DFHack's RPC isn't up yet while the container boots; keep polling.
    }
    await pause(everyMs);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, 'src', 'index.ts')],
    env: {
      ...process.env,
      DFHACK_HOST: '127.0.0.1',
      DFHACK_PORT: PORT,
      DFHACK_MCP_QUERY_DIR: '/opt/df/mcp-queries',
    },
    cwd: ROOT,
  });
  const client = new Client({ name: 'dfhack-mcp-verify-trade-caravan', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function callTrade(client) {
  const res = await client.callTool({ name: 'trade', arguments: {} });
  const text = res.content?.find((p) => p.type === 'text')?.text ?? '';
  return JSON.parse(text);
}

async function checkState(client, state) {
  lua('df.global.pause_state = true');
  const facts = caravanFacts();
  const trade = await callTrade(client);
  console.log(
    `\n${state} (time_remaining=${facts?.timeRemaining}, import_value=${facts?.importValue})`
  );
  for (const spec of TRADE_SPECS) {
    const problems = spec.check({ trade });
    if (problems.length) for (const m of problems) fail(`${spec.name}: ${m}`);
    else ok(spec.name);
  }
  const row = trade.caravans?.[0];
  check(trade.caravan_count === 1 && row?.state === state, `one caravan row in state ${state}`);
  if (!row) return;
  const expectedDays =
    state === 'Leaving' ? undefined : Math.floor(facts.timeRemaining / TIME_REMAINING_PER_DAY);
  check(
    row.leaving_in_days === expectedDays,
    `leaving_in_days=${row.leaving_in_days} (expected ${expectedDays})`
  );
  check(
    row.manifest?.count > 0,
    `manifest lists the caravan's goods (count=${row.manifest?.count})`
  );
  check(
    row.manifest?.approx_value === facts.importValue,
    `manifest.approx_value=${row.manifest?.approx_value} equals caravan_state.import_value`
  );
  check(
    Array.isArray(row.agreements?.import) && row.agreements.import.length > 0,
    `agreements.import populated (${row.agreements?.import?.length} rows)`
  );
  if (state === 'AtDepot')
    check(
      trade.broker?.at_depot !== true,
      `AtDepot reports the broker away from the depot (broker.at_depot=${trade.broker?.at_depot}; the fixture broker never is)`
    );
  lua('df.global.pause_state = false');
}

console.log(`Forcing a caravan in scratch container ${NAME} on 127.0.0.1:${PORT}`);
removeContainer();
docker(
  'run',
  '-d',
  '--name',
  NAME,
  '--security-opt',
  'seccomp=unconfined',
  '-e',
  'TERM=xterm-256color',
  '-v',
  `${join(ROOT, 'src', 'dfhack-queries')}:/opt/df/mcp-queries:ro`,
  '-p',
  `127.0.0.1:${PORT}:5001`,
  IMAGE
);

let client;
try {
  await waitFor(
    'the fixture fort to load',
    () => lua('print(df.global.gamemode == df.game_mode.DWARF)') === 'true'
  );
  dfhack('force', 'Caravan');
  lua('df.global.pause_state = false');
  client = await connect();

  for (const state of ['Approaching', 'AtDepot', 'Leaving']) {
    await waitFor(`state ${state}`, () => caravanFacts()?.state === state, 1000);
    await checkState(client, state);
    if (state === 'AtDepot') lua('df.global.plotinfo.caravans[0].time_remaining = 60');
  }
} catch (e) {
  fail(e.message);
} finally {
  await client?.close();
  if (KEEP) console.log(`\nleft ${NAME} running (--keep); remove with: docker rm -f ${NAME}`);
  else removeContainer();
}

console.log(`\n${failures ? `✗ ${failures} failure(s)` : '✓ all checks passed'} (trade caravan)`);
process.exit(failures ? 1 : 0);

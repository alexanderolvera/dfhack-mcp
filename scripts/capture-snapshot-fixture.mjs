// Captures both walkers' published JSON from a running fort into off-game fixtures (#161).
//   DFHACK_PORT=5001 DFHACK_MCP_QUERY_DIR=/opt/df/mcp-queries \
//     node scripts/capture-snapshot-fixture.mjs --out test/fixtures/snapshot
// Restores the publisher to the state it was found in. See docs/snapshot.md.
import process from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { callLua, closeConnection, runScript } from '../src/dfclient.ts';

const WALKERS = ['entities', 'map'];
const DEFAULT_OUT = 'test/fixtures/snapshot';
const PASS_BUDGET_MS = Number(process.env.CAPTURE_BUDGET_MS ?? 600_000);

const argv = process.argv.slice(2);
const outIndex = argv.indexOf('--out');
const outDir = outIndex === -1 ? DEFAULT_OUT : argv[outIndex + 1];
if (!outDir) {
  console.error('--out needs a directory');
  process.exit(2);
}

async function snapshotCmd(...args) {
  const out = await runScript('snapshot', args);
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`mcp_snapshot ${args.join(' ')} returned non-JSON: ${out.slice(0, 300)}`);
  }
}

const rpc = async (fn) => JSON.parse((await callLua('rpc.mcp_snapshot', fn))[0]);

// The rpc module is registered by the script itself, so a cold DFHack needs one
// script call before callLua can resolve it (mirrors statuses() in src/snapshot.ts).
async function seqs() {
  try {
    return await rpc('seqs');
  } catch {
    await snapshotCmd('status');
    return await rpc('seqs');
  }
}

async function waitFor(predicate, budgetMs, pollMs = 1000) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const got = await predicate();
    if (got) return got;
    if (Date.now() > deadline) return null;
    await sleep(pollMs);
  }
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

const before = await seqs();
const wasRunning = { entities: before.entities.running, map: before.map.running };
console.log(
  `publisher found: entities running=${wasRunning.entities} map running=${wasRunning.map}`
);

async function restorePublisher() {
  if (wasRunning.entities && wasRunning.map) return;
  await snapshotCmd('stop');
  if (wasRunning.entities) {
    const e = before.entities;
    await snapshotCmd('start', String(e.slice), String(e.cadence_configured), e.classes);
  }
  if (wasRunning.map) {
    const m = before.map;
    await snapshotCmd('start_map', String(m.slice), String(m.cadence_configured));
  }
  console.log('  ○ publisher restored to the state it was found in');
}

const identity = JSON.parse(await runScript('gameState'));
if (identity.error) {
  fail(`game_state reports: ${identity.error} — capture needs a loaded fort`);
  closeConnection();
  process.exit(1);
}
console.log(
  `fort: ${identity.identity?.save_folder} on DF ${identity.df_version} / DFHack ${identity.dfhack_version}`
);

try {
  await snapshotCmd('autostart');
  console.log(`waiting for a complete pass on both walkers (budget ${PASS_BUDGET_MS} ms)…`);

  const ready = await waitFor(async () => {
    const s = await seqs();
    return WALKERS.every((w) => s[w].ready) ? s : null;
  }, PASS_BUDGET_MS);

  if (!ready) {
    fail(`no complete pass on both walkers within ${PASS_BUDGET_MS} ms (set CAPTURE_BUDGET_MS)`);
  } else {
    mkdirSync(outDir, { recursive: true });
    for (const walker of WALKERS) {
      const published = JSON.parse((await callLua('rpc.mcp_snapshot', walker))[0]);
      if (!published || published.error) {
        fail(`${walker}: publisher returned ${JSON.stringify(published)?.slice(0, 200)}`);
        continue;
      }
      const file = {
        fixture: {
          df_version: identity.df_version,
          dfhack_version: identity.dfhack_version,
          save_folder: identity.identity?.save_folder ?? 'unknown',
          captured_now_ms: ready[walker].now_ms,
          captured_by: 'scripts/capture-snapshot-fixture.mjs',
        },
        published,
      };
      const path = join(outDir, `${walker}.json`);
      writeFileSync(path, `${JSON.stringify(file)}\n`);
      const age = ready[walker].now_ms - published.captured_at_ms;
      console.log(`  wrote ${path} — seq ${published.seq}, age_ms ${age}`);
    }
  }
} finally {
  await restorePublisher();
  closeConnection();
}

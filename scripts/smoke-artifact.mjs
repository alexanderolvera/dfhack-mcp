#!/usr/bin/env node
// Clean-room artifact smoke test. Packs the tarball, installs it into a throwaway
// dir (so its deps resolve from the REGISTRY, not this repo's node_modules), boots
// the PREBUILT bundle, and asserts the MCP handshake + tool surface.
//
// This is the gate the src-based T0 tier can't be: verify.mjs launches
// `src/index.ts` under Node 24, but the thing we PUBLISH is `dist/index.js` run by
// whatever Node the user has. Running this under the engines floor (Node 20) in CI
// catches a broken dist or a Node-20 runtime regression before it reaches npm.
//
// Runnable locally too: `node scripts/smoke-artifact.mjs` (needs network for the
// registry install). Exit 0 = artifact is publishable; non-zero = do not publish.

import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = process.cwd();
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
const version = createRequire(import.meta.url)('../package.json').version;

// 1) Ensure a fresh dist, then pack WITHOUT re-running scripts so the tarball name
//    is the only thing we depend on (deterministic: dfhack-mcp-<version>.tgz).
run('npm run build', ROOT);
const room = mkdtempSync(join(tmpdir(), 'dfhack-mcp-smoke-'));
run(`npm pack --ignore-scripts --pack-destination "${room}"`, ROOT);
const tgz = join(room, `dfhack-mcp-${version}.tgz`);

try {
  // 2) Clean-room install: deps come from the registry only.
  writeFileSync(join(room, 'package.json'), JSON.stringify({ name: 'smoke', private: true }));
  run(`npm install "${tgz}"`, room);
  const bin = join(room, 'node_modules', 'dfhack-mcp', 'dist', 'index.js');

  // 3) Boot the INSTALLED bundle over MCP (actuators on → full 33-tool surface)
  //    and assert the handshake version + expected tools. Pin the gates
  //    explicitly — actuators ON, dev OFF — so the tool count is deterministic
  //    regardless of any DFHACK_MCP_* the caller happens to have in their shell
  //    (a stray DFHACK_MCP_DEV would register run_lua and blow the 33 assertion).
  const childEnv = { ...process.env, DFHACK_MCP_ACTUATORS: '1' };
  delete childEnv.DFHACK_MCP_DEV;
  const transport = new StdioClientTransport({
    command: 'node',
    args: [bin],
    env: childEnv,
  });
  const client = new Client({ name: 'smoke', version: '0' }, { capabilities: {} });
  await client.connect(transport);
  const handshakeVersion = client.getServerVersion?.()?.version;
  const { tools } = await client.listTools();
  await client.close();

  const names = new Set(tools.map((t) => t.name));
  const required = [
    'fort_status',
    'game_data',
    'work_order_list',
    'blueprint_apply',
    'assign_work_detail',
    'work_order_create',
  ];
  const missing = required.filter((n) => !names.has(n));
  const problems = [];
  if (handshakeVersion !== version)
    problems.push(`handshake version ${handshakeVersion} != package ${version}`);
  if (tools.length !== 33) problems.push(`expected 33 tools (actuators on), got ${tools.length}`);
  if (missing.length) problems.push(`missing tools: ${missing.join(', ')}`);

  if (problems.length) {
    console.error('✗ artifact smoke FAILED:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log(
    `✓ artifact smoke OK — installed dfhack-mcp@${handshakeVersion} boots ${tools.length} tools on ${process.version}`
  );
} finally {
  rmSync(room, { recursive: true, force: true });
}

#!/usr/bin/env node
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

run('npm run build', ROOT);
const room = mkdtempSync(join(tmpdir(), 'dfhack-mcp-smoke-'));
run(`npm pack --ignore-scripts --pack-destination "${room}"`, ROOT);
const tgz = join(room, `dfhack-mcp-${version}.tgz`);

try {
  writeFileSync(join(room, 'package.json'), JSON.stringify({ name: 'smoke', private: true }));
  run(`npm install "${tgz}"`, room);
  const bin = join(room, 'node_modules', 'dfhack-mcp', 'dist', 'index.js');

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
  if (tools.length !== 40) problems.push(`expected 40 tools (actuators on), got ${tools.length}`);
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

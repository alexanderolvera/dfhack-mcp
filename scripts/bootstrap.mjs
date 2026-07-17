// One-command bootstrap for the DFHack MCP server.
//   npm run bootstrap
//
// The dfhack-remote-node client is a published npm package (ships prebuilt), so
// "local" is just: right Node, install, contract-check. Idempotent — safe to
// re-run any time the tree feels off.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

function run(cmd, args, cwd) {
  console.log(`\n$ ${cmd} ${args.join(' ')}   (in ${cwd})`);
  // shell:true so `npm` finds npm.cmd on Windows.
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`\n✗ command failed (exit ${r.status}). See output above.`);
    process.exit(r.status ?? 1);
  }
}

// 1. Node version.
const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  console.error(`✗ Node ${process.versions.node} — this project pins Node 24 (see .nvmrc).`);
  process.exit(1);
}
console.log(`✓ Node ${process.versions.node}`);

// 2. install, 3. contract-check.
run('npm', ['ci'], ROOT);
run('npm', ['run', 'verify:t0'], ROOT);

console.log(
  `\n✓ bootstrap complete.\n` +
    `  Next: start DF with a fort loaded, then \`npm run verify:t1\` for live reachability.\n` +
    `  Working an issue in parallel? \`npm run worktree <branch>\` spins up an isolated tree.`
);

// One-command bootstrap for the DFHack MCP server.
//   npm run bootstrap
//
// The server depends on the sibling client via `file:../dfhack-remote-node`, so
// the client must be present and built before the server installs. This script
// makes "local" reproducible: it verifies the layout, builds the client, installs
// the server, and runs the T0 contract check. Idempotent — safe to re-run.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
// The `file:../dfhack-remote-node` specifier resolves relative to ROOT's parent.
const CLIENT = resolve(ROOT, '..', 'dfhack-remote-node');

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

// 2. Sibling client present.
if (!existsSync(CLIENT)) {
  console.error(
    `✗ client not found at ${CLIENT}\n` +
      `  The server needs the dfhack-remote client as a sibling. Clone it:\n` +
      `    git clone git@github.com:alexanderolvera/dfhack-remote-node.git "${CLIENT}"\n` +
      `  (On this Windows box a junction dfhack-remote-node -> dfhack-remote already stands in for it.)`
  );
  process.exit(1);
}
console.log(`✓ client at ${CLIENT}`);

// 3. Build the client first, 4. install the server, 5. contract-check.
run('npm', ['ci'], CLIENT);
run('npm', ['ci'], ROOT);
run('npm', ['run', 'verify:t0'], ROOT);

console.log(
  `\n✓ bootstrap complete.\n` +
    `  Next: start DF with a fort loaded, then \`npm run verify:t1\` for live reachability.\n` +
    `  Working an issue in parallel? \`npm run worktree <branch>\` spins up an isolated tree.`
);

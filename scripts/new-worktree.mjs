import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PARENT = resolve(ROOT, '..');

const branch = process.argv[2];
if (!branch) {
  console.error('usage: npm run worktree <branch>   (e.g. npm run worktree feat/moods)');
  process.exit(1);
}
// Dir-safe suffix: feat/moods -> feat-moods. The branch keeps its real name.
const slug = branch.replace(/[^\w.-]+/g, '-');
const wtPath = resolve(PARENT, `${basename(ROOT)}--${slug}`);

function run(cmd, args, cwd, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}   (in ${cwd})`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: true, ...opts });
  if (r.status !== 0 && !opts.allowFail) {
    console.error(`\n✗ command failed (exit ${r.status}). See output above.`);
    process.exit(r.status ?? 1);
  }
  return r.status;
}

if (existsSync(wtPath)) {
  console.error(`✗ worktree path already exists: ${wtPath}\n  Remove it or pick another branch.`);
  process.exit(1);
}

const exists =
  spawnSync('git', ['rev-parse', '--verify', branch], { cwd: ROOT, shell: true }).status === 0;
const addArgs = exists
  ? ['worktree', 'add', wtPath, branch]
  : ['worktree', 'add', wtPath, '-b', branch];
run('git', addArgs, ROOT);

// git worktrees don't share node_modules — each tree installs its own.
run('npm', ['ci'], wtPath);
run('npm', ['run', 'verify:t0'], wtPath);

console.log(
  `\n✓ worktree ready: ${wtPath}\n` +
    `  branch: ${branch}\n` +
    `  An agent can now work here in isolation. T0 passes; run \`npm run verify:t1\`\n` +
    `  against the live DF (one tree at a time) before opening a PR.\n` +
    `  Tear down when merged:  git worktree remove "${wtPath}"`
);

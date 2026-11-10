#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const DIR = 'src/dfhack-queries';
const COMPILERS = ['luac', 'luac5.4', 'luac5.3', 'luac5.2'];

const compiler = COMPILERS.find((c) => {
  const probe = spawnSync(c, ['-v'], { stdio: 'ignore' });
  return !probe.error;
});

if (!compiler) {
  console.log(`lua: no luac on PATH (tried ${COMPILERS.join(', ')}) — skipping syntax check`);
  process.exit(0);
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.lua'))
  .sort();

const broken = [];
for (const file of files) {
  try {
    execFileSync(compiler, ['-p', join(DIR, file)], { stdio: 'pipe' });
  } catch (err) {
    broken.push(`${file}: ${String(err.stderr ?? err.message).trim()}`);
  }
}

if (broken.length) {
  console.error(`lua: ${broken.length} of ${files.length} files failed to parse\n`);
  for (const line of broken) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`lua: ${files.length} query scripts parse (${compiler})`);

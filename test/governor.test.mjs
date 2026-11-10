import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const LAW = 'src/dfhack-queries/mcp_snapshotGovernor.lua';
const HARNESS = 'test/governor.lua';
const INTERPRETERS = ['lua', 'lua5.4', 'lua5.3'];

const lua = INTERPRETERS.find((bin) => !spawnSync(bin, ['-v'], { stdio: 'ignore' }).error);

test('the cadence-governor law behaves, run under standalone Lua', { skip: !lua && 'no lua on PATH' }, () => {
  let out;
  try {
    out = execFileSync(lua, [HARNESS, LAW], { encoding: 'utf8' });
  } catch (err) {
    assert.fail(`${HARNESS} failed:\n${err.stdout ?? ''}${err.stderr ?? ''}`);
  }
  assert.match(out, /all governor law checks passed/);
  assert.doesNotMatch(out, /^FAIL/m);
});

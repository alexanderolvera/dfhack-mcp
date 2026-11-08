// Unit tests for isGatedOff (src/register.ts) — the single predicate that both the
// server (index.ts, what gets registered) and verify.mjs (the expected tools/list)
// use to withhold gated tools. This exercises the gate branch directly (fast,
// no subprocess) so an inverted or ineffective gate is caught here rather than
// only surfacing in T0's live tools/list comparison.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGatedOff } from '../src/register.ts';

const plain = { name: 'fort_status' };
const dev = { name: 'run_lua', devOnly: true };
const actuator = { name: 'work_order_create', actuator: true };
const commands = { name: 'dfhack_command_run', commands: true };

test('plain read-only tools are never gated off', () => {
  assert.equal(isGatedOff(plain, {}), false);
  assert.equal(isGatedOff(plain, { DFHACK_MCP_DEV: '1', DFHACK_MCP_ACTUATORS: '1' }), false);
});

test('devOnly tools are gated off unless DFHACK_MCP_DEV is set', () => {
  assert.equal(isGatedOff(dev, {}), true);
  assert.equal(isGatedOff(dev, { DFHACK_MCP_DEV: '1' }), false);
  // the actuator gate must NOT accidentally enable a dev tool
  assert.equal(isGatedOff(dev, { DFHACK_MCP_ACTUATORS: '1' }), true);
});

test('actuator tools are gated off unless DFHACK_MCP_ACTUATORS is set', () => {
  assert.equal(isGatedOff(actuator, {}), true);
  assert.equal(isGatedOff(actuator, { DFHACK_MCP_ACTUATORS: '1' }), false);
  // the dev gate must NOT accidentally enable an actuator
  assert.equal(isGatedOff(actuator, { DFHACK_MCP_DEV: '1' }), true);
});

test('commands tools are gated off unless DFHACK_MCP_COMMANDS is set', () => {
  assert.equal(isGatedOff(commands, {}), true);
  assert.equal(isGatedOff(commands, { DFHACK_MCP_COMMANDS: '1' }), false);
  // neither the actuator nor the dev gate may enable the command runner
  assert.equal(isGatedOff(commands, { DFHACK_MCP_ACTUATORS: '1', DFHACK_MCP_DEV: '1' }), true);
  // and the commands gate must not enable actuators or dev tools
  assert.equal(isGatedOff(actuator, { DFHACK_MCP_COMMANDS: '1' }), true);
  assert.equal(isGatedOff(dev, { DFHACK_MCP_COMMANDS: '1' }), true);
});

test('the registry gates dfhack_command_run on DFHACK_MCP_COMMANDS alone and leaves dfhack_command_list open', async () => {
  const { ALL_TOOLS } = await import('../src/tools/registry.ts');
  const run = ALL_TOOLS.find((t) => t.name === 'dfhack_command_run');
  const list = ALL_TOOLS.find((t) => t.name === 'dfhack_command_list');
  assert.equal(isGatedOff(run, { DFHACK_MCP_ACTUATORS: '1', DFHACK_MCP_DEV: '1' }), true);
  assert.equal(isGatedOff(run, { DFHACK_MCP_COMMANDS: '1' }), false);
  assert.equal(isGatedOff(list, {}), false);
});

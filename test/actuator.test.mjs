// Unit tests for the §A0 actuator protocol (src/actuator.ts). No DFHack needed —
// plan()/apply() are stubbed, so this runs in CI and locks the dry-run → confirm
// → apply loop, single-use tokens, target-signature invalidation, blocking, and
// idempotent no-ops against regression. Run: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { defineActuator, _resetTokens } from '../src/actuator.ts';

// A minimal actuator whose plan/apply are driven by the args, so each test can
// steer the signature, blocked reasons, and noop flag without touching DF.
function makeTool(overrides = {}) {
  const applyCalls = { n: 0 };
  const def = defineActuator({
    name: overrides.name ?? 'test_actuator',
    title: 'Test',
    description: 'test',
    tokenPrefix: 'tk',
    shape: { target: z.string() },
    plan: async (args) => ({
      preview: { target: args.target },
      signature: overrides.signature ? overrides.signature(args) : `sig:${args.target}`,
      blocked: overrides.blocked ? overrides.blocked(args) : undefined,
      noop: overrides.noop ? overrides.noop(args) : undefined,
    }),
    apply: async (args) => {
      applyCalls.n += 1;
      return {
        changes: { target: args.target },
        undo: { handle: `undo:${args.target}` },
        readback: { seen: args.target },
      };
    },
  });
  return { run: def.run, applyCalls, def };
}

test('preview (no token) returns a confirm_token and does not apply', async () => {
  _resetTokens();
  const { run, applyCalls } = makeTool();
  const res = await run({ target: 'a' });
  assert.equal(res.mode, 'preview');
  assert.equal(res.applied, false);
  assert.match(res.confirm_token, /^tk-/);
  assert.deepEqual(res.preview, { target: 'a' });
  assert.equal(applyCalls.n, 0);
});

test('apply with a valid token applies exactly once and returns undo + readback', async () => {
  _resetTokens();
  const { run, applyCalls } = makeTool();
  const preview = await run({ target: 'a' });
  const res = await run({ target: 'a', confirm_token: preview.confirm_token });
  assert.equal(res.mode, 'apply');
  assert.equal(res.applied, true);
  assert.deepEqual(res.undo, { handle: 'undo:a' });
  assert.deepEqual(res.readback, { seen: 'a' });
  assert.equal(applyCalls.n, 1);
});

test('tokens are single-use: replaying the same token is rejected', async () => {
  _resetTokens();
  const { run, applyCalls } = makeTool();
  const preview = await run({ target: 'a' });
  await run({ target: 'a', confirm_token: preview.confirm_token });
  await assert.rejects(
    run({ target: 'a', confirm_token: preview.confirm_token }),
    /single-use|invalid or expired/
  );
  assert.equal(applyCalls.n, 1); // not doubled
});

test("a changed target signature voids the token (op's own targets moved)", async () => {
  _resetTokens();
  // signature is computed from a mutable external value the test flips between
  // preview and apply, simulating the operation's own target changing underneath.
  let state = 'v1';
  const { run, applyCalls } = makeTool({ signature: () => `sig:${state}` });
  const preview = await run({ target: 'a' });
  state = 'v2'; // target changed after preview
  await assert.rejects(
    run({ target: 'a', confirm_token: preview.confirm_token }),
    /targets changed|void/
  );
  assert.equal(applyCalls.n, 0);
});

test('an unrelated change (same signature) does NOT void the token', async () => {
  _resetTokens();
  const { run, applyCalls } = makeTool(); // signature depends only on args.target
  const preview = await run({ target: 'a' });
  const res = await run({ target: 'a', confirm_token: preview.confirm_token });
  assert.equal(res.applied, true);
  assert.equal(applyCalls.n, 1);
});

test('a blocked plan mints no token and surfaces the reasons', async () => {
  _resetTokens();
  const { run } = makeTool({ blocked: () => ['malformed CSV: cell A1'] });
  const res = await run({ target: 'a' });
  assert.equal(res.applied, false);
  assert.deepEqual(res.blocked, ['malformed CSV: cell A1']);
  assert.equal(res.confirm_token, undefined);
});

test('applying a token whose op became blocked is rejected', async () => {
  _resetTokens();
  let bad = false;
  const { run, applyCalls } = makeTool({ blocked: () => (bad ? ['now invalid'] : undefined) });
  const preview = await run({ target: 'a' });
  bad = true;
  await assert.rejects(run({ target: 'a', confirm_token: preview.confirm_token }), /cannot apply/);
  assert.equal(applyCalls.n, 0);
});

test('a noop plan flags would_be_noop and apply short-circuits without doubling', async () => {
  _resetTokens();
  const { run, applyCalls } = makeTool({ noop: () => true });
  const preview = await run({ target: 'a' });
  assert.equal(preview.would_be_noop, true);
  assert.match(preview.confirm_token, /^tk-/);
  const res = await run({ target: 'a', confirm_token: preview.confirm_token });
  assert.equal(res.applied, false);
  assert.equal(res.noop, true);
  assert.equal(applyCalls.n, 0);
});

test('a token minted for one tool is not accepted by another', async () => {
  _resetTokens();
  const a = makeTool({ name: 'tool_a' });
  const b = makeTool({ name: 'tool_b' });
  const preview = await a.run({ target: 'a' });
  await assert.rejects(
    b.run({ target: 'a', confirm_token: preview.confirm_token }),
    /invalid or expired/
  );
});

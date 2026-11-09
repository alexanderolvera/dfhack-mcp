import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import { RpcError } from 'dfhack-remote-node';
import { ERROR_CODES, ToolError, withGuardCode } from '../src/errors.ts';
import { registerTool } from '../src/register.ts';
import { NotConnectedError, TimeoutError } from '../src/dfclient.ts';
import { defineActuator, _resetTokens } from '../src/actuator.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHARED_GUARDS = new Set(['no fort loaded', 'no game loaded']);

async function payloadOf(def, args = {}) {
  let handler;
  registerTool({ registerTool: (_name, _config, h) => (handler = h) }, def);
  const res = await handler(args);
  return { isError: !!res.isError, data: JSON.parse(res.content[0].text) };
}

const throwing = (err) => ({
  name: 'probe',
  title: 'Probe',
  description: 'test tool',
  run: async () => {
    throw err;
  },
});

test('a thrown error becomes an {error, code} payload with the matching code', async () => {
  const cases = [
    [new NotConnectedError('cannot reach DFHack'), 'NOT_CONNECTED'],
    [new TimeoutError('DFHack did not answer'), 'TIMEOUT'],
    [new RpcError('RPC call failed (1)', 1), 'SCRIPT_ERROR'],
    [new ToolError('bad token', 'INVALID_ARGUMENT'), 'INVALID_ARGUMENT'],
    [new Error('could not parse DFHack output as JSON'), 'SCRIPT_ERROR'],
  ];
  for (const [err, code] of cases) {
    const { isError, data } = await payloadOf(throwing(err));
    assert.equal(isError, true);
    assert.equal(data.code, code, err.constructor.name);
    assert.ok(data.error.includes(err.message), data.error);
  }
});

test('an actuator redeeming an unknown confirm_token reports INVALID_ARGUMENT', async () => {
  _resetTokens();
  const def = defineActuator({
    name: 'probe_actuator',
    title: 'Probe',
    description: 'test actuator',
    tokenPrefix: 'pa',
    shape: {},
    plan: async () => ({ preview: {}, signature: 's' }),
    apply: async () => ({ changes: {}, undo: {}, readback: {} }),
  });
  const { isError, data } = await payloadOf(def, { confirm_token: 'pa-unknown' });
  assert.equal(isError, true);
  assert.equal(data.code, 'INVALID_ARGUMENT');
});

test('the shared Lua guard messages get their code, and a script-set code is kept', () => {
  assert.equal(withGuardCode({ error: 'no fort loaded' }).code, 'NO_FORT');
  assert.equal(withGuardCode({ error: 'no game loaded' }).code, 'NO_GAME');
  assert.equal(withGuardCode({ error: 'no unit with id 9', code: 'NOT_FOUND' }).code, 'NOT_FOUND');
  assert.equal(withGuardCode({ error: 'something else' }).code, undefined);
});

function filesUnder(dir, ext) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(ext))
    .map((e) => join(e.parentPath, e.name));
}

function topLevelOf(src, open) {
  let depth = 0;
  let out = '';
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = src.indexOf(ch, i + 1);
      if (depth === 1) out += src.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) return out + '}';
    if (depth === 1) out += ch;
  }
  return out;
}

function enclosingBrace(src, from) {
  let depth = 0;
  for (let i = from; i >= 0; i--) {
    if (src[i] === '}') depth++;
    if (src[i] === '{' && depth-- === 0) return i;
  }
  return -1;
}

function uncodedErrors(file, keyPattern, codePattern) {
  const src = readFileSync(file, 'utf8');
  const problems = [];
  for (const m of src.matchAll(keyPattern)) {
    const brace = m[0].indexOf('{');
    const table = topLevelOf(src, brace >= 0 ? m.index + brace : enclosingBrace(src, m.index));
    const message = /error\s*[=:]\s*(['"])(.*?)\1\s*[,}]/.exec(table)?.[2];
    if (SHARED_GUARDS.has(message)) continue;
    const code = codePattern.exec(table)?.[1];
    if (!ERROR_CODES.includes(code)) {
      const line = src.slice(0, m.index).split('\n').length;
      problems.push(`${relative(ROOT, file)}:${line} ${table.slice(0, 90)}`);
    }
  }
  return problems;
}

test('every {error} a query script emits carries a known code (or is a shared guard)', () => {
  const problems = filesUnder(join(ROOT, 'src', 'dfhack-queries'), '.lua').flatMap((f) =>
    uncodedErrors(f, /emit\(\{\s*error\s*=/g, /\bcode\s*=\s*'([A-Z_]+)'/)
  );
  assert.deepEqual(problems, []);
});

test('every {error} object a tool builds in TypeScript carries a known code', () => {
  const problems = filesUnder(join(ROOT, 'src', 'tools'), '.ts').flatMap((f) =>
    uncodedErrors(f, /\berror:\s*['"`]/g, /\bcode:\s*'([A-Z_]+)'/)
  );
  assert.deepEqual(problems, []);
});

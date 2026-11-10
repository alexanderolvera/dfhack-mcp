import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_TOOLS } from '../src/tools/registry.ts';
import { FOG_OF_WAR_NOTE, fogArgs, revealHiddenParam } from '../src/fog.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUERIES = join(root, 'src', 'dfhack-queries');
const TOOLS = join(root, 'src', 'tools');
const FOG_MODULES = new Set(['mcp_readTerrain.lua', 'mcp_unitVisibility.lua']);
const REPORT_ONLY_HIDDEN_READERS = new Set(['mcp_blueprint.lua', 'mcp_squad_orders.lua']);

const luaFiles = readdirSync(QUERIES).filter((f) => f.endsWith('.lua'));
const lua = (f) => readFileSync(join(QUERIES, f), 'utf8');

const gatedScripts = luaFiles
  .filter((f) => !FOG_MODULES.has(f) && /fog_gate\((?!\{\})/.test(lua(f)))
  .map((f) => f.replace(/^mcp_|\.lua$/g, ''))
  .sort();

const scriptsCalledWithFogArgs = readdirSync(TOOLS)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(join(TOOLS, f), 'utf8'))
  .filter((src) => src.includes('fogArgs('))
  .flatMap((src) => [...src.matchAll(/runJsonScript<[^>]+>\(\s*'([^']+)'/g)].map((m) => m[1]))
  .sort();

const fogTools = ALL_TOOLS.filter((t) => t.shape?.reveal_hidden && !t.snapshot);
const snapshotFogTools = ALL_TOOLS.filter((t) => t.shape?.reveal_hidden && t.snapshot);

test('every Lua script that takes the fog flag is called with fogArgs, and vice versa', () => {
  assert.ok(gatedScripts.length > 0);
  assert.deepEqual(scriptsCalledWithFogArgs, gatedScripts);
});

test('every fog-gated script reports the mode it ran in', () => {
  const silent = gatedScripts.filter((s) => !lua(`mcp_${s}.lua`).includes('fog_of_war = fog.mode'));
  assert.deepEqual(silent, []);
});

test('no query script outside the fog modules gates on designation.hidden or Discovered itself', () => {
  const offenders = luaFiles
    .filter((f) => !FOG_MODULES.has(f) && !REPORT_ONLY_HIDDEN_READERS.has(f))
    .filter((f) => /\.hidden\b|flags\.Discovered/.test(lua(f)));
  assert.deepEqual(offenders, []);
});

test('every reveal_hidden parameter is the shared one, and its tool documents the opt-in', () => {
  assert.equal(fogTools.length, gatedScripts.length);
  for (const t of fogTools) {
    assert.equal(
      t.shape.reveal_hidden,
      revealHiddenParam,
      `${t.name} declares its own reveal_hidden`
    );
    assert.ok(t.description.includes(FOG_OF_WAR_NOTE), `${t.name} description lacks the fog note`);
  }
});

test('snapshot tools apply fog over captured facts with the shared param and note', () => {
  assert.ok(snapshotFogTools.length > 0);
  for (const t of snapshotFogTools) {
    assert.equal(
      t.shape.reveal_hidden,
      revealHiddenParam,
      `${t.name} declares its own reveal_hidden`
    );
    assert.ok(t.description.includes(FOG_OF_WAR_NOTE), `${t.name} description lacks the fog note`);
  }
  assert.match(lua('mcp_snapshot.lua'), /fog_gate\(\{\}\)/);
});

test('reveal_hidden is an optional boolean', () => {
  assert.equal(revealHiddenParam.safeParse(undefined).success, true);
  assert.equal(revealHiddenParam.safeParse(true).data, true);
  assert.equal(revealHiddenParam.safeParse(false).data, false);
  assert.equal(revealHiddenParam.safeParse('true').success, false);
});

test('fogArgs appends the bypass flag only when asked', () => {
  assert.deepEqual(fogArgs(), []);
  assert.deepEqual(fogArgs(false), []);
  assert.deepEqual(fogArgs(true), ['--reveal-hidden']);
});

// Unit tests for the tool-surface bookkeeping contract (issue #70). The registry
// must stay alphabetical by tool name so sibling tool PRs merge without churn,
// and the published artifact's expected tool count must come from that same
// registry rather than a literal that goes stale when the next tool lands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL_TOOLS } from '../src/tools/registry.ts';

const names = ALL_TOOLS.map((tool) => tool.name);
const root = new globalThis.URL('..', import.meta.url);
const read = (name) => readFileSync(new globalThis.URL(name, root), 'utf8');

test('registry entries are alphabetical by tool name', () => {
  const inversions = [];
  for (let i = 1; i < names.length; i += 1) {
    if (names[i - 1] > names[i]) inversions.push(`${names[i - 1]} > ${names[i]}`);
  }
  assert.deepEqual(inversions, [], `registry out of alphabetical order: ${inversions.join('; ')}`);
});

test('registry tool names are unique', () => {
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  assert.deepEqual(duplicates, [], `duplicate tool names: ${duplicates.join(', ')}`);
});

test('smoke-artifact compares against the derived count, not a literal', () => {
  const source = read('scripts/smoke-artifact.mjs');
  assert.doesNotMatch(
    source,
    /tools\.length\s*!==\s*\d+/,
    'smoke-artifact must not pin the expected tool count to a literal'
  );
  assert.match(
    source,
    /dist['"],\s*['"]surface\.js|surface\.js/,
    'smoke-artifact must read the count the build derives from the registry'
  );
});

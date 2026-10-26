import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_TOOLS } from '../src/tools/registry.ts';

const names = ALL_TOOLS.map((tool) => tool.name);

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

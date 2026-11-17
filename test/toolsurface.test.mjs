import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ALL_TOOLS } from '../src/tools/registry.ts';

const names = ALL_TOOLS.map((tool) => tool.name);

const DOC_DIR = 'docs/tools';
const docPages = readdirSync(DOC_DIR)
  .filter((f) => f.endsWith('.md') && f !== 'README.md')
  .map((f) => f.replace(/\.md$/, ''));

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

test('every registered tool has a doc page, and every doc page has a tool', () => {
  const missing = names.filter((n) => !docPages.includes(n)).sort();
  const orphan = docPages.filter((p) => !names.includes(p)).sort();
  assert.deepEqual(missing, [], `tools with no ${DOC_DIR}/<name>.md: ${missing.join(', ')}`);
  assert.deepEqual(orphan, [], `${DOC_DIR} pages naming no registered tool: ${orphan.join(', ')}`);
});

test("each doc page's frontmatter names its own file", () => {
  for (const page of docPages) {
    const head = readFileSync(`${DOC_DIR}/${page}.md`, 'utf8').slice(0, 400);
    const declared = head.match(/^tool:\s*(\S+)\s*$/m)?.[1];
    assert.equal(declared, page, `${page}.md declares tool: ${declared ?? '(none)'}`);
  }
});

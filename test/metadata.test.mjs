// Unit tests for the package.json <-> server.json contract that the official MCP
// Registry validates. The registry does not just trust server.json: on publish it
// fetches the npm tarball named by `packages[0].identifier` at `packages[0].version`
// and checks that ITS package.json carries a matching `mcpName`. Any drift between
// the two files therefore fails the release (`mcp-registry` job in
// .github/workflows/release.yml) at tag time, after the immutable npm publish has
// already gone out. These assertions move that failure to PR time instead, where a
// forgotten version bump is still cheap to fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath over `import.meta.dirname` because package.json declares Node >=20
// and that property only landed in 20.11.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(readFileSync(join(root, name), 'utf8'));
const pkg = read('package.json');
const server = read('server.json');

test('server.json name matches package.json mcpName', () => {
  assert.equal(server.name, pkg.mcpName);
});

test('mcpName sits in the GitHub-OIDC namespace the release workflow can claim', () => {
  // `mcp-publisher login github-oidc` derives the authorized prefix from the repo
  // owner, so anything outside io.github.alexanderolvera/ is rejected at publish.
  assert.match(pkg.mcpName, /^io\.github\.alexanderolvera\/[a-zA-Z0-9._-]+$/);
});

test('server.json versions match package.json version', () => {
  assert.equal(server.version, pkg.version);
  assert.equal(server.packages[0].version, pkg.version);
});

test('server.json points at the npm package this repo publishes', () => {
  assert.equal(server.packages[0].registryType, 'npm');
  assert.equal(server.packages[0].identifier, pkg.name);
});

test('server.json description fits the registry limit', () => {
  // ServerDetail.description is maxLength 100 in the 2025-12-11 schema; the npm
  // description has no such cap, so copying it over can silently overflow.
  assert.ok(server.description.length <= 100, `${server.description.length} > 100`);
});

test('zod is a direct dependency, not borrowed from the MCP SDK', () => {
  // src/ imports zod directly (actuator.ts, every tool schema) and the SDK declares
  // it as a required peer, so it must be declared here rather than resolved by
  // chance from the SDK's own tree.
  assert.ok(pkg.dependencies.zod, 'zod missing from dependencies');
});

// Tiered verification harness for the DFHack MCP server.
//
//   node scripts/verify.mjs --tier=0        # contract: no fort, CI-able
//   node scripts/verify.mjs --tier=1        # reachability: needs a live fort
//   node scripts/verify.mjs --tier=1 --require-fort  # T1, but no-fort => FAILURE (loaded fixture)
//   node scripts/verify.mjs --tier=1 --no-fort       # T1 mirror: assert every game tool's no-fort guard (no-fort fixture)
//   node scripts/verify.mjs --tier=2        # golden + invariants: needs the fixture save
//   node scripts/verify.mjs --tier=2 --update   # (re)write goldens after a deliberate change
//
// Tiers are cumulative in intent but run independently. Exit code is non-zero on
// any failure so CI and pre-push hooks can gate on it. See docs/VERIFY.md.
//
// T0 spawns the server over real MCP stdio and never touches DFHack, so it runs
// anywhere Node does. T1/T2 call tools, which requires Dwarf Fortress running with
// DFHack and (for T2) the documented fixture fort loaded.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const GOLDEN_DIR = join(ROOT, 'test', 'golden');

// The expected tool surface is DERIVED from the same registry the server builds
// its list from — no static JSON to keep in sync. Filter devOnly (run_lua only
// appears under DFHACK_MCP_DEV) so the default expected set is the curated tools.
// The server subprocess builds its tools/list independently from ALL_TOOLS, so a
// registration that throws still surfaces here as a mismatch — the check holds.
const { ALL_TOOLS } = await import('../src/tools/registry.ts');
const EXPECTED = { tools: ALL_TOOLS.filter((d) => !d.devOnly).map((d) => d.name).sort() };

// --- arg fixtures for tiers that actually call tools ------------------------
// No-arg tools omit an entry. Query tools get the minimal valid args that
// exercise a real path; the values are deterministic so goldens are stable.
const TOOL_ARGS = {
  citizen: { unit_id: '1' },
  find_unit: { query: 'a' },
  game_data: { query: 'cat' },
  identify: { query: 'cat' },
  wiki_search: { query: 'cage trap' },
  wiki_lookup: { title: 'Cage trap' },
};

// Tools whose output depends on the network / external wiki, not the frozen
// fort. Reachable in every tier, but excluded from T2 goldens (not deterministic
// against a committed save). game_data/identify fuse world raws — kept in T2.
const NETWORK_TOOLS = new Set(['wiki_search', 'wiki_lookup']);

// --- tiny CLI ---------------------------------------------------------------
const argv = process.argv.slice(2);
const tier = Number((argv.find((a) => a.startsWith('--tier=')) ?? '--tier=0').split('=')[1]);
const update = argv.includes('--update');
// When set, "no fort loaded" is a FAILURE, not a pass. Use it against a fixture
// or a container that is supposed to have a fort loaded, so a broken headless
// load can't be reported as a verified instance.
const requireFort = argv.includes('--require-fort');
// The MIRROR of --require-fort: assert against a NO-FORT fixture (title screen,
// RPC up, no fort loaded) that EVERY game-dependent tool returns its "no fort
// loaded" guard CLEANLY — as normal output, never isError / a crash / real data.
// This EXERCISES the guard (#6) instead of merely trusting it's coded. T1-only,
// and mutually exclusive with --require-fort (they assert opposite fixtures).
const noFort = argv.includes('--no-fort');
if (noFort && requireFort) {
  console.error('--no-fort and --require-fort are mutually exclusive (opposite fixtures).');
  process.exit(2);
}
if (noFort && tier !== 1) {
  console.error('--no-fort is a T1 mode; run it with --tier=1.');
  process.exit(2);
}

// --- helpers ----------------------------------------------------------------
let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`  ✗ ${msg}`);
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

/** Recursively sort object keys so serialized output is stable regardless of
 *  insertion / pairs() order. Arrays keep their order (often semantic); a tool
 *  that emits an unordered list should sort it before returning. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonicalize(value[k])])
    );
  }
  return value;
}

function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, 'src', 'index.ts')],
    env: { ...process.env },
    cwd: ROOT,
  });
  const client = new Client({ name: 'dfhack-mcp-verify', version: '1.0.0' });
  return client.connect(transport).then(() => client);
}

/** Call a tool and return its parsed JSON payload, or a synthetic error object
 *  if the text wasn't JSON. */
async function callJson(client, name) {
  const res = await client.callTool({ name, arguments: TOOL_ARGS[name] ?? {} });
  const text = res.content?.find((p) => p.type === 'text')?.text ?? '';
  try {
    return { data: JSON.parse(text), isError: !!res.isError };
  } catch {
    return { data: { __unparsable__: text }, isError: true };
  }
}

// Match the guard message EXACTLY (anchored + trimmed), not as a substring, so a
// different error that merely contains the phrase (e.g. "no fort loaded while
// query failed") is NOT mistaken for the clean guard.
const isNoFort = (d) =>
  d && typeof d.error === 'string' && /^no (fort|game) loaded$/i.test(d.error.trim());

// --- T0: contract -----------------------------------------------------------
async function tier0(client) {
  console.log('\nT0 — handshake + tools/list + schemas');
  const { tools } = await client.listTools();
  const got = tools.map((t) => t.name).sort();
  const want = [...EXPECTED.tools].sort();

  const missing = want.filter((n) => !got.includes(n));
  const extra = got.filter((n) => !want.includes(n));
  if (missing.length) fail(`missing tools: ${missing.join(', ')}`);
  if (extra.length)
    fail(`unexpected tools: ${extra.join(', ')} (update src/tools/registry.ts if intended)`);
  if (!missing.length && !extra.length) ok(`tools/list matches expected set (${got.length} tools)`);

  for (const t of tools) {
    if (!t.description || t.description.length < 20)
      fail(`${t.name}: missing/short description`);
    // The SDK emits a JSON Schema for inputSchema; no-arg tools get an empty
    // object schema. Assert it's at least a well-formed object schema.
    const s = t.inputSchema;
    if (!s || s.type !== 'object') fail(`${t.name}: inputSchema is not an object schema`);
  }
  if (!failures) ok('every tool has a description and a valid input schema');
}

// --- T1: reachability -------------------------------------------------------
// Some tools take a LIVE, save-specific id that no hardcoded fixture can supply.
// Resolve those from a discovery tool against the loaded fort so the loaded tiers
// (T1 require-fort, T2) exercise real records instead of a guessed id that won't
// exist in an arbitrary fort. Shared by tier1 (loaded) and tier2. With no fort /
// no matches, the static placeholder stays and the tool just returns its guard.
async function resolveLiveArgs(client) {
  // citizen(unit_id) <- find_unit's first match (find_unit now emits unit_id).
  const fu = await callJson(client, 'find_unit');
  const liveId = fu.data?.matches?.[0]?.unit_id;
  if (liveId != null) TOOL_ARGS.citizen = { unit_id: String(liveId) };
}

async function tier1(client) {
  if (noFort) return tier1NoFort(client);
  console.log('\nT1 — reachability (every tool callable, well-formed JSON or no-fort error)');
  for (const name of [...EXPECTED.tools].sort()) {
    const { data } = await callJson(client, name);
    if (data.__unparsable__ !== undefined) {
      fail(`${name}: returned non-JSON: ${String(data.__unparsable__).slice(0, 80)}`);
    } else if (isNoFort(data)) {
      if (requireFort) fail(`${name}: no fort loaded (--require-fort set)`);
      else ok(`${name}: reachable (no fort loaded)`);
    } else if (typeof data.error === 'string') {
      // A non-no-fort error means the tool is reachable but failing (e.g. a query
      // script didn't resolve). That's a T1 failure, not a pass — well-formed JSON
      // isn't enough when it's an error payload.
      fail(`${name}: returned error: ${data.error}`);
    } else {
      ok(`${name}: reachable, well-formed JSON`);
    }
  }
}

// --- T1 --no-fort: guard reachability (mirror of --require-fort) -------------
// Against a NO-FORT fixture, assert every GAME-dependent tool returns its no-fort
// guard cleanly, so the guard is EXERCISED, not just coded (#6). This is the T1
// reachability path #28 needs on the no-fort side.
async function tier1NoFort(client) {
  console.log(
    '\nT1 (--no-fort) — every game tool returns its no-fort guard cleanly (guard exercised, #6)'
  );
  for (const name of [...EXPECTED.tools].sort()) {
    const { data, isError } = await callJson(client, name);
    // Wiki tools are pure HTTP against the external wiki — no game dependency, so
    // they do NOT return the guard. Assert they still return well-formed,
    // non-error output; asserting the guard here would be wrong.
    if (NETWORK_TOOLS.has(name)) {
      if (data.__unparsable__ !== undefined) {
        fail(`${name}: returned non-JSON: ${String(data.__unparsable__).slice(0, 80)}`);
      } else if (isError || typeof data.error === 'string') {
        fail(`${name}: network tool errored: ${data.error ?? '(isError)'}`);
      } else {
        ok(`${name}: reachable, well-formed JSON (network tool, no game dependency)`);
      }
      continue;
    }
    // Game-dependent tool. The guard MUST come back as NORMAL output: well-formed
    // JSON, not isError, not a crash/traceback (non-JSON), not a different error,
    // and NOT real data. A genuine "DFHack unreachable" surfaces here as its
    // (non-guard) connection error and correctly FAILS — it isn't masked as a pass.
    if (data.__unparsable__ !== undefined) {
      fail(`${name}: crash/non-JSON, not a clean guard: ${String(data.__unparsable__).slice(0, 80)}`);
    } else if (isError) {
      fail(`${name}: isError, not a clean no-fort guard: ${JSON.stringify(data).slice(0, 80)}`);
    } else if (isNoFort(data)) {
      ok(`${name}: no-fort guard returned cleanly ("${data.error}")`);
    } else if (typeof data.error === 'string') {
      fail(`${name}: wrong error, not the no-fort guard: ${data.error}`);
    } else {
      // Well-formed JSON with no error against a no-fort fixture = real data. The
      // guard was NOT exercised — exactly the gap this mode exists to catch.
      fail(`${name}: returned data instead of the no-fort guard (guard not exercised)`);
    }
  }
}

// --- T2: golden + invariants ------------------------------------------------
async function tier2(client) {
  console.log(`\nT2 — golden snapshots${update ? ' (UPDATE mode)' : ''}`);
  mkdirSync(GOLDEN_DIR, { recursive: true });
  for (const name of [...EXPECTED.tools].sort()) {
    if (NETWORK_TOOLS.has(name)) {
      console.log(`  ○ ${name}: skipped (network-dependent, not goldened)`);
      continue;
    }
    const { data } = await callJson(client, name);
    if (isNoFort(data)) {
      fail(`${name}: no fort loaded — T2 needs the fixture save loaded`);
      continue;
    }
    const snapshot = JSON.stringify(canonicalize(data), null, 2) + '\n';
    const file = join(GOLDEN_DIR, `${name}.json`);
    if (update || !existsSync(file)) {
      writeFileSync(file, snapshot);
      ok(`${name}: golden ${existsSync(file) ? 'written' : 'created'}`);
    } else {
      const prev = readFileSync(file, 'utf8');
      if (prev === snapshot) ok(`${name}: golden matches`);
      else fail(`${name}: golden DIFF (run with --update if the change is intended)`);
    }
  }
  invariants(); // cross-tool checks would read the snapshots; stubbed until fixture lands
}

function invariants() {
  // Thin cross-tool invariants (happiness sums to population, days-of-supply >= 0,
  // ...) go here once the fixture save (#27) makes values deterministic. Reads the
  // just-written goldens so it never double-calls the server.
  console.log('  ○ invariants: none defined yet (pending fixture save, #27)');
}

// --- run --------------------------------------------------------------------
const client = await connect();
try {
  // Loaded tiers resolve save-specific args (e.g. citizen's unit_id) from live
  // discovery tools first; --no-fort/T0 need no fort so they skip this.
  if ((tier === 1 && !noFort) || tier === 2) await resolveLiveArgs(client);
  if (tier === 0) await tier0(client);
  else if (tier === 1) await tier1(client);
  else if (tier === 2) await tier2(client);
  else {
    console.error(`unknown tier: ${tier} (use --tier=0|1|2)`);
    failures++;
  }
} finally {
  await client.close();
}

console.log(`\n${failures ? `✗ ${failures} failure(s)` : '✓ all checks passed'} (T${tier})`);
process.exit(failures ? 1 : 0);

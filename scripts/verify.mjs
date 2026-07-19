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

// The harness always exercises the FULL surface, including the gated actuators, so
// their schemas (T0) and dry-run reachability (T1) are covered. We only ever call
// actuators WITHOUT a confirm_token — a dry-run/preview that never mutates the
// fixture. Set before the expected set is derived and before the server is spawned
// (the child inherits process.env), so both sides agree on the tool list.
process.env.DFHACK_MCP_ACTUATORS = '1';

// The expected tool surface is DERIVED from the same registry the server builds
// its list from — no static JSON to keep in sync. Apply the SAME env gates the
// server does (index.ts): devOnly needs DFHACK_MCP_DEV, actuator needs
// DFHACK_MCP_ACTUATORS — so with neither set the expected set is the read-only
// curated tools, and `DFHACK_MCP_ACTUATORS=1 npm run verify:t0` expects the
// actuators too. The server subprocess (spawned with our env) builds its
// tools/list independently from ALL_TOOLS, so a registration that throws still
// surfaces here as a mismatch — the check holds.
const { ALL_TOOLS } = await import('../src/tools/registry.ts');
const { isGatedOff } = await import('../src/register.ts');
const EXPECTED = {
  tools: ALL_TOOLS.filter((d) => !isGatedOff(d))
    .map((d) => d.name)
    .sort(),
};

// Relational invariants (the Red/Green layer) live in their own module so adding
// a spec is a one-line edit there, not surgery on this runner.
import { INVARIANTS } from '../test/invariants.mjs';
const INVARIANT_TOOLS = [...new Set(INVARIANTS.flatMap((i) => i.tools))];

// --- arg fixtures for tiers that actually call tools ------------------------
// No-arg tools omit an entry. Query tools get the minimal valid args that
// exercise a real path; the values are deterministic so goldens are stable.
const TOOL_ARGS = {
  // blueprint_apply / blueprint_undo dry-runs (NO confirm_token -> preview only,
  // never mutates). A valid 3-cell dig CSV anchored on the fixture's revealed-wall
  // strip (x79-81,y37,z122 are StoneWall, discovered) so the preview designates
  // cleanly (tiles_affected>0, no invalid keys / could_not) and reachability
  // exercises the real dry-run path. blueprint_undo's dry-run only READS state.
  blueprint_apply: { csv: '#dig\nd,d,d\n', anchor_x: 79, anchor_y: 37, anchor_z: 122, mode: 'dig' },
  blueprint_undo: { csv: '#dig\nd,d,d\n', anchor_x: 79, anchor_y: 37, anchor_z: 122, mode: 'dig' },
  citizen: { unit_id: '1' },
  find_unit: { query: 'a' },
  game_data: { query: 'cat' },
  identify: { query: 'cat' },
  wiki_search: { query: 'cage trap' },
  wiki_lookup: { title: 'Cage trap' },
  // tile_region is parameterized; a deterministic explicit rectangle so T1
  // reachability and the invariants exercise the ARG path, not only the default.
  // The T2 golden deliberately overrides this back to {} (see GOLDEN_NO_ARG) so
  // the committed snapshot stays the reproducible default window.
  tile_region: { z: '124', x0: '49', y0: '31', x1: '88', y1: '70' },
  // work_details is parameterized the same way: the detail filter exercises the
  // narrowing path in T1/invariants, while the T2 golden stays the no-arg call
  // (GOLDEN_NO_ARG) so the committed snapshot is the full unfiltered list.
  work_details: { detail: 'Military' },
  // work_order_create dry-run (NO confirm_token -> preview only, never mutates).
  work_order_create: { job_type: 'ConstructBed', amount: 1 },
  // work_order_cancel needs a live order id; resolveLiveArgs fills it from
  // work_order_list. The static placeholder keeps T0 well-formed and lets the
  // no-fort tier reach the guard even when no order can be resolved.
  work_order_cancel: { order_id: 0 },
  // assign_work_detail dry-run (NO confirm_token -> preview only, never mutates).
  // resolveLiveArgs fills a real citizen unit_id + detail name from work_details;
  // the static placeholder keeps T0 well-formed and reaches the no-fort guard.
  assign_work_detail: { unit_id: 0, detail: 'Miners', enabled: true },
};

// Tools whose committed golden is captured with NO args even though they carry a
// TOOL_ARGS entry above (used to exercise the param path elsewhere). For
// tile_region the no-arg default window is the reproducible documented snapshot;
// for work_details it is the full unfiltered detail list.
const GOLDEN_NO_ARG = new Set(['tile_region', 'work_details']);

// Tools whose output depends on the network / external wiki, not the frozen
// fort. Reachable in every tier, but excluded from T2 goldens (not deterministic
// against a committed save). game_data/identify fuse world raws — kept in T2.
const NETWORK_TOOLS = new Set(['wiki_search', 'wiki_lookup']);

// Tools reached in every tier but NOT captured as T2 goldens. The two actuators
// return a fresh random confirm_token in their dry-run preview (non-deterministic);
// work_order_list is a large, fort-specific order set better checked by a
// structural invariant than a brittle 200+-line snapshot. All three are still
// exercised for reachability (T1) and, for list, feed the work_order invariant.
const NO_GOLDEN = new Set([
  'blueprint_apply',
  'blueprint_undo',
  'work_order_create',
  'work_order_cancel',
  'work_order_list',
  'assign_work_detail',
]);

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
// Run ONLY the relational invariants against a live fort — the Red/Green surface
// that needs no committed golden. Tier-independent (treat like a T1.5).
const invariantsOnly = argv.includes('--invariants');
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
async function callJson(client, name, argsOverride) {
  const res = await client.callTool({ name, arguments: argsOverride ?? TOOL_ARGS[name] ?? {} });
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
    if (!t.description || t.description.length < 20) fail(`${t.name}: missing/short description`);
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
  // work_order_cancel(order_id) <- work_order_list's first active order, so the
  // cancel DRY-RUN previews a real order (still never applied — no confirm_token).
  const wol = await callJson(client, 'work_order_list');
  const orderId = wol.data?.orders?.[0]?.id;
  if (orderId != null) TOOL_ARGS.work_order_cancel = { order_id: orderId };
  // assign_work_detail(unit_id, detail) <- a real citizen (any detail member) and a
  // detail that does NOT already contain them, so the DRY-RUN previews a genuine add
  // (never blocked, never a noop) — still never applied (no confirm_token). Called
  // with explicit {} — TOOL_ARGS narrows work_details to ONE detail, but resolving
  // needs the full list.
  const wd = await callJson(client, 'work_details', {});
  const details = wd.data?.details ?? [];
  let uid;
  for (const d of details) {
    if (Array.isArray(d.members) && d.members.length) {
      uid = d.members[0];
      break;
    }
  }
  if (uid != null) {
    const target = details.find((d) => !(d.members ?? []).includes(uid));
    if (target) TOOL_ARGS.assign_work_detail = { unit_id: uid, detail: target.name, enabled: true };
  }
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
      fail(
        `${name}: crash/non-JSON, not a clean guard: ${String(data.__unparsable__).slice(0, 80)}`
      );
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
  const payloads = {}; // captured here, reused by runInvariants() below
  for (const name of [...EXPECTED.tools].sort()) {
    if (NETWORK_TOOLS.has(name)) {
      console.log(`  ○ ${name}: skipped (network-dependent, not goldened)`);
      continue;
    }
    // Golden snapshot: capture the deterministic no-arg default for tools that
    // opt into it (their TOOL_ARGS entry exists only to exercise the param path
    // in other tiers), otherwise the tool's normal fixture args.
    const { data } = await callJson(client, name, GOLDEN_NO_ARG.has(name) ? {} : undefined);
    if (isNoFort(data)) {
      fail(`${name}: no fort loaded — T2 needs the fixture save loaded`);
      continue;
    }
    payloads[name] = data; // captured for the invariants even when not goldened
    if (NO_GOLDEN.has(name)) {
      console.log(`  ○ ${name}: not goldened (covered by invariant + reachability)`);
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
  runInvariants(payloads); // reuse the payloads T2 already captured — no double-call
  await tileRegionParamChecks(client); // param surface the no-arg golden can't reach
  await workDetailsParamChecks(client); // ditto for the work_details narrowing args
  await blueprintActuatorChecks(client); // live confirm+apply+undo; restores the fixture
}

// Call every tool in `names` once and return a { name -> payload } map. Skips
// network tools (no game dependency, non-deterministic). Used by --invariants to
// gather exactly the payloads the specs read.
async function capturePayloads(client, names) {
  const payloads = {};
  for (const name of names) {
    if (NETWORK_TOOLS.has(name)) continue;
    payloads[name] = (await callJson(client, name)).data;
  }
  return payloads;
}

// A payload is usable by an invariant only if the tool actually produced fort
// data — not the no-fort guard, a crash, or any error payload.
const isEvaluable = (d) =>
  d && d.__unparsable__ === undefined && !isNoFort(d) && typeof d.error !== 'string';

// Run every relational invariant over the captured payloads. An invariant whose
// required tools didn't all return fort data is reported n/a (not a failure), so
// this same runner degrades cleanly with no fort loaded.
function runInvariants(payloads) {
  console.log('\nInvariants (relational specs — must hold for any valid fort)');
  let evaluated = 0;
  for (const inv of INVARIANTS) {
    const missing = inv.tools.filter((t) => !isEvaluable(payloads[t]));
    if (missing.length) {
      console.log(`  ○ ${inv.name}: n/a (needs loaded ${missing.join(', ')})`);
      continue;
    }
    evaluated++;
    const problems = inv.check(payloads);
    if (problems.length) for (const m of problems) fail(`${inv.name}: ${m}`);
    else ok(`${inv.name}: ${inv.desc}`);
  }
  if (!evaluated) console.log('  ○ no invariants evaluable (no fort loaded)');
}

// --- tile_region param surface ----------------------------------------------
// The parameterized behaviors a single TOOL_ARGS entry (and the no-arg golden)
// can't reach: an explicit rectangle, reversed corners resolving to the SAME
// window, and an oversized request CLAMPED to the 100x100 cap. Live-only (needs a
// fort); degrades to a clean skip with no fort loaded.
async function tileRegionParamChecks(client) {
  console.log('\ntile_region param surface (explicit rect / reversed corners / clamp)');
  const call = (a) => callJson(client, 'tile_region', a);
  const probe = await call({ z: '124', x0: '60', y0: '40', x1: '79', y1: '59' });
  if (isNoFort(probe.data) || probe.data.error) {
    console.log('  ○ skipped (no fort loaded)');
    return;
  }
  // 1. explicit rectangle: 20x20 at origin (60,40), not truncated.
  const rect = probe.data;
  const rectOK =
    JSON.stringify(rect.size) === '[20,20]' &&
    JSON.stringify(rect.origin) === '[60,40]' &&
    rect.truncated === false;
  if (rectOK) ok('explicit rectangle -> size [20,20] origin [60,40] truncated:false');
  else
    fail(
      `explicit rectangle wrong: size ${JSON.stringify(rect.size)} origin ${JSON.stringify(rect.origin)} truncated ${rect.truncated}`
    );

  // 2. reversed corners describe the same rectangle -> identical window + grid.
  const rev = (await call({ z: '124', x0: '79', y0: '59', x1: '60', y1: '40' })).data;
  const revOK =
    JSON.stringify(rev.origin) === JSON.stringify(rect.origin) &&
    JSON.stringify(rev.size) === JSON.stringify(rect.size) &&
    JSON.stringify(rev.grid) === JSON.stringify(rect.grid);
  if (revOK) ok('reversed corners resolve to the identical window + grid');
  else
    fail(
      `reversed corners differ: origin ${JSON.stringify(rev.origin)} size ${JSON.stringify(rev.size)} gridEqual ${JSON.stringify(rev.grid) === JSON.stringify(rect.grid)}`
    );

  // 3. oversized request (150x150) is CLAMPED to 100x100 with truncated + echo.
  const big = (await call({ z: '124', x0: '0', y0: '0', x1: '149', y1: '149' })).data;
  const clampOK =
    JSON.stringify(big.size) === '[100,100]' &&
    big.truncated === true &&
    JSON.stringify(big.requested) === '[150,150]' &&
    big.grid.length === 100 &&
    big.grid.every((r) => r.length === 100);
  if (clampOK) ok('oversized 150x150 -> clamped [100,100] truncated:true requested [150,150]');
  else
    fail(
      `clamp wrong: size ${JSON.stringify(big.size)} truncated ${big.truncated} requested ${JSON.stringify(big.requested)}`
    );
}

// --- work_details param surface ---------------------------------------------
// The narrowing behaviors the no-arg golden can't reach: the exact-name detail
// filter and the members_after cursor. Live-only; degrades to a clean skip with
// no fort loaded or no detail populous enough to page over.
async function workDetailsParamChecks(client) {
  console.log('\nwork_details param surface (detail filter / members_after cursor)');
  const call = (a) => callJson(client, 'work_details', a);
  const all = (await call({})).data;
  if (isNoFort(all) || all.error) {
    console.log('  ○ skipped (no fort loaded)');
    return;
  }
  // The most populous detail, so the cursor has members to page over.
  const target = (all.details ?? []).reduce(
    (best, d) => ((d.members?.length ?? 0) > (best?.members?.length ?? 0) ? d : best),
    null
  );
  if (!target || (target.members?.length ?? 0) < 2) {
    console.log('  ○ skipped (no detail with 2+ listed members)');
    return;
  }
  // 1. detail filter: EXACTLY that one detail comes back, count agreeing.
  const one = (await call({ detail: target.name })).data;
  const oneOK = one.count === 1 && one.details?.length === 1 && one.details[0].name === target.name;
  if (oneOK) ok(`detail filter "${target.name}" -> exactly that detail (count 1)`);
  else
    fail(
      `detail filter wrong: count ${one.count}, got ${JSON.stringify(one.details?.map((d) => d.name))}`
    );

  // 2. members_after mid-list: only ids AFTER the cursor, full member_count kept,
  //    and the cursor echoed at top level.
  const mid = target.members[Math.floor(target.members.length / 2) - 1];
  const paged = (await call({ detail: target.name, members_after: mid })).data;
  const pd = paged.details?.[0] ?? {};
  const wantTail = target.members.filter((m) => m > mid);
  const pagedOK =
    paged.members_after === mid &&
    JSON.stringify(pd.members?.slice(0, wantTail.length)) === JSON.stringify(wantTail) &&
    pd.member_count === target.member_count;
  if (pagedOK)
    ok(
      `members_after ${mid} -> ${pd.members.length} member(s) all past the cursor, member_count still ${pd.member_count}`
    );
  else
    fail(
      `cursor page wrong: echo ${paged.members_after}, members ${JSON.stringify(pd.members)}, member_count ${pd.member_count} (expected tail ${JSON.stringify(wantTail)} of ${target.member_count})`
    );
}

// --- blueprint actuator surface (LIVE, MUTATING then restored) --------------
// The confirm→apply→undo loop, zone mode, and the malformed/unsupported blocks —
// none reachable from the no-token dry-run the golden/reachability tiers exercise
// (the two actuators are in NO_GOLDEN precisely because the token is random). This
// routine APPLIES to the fixture, so it MUST undo everything it applies and leave
// the fort byte-identical (the T2 sensor goldens — e.g. map_overview's digging_z —
// depend on that). Live-only; degrades to a clean skip with no fort loaded.
async function blueprintActuatorChecks(client) {
  console.log('\nblueprint actuator surface (confirm+apply+undo / zone / malformed / unsupported)');
  // Small dig blueprint on the revealed StoneWall strip (x79-81,y37,z122): three
  // discovered, undesignated wall cells (the same clean strip the dry-run fixtures
  // use), so apply designates exactly 3 tiles and undo fully reverts them.
  const dig = { csv: '#dig\nd,d,d\n', anchor_x: 79, anchor_y: 37, anchor_z: 122, mode: 'dig' };

  // Skip cleanly with no fort loaded (mirror tileRegionParamChecks).
  const pre = (await callJson(client, 'blueprint_apply', dig)).data;
  if (isNoFort(pre) || pre.error) {
    console.log('  ○ skipped (no fort loaded)');
    return;
  }

  // (a) preview minted a token on a clean strip; APPLY it and assert the dig flags
  //     land (the readback counts footprint tiles whose dig flag is set).
  if (typeof pre.confirm_token !== 'string') {
    fail(
      `dig preview minted no confirm_token (blocked=${JSON.stringify(pre.blocked)}); nothing applied`
    );
    return; // nothing applied -> nothing to restore
  }
  if (pre.preview?.pre_existing_designations !== 0)
    fail(
      `dig strip is not clean (pre_existing=${pre.preview?.pre_existing_designations}); apply/undo restore is unsafe`
    );
  const applied = (
    await callJson(client, 'blueprint_apply', { ...dig, confirm_token: pre.confirm_token })
  ).data;
  if (
    applied.applied === true &&
    applied.changes?.tiles_affected === 3 &&
    applied.readback?.designated_tiles === 3
  )
    ok('dig blueprint applied -> 3 tiles designated (readback confirms flags set)');
  else fail(`dig apply wrong: ${JSON.stringify(applied).slice(0, 200)}`);

  // (b) undo it and assert the flags clear back to 0 — this is what restores the
  //     fixture byte-identical for the T2 goldens.
  const upre = (await callJson(client, 'blueprint_undo', dig)).data;
  if (typeof upre.confirm_token !== 'string') {
    fail(
      `undo preview minted no confirm_token (blocked=${JSON.stringify(upre.blocked)}); fixture is DIRTY`
    );
  } else {
    const undone = (
      await callJson(client, 'blueprint_undo', { ...dig, confirm_token: upre.confirm_token })
    ).data;
    if (undone.applied === true && undone.readback?.designated_tiles === 0)
      ok('blueprint_undo -> 0 tiles designated (flags cleared, fixture restored)');
    else fail(`undo wrong (fixture may be DIRTY): ${JSON.stringify(undone).slice(0, 200)}`);
  }

  // (c) zone mode previews a real designation (dry-run only; never mutates).
  const zone = (
    await callJson(client, 'blueprint_apply', {
      csv: '#zone\nm,m\nm,m\n',
      anchor_x: 79,
      anchor_y: 37,
      anchor_z: 122,
      mode: 'zone',
    })
  ).data;
  if (zone.preview?.tiles_affected > 0 && typeof zone.confirm_token === 'string')
    ok(`zone preview -> tiles_affected=${zone.preview.tiles_affected} with a confirm_token`);
  else fail(`zone preview wrong: ${JSON.stringify(zone).slice(0, 200)}`);

  // (d) a malformed CSV previews BLOCKED with no token (spike #11 partial-apply gate).
  const bad = (
    await callJson(client, 'blueprint_apply', {
      csv: '#dig\nZZZ,d\n',
      anchor_x: 79,
      anchor_y: 37,
      anchor_z: 122,
      mode: 'dig',
    })
  ).data;
  if (Array.isArray(bad.blocked) && bad.blocked.length > 0 && bad.confirm_token === undefined)
    ok('malformed CSV -> blocked with no confirm_token');
  else fail(`malformed CSV not blocked cleanly: ${JSON.stringify(bad).slice(0, 200)}`);

  // (e) an unsupported mode (build) blocks with no token (v1 scope gate).
  const build = (
    await callJson(client, 'blueprint_apply', {
      csv: '#build\nb,b\n',
      anchor_x: 79,
      anchor_y: 37,
      anchor_z: 122,
      mode: 'build',
    })
  ).data;
  if (Array.isArray(build.blocked) && build.blocked.length > 0 && build.confirm_token === undefined)
    ok('unsupported mode "build" -> blocked with no confirm_token');
  else fail(`build mode not blocked cleanly: ${JSON.stringify(build).slice(0, 200)}`);
}

// --- invariants-only mode ---------------------------------------------------
async function invariantsMode(client) {
  console.log('\nInvariants mode — relational specs against the live fort (no golden needed)');
  await resolveLiveArgs(client);
  runInvariants(await capturePayloads(client, INVARIANT_TOOLS));
  await tileRegionParamChecks(client);
  await workDetailsParamChecks(client);
  await blueprintActuatorChecks(client);
}

// --- run --------------------------------------------------------------------
const client = await connect();
try {
  if (invariantsOnly) {
    // Tier-independent: resolves its own live args, needs no golden.
    await invariantsMode(client);
  } else {
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
  }
} finally {
  await client.close();
}

const label = invariantsOnly ? 'invariants' : `T${tier}`;
console.log(`\n${failures ? `✗ ${failures} failure(s)` : '✓ all checks passed'} (${label})`);
process.exit(failures ? 1 : 0);

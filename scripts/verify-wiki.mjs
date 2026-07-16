// Live end-to-end check for the wiki tools — PURE HTTP, no game/DFHack needed.
// Usage: node scripts/verify-wiki.mjs
// Exercises: search, a plain lookup, a redirect+fragment lookup (Weapon trap →
// DF2014:Trap#Weapon Trap), a cache HIT proof, and a not-found soft failure.

import { wikiSearchTool } from '../src/tools/wikiSearch.ts';
import { wikiLookupTool } from '../src/tools/wikiLookup.ts';

const line = (s = '') => console.log(s);
const head = (t) => (t.length > 300 ? t.slice(0, 300) + ' …' : t);

// 1. wiki_search
line('== wiki_search("weapon trap")');
const s = await wikiSearchTool('weapon trap');
if (s.error) line('  ERROR: ' + s.error);
else for (const r of s.results) line(`  - ${r.title}  ::  ${r.snippet.slice(0, 70)}`);
line();

// 2. wiki_lookup plain page
line('== wiki_lookup("Trap")');
const trap = await wikiLookupTool('Trap');
if (trap.error) line('  ERROR: ' + trap.error);
else {
  line(`  title=${trap.title}  from_cache=${trap.from_cache}  resolved_from=${trap.resolved_from ?? '(none)'}`);
  line(`  url=${trap.url}`);
  line(`  cleaned text length=${trap.text.length}`);
  line('  first ~300 chars:');
  line('  ' + head(trap.text).replace(/\n/g, '\n  '));
}
line();

// 3. Redirect + section fragment: "Weapon trap" → DF2014:Trap#Weapon Trap
line('== wiki_lookup("Weapon trap")  [redirect + fragment]');
const wt = await wikiLookupTool('Weapon trap');
if (wt.error) line('  ERROR: ' + wt.error);
else {
  line(`  title=${wt.title}  resolved_from=${wt.resolved_from ?? '(none)'}`);
  line(`  url=${wt.url}`);
  line(`  text length=${wt.text.length} (section-scoped)`);
  line('  first ~300 chars:');
  line('  ' + head(wt.text).replace(/\n/g, '\n  '));
}
line();

// 4. Cache HIT proof — second lookup of the same page must be from_cache + fast.
line('== cache proof: wiki_lookup("Cage trap") twice');
const c1s = Date.now();
const c1 = await wikiLookupTool('Cage trap');
const c1ms = Date.now() - c1s;
const c2s = Date.now();
const c2 = await wikiLookupTool('Cage trap');
const c2ms = Date.now() - c2s;
line(`  call#1 from_cache=${c1.from_cache}  (${c1ms} ms)`);
line(`  call#2 from_cache=${c2.from_cache}  (${c2ms} ms)  <- expect true, near-instant`);
line();

// 5. Not-found soft failure (returns {error}, does not throw).
line('== wiki_lookup("Zzqx Nonexistent Page 9999")  [not found]');
const nf = await wikiLookupTool('Zzqx Nonexistent Page 9999');
line('  ' + JSON.stringify(nf));

process.exit(0);

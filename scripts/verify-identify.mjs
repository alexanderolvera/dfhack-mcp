// Live verification for the identify tool — fuses THIS WORLD's raws with the DF
// wiki. Exercises: a procedural demon by name (flame phantom), the SAME creature
// via a live unit_id, a vanilla creature with its own wiki page (dwarf), and a
// no-match. Prints concise evidence, especially the fused trapavoid tactic sitting
// next to the Fire strategy — the pairing that would have prevented advising cage
// traps on a TRAPAVOID creature.
//   node scripts/verify-identify.mjs
// Requires Dwarf Fortress running with DFHack and a fort loaded.

import { identify } from '../src/tools/identify.ts';
import { runLua } from '../src/dfclient.ts';

const line = (s = '') => console.log(s);

function show(label, res) {
  line(`\n=== ${label} ===`);
  if (res && res.error) {
    line('error: ' + res.error);
    return;
  }
  if (res && 'match_count' in res) {
    line(`disambiguation: match_count=${res.match_count} truncated=${!!res.truncated}`);
    for (const m of res.matches) line(`  - ${m.token}: ${m.name} — ${m.blurb}`);
    return;
  }
  const c = res.creature;
  line(`creature: ${c.token} "${c.name}"  size=${c.size_label}  flags=[${c.flags.join(', ')}]`);
  if (c.unit_id != null) line(`resolved via live unit_id=${c.unit_id}${c.unit_name ? ` (${c.unit_name})` : ''}`);
  line('tactics (raws -> hard facts):');
  for (const t of res.tactics) line(`  - [${t.trait}] ${t.note}`);
  line('wiki (trimmed strategy context):');
  for (const w of res.wiki) {
    line(`  * ${w.topic} -> "${w.title}"  ${w.url}`);
    line('    ' + w.excerpt.replace(/\n+/g, ' ').slice(0, 220) + ' …');
  }
  if (res.notes) for (const n of res.notes) line('  note: ' + n);
}

// Find a live Flame Phantom (active hostile) unit_id for the fusion-shortcut case.
async function liveHostileId() {
  const out = await runLua(String.raw`
    for _, u in ipairs(df.global.world.units.active) do
      if dfhack.units.isActive(u) and not dfhack.units.isDead(u)
         and dfhack.units.isDanger(u) and not dfhack.units.isCitizen(u) then
        print(u.id); return
      end
    end
    print('')
  `);
  return out.trim();
}

// 1. Procedural demon by name: expect trapavoid + flier + fire tactics + a Fire excerpt.
show('identify("flame phantom")', await identify('flame phantom'));

// 2. Same creature via a live unit_id (proves the unit -> race -> dossier fusion path).
const uid = await liveHostileId();
line(`\n(live hostile unit_id = ${uid || 'none found'})`);
if (uid) show(`identify("${uid}")  [live unit_id]`, await identify(uid));

// 3. A normal creature that DOES have its own wiki page.
show('identify("dwarf")', await identify('dwarf'));

// 4. No match — a useful {error}/passthrough, never a throw.
show('identify("zzqwx")', await identify('zzqwx'));

process.exit(0);

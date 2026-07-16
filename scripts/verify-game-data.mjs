// Live verification for the game_data tool's creature kind.
// Exercises: name lookup, token lookup, a vanilla creature, a live unit_id
// (fusion shortcut), a kind filter, and a no-match. Prints concise evidence.
// Requires Dwarf Fortress running with DFHack and a fort loaded.
//   node scripts/verify-game-data.mjs
import { gameData } from '../src/tools/gameData.ts';
import { runLua } from '../src/dfclient.ts';

function show(label, res) {
  console.log(`\n=== ${label} ===`);
  if (res && res.error) {
    console.log('error:', res.error);
  } else if (res && 'match_count' in res) {
    console.log(`match_count=${res.match_count} truncated=${!!res.truncated}`);
    for (const m of res.matches) console.log(`  - ${m.token}: ${m.name} — ${m.blurb}`);
  } else {
    console.log(JSON.stringify(res, null, 2));
  }
}

// Find a live Flame Phantom unit_id (active hostile) for the fusion-shortcut case.
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

show('by name "flame phantom"', await gameData('flame phantom'));
show('by token "DEMON_4"', await gameData('DEMON_4'));
show('vanilla creature "cat"', await gameData('cat'));

const uid = await liveHostileId();
console.log(`\n(live hostile unit_id = ${uid || 'none found'})`);
if (uid) show(`by live unit_id "${uid}"`, await gameData(uid));

show('kind filter kind="material"', await gameData('steel', 'material'));
show('kind filter creature "cat" kind="creature"', await gameData('cat', 'creature'));
show('no-match "zzqwx"', await gameData('zzqwx'));

process.exit(0);

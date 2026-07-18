// Live verification for the game_data tool across ALL kinds.
// Exercises, per kind, the exact-hit / disambiguation / no-match contract, plus
// regression guards for two shipped-and-fixed bugs: an improvement reaction
// (GLAZE_JUG) that used to raise a Lua traceback, and food itemdefs whose empty
// `stats` used to serialize as [] instead of {}. Prints concise evidence and
// exits non-zero if any assertion fails.
// Requires Dwarf Fortress running with DFHack and a fort loaded.
//   node scripts/verify-game-data.mjs
import { gameData } from '../src/tools/gameData.ts';
import { runLua } from '../src/dfclient.ts';

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failures++;
    console.log(`  ✗ FAIL: ${msg}`);
  }
}

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
  return res;
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

show('kind filter creature "cat" kind="creature"', await gameData('cat', 'creature'));
show('no-match "zzqwx"', await gameData('zzqwx'));

// ---- MATERIAL ------------------------------------------------------------
{
  const iron = show('material exact "iron"', await gameData('iron', 'material'));
  assert(iron.kind === 'material' && iron.token, 'material exact -> dossier');
  const ore = show('material disambiguation "ore"', await gameData('ore', 'material'));
  assert('match_count' in ore, 'material ambiguous -> disambiguation list');
  const none = await gameData('zzqwx', 'material');
  assert('match_count' in none && none.match_count === 0, 'material no-match -> {match_count:0}');
}

// ---- PLANT ---------------------------------------------------------------
{
  const ph = show('plant exact "plump helmet"', await gameData('plump helmet', 'plant'));
  assert(ph.kind === 'plant' && Array.isArray(ph.yields), 'plant exact -> dossier');
  const wood = show('plant disambiguation "wood"', await gameData('wood', 'plant'));
  assert('match_count' in wood, 'plant ambiguous -> disambiguation list');
}

// ---- REACTION (incl. improvement-product regression guard) ---------------
{
  const soap = show('reaction exact "MAKE_SOAP_FROM_TALLOW"', await gameData('MAKE_SOAP_FROM_TALLOW', 'reaction'));
  assert(soap.kind === 'reaction' && Array.isArray(soap.products), 'reaction exact -> dossier');
  // GLAZE_JUG is an improvement product; a dossier here (NOT an error) proves the
  // polymorphic-product traceback stays fixed.
  const glaze = show('reaction improvement "GLAZE_JUG"', await gameData('GLAZE_JUG', 'reaction'));
  assert(!('error' in glaze) && glaze.kind === 'reaction', 'GLAZE_JUG -> dossier, no traceback');
  assert(
    Array.isArray(glaze.products) && glaze.products.some((p) => p.improvement),
    'improvement product reported as a labeled fact'
  );
}

// ---- ITEM (incl. empty-stats shape regression guard) ---------------------
{
  const pick = show('item exact "pick"', await gameData('pick', 'item'));
  assert(pick.kind === 'item' && Array.isArray(pick.attacks), 'weapon item -> dossier with attacks');
  // A food itemdef has no stats; stats must be an object {}, never [].
  const food = show('item food (empty stats)', await gameData('roast', 'item'));
  const foodStats = 'stats' in food ? food.stats : ('match_count' in food ? '(list)' : undefined);
  if (food.kind === 'item') {
    assert(foodStats && !Array.isArray(foodStats) && typeof foodStats === 'object', 'food stats is {} not []');
  }
  const many = show('item disambiguation "a"', await gameData('a', 'item'));
  assert('match_count' in many && many.matches.length <= 8, 'item ambiguous -> capped list');
}

// ---- BUILDING ------------------------------------------------------------
{
  const soap = show('building exact "soap"', await gameData('soap', 'building'));
  assert(soap.kind === 'building' && Array.isArray(soap.reactions), 'building exact -> dossier');
  const none = await gameData('zzqwx', 'building');
  assert('match_count' in none && none.match_count === 0, 'building no-match -> {match_count:0}');
}

console.log(`\n${failures === 0 ? '✓ all game_data assertions passed' : `✗ ${failures} assertion(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);

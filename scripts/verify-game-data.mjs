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

// match_count===0 must NOT satisfy an "ambiguous" assertion.
const isList = (r) =>
  'match_count' in r && r.match_count > 1 && Array.isArray(r.matches) && r.matches.length > 1 && r.matches.length <= 8;
const isNone = (r) => 'match_count' in r && r.match_count === 0;

{
  const iron = show('material exact "iron"', await gameData('iron', 'material'));
  assert(iron.kind === 'material' && iron.token, 'material exact -> dossier');
  const ore = show('material disambiguation "ore"', await gameData('ore', 'material'));
  assert(isList(ore), 'material ambiguous -> real disambiguation list (>1)');
  assert(isNone(show('material no-match "zzqwx"', await gameData('zzqwx', 'material'))), 'material no-match -> {match_count:0}');
}

{
  const ph = show('plant exact "plump helmet"', await gameData('plump helmet', 'plant'));
  assert(ph.kind === 'plant' && Array.isArray(ph.yields), 'plant exact -> dossier');
  const wood = show('plant disambiguation "wood"', await gameData('wood', 'plant'));
  assert(isList(wood), 'plant ambiguous -> real disambiguation list (>1)');
  assert(isNone(show('plant no-match "zzqwx"', await gameData('zzqwx', 'plant'))), 'plant no-match -> {match_count:0}');
}

{
  const soap = show('reaction exact "MAKE_SOAP_FROM_TALLOW"', await gameData('MAKE_SOAP_FROM_TALLOW', 'reaction'));
  assert(
    soap.kind === 'reaction' && Array.isArray(soap.products) && Array.isArray(soap.buildings),
    'reaction exact -> dossier with buildings[]'
  );
  // A reaction that runs at several buildings must report all of them.
  const pearl = show('reaction multi-building "MAKE_PEARLASH"', await gameData('MAKE_PEARLASH', 'reaction'));
  assert(pearl.kind === 'reaction' && pearl.buildings.length > 1, 'multi-building reaction lists all buildings');
  // GLAZE_JUG is an improvement product; a dossier here (not an error) proves the polymorphic-product traceback stays fixed.
  const glaze = show('reaction improvement "GLAZE_JUG"', await gameData('GLAZE_JUG', 'reaction'));
  assert(!('error' in glaze) && glaze.kind === 'reaction', 'GLAZE_JUG -> dossier, no traceback');
  assert(
    Array.isArray(glaze.products) && glaze.products.some((p) => p.improvement),
    'improvement product reported as a labeled fact'
  );
  assert(isList(show('reaction disambiguation "glaze"', await gameData('glaze', 'reaction'))), 'reaction ambiguous -> real list (>1)');
  assert(isNone(show('reaction no-match "zzqwx"', await gameData('zzqwx', 'reaction'))), 'reaction no-match -> {match_count:0}');
}

{
  const pick = show('item exact "pick"', await gameData('pick', 'item'));
  assert(pick.kind === 'item' && Array.isArray(pick.attacks), 'weapon item -> dossier with attacks');
  // A food itemdef's stats must serialize as an object {}, never [] (regression guard).
  const food = show('item food "roast"', await gameData('roast', 'item'));
  assert(
    food.kind === 'item' && !Array.isArray(food.stats) && typeof food.stats === 'object',
    'food resolves to a dossier with stats {} not []'
  );
  assert(isList(show('item disambiguation "a"', await gameData('a', 'item'))), 'item ambiguous -> real capped list (>1, <=8)');
}

{
  const soap = show('building exact "soap"', await gameData('soap', 'building'));
  assert(soap.kind === 'building' && Array.isArray(soap.reactions), 'building exact -> dossier');
  assert(isList(show('building disambiguation "s"', await gameData('s', 'building'))), 'building ambiguous -> real list (>1)');
  assert(isNone(show('building no-match "zzqwx"', await gameData('zzqwx', 'building'))), 'building no-match -> {match_count:0}');
}

console.log(`\n${failures === 0 ? '✓ all game_data assertions passed' : `✗ ${failures} assertion(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);

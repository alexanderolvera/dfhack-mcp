// ============================================================================
// Why this folder (src/dfhack-queries/) exists
// ----------------------------------------------------------------------------
// Every file here is a DFHack query snippet: Lua embedded in a TS template
// string, run via `lua <chunk>` (RunCommand), that gathers game state and prints
// ONE JSON object. This is the version-FRAGILE boundary — the exact field paths
// (df.global.*, dfhack.units.*, caste.flags, ...) can shift between DF/DFHack
// builds. Keeping ALL of that field access confined to this one folder means a
// DF/DFHack version bump is a localized fix: you edit the query snippets here,
// never the tool wrappers, the server, or the wiki code.
//
// Parallels src/wiki/ (the other external-boundary folder). One file per query;
// the shared Lua helpers live below. All queries are verified against a live
// fort before shipping — see scripts/call-tool.mjs.
//
// Field/API notes, confirmed live on DFHack 53.15-r2:
//   * arbitrary Lua: `lua <chunk>` as a single arg (NOT `-e`, console-only)
//   * name:    dfhack.translation.translateName(name, true)
//   * date:    df.global.cur_year, cur_year_tick; 1200 ticks/day, 33600/month
//   * pop:     dfhack.units.getCitizens(true)
//   * stress:  dfhack.units.getStressCategory(u) -> 0 (miserable) .. 6 (ecstatic)
//   * wealth:  df.global.plotinfo.tasks.wealth.total
//   * hostile: isActive && !isDead && isDanger && !isCitizen
// ============================================================================

/**
 * Standard query preamble: the JSON emitter plus the "must be in fortress mode"
 * guard that every query shares. `errMsg` is what the caller sees when no fort
 * (or, for the reference tools, no game) is loaded.
 */
export function preamble(errMsg = 'no fort loaded'): string {
  return String.raw`
local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = '${errMsg}' })
  return
end
`;
}

/** Escape an arbitrary string into a safe Lua single-quoted literal, so an
 *  injected search term can't break out of the chunk or inject Lua. */
export function luaStr(s: string): string {
  return (
    "'" +
    s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n') +
    "'"
  );
}

/** Stress-category (0..6) -> label, as a Lua table literal for in-chunk lookup. */
export const STRESS_LABELS =
  "{[0]='miserable',[1]='unhappy',[2]='unhappy',[3]='content',[4]='content',[5]='happy',[6]='ecstatic'}";

/** Advisor-relevant caste flag tokens. Only these are surfaced from the (large)
 *  raw flag bitfield. We read pairs(caste.flags) and keep TRUE keys in this set,
 *  so a token absent from a given creature's build simply never appears — no
 *  indexing by token, no crash. Expressed as a Lua table literal (token -> 1). */
export const CREATURE_FLAG_WHITELIST =
  '{DEMON=1,UNIQUE_DEMON=1,MEGABEAST=1,SEMIMEGABEAST=1,NIGHT_CREATURE_HUNTER=1,' +
  'NIGHT_CREATURE_BOGEYMAN=1,NIGHT_CREATURE_NIGHTMARE=1,NIGHT_CREATURE_EXPERIMENT=1,' +
  'FLIER=1,BUILDINGDESTROYER=1,FIREIMMUNE=1,FIREIMMUNE_SUPER=1,LARGE_PREDATOR=1,' +
  'TRAPAVOID=1,WEBIMMUNE=1,WEBBER=1,NOT_LIVING=1,OPPOSED_TO_LIFE=1,SUPERNATURAL=1,' +
  'EXTRAVISION=1,MAGMA_VISION=1,CAN_LEARN=1,CAN_SPEAK=1,NOFEAR=1,NOPAIN=1,NOSTUN=1,' +
  'NO_SLEEP=1,NO_EAT=1,NO_DRINK=1,MISCHIEVOUS=1,AMPHIBIOUS=1,VENOMOUS=1,' +
  'MOUNT=1,PET=1,COMMON_DOMESTIC=1,POWER=1,MANNERISM_LAUGH=0}';

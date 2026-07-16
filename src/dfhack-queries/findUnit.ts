// find_unit(query): a dossier on citizens matching a name or profession.
//
// The one parameterized query. The search term is injected as a Lua single-
// quoted literal via luaStr() (escapes \\ ' newline) so it can't break the chunk
// or inject Lua. Matches case-insensitively against the readable name AND the
// profession, so "medical" finds the chief medical dwarf and a partial name
// finds the dwarf. Returns a compact profile per match: profession, age, stress,
// current job, squad, and a health summary.
//
// Verified live on 53.15-r2: getReadableName, getProfessionName, getAge,
// getStressCategory all present; squad lookup via squads.all by id.

import { luaStr, STRESS_LABELS, preamble } from './shared.ts';

export function findUnitQuery(query: string): string {
  return String.raw`${preamble()}
local q = string.lower(${luaStr(query)})
local STRESS = ${STRESS_LABELS}
local MAX = 8

-- Pre-index fort squads by id for name lookup.
local squad_name = {}
local fort = df.global.plotinfo.main.fortress_entity
for _, sq in ipairs(df.global.world.squads.all) do
  if fort and sq.entity_id == fort.id then
    local ok, nm = pcall(function() return dfhack.translation.translateName(sq.name, true) end)
    squad_name[sq.id] = (ok and nm ~= '' and nm) or (sq.alias ~= '' and sq.alias) or ('Squad ' .. sq.id)
  end
end

local matches = {}
local total = 0
for _, u in ipairs(dfhack.units.getCitizens(true)) do
  local name = dfhack.units.getReadableName(u)
  local prof = dfhack.units.getProfessionName(u)
  if string.find(string.lower(name), q, 1, true) or string.find(string.lower(prof), q, 1, true) then
    total = total + 1
    if #matches < MAX then
      local cj = u.job.current_job
      local sc = dfhack.units.getStressCategory(u)
      local sid = u.military and u.military.squad_id or -1
      matches[#matches+1] = {
        name       = name,
        profession = prof,
        age        = math.floor(dfhack.units.getAge(u, true)),
        stress     = STRESS[sc] or tostring(sc),
        current_job = cj and (df.job_type[cj.job_type] or tostring(cj.job_type)) or 'idle',
        squad      = (sid ~= -1 and squad_name[sid]) or nil,
        wounded    = (u.body and u.body.wounds and #u.body.wounds > 0) or false,
        patient    = (u.health and u.health.flags and u.health.flags.needs_healthcare) or false,
        unconscious = (u.counters and u.counters.unconscious and u.counters.unconscious > 0) or false,
      }
    end
  end
end

emit({
  query = ${luaStr(query)},
  match_count = total,
  truncated = total > #matches,
  matches = matches,
})
`;
}

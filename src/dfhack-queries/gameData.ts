// game_data(query, kind): look up the LOADED WORLD's raws (df.global.world.raws.*)
// — ground truth for THIS world, the only source for procedural creatures
// (demons/forgotten beasts/titans, which are never on the wiki).
//
// One unified query with a per-kind dispatch so new kinds (material/plant/reaction/
// item/building) drop in without a new tool. MVP implements the CREATURE kind;
// other kinds return {error:"kind 'X' not yet implemented"}.
//
// CREATURE matching contract:
//   * query is all digits            -> treat as a live unit_id (fusion shortcut):
//                                        df.unit.find(id).race indexes
//                                        raws.creatures.all -> that unit's race.
//   * exact creature_id token match  -> single strong hit (dossier).
//   * exact name/caste_name match    -> single strong hit (dossier).
//   * otherwise case-insensitive substring against creature_id + the name tuple
//     (singular/plural/adjective) + every caste_name. Exactly one match ->
//     dossier; several -> a disambiguation list (cap 8), mirroring find_unit;
//     none -> {match_count:0, matches:[]}.
//
// Verified live on DFHack 53.15-r2 against the two "Flame Phantom" demons
// (DEMON_4, unit_id 18393, race 1661). Confirmed version-fragile field paths:
//   * df.global.world.raws.creatures.all[race]  -> creature_raw
//   * cr.creature_id (token), cr.name[0..2] (singular/plural/adjective)
//   * cr.adultsize (body volume, cm^3), cr.caste (vector; the field is `caste`,
//     NOT `castes`), caste.caste_name[0..2], caste.description (a ready blurb),
//     caste.flags (a bitfield whose TRUE keys are stable token names — iterate
//     pairs(); NOT indexed by df.caste_raw_flags, so we never index it by token)
//   * caste.body_info.attacks[].{name,verb_3rd} (dup per left/right bp -> dedupe)
//   * caste.body_info.interactions[].interaction.adv_name (breath weapon label,
//     e.g. "Hurl fireball"/"Spray jet of fire"/"Emit dust") + material_str0..2
//     (the emitted material token, e.g. CREATURE_MAT:DEMON_4:POISON — the dust's
//     syndrome material). The syndrome vector on the resolved material reads 0 in
//     this build, so we surface the emission material token rather than traverse
//     a fragile/empty syndrome path.
//   * df.unit.find(id).race for the unit_id shortcut.

import { luaStr, CREATURE_FLAG_WHITELIST, preamble } from './shared.ts';

export function gameDataQuery(query: string, kind?: string): string {
  return String.raw`${preamble('no game loaded')}
local query = ${luaStr(query)}
local kind = ${luaStr(kind ?? '')}
if kind == '' then kind = 'creature' end

local FLAG_WL = ${CREATURE_FLAG_WHITELIST}
local MAX = 8
local creatures = df.global.world.raws.creatures.all

local function trim(s) return (tostring(s):gsub('^%s*(.-)%s*$', '%1')) end

-- DF body volume (cm^3) -> a glanceable size bucket.
local function size_label(v)
  if v < 1000 then return 'tiny'
  elseif v < 15000 then return 'small'
  elseif v < 100000 then return 'medium'
  elseif v < 500000 then return 'large'
  elseif v < 2000000 then return 'huge'
  else return 'gigantic' end
end

-- First sentence of a caste description -> a short human blurb.
local function first_sentence(desc)
  if not desc or desc == '' then return nil end
  local dot = string.find(desc, '%.')
  if dot then return trim(string.sub(desc, 1, dot)) end
  return trim(desc)
end

-- Curated advisor flags, unioned across all castes (a bitfield of stable token
-- keys; we only keep TRUE keys that are whitelisted).
local function creature_flags(cr)
  local set = {}
  for ci = 0, #cr.caste - 1 do
    local caste = cr.caste[ci]
    for k, v in pairs(caste.flags) do
      if v == true and FLAG_WL[k] then set[k] = true end
    end
    -- Building destroyer is NOT a caste.flags bit in this build; it's a numeric
    -- at caste.misc.buildingdestroyer (confirmed: DEMON_4 = 2, TROLL = 2). Surface
    -- it as a synthetic BUILDINGDESTROYER flag so the whitelisted token isn't dead
    -- and consumers (identify's tactics) see it alongside the real flags.
    local bd = 0
    pcall(function() bd = caste.misc.buildingdestroyer or 0 end)
    if bd and bd > 0 then set.BUILDINGDESTROYER = true end
  end
  local out = {}
  for k in pairs(set) do out[#out+1] = k end
  table.sort(out)
  return out
end

-- Melee attacks, deduped by name (raws list one per left/right body part).
local function creature_attacks(caste)
  local seen, out = {}, {}
  for _, a in ipairs(caste.body_info.attacks) do
    if a.name and a.name ~= '' and not seen[a.name] then
      seen[a.name] = true
      out[#out+1] = { name = a.name, verb = (a.verb_3rd ~= '' and a.verb_3rd) or nil }
    end
  end
  return out
end

-- Breath weapons / creature interactions: the human adv_name plus the emitted
-- material token (which carries the syndrome, e.g. dust) when present.
local function creature_interactions(caste)
  local out = {}
  for _, ci in ipairs(caste.body_info.interactions) do
    local it = ci.interaction
    local nm = it.adv_name
    if nm and nm ~= '' then
      local parts = {}
      for _, s in ipairs({ it.material_str0, it.material_str1, it.material_str2 }) do
        if s and s ~= '' then parts[#parts+1] = s end
      end
      out[#out+1] = {
        name = nm,
        material = (#parts > 0) and table.concat(parts, ':') or nil,
      }
    end
  end
  return out
end

local function best_caste(cr)
  return cr.caste[0]
end

-- Full curated dossier for one creature_raw.
local function dossier(cr, unit_id, unit_name)
  local caste = best_caste(cr)
  local desc = caste.description
  return {
    kind        = 'creature',
    token       = tostring(cr.creature_id),
    name        = tostring(cr.name[0]),
    plural      = (cr.name[1] ~= '' and tostring(cr.name[1])) or nil,
    caste_count = #cr.caste,
    size        = cr.adultsize,
    size_label  = size_label(cr.adultsize),
    flags       = creature_flags(cr),
    attacks     = creature_attacks(caste),
    interactions = creature_interactions(caste),
    description = (desc ~= '' and desc) or nil,
    blurb       = first_sentence(desc),
    unit_id     = unit_id,
    unit_name   = unit_name,
  }
end

-- Compact entry for a disambiguation list.
local function stub(cr)
  local blurb = first_sentence(best_caste(cr).description)
  if not blurb then
    local fl = creature_flags(cr)
    blurb = size_label(cr.adultsize) .. ' ' .. (fl[1] and string.lower(fl[1]) or 'creature')
  end
  return { kind = 'creature', token = tostring(cr.creature_id),
           name = tostring(cr.name[0]), blurb = blurb }
end

local function lc(s) return string.lower(tostring(s)) end

-- ---- CREATURE kind -------------------------------------------------------
local function find_creature(q)
  -- Fusion shortcut: an all-digits query is a live unit_id.
  if string.match(q, '^%d+$') then
    local u = df.unit.find(tonumber(q))
    if not u then
      emit({ query = query, match_count = 0, matches = {} })
      return
    end
    local cr = creatures[u.race]
    if not cr then
      emit({ query = query, match_count = 0, matches = {} })
      return
    end
    local ok, nm = pcall(dfhack.units.getReadableName, u)
    emit(dossier(cr, u.id, ok and nm or nil))
    return
  end

  local ql = lc(q)
  local all, exact = {}, {}
  for i = 0, #creatures - 1 do
    local cr = creatures[i]
    local token = tostring(cr.creature_id)
    -- gather candidate names: creature name tuple + every caste_name
    local hit, is_exact = false, false
    if lc(token) == ql then is_exact = true; hit = true
    elseif string.find(lc(token), ql, 1, true) then hit = true end
    for n = 0, 2 do
      local nm = cr.name[n]
      if nm and nm ~= '' then
        if lc(nm) == ql then is_exact = true; hit = true
        elseif string.find(lc(nm), ql, 1, true) then hit = true end
      end
    end
    if not hit then
      for ci = 0, #cr.caste - 1 do
        local cn = cr.caste[ci].caste_name[0]
        if cn and cn ~= '' then
          if lc(cn) == ql then is_exact = true; hit = true; break
          elseif string.find(lc(cn), ql, 1, true) then hit = true; break end
        end
      end
    end
    if hit then
      all[#all+1] = cr
      if is_exact then exact[#exact+1] = cr end
    end
  end

  -- One strong (exact) hit, or a single overall hit -> a full dossier.
  if #exact == 1 then emit(dossier(exact[1])); return end
  if #all == 1 then emit(dossier(all[1])); return end

  -- Otherwise a disambiguation list (cap MAX), mirroring find_unit.
  local matches = {}
  for i = 1, math.min(#all, MAX) do matches[#matches+1] = stub(all[i]) end
  emit({
    query = query,
    match_count = #all,
    truncated = #all > #matches,
    matches = matches,
  })
end

local UNIMPLEMENTED = { material = 1, plant = 1, reaction = 1, item = 1, building = 1 }
local DISPATCH = { creature = find_creature }

if DISPATCH[kind] then
  DISPATCH[kind](query)
elseif UNIMPLEMENTED[kind] then
  emit({ error = "kind '" .. kind .. "' not yet implemented" })
else
  emit({ error = "unknown kind '" .. kind .. "'" })
end
`;
}

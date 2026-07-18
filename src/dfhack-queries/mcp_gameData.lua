-- mcp_gameData(query, kind): look up the LOADED WORLD's raws (df.global.world.raws.*)
-- — ground truth for THIS world, the only source for procedural creatures
-- (demons/forgotten beasts/titans, which are never on the wiki).
--
-- One unified query with a per-kind dispatch. Implemented kinds: CREATURE,
-- MATERIAL, PLANT, REACTION, ITEM, BUILDING. Every kind mirrors the creature
-- matching contract: a single strong (exact) hit -> a curated dossier; several
-- -> a disambiguation list (cap 8); none -> {match_count:0, matches:[]}.
--
-- Field paths for the non-creature kinds were probed live on DFHack 53.15-r2
-- against the Dreamfort fort and are version-fragile. Confirmed paths:
--   * MATERIAL: dfhack.matinfo (find(token) / decode(0, inorganic_index)); the
--     searchable universe is df.global.world.raws.inorganics.all (metals, stones,
--     gems, ores). mi:getToken(), mi.material.state_name.{Solid,Liquid,Gas},
--     .heat.{melting_point,boiling_point,ignite_point} (60001 == none),
--     .solid_density/.liquid_density (-1 == n/a), .flags (bitfield of stable
--     token keys). DF temperature urists convert to Fahrenheit via (urist-9968).
--   * PLANT: df.global.world.raws.plants.all -> plant_raw. .id/.name/.name_plural,
--     .flags (TREE/GRASS decide type, SPRING..WINTER seasons, BIOME_* biomes),
--     .underground_depth_min (0 == surface), .material_defs.type[df.plant_material_def]
--     (>=0 means that yield exists: drink/seed/thread/mill/extract_*), .growths[],
--     .material[] (produced materials).
--   * REACTION: df.global.world.raws.reactions.reactions -> reaction. .code/.name,
--     .skill (df.job_skill), .building.type[0] (df.building_type) + .subtype[0]
--     (df.workshop_type / df.furnace_type) + .custom[0] (links to a custom
--     building_def by its .id), .reagents[]/.products[] (item_type via df.item_type,
--     reaction_class carries a material class).
--   * ITEM: df.global.world.raws.itemdefs.all -> itemdef_*st. Class from the type
--     name (itemdef_<class>st). .id/.name/.name_plural/.adjective/.value + a
--     per-class stat whitelist read defensively (missing fields pcall-skipped).
--   * BUILDING: df.global.world.raws.buildings.all -> building_def_workshopst
--     (custom, raws-defined workshops only; built-in shops are hardcoded, not in
--     raws). .code/.name/.building_type/.labor_description/.dim_x/.dim_y, plus the
--     reactions whose .building.custom[0] == this def's .id.
--
-- Parameters arrive as native argv (args[1]=query, args[2]=kind), so there is NO
-- escaping — the search term is just data.
--
-- CREATURE matching contract:
--   * query is all digits            -> treat as a live unit_id (fusion shortcut):
--                                        df.unit.find(id).race indexes
--                                        raws.creatures.all -> that unit's race.
--   * exact creature_id token match  -> single strong hit (dossier).
--   * exact name/caste_name match    -> single strong hit (dossier).
--   * otherwise case-insensitive substring against creature_id + the name tuple
--     (singular/plural/adjective) + every caste_name. Exactly one match ->
--     dossier; several -> a disambiguation list (cap 8), mirroring find_unit;
--     none -> {match_count:0, matches:[]}.
--
-- Verified live on DFHack 53.15-r2 against the two "Flame Phantom" demons
-- (DEMON_4, unit_id 18393, race 1661). Confirmed version-fragile field paths:
--   * df.global.world.raws.creatures.all[race]  -> creature_raw
--   * cr.creature_id (token), cr.name[0..2] (singular/plural/adjective)
--   * cr.adultsize (body volume, cm^3), cr.caste (vector; the field is `caste`,
--     NOT `castes`), caste.caste_name[0..2], caste.description (a ready blurb),
--     caste.flags (a bitfield whose TRUE keys are stable token names — iterate
--     pairs(); NOT indexed by df.caste_raw_flags, so we never index it by token)
--   * caste.body_info.attacks[].{name,verb_3rd} (dup per left/right bp -> dedupe)
--   * caste.body_info.interactions[].interaction.adv_name (breath weapon label,
--     e.g. "Hurl fireball"/"Spray jet of fire"/"Emit dust") + material_str0..2
--     (the emitted material token, e.g. CREATURE_MAT:DEMON_4:POISON — the dust's
--     syndrome material). The syndrome vector on the resolved material reads 0 in
--     this build, so we surface the emission material token rather than traverse
--     a fragile/empty syndrome path.
--   * df.unit.find(id).race for the unit_id shortcut.
-- Invoked by name via DFHack RunCommand; prints ONE JSON object.

local args = {...}
local query = args[1] or ''
local kind = args[2] or ''

local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no game loaded' })
  return
end

if kind == '' then kind = 'creature' end

local FLAG_WL = {DEMON=1,UNIQUE_DEMON=1,MEGABEAST=1,SEMIMEGABEAST=1,NIGHT_CREATURE_HUNTER=1,
  NIGHT_CREATURE_BOGEYMAN=1,NIGHT_CREATURE_NIGHTMARE=1,NIGHT_CREATURE_EXPERIMENT=1,
  FLIER=1,BUILDINGDESTROYER=1,FIREIMMUNE=1,FIREIMMUNE_SUPER=1,LARGE_PREDATOR=1,
  TRAPAVOID=1,WEBIMMUNE=1,WEBBER=1,NOT_LIVING=1,OPPOSED_TO_LIFE=1,SUPERNATURAL=1,
  EXTRAVISION=1,MAGMA_VISION=1,CAN_LEARN=1,CAN_SPEAK=1,NOFEAR=1,NOPAIN=1,NOSTUN=1,
  NO_SLEEP=1,NO_EAT=1,NO_DRINK=1,MISCHIEVOUS=1,AMPHIBIOUS=1,VENOMOUS=1,
  MOUNT=1,PET=1,COMMON_DOMESTIC=1,POWER=1,MANNERISM_LAUGH=0}
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

-- Generic exact-then-substring searcher shared by every non-creature kind.
-- `entries` is a list of records; `keys(rec)` returns that record's searchable
-- strings; `dossier1(rec)` builds a full dossier; `stub1(rec)` a compact entry.
-- Mirrors the creature contract: one exact hit, or one overall hit -> dossier;
-- else a capped disambiguation list.
local function search(q, entries, keys, dossier1, stub1)
  local ql = lc(q)
  local all, exact = {}, {}
  for _, rec in ipairs(entries) do
    local hit, is_exact = false, false
    for _, s in ipairs(keys(rec)) do
      if s and s ~= '' then
        if lc(s) == ql then is_exact = true; hit = true
        elseif string.find(lc(s), ql, 1, true) then hit = true end
      end
    end
    if hit then
      all[#all+1] = rec
      if is_exact then exact[#exact+1] = rec end
    end
  end
  if #exact == 1 then emit(dossier1(exact[1])); return true end
  if #all == 1 then emit(dossier1(all[1])); return true end
  if #all == 0 then return false end
  -- Cap the disambiguation list at MAX, but list exact matches first so the
  -- record the caller most likely meant is never truncated out of view.
  local matches, seen = {}, {}
  for _, rec in ipairs(exact) do
    if #matches >= MAX then break end
    matches[#matches+1] = stub1(rec); seen[rec] = true
  end
  for _, rec in ipairs(all) do
    if #matches >= MAX then break end
    if not seen[rec] then matches[#matches+1] = stub1(rec) end
  end
  emit({ query = query, match_count = #all, truncated = #all > #matches, matches = matches })
  return true
end

local function emit_empty()
  emit({ query = query, match_count = 0, matches = {} })
end

-- Safe field read: DFHack raises when a field is absent from a polymorphic
-- subclass (e.g. a non-item reaction product), so read subclass-specific or
-- optional fields through pcall and treat a miss as nil.
local function sget(obj, field)
  local ok, v = pcall(function() return obj[field] end)
  if ok then return v end
  return nil
end

-- Assemble an ITEM_TYPE[:SUBTYPE] token from a reagent or product. item_type /
-- item_str live only on the *_itemst subclasses, so read them defensively — a
-- non-item reagent/product (e.g. an improvement) yields nil instead of raising.
local function item_token(obj)
  local parts = {}
  local it = sget(obj, 'item_type')
  if it and it >= 0 then parts[#parts+1] = tostring(df.item_type[it]) end
  local istr = sget(obj, 'item_str')
  if istr and #istr > 0 and tostring(istr[0]) ~= '' then parts[#parts+1] = tostring(istr[0]) end
  return (#parts > 0) and table.concat(parts, ':') or nil
end

-- ---- MATERIAL kind -------------------------------------------------------
-- DF temperature is stored in "urists": degF = urist - 9968. 60001 is the
-- sentinel for "no such point" (won't melt / boil / ignite); a real 60000 is kept.
local function temp_fact(urist)
  if not urist or urist > 60000 then return nil end
  local f = urist - 9968
  return { urist = urist, celsius = math.floor((f - 32) * 5 / 9 + 0.5) }
end

local MAT_FLAG_WL = {IS_METAL=1,IS_STONE=1,IS_GEM=1,IS_GLASS=1,EDIBLE_RAW=1,
  EDIBLE_COOKED=1,EDIBLE_VERMIN=1,ALCOHOL=1,ALCOHOL_PLANT=1,POWDER_MISC=1,
  LEATHER=1,SILK=1,THREAD_PLANT=1,YARN=1,BONE=1,SHELL=1,ITEMS_WEAPON=1,
  ITEMS_ARMOR=1,ITEMS_ANVIL=1,ITEMS_DIGGER=1,ITEMS_AMMO=1,ITEMS_HARD=1,
  ITEMS_METAL=1}

local function mat_flags(m)
  local out = {}
  for k, v in pairs(m.flags) do if v == true and MAT_FLAG_WL[k] then out[#out+1] = k end end
  table.sort(out)
  return out
end

local function material_dossier(mi)
  local m = mi.material
  local sn = m.state_name
  local density = {}
  if m.solid_density and m.solid_density >= 0 then density.solid = m.solid_density end
  if m.liquid_density and m.liquid_density >= 0 then density.liquid = m.liquid_density end
  return {
    kind = 'material',
    token = tostring(mi:getToken()),
    name = tostring(sn.Solid),
    state_names = {
      solid = tostring(sn.Solid),
      liquid = (sn.Liquid ~= '' and tostring(sn.Liquid)) or nil,
      gas = (sn.Gas ~= '' and tostring(sn.Gas)) or nil,
    },
    melting_point = temp_fact(m.heat.melting_point),
    boiling_point = temp_fact(m.heat.boiling_point),
    ignite_point = temp_fact(m.heat.ignite_point),
    flammable = (m.heat.ignite_point and m.heat.ignite_point <= 60000) or false,
    density = density,
    flags = mat_flags(m),
  }
end

local function material_stub(mi)
  local m = mi.material
  local fl = mat_flags(m)
  local blurb = fl[1] and string.gsub(lc(string.gsub(fl[1], '_', ' ')), '^is ', '') or 'material'
  return { kind = 'material', token = tostring(mi:getToken()),
           name = tostring(m.state_name.Solid), blurb = blurb }
end

local function find_material(q)
  -- A fully-qualified token (has a ':') is a direct matinfo lookup — this reaches
  -- non-inorganic materials (PLANT/CREATURE tissues) the inorganic index misses.
  if string.find(q, ':', 1, true) then
    local ok, mi = pcall(dfhack.matinfo.find, q)
    if ok and mi then emit(material_dossier(mi)); return end
  end
  local inr = df.global.world.raws.inorganics.all
  local entries = {}
  for i = 0, #inr - 1 do entries[#entries+1] = { idx = i, raw = inr[i] } end
  local handled = search(
    q, entries,
    function(rec) return { tostring(rec.raw.id), tostring(rec.raw.material.state_name.Solid) } end,
    function(rec) return material_dossier(dfhack.matinfo.decode(0, rec.idx)) end,
    function(rec) return material_stub(dfhack.matinfo.decode(0, rec.idx)) end
  )
  if handled then return end
  -- No inorganic matched: try a bare-token matinfo lookup (builtin materials
  -- like WATER / COAL), else report no matches.
  local ok, mi = pcall(dfhack.matinfo.find, q)
  if ok and mi then emit(material_dossier(mi)); return end
  emit_empty()
end

-- ---- PLANT kind ----------------------------------------------------------
local PLANT_SEASONS = { 'SPRING', 'SUMMER', 'AUTUMN', 'WINTER' }
-- df.plant_material_def index -> yield label (0 basic_mat / 1 tree omitted).
local PLANT_YIELDS = {
  { idx = 2, label = 'drink' }, { idx = 3, label = 'seed' },
  { idx = 4, label = 'thread' }, { idx = 5, label = 'mill' },
  { idx = 6, label = 'extract_vial' }, { idx = 7, label = 'extract_barrel' },
  { idx = 8, label = 'extract_still_vial' },
}

local function plant_type(p)
  if p.flags.TREE then return 'tree'
  elseif p.flags.GRASS then return 'grass'
  else return 'shrub' end
end

local function plant_seasons(p)
  local out = {}
  for _, s in ipairs(PLANT_SEASONS) do if p.flags[s] then out[#out+1] = s end end
  return out
end

local function plant_biomes(p)
  local out = {}
  for k, v in pairs(p.flags) do
    if v == true and string.sub(k, 1, 6) == 'BIOME_' then out[#out+1] = string.sub(k, 7) end
  end
  table.sort(out)
  return out
end

local function plant_yields(p)
  local md = p.material_defs
  local out = {}
  for _, y in ipairs(PLANT_YIELDS) do
    local t = md.type[y.idx]
    if t and t >= 0 then out[#out+1] = y.label end
  end
  return out
end

local function plant_growths(p)
  local out = {}
  for j = 0, #p.growths - 1 do
    local g = p.growths[j]
    out[#out+1] = { token = tostring(g.id), name = (g.name ~= '' and tostring(g.name)) or nil }
  end
  return out
end

local function plant_materials(p)
  local out = {}
  for j = 0, #p.material - 1 do
    local m = p.material[j]
    out[#out+1] = { token = tostring(m.id), name = tostring(m.state_name.Solid) }
  end
  return out
end

local function plant_dossier(p)
  return {
    kind = 'plant',
    token = tostring(p.id),
    name = tostring(p.name),
    plural = (p.name_plural ~= '' and tostring(p.name_plural)) or nil,
    type = plant_type(p),
    value = p.value,
    growth_time = p.growdur,
    seasons = plant_seasons(p),
    surface = p.underground_depth_min == 0,
    subterranean = p.underground_depth_min > 0,
    depth_min = p.underground_depth_min,
    depth_max = p.underground_depth_max,
    biomes = plant_biomes(p),
    yields = plant_yields(p),
    growths = plant_growths(p),
    materials = plant_materials(p),
  }
end

local function plant_stub(p)
  local loc = p.underground_depth_min > 0 and 'subterranean' or 'surface'
  return { kind = 'plant', token = tostring(p.id), name = tostring(p.name),
           blurb = loc .. ' ' .. plant_type(p) }
end

local function find_plant(q)
  local plants = df.global.world.raws.plants.all
  local entries = {}
  for i = 0, #plants - 1 do entries[#entries+1] = plants[i] end
  if not search(
    q, entries,
    function(p) return { tostring(p.id), tostring(p.name), tostring(p.name_plural), tostring(p.adj) } end,
    plant_dossier, plant_stub
  ) then emit_empty() end
end

-- ---- REACTION kind -------------------------------------------------------
local function reaction_building(r)
  local b = r.building
  if #b.type == 0 then return nil end
  local category = tostring(df.building_type[b.type[0]])
  local subtype = (#b.subtype > 0) and b.subtype[0] or -1
  local workshop
  if category == 'Workshop' and subtype >= 0 then workshop = tostring(df.workshop_type[subtype])
  elseif category == 'Furnace' and subtype >= 0 then workshop = tostring(df.furnace_type[subtype]) end
  local custom_token
  local custom = (#b.custom > 0) and b.custom[0] or -1
  if custom >= 0 then
    local defs = df.global.world.raws.buildings.all
    for i = 0, #defs - 1 do
      if defs[i].id == custom then custom_token = tostring(defs[i].code); break end
    end
  end
  return { category = category, workshop = workshop, custom = custom_token }
end

-- reaction_reagent is polymorphic too; item_token reads its fields defensively.
local function reagent_item(rg)
  return item_token(rg)
end

local function reagent_material(rg)
  local parts = {}
  for j = 0, #rg.material_str - 1 do
    local s = tostring(rg.material_str[j])
    if s ~= '' then parts[#parts+1] = s end
  end
  if #parts > 0 then return table.concat(parts, ':') end
  if rg.reaction_class ~= '' then return 'class:' .. rg.reaction_class end
  return nil
end

local function reaction_reagents(r)
  local out = {}
  for j = 0, #r.reagents - 1 do
    local rg = r.reagents[j]
    out[#out+1] = {
      label = (rg.code ~= '' and tostring(rg.code)) or nil,
      quantity = rg.quantity,
      item = reagent_item(rg),
      material = reagent_material(rg),
    }
  end
  return out
end

-- reaction.products is polymorphic: reaction_product_itemst carries
-- item_type/count, but improvement products (glaze/encrust/stud/sew-image) do
-- NOT — reading those fields on them raises. Read everything defensively and,
-- for a non-item product, report the improvement kind as a labeled fact.
local function reaction_products(r)
  local out = {}
  for j = 0, #r.products - 1 do
    local pr = r.products[j]
    local item = item_token(pr)
    if not item then
      local tok = sget(pr, 'product_token')
      if tok and tok ~= '' then item = tostring(tok) end
    end
    local entry = { item = item, quantity = sget(pr, 'count') }
    local prob = sget(pr, 'probability')
    if prob and prob ~= 100 then entry.probability = prob end
    if not item then
      local imp = sget(pr, 'improvement_type')
      if imp and imp >= 0 then
        entry.improvement = tostring(df.improvement_type[imp])
      else
        entry.improvement = string.match(tostring(pr._type), 'reaction_product_(.+)st$') or 'product'
      end
    end
    out[#out+1] = entry
  end
  return out
end

local function reaction_dossier(r)
  return {
    kind = 'reaction',
    token = tostring(r.code),
    name = (r.name ~= '' and tostring(r.name)) or nil,
    skill = (r.skill and r.skill >= 0) and tostring(df.job_skill[r.skill]) or nil,
    building = reaction_building(r),
    reagents = reaction_reagents(r),
    products = reaction_products(r),
  }
end

local function reaction_stub(r)
  local b = reaction_building(r)
  local where = b and (b.custom or b.workshop or b.category) or 'reaction'
  return { kind = 'reaction', token = tostring(r.code),
           name = (r.name ~= '' and tostring(r.name)) or tostring(r.code),
           blurb = 'made at ' .. tostring(where) }
end

local function find_reaction(q)
  local rs = df.global.world.raws.reactions.reactions
  local entries = {}
  for i = 0, #rs - 1 do entries[#entries+1] = rs[i] end
  if not search(
    q, entries,
    function(r) return { tostring(r.code), tostring(r.name) } end,
    reaction_dossier, reaction_stub
  ) then emit_empty() end
end

-- ---- ITEM kind (itemdefs) ------------------------------------------------
-- Class-defining stat fields; read defensively (a field absent on a class is
-- pcall-skipped) so one reader serves every itemdef_*st.
local ITEM_STAT_FIELDS = { 'size', 'armorlevel', 'ammo_class', 'container_capacity',
  'hits', 'two_handed', 'minimum_size', 'material_size', 'ubstep', 'lbstep',
  'ranged_ammo' }

-- Not every itemdef_*st carries the same fields (foodst has no value /
-- name_plural / adjective), so read optional fields defensively via sget (above).
local function item_class(it)
  local t = tostring(it._type)
  return string.match(t, 'itemdef_(%a+)st') or 'item'
end

local function item_stats(it)
  local s = {}
  for _, f in ipairs(ITEM_STAT_FIELDS) do
    local ok, v = pcall(function() return it[f] end)
    if ok and v ~= nil then
      if type(v) == 'string' then
        if v ~= '' then s[f] = v end
      elseif type(v) == 'number' then
        if v ~= -1 then s[f] = v end
      end
    end
  end
  local okm, sm = pcall(function() return it.skill_melee end)
  if okm and sm and sm >= 0 then s.skill = tostring(df.job_skill[sm]) end
  local okr, sr = pcall(function() return it.skill_ranged end)
  if okr and sr and sr >= 0 then s.ranged_skill = tostring(df.job_skill[sr]) end
  return s
end

local function item_attacks(it)
  local ok, atk = pcall(function() return it.attacks end)
  if not ok or not atk then return nil end
  local out = {}
  for j = 0, #atk - 1 do
    local a = atk[j]
    out[#out+1] = {
      verb = (a.verb_3rd ~= '' and tostring(a.verb_3rd)) or nil,
      contact = a.contact,
      penetration = a.penetration,
      velocity_mult = a.velocity_mult,
    }
  end
  if #out == 0 then return nil end
  return out
end

local function item_name(it)
  local n = sget(it, 'name')
  return (n and n ~= '' and tostring(n)) or tostring(it.id)
end

local function item_dossier(it)
  local plural = sget(it, 'name_plural')
  local adj = sget(it, 'adjective')
  return {
    kind = 'item',
    token = tostring(it.id),
    name = item_name(it),
    plural = (plural and plural ~= '' and tostring(plural)) or nil,
    adjective = (adj and adj ~= '' and tostring(adj)) or nil,
    class = item_class(it),
    value = sget(it, 'value'),
    stats = item_stats(it),
    attacks = item_attacks(it),
  }
end

local function item_stub(it)
  return { kind = 'item', token = tostring(it.id), name = item_name(it),
           blurb = item_class(it) }
end

local function find_item(q)
  local all = df.global.world.raws.itemdefs.all
  local entries = {}
  for i = 0, #all - 1 do entries[#entries+1] = all[i] end
  if not search(
    q, entries,
    function(it)
      local plural = sget(it, 'name_plural')
      return { tostring(it.id), item_name(it), plural and tostring(plural) or nil }
    end,
    item_dossier, item_stub
  ) then emit_empty() end
end

-- ---- BUILDING kind (custom raws-defined workshops) -----------------------
local function building_reactions(bd)
  local out = {}
  local rs = df.global.world.raws.reactions.reactions
  for i = 0, #rs - 1 do
    local b = rs[i].building
    if #b.custom > 0 and b.custom[0] == bd.id then
      out[#out+1] = { token = tostring(rs[i].code),
                      name = (rs[i].name ~= '' and tostring(rs[i].name)) or nil }
    end
  end
  return out
end

local function building_dossier(bd)
  return {
    kind = 'building',
    token = tostring(bd.code),
    name = tostring(bd.name),
    category = tostring(df.building_type[bd.building_type]),
    purpose = (bd.labor_description ~= '' and tostring(bd.labor_description)) or nil,
    dim_x = bd.dim_x,
    dim_y = bd.dim_y,
    build_stages = bd.build_stages,
    reactions = building_reactions(bd),
  }
end

local function building_stub(bd)
  return { kind = 'building', token = tostring(bd.code), name = tostring(bd.name),
           blurb = (bd.labor_description ~= '' and tostring(bd.labor_description))
             or tostring(df.building_type[bd.building_type]) }
end

local function find_building(q)
  local defs = df.global.world.raws.buildings.all
  local entries = {}
  for i = 0, #defs - 1 do entries[#entries+1] = defs[i] end
  if not search(
    q, entries,
    function(bd) return { tostring(bd.code), tostring(bd.name) } end,
    building_dossier, building_stub
  ) then emit_empty() end
end

local DISPATCH = {
  creature = find_creature,
  material = find_material,
  plant = find_plant,
  reaction = find_reaction,
  item = find_item,
  building = find_building,
}

if DISPATCH[kind] then
  DISPATCH[kind](query)
else
  emit({ error = "unknown kind '" .. kind .. "'" })
end

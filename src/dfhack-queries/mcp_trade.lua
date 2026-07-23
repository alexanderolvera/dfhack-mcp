local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local TICKS_PER_DAY = 1200
local CARAVANS_CAP = 8
local MANIFEST_CATEGORY_CAP = 30
local AGREEMENT_CAP = 30
local PRICE_FIXED_POINT = 128

local depots = df.global.world.buildings.other.TRADE_DEPOT or {}
local depot = { exists = false, accessible = false, complete = false, trader_requested = false }
local goods = { count = 0, approx_value = 0 }
local depot_bld
if #depots > 0 then
  for _, d in ipairs(depots) do
    depot_bld = depot_bld or d
    local complete = d.construction_stage >= d:getMaxBuildStage()
    if complete and d.accessible then depot_bld = d; break end
  end
  depot.exists = true
  depot.accessible = depot_bld.accessible and true or false
  depot.complete = depot_bld.construction_stage >= depot_bld:getMaxBuildStage()
  depot.trader_requested = depot_bld.trade_flags.trader_requested and true or false
  local total_value = 0
  for _, ci in ipairs(depot_bld.contained_items) do
    local it = ci.item
    if it then
      goods.count = goods.count + 1
      local ok, v = pcall(dfhack.items.getValue, it)
      if ok and type(v) == 'number' then total_value = total_value + v end
    end
  end
  goods.approx_value = total_value
end

local TS = df.caravan_state.T_trade_state
local function civ_of(eid)
  if not eid or eid == -1 then return nil end
  local ent = df.historical_entity.find(eid)
  if not ent then return nil end
  local ok, name = pcall(dfhack.translation.translateName, ent.name, true)
  local civ = { }
  if ok and name and name ~= '' then civ.name = name end
  local race = df.creature_raw.find(ent.race)
  if race then civ.race = race.creature_id end
  return civ
end

local function capped_sorted(list, cap, less)
  table.sort(list, less)
  local truncated = false
  if #list > cap then
    local kept = {}
    for i = 1, cap do kept[i] = list[i] end
    list = kept
    truncated = true
  end
  return list, truncated
end

local function manifest_of(c)
  local m = { count = 0, approx_value = 0 }
  local cat_counts = {}
  for _, item_id in ipairs(c.goods) do
    local it = df.item.find(item_id)
    if it then
      m.count = m.count + 1
      local ok, v = pcall(dfhack.items.getValue, it, c)
      if ok and type(v) == 'number' then m.approx_value = m.approx_value + v end
      local ok2, ty = pcall(function() return df.item_type[it:getType()] end)
      local cat = (ok2 and ty) or 'UNKNOWN'
      cat_counts[cat] = (cat_counts[cat] or 0) + 1
    end
  end
  local cats = {}
  for cat, n in pairs(cat_counts) do cats[#cats + 1] = { category = cat, count = n } end
  local list, truncated = capped_sorted(cats, MANIFEST_CATEGORY_CAP, function(a, b) return a.category < b.category end)
  m.by_category = list
  m.by_category_truncated = truncated
  return m
end

local function price_pct(fixed_point)
  return math.floor(fixed_point * 100 / PRICE_FIXED_POINT)
end

local function export_agreements_of(c)
  local rows = {}
  local bp = c.buy_prices
  if bp and bp.items then
    local by_cat = {}
    for idx, price in ipairs(bp.price) do
      local ty = bp.items.item_type[idx]
      local cat = df.item_type[ty] or tostring(ty)
      local pct = price_pct(price)
      local e = by_cat[cat]
      if not e then
        e = { category = cat, entries = 0, price_pct_min = pct, price_pct_max = pct }
        by_cat[cat] = e
      end
      e.entries = e.entries + 1
      if pct < e.price_pct_min then e.price_pct_min = pct end
      if pct > e.price_pct_max then e.price_pct_max = pct end
    end
    for _, e in pairs(by_cat) do rows[#rows + 1] = e end
  end
  return capped_sorted(rows, AGREEMENT_CAP, function(a, b) return a.category < b.category end)
end

local function import_agreements_of(c)
  local rows = {}
  local sp = c.sell_prices
  if sp and sp.price then
    for cat_idx, price_vec in ipairs(sp.price) do
      if #price_vec > 0 then
        local cat = df.entity_sell_category[cat_idx] or tostring(cat_idx)
        local pmin, pmax = nil, nil
        for _, price in ipairs(price_vec) do
          local pct = price_pct(price)
          if not pmin or pct < pmin then pmin = pct end
          if not pmax or pct > pmax then pmax = pct end
        end
        rows[#rows + 1] = { category = cat, entries = #price_vec, price_pct_min = pmin, price_pct_max = pmax }
      end
    end
  end
  return capped_sorted(rows, AGREEMENT_CAP, function(a, b) return a.category < b.category end)
end

local function agreements_of(c)
  local export_rows, export_truncated = export_agreements_of(c)
  local import_rows, import_truncated = import_agreements_of(c)
  return {
    export = export_rows,
    export_truncated = export_truncated,
    import = import_rows,
    import_truncated = import_truncated,
  }
end

local caravans = {}
for _, c in ipairs(df.global.plotinfo.caravans) do
  local state = TS[c.trade_state] or tostring(c.trade_state)
  local row = { state = state }
  local civ = civ_of(c.entity)
  if civ then row.civ = civ end
  if (state == 'AtDepot' or state == 'Leaving') and c.time_remaining and c.time_remaining > 0 then
    row.leaving_in_days = math.floor(c.time_remaining / TICKS_PER_DAY)
  end
  -- A field-path/calculation error here must be visible, not silently
  -- indistinguishable from "no caravan to compute over" -- the no-caravan
  -- fixture this was verified against can't tell those two cases apart, so a
  -- real bug on a live caravan would otherwise pass every check unnoticed.
  local ok_m, m = pcall(manifest_of, c)
  if ok_m then row.manifest = m else row.manifest_error = tostring(m) end
  local ok_a, a = pcall(agreements_of, c)
  if ok_a then row.agreements = a else row.agreements_error = tostring(a) end
  caravans[#caravans + 1] = row
end
table.sort(caravans, function(a, b)
  if a.state ~= b.state then return a.state < b.state end
  local ar = (a.civ and a.civ.race) or ''
  local br = (b.civ and b.civ.race) or ''
  return ar < br
end)
local caravan_count = #caravans
local caravans_truncated = false
if #caravans > CARAVANS_CAP then
  local capped = {}
  for i = 1, CARAVANS_CAP do capped[i] = caravans[i] end
  caravans = capped
  caravans_truncated = true
end

local broker = { assigned = false, at_depot = false }
local fort = df.global.plotinfo.main.fortress_entity
if fort then
  local broker_pos_id
  for _, p in ipairs(fort.positions.own) do
    if p.code == 'BROKER' then broker_pos_id = p.id; break end
  end
  if broker_pos_id then
    local hfid
    for _, a in ipairs(fort.positions.assignments) do
      if a.position_id == broker_pos_id and a.histfig and a.histfig ~= -1 then
        hfid = a.histfig; break
      end
    end
    if hfid then
      local hf = df.historical_figure.find(hfid)
      if hf then
        broker.assigned = true
        local ok, nm = pcall(dfhack.translation.translateName, hf.name, true)
        if ok and nm and nm ~= '' then broker.name = nm end
        local u = hf.unit_id ~= -1 and df.unit.find(hf.unit_id) or nil
        if u and dfhack.units.isAlive(u) then
          broker.present = true
          local cj = u.job.current_job
          broker.current_job = cj and (df.job_type[cj.job_type] or tostring(cj.job_type)) or 'idle'
          if depot_bld then
            local p = u.pos
            broker.at_depot = p.z == depot_bld.z and p.x >= depot_bld.x1 and p.x <= depot_bld.x2
              and p.y >= depot_bld.y1 and p.y <= depot_bld.y2
          end
        else
          broker.present = false
        end
      end
    end
  end
end

local alerts = {}
if depot.exists and not depot.accessible then
  alerts[#alerts + 1] = 'trade depot is not wagon-accessible'
end
local at_depot_n = 0
for _, c in ipairs(caravans) do if c.state == 'AtDepot' then at_depot_n = at_depot_n + 1 end end
if at_depot_n > 0 and not broker.assigned then
  alerts[#alerts + 1] = 'caravan at depot with no broker assigned'
end
if at_depot_n > 0 and broker.assigned and not broker.at_depot then
  alerts[#alerts + 1] = 'caravan at depot, broker not at the depot'
end

emit({
  depot = depot,
  goods_at_depot = goods,
  caravans = caravans,
  caravan_count = caravan_count,
  caravans_truncated = caravans_truncated,
  broker = broker,
  alerts = alerts,
})

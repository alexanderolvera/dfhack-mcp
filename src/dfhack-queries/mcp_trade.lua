-- mcp_trade: the caravan lifecycle and the trade depot, as facts.
--
-- Answers "can I trade right now, and with whom?" the way a player reads the
-- depot screen: does a depot exist and can a wagon actually reach it, is a
-- caravan none/incoming/at-depot/leaving, is a broker assigned and is he at the
-- depot, and what is staged in the depot with a rough value. FACTS ONLY — it
-- reports the state, never "go trade" or "assign a broker".
--
-- Data model (verified live on 53.15, fort with a depot, NO caravan present):
--   * Depot: world.buildings.other.TRADE_DEPOT (building_tradedepotst). It carries
--     `accessible` — DF's OWN wagon-pathable flag, the exact thing the game checks
--     before routing a wagon, not a mere "is it built" test. construction_stage vs
--     getMaxBuildStage() gives completeness; trade_flags.trader_requested is the
--     "bring goods to depot" request. contained_items are the items physically
--     staged in the depot footprint (fort goods brought to trade AND, during a
--     visit, merchant goods unloaded) — counted with an approximate value.
--   * Caravans: df.global.plotinfo.caravans is a vector of caravan_state. Empty =>
--     no caravan (state "none"). Each has trade_state (None/Approaching/AtDepot/
--     Leaving/Stuck), time_remaining (ticks; /1200 = days), and entity (the civ).
--   * Broker: the fort entity's BROKER position (responsibility TRADE). Its
--     assignment.histfig resolves to a live unit -> readable name + current_job;
--     "at depot" = the unit standing within the depot footprint.
--
-- CAVEAT: the fixture used to author this had NO caravan visiting, so the active-
-- caravan fields (per-caravan state Approaching/AtDepot/Leaving, leaving_in_days,
-- merchant goods) are coded from the caravan_state struct but were not observed
-- live. The quiet path (state "none", depot + broker) is fully verified.
--
-- Bounded: caravans list capped; depot goods aggregated to a count + value, never
-- itemized. Invoked by name via DFHack RunCommand; prints ONE JSON object.

local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local TICKS_PER_DAY = 1200
local CARAVANS_CAP = 8   -- multiple civs can visit at once; cap the emitted list

-- ---- depot: existence, DF's own accessibility, completeness, staged goods ----
local depots = df.global.world.buildings.other.TRADE_DEPOT or {}
local depot = { exists = false, accessible = false, complete = false, trader_requested = false }
local goods = { count = 0, approx_value = 0 }
local depot_bld
if #depots > 0 then
  -- If more than one depot exists, prefer a complete + accessible one so the
  -- summary reflects the depot actually usable for trade.
  for _, d in ipairs(depots) do
    depot_bld = depot_bld or d
    local complete = d.construction_stage >= d:getMaxBuildStage()
    if complete and d.accessible then depot_bld = d; break end
  end
  depot.exists = true
  depot.accessible = depot_bld.accessible and true or false
  depot.complete = depot_bld.construction_stage >= depot_bld:getMaxBuildStage()
  depot.trader_requested = depot_bld.trade_flags.trader_requested and true or false
  -- items physically staged in the depot (a fact; not merchant-vs-fort split)
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

-- ---- caravans: the state machine (none / approaching / at depot / leaving) ----
local TS = df.caravan_state.T_trade_state   -- 0 None,1 Approaching,2 AtDepot,3 Leaving,4 Stuck
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

local caravans = {}
for _, c in ipairs(df.global.plotinfo.caravans) do
  local state = TS[c.trade_state] or tostring(c.trade_state)
  local row = { state = state }
  local civ = civ_of(c.entity)
  if civ then row.civ = civ end
  -- time_remaining is a countdown in ticks; only meaningful once here/leaving.
  if (state == 'AtDepot' or state == 'Leaving') and c.time_remaining and c.time_remaining > 0 then
    row.leaving_in_days = math.floor(c.time_remaining / TICKS_PER_DAY)
  end
  caravans[#caravans + 1] = row
end
-- Canonicalize: sort by state then civ race so goldens don't flap on list order.
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

-- ---- broker: none / assigned-elsewhere / at depot ----
local broker = { assigned = false, at_depot = false }
local fort = df.global.plotinfo.main.fortress_entity
if fort then
  -- find the BROKER position id (responsibility TRADE)
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
          -- assigned on paper but no live unit on the map (dead/absent noble)
          broker.present = false
        end
      end
    end
  end
end

-- ---- alerts: facts that crossed a line (mirror the game's own nagging) ----
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

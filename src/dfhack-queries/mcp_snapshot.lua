--@ module = true

local json = require('json')
local gov = reqscript('mcp_snapshotGovernor')

state = dfhack.mcp_snapshot_state or {}
dfhack.mcp_snapshot_state = state
state.walkers = state.walkers or {}
state.gap = state.gap or { running = false }
gap = state.gap

local IDLE_DELAY = 30
local NO_FORT = '{"error":"no fort loaded"}'

local DEFAULTS = {
  entities = { slice = 16, cadence = 600, classes = 'units,items,buildings,reports' },
  map = { slice = 32, cadence = 6000, classes = 'census' },
}

local function encode(t) return json.encode(t, { pretty = false }) end

local function fort_loaded()
  return dfhack.isMapLoaded() and df.global.gamemode == df.game_mode.DWARF
end

local function game_time()
  return { year = df.global.cur_year, year_tick = df.global.cur_year_tick }
end

local function walker(name)
  local w = state.walkers[name]
  if not w then
    w = { name = name }
    state.walkers[name] = w
  end
  local d = DEFAULTS[name] or DEFAULTS.entities
  if w.running == nil then w.running = false end
  if w.slice == nil then w.slice = d.slice end
  if w.cadence == nil then w.cadence = d.cadence end
  if w.classes == nil then w.classes = d.classes end
  if w.seq == nil then w.seq = 0 end
  if w.steps == nil then w.steps = 0 end
  if w.max_step_wall_ms == nil then w.max_step_wall_ms = 0 end
  if w.gen == nil then w.gen = 0 end
  if w.target_cadence == nil then w.target_cadence = w.cadence end
  return w
end

local WALKER_NAMES = { 'entities', 'map' }

local function active_governor()
  local g = state.gov
  if g and g.enabled then return g end
  return nil
end

local function effective_cadence(wk)
  local g = active_governor()
  if not g then return wk.target_cadence end
  return gov.cadence_for(g, wk.target_cadence)
end

local function apply_governor()
  for _, name in ipairs(WALKER_NAMES) do
    local wk = walker(name)
    wk.cadence = effective_cadence(wk)
  end
end

local function any_walking()
  for _, name in ipairs(WALKER_NAMES) do
    if walker(name).walk ~= nil then return true end
  end
  return false
end

local function gov_tick()
  local g = active_governor()
  if not g then
    state.gov_ticking = false
    return
  end
  local now = dfhack.getTickCount()
  if g.last then
    gov.sample(g, now - g.last, any_walking())
    local decision = gov.decide(g)
    if decision == 'backoff' or decision == 'recover' then
      g.decided_at = now
      apply_governor()
    end
  end
  g.last = now
  dfhack.timeout(1, 'frames', gov_tick)
end

local function govern(on, opts)
  if not on then
    state.gov = nil
    apply_governor()
    return
  end
  local g = gov.new(opts)
  g.enabled = true
  state.gov = g
  apply_governor()
  if not state.gov_ticking then
    state.gov_ticking = true
    dfhack.timeout(1, 'frames', gov_tick)
  end
end

local function tune(wk, slice, cadence)
  local s, c = tonumber(slice), tonumber(cadence)
  if s and s >= 0 then wk.slice = math.floor(s) end
  if c and c >= 1 then wk.target_cadence = math.floor(c) end
  wk.cadence = effective_cadence(wk)
end

local function pos_of(p) return { x = p.x, y = p.y, z = p.z } end

local fog = reqscript('mcp_readTerrain').fog_gate({})

local function tile_hidden(x, y, z)
  if not x or x < 0 then return nil end
  return fog.tile_hidden(x, y, z)
end

local function field(obj, key)
  local ok, v = pcall(function() return obj[key] end)
  if ok then return v end
end

local function squad_parts()
  local out = {}
  local fort = df.global.plotinfo.main.fortress_entity
  for _, sq in ipairs(df.global.world.squads.all) do
    if fort and sq.entity_id == fort.id then
      local ok, nm = pcall(function() return dfhack.translation.translateName(sq.name, true) end)
      local name = (ok and nm ~= '' and nm) or (sq.alias ~= '' and sq.alias) or ('Squad ' .. sq.id)
      out[#out + 1] = encode({ id = sq.id, name = dfhack.df2utf(name) })
    end
  end
  return out
end

local function citizen_set()
  local set = {}
  for _, u in ipairs(dfhack.units.getCitizens(true)) do set[u.id] = true end
  return set
end

local function unit_record(u, citizens)
  local cj = u.job.current_job
  local sid = u.military and u.military.squad_id or -1
  local raw = df.creature_raw.find(u.race)
  local ok_sc, sc = pcall(dfhack.units.getStressCategory, u)
  return {
    id = u.id,
    name = dfhack.df2utf(dfhack.units.getReadableName(u)),
    profession = dfhack.df2utf(dfhack.units.getProfessionName(u)),
    race = raw and raw.creature_id or nil,
    citizen = citizens[u.id] == true,
    dead = dfhack.units.isDead(u),
    age = math.floor(dfhack.units.getAge(u, true)),
    stress_category = ok_sc and sc or nil,
    job_type = cj and (df.job_type[cj.job_type] or tostring(cj.job_type)) or nil,
    squad_id = sid ~= -1 and sid or nil,
    wound_count = (u.body and u.body.wounds) and #u.body.wounds or 0,
    needs_healthcare = (u.health and u.health.flags and u.health.flags.needs_healthcare) or false,
    unconscious = (u.counters and u.counters.unconscious) or 0,
    pos = pos_of(u.pos),
    hidden = tile_hidden(u.pos.x, u.pos.y, u.pos.z),
  }
end

local function item_record(it, with_desc)
  local f = it.flags
  local c = dfhack.items.getContainer(it)
  local h = dfhack.items.getHolderUnit(it)
  local mi = dfhack.matinfo.decode(it)
  local x, y, z = dfhack.items.getPosition(it)
  return {
    id = it.id, type = df.item_type[it:getType()], subtype = it:getSubtype(),
    mat_type = it:getMaterial(), mat_index = it:getMaterialIndex(),
    material = mi and mi:getToken() or nil,
    quality = it:getQuality(), wear = it.wear, stack = it:getStackSize(),
    pos = x and { x = x, y = y, z = z } or nil,
    hidden = tile_hidden(x, y, z),
    container = c and c.id or nil, holder = h and h.id or nil,
    forbid = f.forbid, in_job = f.in_job, dump = f.dump, on_ground = f.on_ground,
    in_building = f.in_building, in_inventory = f.in_inventory, rotten = f.rotten, trader = f.trader,
    construction = f.construction,
    desc = with_desc and dfhack.df2utf(dfhack.items.getDescription(it, 0, true)) or nil,
  }
end

local function building_record(b)
  local ok, name = pcall(dfhack.buildings.getName, b)
  local btype = b:getType()
  local zone = btype == df.building_type.Civzone
  local zt = zone and field(b, 'type') or nil
  local owner = zone and field(b, 'assigned_unit_id') or nil
  return {
    id = b.id, type = df.building_type[btype], subtype = b:getSubtype(), custom = b:getCustomType(),
    zone_type = zt and df.civzone_type[zt] or nil,
    owner = (owner and owner ~= -1) and owner or nil,
    x1 = b.x1, y1 = b.y1, x2 = b.x2, y2 = b.y2, z = b.z,
    stage = b:getBuildStage(), max_stage = b:getMaxBuildStage(),
    name = ok and name and name ~= '' and dfhack.df2utf(name) or nil,
    items = (function() local v = field(b, 'contained_items') return v and #v or nil end)(),
    jobs = (function() local v = field(b, 'jobs') return v and #v or nil end)(),
    hidden = tile_hidden(b.centerx, b.centery, b.z),
  }
end

local function report_record(r)
  return {
    id = r.id, type = df.announcement_type[r.type], text = dfhack.df2utf(r.text),
    year = r.year, time = r.time, pos = pos_of(r.pos), continuation = r.flags.continuation,
  }
end

local CENSUS_COLUMNS = { 'open', 'floor', 'constructed', 'stair', 'ramp', 'tree',
  'wall_stone', 'wall_mineral', 'wall_soil', 'wall_other' }
local NCAT = #CENSUS_COLUMNS
local HIDDEN, LIQUID = NCAT + 1, NCAT + 2
local CAT, STAIR, GROUND = {}, {}, {}
local SURFACE_SHAPES = { FLOOR = true, RAMP = true, RAMP_TOP = true, BOULDER = true, PEBBLES = true,
  STAIR_UP = true, STAIR_DOWN = true, STAIR_UPDOWN = true }
local STAIR_ROLE = { STAIR_UP = 'U', STAIR_DOWN = 'D', STAIR_UPDOWN = 'X' }
local HEX2 = {}
for i = 0, 255 do HEX2[i] = string.format('%02x', i) end

local function build_categories()
  if next(CAT) then return end
  local index = {}
  for i, n in ipairs(CENSUS_COLUMNS) do index[n] = i end
  local S, M = df.tiletype_shape, df.tiletype_material
  for tt = df.tiletype._first_item, df.tiletype._last_item do
    local ok, a = pcall(function() return df.tiletype.attrs[tt] end)
    local sh, mat = ok and a.shape, ok and a.material
    local c
    if not ok then c = 'wall_other'
    elseif mat == M.CONSTRUCTION then c = 'constructed'
    elseif sh == S.EMPTY or sh == S.RAMP_TOP then c = 'open'
    elseif sh == S.STAIR_UP or sh == S.STAIR_DOWN or sh == S.STAIR_UPDOWN then c = 'stair'
    elseif sh == S.RAMP then c = 'ramp'
    elseif mat == M.TREE or sh == S.TRUNK_BRANCH or sh == S.BRANCH or sh == S.TWIG then c = 'tree'
    elseif sh == S.WALL or sh == S.FORTIFICATION then
      if mat == M.SOIL then c = 'wall_soil'
      elseif mat == M.MINERAL then c = 'wall_mineral'
      elseif mat == M.STONE or mat == M.LAVA_STONE or mat == M.FEATURE then c = 'wall_stone'
      else c = 'wall_other' end
    else c = 'floor' end
    CAT[tt] = index[c]
    local shape_name = ok and df.tiletype_shape[sh] or nil
    STAIR[tt] = shape_name and STAIR_ROLE[shape_name] or nil
    GROUND[tt] = shape_name and SURFACE_SHAPES[shape_name] or nil
  end
end

local function census_block(b, w)
  local z = b.map_pos.z
  local bx, by = b.map_pos.x, b.map_pos.y
  local row = w.census[z]
  if not row then
    row = {}
    for i = 1, LIQUID do row[i] = 0 end
    w.census[z] = row
  end
  local T, D = b.tiletype, b.designation
  local stairs, surface, width = w.stairs, w.surface, w.width
  local hidden, liquid = 0, 0
  for x = 0, 15 do
    local tx, dx = T[x], D[x]
    for y = 0, 15 do
      local d = dx[y]
      if fog.des_hidden(d) then
        hidden = hidden + 1
      else
        local t = tx[y]
        local k = CAT[t] or NCAT
        row[k] = row[k] + 1
        if d.flow_size > 0 then liquid = liquid + 1 end
        local role = STAIR[t]
        if role then stairs[#stairs + 1] = { bx + x, by + y, z, role } end
        if GROUND[t] and d.outside then
          local ci = (by + y) * width + bx + x
          if (surface[ci] or -1) < z then surface[ci] = z end
        end
      end
    end
  end
  row[HIDDEN] = row[HIDDEN] + hidden
  row[LIQUID] = row[LIQUID] + liquid
  if b.flags.designated and not w.dig_z[z] then
    for x = 0, 15 do
      local dx = D[x]
      for y = 0, 15 do
        if dx[y].dig ~= 0 then w.dig_z[z] = true break end
      end
      if w.dig_z[z] then break end
    end
  end
end

local function sorted_zs(set)
  local a = {}
  for z in pairs(set) do a[#a + 1] = z end
  table.sort(a)
  return a
end

local function surface_hex(w)
  local m = df.global.world.map
  local parts, surface = {}, w.surface
  for i = 0, m.x_count * m.y_count - 1 do
    local z = surface[i]
    parts[#parts + 1] = z and HEX2[z] or 'ff'
  end
  return table.concat(parts)
end

local function census_json(w)
  local zs, levels, unrevealed = {}, {}, {}
  for z in pairs(w.census) do zs[#zs + 1] = z end
  table.sort(zs, function(a, b) return a > b end)
  local run_hi, run_lo
  local function close_run()
    if run_hi then unrevealed[#unrevealed + 1] = { run_lo, run_hi } end
    run_hi, run_lo = nil, nil
  end
  for _, z in ipairs(zs) do
    local row = w.census[z]
    local revealed = 0
    for i = 1, NCAT do revealed = revealed + row[i] end
    if revealed == 0 then
      run_hi = run_hi or z
      run_lo = z
    else
      close_run()
      local r = { z, revealed, row[HIDDEN] }
      for i = 1, NCAT do r[#r + 1] = row[i] end
      r[#r + 1] = row[LIQUID]
      levels[#levels + 1] = r
    end
  end
  close_run()
  local cols = { 'z', 'revealed', 'hidden' }
  for _, c in ipairs(CENSUS_COLUMNS) do cols[#cols + 1] = c end
  cols[#cols + 1] = 'liquid'
  local m = df.global.world.map
  local con_z = {}
  for _, c in ipairs(df.construction.get_vector()) do con_z[c.pos.z] = true end
  return encode({ columns = cols, levels = levels, unrevealed_z = unrevealed,
    extents = { x = m.x_count, y = m.y_count, z = m.z_count },
    stairs = w.stairs, digging_z = sorted_zs(w.dig_z), construction_z = sorted_zs(con_z),
    surface_hex = surface_hex(w) })
end

local function at(vec, i) return i < #vec and vec[i] or nil end

local function encode_safe(rec, x, ...)
  local ok, r = pcall(rec, x, ...)
  return encode(ok and r or { id = x.id, error = tostring(r) })
end

local CLASSES = {
  units = {
    cost = 95,
    collect = function(ids) for _, u in ipairs(df.global.world.units.active) do ids[#ids + 1] = u.id end end,
    visit = function(id, w)
      local u = df.unit.find(id)
      if not u then return end
      local ok, rec = pcall(unit_record, u, w.citizens)
      return encode(ok and rec or { id = id, error = tostring(rec) })
    end,
  },
  items = {
    cost = 95,
    collect = function(ids) for _, it in ipairs(df.global.world.items.all) do ids[#ids + 1] = it.id end end,
    visit = function(id)
      local it = df.item.find(id)
      return it and encode_safe(item_record, it, true)
    end,
  },
  buildings = {
    cost = 40,
    collect = function(ids) for _, b in ipairs(df.global.world.buildings.all) do ids[#ids + 1] = b.id end end,
    visit = function(id)
      local b = df.building.find(id)
      return b and encode_safe(building_record, b)
    end,
  },
  reports = {
    cost = 67,
    collect = function(ids) for i = 0, #df.global.world.status.reports - 1 do ids[#ids + 1] = i end end,
    visit = function(i)
      local r = at(df.global.world.status.reports, i)
      return r and encode_safe(report_record, r)
    end,
  },
  census = {
    cost = 300,
    collect = function(ids) for i = 0, #df.global.world.map.map_blocks - 1 do ids[#ids + 1] = i end end,
    visit = function(i, w)
      local b = at(df.global.world.map.map_blocks, i)
      if b then census_block(b, w) end
    end,
  },
}

local function class_slice(name, slice)
  if slice <= 0 then return math.huge end
  return math.max(1, math.floor(slice * CLASSES.units.cost / CLASSES[name].cost))
end

local function begin_walk(wk)
  local b0 = dfhack.getTickCount()
  local classes = {}
  for name in wk.classes:gmatch('[^,]+') do
    if CLASSES[name] then
      classes[#classes + 1] = { name = name, i = 1, parts = {}, n = 0, bytes = 0,
        slice = class_slice(name, wk.slice) }
    end
  end
  if wk.classes:find('census') then build_categories() end
  wk.walk = {
    classes = classes, ci = 1, citizens = citizen_set(), squads = squad_parts(), census = {},
    stairs = {}, surface = {}, dig_z = {}, width = df.global.world.map.x_count,
    started = game_time(), started_ms = dfhack.getTickCount(),
    steps = 1, max_step_wall_ms = 0, slice = wk.slice,
  }
  wk.walk.begin_ms = dfhack.getTickCount() - b0
end

local function finish_walk(wk, w)
  wk.seq = wk.seq + 1
  local stats = { slice = w.slice, steps = w.steps, wall_ms = dfhack.getTickCount() - w.started_ms,
    max_step_wall_ms = w.max_step_wall_ms, begin_ms = w.begin_ms, classes = {} }
  local body = {}
  for _, c in ipairs(w.classes) do
    stats.classes[c.name] = { n = c.n, kb = c.bytes / 1024, steps = c.steps, wall_ms = c.wall_ms,
      per_frame = c.slice ~= math.huge and c.slice or 0 }
    if c.name == 'census' then
      body[#body + 1] = ',"census":' .. census_json(w)
    else
      body[#body + 1] = ',"' .. c.name .. '":[' .. table.concat(c.parts, ',') .. ']'
    end
  end
  wk.latest = table.concat({
    '{"seq":', tostring(wk.seq),
    ',"captured_at_ms":', tostring(dfhack.getTickCount()),
    ',"started":', encode(w.started),
    ',"captured":', encode(game_time()),
    ',"walk":', encode(stats),
    ',"squads":[', table.concat(w.squads, ','), ']',
    table.concat(body),
    '}',
  })
end

local function advance(wk)
  if not fort_loaded() then
    wk.walk = nil
    if wk.latest ~= NO_FORT then
      wk.seq = wk.seq + 1
      wk.latest = NO_FORT
    end
    return IDLE_DELAY
  end
  local w = wk.walk
  if not w then
    begin_walk(wk)
    return 1
  end
  w.steps = w.steps + 1
  local c = w.classes[w.ci]
  if not c then return wk.cadence, w end
  if not c.ids then
    c.ids, c.t0, c.s0 = {}, dfhack.getTickCount(), w.steps
    CLASSES[c.name].collect(c.ids)
    return 1
  end
  local visit, n = CLASSES[c.name].visit, 0
  while n < c.slice and c.i <= #c.ids do
    local s = visit(c.ids[c.i], w)
    c.i, n = c.i + 1, n + 1
    if s then
      c.n, c.bytes = c.n + 1, c.bytes + #s
      c.parts[#c.parts + 1] = s
    elseif c.name == 'census' then
      c.n = c.n + 1
    end
  end
  if c.i > #c.ids then
    c.wall_ms, c.steps, c.ids = dfhack.getTickCount() - c.t0, w.steps - c.s0, nil
    w.ci = w.ci + 1
    if w.ci > #w.classes then return wk.cadence, w end
  end
  return 1
end

local function make_step(wk)
  local gen, step = wk.gen
  function step()
    if not wk.running or wk.gen ~= gen then return end
    wk.timer = nil
    local w0 = dfhack.getTickCount()
    local ok, delay, done = pcall(advance, wk)
    if ok and done then
      local ok_pub, err = pcall(finish_walk, wk, done)
      if not ok_pub then ok, delay = false, err end
      wk.walk = nil
    end
    local wall = dfhack.getTickCount() - w0
    wk.steps = wk.steps + 1
    if wall > wk.max_step_wall_ms then wk.max_step_wall_ms = wall end
    if wk.walk and wall > wk.walk.max_step_wall_ms then wk.walk.max_step_wall_ms = wall end
    if not ok then
      wk.last_error = tostring(delay)
      wk.walk = nil
      delay = IDLE_DELAY
    end
    wk.timer = dfhack.timeout(delay, 'frames', step)
  end
  return step
end

local function stop(wk)
  wk.running = false
  if wk.timer then dfhack.timeout_active(wk.timer, nil) end
  wk.timer, wk.walk = nil, nil
end

local function start(wk, slice, cadence, classes)
  stop(wk)
  wk.slice = tonumber(slice) or wk.slice
  wk.target_cadence = math.max(1, tonumber(cadence) or wk.target_cadence)
  wk.cadence = effective_cadence(wk)
  wk.classes = classes or wk.classes
  wk.latest, wk.last_error, wk.max_step_wall_ms = nil, nil, 0
  wk.gen = wk.gen + 1
  wk.running = true
  wk.timer = dfhack.timeout(1, 'frames', make_step(wk))
end

local function progress(wk)
  local w = wk.walk
  local c = w and w.classes[w.ci]
  if not c then return nil end
  return { class = c.name, done = c.i - 1, total = c.ids and #c.ids or 0 }
end

local function status_table(wk)
  local g = active_governor()
  return { running = wk.running, slice = wk.slice, cadence = wk.cadence,
    cadence_configured = wk.target_cadence, classes = wk.classes,
    seq = wk.seq, ready = wk.latest ~= nil, walking = wk.walk ~= nil, progress = progress(wk), steps = wk.steps,
    max_step_wall_ms = wk.max_step_wall_ms, last_error = wk.last_error,
    governor = g and gov.report(g) or nil,
    now_ms = dfhack.getTickCount() }
end

local function status_fields(wk)
  local s = encode(status_table(wk))
  return s:sub(2, -2)
end

package.loaded['rpc.mcp_snapshot'] = {
  seqs = function()
    local e, m = walker('entities'), walker('map')
    return encode({ entities = status_table(e), map = status_table(m) })
  end,
  entities = function() return walker('entities').latest or 'null' end,
  map = function() return walker('map').latest or 'null' end,
}

local GAP_EDGES = { 16, 33, 50, 100, 200 }

local function gap_class()
  local c = { n = 0, sum = 0, max = 0, over50 = 0, hist = {} }
  for i = 1, #GAP_EDGES + 1 do c.hist[i] = 0 end
  return c
end

local function gap_record(c, d)
  c.n, c.sum = c.n + 1, c.sum + d
  if d > c.max then c.max = d end
  if d > 50 then c.over50 = c.over50 + 1 end
  for i = 1, #GAP_EDGES do
    if d <= GAP_EDGES[i] then
      c.hist[i] = c.hist[i] + 1
      return
    end
  end
  c.hist[#GAP_EDGES + 1] = c.hist[#GAP_EDGES + 1] + 1
end

local function gap_tick()
  if not gap.running then return end
  local now = dfhack.getTickCount()
  if gap.last then
    local d = now - gap.last
    gap.frames = gap.frames + 1
    if d > gap.max then gap.max = d end
    if d > 50 then gap.over50 = gap.over50 + 1 end
    gap_record(gap.was_walking and gap.walk or gap.idle, d)
  end
  gap.last = now
  gap.was_walking = any_walking()
  dfhack.timeout(1, 'frames', gap_tick)
end

local function gap_start()
  local was = gap.running
  gap.running, gap.last, gap.frames, gap.max, gap.over50 = true, nil, 0, 0, 0
  gap.walk, gap.idle, gap.was_walking = gap_class(), gap_class(), false
  gap.since = dfhack.getTickCount()
  if not was then dfhack.timeout(1, 'frames', gap_tick) end
end

local function gap_read()
  return encode({ frames = gap.frames, max_gap_ms = gap.max, gaps_over_50ms = gap.over50,
    window_ms = dfhack.getTickCount() - (gap.since or 0),
    edges_ms = GAP_EDGES, walking = gap.walk, idle = gap.idle })
end

local function timed(fn)
  local w0 = dfhack.getTickCount()
  local bytes, n = fn()
  local wall = dfhack.getTickCount() - w0
  return { n = n, wall_ms = wall, us_each = n > 0 and wall * 1000 / n or 0, kb = bytes / 1024 }
end

local function each_encoded(list, rec, ...)
  local bytes = 0
  for _, x in ipairs(list) do bytes = bytes + #encode_safe(rec, x, ...) end
  return bytes, #list
end

local function bench_classes(block_limit)
  if not fort_loaded() then print(NO_FORT) return end
  local w = df.global.world
  local out = {}
  out.units = timed(function()
    local citizens, bytes = citizen_set(), 0
    for _, u in ipairs(w.units.active) do bytes = bytes + #encode(unit_record(u, citizens)) end
    return bytes, #w.units.active
  end)
  out.items = timed(function() return each_encoded(w.items.all, item_record, true) end)
  out.buildings = timed(function() return each_encoded(w.buildings.all, building_record) end)
  out.reports = timed(function() return each_encoded(w.status.reports, report_record) end)
  build_categories()
  local blocks = w.map.map_blocks
  local limit = math.min(#blocks, tonumber(block_limit) or #blocks)
  local scratch = { census = {}, stairs = {}, surface = {}, dig_z = {}, width = w.map.x_count }
  out.census = timed(function()
    for i = 0, limit - 1 do census_block(blocks[i], scratch) end
    return 0, limit
  end)
  print(encode(out))
end

if dfhack_flags and dfhack_flags.module then return end

local args = { ... }
local cmd = args[1] or 'status'
local ent, map = walker('entities'), walker('map')
if cmd == 'start' then
  start(ent, args[2], args[3], args[4])
  print('{' .. status_fields(ent) .. '}')
elseif cmd == 'start_map' then
  start(map, args[2], args[3], 'census')
  print('{' .. status_fields(map) .. '}')
elseif cmd == 'autostart' then
  if not ent.running then start(ent, nil, nil, DEFAULTS.entities.classes) end
  if not map.running then start(map, nil, nil, DEFAULTS.map.classes) end
  print(encode({ entities = status_table(ent), map = status_table(map) }))
elseif cmd == 'tune' then
  tune(ent, args[2], args[3])
  print('{' .. status_fields(ent) .. '}')
elseif cmd == 'tune_map' then
  tune(map, args[2], args[3])
  print('{' .. status_fields(map) .. '}')
elseif cmd == 'govern' then
  if args[2] == 'off' then
    govern(false)
  elseif args[2] == 'on' then
    govern(true, { high = args[3], low = args[4] })
  end
  print(encode({ entities = status_table(ent), map = status_table(map) }))
elseif cmd == 'stop' then
  stop(ent)
  stop(map)
  print('{' .. status_fields(ent) .. '}')
elseif cmd == 'status' then
  print('{' .. status_fields(ent) .. '}')
elseif cmd == 'status_map' then
  print('{' .. status_fields(map) .. '}')
elseif cmd == 'get' then
  print('{' .. status_fields(ent) .. ',"snapshot":' .. (ent.latest or 'null') .. '}')
elseif cmd == 'get_map' then
  print('{' .. status_fields(map) .. ',"snapshot":' .. (map.latest or 'null') .. '}')
elseif cmd == 'gap' then
  if args[2] == 'start' then gap_start() elseif args[2] == 'stop' then gap.running = false end
  print(gap_read())
elseif cmd == 'bench_classes' then
  bench_classes(args[2])
else
  print(encode({ error = 'unknown subcommand: ' .. tostring(cmd) }))
end

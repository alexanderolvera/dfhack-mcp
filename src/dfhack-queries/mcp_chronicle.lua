-- mcp_chronicle(since, categories, limit): DF's announcement/report stream as
-- triaged, cursor-addressable events. Reads df.global.world.status.reports — a
-- rolling, front-pruned window (~3000 on this fort). Prints ONE JSON object.
--
-- Verified live on DFHack 53.15 against "Fortress of Dreams" (spike #9 de-risked
-- the contract; every path below was re-confirmed live). Version-fragile paths,
-- all read defensively:
--   * df.global.world.status.reports            -> vector of `report`, id-ascending
--   * df.global.world.status.next_report_id     -> PERSISTED monotonic counter
--   * report.{id,type,text,color,year,time,repeat_count,speaker_id,pos}
--   * report.flags.{continuation,announcement}
--   * df.announcement_type[report.type]         -> stable token (the category key)
--
-- CURSOR: report.id is strictly monotonic, index-aligned and save/load-stable
-- (backed by the persisted next_report_id). `since` returns only id > since.
-- Omitted `since` -> most recent `limit`. Top-level `cursor` = highest RETAINED
-- id (we always scan up to the newest report), so the caller round-trips by
-- passing it back as `since`, even when the newest events were filtered/collapsed.
--
-- PRUNING: if `since` < the oldest retained id, the (since, oldest) gap was
-- front-pruned and is gone; we still return what we DO retain but set pruned=true
-- rather than imply completeness.
--
-- COMBAT-SPAM COLLAPSE: report.group_id / pool_id are NOT usable to group here
-- (group_id absent on 53.x; pool_id is 1:1 with index). Instead we (a) honor
-- repeat_count (native "(xN)"), (b) fold flags.continuation lines into the
-- preceding event, and (c) CAP consecutive runs of battle-category reports at
-- BATTLE_RUN_CAP, replacing the overflow with ONE collapsed marker carrying the
-- omitted count — so one siege cannot flood the window.
--
-- UNIT REFS: combat reports carry speaker_id/activity_id == -1 and no reliable
-- involved unit, so `speaker` is populated ONLY when speaker_id ~= -1 (resolved
-- via df.unit.find); otherwise omitted. pos is surfaced as a tile anchor when set.

local args = {...}
local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

-- ---- args (native argv, all strings; '' == omitted) ----------------------
local since_arg = args[1]
local cats_arg  = args[2] or ''
local limit_arg = args[3]

local since = nil
if since_arg and since_arg ~= '' then since = tonumber(since_arg) end

local DEFAULT_LIMIT, MAX_LIMIT = 50, 200
local limit = DEFAULT_LIMIT
if limit_arg and limit_arg ~= '' then
  local n = tonumber(limit_arg)
  if n then limit = math.floor(n) end
end
if limit < 1 then limit = 1 end
if limit > MAX_LIMIT then limit = MAX_LIMIT end

-- Requested category filter -> a set (empty == no filter). Unknown names are
-- kept in the set but simply never match, so a typo yields an empty result, not
-- an error.
local cat_filter, has_filter = {}, false
for tok in string.gmatch(cats_arg, '[^,]+') do
  local c = string.lower((tok:gsub('^%s*(.-)%s*$', '%1')))
  if c ~= '' then cat_filter[c] = true; has_filter = true end
end

local BATTLE_RUN_CAP = 6 -- max consecutive battle events kept before collapsing

-- ---- category map: STATIC name->category over the FULL announcement_type enum
-- (authored, NOT a live snapshot — most categories have zero live samples on
-- this fort but must still be mapped). Prefix rules cover the big families;
-- EXACT overrides win first. Closed set:
--   death|birth|marriage|battle|siege|mood|artifact|migrants|diplomacy|
--   cave-in|megabeast ; everything else -> "other".
local EXACT = {
  -- death
  CITIZEN_DEATH='death', PET_DEATH='death', ADV_CREATURE_DEATH='death',
  -- birth
  BIRTH_CITIZEN='birth', BIRTH_ANIMAL='birth', BIRTH_WILD_ANIMAL='birth',
  -- marriage
  MARRIAGE='marriage', CITIZEN_MARRIED='marriage', NO_MARRIAGE_CELEBRATION='marriage',
  EMBRACE='marriage',
  -- mood
  STRANGE_MOOD='mood', MOOD_BUILDING_CLAIMED='mood', ARTIFACT_BEGUN='mood',
  POSSESSED_TANTRUM='mood',
  -- artifact / masterwork
  MADE_ARTIFACT='artifact', NAMED_ARTIFACT='artifact', MASTERPIECE_CRAFTED='artifact',
  MASTERPIECE_CONSTRUCTION='artifact', MASTERPIECE_ENGRAVING='artifact',
  MASTERFUL_IMPROVEMENT='artifact', DYED_MASTERPIECE='artifact',
  COOKED_MASTERPIECE='artifact',
  -- migrants
  MIGRANT_ARRIVAL='migrants', MIGRANT_ARRIVAL_NAMED='migrants',
  D_MIGRANTS_ARRIVAL='migrants', D_MIGRANT_ARRIVAL='migrants',
  D_MIGRANT_ARRIVAL_DISCOURAGED='migrants', D_NO_MIGRANT_ARRIVAL='migrants',
  -- diplomacy / trade / nobility
  DIPLOMAT_ARRIVAL='diplomacy', LIAISON_ARRIVAL='diplomacy',
  TRADE_DIPLOMAT_ARRIVAL='diplomacy', DIPLOMAT_LEFT_UNHAPPY='diplomacy',
  CARAVAN_ARRIVAL='diplomacy', FIRST_CARAVAN_ARRIVAL='diplomacy',
  NOBLE_ARRIVAL='diplomacy', MONARCH_ARRIVAL='diplomacy', HASTY_MONARCH='diplomacy',
  SATISFIED_MONARCH='diplomacy', MOUNTAINHOME='diplomacy',
  -- cave-in
  CAVE_COLLAPSE='cave-in',
  -- megabeast / semimegabeast / night creatures
  MEGABEAST_ARRIVAL='megabeast', WEREBEAST_ARRIVAL='megabeast',
  TITAN_ARRIVAL='megabeast', FORGOTTEN_BEAST_ARRIVAL='megabeast',
  BEAST_AMBUSH='megabeast',
  -- siege / infiltration
  CITIZEN_SNATCHED='siege', CITIZEN_MISSING='siege', PET_MISSING='siege',
  UNDEAD_ATTACK='siege', GHOST_ATTACK='siege',
  -- battle (non-COMBAT_ prefixed mechanics)
  STAND_UP='battle', NOT_STUNNED='battle', VERMIN_BITE='battle',
  FALL_OVER='battle', CAUGHT_IN_FLAMES='battle', CAUGHT_IN_WEB='battle',
  FREE_FROM_WEB='battle', PARALYZED='battle', OVERCOME_PARALYSIS='battle',
  PAIN_KO='battle', EXHAUSTION='battle', MARTIAL_TRANCE='battle',
  REGAIN_CONSCIOUSNESS='battle', BREATHE_FIRE='battle', BLOCK_FIRE='battle',
  SHOOT_WEB='battle', FLAME_HIT='battle', MAT_BREATH='battle',
  UNIT_PROJECTILE_SLAM='battle', UNIT_PROJECTILE_SLAM_INTO_UNIT='battle',
  UNIT_PROJECTILE_SLAM_BLOW_APART='battle', BERSERK_CITIZEN='battle',
}
-- Prefix rules (checked after EXACT): family -> category.
local PREFIX = {
  { 'COMBAT_', 'battle' },
  { 'AMBUSH_', 'siege' },
  { 'SIEGE_', 'siege' },
  { 'NIGHT_ATTACK', 'siege' },
  { 'MERCHANT', 'diplomacy' },
  { 'FORGOTTEN_BEAST', 'megabeast' },
  { 'TITAN', 'megabeast' },
}

local function category_of(type_id)
  local ok, tok = pcall(function() return tostring(df.announcement_type[type_id]) end)
  if not ok or not tok then return 'other', '?' end
  local c = EXACT[tok]
  if c then return c, tok end
  for _, rule in ipairs(PREFIX) do
    if string.sub(tok, 1, #rule[1]) == rule[1] then return rule[2], tok end
  end
  return 'other', tok
end

-- ---- date formatting (report.time shares cur_year_tick's scale) -----------
local MONTHS = {'Granite','Slate','Felsite','Hematite','Malachite','Galena',
                'Limestone','Sandstone','Timber','Moonstone','Opal','Obsidian'}
local function ord(n)
  local v = n % 100
  if v >= 11 and v <= 13 then return n .. 'th' end
  local m = n % 10
  if m == 1 then return n .. 'st' elseif m == 2 then return n .. 'nd'
  elseif m == 3 then return n .. 'rd' else return n .. 'th' end
end
local function fmt_date(year, time)
  local t = time or 0
  if t < 0 then t = 0 end
  local midx = math.floor(t / 33600)
  if midx > 11 then midx = 11 end
  local day = math.floor((t % 33600) / 1200) + 1
  return ord(day) .. ' ' .. MONTHS[midx + 1] .. ', Year ' .. tostring(year)
end

-- ---- window bounds --------------------------------------------------------
local reports = df.global.world.status.reports
local n = #reports
local next_id
pcall(function() next_id = df.global.world.status.next_report_id end)

if n == 0 then
  emit({
    cursor = since or (next_id and (next_id - 1)) or 0,
    oldest_retained_id = nil,
    newest_retained_id = nil,
    window_size = 0,
    pruned = false,
    count = 0,
    battle_collapsed = 0,
    returned_range = nil,
    filtered_categories = has_filter and cats_arg or nil,
    events = {},
    note = 'no reports retained',
  })
  return
end

local oldest_id = reports[0].id
local newest_id = reports[n - 1].id
-- pruned: the caller's cursor sits at/before the retained window, so we cannot
-- guarantee the (since, oldest) span wasn't front-pruned.
local pruned = (since ~= nil) and (since < oldest_id)

-- ---- pass 1: build events (ascending), folding continuations & capping runs
local function pos_anchor(r)
  local ok, p = pcall(function() return r.pos end)
  if not ok or not p then return nil end
  if p.x == nil or p.x == -30000 then return nil end
  return { x = p.x, y = p.y, z = p.z }
end

local function speaker_ref(r)
  local sid = -1
  pcall(function() sid = r.speaker_id end)
  if not sid or sid == -1 then return nil end
  local ref = { id = sid }
  pcall(function()
    local u = df.unit.find(sid)
    if u then ref.name = dfhack.units.getReadableName(u) end
  end)
  return ref
end

local events = {}
local runlen = 0          -- consecutive battle events in the current run
local collapse_idx = nil  -- index in `events` of the active battle collapse marker
local battle_collapsed = 0

for i = 0, n - 1 do
  local r = reports[i]
  if r.id > (since or -1) then
    local is_cont = false
    pcall(function() is_cont = r.flags.continuation end)
    if is_cont and #events > 0 then
      -- Fold a wrapped continuation line into the preceding real event.
      local last = events[#events]
      if not last.collapsed then
        local ok, txt = pcall(function() return tostring(r.text) end)
        if ok and txt ~= '' then last.text = (last.text or '') .. ' ' .. txt end
        last.continuation_lines = (last.continuation_lines or 0) + 1
        if r.id > (last.max_id or last.id) then last.max_id = r.id end
      end
    else
      local cat, tok = category_of(r.type)
      if cat == 'battle' then
        runlen = runlen + 1
        if runlen <= BATTLE_RUN_CAP then
          collapse_idx = nil
          local ok, txt = pcall(function() return tostring(r.text) end)
          local ev = {
            id = r.id, max_id = r.id, category = cat, type = tok,
            text = ok and txt or nil, color = r.color,
            year = r.year, time = r.time, date = fmt_date(r.year, r.time),
            repeat_count = (r.repeat_count and r.repeat_count > 0) and r.repeat_count or nil,
            pos = pos_anchor(r), speaker = speaker_ref(r),
          }
          events[#events + 1] = ev
        elseif runlen == BATTLE_RUN_CAP + 1 then
          -- Open ONE collapse marker for the overflow of this run.
          battle_collapsed = battle_collapsed + 1
          local marker = {
            id = r.id, max_id = r.id, category = 'battle', type = 'COMBAT_COLLAPSED',
            collapsed = true, collapsed_count = 1,
            date = fmt_date(r.year, r.time),
            text = 'consecutive combat reports collapsed to keep the window readable',
          }
          events[#events + 1] = marker
          collapse_idx = #events
        else
          -- Extend the active collapse marker.
          battle_collapsed = battle_collapsed + 1
          local marker = events[collapse_idx]
          marker.collapsed_count = marker.collapsed_count + 1
          if r.id > marker.max_id then marker.max_id = r.id end
        end
      else
        runlen = 0; collapse_idx = nil
        local ok, txt = pcall(function() return tostring(r.text) end)
        events[#events + 1] = {
          id = r.id, max_id = r.id, category = cat, type = tok,
          text = ok and txt or nil, color = r.color,
          year = r.year, time = r.time, date = fmt_date(r.year, r.time),
          repeat_count = (r.repeat_count and r.repeat_count > 0) and r.repeat_count or nil,
          pos = pos_anchor(r), speaker = speaker_ref(r),
        }
      end
    end
  end
end

-- ---- pass 2: category filter (keep collapse markers only if battle wanted) --
if has_filter then
  local kept = {}
  for _, ev in ipairs(events) do
    if cat_filter[ev.category] then kept[#kept + 1] = ev end
  end
  events = kept
end

-- ---- pass 3: most-recent `limit` (events are ascending; take the tail) ------
local total_after_filter = #events
if #events > limit then
  local tail = {}
  for i = #events - limit + 1, #events do tail[#tail + 1] = events[i] end
  events = tail
end

-- Strip the internal max_id bookkeeping field from the emitted events.
for _, ev in ipairs(events) do ev.max_id = nil end

emit({
  cursor = newest_id,               -- highest retained id: pass back as `since`
  oldest_retained_id = oldest_id,
  newest_retained_id = newest_id,
  next_report_id = next_id,
  window_size = n,
  since = since,
  pruned = pruned,
  pruned_note = pruned and
    ('cursor ' .. tostring(since) .. ' is older than the oldest retained id ' ..
     tostring(oldest_id) .. '; earlier events were pruned and are gone') or nil,
  limit = limit,
  count = #events,
  more = total_after_filter > #events,       -- older matching events exist beyond limit
  omitted_by_limit = math.max(0, total_after_filter - #events),
  battle_collapsed = battle_collapsed,        -- battle reports folded into collapse markers
  filtered_categories = has_filter and cats_arg or nil,
  order = 'ascending',                        -- oldest -> newest
  events = events,
})

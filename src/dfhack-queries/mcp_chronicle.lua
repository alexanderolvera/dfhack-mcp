local args = {...}
local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

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

local cat_filter, has_filter = {}, false
for tok in string.gmatch(cats_arg, '[^,]+') do
  local c = string.lower((tok:gsub('^%s*(.-)%s*$', '%1')))
  if c ~= '' then cat_filter[c] = true; has_filter = true end
end

local BATTLE_RUN_CAP = 6

local EXACT = {
  CITIZEN_DEATH='death', PET_DEATH='death', ADV_CREATURE_DEATH='death',
  BIRTH_CITIZEN='birth', BIRTH_ANIMAL='birth', BIRTH_WILD_ANIMAL='birth',
  MARRIAGE='marriage', CITIZEN_MARRIED='marriage', NO_MARRIAGE_CELEBRATION='marriage',
  EMBRACE='marriage',
  STRANGE_MOOD='mood', MOOD_BUILDING_CLAIMED='mood', ARTIFACT_BEGUN='mood',
  POSSESSED_TANTRUM='mood',
  MADE_ARTIFACT='artifact', NAMED_ARTIFACT='artifact', MASTERPIECE_CRAFTED='artifact',
  MASTERPIECE_CONSTRUCTION='artifact', MASTERPIECE_ENGRAVING='artifact',
  MASTERFUL_IMPROVEMENT='artifact', DYED_MASTERPIECE='artifact',
  COOKED_MASTERPIECE='artifact',
  MIGRANT_ARRIVAL='migrants', MIGRANT_ARRIVAL_NAMED='migrants',
  D_MIGRANTS_ARRIVAL='migrants', D_MIGRANT_ARRIVAL='migrants',
  D_MIGRANT_ARRIVAL_DISCOURAGED='migrants', D_NO_MIGRANT_ARRIVAL='migrants',
  DIPLOMAT_ARRIVAL='diplomacy', LIAISON_ARRIVAL='diplomacy',
  TRADE_DIPLOMAT_ARRIVAL='diplomacy', DIPLOMAT_LEFT_UNHAPPY='diplomacy',
  CARAVAN_ARRIVAL='diplomacy', FIRST_CARAVAN_ARRIVAL='diplomacy',
  NOBLE_ARRIVAL='diplomacy', MONARCH_ARRIVAL='diplomacy', HASTY_MONARCH='diplomacy',
  SATISFIED_MONARCH='diplomacy', MOUNTAINHOME='diplomacy',
  CAVE_COLLAPSE='cave-in',
  MEGABEAST_ARRIVAL='megabeast', WEREBEAST_ARRIVAL='megabeast',
  TITAN_ARRIVAL='megabeast', FORGOTTEN_BEAST_ARRIVAL='megabeast',
  BEAST_AMBUSH='megabeast',
  CITIZEN_SNATCHED='siege', CITIZEN_MISSING='siege', PET_MISSING='siege',
  UNDEAD_ATTACK='siege', GHOST_ATTACK='siege',
  STAND_UP='battle', NOT_STUNNED='battle', VERMIN_BITE='battle',
  FALL_OVER='battle', CAUGHT_IN_FLAMES='battle', CAUGHT_IN_WEB='battle',
  FREE_FROM_WEB='battle', PARALYZED='battle', OVERCOME_PARALYSIS='battle',
  PAIN_KO='battle', EXHAUSTION='battle', MARTIAL_TRANCE='battle',
  REGAIN_CONSCIOUSNESS='battle', BREATHE_FIRE='battle', BLOCK_FIRE='battle',
  SHOOT_WEB='battle', FLAME_HIT='battle', MAT_BREATH='battle',
  UNIT_PROJECTILE_SLAM='battle', UNIT_PROJECTILE_SLAM_INTO_UNIT='battle',
  UNIT_PROJECTILE_SLAM_BLOW_APART='battle', BERSERK_CITIZEN='battle',
}
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

local reports = df.global.world.status.reports
local n = #reports
local next_id
pcall(function() next_id = df.global.world.status.next_report_id end)

if n == 0 then
  emit({
    cursor = since or (next_id and (next_id - 1)) or 0,
    oldest_retained_id = nil,
    newest_retained_id = nil,
    next_report_id = next_id,
    window_size = 0,
    since = since,
    pruned = false,
    limit = limit,
    count = 0,
    more = false,
    omitted_by_limit = 0,
    battle_collapsed = 0,
    filtered_categories = has_filter and cats_arg or nil,
    order = 'ascending',
    events = {},
    note = 'no reports retained',
  })
  return
end

local oldest_id = reports[0].id
local newest_id = reports[n - 1].id
local pruned = (since ~= nil) and (since + 1 < oldest_id)

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
local runlen = 0
local collapse_idx = nil
local battle_collapsed = 0

for i = 0, n - 1 do
  local r = reports[i]
  if r.id > (since or -1) then
    local is_cont = false
    pcall(function() is_cont = r.flags.continuation end)
    if is_cont and #events > 0 then
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

if has_filter then
  local kept = {}
  for _, ev in ipairs(events) do
    if cat_filter[ev.category] then kept[#kept + 1] = ev end
  end
  events = kept
end

local total_after_filter = #events
if #events > limit then
  local tail = {}
  for i = #events - limit + 1, #events do tail[#tail + 1] = events[i] end
  events = tail
end

for _, ev in ipairs(events) do ev.max_id = nil end

emit({
  cursor = newest_id,
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
  more = total_after_filter > #events,
  omitted_by_limit = math.max(0, total_after_filter - #events),
  battle_collapsed = battle_collapsed,
  filtered_categories = has_filter and cats_arg or nil,
  order = 'ascending',
  events = events,
})

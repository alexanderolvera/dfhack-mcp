local json = require('json')
local function emit(t) print(json.encode(t)) end

if df.global.gamemode ~= df.game_mode.DWARF then
  emit({ error = 'no fort loaded' })
  return
end

local quickfort_list = reqscript('internal/quickfort/list')

local MAX_ENTRIES = 500

local ok, list = pcall(quickfort_list.do_list_internal, true, false)
if not ok then
  emit({ error = 'quickfort blueprint scan failed: ' .. tostring(list) })
  return
end

local entries, library_count, user_count, truncated = {}, 0, 0, false
for _, v in ipairs(list) do
  if #entries >= MAX_ENTRIES then
    truncated = true
  else
    entries[#entries + 1] = {
      id = v.id,
      path = v.path,
      mode = v.mode,
      label = v.section_name,
      comment = v.comment,
      cursor_start_hint = v.start_comment,
      library = v.library,
    }
  end
  if v.library then library_count = library_count + 1 else user_count = user_count + 1 end
end

emit({
  entries = entries,
  entries_total = #list,
  entries_truncated = truncated,
  library_count = library_count,
  user_count = user_count,
})

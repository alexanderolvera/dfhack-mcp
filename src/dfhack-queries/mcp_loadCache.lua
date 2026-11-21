--@ module = true
-- mcp_loadCache: see CONTRIBUTING.md "Shared internals: the load-time cache".

local json = require('json')

local STORE = 'mcp_loadCache.store'

local store = package.loaded[STORE]
if not store then
  store = { entries = {}, token = nil, hooked = false }
  package.loaded[STORE] = store
end

local function load_token()
  local save_dir, site_id = '?', -1
  pcall(function() save_dir = df.global.world.cur_savegame.save_dir end)
  pcall(function() site_id = df.global.plotinfo.site_id end)
  return tostring(save_dir) .. '/' .. tostring(site_id)
end

local function reset()
  store.entries, store.token = {}, nil
end

if not store.hooked then
  store.hooked = true
  dfhack.onStateChange[STORE] = function(code)
    if code == SC_MAP_LOADED or code == SC_MAP_UNLOADED or code == SC_WORLD_UNLOADED then
      reset()
    end
  end
end

local function current()
  local token = load_token()
  if store.token ~= token then
    reset()
    store.token = token
  end
  return store.entries
end

function peek(key)
  return current()[key]
end

function put(key, value)
  local encoded = reqscript('mcp_jsonOut').encoded(value)
  current()[key] = encoded
  return encoded
end

function state()
  local keys = {}
  for k in pairs(current()) do keys[#keys + 1] = k end
  table.sort(keys)
  return { token = store.token, keys = keys }
end

function clear()
  reset()
  return state()
end

if dfhack_flags and dfhack_flags.module then
  return
end

local sub = ({ ... })[1]
if sub == 'clear' then
  print(json.encode(clear()))
else
  print(json.encode(state()))
end
